# AgentsFlow — Integration Guide

Integration between the Electron backend and the React frontend via the IPC bridge.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Renderer Process (React)                               │
│                                                         │
│  App.tsx → ProjectBrowser / ValidationPanel /           │
│            EditorView                                   │
│      │                                                  │
│  projectStore.ts (Zustand)                              │
│      │                                                  │
│  window.agentsFlow (bridge)   ← exposed by preload.ts  │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC (contextBridge / ipcRenderer)
┌─────────────────────▼───────────────────────────────────┐
│  Main Process (Electron / Node.js)                      │
│                                                         │
│  ipc-handlers.ts                                        │
│      │                                                  │
│  ProjectLoader (src/loader/)                            │
│      │                                                  │
│  File system (.afproj, .adata, .md files)               │
└─────────────────────────────────────────────────────────┘
```

### Key files

| File | Role |
|------|------|
| `src/electron/main.ts` | Creates the BrowserWindow, registers CSP headers, calls `registerIpcHandlers()` |
| `src/electron/preload.ts` | Runs before renderer JS; exposes `window.agentsFlow` via `contextBridge` |
| `src/electron/bridge.types.ts` | Shared TypeScript contracts between main ↔ renderer |
| `src/electron/ipc-handlers.ts` | Main-process handlers; calls `ProjectLoader` and returns serialized results |
| `src/ui/store/projectStore.ts` | Zustand store; all async calls go through `getBridge()` |
| `src/ui/components/ProjectBrowser.tsx` | Landing view — open/validate project |
| `src/ui/components/ValidationPanel.tsx` | Error/warning report; repair action list |
| `src/ui/components/AgentCard.tsx` | Single agent card (sidebar) |
| `src/ui/components/ProjectSaveBar.tsx` | Inline name/description editing with save |
| `src/ui/App.tsx` | Root router — browser / validation / editor views |

---

## Security Model

| Property | Value | Why |
|----------|-------|-----|
| `contextIsolation` | `true` | Renderer cannot access Node.js APIs |
| `nodeIntegration` | `false` | No `require()` in renderer |
| `sandbox` | `false` | Preload needs Node access for IPC |
| `webSecurity` | `true` | No cross-origin relaxations |

All file system access happens **only in the main process** (`ipc-handlers.ts`).
The renderer is a stateless consumer — it never touches files directly.

---

## IPC Channels

Defined in `src/electron/bridge.types.ts`:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `project:open-folder-dialog` | renderer → main | Opens native folder picker; returns `string \| null` |
| `project:open-file-dialog` | renderer → main | Opens native file picker; returns `string \| null` |
| `project:load` | renderer → main | Loads project (mode: `load`); returns `BridgeLoadResult` |
| `project:validate` | renderer → main | Validates project (mode: `dry-run`); returns `BridgeLoadResult` |
| `project:repair` | renderer → main | Repairs + reloads (mode: `repair`); returns `BridgeLoadResult` |
| `project:save` | renderer → main | Saves name/description changes to `.afproj`; returns `SaveProjectResult` |
| `project:export` | renderer → main | Exports project as JSON archive; returns `ExportProjectResult` |
| `project:get-recent` | renderer → main | Returns `RecentProject[]` from `userData/recent-projects.json` |

---

## Complete Flow: Open → Validate → Show in UI

### 1. User clicks "Open Project Folder"

```
ProjectBrowser
  └─ calls: store.openProjectDialog()
       └─ getBridge().openFolderDialog()
            └─ IPC: project:open-folder-dialog
                 └─ dialog.showOpenDialog({ properties: ["openDirectory"] })
                      └─ returns: "/path/to/my-project" | null
```

### 2. Directory path is sent to the loader

```
store.openProject("/path/to/my-project")
  └─ getBridge().loadProject({ projectDir: "/path/to/my-project" })
       └─ IPC: project:load
            └─ new ProjectLoader("/path/to/my-project").load({ mode: "load" })
                 ├─ Step 1: Find .afproj file
                 ├─ Step 2: Validate .afproj (Zod schema)
                 ├─ Step 3: Discover + validate .adata files
                 ├─ Step 4: Cross-validate (refs, IDs, paths)
                 ├─ Step 5: Build ProjectModel
                 └─ returns: LoadResult
            └─ toBridgeLoadResult(result)   ← Map → plain object
            └─ addToRecentProjects(dir, name)
            └─ returns: BridgeLoadResult
```

### 3. Store updates and routes to the correct view

```
store receives BridgeLoadResult:
  ├─ success=true, no issues  → navigate("editor")
  ├─ success=true, has warnings → navigate("validation")
  └─ success=false (errors)   → navigate("validation") + lastError set
```

### 4. UI renders the result

**Validation view** (`ValidationPanel.tsx`):
- Shows error/warning/info badges with counts
- Shows repair action proposals (from dry-run)
- "Apply Repairs & Reload" → calls `store.repairAndReload(projectDir)`
  - Uses `project:repair` channel → `mode: "repair"` in loader
  - Auto-repairs are written to disk, project reloads

**Editor view** (`EditorView` in `App.tsx`):
- `ProjectSaveBar` → editable name/description → `project:save`
- `AgentCard` list in sidebar → click to inspect agent detail
- "Export JSON" → `project:export` → native save dialog in main

---

## Validation Flow (standalone)

```
ProjectBrowser "Validate" button
  └─ store.validateProject("/path/to/my-project")
       └─ getBridge().validateProject({ projectDir })
            └─ IPC: project:validate
                 └─ ProjectLoader.load({ mode: "dry-run", loadBehaviorFiles: false })
                      └─ returns: LoadResult (success always false, no ProjectModel)
            └─ returns: BridgeLoadResult
  └─ navigate("validation")
     └─ ValidationPanel shows:
          ├─ Issue list (errors, warnings, infos)
          └─ Repair proposals (applied: false — dry-run)
```

---

## Save Flow

```
ProjectSaveBar "Save" button
  └─ store.saveProject({ name: "New Name", description: "…" })
       └─ getBridge().saveProject({ projectDir, updates })
            └─ IPC: project:save
                 ├─ ProjectLoader.load({ mode: "load", loadBehaviorFiles: false })
                 ├─ Merge updates into afproj object
                 ├─ atomicWriteJson(afprojPath, updatedAfproj)
                 └─ returns: SaveProjectResult { success: true }
  └─ store optimistically updates project.name / project.description
```

---

## Export Flow

```
EditorView "Export JSON" button
  └─ store.exportProject()
       └─ getBridge().exportProject({ projectDir, destinationPath: "" })
            └─ IPC: project:export
                 ├─ ProjectLoader.load({ mode: "load" })
                 ├─ dialog.showSaveDialog() → user picks output path
                 ├─ serializeProjectModel(project) → plain JSON
                 └─ atomicWriteJson(outputPath, archive)
            └─ returns: ExportProjectResult { success: true, exportedPath: "…" }
```

---

## Adding a New IPC Operation

1. **Define the channel** in `IPC_CHANNELS` inside `bridge.types.ts`.
2. **Add the type** for request and response in `bridge.types.ts`.
3. **Add to `AgentsFlowBridge` interface** in `bridge.types.ts`.
4. **Expose in preload** (`preload.ts`): add `ipcRenderer.invoke(IPC_CHANNELS.MY_CHANNEL, req)`.
5. **Register handler** in `ipc-handlers.ts`: `ipcMain.handle(IPC_CHANNELS.MY_CHANNEL, ...)`.
6. **Call from the store** (`projectStore.ts`): `getBridge().myNewMethod(req)`.
7. **Update the stub** in `projectStore.ts` and `useElectronBridge.ts` to keep TypeScript happy in non-Electron environments.

---

## Project Directory Layout

```
<project-dir>/
├── <name>.afproj                    # Project manifest (JSON)
├── metadata/
│   └── <agentId>.adata              # Per-agent metadata (JSON)
├── behaviors/
│   └── <agentId>/
│       ├── profile.md               # Agent system prompt
│       └── <aspectId>.md            # Behavior aspect files
└── skills/
    └── <skillId>.md                 # Shared skill files
```

---

## Development

```bash
# Install dependencies
bun install

# Start Vite dev server + Electron
bun run electron:dev

# Type check only
bun run typecheck

# Run loader tests
bun test
```

### Environment Variables

| Variable | Set by | Purpose |
|----------|--------|---------|
| `NODE_ENV` | shell | `development` enables DevTools + relaxed CSP |
| `ELECTRON_DEV` | shell | Alternative dev flag (either one enables dev mode) |
| `VITE_DEV_SERVER_URL` | vite-plugin-electron | Auto-set; main process uses it to load renderer |
