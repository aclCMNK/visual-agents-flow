/**
 * src/ui/components/AgentGraphSaveButton.tsx
 *
 * Save button for the agent graph editor — global topbar variant.
 *
 * All save logic is delegated to the shared useAgentGraphSave hook so that
 * this component and AgentCanvasSaveButton share identical behaviour without
 * duplicating the IPC call, serialisation, toast, or sync-error modal logic.
 */

import { useAgentGraphSave } from "../hooks/useAgentGraphSave.ts";

// ── Component ──────────────────────────────────────────────────────────────

export function AgentGraphSaveButton() {
  const {
    isDirty,
    isSavingGraph,
    isDisabled,
    hasProject,
    handleSave,
    handleRetrySync,
    isRetryingSync,
    toast,
    setToast,
    syncErrorModal,
    setSyncErrorModal,
  } = useAgentGraphSave();

  // Don't render if no project is open
  if (!hasProject) return null;

  return (
    <>
      {/* ── Save button ──────────────────────────────────────────────── */}
      <button
        className={[
          "agent-graph-save-btn",
          isDirty ? "agent-graph-save-btn--active" : "",
          isSavingGraph ? "agent-graph-save-btn--saving" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={handleSave}
        disabled={isDisabled}
        aria-busy={isSavingGraph}
        aria-label={
          isSavingGraph
            ? "Saving…"
            : isDirty
            ? "Save project (unsaved changes)"
            : "Save project (no unsaved changes)"
        }
        title={
          isDirty
            ? "Save agent graph to disk"
            : "No unsaved changes"
        }
      >
        {isSavingGraph ? (
          <>
            <span className="agent-graph-save-btn__spinner" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <span aria-hidden="true">{isDirty ? "💾" : "✓"}</span>
            {isDirty ? "Save" : "Saved"}
          </>
        )}
      </button>

      {/* ── Toast notification ──────────────────────────────────────── */}
      {toast && (
        <div
          className={`agent-graph-toast agent-graph-toast--${toast.kind}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span aria-hidden="true">
            {toast.kind === "success" ? "✅" : "⚠️"}
          </span>
          <span>{toast.message}</span>
          <button
            className="agent-graph-toast__close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Sync error modal ──────────────────────────────────────────── */}
      {syncErrorModal && (
        <div
          className="agent-graph-sync-error-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-error-modal-title"
        >
          <div className="agent-graph-sync-error-modal">
            <h3 id="sync-error-modal-title" className="agent-graph-sync-error-modal__title">
              <span aria-hidden="true">⚠️</span> Sync Delegation Permissions — Partial Failure
            </h3>
            <p className="agent-graph-sync-error-modal__desc">
              The graph was saved successfully, but <strong>permissions.task</strong> could not
              be updated for the following agent{syncErrorModal.errors.length !== 1 ? "s" : ""}:
            </p>
            <ul className="agent-graph-sync-error-modal__errors" aria-label="Failed agents">
              {syncErrorModal.errors.map((err, i) => (
                <li key={i} className="agent-graph-sync-error-modal__error-item">
                  <code>{err}</code>
                </li>
              ))}
            </ul>
            <div className="agent-graph-sync-error-modal__actions">
              <button
                className="agent-graph-sync-error-modal__retry"
                onClick={handleRetrySync}
                disabled={isRetryingSync}
                aria-busy={isRetryingSync}
              >
                {isRetryingSync ? (
                  <>
                    <span className="agent-graph-save-btn__spinner" aria-hidden="true" />
                    Retrying…
                  </>
                ) : (
                  "⚡ Retry Sync"
                )}
              </button>
              <button
                className="agent-graph-sync-error-modal__dismiss"
                onClick={() => setSyncErrorModal(null)}
                disabled={isRetryingSync}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
