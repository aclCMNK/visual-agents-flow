/**
 * src/ui/store/assetStore.ts
 *
 * Zustand store for the Assets panel.
 *
 * State model:
 *   - projectRoot: the root directory being browsed (= project.projectDir from projectStore)
 *   - selectedDir: the directory whose contents are shown in the right panel
 *   - dirTree: top-level directory entries (sidebar tree)
 *   - dirContents: files (.md) and subdirs of selectedDir
 *   - openTabs: list of open editor tabs (by file path)
 *   - activeTab: the currently active tab path
 *   - dirtyTabs: Set of tab paths with unsaved changes
 *   - tabContents: in-memory content for each open tab
 *
 * All filesystem operations go through window.agentsFlow (IPC bridge).
 */

import { create } from "zustand";
import type { AssetDirEntry, AssetDirContents, AssetFileEntry } from "../../electron/bridge.types.ts";

// ── Bridge accessor ───────────────────────────────────────────────────────

function getBridge() {
  if (typeof window !== "undefined" && (window as unknown as { agentsFlow?: unknown }).agentsFlow) {
    return window.agentsFlow;
  }
  return null;
}

// ── Toast notification type ───────────────────────────────────────────────

export interface AssetToast {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}

// ── Editor tab ────────────────────────────────────────────────────────────

export interface AssetEditorTab {
  /** Absolute path — used as stable key */
  filePath: string;
  /** Display name (basename) */
  name: string;
  /** In-memory content (may differ from disk) */
  content: string;
  /** Whether the tab has unsaved changes */
  dirty: boolean;
  /** Active subpanel: "editor" or "preview" */
  panel: "editor" | "preview";
}

// ── Expanded dirs (for the sidebar tree) ─────────────────────────────────

type ExpandedSet = Set<string>;

// ── Store state ───────────────────────────────────────────────────────────

export interface AssetState {
  /** The project root being browsed. Set when user opens Assets panel. */
  projectRoot: string | null;

  /** Currently selected directory in the sidebar */
  selectedDir: string | null;

  /** Top-level child directories of projectRoot */
  topDirs: AssetDirEntry[];

  /** Children fetched per directory (keyed by absolute path) */
  childrenMap: Record<string, AssetDirEntry[]>;

  /** Set of expanded directory paths (sidebar) */
  expandedDirs: ExpandedSet;

  /** Files + subdirs for the selected directory */
  dirContents: AssetDirContents | null;

  /** Open editor tabs (ordered) */
  tabs: AssetEditorTab[];

  /** Currently active tab file path */
  activeTabPath: string | null;

  /** Loading / busy state */
  isLoading: boolean;

  /** Toast notifications queue */
  toasts: AssetToast[];
}

// ── Store actions ─────────────────────────────────────────────────────────

export interface AssetActions {
  /** Set the root directory to browse. Resets all state and loads top-level dirs. */
  initRoot(projectRoot: string): Promise<void>;

  /** Select a directory in the sidebar — loads its contents for the right panel. */
  selectDir(dirPath: string): Promise<void>;

  /** Toggle expanded state of a sidebar directory. Loads children if expanding. */
  toggleDir(dirPath: string): Promise<void>;

  /** Refresh the top-level dir list (after create/rename/delete). */
  refreshTopDirs(): Promise<void>;

  /** Refresh children of a specific dir. */
  refreshChildren(dirPath: string): Promise<void>;

  /** Refresh the currently selected directory's contents (right panel). */
  refreshDirContents(): Promise<void>;

  // ── Directory operations ──────────────────────────────────────────────

  /** Creates a new subdirectory inside parentDir. */
  createDir(parentDir: string, name: string): Promise<boolean>;

  /** Renames a directory. */
  renameDir(dirPath: string, newName: string): Promise<boolean>;

  /** Deletes a directory. Must be confirmed by caller before calling. */
  deleteDir(dirPath: string): Promise<boolean>;

  // ── File operations ───────────────────────────────────────────────────

  /** Creates a new .md file in dirPath with empty content. */
  createFile(dirPath: string, name: string): Promise<boolean>;

  /** Opens a file for editing in a new tab (or focuses existing tab). */
  openFile(file: AssetFileEntry): Promise<void>;

  /** Imports a .md file into dirPath. Opens a native dialog. */
  importFile(dirPath: string): Promise<boolean>;

  /** Deletes a .md file. Must be confirmed by caller. */
  deleteFile(filePath: string): Promise<boolean>;

  /** Renames a .md file. */
  renameFile(filePath: string, newName: string): Promise<boolean>;

  // ── Editor tab operations ─────────────────────────────────────────────

  /** Set the active tab. */
  setActiveTab(filePath: string): void;

  /** Switch a tab's panel between "editor" and "preview". */
  setTabPanel(filePath: string, panel: "editor" | "preview"): void;

  /** Update in-memory content of a tab (marks dirty). */
  updateTabContent(filePath: string, content: string): void;

  /** Save the active tab to disk. */
  saveTab(filePath: string): Promise<boolean>;

  /** Close a tab. If dirty, caller must confirm first. */
  closeTab(filePath: string): void;

  // ── Toasts ────────────────────────────────────────────────────────────

  /** Push a toast notification. */
  pushToast(kind: AssetToast["kind"], message: string): void;

  /** Dismiss a toast by id. */
  dismissToast(id: string): void;
}

export type AssetStore = AssetState & AssetActions;

// ── Initial state ─────────────────────────────────────────────────────────

const initialState: AssetState = {
  projectRoot: null,
  selectedDir: null,
  topDirs: [],
  childrenMap: {},
  expandedDirs: new Set(),
  dirContents: null,
  tabs: [],
  activeTabPath: null,
  isLoading: false,
  toasts: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────

let toastCounter = 0;

function mkToastId(): string {
  return `toast-${Date.now()}-${++toastCounter}`;
}

// ── Store implementation ───────────────────────────────────────────────────

export const useAssetStore = create<AssetStore>((set, get) => ({
  ...initialState,

  // ── Init root ──────────────────────────────────────────────────────────

  async initRoot(projectRoot) {
    set({
      projectRoot,
      selectedDir: null,
      topDirs: [],
      childrenMap: {},
      expandedDirs: new Set(),
      dirContents: null,
      tabs: [],
      activeTabPath: null,
      isLoading: true,
    });

    const bridge = getBridge();
    if (!bridge) {
      set({ isLoading: false });
      return;
    }

    try {
      const dirs = await bridge.assetListDirs(projectRoot);
      set({ topDirs: dirs, isLoading: false });
    } catch (err) {
      get().pushToast("error", `Failed to load directories: ${err instanceof Error ? err.message : String(err)}`);
      set({ isLoading: false });
    }
  },

  // ── Select dir ─────────────────────────────────────────────────────────

  async selectDir(dirPath) {
    set({ selectedDir: dirPath, isLoading: true, dirContents: null });

    const bridge = getBridge();
    if (!bridge) {
      set({ isLoading: false });
      return;
    }

    try {
      const contents = await bridge.assetListDirContents(dirPath);
      set({ dirContents: contents, isLoading: false });
    } catch (err) {
      get().pushToast("error", `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`);
      set({ isLoading: false });
    }
  },

  // ── Toggle dir expand/collapse ──────────────────────────────────────────

  async toggleDir(dirPath) {
    const { expandedDirs, childrenMap } = get();
    const isExpanded = expandedDirs.has(dirPath);

    if (isExpanded) {
      const next = new Set(expandedDirs);
      next.delete(dirPath);
      set({ expandedDirs: next });
      return;
    }

    // Expand: fetch children if not cached
    const next = new Set(expandedDirs);
    next.add(dirPath);
    set({ expandedDirs: next });

    if (childrenMap[dirPath]) return; // already cached

    const bridge = getBridge();
    if (!bridge) return;

    try {
      const children = await bridge.assetListDirs(dirPath);
      set((s) => ({ childrenMap: { ...s.childrenMap, [dirPath]: children } }));
    } catch (err) {
      get().pushToast("error", `Failed to expand directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  // ── Refresh top dirs ───────────────────────────────────────────────────

  async refreshTopDirs() {
    const { projectRoot } = get();
    if (!projectRoot) return;

    const bridge = getBridge();
    if (!bridge) return;

    try {
      const dirs = await bridge.assetListDirs(projectRoot);
      set({ topDirs: dirs });
    } catch {
      // silent — user will notice
    }
  },

  // ── Refresh children of a specific dir ────────────────────────────────

  async refreshChildren(dirPath) {
    const bridge = getBridge();
    if (!bridge) return;
    try {
      const children = await bridge.assetListDirs(dirPath);
      set((s) => ({ childrenMap: { ...s.childrenMap, [dirPath]: children } }));
    } catch {
      // silent
    }
  },

  // ── Refresh dir contents (right panel) ────────────────────────────────

  async refreshDirContents() {
    const { selectedDir } = get();
    if (!selectedDir) return;
    await get().selectDir(selectedDir);
  },

  // ── Create directory ───────────────────────────────────────────────────

  async createDir(parentDir, name) {
    const bridge = getBridge();
    if (!bridge) return false;

    const newPath = `${parentDir}/${name}`;

    const result = await bridge.assetCreateDir(newPath);
    if (result.success) {
      get().pushToast("success", `Folder "${name}" created.`);
      // Refresh the parent
      const { projectRoot } = get();
      if (parentDir === projectRoot) {
        await get().refreshTopDirs();
      } else {
        await get().refreshChildren(parentDir);
      }
      // Also refresh right panel if we just created inside selected dir
      if (get().selectedDir === parentDir) {
        await get().refreshDirContents();
      }
    } else {
      get().pushToast("error", result.error ?? "Failed to create folder.");
    }
    return result.success;
  },

  // ── Rename directory ───────────────────────────────────────────────────

  async renameDir(dirPath, newName) {
    const bridge = getBridge();
    if (!bridge) return false;

    const parentDir = dirPath.substring(0, dirPath.lastIndexOf("/"));
    const newPath = `${parentDir}/${newName}`;

    const result = await bridge.assetRename(dirPath, newPath);
    if (result.success) {
      get().pushToast("success", `Folder renamed to "${newName}".`);

      // Update expanded/childrenMap if it was tracked
      const { expandedDirs, childrenMap } = get();
      const nextExpanded = new Set(expandedDirs);
      if (nextExpanded.has(dirPath)) {
        nextExpanded.delete(dirPath);
        nextExpanded.add(newPath);
      }
      const nextMap: Record<string, AssetDirEntry[]> = { ...childrenMap };
      if (nextMap[dirPath]) {
        nextMap[newPath] = nextMap[dirPath];
        delete nextMap[dirPath];
      }
      set({ expandedDirs: nextExpanded, childrenMap: nextMap });

      // Update selectedDir if it pointed to this dir
      if (get().selectedDir === dirPath) {
        await get().selectDir(newPath);
      }

      // Refresh parent
      const { projectRoot } = get();
      if (parentDir === projectRoot) {
        await get().refreshTopDirs();
      } else {
        await get().refreshChildren(parentDir);
      }
    } else {
      get().pushToast("error", result.error ?? "Failed to rename folder.");
    }

    return result.success;
  },

  // ── Delete directory ───────────────────────────────────────────────────

  async deleteDir(dirPath) {
    const bridge = getBridge();
    if (!bridge) return false;

    const parentDir = dirPath.substring(0, dirPath.lastIndexOf("/"));

    const result = await bridge.assetDelete(dirPath);
    if (result.success) {
      get().pushToast("success", "Folder deleted.");

      // Clear from expanded/childrenMap
      const { expandedDirs, childrenMap } = get();
      const nextExpanded = new Set(expandedDirs);
      nextExpanded.delete(dirPath);
      const nextMap = { ...childrenMap };
      delete nextMap[dirPath];
      set({ expandedDirs: nextExpanded, childrenMap: nextMap });

      // If selected dir was deleted, clear right panel
      if (get().selectedDir === dirPath) {
        set({ selectedDir: null, dirContents: null });
      }

      // Refresh parent
      const { projectRoot } = get();
      if (parentDir === projectRoot) {
        await get().refreshTopDirs();
      } else {
        await get().refreshChildren(parentDir);
      }
    } else {
      get().pushToast("error", result.error ?? "Failed to delete folder.");
    }

    return result.success;
  },

  // ── Create file ────────────────────────────────────────────────────────

  async createFile(dirPath, name) {
    const bridge = getBridge();
    if (!bridge) return false;

    // Normalize: ensure .md extension
    const safeName = name.endsWith(".md") ? name : `${name}.md`;
    const filePath = `${dirPath}/${safeName}`;

    const result = await bridge.assetWriteFile(filePath, "");
    if (result.success) {
      get().pushToast("success", `File "${safeName}" created.`);
      await get().refreshDirContents();
    } else {
      get().pushToast("error", result.error ?? "Failed to create file.");
    }

    return result.success;
  },

  // ── Open file in editor tab ────────────────────────────────────────────

  async openFile(file) {
    // If already open, just focus it
    const existing = get().tabs.find((t) => t.filePath === file.path);
    if (existing) {
      set({ activeTabPath: file.path });
      return;
    }

    const bridge = getBridge();
    if (!bridge) return;

    const readResult = await bridge.assetReadFile(file.path);
    if (!readResult.success) {
      get().pushToast("error", readResult.error ?? "Failed to read file.");
      return;
    }

    const newTab: AssetEditorTab = {
      filePath: file.path,
      name: file.name,
      content: readResult.content ?? "",
      dirty: false,
      panel: "editor",
    };

    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabPath: file.path,
    }));
  },

  // ── Import file ────────────────────────────────────────────────────────

  async importFile(dirPath) {
    const bridge = getBridge();
    if (!bridge) return false;

    const srcPath = await bridge.assetOpenMdDialog();
    if (!srcPath) return false;

    // Check if file already exists in destDir
    const srcName = srcPath.split("/").pop() ?? srcPath.split("\\").pop() ?? "file.md";
    const destPath = `${dirPath}/${srcName}`;

    // Check existence via listing
    const contents = await bridge.assetListDirContents(dirPath);
    const exists = contents.files.some((f) => f.name === srcName);

    if (exists) {
      // Return false here — the UI component is responsible for confirming overwrite
      // and calling this again with confirmation. We'll use a special flag.
      // Actually, since the IPC handler already overwrites, we just warn the user first.
      // Let the caller (component) handle the confirm dialog before calling importFile.
      // For simplicity: we always import (overwrite). The UI shows the confirmation dialog first.
    }

    const result = await bridge.assetImportFile(srcPath, dirPath);
    if (result.success) {
      get().pushToast("success", `"${srcName}" imported successfully.`);
      await get().refreshDirContents();
    } else {
      get().pushToast("error", result.error ?? "Import failed.");
    }

    return result.success;
  },

  // ── Delete file ────────────────────────────────────────────────────────

  async deleteFile(filePath) {
    const bridge = getBridge();
    if (!bridge) return false;

    const result = await bridge.assetDelete(filePath);
    if (result.success) {
      get().pushToast("success", "File deleted.");

      // Close the tab if it was open
      const tab = get().tabs.find((t) => t.filePath === filePath);
      if (tab) get().closeTab(filePath);

      await get().refreshDirContents();
    } else {
      get().pushToast("error", result.error ?? "Failed to delete file.");
    }

    return result.success;
  },

  // ── Rename file ────────────────────────────────────────────────────────

  async renameFile(filePath, newName) {
    const bridge = getBridge();
    if (!bridge) return false;

    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    const safeName = newName.endsWith(".md") ? newName : `${newName}.md`;
    const newPath = `${dir}/${safeName}`;

    const result = await bridge.assetRename(filePath, newPath);
    if (result.success) {
      get().pushToast("success", `File renamed to "${safeName}".`);

      // Update the tab if it was open
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.filePath === filePath
            ? { ...t, filePath: newPath, name: safeName }
            : t
        ),
        activeTabPath: s.activeTabPath === filePath ? newPath : s.activeTabPath,
      }));

      await get().refreshDirContents();
    } else {
      get().pushToast("error", result.error ?? "Failed to rename file.");
    }

    return result.success;
  },

  // ── Tab operations ─────────────────────────────────────────────────────

  setActiveTab(filePath) {
    set({ activeTabPath: filePath });
  },

  setTabPanel(filePath, panel) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.filePath === filePath ? { ...t, panel } : t)),
    }));
  },

  updateTabContent(filePath, content) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.filePath === filePath ? { ...t, content, dirty: true } : t
      ),
    }));
  },

  async saveTab(filePath) {
    const tab = get().tabs.find((t) => t.filePath === filePath);
    if (!tab) return false;

    const bridge = getBridge();
    if (!bridge) return false;

    const result = await bridge.assetWriteFile(filePath, tab.content);
    if (result.success) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.filePath === filePath ? { ...t, dirty: false } : t
        ),
      }));
      get().pushToast("success", `"${tab.name}" saved.`);
    } else {
      get().pushToast("error", result.error ?? "Failed to save file.");
    }

    return result.success;
  },

  closeTab(filePath) {
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.filePath !== filePath);
      let newActive = s.activeTabPath;

      if (s.activeTabPath === filePath) {
        // Focus the previous tab, or the next one
        const idx = s.tabs.findIndex((t) => t.filePath === filePath);
        if (newTabs.length === 0) {
          newActive = null;
        } else {
          newActive = (newTabs[Math.max(0, idx - 1)] ?? newTabs[0])!.filePath;
        }
      }

      return { tabs: newTabs, activeTabPath: newActive };
    });
  },

  // ── Toasts ─────────────────────────────────────────────────────────────

  pushToast(kind, message) {
    const id = mkToastId();
    set((s) => ({
      toasts: [...s.toasts, { id, kind, message }],
    }));
    // Auto-dismiss after 4 seconds
    setTimeout(() => get().dismissToast(id), 4000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
