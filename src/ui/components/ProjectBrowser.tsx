/**
 * src/ui/components/ProjectBrowser.tsx
 *
 * Project Browser — the landing view of AgentsFlow.
 *
 * Allows the user to:
 *   1. Open an existing project via the native folder picker
 *   2. Create a new project (via NewProjectModal)
 *   3. Select from recently opened projects
 *   4. Validate a project directory without fully loading it
 *
 * This component is stateless — all async operations go through the
 * Zustand projectStore which calls window.agentsFlow (the IPC bridge).
 */

import { useEffect, useState } from "react";
import { useProjectStore } from "../store/projectStore.ts";
import { NewProjectModal } from "./NewProjectModal.tsx";
import logoEditorSvg from "../../assets/logos/logo editor.svg";

// ── Component ──────────────────────────────────────────────────────────────

export function ProjectBrowser() {
  const {
    isLoading,
    isValidating,
    recentProjects,
    lastError,
    openProjectDialog,
    openProject,
    validateProject,
    loadRecentProjects,
    clearError,
  } = useProjectStore();

  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Load recent projects when the browser mounts
  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);

  const isBusy = isLoading || isValidating;

  return (
    <div className="project-browser">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="project-browser__header">
        <img
          src={logoEditorSvg}
          alt="AgentsFlow logo"
          style={{ display: "block", maxWidth: "350px", width: "100%", margin: "0 auto 2rem auto" }}
        />
      </header>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {lastError && (
        <div className="project-browser__error" role="alert">
          <span className="project-browser__error-icon" aria-hidden="true">⚠️</span>
          <span className="project-browser__error-message">{lastError}</span>
          <button
            className="project-browser__error-close"
            onClick={clearError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────── */}
      <section className="project-browser__actions" aria-label="Project actions">
        {/* NEW: Create new project */}
        <button
          className="project-browser__btn project-browser__btn--primary"
          onClick={() => setShowNewProjectModal(true)}
          disabled={isBusy}
        >
          <span aria-hidden="true">✨</span>
          New Project
        </button>

        {/* Open existing project */}
        <button
          className="project-browser__btn project-browser__btn--secondary"
          onClick={openProjectDialog}
          disabled={isBusy}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <span className="project-browser__spinner" aria-hidden="true" />
              Opening…
            </>
          ) : (
            <>
              <span aria-hidden="true">📂</span>
              Open Project Folder
            </>
          )}
        </button>

        <p className="project-browser__hint">
          Select the root folder of an existing{" "}
          <code>.afproj</code> project, or create a new one.
        </p>
      </section>

      {/* ── Recent projects ────────────────────────────────────────── */}
      {recentProjects.length > 0 && (
        <section
          className="project-browser__recents"
          aria-label="Recently opened projects"
        >
          <h2 className="project-browser__recents-title">Recent Projects</h2>
          <ul className="project-browser__recents-list" role="list">
            {recentProjects.map((recent) => (
              <li
                key={recent.projectDir}
                className="project-browser__recent-item"
              >
                <div className="project-browser__recent-info">
                  <span className="project-browser__recent-name">
                    {recent.name}
                  </span>
                  <span className="project-browser__recent-path" title={recent.projectDir}>
                    {recent.projectDir}
                  </span>
                  <span className="project-browser__recent-date">
                    Last opened:{" "}
                    {new Date(recent.lastOpenedAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="project-browser__recent-actions">
                  <button
                    className="project-browser__btn project-browser__btn--secondary"
                    onClick={() => openProject(recent.projectDir)}
                    disabled={isBusy}
                    aria-label={`Open ${recent.name}`}
                  >
                    Open
                  </button>
                  <button
                    className="project-browser__btn project-browser__btn--ghost"
                    onClick={() => validateProject(recent.projectDir)}
                    disabled={isBusy}
                    aria-label={`Validate ${recent.name}`}
                  >
                    {isValidating ? "Validating…" : "Validate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Empty state ────────────────────────────────────────────── */}
      {recentProjects.length === 0 && !isBusy && (
        <div className="project-browser__empty" aria-live="polite">
          <span className="project-browser__empty-icon" aria-hidden="true">
            🗂️
          </span>
          <p>No recent projects. Create a new one or open an existing folder.</p>
        </div>
      )}

      {/* ── New Project Modal ──────────────────────────────────────── */}
      <NewProjectModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
      />
    </div>
  );
}
