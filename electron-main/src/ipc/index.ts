/**
 * electron-main/src/ipc/index.ts
 *
 * Barrel re-export for the IPC handlers in the `electron-main` module.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * Each IPC domain lives in its own file (folder-explorer.ts, …) to keep
 * concerns separated and to make each file independently testable without a
 * running Electron instance (handlers receive `ipcMain` as a parameter).
 *
 * This barrel provides:
 *   1. A single import point for the registration functions.
 *   2. Re-exports of channel-name constants and TypeScript types so that
 *      `preload.ts` and `bridge.types.ts` can share them without needing to
 *      know the internal file layout.
 *
 * ── Ordering convention ───────────────────────────────────────────────────
 * Add new domain modules in ALPHABETICAL order inside each section.
 * This makes it easy to spot duplicates and avoids merge conflicts.
 *
 * ── Adding a new IPC domain ───────────────────────────────────────────────
 * 1. Create `electron-main/src/ipc/<domain>.ts`.
 * 2. Export a `register<Domain>Handlers(ipcMain: IpcMain): void` function.
 * 3. Export any channel-name constants and types you need in preload/renderer.
 * 4. Add the `export * from "./<domain>.ts"` line below (alphabetical order).
 * 5. Call `register<Domain>Handlers(ipcMain)` inside `registerIpcHandlers()`
 *    in `src/electron/ipc-handlers.ts`.
 *
 * ── Conflict risks ────────────────────────────────────────────────────────
 * ⚠️  Channel names must be globally unique across ALL domains.
 *     The prefix convention (`folder-explorer:*`, `asset:*`, etc.) prevents
 *     accidental collisions. Always use a domain prefix in new channels.
 *
 * ⚠️  ipcMain.handle() throws if the same channel is registered twice without
 *     a prior ipcMain.removeHandler(). The idempotency guard at the top of
 *     `registerIpcHandlers()` in `ipc-handlers.ts` covers channels declared
 *     in `IPC_CHANNELS` (bridge.types.ts). Channels declared ONLY in this
 *     module (FOLDER_EXPLORER_CHANNELS) must be removed separately — see the
 *     comment inside `registerIpcHandlers()`.
 */

// ── Folder Explorer ─────────────────────────────────────────────────────────
export {
  registerFolderExplorerHandlers,
  FOLDER_EXPLORER_CHANNELS,
} from "./folder-explorer.ts";

// ── Models API ───────────────────────────────────────────────────────────────
export {
  registerModelsApiHandlers,
  MODELS_API_CHANNELS,
} from "./models-api.ts";
export type { ModelsApiStatus, ModelsApiResult } from "./models-api.ts";

// ── OpenCode Models ──────────────────────────────────────────────────────────
export {
  registerOpencodeModelsHandlers,
  OPENCODE_MODELS_CHANNELS,
  parseOpencodeModelsOutput,
  runOpencodeModels,
} from "./opencode-models.ts";
export type {
  OpencodeModelsResult,
  OpencodeModelsDeps,
} from "./opencode-models.ts";

// ── Re-export types so consumers import from a single place ─────────────────
// (Adding `export type` keeps them tree-shakeable and avoids value-import overhead.)
export type {
  DirEntry,
  PathStat,
  FolderExplorerErrorCode,
  FolderExplorerError,
  ListResult,
  StatResult,
  ReadChildrenResult,
  MkdirResult,
  ListResponse,
  StatResponse,
  ReadChildrenResponse,
  MkdirResponse,
} from "./folder-explorer.ts";
