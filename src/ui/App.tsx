/**
 * src/ui/App.tsx
 *
 * Root application component for AgentsFlow.
 *
 * Renders the correct view based on the current route in the projectStore.
 * Views:
 *   - "browser"    → ProjectBrowser (open/create project)
 *   - "validation" → ValidationPanel (errors/warnings from loader)
 *   - "editor"     → EditorView (agent list + canvas placeholder)
 *
 * The App is intentionally thin — it only routes between views.
 * All state logic lives in projectStore.ts.
 */

import { useState } from "react";
import { useProjectStore } from "./store/projectStore.ts";
import { useAgentFlowStore } from "./store/agentFlowStore.ts";
import { ProjectBrowser } from "./components/ProjectBrowser.tsx";
import { ValidationPanel } from "./components/ValidationPanel.tsx";
import { AgentCard } from "./components/AgentCard.tsx";
import { ProjectSaveBar } from "./components/ProjectSaveBar.tsx";
import { FlowCanvas } from "./components/FlowCanvas.tsx";
import { AgentTreeItem } from "./components/AgentTreeItem.tsx";
import { AgentEditModal } from "./components/AgentEditModal.tsx";
import { AssetPanel } from "./components/AssetPanel/index.ts";

// ── Editor View ────────────────────────────────────────────────────────────
// Shows the loaded project with an agent list panel + canvas placeholder.
// The actual flow canvas editor will replace the placeholder in a future phase.

function EditorView() {
  const { project, navigate, lastLoadResult, lastError, clearError } =
    useProjectStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // ── Canvas / flow store ──────────────────────────────────────────────────
  const flowAgents = useAgentFlowStore((s) => s.agents);
  const isPlacing = useAgentFlowStore((s) => s.isPlacing);
  const startPlacement = useAgentFlowStore((s) => s.startPlacement);

  const issueCount = lastLoadResult?.issues.length ?? 0;
  const errorCount = lastLoadResult?.summary.errors ?? 0;
  const warningCount = lastLoadResult?.summary.warnings ?? 0;

  const selectedAgent = project?.agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div className="editor-view">
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header className="editor-view__topbar">
        <button
          className="editor-view__topbar-btn"
          onClick={() => navigate("browser")}
          aria-label="Back to Project Browser"
        >
          ← Projects
        </button>

        <div className="editor-view__topbar-center">
          <span className="editor-view__project-name">
            {project?.name ?? "Untitled Project"}
          </span>
          {issueCount > 0 && (
            <button
              className={`editor-view__issue-badge ${errorCount > 0 ? "editor-view__issue-badge--error" : "editor-view__issue-badge--warning"}`}
              onClick={() => navigate("validation")}
              aria-label={`${issueCount} issue${issueCount !== 1 ? "s" : ""} — click to view`}
              title="Click to open Validation Panel"
            >
              {errorCount > 0 ? "❌" : "⚠️"}{" "}
              {errorCount > 0
                ? `${errorCount} error${errorCount !== 1 ? "s" : ""}`
                : `${warningCount} warning${warningCount !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>

        <div className="editor-view__topbar-actions">
          <button
            className="editor-view__topbar-btn"
            onClick={() => navigate("assets")}
            title="Open the Assets panel to manage .md files"
          >
            📂 Assets
          </button>
          <button
            className="editor-view__topbar-btn"
            onClick={() => navigate("validation")}
          >
            Validation
          </button>
          <button
            className="editor-view__topbar-btn editor-view__topbar-btn--disabled"
            disabled
            aria-disabled="true"
            title="Export is not yet available"
          >
            Export JSON
          </button>
        </div>
      </header>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {lastError && (
        <div className="editor-view__error-banner" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{lastError}</span>
          <button
            className="editor-view__error-close"
            onClick={clearError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Save bar ────────────────────────────────────────────────── */}
      <ProjectSaveBar />

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="editor-view__main">
        {/* ── Agent sidebar ──────────────────────────────────────── */}
        <aside className="editor-view__sidebar" aria-label="Agents">
          {/* ── Loaded agents from project ──────────────────────── */}
          {project && project.agents.length > 0 && (
            <>
              <div className="editor-view__sidebar-header">
                <h2 className="editor-view__sidebar-title">Project Agents</h2>
                <span className="editor-view__sidebar-count">
                  {project.agents.length}
                </span>
              </div>
              <ul className="editor-view__agent-list" role="list">
                {project.agents.map((agent) => (
                  <li key={agent.id}>
                    <AgentCard
                      agent={agent}
                      selected={selectedAgentId === agent.id}
                      onSelect={setSelectedAgentId}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* ── Flow agents (canvas nodes) ──────────────────────── */}
          <div className="editor-view__sidebar-header editor-view__sidebar-header--flow">
            <h2 className="editor-view__sidebar-title">Flow Agents</h2>
            <span className="editor-view__sidebar-count">{flowAgents.length}</span>
            <button
              className={`editor-view__new-agent-btn${isPlacing ? " editor-view__new-agent-btn--active" : ""}`}
              onClick={startPlacement}
              disabled={isPlacing}
              title="Add a new agent to the canvas"
              aria-label="Nuevo agente"
            >
              + Nuevo agente
            </button>
          </div>

          {flowAgents.length > 0 ? (
            <ul className="editor-view__flow-agent-list" role="list">
              {flowAgents.map((agent) => (
                <li key={agent.id}>
                  <AgentTreeItem agent={agent} />
                </li>
              ))}
            </ul>
          ) : (
            !project?.agents.length && (
              <div className="editor-view__sidebar-empty">
                <span aria-hidden="true">🤖</span>
                <p>No agents yet.<br />Click <strong>+ Nuevo agente</strong> to start.</p>
              </div>
            )
          )}
        </aside>

        {/* ── Canvas ─────────────────────────────────────────────── */}
        <section className="editor-view__canvas-section" aria-label="Flow canvas">
          {selectedAgent ? (
            // ── Agent detail panel ──────────────────────────────────
            <div className="editor-view__agent-detail">
              <header className="editor-view__detail-header">
                <h2 className="editor-view__detail-name">{selectedAgent.name}</h2>
                {selectedAgent.isEntrypoint && (
                  <span className="agent-card__badge agent-card__badge--entrypoint">
                    ⚡ entrypoint
                  </span>
                )}
                <button
                  className="editor-view__detail-close"
                  onClick={() => setSelectedAgentId(null)}
                  aria-label="Close agent detail"
                >
                  ✕
                </button>
              </header>

              <dl className="editor-view__detail-meta">
                <dt>ID</dt>
                <dd><code>{selectedAgent.id}</code></dd>
                <dt>Description</dt>
                <dd>{selectedAgent.description || <em>No description</em>}</dd>
                <dt>Profile</dt>
                <dd><code>{selectedAgent.profilePath}</code></dd>
                <dt>Metadata</dt>
                <dd><code>{selectedAgent.adataPath}</code></dd>
              </dl>

              {selectedAgent.aspects.length > 0 && (
                <section className="editor-view__detail-section">
                  <h3 className="editor-view__detail-section-title">
                    Aspects ({selectedAgent.aspects.length})
                  </h3>
                  <ul className="editor-view__detail-list">
                    {selectedAgent.aspects.map((a) => (
                      <li key={a.id} className={`editor-view__detail-item ${a.enabled ? "" : "editor-view__detail-item--disabled"}`}>
                        <span className="editor-view__detail-item-name">{a.name}</span>
                        <code className="editor-view__detail-item-path">{a.filePath}</code>
                        <span className="editor-view__detail-item-status">
                          {a.enabled ? "✅" : "○"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {selectedAgent.skills.length > 0 && (
                <section className="editor-view__detail-section">
                  <h3 className="editor-view__detail-section-title">
                    Skills ({selectedAgent.skills.length})
                  </h3>
                  <ul className="editor-view__detail-list">
                    {selectedAgent.skills.map((s) => (
                      <li key={s.id} className={`editor-view__detail-item ${s.enabled ? "" : "editor-view__detail-item--disabled"}`}>
                        <span className="editor-view__detail-item-name">{s.name}</span>
                        <code className="editor-view__detail-item-path">{s.filePath}</code>
                        <span className="editor-view__detail-item-status">
                          {s.enabled ? "✅" : "○"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {selectedAgent.subagents.length > 0 && (
                <section className="editor-view__detail-section">
                  <h3 className="editor-view__detail-section-title">
                    Subagents ({selectedAgent.subagents.length})
                  </h3>
                  <ul className="editor-view__detail-list">
                    {selectedAgent.subagents.map((sub) => (
                      <li key={sub.id} className="editor-view__detail-item">
                        <span className="editor-view__detail-item-name">{sub.name}</span>
                        <span className="editor-view__detail-item-desc">{sub.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {selectedAgent.profileContent && (
                <section className="editor-view__detail-section">
                  <h3 className="editor-view__detail-section-title">Profile.md</h3>
                  <pre className="editor-view__profile-preview">
                    {selectedAgent.profileContent.slice(0, 800)}
                    {selectedAgent.profileContent.length > 800 && "\n\n[… truncated for display]"}
                  </pre>
                </section>
              )}
            </div>
          ) : (
            // ── Flow Canvas ──────────────────────────────────────────
            <FlowCanvas />
          )}
        </section>
      </div>

      {/* ── Agent Edit Modal (portal-like, rendered at editor-view level) ── */}
      <AgentEditModal />
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export function App() {
  const currentView = useProjectStore((s) => s.currentView);

  return (
    <div className="app" data-view={currentView}>
      {currentView === "browser" && <ProjectBrowser />}
      {currentView === "validation" && <ValidationPanel />}
      {currentView === "editor" && <EditorView />}
      {currentView === "assets" && <AssetPanel />}
    </div>
  );
}
