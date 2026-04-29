import { useEffect, useCallback, useState } from "react";
import type { MouseEvent } from "react";
import { GitConfigPanel } from "./GitConfigPanel.tsx";
import { GitBranchesPanel } from "./GitBranchesPanel.tsx";
import { GitChangesPanel } from "./GitChangesPanel.tsx";
import { useProjectStore } from "../../store/projectStore.ts";
import { useGitConfig } from "../../hooks/useGitConfig.ts";

type GitSection = "config" | "branches" | "changes";

export interface GitIntegrationModalProps {
  onClose: () => void;
}

export function GitIntegrationModal({ onClose }: GitIntegrationModalProps) {
	const projectDir = useProjectStore((s) => s.project?.projectDir ?? null);
	const gitConfig = useGitConfig(projectDir);

  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

	const [activeSection, setActiveSection] = useState<GitSection>("config");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="git-integration-modal-title"
      onClick={handleBackdropClick}
    >
      <div className="modal modal--git" tabIndex={-1}>
        <header className="modal__header">
          <h2 className="modal__title" id="git-integration-modal-title">
            Git Integration
          </h2>
          <button
            className="modal__close-btn"
            onClick={onClose}
            aria-label="Close Git Integration"
          >
            ✕
          </button>
        </header>

        <div className="modal__body git-modal__body">
          <div className="git-modal__layout">
            <nav
              className="git-modal__sidebar"
              role="navigation"
              aria-label="Git sections"
            >
              <div role="tablist" aria-orientation="vertical">
					<button
						className={`git-modal__sidebar-btn${activeSection === "config" ? " git-modal__sidebar-btn--active" : ""}`}
						onClick={() => setActiveSection("config")}
						role="tab"
						aria-selected={activeSection === "config"}
						aria-controls="git-modal__content"
					>
						Config
					</button>
                <button
                  className={`git-modal__sidebar-btn${activeSection === "branches" ? " git-modal__sidebar-btn--active" : ""}`}
                  onClick={() => setActiveSection("branches")}
                  role="tab"
                  aria-selected={activeSection === "branches"}
                  aria-controls="git-modal__content"
                >
                  Branches
                </button>
                <button
                  className={`git-modal__sidebar-btn${activeSection === "changes" ? " git-modal__sidebar-btn--active" : ""}`}
                  onClick={() => setActiveSection("changes")}
                  role="tab"
                  aria-selected={activeSection === "changes"}
                  aria-controls="git-modal__content"
                >
                  Changes
                </button>
              </div>
            </nav>
            
            <div id="git-modal__content" className="git-modal__content" role="tabpanel">
				{activeSection === "config" && <GitConfigPanel projectDir={projectDir} gitConfig={gitConfig} />}
              {activeSection === "branches" && (
					<GitBranchesPanel protectedBranch={gitConfig.state.protectedBranch} />
				)}
              {activeSection === "changes" && (
					<GitChangesPanel protectedBranch={gitConfig.state.protectedBranch} />
				)}
            </div>
          </div>
        </div>

        <footer className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
