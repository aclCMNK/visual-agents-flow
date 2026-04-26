# 🐛 Bug Report: `getBridge(...).mkdir is not a function`

**Fecha:** 2026-04-26  
**Severidad:** Alta — bloquea la creación de directorios desde el FileExplorer  
**Componente afectado:** `window.folderExplorer` bridge (preload → renderer)

---

## 🎯 Resumen del Bug

Al intentar crear un directorio desde el FileExplorer, el renderer lanza:

```
TypeError: getBridge(...).mkdir is not a function
```

La causa raíz es una **discrepancia entre dos preloads coexistentes**: el preload activo en producción/dev (`src/electron/preload.ts`) expone `window.folderExplorer` **sin el método `mkdir`**, mientras que el preload nuevo (`electron-main/src/preload/index.ts`) sí lo incluye pero **no es el que Electron carga**.

---

## 🗺️ Flujo Real del Sistema

```
Renderer (React)
  └─ useFolderExplorer.ts → createDir(name)
       └─ ipc.ts → createDirectory(parentPath, name)
            └─ getBridge()!.mkdir(parentPath, name)   ← FALLA AQUÍ
                 └─ window.folderExplorer.mkdir(...)
                      └─ [NO EXISTE en el preload activo]
```

### Cadena IPC completa (cuando funciona correctamente)

```
Renderer
  window.folderExplorer.mkdir(parentPath, name)
    → ipcRenderer.invoke("folder-explorer:mkdir", { parentPath, name })
      → Main Process: ipcMain.handle("folder-explorer:mkdir", handleMkdir)
        → resolveWithinHome(parentPath)  [homeJail.ts]
        → fs.mkdir(newDirPath, { recursive: false })
        → return { ok: true, createdPath }
```

---

## 🔍 Análisis Detallado por Punto de Verificación

### ✅ 1. `electron-main/src/preload/index.ts` — Preload NUEVO (correcto pero inactivo)

**Ruta:** `electron-main/src/preload/index.ts`

```typescript
// ✅ Importa MkdirResponse
import type { MkdirResponse } from "../ipc/folder-explorer.ts";

// ✅ Declara mkdir en la interfaz
export interface FolderExplorerBridge {
  list(...): Promise<ListResponse>;
  stat(...): Promise<StatResponse>;
  readChildren(...): Promise<ReadChildrenResponse>;
  mkdir(parentPath: string, name: string): Promise<MkdirResponse>;  // ← PRESENTE
}

// ✅ Implementa mkdir en el objeto bridge
const folderExplorerBridge: FolderExplorerBridge = {
  // ...
  mkdir(parentPath: string, name: string): Promise<MkdirResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.MKDIR,
      { parentPath, name },
    ) as Promise<MkdirResponse>;
  },
};

// ✅ Lo expone correctamente
contextBridge.exposeInMainWorld("folderExplorer", folderExplorerBridge);
```

**Estado:** ✅ Correcto — pero **este archivo NO es el preload que Electron carga**.

---

### ❌ 2. `src/electron/preload.ts` — Preload ACTIVO (el que Electron realmente usa)

**Ruta:** `src/electron/preload.ts`  
**Cargado por:** `src/electron/main.ts` → `join(__dirname, "preload.cjs")`

```typescript
// ❌ window.folderExplorer expuesto SIN mkdir
contextBridge.exposeInMainWorld("folderExplorer", {
  list(path: string, options?: Record<string, unknown>) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_LIST, { path, options });
  },
  stat(path: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_STAT, { path });
  },
  readChildren(paths: string[], options?: Record<string, unknown>) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_READ_CHILDREN, { paths, options });
  },
  // ❌ mkdir AUSENTE — no fue añadido cuando se implementó la feature
});
```

**Estado:** ❌ **BUG CONFIRMADO** — `mkdir` no está expuesto en el preload activo.

---

### ✅ 3. Handler `folder-explorer:mkdir` en el Main Process

**Ruta:** `electron-main/src/ipc/folder-explorer.ts` (líneas 660–730)  
**Registrado en:** `src/electron/ipc-handlers.ts` → `registerFolderExplorerHandlers(ipcMain)`

```typescript
// ✅ Handler implementado correctamente
async function handleMkdir(
  _event: Electron.IpcMainInvokeEvent,
  payload: { parentPath: string; name: string },
): Promise<MkdirResponse> { ... }

// ✅ Registrado en registerFolderExplorerHandlers
export function registerFolderExplorerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.LIST,          handleList);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.STAT,          handleStat);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.READ_CHILDREN, handleReadChildren);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.MKDIR,         handleMkdir);  // ✅
}
```

**Estado:** ✅ El handler existe y está registrado. El problema es que el renderer nunca llega a invocarlo porque el bridge no tiene `mkdir`.

---

### ✅ 4. Tipado en el Renderer

**Ruta:** `src/renderer/services/ipc.ts`

```typescript
// ✅ Interfaz local del bridge incluye mkdir
interface _FolderExplorerBridge {
  list(...): Promise<_BridgeListResponse>;
  stat(...): Promise<_BridgeStatResponse>;
  readChildren(...): Promise<_BridgeReadChildrenResponse>;
  mkdir(parentPath: string, name: string): Promise<_BridgeMkdirResponse>;  // ✅
}

// ✅ createDirectory llama a getBridge()!.mkdir(...)
export async function createDirectory(
  parentPath: string,
  name: string,
): Promise<CreateDirectoryResult> {
  if (!hasBridge()) {
    return { ok: false, error: bridgeError() };
  }
  const raw = await callWithTimeout(
    getBridge()!.mkdir(parentPath, name),  // ← FALLA en runtime
  );
  ...
}
```

**Estado:** ✅ Los tipos son correctos. El error es en runtime, no en compilación, porque TypeScript confía en la declaración de tipo pero el objeto real en `window.folderExplorer` no tiene `mkdir`.

---

### ⚠️ 5. Diagnóstico en `main.ts` — Incompleto

**Ruta:** `src/electron/main.ts` (líneas 151–214)

El diagnóstico `did-finish-load` verifica `list`, `stat`, `readChildren` pero **no verifica `mkdir`**:

```typescript
// ⚠️ El diagnóstico no detecta la ausencia de mkdir
return {
  folderExplorer: {
    available: typeof fe !== 'undefined',
    list:          typeof fe?.list === 'function',
    stat:          typeof fe?.stat === 'function',
    readChildren:  typeof fe?.readChildren === 'function',
    // ❌ mkdir no está en el diagnóstico
  },
  ...
};
```

---

## 🧩 Diagrama de la Discrepancia

```
src/electron/main.ts
  └─ preloadPath = join(__dirname, "preload.cjs")
       └─ compilado desde: src/electron/preload.ts   ← ACTIVO
            └─ window.folderExplorer = { list, stat, readChildren }
                                                      ← SIN mkdir ❌

electron-main/src/preload/index.ts                   ← INACTIVO (no cargado)
  └─ window.folderExplorer = { list, stat, readChildren, mkdir }
                                                      ← CON mkdir ✅
```

---

## 🚀 Plan de Solución

### Opción A — Fix Mínimo (Recomendada) ⭐

**Añadir `mkdir` al preload activo** (`src/electron/preload.ts`).

Es el cambio más pequeño, más seguro y más rápido. No requiere cambiar la arquitectura de build.

**Cambio en `src/electron/preload.ts`** (después de `readChildren`, antes del cierre del objeto):

```typescript
contextBridge.exposeInMainWorld("folderExplorer", {
  list(path: string, options?: Record<string, unknown>) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_LIST, { path, options });
  },
  stat(path: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_STAT, { path });
  },
  readChildren(paths: string[], options?: Record<string, unknown>) {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_READ_CHILDREN, { paths, options });
  },
  // ✅ AÑADIR ESTO:
  mkdir(parentPath: string, name: string) {
    return ipcRenderer.invoke(FOLDER_EXPLORER_CHANNELS.MKDIR, { parentPath, name });
  },
});
```

> **Nota:** `FOLDER_EXPLORER_CHANNELS.MKDIR` = `"folder-explorer:mkdir"` — importar desde `../../electron-main/src/ipc/folder-explorer.ts` o usar el string literal directamente.

**También actualizar el diagnóstico en `main.ts`:**

```typescript
return {
  folderExplorer: {
    available:    typeof fe !== 'undefined',
    list:         typeof fe?.list === 'function',
    stat:         typeof fe?.stat === 'function',
    readChildren: typeof fe?.readChildren === 'function',
    mkdir:        typeof fe?.mkdir === 'function',  // ✅ AÑADIR
  },
  ...
};
```

---

### Opción B — Consolidación Arquitectural (Largo Plazo)

Eliminar la duplicación de preloads consolidando todo en `electron-main/src/preload/index.ts` y actualizando `vite.config.ts` para que ese sea el preload compilado.

**Requiere:**
1. Mover la lógica de `window.agentsFlow` y `window.appPaths` a `electron-main/src/preload/index.ts`
2. Actualizar `vite.config.ts` → `preload.input` para apuntar al nuevo archivo
3. Actualizar `main.ts` → `preloadPath` si cambia el nombre de salida
4. Eliminar `src/electron/preload.ts` (o dejarlo como stub vacío)

> ⚠️ Esta opción tiene mayor riesgo de regresión y requiere más testing. No es necesaria para el fix inmediato.

---

## ⚠️ Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Olvidar reiniciar Electron tras el fix | Alta | Siempre hacer full rebuild + restart en cambios de preload |
| El canal IPC `FOLDER_EXPLORER_CHANNELS.MKDIR` no está en `IPC_CHANNELS` de `bridge.types.ts` | Confirmado | Usar el import de `electron-main/src/ipc/folder-explorer.ts` o el string literal `"folder-explorer:mkdir"` |
| Diagnóstico en `main.ts` no detecta el problema | Confirmado | Añadir `mkdir` al scan de `did-finish-load` |

---

## 📝 Archivos Clave

| Archivo | Rol | Estado |
|---------|-----|--------|
| `src/electron/preload.ts` | Preload activo (compilado como `preload.cjs`) | ❌ Falta `mkdir` |
| `electron-main/src/preload/index.ts` | Preload nuevo (no cargado por Electron) | ✅ Tiene `mkdir` |
| `electron-main/src/ipc/folder-explorer.ts` | Handler `handleMkdir` + `FOLDER_EXPLORER_CHANNELS.MKDIR` | ✅ Correcto |
| `src/electron/ipc-handlers.ts` | Registra `registerFolderExplorerHandlers(ipcMain)` | ✅ Correcto |
| `src/renderer/services/ipc.ts` | `createDirectory()` → `getBridge()!.mkdir()` | ✅ Correcto |
| `src/renderer/hooks/useFolderExplorer.ts` | `createDir(name)` → `createDirectory(cwd, name)` | ✅ Correcto |
| `src/electron/main.ts` | Carga `preload.cjs`, diagnóstico `did-finish-load` | ⚠️ Diagnóstico incompleto |

---

## ✅ Verificación Post-Fix

Después de aplicar el fix y reiniciar Electron, verificar en DevTools:

```javascript
// En la consola del renderer:
typeof window.folderExplorer.mkdir  // debe ser "function"

// En la consola de main (did-finish-load):
// [main] renderer bridge scan: { folderExplorer: { mkdir: true, ... } }
```
