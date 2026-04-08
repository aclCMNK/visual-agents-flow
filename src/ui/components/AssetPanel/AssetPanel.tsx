/**
 * src/ui/components/AssetPanel/AssetPanel.tsx
 *
 * Top-level Assets panel view.
 *
 * Layout:
 *   [Topbar: project name + "← Back" button]
 *   [Left sidebar: DirTree (240px)]  |  [Right main: FileList + MarkdownEditor]
 *
 * The right side itself is split vertically:
 *   [FileList — fixed height or collapsed]
 *   [MarkdownEditor — flex-1, fills remaining space]
 *
 * When no editor tabs are open, MarkdownEditor shows an empty state.
 * When tabs are open, the FileList shrinks to leave room for the editor.
 */

import { useEffect } from "react";
import { useProjectStore } from "../../store/projectStore.ts";
import { useAssetStore } from "../../store/assetStore.ts";
import { DirTree } from "./DirTree.tsx";
import { FileList } from "./FileList.tsx";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { AssetToasts } from "./AssetToasts.tsx";

export function AssetPanel() {
  const { project, navigate } = useProjectStore();
  const { initRoot, tabs, projectRoot } = useAssetStore();

  // Initialize the asset browser whenever the project changes or the panel mounts
  useEffect(() => {
    const root = project?.projectDir;
    if (root && root !== projectRoot) {
      initRoot(root);
    }
  }, [project?.projectDir, projectRoot, initRoot]);

  const hasEditor = tabs.length > 0;

  return (
    <div className="asset-panel">
      {/* ── Topbar ────────────────────────────────────────────────────── */}
      <header className="asset-panel__topbar">
        <button
          className="asset-panel__back-btn"
          onClick={() => navigate("editor")}
          aria-label="Back to Agent Editor"
        >
          ← Editor
        </button>
        <span className="asset-panel__title">
          Assets
          {project && (
            <span className="asset-panel__project-name">
              {" "}— {project.name}
            </span>
          )}
        </span>
      </header>

      {/* ── Main layout ───────────────────────────────────────────────── */}
      <div className="asset-panel__body">
        {/* ── Left sidebar: directory tree ────────────────────────── */}
        <aside className="asset-panel__sidebar" aria-label="Directory tree">
          <DirTree />
        </aside>

        {/* ── Right: file list + editor ───────────────────────────── */}
        <div className="asset-panel__right">
          {/* File list (always visible; shrinks when editor is open) */}
          <div className={`asset-panel__file-area${hasEditor ? " asset-panel__file-area--compact" : ""}`}>
            <FileList />
          </div>

          {/* Editor area (shown when any tab is open) */}
          <div className="asset-panel__editor-area">
            <MarkdownEditor />
          </div>
        </div>
      </div>

      {/* ── Toast notifications ───────────────────────────────────────── */}
      <AssetToasts />
    </div>
  );
}
