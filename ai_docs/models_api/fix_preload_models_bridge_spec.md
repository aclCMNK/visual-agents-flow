# 🧠 Spec Técnica: Fix — `window.modelsApi` no disponible en el renderer

**Archivo:** `ai_docs/models_api/fix_preload_models_bridge_spec.md`  
**Fecha:** 2026-04-30  
**Severidad:** 🔴 Bug crítico — bloquea descarga y actualización de `models.dev.json`  
**Estado:** Pendiente de implementación

---

## 🎯 Objetivo

Exponer `window.modelsApi` en el renderer a través del preload activo (`src/electron/preload.ts`), de modo que el flujo de descarga y actualización de `models.dev.json` funcione correctamente en producción y desarrollo.

---

## 🧩 Contexto del Bug

### Diagnóstico

El proyecto tiene **dos preloads**:

| Archivo | ¿Es el preload activo? | ¿Expone `window.modelsApi`? |
|---|---|---|
| `src/electron/preload.ts` | ✅ SÍ — referenciado en `src/electron/main.ts` línea 78 | ❌ NO |
| `electron-main/src/preload/index.ts` | ❌ NO — huérfano, no referenciado por `main.ts` | ✅ SÍ (pero nunca se carga) |

### Flujo de carga del preload (main.ts)

```ts
// src/electron/main.ts — línea 78
const preloadPath = join(__dirname, "preload.cjs"); // → dist/electron/preload.cjs
```

Vite compila `src/electron/preload.ts` → `dist/electron/preload.cjs`.  
El preload huérfano `electron-main/src/preload/index.ts` **nunca es compilado ni cargado por Electron**.

### Consecuencia

Cuando el renderer llama a `window.modelsApi.getModels()` (vía `src/renderer/services/models-api.ts`), el objeto es `undefined`. El servicio detecta esto y retorna inmediatamente:

```ts
// src/renderer/services/models-api.ts — línea 76-83
if (!bridge) {
  return {
    ok: false,
    status: "unavailable",
    error: "window.modelsApi is not available. Ensure the preload script is loaded.",
  };
}
```

El IPC handler `models-api:get-models` en el main process **nunca es invocado**, por lo que la descarga y el caché de `models.dev.json` nunca ocurren.

---

## 🔍 Archivos Involucrados

| Archivo | Rol |
|---|---|
| `src/electron/preload.ts` | ✏️ **MODIFICAR** — agregar exposición de `window.modelsApi` |
| `src/electron/main.ts` | 📖 Referencia — carga `preload.cjs` compilado desde `preload.ts` |
| `src/electron/ipc-handlers.ts` | ✏️ **MODIFICAR** — registrar handler + agregar logs de error |
| `src/electron/bridge.types.ts` | ✏️ **MODIFICAR** — agregar tipos de `modelsApi` al contrato global |
| `electron-main/src/preload/index.ts` | 🗑️ **ELIMINAR o CONSOLIDAR** — preload huérfano |
| `electron-main/src/ipc/models-api.ts` | 📖 Referencia — handler IPC ya implementado |
| `electron-main/src/fs/models-api-cache.ts` | 📖 Referencia — lógica de caché ya implementada |
| `src/renderer/services/models-api.ts` | 📖 Sin cambios — ya consume `window.modelsApi` correctamente |

---

## 🚀 Tareas de Implementación

---

### 🔹 Tarea 1 — Agregar `window.modelsApi` al preload activo

**Archivo:** `src/electron/preload.ts`

#### Paso 1.1 — Agregar imports necesarios

Al inicio del archivo, junto a los imports existentes de `electron`, agregar el import del canal IPC:

```ts
// Agregar después de: import { IPC_CHANNELS } from "./bridge.types.ts";
import { MODELS_API_CHANNELS } from "../../electron-main/src/ipc/models-api.ts";
import type { ModelsApiResult } from "../../electron-main/src/ipc/models-api.ts";
```

> **Alternativa sin import cross-boundary:** Si el equipo prefiere no importar desde `electron-main/` en `src/electron/`, definir el canal como literal inline:
> ```ts
> const MODELS_API_GET_MODELS = "models-api:get-models" as const;
> ```
> Y el tipo `ModelsApiResult` puede declararse localmente o importarse desde `src/renderer/services/models-api.ts` (que ya tiene `ModelsApiServiceResult` equivalente).

#### Paso 1.2 — Agregar la exposición del bridge

Al final del archivo `src/electron/preload.ts`, **después** del bloque `window.appPaths` (línea 712), agregar:

```ts
// ── window.modelsApi — Models.dev API bridge ──────────────────────────────
//
// Exposes getModels() so the renderer can request models.dev/api.json data
// through the main process (which handles caching, download, and fallback).
//
// IPC channel: "models-api:get-models"
// Handler:     electron-main/src/ipc/models-api.ts → handleGetModels()
// Cache:       electron-main/src/fs/models-api-cache.ts
//
// The renderer consumes this via:
//   src/renderer/services/models-api.ts → getModels()
//
// Gotcha: contextBridge.exposeInMainWorld() can only be called once per key.
// This MUST live in this single preload — not in a separate file.

contextBridge.exposeInMainWorld("modelsApi", {
  /**
   * Fetches models.dev/api.json with caching and fallback.
   * Returns ModelsApiResult: { ok, status, data, error? }
   * Status values: "fresh" | "downloaded" | "fallback" | "unavailable"
   */
  getModels(): Promise<ModelsApiResult> {
    return ipcRenderer.invoke(
      "models-api:get-models",
    ) as Promise<ModelsApiResult>;
  },
});

console.log("[preload] window.modelsApi exposed — channel: models-api:get-models");
```

---

### 🔹 Tarea 2 — Agregar tipos de `window.modelsApi` a `bridge.types.ts`

**Archivo:** `src/electron/bridge.types.ts`

Agregar la declaración global de `window.modelsApi` para que el renderer tenga tipos completos sin cast:

```ts
// Agregar al bloque `declare global { interface Window { ... } }` existente

/**
 * Models API bridge — exposes getModels() for the renderer.
 * Returns the models.dev/api.json data with caching and fallback.
 * Exposed by src/electron/preload.ts via contextBridge.
 */
modelsApi: {
  getModels(): Promise<{
    ok: boolean;
    status: "fresh" | "downloaded" | "fallback" | "unavailable";
    data: unknown | null;
    error?: string;
  }>;
};
```

> **Nota:** Si `bridge.types.ts` no tiene un bloque `declare global`, agregar uno al final del archivo.

---

### 🔹 Tarea 3 — Registrar el handler IPC en el main process

**Archivo:** `src/electron/ipc-handlers.ts`

El handler `handleGetModels` ya existe en `electron-main/src/ipc/models-api.ts`, pero debe ser **registrado** en el main process activo.

#### Paso 3.1 — Agregar import

```ts
// En src/electron/ipc-handlers.ts, junto a los imports existentes:
import {
  registerModelsApiHandlers,
} from "../../electron-main/src/ipc/models-api.ts";
```

#### Paso 3.2 — Registrar el handler

Dentro de la función `registerIpcHandlers` (o equivalente), agregar:

```ts
// Registrar handlers de Models API
registerModelsApiHandlers(ipcMain);
```

#### Paso 3.3 — Agregar logs de error explícitos en el handler

**Archivo:** `electron-main/src/ipc/models-api.ts`

En la función `handleGetModels`, mejorar los bloques `catch` con logs explícitos para facilitar el diagnóstico en producción:

```ts
// En el catch del downloadErr (línea ~138):
} catch (downloadErr) {
  _downloadInProgress = null;
  const errorMsg =
    downloadErr instanceof Error ? downloadErr.message : String(downloadErr);

  // ── AGREGAR: log explícito de error de descarga ──
  console.error(
    "[models-api] Download failed for",
    MODELS_DEV_URL,
    "→",
    errorMsg,
  );

  const fallbackData = await readCacheFile(filePath);
  if (fallbackData !== null) {
    console.warn("[models-api] Using fallback cache from:", filePath);
    return { ok: true, status: "fallback", data: fallbackData, error: errorMsg };
  }

  console.error("[models-api] No cache available — returning unavailable");
  return { ok: false, status: "unavailable", data: null, error: errorMsg };
}

// En el catch del unexpectedErr (línea ~162):
} catch (unexpectedErr) {
  const errorMsg =
    unexpectedErr instanceof Error
      ? unexpectedErr.message
      : String(unexpectedErr);

  // ── AGREGAR: log explícito de error inesperado ──
  console.error("[models-api] Unexpected error in handleGetModels:", errorMsg);

  return { ok: false, status: "unavailable", data: null, error: errorMsg };
}
```

---

### 🔹 Tarea 4 — Eliminar o consolidar el preload huérfano

**Archivo:** `electron-main/src/preload/index.ts`

Este archivo **nunca es cargado por Electron** porque `main.ts` apunta exclusivamente a `src/electron/preload.ts`. Su existencia crea confusión y riesgo de divergencia.

#### Opción A (Recomendada): Eliminar el archivo

```bash
rm electron-main/src/preload/index.ts
```

Verificar que ningún otro archivo lo importe:
```bash
rg "electron-main/src/preload" --type ts
```

Si hay imports, actualizarlos para apuntar a los módulos correctos.

#### Opción B: Agregar comentario de deprecación

Si por alguna razón no se puede eliminar inmediatamente, agregar al inicio del archivo:

```ts
/**
 * @deprecated Este preload NO es cargado por Electron.
 * El preload activo es src/electron/preload.ts.
 * Este archivo está pendiente de eliminación.
 * Ver: ai_docs/models_api/fix_preload_models_bridge_spec.md
 */
```

---

### 🔹 Tarea 5 (Opcional) — Mejorar el path de guardado en producción

**Archivo:** `electron-main/src/fs/models-api-cache.ts`

Actualmente `getCacheFilePath()` usa `import.meta.dirname` relativo, lo que puede fallar en producción cuando la app está empaquetada con electron-builder (el `__dirname` apunta dentro del `.asar`).

#### Mejora recomendada: usar `app.getPath('userData')`

```ts
// electron-main/src/fs/models-api-cache.ts

import { app } from "electron";

export function getCacheFilePath(): string {
  // 1. Env var override (dev / CI)
  const agentsHome = process.env["AGENTS_HOME"];
  if (agentsHome) {
    return join(agentsHome, "models", "api", "models.dev.json");
  }

  // 2. Producción y desarrollo sin AGENTS_HOME:
  //    app.getPath('userData') → ~/.config/AgentsFlow (Linux)
  //                            → ~/Library/Application Support/AgentsFlow (macOS)
  //                            → %APPDATA%\AgentsFlow (Windows)
  //    Siempre es escribible, sobrevive actualizaciones de la app,
  //    y no está dentro del .asar (que es read-only en producción).
  try {
    return join(app.getPath("userData"), "models", "api", "models.dev.json");
  } catch {
    // Fallback si app no está lista aún (tests unitarios sin Electron)
    return join(import.meta.dirname, "..", "..", "..", "..", "models", "api", "models.dev.json");
  }
}
```

> **Gotcha:** `app.getPath('userData')` solo está disponible después de que Electron emite el evento `ready`. Si `getCacheFilePath()` se llama antes de `app.ready`, lanzará. El `try/catch` anterior lo maneja con fallback.

> **Impacto en tests:** Los tests unitarios de `models-api-cache.test.ts` mockean `getCacheFilePath` vía inyección de dependencias (`ModelsApiDeps`), por lo que este cambio no rompe los tests existentes.

---

## ✅ Criterios de Validación

### Validación en DevTools (renderer)

Abrir DevTools en la ventana de Electron y ejecutar en la consola:

```js
// Debe retornar el objeto bridge, NO undefined
console.log(typeof window.modelsApi);          // → "object"
console.log(typeof window.modelsApi.getModels); // → "function"

// Invocar el flujo completo
window.modelsApi.getModels().then(r => console.log(r));
// Esperado: { ok: true, status: "fresh"|"downloaded", data: {...} }
```

### Validación en logs del main process

Al arrancar la app, verificar en la terminal:

```
[preload] module evaluated — contextIsolation:true, nodeIntegration:false, sandbox:false
[preload] window.agentsFlow exposed — all IPC channels ready
[preload] window.modelsApi exposed — channel: models-api:get-models   ← NUEVO
[preload] window.appPaths exposed — home: /home/...
```

### Validación del flujo de descarga

1. Eliminar el caché: `rm -rf models/api/models.dev.json` (o el path de `userData`)
2. Reiniciar la app
3. En DevTools: `window.modelsApi.getModels()` debe retornar `status: "downloaded"`
4. Verificar que el archivo fue creado en el path correcto

### Validación de que el preload huérfano no interfiere

```bash
rg "electron-main/src/preload" --type ts
# No debe haber resultados (o solo el archivo mismo si aún no fue eliminado)
```

---

## ⚠️ Riesgos y Consideraciones

| Riesgo | Mitigación |
|---|---|
| `contextBridge.exposeInMainWorld("modelsApi", ...)` ya fue llamado en otro lugar | Buscar con `rg "exposeInMainWorld.*modelsApi"` — solo debe existir en `src/electron/preload.ts` |
| Import circular entre `src/electron/` y `electron-main/src/` | Si el equipo prefiere evitar imports cross-boundary, definir el canal como string literal inline |
| `app.getPath('userData')` lanza antes de `app.ready` | Cubierto por el `try/catch` en la Tarea 5 |
| Tests de `models-api-cache.test.ts` rompen con el cambio de path | Los tests usan `ModelsApiDeps` para inyectar `getCacheFilePath` — no se ven afectados |
| El preload huérfano tiene tipos que el renderer usa | Verificar con `rg "electron-main/src/preload"` antes de eliminar |

---

## 📝 Notas Adicionales

- El handler IPC `handleGetModels` en `electron-main/src/ipc/models-api.ts` ya está correctamente implementado con lógica de caché, descarga y fallback. **No requiere cambios funcionales**, solo los logs de error de la Tarea 3.
- El servicio del renderer `src/renderer/services/models-api.ts` ya está correctamente implementado con timeout de 30s y manejo de errores. **No requiere cambios**.
- La Tarea 5 (path de `userData`) es **opcional pero recomendada** para producción. Puede implementarse en un PR separado si se prefiere mantener el scope del fix acotado.
- Tras el fix, el flujo completo es:
  ```
  Renderer → window.modelsApi.getModels()
           → ipcRenderer.invoke("models-api:get-models")
           → [main] handleGetModels()
           → [main] getCacheFilePath() → isCacheStale() → downloadAndSave() / readCacheFile()
           → ModelsApiResult { ok, status, data }
           → Renderer recibe datos de models.dev
  ```

---

## 🔗 Referencias

- Preload activo: `src/electron/preload.ts`
- Main process: `src/electron/main.ts` (línea 78 — `preloadPath`)
- Handler IPC: `electron-main/src/ipc/models-api.ts`
- Caché FS: `electron-main/src/fs/models-api-cache.ts`
- Servicio renderer: `src/renderer/services/models-api.ts`
- Preload huérfano: `electron-main/src/preload/index.ts`
