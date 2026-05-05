/**
 * src/renderer/hooks/useFolderExplorer.ts
 *
 * Custom hook — FolderExplorer state machine
 * ────────────────────────────────────────────
 * Manages the complete runtime state of a FolderExplorer UI: the current
 * working directory, breadcrumb trail, visible entries, loading state,
 * selection, errors, and the "show hidden" toggle.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │  STATE                                                                │
 * ├───────────────────────────────────────────────────────────────────────┤
 * │  cwd          – current absolute path being displayed                │
 * │  breadcrumbs  – ordered list of { name, path } from root to cwd      │
 * │  entries      – visible DirEntry[] in the cwd (filtered)             │
 * │  loading      – true while an IPC call is in flight                  │
 * │  error        – last IpcError, or null if none                       │
 * │  selected     – set of selected entry paths (multi-select ready)     │
 * │  showHidden   – whether hidden (dot) entries are shown               │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │  METHODS                                                              │
 * ├───────────────────────────────────────────────────────────────────────┤
 * │  navigate(path)      – navigate to an arbitrary absolute path        │
 * │  open(entry)         – navigate into an Entry (must be a directory)  │
 * │  goUp()              – navigate to parent directory                  │
 * │  reload()            – refresh the current directory listing         │
 * │  select(path)        – set exactly one selected path                 │
 * │  toggleSelect(path)  – toggle one path in/out of the selection set   │
 * │  clearSelection()    – clear all selected paths                      │
 * │  setShowHidden(v)    – toggle hidden entries and reload              │
 * │  clearError()        – dismiss the current error                     │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * USAGE EXAMPLE
 * ─────────────
 * ```tsx
 * import { useFolderExplorer } from "@/renderer/hooks/useFolderExplorer";
 *
 * function FolderExplorerPanel() {
 *   const {
 *     cwd, breadcrumbs, entries,
 *     loading, error, selected, showHidden,
 *     navigate, open, goUp, reload,
 *     select, toggleSelect, clearSelection,
 *     setShowHidden, clearError,
 *   } = useFolderExplorer({ initialPath: "/home/user" });
 *
 *   if (loading) return <Spinner />;
 *
 *   if (error) return (
 *     <ErrorBanner code={error.code} message={error.message} onDismiss={clearError} />
 *   );
 *
 *   return (
 *     <div>
 *       {/* Breadcrumb nav *\/}
 *       <Breadcrumbs items={breadcrumbs} onNavigate={navigate} />
 *
 *       {/* Hidden-files toggle *\/}
 *       <label>
 *         <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
 *         Show hidden
 *       </label>
 *
 *       {/* Directory listing *\/}
 *       <ul>
 *         {entries.map(e => (
 *           <li
 *             key={e.path}
 *             onClick={() => select(e.path)}
 *             onDoubleClick={() => e.isDirectory && open(e)}
 *             style={{ fontWeight: selected.has(e.path) ? "bold" : "normal" }}
 *           >
 *             {e.isDirectory ? "📁" : "📄"} {e.name}
 *           </li>
 *         ))}
 *       </ul>
 *
 *       {/* Up button (disabled at home root) *\/}
 *       <button onClick={goUp} disabled={breadcrumbs.length <= 1}>↑ Up</button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  listFolder,
  createDirectory,
  type Entry,
  type IpcError,
  type FilterOptions,
} from "../services/ipc.ts";
import type { Drive } from "../../../electron-main/src/ipc/folder-explorer.ts";

// ── Platform detection ────────────────────────────────────────────────────────
// Read from window.appPaths.platform exposed by the preload script.
// This is the ONLY reliable way to detect the platform in the renderer because:
//   - nodeIntegration is false → cannot import Node's `os` module
//   - window.platform is NOT exposed by the preload (would be undefined)
//   - userAgent-based detection is unreliable on Electron
// The preload exposes: window.appPaths.platform = process.platform
const IS_WINDOWS: boolean =
  typeof window !== "undefined" &&
  typeof (window as Window & { appPaths?: { platform?: string } }).appPaths?.platform === "string"
    ? (window as Window & { appPaths: { platform: string } }).appPaths.platform === "win32"
    : false;

// ── Windows path helpers ──────────────────────────────────────────────────────

/**
 * Normalises Windows path separators: converts forward slashes to backslashes
 * and ensures a trailing backslash for drive roots.
 */
function normaliseWindowsPath(p: string): string {
  // Replace forward slashes with backslashes
  let normalised = p.replace(/\//g, "\\");
  // If it looks like a bare drive letter (e.g. "C:"), add trailing backslash
  if (/^[A-Za-z]:$/.test(normalised)) {
    normalised = normalised + "\\";
  }
  return normalised;
}

/**
 * Returns true if `path` is the root of a Windows drive, e.g. "C:\".
 * Handles both "C:\" and "C:/" forms.
 */
function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:[/\\]$/.test(path);
}

export { Drive };

// ── Types ──────────────────────────────────────────────────────────────────

/** A single breadcrumb segment. */
export interface Breadcrumb {
  /** Display name (basename of the path, or "/" for root). */
  name: string;
  /** Absolute path this breadcrumb navigates to. */
  path: string;
}

/** Options accepted by the hook factory. */
export interface UseFolderExplorerOptions {
  /**
   * The absolute path to open on mount.
   * If omitted, the hook starts in an idle state (no path loaded).
   * Navigate explicitly by calling `navigate(path)`.
   */
  initialPath?: string;

  /**
   * Initial value for the "show hidden entries" toggle.
   * Default: `false`.
   */
  initialShowHidden?: boolean;

  /**
   * Called when any navigation error occurs (IPC error, timeout, bridge missing).
   * Useful for forwarding errors to a toast / notification system OUTSIDE the
   * component that renders the explorer.
   *
   * The hook also stores the error in the `error` field — this callback is
   * purely for side-effects (logging, toast, etc.).
   */
  onError?: (err: IpcError) => void;

  /**
   * Extra FilterOptions forwarded to the IPC layer on every list call.
   * `showHidden` is managed by the hook internally and will override
   * any `showHidden` provided here.
   */
  extraFilterOptions?: Omit<FilterOptions, "showHidden">;
}

/** The full state + methods returned by the hook. */
export interface FolderExplorerHandle {
  // ── State ──────────────────────────────────────────────────────────────

  /** Current absolute directory path being displayed. May be `""` before the first navigation. */
  cwd: string;

  /**
   * Breadcrumb trail from the logical root (or from `initialPath`) down to `cwd`.
   * The LAST element always corresponds to `cwd`.
   *
   * Built by splitting the path on `/` and building cumulative paths.
   * E.g. `/home/user/projects` → [{ name: "/", path: "/" }, { name: "home", path: "/home" }, …]
   */
  breadcrumbs: Breadcrumb[];

  /**
   * Visible entries in the current directory.
   * Empty array while loading, after an error, or before the first navigation.
   */
  entries: Entry[];

  /** True while an IPC call is in progress. */
  loading: boolean;

  /**
   * The most recent IpcError, or `null` if the last operation succeeded.
   * Cleared automatically on the next successful navigation.
   * Can be manually dismissed via `clearError()`.
   */
  error: IpcError | null;

  /**
   * Set of currently selected entry paths.
   * Managed by `select`, `toggleSelect`, `clearSelection`.
   */
  selected: ReadonlySet<string>;

  /** Whether hidden (dot-prefixed) entries are shown. */
  showHidden: boolean;

  /** True while a create-directory operation is in flight. */
  creating: boolean;

  /**
   * True when the explorer is showing the Windows drive list ("This PC" view).
   * Always false on Linux/macOS.
   */
  isDriveList: boolean;

  /**
   * List of available Windows drives. Populated when `isDriveList` is true.
   * Always empty on Linux/macOS.
   */
  drives: Drive[];

  /**
   * True when the user is at the absolute root and cannot go up further.
   * On Windows: true only when `isDriveList` is true (drive list = root).
   * On Linux/macOS: true when `breadcrumbs.length <= 1` (at "/").
   */
  isAtRoot: boolean;

  // ── Navigation methods ──────────────────────────────────────────────────

  /**
   * Navigate to an arbitrary absolute path within $HOME.
   *
   * - Updates `cwd`, `breadcrumbs`, and `entries`.
   * - Clears `selected` and any previous `error`.
   * - Sets `loading` to `true` until the IPC call resolves.
   *
   * If the path does not resolve or returns an error, `entries` remains empty
   * and `error` is set. `cwd` is NOT updated on error (keeps previous value).
   *
   * @param path - Absolute path within $HOME.
   */
  navigate: (path: string) => void;

  /**
   * Navigate into a directory entry (double-click / expand).
   *
   * Equivalent to `navigate(entry.path)`.
   * If `entry.isDirectory` is `false`, this is a no-op (guard against
   * callers accidentally calling open on files).
   *
   * @param entry - Entry obtained from the current `entries` list.
   */
  open: (entry: Entry) => void;

  /**
   * Navigate to the parent directory.
   *
   * If already at the HOME root (or `cwd` has no parent), this is a no-op.
   * Uses `breadcrumbs[breadcrumbs.length - 2]?.path` to find the parent —
   * avoids string-splitting / OS path ops in the renderer.
   *
   * On Windows: if at a drive root (e.g. C:\), navigates to the drive list.
   * If already at the drive list, this is a no-op.
   */
  goUp: () => void;

  /**
   * Refresh the current directory listing.
   *
   * Useful after file system mutations that happened outside the explorer
   * (e.g. file creation, deletion, rename from another panel).
   */
  reload: () => void;

  /**
   * Navigate to the Windows drive list ("This PC" view).
   * No-op on Linux/macOS.
   */
  goToDriveList: () => void;

  /**
   * Navigate into a Windows drive (e.g. C:\).
   * No-op on Linux/macOS.
   */
  openDrive: (drive: Drive) => void;

  // ── Selection methods ──────────────────────────────────────────────────

  /**
   * Set exactly one selected path, replacing any previous selection.
   *
   * @param path - The path to select (must be one of the current `entries`).
   */
  select: (path: string) => void;

  /**
   * Toggle one path in/out of the multi-selection set.
   * If the path is already selected, it is deselected.
   * If it is not selected, it is added.
   *
   * @param path - The path to toggle.
   */
  toggleSelect: (path: string) => void;

  /** Clear all selected paths. */
  clearSelection: () => void;

  // ── Settings ───────────────────────────────────────────────────────────

  /**
   * Set the "show hidden" toggle and reload the current directory.
   * Hidden entries are those whose names start with `.` (Unix convention).
   *
   * @param value - `true` to show hidden entries, `false` to hide them.
   */
  setShowHidden: (value: boolean) => void;

  // ── Error management ────────────────────────────────────────────────────

  /**
   * Dismiss the current `error`, setting it back to `null`.
   * Does not retry the failed operation.
   */
  clearError: () => void;

  /** Creates a new directory inside the current cwd and reloads on success. */
  createDir: (name: string) => Promise<boolean>;
}

// ── Breadcrumb builder ────────────────────────────────────────────────────────

/**
 * Builds an ordered list of breadcrumbs from an absolute path.
 *
 * Supports both POSIX paths (/home/user/...) and Windows paths (C:\Users\...).
 *
 * POSIX example: `/home/user/projects` →
 *   [
 *     { name: "/", path: "/" },
 *     { name: "home", path: "/home" },
 *     { name: "user", path: "/home/user" },
 *     { name: "projects", path: "/home/user/projects" },
 *   ]
 *
 * Windows example: `C:\Users\kamiloid` →
 *   [
 *     { name: "C:\\", path: "C:\\" },
 *     { name: "Users", path: "C:\\Users" },
 *     { name: "kamiloid", path: "C:\\Users\\kamiloid" },
 *   ]
 *
 * Handles edge cases:
 *   - `/` → [{ name: "/", path: "/" }]
 *   - `C:\` → [{ name: "C:\\", path: "C:\\" }]
 *   - Empty / non-absolute string → []
 */
function buildBreadcrumbs(absolutePath: string): Breadcrumb[] {
  if (!absolutePath) return [];

  // Windows path detection: starts with a drive letter (e.g. "C:\")
  const isWindowsPath = /^[A-Za-z]:[/\\]/.test(absolutePath);

  if (isWindowsPath) {
    // Normalise to backslashes but preserve drive root trailing backslash
    const withBackslashes = absolutePath.replace(/\//g, "\\");
    // Remove trailing backslash ONLY if it's not a drive root (e.g. "C:\Users\" → "C:\Users")
    const normalised = /^[A-Za-z]:\\$/.test(withBackslashes)
      ? withBackslashes
      : withBackslashes.replace(/\\+$/, "") || withBackslashes;
    // Extract drive root (e.g. "C:\")
    const driveRoot = normalised.slice(0, 3); // "C:\"
    // If path IS the drive root
    if (normalised === driveRoot || normalised.replace(/\\$/, "") === driveRoot.replace(/\\$/, "")) {
      return [{ name: driveRoot, path: driveRoot }];
    }
    // Split remaining path after drive root
    const rest = normalised.slice(3); // "Users\kamiloid"
    const segments = rest.split("\\").filter(Boolean);
    const crumbs: Breadcrumb[] = [{ name: driveRoot, path: driveRoot }];
    let accumulated = driveRoot;
    for (const seg of segments) {
      accumulated = accumulated.endsWith("\\") ? `${accumulated}${seg}` : `${accumulated}\\${seg}`;
      crumbs.push({ name: seg, path: accumulated });
    }
    return crumbs;
  }

  // POSIX path
  if (!absolutePath.startsWith("/")) return [];

  // Normalise: remove trailing slash (except root), collapse double slashes.
  const normalised = absolutePath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

  if (normalised === "/") {
    return [{ name: "/", path: "/" }];
  }

  const segments = normalised.split("/").filter(Boolean); // ["home", "user", "projects"]

  const crumbs: Breadcrumb[] = [{ name: "/", path: "/" }];
  let accumulated = "";
  for (const seg of segments) {
    accumulated = `${accumulated}/${seg}`;
    crumbs.push({ name: seg, path: accumulated });
  }

  return crumbs;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * `useFolderExplorer` — React hook for FolderExplorer state management.
 *
 * Manages navigation, listing, selection, and error handling for a directory
 * browser UI backed by the `window.folderExplorer` IPC bridge.
 *
 * @param options - Optional initial configuration (see `UseFolderExplorerOptions`).
 * @returns       `FolderExplorerHandle` — full state + action methods.
 *
 * @see UseFolderExplorerOptions for configuration
 * @see FolderExplorerHandle for the returned API surface
 */
export function useFolderExplorer(
  options: UseFolderExplorerOptions = {},
): FolderExplorerHandle {
  const {
    initialPath,
    initialShowHidden = false,
    onError,
    extraFilterOptions,
  } = options;

  // ── State ───────────────────────────────────────────────────────────────
  const [cwd,         setCwd]         = useState<string>(initialPath ?? "");
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>(
    initialPath ? buildBreadcrumbs(initialPath) : [],
  );
  const [entries,    setEntries]    = useState<Entry[]>([]);
  const [loading,    setLoading]    = useState<boolean>(false);
  const [error,      setError]      = useState<IpcError | null>(null);
  const [selected,   setSelected]   = useState<ReadonlySet<string>>(new Set());
  const [showHidden, setShowHiddenState] = useState<boolean>(initialShowHidden);
  const [creating,   setCreating]   = useState<boolean>(false);

  // ── Windows-specific state ──────────────────────────────────────────────
  const [isDriveList, setIsDriveList] = useState<boolean>(false);
  const [drives,      setDrives]      = useState<Drive[]>([]);

  // Stable ref for the onError callback — avoids stale closures in navigate.
  const onErrorRef = useRef<((err: IpcError) => void) | undefined>(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // ── Core navigate ───────────────────────────────────────────────────────

  /**
   * Internal navigate — called by all public navigation methods.
   * If `targetPath` is empty/falsy, the call is a no-op (guard for initial state).
   */
  const navigateInternal = useCallback(
    async (targetPath: string, currentShowHidden: boolean) => {
      if (!targetPath) return;

      setLoading(true);
      setError(null);

      const filterOpts: FilterOptions = {
        ...extraFilterOptions,
        showHidden: currentShowHidden,
      };

      const result = await listFolder(targetPath, filterOpts);

      if (!result.ok) {
        setError(result.error);
        onErrorRef.current?.(result.error);
        setLoading(false);
        return; // keep cwd as-is on error
      }

      // Commit the new state atomically
      setCwd(result.dirPath);
      setBreadcrumbs(buildBreadcrumbs(result.dirPath));
      setEntries(result.entries);
      setSelected(new Set()); // clear selection on every navigation
      // Exit drive list mode when navigating into a real directory
      setIsDriveList(false);
      setLoading(false);
    },
    // extraFilterOptions object identity may change; stringify for stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(extraFilterOptions)],
  );

  // ── Mount: navigate to initialPath ─────────────────────────────────────
  useEffect(() => {
    if (initialPath) {
      void navigateInternal(initialPath, initialShowHidden);
    }
    // Only run on mount — intentionally omitting `initialPath` from deps
    // so consumers can update it without re-triggering (they call navigate()).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public navigation methods ────────────────────────────────────────────

  const navigate = useCallback(
    (path: string) => {
      void navigateInternal(path, showHidden);
    },
    [navigateInternal, showHidden],
  );

  const open = useCallback(
    (entry: Entry) => {
      if (!entry.isDirectory) return; // guard: only navigate into directories
      void navigateInternal(entry.path, showHidden);
    },
    [navigateInternal, showHidden],
  );

  // ── Windows: goToDriveList ───────────────────────────────────────────────

  const goToDriveList = useCallback(async () => {
    if (!IS_WINDOWS) return;
    setLoading(true);
    setError(null);

  const result = await (window as Window & {
      folderExplorer: {
        listDrives(): Promise<{ ok: true; drives: Drive[] } | { ok: false; code: string; message: string }>;
      };
    }).folderExplorer.listDrives();

    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      onErrorRef.current?.({ code: result.code, message: result.message });
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
  }, []);

  // ── Windows: openDrive ───────────────────────────────────────────────────

  const openDrive = useCallback(
    (drive: Drive) => {
      if (!IS_WINDOWS) return;
      void navigateInternal(drive.path, showHidden);
    },
    [navigateInternal, showHidden],
  );

  // ── goUp ─────────────────────────────────────────────────────────────────

  const goUp = useCallback(() => {
    if (IS_WINDOWS) {
      if (isDriveList) return; // already at drive list — no-op

      // Normalise cwd for comparison (handle forward slashes on Windows)
      const normCwd = normaliseWindowsPath(cwd);
      if (isWindowsDriveRoot(normCwd)) {
        // At a drive root (e.g. C:\) → go to drive list
        void goToDriveList();
        return;
      }
    }

    // Standard behaviour: Linux/macOS or Windows subdirectory
    if (breadcrumbs.length <= 1) return; // already at root
    const parent = breadcrumbs[breadcrumbs.length - 2];
    if (parent) {
      void navigateInternal(parent.path, showHidden);
    }
  }, [IS_WINDOWS, isDriveList, cwd, breadcrumbs, navigateInternal, showHidden, goToDriveList]);

  const reload = useCallback(() => {
    if (isDriveList) {
      // Reload drive list
      void goToDriveList();
      return;
    }
    if (!cwd) return;
    void navigateInternal(cwd, showHidden);
  }, [isDriveList, cwd, navigateInternal, showHidden, goToDriveList]);

  // ── Selection methods ────────────────────────────────────────────────────

  const select = useCallback((path: string) => {
    setSelected(new Set([path]));
  }, []);

  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // ── Settings ─────────────────────────────────────────────────────────────

  const setShowHidden = useCallback(
    (value: boolean) => {
      setShowHiddenState(value);
      // Reload the current directory with the new filter immediately.
      if (cwd) {
        void navigateInternal(cwd, value);
      }
    },
    [cwd, navigateInternal],
  );

  // ── Error management ──────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const createDir = useCallback(
    async (name: string): Promise<boolean> => {
      if (!cwd) return false;

      setCreating(true);
      setError(null);

      const result = await createDirectory(cwd, name);

      setCreating(false);

      if (!result.ok) {
        setError(result.error);
        onErrorRef.current?.(result.error);
        return false;
      }

      await navigateInternal(cwd, showHidden);
      return true;
    },
    [cwd, showHidden, navigateInternal],
  );

  // ── isAtRoot ──────────────────────────────────────────────────────────────
  // Windows: root is the drive list; Linux/macOS: root is "/"
  const isAtRoot = IS_WINDOWS ? isDriveList : breadcrumbs.length <= 1;

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    // State
    cwd,
    breadcrumbs,
    entries,
    loading,
    error,
    selected,
    showHidden,
    creating,
    isDriveList,
    drives,
    isAtRoot,
    // Navigation
    navigate,
    open,
    goUp,
    reload,
    goToDriveList,
    openDrive,
    // Selection
    select,
    toggleSelect,
    clearSelection,
    // Settings
    setShowHidden,
    // Error
    clearError,
    createDir,
  };
}
