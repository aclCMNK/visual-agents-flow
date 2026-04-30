# 📋 Spec: Botón "Up" en Windows — FolderExplorer

**Versión:** 1.0  
**Fecha:** 2026-04-30  
**Estado:** Borrador  
**Scope:** `FolderExplorer` (renderer) + `useFolderExplorer` (hook) + `folder-explorer` (IPC main)

---

## 🎯 Objetivo

Adaptar el comportamiento del botón **"Up"** del `FolderExplorer` para que en **Windows** soporte la navegación hacia la lista de unidades disponibles (`C:\`, `D:\`, etc.), en lugar de desactivarse al llegar a la raíz de una unidad.

En **Linux/macOS** el comportamiento actual no cambia.

---

## 🧩 Contexto

### Estado actual

El `FolderExplorer` está sandboxeado dentro de `$HOME` (Linux/macOS). La lógica de desactivación del botón "Up" es:

```ts
// useFolderExplorer.ts — línea 418
const isAtRoot = breadcrumbs.length <= 1;
// FolderExplorer.tsx — línea 569
disabled={isAtRoot || loading}
```

Y `goUp` usa el breadcrumb anterior:

```ts
const goUp = useCallback(() => {
  if (breadcrumbs.length <= 1) return; // ya en root
  const parent = breadcrumbs[breadcrumbs.length - 2];
  if (parent) void navigateInternal(parent.path, showHidden);
}, [breadcrumbs, navigateInternal, showHidden]);
```

### Problema en Windows

En Windows, las rutas tienen la forma `C:\Users\...`. El concepto de "root absoluto" no es `/` sino la **lista de unidades** (`C:\`, `D:\`, etc.). El sistema actual:

1. No conoce el concepto de "lista de unidades".
2. Desactiva "Up" cuando `breadcrumbs.length <= 1`, lo que en Windows ocurre al llegar a `C:\` — pero el usuario debería poder subir a la lista de unidades.
3. El IPC `folder-explorer:list` está restringido a `HOME_ROOT` (homeJail), lo que impide listar `C:\` o la raíz de otras unidades.

---

## 🗺️ Modelo de Navegación Esperado

### Windows

```
[Lista de unidades]  ←→  C:\  ←→  C:\Users  ←→  C:\Users\kamiloid  ←→  ...
       ↑                   ↑
   Up desactivado     Up activo (va a lista de unidades)
```

| Ubicación actual         | Estado del botón "Up" | Acción al hacer clic         |
|--------------------------|----------------------|------------------------------|
| Lista de unidades        | ❌ Desactivado        | —                            |
| Raíz de unidad (`C:\`)  | ✅ Activo             | Navega a lista de unidades   |
| Subdirectorio (`C:\Users\...`) | ✅ Activo      | Navega al directorio padre   |

### Linux / macOS

| Ubicación actual | Estado del botón "Up" | Acción al hacer clic |
|------------------|----------------------|----------------------|
| `/`              | ❌ Desactivado        | —                    |
| Cualquier otro   | ✅ Activo             | Navega al padre      |

---

## 🚀 Pasos Detallados de Implementación

### Fase 1 — IPC Main: nuevo canal `folder-explorer:list-drives`

**Archivo:** `electron-main/src/ipc/folder-explorer.ts`

#### 1.1 Detectar plataforma

```ts
import { platform } from "node:os";
const IS_WINDOWS = platform() === "win32";
```

#### 1.2 Nuevo tipo de respuesta

```ts
export interface Drive {
  /** Letra de unidad + separador, ej: "C:\\" */
  letter: string;
  /** Ruta raíz de la unidad, ej: "C:\\" */
  path: string;
}

export interface ListDrivesResult {
  ok: true;
  drives: Drive[];
}

export type ListDrivesResponse = ListDrivesResult | FolderExplorerError;
```

#### 1.3 Implementación del handler

```ts
async function handleListDrives(
  _event: Electron.IpcMainInvokeEvent,
): Promise<ListDrivesResponse> {
  if (!IS_WINDOWS) {
    return {
      ok: false,
      code: "E_UNKNOWN",
      message: "list-drives is only available on Windows.",
    };
  }

  // Enumerar unidades A:\ a Z:\ y filtrar las que existen
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const drives: Drive[] = [];

  for (const letter of letters) {
    const drivePath = `${letter}:\\`;
    try {
      await stat(drivePath);
      drives.push({ letter: `${letter}:`, path: drivePath });
    } catch {
      // La unidad no existe o no está disponible — se omite silenciosamente
    }
  }

  return { ok: true, drives };
}
```

#### 1.4 Nuevo canal

```ts
export const FOLDER_EXPLORER_CHANNELS = {
  LIST:          "folder-explorer:list",
  STAT:          "folder-explorer:stat",
  READ_CHILDREN: "folder-explorer:read-children",
  MKDIR:         "folder-explorer:mkdir",
  LIST_DRIVES:   "folder-explorer:list-drives",   // ← NUEVO
} as const;
```

#### 1.5 Registrar handler

```ts
export function registerFolderExplorerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.LIST,          handleList);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.STAT,          handleStat);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.READ_CHILDREN, handleReadChildren);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.MKDIR,         handleMkdir);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.LIST_DRIVES,   handleListDrives); // ← NUEVO
}
```

#### 1.6 Ajuste de `homeJail` para Windows

El `homeJail.ts` actual usa `HOME_ROOT` basado en `os.homedir()`. En Windows, `os.homedir()` devuelve algo como `C:\Users\kamiloid`. El jail debe permitir también navegar a la raíz de la unidad del home (`C:\`) y a otras unidades cuando se usa `list-drives`.

> **Nota:** El canal `list-drives` **no pasa por homeJail** — es un listado de unidades del sistema, no de contenido de directorios. El canal `list` sí debe seguir validando con homeJail para rutas normales.

Para permitir que `list` funcione en `C:\` (raíz de unidad), se debe ampliar `resolveWithinHome` en Windows para aceptar rutas que sean raíz de cualquier unidad (`X:\`), o bien crear una variante `resolveWithinDrive` que valide que la ruta pertenece a una unidad válida del sistema.

**Estrategia recomendada:** Crear una función `resolveForWindows(rawPath)` que:
1. Si la ruta es raíz de unidad (`/^[A-Z]:\\$/i`), la acepta directamente sin homeJail.
2. Si la ruta es subdirectorio de una unidad, la acepta si la unidad existe.
3. Mantiene homeJail para Linux/macOS sin cambios.

---

### Fase 2 — Preload: exponer `listDrives`

**Archivo:** `electron-main/src/preload/index.ts`

```ts
export interface FolderExplorerBridge {
  list(path: string, options?: FilterOptions): Promise<ListResponse>;
  stat(path: string): Promise<StatResponse>;
  readChildren(paths: string[], options?: FilterOptions): Promise<ReadChildrenResponse>;
  mkdir(parentPath: string, name: string): Promise<MkdirResponse>;
  listDrives(): Promise<ListDrivesResponse>;  // ← NUEVO
}

const folderExplorerBridge: FolderExplorerBridge = {
  // ... métodos existentes ...
  listDrives(): Promise<ListDrivesResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.LIST_DRIVES,
    ) as Promise<ListDrivesResponse>;
  },
};
```

---

### Fase 3 — Hook: `useFolderExplorer` — soporte Windows

**Archivo:** `src/renderer/hooks/useFolderExplorer.ts`

#### 3.1 Nuevo estado: `isWindowsDriveList`

```ts
const [isDriveList, setIsDriveList] = useState<boolean>(false);
const [drives, setDrives] = useState<Drive[]>([]);
```

#### 3.2 Detectar plataforma en renderer

```ts
// Electron expone process.platform en el renderer si contextIsolation lo permite.
// Alternativa: añadir un campo en el bridge o usar navigator.userAgent.
const IS_WINDOWS = navigator.userAgent.includes("Windows");
```

> **Alternativa más robusta:** Exponer `platform` desde el preload como campo estático:
> ```ts
> contextBridge.exposeInMainWorld("platform", process.platform);
> ```
> Y consumirlo como `window.platform === "win32"`.

#### 3.3 Helpers de detección de raíz de unidad

```ts
/** Detecta si una ruta es la raíz de una unidad Windows, ej: "C:\" */
function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\\$/.test(path);
}

/** Detecta si una ruta es la raíz de una unidad Windows (sin trailing slash), ej: "C:" */
function isWindowsDriveLetter(path: string): boolean {
  return /^[A-Za-z]:$/.test(path);
}
```

#### 3.4 Nuevo método `goToDriveList`

```ts
const goToDriveList = useCallback(async () => {
  if (!IS_WINDOWS) return;
  setLoading(true);
  setError(null);
  const result = await window.folderExplorer.listDrives();
  if (!result.ok) {
    setError({ code: result.code, message: result.message });
    setLoading(false);
    return;
  }
  setDrives(result.drives);
  setIsDriveList(true);
  setCwd("");
  setBreadcrumbs([]);
  setEntries([]);
  setSelected(new Set());
  setLoading(false);
}, [IS_WINDOWS]);
```

#### 3.5 Modificar `goUp`

```ts
const goUp = useCallback(() => {
  if (IS_WINDOWS) {
    if (isDriveList) return; // ya en lista de unidades — no-op
    if (isWindowsDriveRoot(cwd)) {
      // Estamos en C:\ → subir a lista de unidades
      void goToDriveList();
      return;
    }
  }

  // Comportamiento original (Linux/macOS o subdirectorios Windows)
  if (breadcrumbs.length <= 1) return;
  const parent = breadcrumbs[breadcrumbs.length - 2];
  if (parent) void navigateInternal(parent.path, showHidden);
}, [IS_WINDOWS, isDriveList, cwd, breadcrumbs, navigateInternal, showHidden, goToDriveList]);
```

#### 3.6 Modificar `isAtRoot` (expuesto en el handle)

```ts
// En el return del hook:
isAtRoot: IS_WINDOWS ? isDriveList : breadcrumbs.length <= 1,
```

#### 3.7 Exponer en `FolderExplorerHandle`

```ts
export interface FolderExplorerHandle {
  // ... campos existentes ...
  isDriveList: boolean;
  drives: Drive[];
  goToDriveList: () => void;
  openDrive: (drive: Drive) => void;
  isAtRoot: boolean;  // ← ya existía, pero ahora tiene semántica Windows
}
```

---

### Fase 4 — Componente: `FolderExplorer.tsx` — vista de lista de unidades

**Archivo:** `src/renderer/components/FolderExplorer/FolderExplorer.tsx`

#### 4.1 Condición de desactivación del botón "Up"

```tsx
// Antes:
const isAtRoot = breadcrumbs.length <= 1;

// Después (usar el valor del hook):
const { isAtRoot, isDriveList, drives, openDrive, ...rest } = useFolderExplorer({ ... });
```

El botón "Up" ya usa `isAtRoot`:
```tsx
disabled={isAtRoot || loading}
title={isAtRoot ? "Already at root" : "Go up"}
```

No requiere cambio en el JSX del botón — solo en la lógica del hook.

#### 4.2 Vista de lista de unidades

Cuando `isDriveList === true`, renderizar una vista especial en lugar del listado normal:

```tsx
{isDriveList ? (
  <ul className={styles.driveList} role="listbox" aria-label="Available drives">
    {drives.map((drive) => (
      <li
        key={drive.letter}
        className={styles.driveItem}
        role="option"
        aria-selected={false}
        onClick={() => openDrive(drive)}
        onDoubleClick={() => openDrive(drive)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") openDrive(drive);
        }}
        aria-label={`Drive ${drive.letter}`}
      >
        <span className={styles.driveIcon} aria-hidden="true">💾</span>
        <span className={styles.driveLetter}>{drive.letter}</span>
      </li>
    ))}
  </ul>
) : (
  /* ... listado normal de directorios ... */
)}
```

#### 4.3 Breadcrumb en lista de unidades

Cuando `isDriveList === true`, mostrar un breadcrumb especial:

```tsx
{isDriveList ? (
  <span className={styles.breadcrumbRoot}>This PC</span>
) : (
  /* breadcrumbs normales */
)}
```

---

### Fase 5 — CSS: estilos para la vista de unidades

**Archivo:** `src/renderer/components/FolderExplorer/FolderExplorer.module.css`

```css
.driveList {
  list-style: none;
  margin: 0;
  padding: var(--fe-spacing-sm, 8px);
  display: flex;
  flex-wrap: wrap;
  gap: var(--fe-spacing-md, 12px);
}

.driveItem {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--fe-spacing-md, 12px);
  border-radius: var(--fe-radius, 6px);
  cursor: pointer;
  min-width: 72px;
  transition: background 0.15s;
}

.driveItem:hover,
.driveItem:focus-visible {
  background: var(--fe-hover-bg, rgba(255,255,255,0.08));
  outline: 2px solid var(--fe-focus-ring, #4a9eff);
}

.driveIcon {
  font-size: 2rem;
  line-height: 1;
}

.driveLetter {
  margin-top: 4px;
  font-size: 0.85rem;
  font-weight: 600;
}
```

---

## ✅ Criterios de Aceptación

### CA-1: Botón "Up" activo en raíz de unidad (Windows)

- **Dado** que el usuario está en `C:\` en Windows  
- **Cuando** observa el botón "Up"  
- **Entonces** el botón está **habilitado** (no `disabled`)

### CA-2: "Up" desde raíz de unidad navega a lista de unidades

- **Dado** que el usuario está en `C:\` en Windows  
- **Cuando** hace clic en "Up"  
- **Entonces** se muestra la lista de unidades disponibles (`C:\`, `D:\`, etc.)

### CA-3: "Up" desactivado en lista de unidades

- **Dado** que el usuario está en la lista de unidades  
- **Cuando** observa el botón "Up"  
- **Entonces** el botón está **desactivado** (`disabled`)

### CA-4: Navegación desde lista de unidades

- **Dado** que el usuario está en la lista de unidades  
- **Cuando** hace clic (o doble clic) en una unidad (ej: `D:\`)  
- **Entonces** el explorador navega al contenido de `D:\`

### CA-5: "Up" desde subdirectorio Windows

- **Dado** que el usuario está en `C:\Users\kamiloid\projects`  
- **Cuando** hace clic en "Up"  
- **Entonces** navega a `C:\Users\kamiloid`

### CA-6: Comportamiento Linux/macOS sin cambios

- **Dado** que el usuario está en `/` en Linux o macOS  
- **Cuando** observa el botón "Up"  
- **Entonces** el botón está **desactivado**

### CA-7: Breadcrumb en lista de unidades

- **Dado** que el usuario está en la lista de unidades  
- **Cuando** observa el breadcrumb  
- **Entonces** muestra "This PC" (o equivalente localizable)

### CA-8: Teclado — Backspace en raíz de unidad (Windows)

- **Dado** que el usuario está en `C:\` en Windows  
- **Cuando** presiona `Backspace` en el listado  
- **Entonces** navega a la lista de unidades (mismo comportamiento que "Up")

### CA-9: Teclado — Enter en lista de unidades

- **Dado** que el usuario está en la lista de unidades y tiene una unidad seleccionada  
- **Cuando** presiona `Enter`  
- **Entonces** navega al contenido de esa unidad

### CA-10: Lista de unidades solo muestra unidades existentes

- **Dado** que el sistema tiene `C:\` y `D:\` pero no `E:\`  
- **Cuando** se muestra la lista de unidades  
- **Entonces** solo aparecen `C:` y `D:` (no `E:`)

---

## ⚠️ Edge Cases

| # | Caso | Comportamiento esperado |
|---|------|------------------------|
| EC-1 | `list-drives` llamado en Linux/macOS | Retorna `E_UNKNOWN` con mensaje explicativo; el renderer no debe llamarlo en esas plataformas |
| EC-2 | Solo existe una unidad (`C:\`) | La lista muestra solo `C:` — el botón "Up" desde `C:\` sigue activo y lleva a esa lista de una unidad |
| EC-3 | Unidad sin permisos de lectura | La unidad aparece en la lista (existe), pero al navegar a ella se muestra `E_ACCESS_DENIED` |
| EC-4 | Unidad extraíble desconectada entre `listDrives` y `navigate` | Al intentar navegar, el IPC retorna `E_NOT_FOUND`; el explorador muestra el error y permanece en la lista de unidades |
| EC-5 | `cwd` es `""` (estado inicial) | `goUp` es no-op; botón "Up" desactivado |
| EC-6 | Ruta Windows sin trailing slash (`C:`) | Normalizar a `C:\` antes de comparar con `isWindowsDriveRoot` |
| EC-7 | Ruta con forward slashes en Windows (`C:/Users`) | Normalizar separadores antes de comparar |
| EC-8 | `initialPath` apunta a `C:\` en Windows | El hook debe detectar que está en raíz de unidad y configurar `isAtRoot = false` correctamente |
| EC-9 | Usuario navega a `C:\` desde breadcrumb (no desde "Up") | El estado `isDriveList` debe ser `false`; el botón "Up" debe estar activo |
| EC-10 | Múltiples instancias de `FolderExplorer` en la misma página | Cada instancia mantiene su propio estado `isDriveList` independiente |

---

## 📁 Archivos a Modificar

| Archivo | Tipo de cambio | Descripción |
|---------|---------------|-------------|
| `electron-main/src/ipc/folder-explorer.ts` | **Modificar** | Añadir canal `list-drives`, tipo `Drive`, `ListDrivesResult`, `ListDrivesResponse`, handler `handleListDrives`, registro en `registerFolderExplorerHandlers` |
| `electron-main/src/fs/homeJail.ts` | **Modificar** | Ampliar para permitir rutas de raíz de unidad Windows (`C:\`) sin pasar por el jail de HOME |
| `electron-main/src/preload/index.ts` | **Modificar** | Añadir `listDrives()` a `FolderExplorerBridge` y a `folderExplorerBridge` |
| `src/renderer/hooks/useFolderExplorer.ts` | **Modificar** | Añadir estado `isDriveList`, `drives`; nuevo método `goToDriveList`, `openDrive`; modificar `goUp` e `isAtRoot` para Windows |
| `src/renderer/components/FolderExplorer/FolderExplorer.tsx` | **Modificar** | Añadir vista de lista de unidades (`isDriveList`), breadcrumb "This PC", soporte teclado en vista de unidades |
| `src/renderer/components/FolderExplorer/FolderExplorer.module.css` | **Modificar** | Añadir estilos `.driveList`, `.driveItem`, `.driveIcon`, `.driveLetter` |

### Archivos a crear (opcionales pero recomendados)

| Archivo | Descripción |
|---------|-------------|
| `src/renderer/hooks/useFolderExplorer.windows.test.ts` | Tests unitarios del comportamiento Windows en el hook |
| `src/renderer/components/FolderExplorer/FolderExplorer.windows.test.tsx` | Tests de integración del componente en modo Windows |
| `electron-main/src/ipc/folder-explorer.windows.test.ts` | Tests del handler `list-drives` |

---

## 🧪 Tests Recomendados

### Hook (`useFolderExplorer`)

```ts
// Windows — goUp desde raíz de unidad
it("goUp desde C:\\ llama a listDrives y activa isDriveList", async () => { ... });

// Windows — goUp desde lista de unidades es no-op
it("goUp en isDriveList=true no hace nada", () => { ... });

// Windows — isAtRoot es true solo en isDriveList
it("isAtRoot es false en C:\\", () => { ... });
it("isAtRoot es true en isDriveList", () => { ... });

// Linux — comportamiento sin cambios
it("goUp en / es no-op en Linux", () => { ... });
it("isAtRoot es true en / en Linux", () => { ... });
```

### Componente (`FolderExplorer`)

```tsx
// Botón Up habilitado en C:\
it("Up button está habilitado en C:\\", () => { ... });

// Botón Up desactivado en lista de unidades
it("Up button está desactivado en isDriveList", () => { ... });

// Vista de lista de unidades renderiza drives
it("Muestra lista de unidades cuando isDriveList=true", () => { ... });

// Clic en unidad navega a ella
it("Clic en C: navega a C:\\", () => { ... });

// Backspace en C:\ va a lista de unidades
it("Backspace en C:\\ activa isDriveList", () => { ... });
```

### IPC Main (`folder-explorer`)

```ts
// list-drives retorna unidades existentes
it("handleListDrives retorna C:\\ y D:\\ si existen", async () => { ... });

// list-drives en Linux retorna E_UNKNOWN
it("handleListDrives en Linux retorna E_UNKNOWN", async () => { ... });

// list-drives omite unidades inexistentes
it("handleListDrives no incluye E:\\ si no existe", async () => { ... });
```

---

## 📝 Notas Adicionales

1. **Detección de plataforma en renderer:** Se recomienda exponer `process.platform` desde el preload como `window.platform` para evitar depender de `navigator.userAgent`, que puede ser manipulado o no ser confiable en Electron.

2. **Localización:** El texto "This PC" en el breadcrumb debería ser localizable. Si el proyecto tiene un sistema i18n, usar la clave correspondiente.

3. **Seguridad:** El canal `list-drives` no expone contenido de directorios, solo letras de unidad. No requiere homeJail, pero sí debe estar restringido a Windows en el handler.

4. **Compatibilidad con `homeJail`:** La modificación de `homeJail.ts` para Windows debe ser quirúrgica — no debe romper el comportamiento en Linux/macOS ni debilitar las protecciones existentes.

5. **UX — Unidades de red:** Las unidades de red mapeadas (ej: `Z:\`) aparecerán en la lista si están montadas. No se requiere distinción visual en esta versión.

6. **Estado inicial en Windows:** Si `initialPath` es `C:\Users\kamiloid`, el hook debe iniciar con `isDriveList = false` y `isAtRoot = false` (el usuario puede subir).

---

*Spec generada por Weight-Planner — agentsFlow workspace*
