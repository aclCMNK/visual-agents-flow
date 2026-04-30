/**
 * src/renderer/components/FolderExplorer/FolderExplorer.tsx
 *
 * FolderExplorer — Home-sandboxed in-app directory browser.
 * ──────────────────────────────────────────────────────────
 * Renders a navigable directory listing backed by the `useFolderExplorer` hook
 * and the `window.folderExplorer` IPC bridge (electron-main/src/ipc/folder-explorer.ts).
 *
 * Features
 * ────────
 *  • Breadcrumb navigation bar — each segment is a clickable link.
 *  • "Up" button — disabled when already at the home root.
 *  • "Reload" button — refresh current listing without navigating away.
 *  • Hidden-files toggle — checkbox labelled "Show hidden".
 *  • Entry list — sorted directories first, then files.
 *    ‑ Single-click    → select entry (calls onSelect).
 *    ‑ Double-click    → navigate into directory only (calls open(), NOT onConfirm).
 *                        Closing/confirming the explorer is triggered exclusively
 *                        by the explicit "Seleccionar carpeta" button in the parent.
 *  • Keyboard navigation:
 *    ‑ Arrow Up / Arrow Down → move focus/selection within list.
 *    ‑ Enter                 → navigate into selected directory (same as double-click:
 *                              only open(), no onConfirm to avoid accidental confirm).
 *    ‑ Escape                → clear selection.
 *    ‑ Backspace             → go up one level.
 *  • Loading state  — spinner + live "Loading…" announcement.
 *  • Error state    — error banner with dismiss button + screen-reader alert.
 *  • Empty state    — friendly "No items" message.
 *
 * Accessibility
 * ─────────────
 *  • The list has `role="listbox"` + `aria-label`.
 *  • Each entry has `role="option"`, `aria-selected`, and an `aria-label` that
 *    includes the entry type and name.
 *  • The error banner uses `role="alert"` for automatic screen-reader announcement.
 *  • The loading message uses `role="status"` + `aria-live="polite"`.
 *  • All interactive elements have `focus-visible` outlines (keyboard only).
 *  • Breadcrumb nav is wrapped in `<nav aria-label="Folder breadcrumbs">`.
 *  • Toolbar buttons carry descriptive `aria-label` attributes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXAMPLE INTEGRATION IN ExportModal
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ```tsx
 * // src/ui/components/ExportModal/ExportModal.tsx
 * //
 * // Replace the native "Pick…" button with an inline FolderExplorer:
 * //
 * //   import { FolderExplorer } from "@/renderer/components/FolderExplorer/FolderExplorer";
 * //
 * // Inside the ExportModal component, add a "browse" mode flag:
 * //
 * //   const [browseMode, setBrowseMode] = useState(false);
 * //   const [exportDir, setExportDir]   = useState("");
 * //
 * // Render the explorer in place of the native dialog:
 * //
 * //   {browseMode ? (
 * //     <FolderExplorer
 * //       initialPath={exportDir || undefined}
 * //       style={{ height: 320 }}
 * //       onSelect={(path) => {
 * //         setExportDir(path);
 * //         setBrowseMode(false);     // collapse explorer once chosen
 * //       }}
 * //     />
 * //   ) : (
 * //     <div className="export-modal__dir-row">
 * //       <input readOnly value={exportDir || "No directory selected"} />
 * //       <button onClick={() => setBrowseMode(true)}>Browse…</button>
 * //     </div>
 * //   )}
 * //
 * // The `onSelect` callback replaces the IPC `selectExportDir()` call entirely —
 * // no native dialog involved, so it works correctly in Electron modal windows.
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOMMENDED UNIT TESTS (vitest + @testing-library/react)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ```ts
 * // src/renderer/components/FolderExplorer/FolderExplorer.test.tsx
 * //
 * // Scope: accessibility + UX critical paths
 * //
 * // --- Setup ---
 * // Mock `window.folderExplorer` bridge before each test:
 * //   (window as any).folderExplorer = {
 * //     list: vi.fn().mockResolvedValue({ ok: true, dirPath: "/home/user", entries: [...] }),
 * //     stat: vi.fn(),
 * //     readChildren: vi.fn(),
 * //   };
 * //
 * // --- a11y tests ---
 * // ✅ Role "listbox" present on entry list
 * // ✅ Each entry has role="option" with aria-selected
 * // ✅ Loading region has role="status" and aria-live="polite"
 * // ✅ Error banner has role="alert" (auto-announced)
 * // ✅ Up button has aria-label and is disabled at home root
 * // ✅ Breadcrumb nav has aria-label="Folder breadcrumbs"
 * // ✅ All interactive elements are focusable (tabIndex ≥ 0 or via role)
 * //
 * // --- UX tests ---
 * // ✅ Click on directory entry → selects it (aria-selected=true)
 * // ✅ Double-click on directory → triggers navigation (listFolder called with new path)
 * // ✅ Double-click on file → no navigation (listFolder NOT called)
 * // ✅ ArrowDown on entry list → focus moves to next entry
 * // ✅ ArrowUp on first entry → focus stays on first entry
 * // ✅ Enter on selected directory → navigates into it
 * // ✅ Escape → clears selection (aria-selected=false on all entries)
 * // ✅ Backspace → calls listFolder with parent directory path
 * // ✅ Up button disabled when breadcrumbs.length <= 1
 * // ✅ "Show hidden" checkbox toggles hidden entries (re-calls listFolder)
 * // ✅ Error dismiss button hides error banner
 * // ✅ Empty directory shows empty-state message
 * // ✅ onSelect callback fired on single-click (if prop provided)
 * // ✅ Spinner visible during loading; gone after resolve
 * ```
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useFolderExplorer } from "../../hooks/useFolderExplorer.ts";
import type { Entry } from "../../services/ipc.ts";
import type { Drive } from "../../hooks/useFolderExplorer.ts";
import styles from "./FolderExplorer.module.css";

// ── Props ─────────────────────────────────────────────────────────────────

export interface FolderExplorerProps {
  /**
   * Absolute path to open on mount.
   * If omitted the explorer starts in an idle/empty state.
   */
  initialPath?: string;

  /**
   * Called when the user single-clicks (selects) an entry.
   * Useful for parent components that want to "bind" the selected path.
   *
   * @param path - Absolute path of the selected entry.
   */
  onSelect?: (path: string) => void;

  /**
   * Called when the user confirms a directory selection (double-click or Enter
   * on a directory entry). Intended as a "use this folder" confirm callback.
   *
   * @param path - Absolute path of the confirmed directory.
   */
  onConfirm?: (path: string) => void;

  /**
   * Whether to show files in addition to directories.
   * Default: `false` (directories only, matching the default IPC filter).
   */
  showFiles?: boolean;

  /**
   * CSS `style` applied to the root container.
   * Use to set a fixed `height` or `max-height` when embedding in a modal.
   *
   * @example { height: 320 }
   */
  style?: CSSProperties;

  /**
   * Additional `className` applied to the root container.
   */
  className?: string;

  /**
   * If true (default), enables inline new-directory creation UI in the toolbar.
   */
  allowCreateDir?: boolean;
}

// ── Icon helpers ─────────────────────────────────────────────────────────────
// Pure SVG so no external icon library is required.

function IconFolder({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 3.5C1 2.948 1.448 2.5 2 2.5H5.086a1 1 0 0 1 .707.293L6.5 3.5H12A1 1 0 0 1 13 4.5v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-8Z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

function IconFile({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.5"
        y="1.5"
        width="9"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <line x1="4.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1" />
      <line x1="4.5" y1="7.5" x2="9.5" y2="7.5" stroke="currentColor" strokeWidth="1" />
      <line x1="4.5" y1="10" x2="7.5" y2="10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconArrowUp({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 1L1 6h3v5h4V6h3L6 1Z" fill="currentColor" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10.5 1.5v3h-3M1.5 10.5v-3h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 4.5A4.5 4.5 0 1 0 9 9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconNewFolder({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 3.5C1 2.948 1.448 2.5 2 2.5H5.086a1 1 0 0 1 .707.293L6.5 3.5H12A1 1 0 0 1 13 4.5v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-8Z"
        fill="currentColor"
        opacity="0.7"
      />
      <line x1="7" y1="5.5" x2="7" y2="9.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="5" y1="7.5" x2="9" y2="7.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 6l3 3 5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 2l8 8M10 2l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <span className={`${styles.mkdirSpinner}${className ? ` ${className}` : ""}`} aria-hidden="true" />
  );
}

// ── Sort helper ──────────────────────────────────────────────────────────────
// Directories always appear before files; within each group, sort alphabetically.

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function FolderExplorer({
  initialPath,
  onSelect,
  onConfirm,
  showFiles = false,
  style,
  className,
  allowCreateDir = true,
}: FolderExplorerProps) {
  const uid = useId(); // unique prefix for ARIA IDs
  const listboxId = `${uid}-listbox`;
  const listRef = useRef<HTMLUListElement>(null);
  const mkdirButtonRef = useRef<HTMLButtonElement>(null);
  const newDirInputRef = useRef<HTMLInputElement>(null);

  const [mkdirMode, setMkdirMode] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const {
    cwd,
    breadcrumbs,
    entries,
    loading,
    creating,
    error,
    selected,
    showHidden,
    navigate,
    open,
    goUp,
    reload,
    select,
    clearSelection,
    setShowHidden,
    clearError,
    createDir,
    isDriveList,
    drives,
    isAtRoot,
    openDrive,
  } = useFolderExplorer({
    initialPath,
    extraFilterOptions: { directoriesOnly: !showFiles },
  });

  const sortedEntries = sortEntries(entries);

  const validateNameClientSide = useCallback((name: string): string | null => {
    if (!name || name.trim() === "") return "Name cannot be empty.";
    if (name.length > 255) return "Name too long (max 255 chars).";
    if (name === "." || name === "..") return `"${name}" is not a valid name.`;
    if (name.includes("/") || name.includes("\\")) return "Name cannot contain / or \\.";
    if (/[\x00-\x1F\x7F]/.test(name)) return "Name cannot contain control characters.";
    if (/[<>:"|?*]/.test(name)) return "Name cannot contain: < > : \" | ? *";
    return null;
  }, []);

  const handleOpenMkdir = useCallback(() => {
    setMkdirMode(true);
    setNewDirName("");
    setNameError(null);
    requestAnimationFrame(() => newDirInputRef.current?.focus());
  }, []);

  const handleCancelMkdir = useCallback(() => {
    if (creating) return;
    setMkdirMode(false);
    setNewDirName("");
    setNameError(null);
    requestAnimationFrame(() => mkdirButtonRef.current?.focus());
  }, [creating]);

  const handleConfirmMkdir = useCallback(async () => {
    const trimmed = newDirName.trim();
    const clientError = validateNameClientSide(trimmed);
    if (clientError) {
      setNameError(clientError);
      newDirInputRef.current?.focus();
      return;
    }

    setNameError(null);
    const success = await createDir(trimmed);

    if (success) {
      setMkdirMode(false);
      setNewDirName("");
      requestAnimationFrame(() => mkdirButtonRef.current?.focus());
    }
  }, [newDirName, validateNameClientSide, createDir]);

  const handleMkdirInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleConfirmMkdir();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelMkdir();
      }
    },
    [handleConfirmMkdir, handleCancelMkdir],
  );

  // ── Keyboard navigation ──────────────────────────────────────────────────

  /**
   * Returns the index of the currently selected (or focused) entry.
   * Returns -1 if no entry is selected.
   */
  const selectedIndex = useCallback((): number => {
    if (selected.size === 0) return -1;
    const firstSelected = [...selected][0];
    return sortedEntries.findIndex((e) => e.path === firstSelected);
  }, [selected, sortedEntries]);

  /**
   * Focus the list row at `index`, clamped to valid range.
   */
  const focusRow = useCallback(
    (index: number) => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll<HTMLElement>("[data-entry-row]");
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      items[clamped]?.focus();
    },
    [],
  );

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      if (sortedEntries.length === 0) return;

      const idx = selectedIndex();

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIdx = idx < sortedEntries.length - 1 ? idx + 1 : idx;
          const next = sortedEntries[nextIdx];
          if (next) {
            select(next.path);
            onSelect?.(next.path);
            focusRow(nextIdx);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIdx = idx > 0 ? idx - 1 : 0;
          const prev = sortedEntries[prevIdx];
          if (prev) {
            select(prev.path);
            onSelect?.(prev.path);
            focusRow(prevIdx);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (idx >= 0) {
            const entry = sortedEntries[idx];
            if (entry?.isDirectory) {
              // Enter navigates into the directory — same as double-click.
              // onConfirm is intentionally NOT called here; confirmation
              // must be triggered by the explicit "Seleccionar carpeta" button.
              open(entry);
            }
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          clearSelection();
          break;
        }
        case "Backspace": {
          e.preventDefault();
          goUp();
          break;
        }
        default:
          break;
      }
    },
    [sortedEntries, selectedIndex, select, onSelect, focusRow, open, clearSelection, goUp],
  );

  // ── Focus first item when entries change (after navigation) ─────────────
  // This ensures keyboard users can continue navigating without an extra Tab press.
  const prevCwd = useRef<string>("");
  useEffect(() => {
    if (cwd && cwd !== prevCwd.current) {
      prevCwd.current = cwd;
      // Slight defer to let the DOM update
      requestAnimationFrame(() => {
        if (listRef.current) {
          const first = listRef.current.querySelector<HTMLElement>("[data-entry-row]");
          first?.focus();
        }
      });
    }
  }, [cwd]);

  // ── Render ───────────────────────────────────────────────────────────────
  // isAtRoot comes from the hook (Windows-aware)

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={style}
      data-testid="folder-explorer"
    >
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className={styles.toolbar} role="toolbar" aria-label="Folder explorer controls">

        {/* Up button */}
        <button
          type="button"
          className={styles.upButton}
          onClick={goUp}
          disabled={isAtRoot || loading}
          aria-label="Go up one directory level"
          title={isAtRoot ? "Already at root" : "Go up"}
        >
          <IconArrowUp />
        </button>

        {/* Reload button */}
        <button
          type="button"
          className={`${styles.reloadButton}${loading ? ` ${styles.spinning}` : ""}`}
          onClick={reload}
          disabled={!cwd || loading || creating}
          aria-label="Reload current folder"
          title="Reload"
        >
          <IconRefresh />
        </button>

        {allowCreateDir && (
          <>
            {!mkdirMode ? (
              <button
                ref={mkdirButtonRef}
                type="button"
                className={styles.mkdirButton}
                onClick={handleOpenMkdir}
                disabled={!cwd || loading || creating}
                aria-label="Create new directory"
                title="New folder"
              >
                <IconNewFolder />
              </button>
            ) : (
              <div className={styles.mkdirInline} role="group" aria-label="New directory name">
                <input
                  ref={newDirInputRef}
                  type="text"
                  className={`${styles.mkdirInput}${nameError ? ` ${styles.mkdirInputError}` : ""}`}
                  value={newDirName}
                  onChange={(e) => {
                    setNewDirName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  onKeyDown={handleMkdirInputKeyDown}
                  placeholder="New folder name…"
                  aria-label="New directory name"
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? `${uid}-mkdir-error` : undefined}
                  maxLength={255}
                  disabled={creating}
                  autoComplete="off"
                  spellCheck={false}
                />

                {nameError && (
                  <span
                    id={`${uid}-mkdir-error`}
                    className={styles.mkdirNameError}
                    role="alert"
                    aria-live="assertive"
                  >
                    {nameError}
                  </span>
                )}

                <button
                  type="button"
                  className={styles.mkdirConfirm}
                  onClick={() => void handleConfirmMkdir()}
                  disabled={creating || !newDirName.trim()}
                  aria-label="Confirm create directory"
                  title="Create"
                >
                  {creating ? <IconSpinner /> : <IconCheck />}
                </button>

                <button
                  type="button"
                  className={styles.mkdirCancel}
                  onClick={handleCancelMkdir}
                  disabled={creating}
                  aria-label="Cancel create directory"
                  title="Cancel"
                >
                  <IconX />
                </button>
              </div>
            )}
          </>
        )}

        {/* Breadcrumb nav */}
        <nav
          className={styles.breadcrumbs}
          aria-label="Folder breadcrumbs"
          data-testid="breadcrumbs"
        >
          {isDriveList ? (
            <ol className={styles.breadcrumbs}>
              <li className={styles.breadcrumbItem}>
                <span
                  className={styles.breadcrumbCurrent}
                  aria-current="location"
                  title="This PC"
                >
                  This PC
                </span>
              </li>
            </ol>
          ) : (
            <ol className={styles.breadcrumbs}>
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <li key={crumb.path} className={styles.breadcrumbItem}>
                    {i > 0 && (
                      <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                    )}
                    {isLast ? (
                      <span
                        className={styles.breadcrumbCurrent}
                        aria-current="location"
                        title={crumb.path}
                      >
                        {crumb.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.breadcrumbButton}
                        onClick={() => navigate(crumb.path)}
                        title={crumb.path}
                        aria-label={`Navigate to ${crumb.name}`}
                      >
                        {crumb.name}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </nav>

        {/* Hidden-files toggle */}
        <label className={styles.hiddenToggle} title="Show hidden entries (dot-files)">
          <input
            type="checkbox"
            className={styles.hiddenToggleCheckbox}
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            aria-label="Show hidden files and folders"
          />
          Hidden
        </label>
      </div>

      {/* ── Loading state ─────────────────────────────────────────────── */}
      {loading && (
        <div
          className={styles.statusRegion}
          role="status"
          aria-live="polite"
          aria-label="Loading folder contents"
          data-testid="loading-region"
        >
          <p className={styles.loadingMsg}>
            <span className={styles.loadingSpinner} aria-hidden="true" />
            Loading…
          </p>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────── */}
      {!loading && error && (
        <div
          className={styles.statusRegion}
          role="alert"
          aria-atomic="true"
          data-testid="error-region"
        >
          <div className={styles.errorBanner}>
            <span className={styles.errorCode}>{error.code}</span>
            <span className={styles.errorMessage}>{error.message}</span>
            <button
              type="button"
              className={styles.errorDismiss}
              onClick={clearError}
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Entry list ────────────────────────────────────────────────── */}
      {!loading && !error && (
        <>
          {isDriveList ? (
            /* ── Windows drive list view ─────────────────────────────── */
            <ul
              className={styles.driveList}
              role="listbox"
              aria-label="Available drives"
              data-testid="drive-list"
              onKeyDown={(e) => {
                if (e.key === "Backspace") {
                  e.preventDefault();
                  // Already at drive list — no-op (isAtRoot is true)
                }
              }}
            >
              {drives.map((drive) => (
                <DriveItem
                  key={drive.letter}
                  drive={drive}
                  onOpen={openDrive}
                />
              ))}
            </ul>
          ) : sortedEntries.length === 0 ? (
            <div
              className={styles.statusRegion}
              data-testid="empty-region"
            >
              <p className={styles.emptyMsg} aria-label="No items in this folder">
                {cwd ? "This folder is empty." : "No folder selected."}
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              className={styles.entryList}
              role="listbox"
              aria-label={`Contents of ${cwd || "folder"}`}
              aria-multiselectable="false"
              onKeyDown={handleListKeyDown}
              data-testid="entry-list"
            >
              {sortedEntries.map((entry, idx) => (
                <EntryRow
                  key={entry.path}
                  entry={entry}
                  index={idx}
                  isSelected={selected.has(entry.path)}
                  onSingleClick={(e) => {
                    select(e.path);
                    onSelect?.(e.path);
                  }}
                  onDoubleClick={(e) => {
                    if (e.isDirectory) {
                      // Double-click navigates into the directory only.
                      // onConfirm is intentionally NOT called here to prevent
                      // accidental collapse/close of the parent modal.
                      // Confirmation happens exclusively via the explicit
                      // "Seleccionar carpeta" button in the parent component.
                      open(e);
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── EntryRow sub-component ──────────────────────────────────────────────────

interface EntryRowProps {
  entry: Entry;
  index: number;
  isSelected: boolean;
  onSingleClick: (entry: Entry) => void;
  onDoubleClick: (entry: Entry) => void;
}

function EntryRow({ entry, isSelected, onSingleClick, onDoubleClick }: EntryRowProps) {  const rowRef = useRef<HTMLLIElement>(null);

  // Keyboard activation within row (Enter / Space while focused)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation(); // don't bubble to list handler
        if (e.key === "Enter" && entry.isDirectory) {
          onDoubleClick(entry);
        } else {
          onSingleClick(entry);
        }
      }
    },
    [entry, onSingleClick, onDoubleClick],
  );

  const entryClassName = [
    styles.entry,
    isSelected ? styles.entrySelected : "",
  ]
    .filter(Boolean)
    .join(" ");

  const iconClassName = [
    styles.entryIcon,
    entry.isDirectory ? styles.entryIconDir : "",
  ]
    .filter(Boolean)
    .join(" ");

  const nameClassName = [
    styles.entryName,
    !entry.isDirectory ? styles.entryNameFile : "",
  ]
    .filter(Boolean)
    .join(" ");

  const typeLabel = entry.isDirectory ? "Folder" : "File";

  return (
    <li
      ref={rowRef}
      className={entryClassName}
      role="option"
      aria-selected={isSelected}
      aria-label={`${typeLabel}: ${entry.name}`}
      tabIndex={isSelected ? 0 : -1}
      data-entry-row
      onClick={() => onSingleClick(entry)}
      onDoubleClick={() => onDoubleClick(entry)}
      onKeyDown={handleKeyDown}
      data-testid={`entry-${entry.name}`}
    >
      {/* Icon */}
      <span className={iconClassName} aria-hidden="true">
        {entry.isDirectory ? <IconFolder /> : <IconFile />}
      </span>

      {/* Name */}
      <span className={nameClassName}>{entry.name}</span>
    </li>
  );
}

// ── DriveItem sub-component ─────────────────────────────────────────────────

interface DriveItemProps {
  drive: Drive;
  onOpen: (drive: Drive) => void;
}

function DriveItem({ drive, onOpen }: DriveItemProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onOpen(drive);
      }
    },
    [drive, onOpen],
  );

  return (
    <li
      className={styles.driveItem}
      role="option"
      aria-selected={false}
      aria-label={`Drive ${drive.letter}`}
      tabIndex={0}
      onClick={() => onOpen(drive)}
      onDoubleClick={() => onOpen(drive)}
      onKeyDown={handleKeyDown}
      data-testid={`drive-${drive.letter}`}
    >
      <span className={styles.driveIcon} aria-hidden="true">💾</span>
      <span className={styles.driveLetter}>{drive.letter}</span>
    </li>
  );
}
