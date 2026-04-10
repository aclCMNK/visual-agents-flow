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
 *   - "assets"     → AssetPanel (markdown file manager)
 *
 * Project Loader Integration:
 *   - While `isLoading` is true (any view), a full-screen spinner overlay is shown.
 *   - When a project successfully loads for the first time (project id changes),
 *     the agentFlowStore is hydrated via `loadFromProject`:
 *       · Agents → CanvasAgent[] (from serialized agents, with agentType/isOrchestrator)
 *       · Links  → AgentLink[]   (from connections[], restoring relationType/delegationType/ruleDetails)
 *       · panelOpen restored from project.properties.ui.panelOpen
 *   - Canvas viewport (zoom/pan) is restored by remounting FlowCanvas via key={project.id}
 *     since FlowCanvas reads project.properties.canvasView on mount.
 *   - On success: a green "Project loaded!" toast is shown for 2.5 s.
 *   - On any load error: a red animated toast is shown for 5 s.
 *
 * Sidebar:
 *   - A single unified "Agents" section lists all canvas/flow agents (AgentTreeItem).
 *   - Clicking an agent opens its rich detail panel on the right (pulled from project.agents).
 *   - Double-clicking (or the ✏️ button) opens the AgentEditModal to rename/retype.
 *   - The old "Project Agents" section (AgentCard list) was removed; flow agents
 *     serve the same purpose after loadFromProject hydration.
 *
 * All text and notifications are in English.
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "./store/projectStore.ts";
import { useAgentFlowStore } from "./store/agentFlowStore.ts";
import { ProjectBrowser } from "./components/ProjectBrowser.tsx";
import { ValidationPanel } from "./components/ValidationPanel.tsx";
import { ProjectSaveBar } from "./components/ProjectSaveBar.tsx";
import { AgentGraphSaveButton } from "./components/AgentGraphSaveButton.tsx";
import { FlowCanvas } from "./components/FlowCanvas.tsx";
import { AgentTreeItem } from "./components/AgentTreeItem.tsx";
import { AgentEditModal } from "./components/AgentEditModal.tsx";
import { AssetPanel } from "./components/AssetPanel/index.ts";
import { PropertiesPanel } from "./components/PropertiesPanel.tsx";
import { AgentProfileModal } from "./components/AgentProfiling/AgentProfileModal.tsx";
import { PermissionsModal } from "./components/Permissions/index.ts";

// ── Load Toast ─────────────────────────────────────────────────────────────
// Shown after a project load operation completes (success or error).

type LoadToastKind = "success" | "error";

interface LoadToast {
  kind: LoadToastKind;
  message: string;
}

interface LoadToastProps {
  toast: LoadToast;
  onDismiss: () => void;
}

function LoadToast({ toast, onDismiss }: LoadToastProps) {
  return (
    <div
      className={`project-load-toast project-load-toast--${toast.kind}`}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span aria-hidden="true">
        {toast.kind === "success" ? "✅" : "⚠️"}
      </span>
      <span className="project-load-toast__msg">{toast.message}</span>
      <button
        className="project-load-toast__close"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

// ── Loading Overlay ────────────────────────────────────────────────────────
// Full-screen semi-transparent overlay shown while a project is being loaded.

function LoadingOverlay() {
  return (
    <div className="project-load-overlay" role="status" aria-label="Loading project…">
      <div className="project-load-overlay__card">
        <span className="project-load-overlay__spinner" aria-hidden="true" />
        <span className="project-load-overlay__text">Loading project…</span>
      </div>
    </div>
  );
}

// ── Editor View ────────────────────────────────────────────────────────────
// Shows the loaded project with an agent list panel + canvas.

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
          <AgentGraphSaveButton />
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
          {/* ── Agents header + "New agent" button ──────────────── */}
          <div className="editor-view__sidebar-header">
            <h2 className="editor-view__sidebar-title">Agents</h2>
            <span className="editor-view__sidebar-count">{flowAgents.length}</span>
            <button
              className={`editor-view__new-agent-btn${isPlacing ? " editor-view__new-agent-btn--active" : ""}`}
              onClick={startPlacement}
              disabled={isPlacing}
              title="Add a new agent to the canvas"
              aria-label="New agent"
            >
              + New agent
            </button>
          </div>

          {/* ── Flow agents list (canvas nodes, editable, selectable) ── */}
          {flowAgents.length > 0 ? (
            <ul className="editor-view__flow-agent-list" role="list">
              {flowAgents.map((agent) => (
                <li key={agent.id}>
                  <AgentTreeItem
                    agent={agent}
                    selected={selectedAgentId === agent.id}
                    onSelect={setSelectedAgentId}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="editor-view__sidebar-empty">
              <span aria-hidden="true">🤖</span>
              <p>No agents yet.<br />Click <strong>+ New agent</strong> to start.</p>
            </div>
          )}
        </aside>

        {/* ── Center: canvas + agent detail ──────────────────────── */}
        <div className="editor-view__canvas-area">
          <section className="editor-view__canvas-section" aria-label="Flow canvas">
            {selectedAgent ? (
              // ── Agent detail panel ────────────────────────────────────
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
              // ── Flow Canvas ─────────────────────────────────────────────
              // key={project?.id} ensures FlowCanvas remounts on project change,
              // which causes getInitialViewport() to re-read project.properties.canvasView
              // and restore the persisted zoom / pan state.
              <FlowCanvas key={project?.id} />
            )}
          </section>
        </div>

        {/* ── Right properties panel ─────────────────────────────── */}
        <PropertiesPanel />
      </div>

      {/* ── Agent Edit Modal (portal-like, rendered at editor-view level) ── */}
      <AgentEditModal />
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export function App() {
  const currentView   = useProjectStore((s) => s.currentView);
  const isLoading     = useProjectStore((s) => s.isLoading);
  const isRepairing   = useProjectStore((s) => s.isRepairing);
  const project       = useProjectStore((s) => s.project);
  const lastLoadResult = useProjectStore((s) => s.lastLoadResult);

  const loadFromProject = useAgentFlowStore((s) => s.loadFromProject);
  const resetFlow       = useAgentFlowStore((s) => s.resetFlow);

  // ── Global Agent Profile modal portal ───────────────────────────────────
  // Mounted directly under document.body so it escapes every stacking context
  // (properties panel, minimap, zoom controls, etc.) and appears topmost.
  const profileModalTarget = useAgentFlowStore((s) => s.profileModalTarget);
  const closeProfileModal  = useAgentFlowStore((s) => s.closeProfileModal);

  // ── Global Permissions modal portal ─────────────────────────────────────
  // Same pattern as AgentProfileModal — mounted at document.body level.
  const permissionsModalTarget = useAgentFlowStore((s) => s.permissionsModalTarget);
  const closePermissionsModal  = useAgentFlowStore((s) => s.closePermissionsModal);

  // ── Toast state (project load success / error) ───────────────────────────
  const [loadToast, setLoadToast] = useState<LoadToast | null>(null);

  // Track the last project id we hydrated so we only call loadFromProject once per load.
  const hydratedProjectId = useRef<string | null>(null);

  // Auto-dismiss toast after a delay
  useEffect(() => {
    if (!loadToast) return;
    const delay = loadToast.kind === "success" ? 2500 : 5000;
    const t = setTimeout(() => setLoadToast(null), delay);
    return () => clearTimeout(t);
  }, [loadToast]);

  // ── Hydrate agentFlowStore when a new project is loaded ─────────────────
  //
  // Fires when:
  //   - project becomes non-null for the first time (initial load)
  //   - project.id changes (different project opened)
  //
  // Does NOT fire on every render — only when project identity changes.
  useEffect(() => {
    if (!project) {
      // Project was closed or not yet loaded — reset the flow store
      if (hydratedProjectId.current !== null) {
        resetFlow();
        hydratedProjectId.current = null;
      }
      return;
    }

    // Already hydrated for this project — skip
    if (hydratedProjectId.current === project.id) return;

    try {
      loadFromProject(project);
      hydratedProjectId.current = project.id;
      setLoadToast({ kind: "success", message: "Project loaded!" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadToast({ kind: "error", message: `Failed to reconstruct canvas: ${message}` });
    }
  }, [project, loadFromProject, resetFlow]);

  // ── Show error toast when load fails with no project (hard error) ────────
  // lastLoadResult is set even on failure — if it has errors and no project,
  // show a toast so the user gets feedback even from the browser view.
  const lastFailedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastLoadResult) return;
    if (lastLoadResult.success) return;
    if (lastLoadResult.summary.errors === 0) return;

    // Use timestamp as a unique key so we don't repeat the same toast
    const key = lastLoadResult.timestamp;
    if (lastFailedRef.current === key) return;
    lastFailedRef.current = key;

    const errMsg = `Project failed to load — ${lastLoadResult.summary.errors} error(s). See Validation panel.`;
    setLoadToast({ kind: "error", message: errMsg });
  }, [lastLoadResult]);

  // Whether to show the overlay — covers both load and repair operations
  const showOverlay = isLoading || isRepairing;

  return (
    <div className="app" data-view={currentView}>
      {currentView === "browser"    && <ProjectBrowser />}
      {currentView === "validation" && <ValidationPanel />}
      {currentView === "editor"     && <EditorView />}
      {currentView === "assets"     && <AssetPanel />}

      {/* ── Full-screen loading overlay (shown during any project load) ── */}
      {showOverlay && <LoadingOverlay />}

      {/* ── Project load toast (success / error) ─────────────────────── */}
      {loadToast && (
        <LoadToast toast={loadToast} onDismiss={() => setLoadToast(null)} />
      )}

      {/* ── Agent Profile modal — global portal, above ALL overlays ─────── */}
      {/* Mounted directly on document.body via createPortal so it escapes  */}
      {/* the properties-panel stacking context (z-index hierarchy).        */}
      {profileModalTarget !== null &&
        createPortal(
          <AgentProfileModal
            agentId={profileModalTarget.agentId}
            agentName={profileModalTarget.agentName}
            projectDir={profileModalTarget.projectDir}
            onClose={closeProfileModal}
          />,
          document.body
        )}

      {/* ── Permissions modal — global portal, above ALL overlays ──────── */}
      {/* Same portal pattern as AgentProfileModal.                        */}
      {permissionsModalTarget !== null &&
        createPortal(
          <PermissionsModal
            agentId={permissionsModalTarget.agentId}
            agentName={permissionsModalTarget.agentName}
            projectDir={permissionsModalTarget.projectDir}
            onClose={closePermissionsModal}
          />,
          document.body
        )}
    </div>
  );
}
