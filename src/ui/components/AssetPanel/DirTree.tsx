/**
 * src/ui/components/AssetPanel/DirTree.tsx
 *
 * Sidebar directory tree for the Assets panel.
 *
 * Shows ONLY directories (never files). Starting at projectRoot, the user
 * can expand/collapse folders. CRUD operations available per node:
 *   - Create subdirectory
 *   - Rename directory
 *   - Delete directory (with confirmation)
 *
 * Selecting a directory updates the right panel via assetStore.selectDir().
 */

import { useState, useRef, useEffect } from "react";
import { useAssetStore } from "../../store/assetStore.ts";
import type { AssetDirEntry } from "../../../electron/bridge.types.ts";

// ── Inline confirm dialog ──────────────────────────────────────────────────

interface ConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function InlineConfirm({ message, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className="dirtree__confirm">
      <span className="dirtree__confirm-msg">{message}</span>
      <button className="dirtree__confirm-yes btn btn--danger-sm" onClick={onConfirm}>
        Delete
      </button>
      <button className="dirtree__confirm-no btn btn--ghost-sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ── Inline name input ──────────────────────────────────────────────────────

interface InlineInputProps {
  initialValue?: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function InlineInput({ initialValue = "", placeholder, onCommit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      const trimmed = value.trim();
      if (trimmed) onCommit(trimmed);
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <input
      ref={ref}
      className="dirtree__inline-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKey}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed) onCommit(trimmed);
        else onCancel();
      }}
    />
  );
}

// ── DirNode ────────────────────────────────────────────────────────────────

type DirNodeMode =
  | { kind: "idle" }
  | { kind: "renaming" }
  | { kind: "creating-child" }
  | { kind: "confirming-delete" };

interface DirNodeProps {
  entry: AssetDirEntry;
  depth: number;
  /** The parent's absolute path (needed for refreshChildren) */
  parentPath: string;
}

function DirNode({ entry, depth, parentPath }: DirNodeProps) {
  const {
    selectedDir,
    expandedDirs,
    childrenMap,
    selectDir,
    toggleDir,
    createDir,
    renameDir,
    deleteDir,
    refreshChildren,
  } = useAssetStore();

  const [mode, setMode] = useState<DirNodeMode>({ kind: "idle" });

  const isSelected = selectedDir === entry.path;
  const isExpanded = expandedDirs.has(entry.path);
  const children = childrenMap[entry.path] ?? [];

  function handleClick() {
    selectDir(entry.path);
  }

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    toggleDir(entry.path);
  }

  async function handleCreateChild(name: string) {
    setMode({ kind: "idle" });
    await createDir(entry.path, name);
    // Ensure the parent is expanded to show the new child
    if (!expandedDirs.has(entry.path)) {
      toggleDir(entry.path);
    }
  }

  async function handleRename(newName: string) {
    setMode({ kind: "idle" });
    await renameDir(entry.path, newName);
    // Also refresh this node's parent (if parent is projectRoot, refreshTopDirs
    // is called inside renameDir; otherwise refreshChildren(parentPath))
    await refreshChildren(parentPath);
  }

  async function handleDelete() {
    setMode({ kind: "idle" });
    await deleteDir(entry.path);
  }

  const indent = depth * 14;

  return (
    <li className="dirtree__node-li">
      {/* ── Node row ──────────────────────────────────────────────────── */}
      <div
        className={`dirtree__node${isSelected ? " dirtree__node--selected" : ""}`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={handleClick}
        title={entry.path}
      >
        {/* Expand/collapse arrow */}
        <button
          className="dirtree__toggle"
          onClick={handleToggle}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <span className={`dirtree__arrow${isExpanded ? " dirtree__arrow--open" : ""}`}>›</span>
        </button>

        {/* Folder icon */}
        <span className="dirtree__icon" aria-hidden="true">
          {isExpanded ? "📂" : "📁"}
        </span>

        {/* Name or rename input */}
        {mode.kind === "renaming" ? (
          <InlineInput
            initialValue={entry.name}
            placeholder="Folder name"
            onCommit={handleRename}
            onCancel={() => setMode({ kind: "idle" })}
          />
        ) : (
          <span className="dirtree__name">{entry.name}</span>
        )}

        {/* Actions (visible on hover) */}
        {mode.kind === "idle" && (
          <span className="dirtree__actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="dirtree__btn"
              title="New subfolder"
              aria-label="New subfolder"
              onClick={() => {
                setMode({ kind: "creating-child" });
                if (!expandedDirs.has(entry.path)) toggleDir(entry.path);
              }}
            >
              +
            </button>
            <button
              className="dirtree__btn"
              title="Rename folder"
              aria-label="Rename folder"
              onClick={() => setMode({ kind: "renaming" })}
            >
              ✏️
            </button>
            <button
              className="dirtree__btn dirtree__btn--danger"
              title="Delete folder"
              aria-label="Delete folder"
              onClick={() => setMode({ kind: "confirming-delete" })}
            >
              🗑
            </button>
          </span>
        )}
      </div>

      {/* ── Inline confirmation ──────────────────────────────────────── */}
      {mode.kind === "confirming-delete" && (
        <InlineConfirm
          message={`Delete "${entry.name}" and all its contents?`}
          onConfirm={handleDelete}
          onCancel={() => setMode({ kind: "idle" })}
        />
      )}

      {/* ── Children (expanded) ──────────────────────────────────────── */}
      {isExpanded && (
        <ul className="dirtree__children">
          {/* New subfolder input at top */}
          {mode.kind === "creating-child" && (
            <li className="dirtree__node-li" style={{ paddingLeft: `${8 + indent + 14}px` }}>
              <div className="dirtree__node" style={{ paddingLeft: `${8 + indent + 14}px` }}>
                <span className="dirtree__icon" aria-hidden="true">📁</span>
                <InlineInput
                  placeholder="New folder name"
                  onCommit={handleCreateChild}
                  onCancel={() => setMode({ kind: "idle" })}
                />
              </div>
            </li>
          )}
          {children.map((child) => (
            <DirNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              parentPath={entry.path}
            />
          ))}
          {children.length === 0 && mode.kind !== "creating-child" && (
            <li className="dirtree__empty-children" style={{ paddingLeft: `${8 + indent + 14}px` }}>
              Empty folder
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// ── DirTree root ───────────────────────────────────────────────────────────

export function DirTree() {
  const {
    projectRoot,
    selectedDir,
    topDirs,
    isLoading,
    refreshTopDirs,
    selectDir,
  } = useAssetStore();

  const [creatingTop, setCreatingTop] = useState(false);

  async function handleCreateTop(name: string) {
    if (!projectRoot) return;
    setCreatingTop(false);
    const { createDir } = useAssetStore.getState();
    await createDir(projectRoot, name);
  }

  return (
    <div className="dirtree">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="dirtree__header">
        <span className="dirtree__header-title">Folders</span>
        <div className="dirtree__header-actions">
          <button
            className="dirtree__btn"
            title="New top-level folder"
            aria-label="New top-level folder"
            onClick={() => setCreatingTop(true)}
          >
            +
          </button>
          <button
            className="dirtree__btn"
            title="Refresh"
            aria-label="Refresh folders"
            onClick={refreshTopDirs}
          >
            ↺
          </button>
        </div>
      </div>

      {/* ── Tree ───────────────────────────────────────────────────── */}
      <ul className="dirtree__list">
        {/* Root / project row */}
        <li className="dirtree__node-li">
          <div
            className={`dirtree__node dirtree__node--root${selectedDir === projectRoot || !selectedDir ? " dirtree__node--selected" : ""}`}
            style={{ paddingLeft: "8px" }}
            onClick={() => projectRoot && selectDir(projectRoot)}
            title={projectRoot ?? ""}
          >
            <span className="dirtree__icon" aria-hidden="true">🏠</span>
            <span className="dirtree__name">Project Root</span>
          </div>
        </li>

        {/* New top-level folder input */}
        {creatingTop && (
          <li className="dirtree__node-li" style={{ paddingLeft: "14px" }}>
            <div className="dirtree__node" style={{ paddingLeft: "14px" }}>
              <span className="dirtree__icon" aria-hidden="true">📁</span>
              <InlineInput
                placeholder="New folder name"
                onCommit={handleCreateTop}
                onCancel={() => setCreatingTop(false)}
              />
            </div>
          </li>
        )}

        {/* Loading */}
        {isLoading && topDirs.length === 0 && (
          <li className="dirtree__loading">Loading…</li>
        )}

        {/* Empty */}
        {!isLoading && topDirs.length === 0 && !creatingTop && (
          <li className="dirtree__empty">No folders yet. Click + to create one.</li>
        )}

        {/* Top-level dirs */}
        {topDirs.map((dir) => (
          <DirNode
            key={dir.path}
            entry={dir}
            depth={0}
            parentPath={projectRoot ?? ""}
          />
        ))}
      </ul>
    </div>
  );
}
