# 🔍 Diagnóstico: Diálogo de Selección de Directorio — Clone from Git

> **Fecha:** 2026-04-25  
> **Agente:** Weight-Planner  
> **Objetivo:** Documentar el flujo completo del diálogo de selección de carpeta destino al clonar un repo desde Git, identificar el bug y proponer solución.

---

## 1. 🗺️ Flujo Completo del Diálogo

### 1.1 Punto de entrada — Renderer (UI)

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

El modal de clonación tiene un botón "Choose Folder" que dispara `handleChooseDir`:

```tsx
// Líneas 387–396
const handleChooseDir = useCallback(async () => {
    try {
        const bridge = getBridge();
        if (!bridge?.openFolderDialog) return;   // ← GUARD SILENCIOSO
        const dir = await bridge.openFolderDialog();
        if (dir) setSelectedDir(dir);
    } catch {
        // No-op — picker was cancelled or bridge unavailable
    }
}, []);
```

El botón en el JSX (líneas 735–742):

```tsx
<button
    type="button"
    className="btn btn--secondary form-field__dir-btn"
    onClick={handleChooseDir}
    disabled={isCloning || isCheckingVisibility}
>
    Choose Folder
</button>
```

### 1.2 Bridge helper — `getBridge()`

**Archivo:** `src/ui/components/CloneFromGitModal.tsx` (líneas 78–102)

```ts
function getBridge() {
    try {
        return (window as unknown as {
            agentsFlow?: {
                openFolderDialog?: () => Promise<string | null>;
                // ... otros métodos
            };
        }).agentsFlow;
    } catch {
        return undefined;
    }
}
```

El modal accede a `window.agentsFlow.openFolderDialog()` — **NO** usa `window.folderExplorer`.

### 1.3 Preload — Exposición del bridge

**Archivo:** `src/electron/preload.ts` (líneas 131–133)

```ts
const bridge: AgentsFlowBridge = {
    openFolderDialog() {
        return ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER_DIALOG);
    },
    // ...
};
contextBridge.exposeInMainWorld("agentsFlow", bridge);
```

### 1.4 IPC Channel — Handler en Main Process

**Archivo:** `src/electron/ipc-handlers.ts` (líneas 643–664)

```ts
ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
        title: "Open AgentFlow Project",
        properties: ["openDirectory", "createDirectory"],
    };
    const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
});
```

---

## 2. 🧩 Arquitectura del Sistema de Diálogos

```
CloneFromGitModal.tsx
    │
    ├── getBridge()  →  window.agentsFlow
    │       │
    │       └── openFolderDialog()
    │               │
    │               └── ipcRenderer.invoke("OPEN_FOLDER_DIALOG")
    │                           │
    │                           └── [IPC Bridge]
    │                                   │
    │                                   └── ipcMain.handle("OPEN_FOLDER_DIALOG")
    │                                               │
    │                                               └── dialog.showOpenDialog(win, opts)
    │                                                           │
    │                                                           └── Electron Native Dialog
    │
    └── setSelectedDir(dir)  ← resultado devuelto al renderer
```

**Sistema paralelo (FolderExplorer — NO usado por CloneFromGitModal):**

```
FolderExplorer.tsx
    │
    └── useFolderExplorer hook
            │
            └── listFolder() [src/renderer/services/ipc.ts]
                    │
                    └── window.folderExplorer.list(path, options)
                            │
                            └── ipcRenderer.invoke("folder-explorer:list", { path, options })
                                        │
                                        └── registerFolderExplorerHandlers()
                                                    │
                                                    └── electron-main/src/ipc/folder-explorer.ts
```

---

## 3. 🐛 Bug Identificado: Diálogo se Despliega pero No Responde

### 3.1 Causa Raíz — Ventana Modal Bloqueante

El handler de `OPEN_FOLDER_DIALOG` usa:

```ts
const win = BrowserWindow.fromWebContents(event.sender);
const result = win
    ? await dialog.showOpenDialog(win, opts)   // ← PROBLEMA AQUÍ
    : await dialog.showOpenDialog(opts);
```

**El problema:** `dialog.showOpenDialog(win, opts)` abre el diálogo **como hijo de la ventana `win`**. Si la ventana principal tiene un modal activo (el propio `CloneFromGitModal` renderizado en React), el diálogo nativo de Electron puede quedar **bloqueado detrás del modal de React** o en un estado donde el foco no puede alcanzarlo.

En Linux (GTK/X11/Wayland), este comportamiento es especialmente problemático:
- El diálogo nativo se abre pero el foco permanece en la ventana Electron.
- El usuario ve el diálogo pero no puede interactuar con él porque el modal de React captura todos los eventos de teclado/mouse.
- El diálogo aparece "congelado" o "no responsivo".

### 3.2 Causa Secundaria — Error Silencioso en `handleChooseDir`

```ts
const handleChooseDir = useCallback(async () => {
    try {
        const bridge = getBridge();
        if (!bridge?.openFolderDialog) return;  // ← Falla silenciosa si bridge no existe
        const dir = await bridge.openFolderDialog();
        if (dir) setSelectedDir(dir);
    } catch {
        // No-op — picker was cancelled or bridge unavailable  ← SILENCIA TODOS LOS ERRORES
    }
}, []);
```

**Todos los errores son silenciados.** Si `openFolderDialog()` lanza una excepción (por ejemplo, si el IPC falla, si el handler no está registrado, o si hay un error de serialización), el usuario no recibe ningún feedback. El diálogo simplemente no hace nada.

### 3.3 Causa Terciaria — Posible Regresión en el Handler

**Archivo:** `src/electron/ipc-handlers.ts` (líneas 643–664)

El handler de `OPEN_FOLDER_DIALOG` usa el título `"Open AgentFlow Project"` — un título genérico que no es contextual para el flujo de clonación. Esto sugiere que el handler fue diseñado para abrir proyectos existentes, **no para seleccionar un directorio destino de clonación**.

El handler correcto para seleccionar un directorio destino sería `SELECT_NEW_PROJECT_DIR` (líneas 694–720), que tiene:
- Título: `"Select folder for new project"`
- Botón: `"Choose Folder"`

Sin embargo, `CloneFromGitModal` llama a `openFolderDialog()` (que mapea a `OPEN_FOLDER_DIALOG`), no a `selectNewProjectDir()`.

### 3.4 Posible Regresión — Doble Preload

**Archivo:** `src/electron/preload.ts` (líneas 504–539)

El preload expone **dos bridges separados**:
1. `window.agentsFlow` — con `openFolderDialog()` (línea 131)
2. `window.folderExplorer` — con `list()`, `stat()`, `readChildren()` (línea 504)

El `CloneFromGitModal` usa `window.agentsFlow.openFolderDialog()` (diálogo nativo).  
El `FolderExplorer` component usa `window.folderExplorer.list()` (explorador in-app).

**Estos son dos sistemas completamente distintos.** El bug del diálogo que "se despliega pero no responde" afecta al diálogo nativo de Electron (`dialog.showOpenDialog`), no al componente `FolderExplorer`.

---

## 4. 🔎 Análisis de Regresiones por Capa

### 4.1 Handler (Main Process)

| Archivo | Línea | Estado | Observación |
|---------|-------|--------|-------------|
| `src/electron/ipc-handlers.ts` | 643–664 | ⚠️ Sospechoso | Usa `dialog.showOpenDialog(win, opts)` — puede bloquear en Linux con modal activo |
| `src/electron/ipc-handlers.ts` | 694–720 | ✅ OK | `SELECT_NEW_PROJECT_DIR` tiene el mismo patrón pero título correcto |

### 4.2 Preload

| Archivo | Línea | Estado | Observación |
|---------|-------|--------|-------------|
| `src/electron/preload.ts` | 131–133 | ✅ OK | `openFolderDialog()` invoca correctamente el canal |
| `src/electron/preload.ts` | 504–539 | ✅ OK | `window.folderExplorer` expuesto correctamente |

### 4.3 IPC Channel

| Canal | Registrado | Handler | Estado |
|-------|-----------|---------|--------|
| `OPEN_FOLDER_DIALOG` | ✅ Sí | `dialog.showOpenDialog` | ⚠️ Puede bloquearse en Linux |
| `folder-explorer:list` | ✅ Sí | `listDirectory()` | ✅ OK |
| `folder-explorer:stat` | ✅ Sí | `handleStat()` | ✅ OK |
| `folder-explorer:read-children` | ✅ Sí | `handleReadChildren()` | ✅ OK |

### 4.4 Renderer

| Archivo | Línea | Estado | Observación |
|---------|-------|--------|-------------|
| `CloneFromGitModal.tsx` | 387–396 | 🔴 Bug | Silencia todos los errores; no hay feedback al usuario |
| `CloneFromGitModal.tsx` | 78–102 | ⚠️ Frágil | `getBridge()` retorna `undefined` silenciosamente si bridge no existe |

---

## 5. 🔇 Errores Silenciosos y Promesas Sin Resolver

### 5.1 Error Silencioso #1 — `handleChooseDir`

```ts
} catch {
    // No-op — picker was cancelled or bridge unavailable
}
```

**Problema:** Cualquier error (IPC failure, handler no registrado, serialización fallida) es silenciado. El usuario ve el botón "Choose Folder" pero no pasa nada.

### 5.2 Error Silencioso #2 — `getBridge()` guard

```ts
if (!bridge?.openFolderDialog) return;
```

**Problema:** Si `window.agentsFlow` existe pero `openFolderDialog` no está definido (por ejemplo, si el preload fue actualizado pero no reconstruido), el handler retorna silenciosamente sin ningún log.

### 5.3 Promesa Potencialmente Sin Resolver — `dialog.showOpenDialog`

En Linux con Wayland, `dialog.showOpenDialog(win, opts)` puede quedar en un estado donde:
- La promesa nunca resuelve (el diálogo está abierto pero bloqueado).
- No hay timeout en el handler.
- El renderer queda esperando indefinidamente.

---

## 6. 💡 Solución Propuesta

### Opción A — Reemplazar el diálogo nativo por el FolderExplorer in-app (Recomendada)

**Motivación:** El componente `FolderExplorer` ya existe, está completamente implementado, y usa IPC asíncrono sin bloqueos. Elimina el problema del diálogo nativo en Linux.

**Cambios necesarios:**

1. **`CloneFromGitModal.tsx`** — Agregar estado `browseMode` y renderizar `FolderExplorer` inline:

```tsx
// Agregar import
import { FolderExplorer } from "../../renderer/components/FolderExplorer/FolderExplorer";

// Agregar estado
const [browseMode, setBrowseMode] = useState(false);

// Reemplazar handleChooseDir
const handleChooseDir = useCallback(() => {
    setBrowseMode(true);
}, []);

// En el JSX, reemplazar el bloque "Destination directory":
{browseMode ? (
    <div className="form-field">
        <FolderExplorer
            initialPath={selectedDir ?? getHomeDir()}
            style={{ height: 280 }}
            onSelect={(path) => setSelectedDir(path)}
        />
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button
                type="button"
                className="btn btn--primary"
                onClick={() => setBrowseMode(false)}
                disabled={!selectedDir}
            >
                Seleccionar carpeta
            </button>
            <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setBrowseMode(false)}
            >
                Cancelar
            </button>
        </div>
    </div>
) : (
    // ... bloque actual con el botón "Choose Folder"
)}
```

### Opción B — Corregir el handler nativo (Parche mínimo)

**Cambios necesarios:**

1. **`src/electron/ipc-handlers.ts`** — Abrir el diálogo sin parent window para evitar bloqueos:

```ts
ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async (_event) => {
    // No pasar `win` como parent — evita bloqueos en Linux/Wayland
    const result = await dialog.showOpenDialog({
        title: "Select Destination Folder",
        buttonLabel: "Choose Folder",
        properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
});
```

2. **`CloneFromGitModal.tsx`** — Agregar feedback de error al usuario:

```ts
const handleChooseDir = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.openFolderDialog) {
        console.error("[CloneFromGitModal] openFolderDialog not available on bridge");
        return;
    }
    try {
        const dir = await bridge.openFolderDialog();
        if (dir) setSelectedDir(dir);
    } catch (err) {
        console.error("[CloneFromGitModal] openFolderDialog failed:", err);
        // Opcional: mostrar error al usuario
    }
}, []);
```

---

## 7. 📋 Resumen del Diagnóstico

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| **Lanzamiento del diálogo** | ✅ Correcto | `handleChooseDir` → `bridge.openFolderDialog()` → IPC → `dialog.showOpenDialog` |
| **Causa del bloqueo** | 🔴 Bug | `dialog.showOpenDialog(win, opts)` con `win` como parent bloquea en Linux cuando hay un modal React activo |
| **Regresión en handler** | ⚠️ Sospechosa | Handler usa título genérico "Open AgentFlow Project" — no contextual para clonación |
| **Regresión en preload** | ✅ Sin regresión | Preload expone correctamente ambos bridges |
| **Regresión en IPC** | ✅ Sin regresión | Canales registrados correctamente |
| **Regresión en renderer** | 🔴 Bug | Errores silenciados en `catch {}` — sin feedback al usuario |
| **Errores silenciosos** | 🔴 Presentes | `catch {}` vacío + guard silencioso en `getBridge()` |
| **Promesas sin resolver** | ⚠️ Posible | `dialog.showOpenDialog` puede no resolver en Linux/Wayland |

---

## 8. 📁 Archivos Clave

| Archivo | Rol | Líneas Relevantes |
|---------|-----|-------------------|
| `src/ui/components/CloneFromGitModal.tsx` | Renderer — dispara el diálogo | 78–102, 387–396, 735–742 |
| `src/electron/preload.ts` | Bridge — expone `openFolderDialog` | 131–133, 478 |
| `src/electron/ipc-handlers.ts` | Main — handler nativo | 643–664 |
| `src/electron/bridge.types.ts` | Tipos del bridge | `IPC_CHANNELS.OPEN_FOLDER_DIALOG` |
| `src/renderer/components/FolderExplorer/FolderExplorer.tsx` | Componente alternativo | Completo |
| `src/renderer/hooks/useFolderExplorer.ts` | Hook del explorador | Completo |
| `src/renderer/services/ipc.ts` | Servicio IPC del explorador | `listFolder()` |
| `electron-main/src/ipc/folder-explorer.ts` | Handlers del explorador | `registerFolderExplorerHandlers()` |

---

## 9. ⚠️ Riesgos

- **Opción A** requiere integrar `FolderExplorer` dentro de `CloneFromGitModal`, lo que aumenta el tamaño del modal y puede requerir ajustes de CSS.
- **Opción B** (parche mínimo) puede no resolver el problema en todos los entornos Linux — Wayland tiene comportamientos distintos a X11.
- En ambas opciones, el `catch {}` vacío debe ser corregido para evitar bugs silenciosos futuros.

---

## 10. 📝 Notas Adicionales

- El componente `FolderExplorer` fue diseñado explícitamente para reemplazar diálogos nativos en contextos de modal (ver comentario en `FolderExplorer.tsx` líneas 43–77: "EXAMPLE INTEGRATION IN ExportModal").
- El sistema de `window.folderExplorer` (IPC asíncrono, sandboxed en HOME) es más robusto que `dialog.showOpenDialog` para uso dentro de modales React en Electron.
- La solución de largo plazo es migrar todos los selectores de directorio a `FolderExplorer` in-app.
