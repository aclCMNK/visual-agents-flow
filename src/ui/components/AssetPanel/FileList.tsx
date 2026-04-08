/**
 * src/ui/components/AssetPanel/FileList.tsx
 *
 * Right panel for the Assets panel.
 *
 * When a directory is selected, shows:
 *   1. Immediate .md files (with actions: open/edit, rename, delete)
 *   2. Immediate subdirectories (click-to-navigate shortcut)
 *
 * Actions toolbar: New .md file, Import .md file.
 * All destructive actions require confirmation.
 */

import { useState, useRef, useEffect } from "react";
import { useAssetStore } from "../../store/assetStore.ts";
import type { AssetFileEntry, AssetDirEntry } from "../../../electron/bridge.types.ts";

// ── Shared inline input ───────────────────────────────────────────────────

interface InlineInputProps {
  initialValue?: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  suffix?: string;
}

function InlineInput({ initialValue = "", placeholder, onCommit, onCancel, suffix }: InlineInputProps) {
  const [value, setValue] = useState(
    initialValue.endsWith(".md") ? initialValue.slice(0, -3) : initialValue
  );
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      const trimmed = value.trim();
      if (trimmed) onCommit(trimmed + (suffix ?? ""));
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <span className="filelist__inline-wrap">
      <input
        ref={ref}
        className="filelist__inline-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => {
          const trimmed = value.trim();
          if (trimmed) onCommit(trimmed + (suffix ?? ""));
          else onCancel();
        }}
      />
      {suffix && <span className="filelist__inline-suffix">{suffix}</span>}
    </span>
  );
}

// ── FileRow ────────────────────────────────────────────────────────────────

interface FileRowProps {
  file: AssetFileEntry;
}

type FileRowMode = "idle" | "renaming" | "confirming-delete";

function FileRow({ file }: FileRowProps) {
  const { openFile, deleteFile, renameFile } = useAssetStore();
  const [mode, setMode] = useState<FileRowMode>("idle");

  async function handleDelete() {
    setMode("idle");
    await deleteFile(file.path);
  }

  async function handleRename(newName: string) {
    setMode("idle");
    await renameFile(file.path, newName);
  }

  return (
    <li className="filelist__file-row">
      {/* Icon */}
      <span className="filelist__file-icon" aria-hidden="true">📄</span>

      {/* Name or rename input */}
      {mode === "renaming" ? (
        <InlineInput
          initialValue={file.name}
          placeholder="File name"
          suffix=".md"
          onCommit={handleRename}
          onCancel={() => setMode("idle")}
        />
      ) : (
        <span
          className="filelist__file-name"
          onDoubleClick={() => openFile(file)}
          title={file.path}
        >
          {file.name}
        </span>
      )}

      {/* Actions */}
      {mode === "idle" && (
        <span className="filelist__file-actions">
          <button
            className="filelist__btn"
            title="Edit"
            aria-label={`Edit ${file.name}`}
            onClick={() => openFile(file)}
          >
            ✏️
          </button>
          <button
            className="filelist__btn"
            title="Rename"
            aria-label={`Rename ${file.name}`}
            onClick={() => setMode("renaming")}
          >
            Aa
          </button>
          <button
            className="filelist__btn filelist__btn--danger"
            title="Delete"
            aria-label={`Delete ${file.name}`}
            onClick={() => setMode("confirming-delete")}
          >
            🗑
          </button>
        </span>
      )}

      {/* Confirm delete */}
      {mode === "confirming-delete" && (
        <span className="filelist__confirm" onClick={(e) => e.stopPropagation()}>
          <span className="filelist__confirm-msg">Delete "{file.name}"?</span>
          <button className="filelist__btn filelist__btn--danger-sm" onClick={handleDelete}>
            Yes
          </button>
          <button className="filelist__btn filelist__btn--ghost-sm" onClick={() => setMode("idle")}>
            No
          </button>
        </span>
      )}
    </li>
  );
}

// ── SubdirRow ──────────────────────────────────────────────────────────────

interface SubdirRowProps {
  dir: AssetDirEntry;
}

function SubdirRow({ dir }: SubdirRowProps) {
  const { selectDir } = useAssetStore();

  return (
    <li
      className="filelist__subdir-row"
      onClick={() => selectDir(dir.path)}
      title={`Open folder: ${dir.path}`}
    >
      <span className="filelist__file-icon" aria-hidden="true">📁</span>
      <span className="filelist__file-name filelist__file-name--dir">{dir.name}</span>
      <span className="filelist__subdir-hint">→</span>
    </li>
  );
}

// ── Import confirmation ────────────────────────────────────────────────────

interface ImportConfirmProps {
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ImportConfirm({ fileName, onConfirm, onCancel }: ImportConfirmProps) {
  return (
    <div className="filelist__import-confirm">
      <span>"{fileName}" already exists. Overwrite?</span>
      <button className="filelist__btn filelist__btn--danger-sm" onClick={onConfirm}>
        Overwrite
      </button>
      <button className="filelist__btn filelist__btn--ghost-sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ── FileList ───────────────────────────────────────────────────────────────

export function FileList() {
  const {
    selectedDir,
    dirContents,
    isLoading,
    createFile,
    importFile,
    refreshDirContents,
    projectRoot,
  } = useAssetStore();

  const [creatingFile, setCreatingFile] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ srcPath: string; name: string } | null>(null);

  const isEmpty =
    !dirContents ||
    (dirContents.files.length === 0 && dirContents.subdirs.length === 0);

  const displayPath = selectedDir
    ? projectRoot
      ? selectedDir.replace(projectRoot, "").replace(/^[\\/]/, "") || "/"
      : selectedDir
    : null;

  async function handleCreateFile(name: string) {
    setCreatingFile(false);
    if (!selectedDir) return;
    await createFile(selectedDir, name);
  }

  async function handleImport() {
    if (!selectedDir) return;
    // Use assetOpenMdDialog to get the path, then check existence first
    const bridge = (window as unknown as { agentsFlow?: Window["agentsFlow"] }).agentsFlow;
    if (!bridge) return;

    const srcPath = await bridge.assetOpenMdDialog();
    if (!srcPath) return;

    const srcName = srcPath.split(/[\\/]/).pop() ?? "file.md";
    const existingFile = dirContents?.files.find((f) => f.name === srcName);

    if (existingFile) {
      // Show overwrite confirmation before importing
      setPendingImport({ srcPath, name: srcName });
      return;
    }

    // No conflict — import directly without re-opening the dialog
    const result = await bridge.assetImportFile(srcPath, selectedDir);
    if (result.success) {
      useAssetStore.getState().pushToast("success", `"${srcName}" imported successfully.`);
      await refreshDirContents();
    } else {
      useAssetStore.getState().pushToast("error", result.error ?? "Import failed.");
    }
  }

  async function confirmImport() {
    if (!pendingImport || !selectedDir) {
      setPendingImport(null);
      return;
    }
    // Import (overwrite)
    const bridge = (window as unknown as { agentsFlow?: Window["agentsFlow"] }).agentsFlow;
    if (!bridge) {
      setPendingImport(null);
      return;
    }
    const result = await bridge.assetImportFile(pendingImport.srcPath, selectedDir);
    if (result.success) {
      useAssetStore.getState().pushToast("success", `"${pendingImport.name}" imported (overwritten).`);
      await refreshDirContents();
    } else {
      useAssetStore.getState().pushToast("error", result.error ?? "Import failed.");
    }
    setPendingImport(null);
  }

  if (!selectedDir) {
    return (
      <div className="filelist filelist--empty">
        <span aria-hidden="true">📂</span>
        <p>Select a folder in the sidebar to browse its contents.</p>
      </div>
    );
  }

  return (
    <div className="filelist">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="filelist__toolbar">
        <span className="filelist__path" title={selectedDir}>
          {displayPath}
        </span>
        <div className="filelist__toolbar-actions">
          <button
            className="filelist__toolbar-btn"
            title="New .md file"
            aria-label="New markdown file"
            onClick={() => setCreatingFile(true)}
          >
            + New file
          </button>
          <button
            className="filelist__toolbar-btn"
            title="Import .md file"
            aria-label="Import markdown file"
            onClick={handleImport}
          >
            ↑ Import
          </button>
          <button
            className="filelist__toolbar-btn"
            title="Refresh"
            aria-label="Refresh directory"
            onClick={refreshDirContents}
          >
            ↺
          </button>
        </div>
      </div>

      {/* ── Import overwrite confirmation ─────────────────────────── */}
      {pendingImport && (
        <ImportConfirm
          fileName={pendingImport.name}
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {/* ── Content ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="filelist__loading">Loading…</div>
      ) : (
        <ul className="filelist__list">
          {/* New file input */}
          {creatingFile && (
            <li className="filelist__file-row filelist__file-row--creating">
              <span className="filelist__file-icon" aria-hidden="true">📄</span>
              <InlineInput
                placeholder="filename"
                suffix=".md"
                onCommit={handleCreateFile}
                onCancel={() => setCreatingFile(false)}
              />
            </li>
          )}

          {/* Subdirectories first */}
          {dirContents?.subdirs.map((dir) => (
            <SubdirRow key={dir.path} dir={dir} />
          ))}

          {/* .md files */}
          {dirContents?.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}

          {/* Empty state */}
          {isEmpty && !creatingFile && (
            <li className="filelist__empty-state">
              <span aria-hidden="true">📭</span>
              <span>No .md files here. Create or import one.</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
