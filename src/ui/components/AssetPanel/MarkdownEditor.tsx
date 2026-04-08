/**
 * src/ui/components/AssetPanel/MarkdownEditor.tsx
 *
 * Central editing area with Godot-style tabs.
 *
 * Each open file is a tab. Within a tab there are two sub-panels:
 *   - "Editor"  → Monaco Editor (language: markdown)
 *   - "Preview" → Rendered HTML from marked
 *
 * Save: Save button in the tab bar, or Ctrl+S / Cmd+S.
 * Dirty indicator: dot on tab when unsaved.
 *
 * Closing a dirty tab asks for confirmation.
 */

import { useEffect, useCallback, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { marked } from "marked";
import { useAssetStore } from "../../store/assetStore.ts";
import type { AssetEditorTab } from "../../store/assetStore.ts";

// ── Marked configuration ──────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: true });

// ── Tab button ────────────────────────────────────────────────────────────

interface TabButtonProps {
  tab: AssetEditorTab;
  isActive: boolean;
}

function TabButton({ tab, isActive }: TabButtonProps) {
  const { setActiveTab, closeTab } = useAssetStore();

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    if (tab.dirty) {
      const ok = window.confirm(`"${tab.name}" has unsaved changes. Close anyway?`);
      if (!ok) return;
    }
    closeTab(tab.filePath);
  }

  return (
    <div
      className={`md-editor__tab${isActive ? " md-editor__tab--active" : ""}${tab.dirty ? " md-editor__tab--dirty" : ""}`}
      onClick={() => setActiveTab(tab.filePath)}
      title={tab.filePath}
    >
      <span className="md-editor__tab-name">{tab.name}</span>
      {tab.dirty && <span className="md-editor__tab-dot" aria-label="unsaved" />}
      <button
        className="md-editor__tab-close"
        onClick={handleClose}
        aria-label={`Close ${tab.name}`}
        title="Close"
      >
        ×
      </button>
    </div>
  );
}

// ── Preview panel ─────────────────────────────────────────────────────────

interface PreviewPanelProps {
  content: string;
}

function PreviewPanel({ content }: PreviewPanelProps) {
  const html = marked.parse(content) as string;

  return (
    <div
      className="md-editor__preview"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output is local .md only
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── MarkdownEditor ─────────────────────────────────────────────────────────

export function MarkdownEditor() {
  const {
    tabs,
    activeTabPath,
    setTabPanel,
    updateTabContent,
    saveTab,
  } = useAssetStore();

  const activeTab = tabs.find((t) => t.filePath === activeTabPath) ?? null;

  // ── Ctrl+S / Cmd+S save ───────────────────────────────────────────────

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && e.key === "s";
      if (!isSave) return;
      e.preventDefault();
      const tab = activeTabRef.current;
      if (tab?.dirty) {
        saveTab(tab.filePath);
      }
    },
    [saveTab]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── No tabs open ──────────────────────────────────────────────────────

  if (tabs.length === 0) {
    return (
      <div className="md-editor md-editor--empty">
        <span aria-hidden="true">📝</span>
        <p>Open a file to start editing.</p>
        <p className="md-editor__empty-hint">
          Double-click a file or click <strong>Edit</strong> in the file list.
        </p>
      </div>
    );
  }

  return (
    <div className="md-editor">
      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="md-editor__tabbar" role="tablist">
        {tabs.map((tab) => (
          <TabButton key={tab.filePath} tab={tab} isActive={tab.filePath === activeTabPath} />
        ))}
      </div>

      {/* ── Active tab content ────────────────────────────────────────── */}
      {activeTab && (
        <div className="md-editor__content">
          {/* Sub-panel selector (Editor / Preview) + Save button */}
          <div className="md-editor__subbar">
            <div className="md-editor__subbar-tabs">
              <button
                className={`md-editor__subpanel-btn${activeTab.panel === "editor" ? " md-editor__subpanel-btn--active" : ""}`}
                onClick={() => setTabPanel(activeTab.filePath, "editor")}
              >
                Editor
              </button>
              <button
                className={`md-editor__subpanel-btn${activeTab.panel === "preview" ? " md-editor__subpanel-btn--active" : ""}`}
                onClick={() => setTabPanel(activeTab.filePath, "preview")}
              >
                Preview
              </button>
            </div>

            <div className="md-editor__subbar-actions">
              <span className="md-editor__filename">{activeTab.name}</span>
              {activeTab.dirty && (
                <span className="md-editor__dirty-badge">● unsaved</span>
              )}
              <button
                className={`md-editor__save-btn${activeTab.dirty ? " md-editor__save-btn--active" : ""}`}
                onClick={() => saveTab(activeTab.filePath)}
                disabled={!activeTab.dirty}
                title="Save (Ctrl+S)"
              >
                Save
              </button>
            </div>
          </div>

          {/* Panel: Monaco Editor */}
          {activeTab.panel === "editor" && (
            <div className="md-editor__monaco-wrap">
              <MonacoEditor
                key={activeTab.filePath}
                language="markdown"
                value={activeTab.content}
                theme="vs-dark"
                onChange={(val) => {
                  if (val !== undefined) {
                    updateTabContent(activeTab.filePath, val);
                  }
                }}
                options={{
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  fontFamily: "'Fira Code', 'Cascadia Code', 'SF Mono', monospace",
                  padding: { top: 12, bottom: 12 },
                  overviewRulerLanes: 0,
                  renderLineHighlight: "line",
                  smoothScrolling: true,
                }}
              />
            </div>
          )}

          {/* Panel: Preview */}
          {activeTab.panel === "preview" && (
            <PreviewPanel content={activeTab.content} />
          )}
        </div>
      )}
    </div>
  );
}
