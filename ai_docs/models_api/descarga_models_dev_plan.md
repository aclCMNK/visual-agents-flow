# 🧠 Plan de Solución — Descarga y Caché de `models.dev/api.json`

## 🎯 Objetivo

Implementar un sistema de descarga, caché y actualización automática del archivo
`https://models.dev/api.json`, con fallback robusto ante fallos de red, integración
con la arquitectura IPC de Electron existente, y feedback visual (spinner) en la UI
mientras la descarga está en curso.

---

## 🧩 Contexto

El proyecto es una aplicación Electron con:

- **Main process** (`electron-main/src/`) — lógica de sistema de archivos e IPC handlers.
- **Renderer process** (`src/renderer/`) — React, hooks, servicios IPC tipados.
- **Preload** (`electron-main/src/preload/`) — puente `contextBridge` entre main y renderer.
- **Patrón IPC establecido**: cada dominio tiene su propio archivo en `electron-main/src/ipc/<domain>.ts`,
  se registra en el barrel `index.ts`, y el renderer lo consume a través de un servicio tipado.

El archivo JSON a gestionar se almacenará en:

```
[raíz del proyecto]/models/api/models.dev.json
```

La lógica de antigüedad es: **5 días** desde la última modificación (`mtime`) del archivo.

---

## 🧭 Estrategia

Seguir el patrón IPC ya establecido en el proyecto:

1. **Main process** maneja toda la lógica de I/O, descarga HTTP y caché (acceso a `fs`, `fetch`, rutas absolutas).
2. **Renderer** solo invoca IPC y reacciona al estado devuelto (loading, data, error).
3. **Preload** expone el canal nuevo via `contextBridge`.
4. Un **hook React** encapsula el ciclo de vida de la descarga y expone `{ data, loading, error }`.

---

## 🚀 Fases

---

### 🔹 Phase 1: Infraestructura de almacenamiento y lógica de caché (Main Process)

**Description:**
Crear el módulo de caché en el main process que gestiona la ruta local del JSON,
verifica antigüedad y decide si descargar o reutilizar el archivo existente.

**Tasks:**

- **Task 1.1 — Crear módulo `models-api-cache.ts`**
  - **Assigned to:** Developer (main process)
  - **Ruta:** `electron-main/src/fs/models-api-cache.ts`
  - **Responsabilidades:**
    - Definir la constante `MODELS_DEV_URL = "https://models.dev/api.json"`
    - Definir la ruta local: `<projectRoot>/models/api/models.dev.json`
      - Usar `app.getAppPath()` o una variable de entorno para resolver `projectRoot`
      - Alternativamente, usar `path.join(__dirname, "../../../models/api/models.dev.json")`
        ajustando según la estructura de build
    - Exportar función `getCacheFilePath(): string`
    - Exportar función `isCacheStale(filePath: string): Promise<boolean>`
      - Usa `fs.stat(filePath)` para obtener `mtime`
      - Retorna `true` si el archivo no existe o si `Date.now() - mtime >= 5 * 24 * 60 * 60 * 1000`
    - Exportar función `downloadAndSave(filePath: string): Promise<void>`
      - Usa `fetch(MODELS_DEV_URL)` (disponible en Node 18+)
      - Crea el directorio con `fs.mkdir(dir, { recursive: true })` si no existe
      - Escribe el JSON con `fs.writeFile(filePath, text, "utf-8")`
      - Lanza error si la respuesta HTTP no es `ok`
    - Exportar función `readCacheFile(filePath: string): Promise<unknown | null>`
      - Lee y parsea el JSON; retorna `null` si el archivo no existe o es inválido
  - **Dependencies:** ninguna

- **Task 1.2 — Crear directorio `models/api/` en el repositorio**
  - **Assigned to:** Developer
  - **Acción:** Crear `models/api/.gitkeep` para que el directorio exista en el repo
    pero el JSON descargado sea ignorado por git (agregar `models/api/models.dev.json` a `.gitignore`)
  - **Dependencies:** ninguna

---

### 🔹 Phase 2: IPC Handler — dominio `models-api`

**Description:**
Crear el handler IPC que orquesta la lógica de caché y expone el resultado al renderer,
siguiendo exactamente el patrón de `folder-explorer.ts`.

**Tasks:**

- **Task 2.1 — Crear `electron-main/src/ipc/models-api.ts`**
  - **Assigned to:** Developer (main process)
  - **Responsabilidades:**
    - Definir constante de canal:
      ```ts
      export const MODELS_API_CHANNELS = {
        GET_MODELS: "models-api:get-models",
      } as const;
      ```
    - Definir tipos de respuesta:
      ```ts
      export type ModelsApiStatus =
        | "fresh"       // archivo existente, no expirado → devuelto sin descarga
        | "downloaded"  // descarga exitosa
        | "fallback"    // descarga fallida, se usa caché anterior
        | "unavailable" // descarga fallida y no hay caché
      
      export interface ModelsApiResult {
        ok: boolean;
        status: ModelsApiStatus;
        data: unknown | null;  // el JSON parseado, o null si unavailable
        error?: string;        // mensaje de error si aplica
      }
      ```
    - Implementar `handleGetModels(_event): Promise<ModelsApiResult>`:
      1. Obtener `filePath` desde `getCacheFilePath()`
      2. Llamar `isCacheStale(filePath)`
      3. Si **no está stale** → leer caché, retornar `{ ok: true, status: "fresh", data }`
      4. Si **está stale** → intentar `downloadAndSave(filePath)`:
         - Éxito → leer caché, retornar `{ ok: true, status: "downloaded", data }`
         - Fallo → intentar `readCacheFile(filePath)`:
           - Si hay datos → retornar `{ ok: true, status: "fallback", data, error: msg }`
           - Si no hay datos → retornar `{ ok: false, status: "unavailable", data: null, error: msg }`
    - Exportar `registerModelsApiHandlers(ipcMain: IpcMain): void`
  - **Dependencies:** Task 1.1

- **Task 2.2 — Registrar el handler en el barrel `electron-main/src/ipc/index.ts`**
  - **Assigned to:** Developer
  - **Acción:**
    - Agregar `export * from "./models-api.ts"` (orden alfabético)
    - Llamar `registerModelsApiHandlers(ipcMain)` dentro de `registerIpcHandlers()`
      en `src/electron/ipc-handlers.ts`
  - **Dependencies:** Task 2.1

---

### 🔹 Phase 3: Preload Bridge

**Description:**
Exponer el nuevo canal IPC al renderer a través del `contextBridge`, siguiendo
el patrón del preload existente.

**Tasks:**

- **Task 3.1 — Actualizar el preload para exponer `modelsApi`**
  - **Assigned to:** Developer (preload)
  - **Ruta:** `electron-main/src/preload/` (archivo existente de preload)
  - **Acción:** Agregar en `contextBridge.exposeInMainWorld`:
    ```ts
    modelsApi: {
      getModels: (): Promise<ModelsApiResult> =>
        ipcRenderer.invoke(MODELS_API_CHANNELS.GET_MODELS),
    }
    ```
  - **Augmentación de `Window`:** Agregar la declaración de tipo en el archivo
    de tipos del preload o en `src/vite-env.d.ts`:
    ```ts
    interface Window {
      modelsApi: {
        getModels(): Promise<ModelsApiResult>;
      };
    }
    ```
  - **Dependencies:** Task 2.1

---

### 🔹 Phase 4: Servicio IPC en el Renderer

**Description:**
Crear el wrapper tipado del lado del renderer, análogo a `src/renderer/services/ipc.ts`
pero para el dominio `models-api`.

**Tasks:**

- **Task 4.1 — Crear `src/renderer/services/models-api.ts`**
  - **Assigned to:** Developer (renderer)
  - **Responsabilidades:**
    - Re-exportar los tipos necesarios (`ModelsApiStatus`, `ModelsApiResult`)
      como tipos locales del renderer (sin importar del main process)
    - Implementar `getModels(): Promise<ModelsApiServiceResult>` con:
      - Timeout de ~15 segundos (la descarga puede tardar más que una op de fs)
      - Normalización de errores al patrón `{ ok, status, data, error }`
      - Guard de bridge: si `window.modelsApi` no existe, retornar `unavailable`
  - **Dependencies:** Task 3.1

---

### 🔹 Phase 5: Hook React — `useModelsApi`

**Description:**
Crear el hook que gestiona el ciclo de vida de la solicitud, exponiendo
`{ data, loading, error, status }` para que los componentes UI puedan
reaccionar apropiadamente.

**Tasks:**

- **Task 5.1 — Crear `src/renderer/hooks/useModelsApi.ts`**
  - **Assigned to:** Developer (renderer/React)
  - **Responsabilidades:**
    - Estado: `{ data: unknown | null, loading: boolean, status: ModelsApiStatus | null, error: string | null }`
    - En `useEffect` (mount): llamar `getModels()` del servicio
    - Mientras la promesa está pendiente: `loading = true`
    - Al resolver: actualizar `data`, `status`, `loading = false`
    - Al rechazar o `status === "unavailable"`: `error = mensaje`, `data = null`
    - Retornar `{ data, loading, status, error, refetch }` donde `refetch` permite
      forzar una nueva verificación manualmente
  - **Dependencies:** Task 4.1

---

### 🔹 Phase 6: Integración UI — Spinner y renderizado condicional

**Description:**
Integrar el hook en los componentes que dependen del JSON de modelos,
mostrando un spinner **solo en la sección afectada** mientras se descarga.

**Tasks:**

- **Task 6.1 — Identificar componentes que consumen datos de modelos**
  - **Assigned to:** Developer (UI)
  - **Acción:** Localizar en `src/renderer/components/` los componentes que
    muestran detalles extendidos de modelos (selector de modelo, panel de info, etc.)
  - **Dependencies:** ninguna (análisis previo)

- **Task 6.2 — Agregar spinner localizado en componentes afectados**
  - **Assigned to:** Developer (UI)
  - **Patrón de uso:**
    ```tsx
    const { data, loading, status } = useModelsApi();

    if (loading) {
      return <ModelsSectionSpinner />;  // spinner solo en esta sección
    }

    if (status === "unavailable" || data === null) {
      return <ModelsBasicView />;  // vista reducida sin detalles extendidos
    }

    return <ModelsExtendedView data={data} />;
    ```
  - **Consideraciones:**
    - El spinner NO debe bloquear el resto de la UI
    - Si `status === "fallback"`, mostrar los datos del caché anterior
      con un indicador sutil de "datos desactualizados" (opcional)
    - Si `status === "unavailable"`, ocultar silenciosamente los detalles
      extendidos (no mostrar error al usuario final)
  - **Dependencies:** Task 5.1, Task 6.1

- **Task 6.3 — Crear componente `ModelsSectionSpinner`**
  - **Assigned to:** Developer (UI)
  - **Ruta sugerida:** `src/renderer/components/ui/ModelsSectionSpinner.tsx`
  - **Descripción:** Spinner inline/localizado, sin overlay global, que encaje
    visualmente en la sección de modelos
  - **Dependencies:** ninguna

---

### 🔹 Phase 7: Pruebas y Validaciones

**Description:**
Definir los casos de prueba para cada capa del sistema.

**Tasks:**

- **Task 7.1 — Tests unitarios del módulo de caché (`models-api-cache.ts`)**
  - **Assigned to:** Developer (tests)
  - **Ruta:** `tests/electron/fs/models-api-cache.test.ts`
  - **Casos:**
    - `isCacheStale`: archivo inexistente → `true`
    - `isCacheStale`: archivo con `mtime` de hace 4 días → `false`
    - `isCacheStale`: archivo con `mtime` de hace 5 días exactos → `true`
    - `isCacheStale`: archivo con `mtime` de hace 6 días → `true`
    - `downloadAndSave`: mock de `fetch` exitoso → archivo escrito correctamente
    - `downloadAndSave`: mock de `fetch` con error HTTP 500 → lanza error
    - `downloadAndSave`: mock de `fetch` que rechaza (sin red) → lanza error
    - `readCacheFile`: archivo válido → retorna objeto parseado
    - `readCacheFile`: archivo inexistente → retorna `null`
    - `readCacheFile`: archivo con JSON inválido → retorna `null` (no lanza)
  - **Dependencies:** Task 1.1

- **Task 7.2 — Tests unitarios del IPC handler (`models-api.ts`)**
  - **Assigned to:** Developer (tests)
  - **Ruta:** `tests/electron/ipc/models-api.test.ts`
  - **Casos:**
    - Caché fresca → `status: "fresh"`, `ok: true`, `data` presente
    - Caché stale + descarga exitosa → `status: "downloaded"`, `ok: true`
    - Caché stale + descarga fallida + caché anterior existe → `status: "fallback"`, `ok: true`
    - Caché stale + descarga fallida + sin caché → `status: "unavailable"`, `ok: false`
    - Mock de `ipcMain` (sin Electron real, igual que `folder-explorer.ts`)
  - **Dependencies:** Task 2.1

- **Task 7.3 — Tests del hook `useModelsApi`**
  - **Assigned to:** Developer (tests)
  - **Ruta:** `tests/renderer/hooks/useModelsApi.test.ts`
  - **Casos:**
    - `loading: true` durante la promesa pendiente
    - `loading: false` tras resolver
    - `data` poblado en caso exitoso
    - `error` poblado en caso `unavailable`
    - `refetch` dispara una nueva llamada
    - Bridge no disponible → `status: "unavailable"` sin crash
  - **Dependencies:** Task 5.1

---

## 📁 Estructura de Archivos Afectados

```
[raíz del proyecto]/
├── models/
│   └── api/
│       ├── .gitkeep                          ← nuevo (directorio versionado)
│       └── models.dev.json                   ← nuevo (ignorado por git, generado en runtime)
│
├── electron-main/src/
│   ├── fs/
│   │   └── models-api-cache.ts               ← nuevo
│   └── ipc/
│       ├── models-api.ts                     ← nuevo
│       └── index.ts                          ← modificado (agregar export + registro)
│
├── src/
│   ├── electron/
│   │   └── ipc-handlers.ts                   ← modificado (llamar registerModelsApiHandlers)
│   ├── renderer/
│   │   ├── services/
│   │   │   └── models-api.ts                 ← nuevo
│   │   ├── hooks/
│   │   │   └── useModelsApi.ts               ← nuevo
│   │   └── components/
│   │       └── ui/
│   │           └── ModelsSectionSpinner.tsx  ← nuevo
│   └── vite-env.d.ts                         ← modificado (Window augmentation)
│
└── tests/
    ├── electron/
    │   ├── fs/
    │   │   └── models-api-cache.test.ts      ← nuevo
    │   └── ipc/
    │       └── models-api.test.ts            ← nuevo
    └── renderer/
        └── hooks/
            └── useModelsApi.test.ts          ← nuevo
```

---

## 🔄 Flujo de Actualización y Fallback

```
App inicia / componente monta
         │
         ▼
  useModelsApi() → getModels() IPC
         │
         ▼
  [Main Process] handleGetModels()
         │
         ├─ getCacheFilePath()
         │
         ▼
  isCacheStale(filePath)?
         │
    NO ──┤──── Leer caché ──────────────────────► { status: "fresh", data }
         │
    SÍ ──┤
         ▼
  downloadAndSave(filePath)
         │
    OK ──┤──── Leer caché ──────────────────────► { status: "downloaded", data }
         │
  FAIL ──┤
         ▼
  readCacheFile(filePath)
         │
  data ──┤──── Retornar caché anterior ─────────► { status: "fallback", data, error }
         │
  null ──┴──── Sin datos disponibles ──────────► { status: "unavailable", data: null }
```

---

## ⚠️ Riesgos

- **Resolución de `projectRoot`**: La ruta `models/api/` debe ser relativa a la raíz
  del proyecto, no al directorio de build. Usar `app.getAppPath()` en desarrollo y
  verificar que funcione correctamente en producción (app empaquetada con Electron Builder).
  Considerar usar una variable de entorno `AGENTS_HOME` o similar ya presente en el proyecto.

- **`fetch` en Node.js**: Disponible nativamente desde Node 18. Verificar la versión
  de Node usada en el proyecto (`package.json` → `engines`). Si es < 18, usar `node-fetch`
  o el módulo `https` nativo.

- **Timeout de descarga**: La descarga puede tardar varios segundos. El timeout del
  servicio IPC del renderer debe ser mayor que el de operaciones de fs (sugerido: 15-30s).
  Ajustar `TIMEOUT_MS` en `models-api.ts` del renderer.

- **JSON inválido del servidor**: Si `models.dev/api.json` devuelve HTML de error
  o un JSON malformado, `JSON.parse` lanzará. Envolver en try/catch en `readCacheFile`
  y en `downloadAndSave` (validar que el contenido sea JSON válido antes de escribir).

- **Concurrencia**: Si el usuario abre múltiples ventanas, múltiples handlers podrían
  intentar descargar simultáneamente. Considerar un flag de "descarga en progreso"
  a nivel de módulo en el main process para evitar descargas duplicadas.

- **Permisos de escritura**: En algunos entornos, la ruta `models/api/` podría no
  ser escribible (app empaquetada en directorio de solo lectura). Evaluar usar
  `app.getPath("userData")` como alternativa para almacenar el caché.

---

## 📝 Notas

- **Patrón de naming**: Seguir la convención `models-api:*` para los canales IPC,
  consistente con `folder-explorer:*` ya existente.

- **Sin polling**: La verificación de antigüedad ocurre **solo cuando el componente
  monta** (o cuando se llama `refetch`). No se implementa polling en background
  para no consumir recursos innecesariamente.

- **`.gitignore`**: Agregar `models/api/models.dev.json` para no versionar el JSON
  descargado (puede ser grande y cambia frecuentemente).

- **Datos del JSON**: El tipo `unknown` para `data` es intencional en esta fase.
  Una vez conocida la estructura real de `models.dev/api.json`, definir un tipo
  `ModelsDevSchema` en `src/types/` y validar con zod o similar.

- **Indicador de datos desactualizados**: Para `status: "fallback"`, considerar
  mostrar un tooltip o badge sutil indicando que los datos pueden estar desactualizados,
  sin interrumpir el flujo del usuario.

- **Accesibilidad del spinner**: El componente `ModelsSectionSpinner` debe incluir
  `aria-label="Cargando modelos"` y `role="status"` para lectores de pantalla.
