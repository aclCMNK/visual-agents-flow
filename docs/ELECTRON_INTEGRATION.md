# Electron + React Integration — AgentsFlow

This document describes the architecture and integration of the Electron shell with the React UI and the existing `ProjectLoader`.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Electron Process                       │
│                                                              │
│  ┌─────────────────────────┐    ┌────────────────────────┐  │
│  │     Main Process        │    │   Renderer Process     │  │
│  │  (Node.js / Electron)   │    │   (Chromium / React)   │  │
│  │                         │    │                        │  │
│  │  src/electron/main.ts   │    │  src/ui/               │  │
│  │  src/electron/          │    │    main.tsx             │  │
│  │    ipc-handlers.ts      │    │    App.tsx              │  │
│  │                         │◄──►│    components/         │  │
│  │  ProjectLoader          │IPC │    store/              │  │
│  │  (src/loader/)          │    │    hooks/              │  │
│  │                         │    │                        │  │
│  └─────────────────────────┘    └────────────────────────┘  │
│          │                               │                   │
│  ┌───────▼──────────────────────────────▼───────────────┐   │
│  │               Preload Script                          │   │
│  │          src/electron/preload.ts                      │   │
│  │                                                       │   │
│  │  contextBridge.exposeInMainWorld("agentsFlow", ...)   │   │
│  │  window.agentsFlow → AgentsFlowBridge                 │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Security model:**
- `contextIsolation: true` — renderer code cannot access Node.js or Electron APIs directly
- `nodeIntegration: false` — no `require()` in the renderer
- The preload script is the only bridge between worlds
- `window.agentsFlow` is the only communication channel

---

## File Structure

```
src/
├── electron/                       # Main process (Node.js / Electron APIs)
│   ├── bridge.types.ts             # TypeScript contracts — shared by all layers
│   ├── main.ts                     # App entry: BrowserWindow + lifecycle
│   ├── preload.ts                  # Context bridge (contextIsolation)
│   └── ipc-handlers.ts             # IPC handlers: calls ProjectLoader
│
├── loader/                         # Existing project loader (unchanged)
│   ├── index.ts
│   ├── project-loader.ts
│   ├── types.ts
│   └── ...
│
├── schemas/                        # Existing Zod schemas (unchanged)
│   ├── afproj.schema.ts
│   └── adata.schema.ts
│
└── ui/                             # Renderer process (React)
    ├── main.tsx                    # React entry point (mounts <App />)
    ├── App.tsx                     # Root component — view router
    ├── styles/
    │   └── app.css                 # Base styles (dark theme)
    ├── store/
    │   └── projectStore.ts         # Zustand store — calls window.agentsFlow
    ├── hooks/
    │   └── useElectronBridge.ts    # Hook to safely access window.agentsFlow
    └── components/
        ├── ProjectBrowser.tsx      # View: open/create project + recents
        └── ValidationPanel.tsx     # View: errors/warnings from loader
```

---

## IPC Channel Reference

All channels are defined in `src/electron/bridge.types.ts`:

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `project:open-folder-dialog` | — | `string \| null` | Opens native folder picker |
| `project:open-file-dialog` | `{ title?, filters? }` | `string \| null` | Opens native file picker |
| `project:load` | `LoadProjectRequest` | `BridgeLoadResult` | Loads project (mode: load) |
| `project:validate` | `ValidateProjectRequest` | `BridgeLoadResult` | Validates without loading (dry-run) |
| `project:save` | `SaveProjectRequest` | `SaveProjectResult` | Saves afproj changes to disk |
| `project:export` | `ExportProjectRequest` | `ExportProjectResult` | Exports full project as JSON |
| `project:get-recent` | — | `RecentProject[]` | Returns recently opened projects |

---

## Example: Open Project → Validate → Show in UI

This is the complete flow when a user clicks "Open Project Folder":

### 1. User clicks "Open Project Folder" (renderer)

```typescript
// src/ui/components/ProjectBrowser.tsx
<button onClick={openProjectDialog}>Open Project Folder</button>

// src/ui/store/projectStore.ts
async openProjectDialog() {
  const bridge = window.agentsFlow;
  const projectDir = await bridge.openFolderDialog();   // ← IPC call
  if (!projectDir) return;
  await get().openProject(projectDir);
}
```

### 2. Main process opens the folder dialog

```typescript
// src/electron/ipc-handlers.ts
ipcMain.handle("project:open-folder-dialog", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
```

### 3. Store calls loadProject with the returned path

```typescript
// src/ui/store/projectStore.ts
async openProject(projectDir) {
  set({ isLoading: true });
  const result = await window.agentsFlow.loadProject({ projectDir });
  
  if (result.success) {
    set({
      project: result.project,
      currentView: result.issues.length > 0 ? "validation" : "editor",
    });
  } else {
    set({ project: null, currentView: "validation" });
  }
}
```

### 4. Main process runs the ProjectLoader

```typescript
// src/electron/ipc-handlers.ts
ipcMain.handle("project:load", async (_event, req) => {
  const loader = new ProjectLoader(req.projectDir);
  const result = await loader.load({ mode: "load" });
  
  if (result.success && result.project) {
    await addToRecentProjects(req.projectDir, result.project.afproj.name);
  }
  
  return toBridgeLoadResult(result); // ← Map → plain object serialization
});
```

### 5. React renders the result

- If success with no issues → `AppView` = `"editor"` (canvas placeholder)
- If success with warnings → `AppView` = `"validation"` showing warnings
- If failure → `AppView` = `"validation"` showing errors

```tsx
// src/ui/App.tsx
{currentView === "browser"    && <ProjectBrowser />}
{currentView === "validation" && <ValidationPanel />}
{currentView === "editor"     && <EditorPlaceholder />}
```

---

## Validate-Only Flow (Dry-Run)

```typescript
// User clicks "Validate" on a recent project
await validateProject(recent.projectDir);

// Store calls:
const result = await window.agentsFlow.validateProject({ projectDir });
// Main process runs: loader.load({ mode: "dry-run", loadBehaviorFiles: false })
// Returns: issues[] + repairActions[] (no ProjectModel built)

// Store navigates to validation view:
set({ lastValidationResult: result, currentView: "validation" });
```

---

## Data Serialization

The `ProjectLoader` uses `Map<string, AgentModel>` internally. IPC channels cannot transport `Map` (structured clone drops them). The `ipc-handlers.ts` file handles serialization:

```typescript
// Map-based model (NOT serializable)
project.agents // Map<string, AgentModel>

// ↓ toBridgeLoadResult() converts to:

// Plain array (serializable)
bridgeResult.project.agents // SerializableAgentModel[]
```

The `bridge.types.ts` file defines the full IPC-safe type tree. **Never** try to pass `Map`, `Set`, class instances, or functions through IPC.

---

## Adding a New IPC Handler

1. **Define the types** in `src/electron/bridge.types.ts`:
   ```typescript
   export const IPC_CHANNELS = {
     MY_NEW_CHANNEL: "project:my-new",
     // ...
   };
   
   export interface MyNewRequest { ... }
   export interface MyNewResult { ... }
   ```

2. **Add to `AgentsFlowBridge`** in `bridge.types.ts`:
   ```typescript
   myNewOp(req: MyNewRequest): Promise<MyNewResult>;
   ```

3. **Expose in preload** (`src/electron/preload.ts`):
   ```typescript
   myNewOp(req) {
     return ipcRenderer.invoke(IPC_CHANNELS.MY_NEW_CHANNEL, req);
   },
   ```

4. **Register handler** (`src/electron/ipc-handlers.ts`):
   ```typescript
   ipcMain.handle(IPC_CHANNELS.MY_NEW_CHANNEL, async (_event, req: MyNewRequest) => {
     // ... implementation
     return result;
   });
   ```

5. **Use in React** via the store or directly:
   ```typescript
   const result = await window.agentsFlow.myNewOp(req);
   ```

---

## Development Workflow

```bash
# Start Electron + Vite dev server (renderer hot-reloads, main process hot-restarts)
bun run electron:dev

# Type check all files
bun run typecheck

# Run tests
bun test
```

---

## Production Build

```bash
# Build renderer (dist/ui/) + main/preload (dist/electron/) + package Electron app
bun run electron:build

# Output: dist/release/<platform>/AgentsFlow.<ext>
```

---

## Security Notes

1. **Never** relax `contextIsolation` — it is the primary defense against XSS → full system compromise.
2. **Never** expose raw `ipcRenderer` to the renderer via `contextBridge` — only expose typed functions.
3. The Content-Security-Policy in `main.ts` restricts script sources to `'self'` in production.
4. Navigation and `window.open` are blocked for external URLs (see `web-contents-created` handler in `main.ts`).
5. All file I/O happens in the main process — the renderer never touches the filesystem directly.
