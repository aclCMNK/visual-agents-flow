/**
 * src/ui/components/AgentCanvasSaveButton.tsx
 *
 * Canvas-overlay Save button — floating panel anchored to the top-right of
 * the FlowCanvas container, rendered OUTSIDE the viewport transform so it is
 * never scaled or panned with the graph.
 *
 * Visibility:
 *   • Rendered only when a project is open AND isDirty === true.
 *   • Fades/scales in on appearance (200 ms) — suppressed when the user has
 *     prefers-reduced-motion enabled.
 *
 * Size:
 *   • ~33% larger than the topbar variant via the `agent-graph-save-btn--canvas`
 *     modifier class (padding: 8px 20px, font-size: 1rem).
 *
 * Accessibility:
 *   • aria-label reflects current state (dirty / saving).
 *   • aria-busy during async save.
 *   • Visible focus outline (keyboard navigation).
 *
 * Optional badge (feature-flag prop):
 *   • `showBadge` — when true, renders a small circular badge with the
 *     `dirtyCount` prop value (if provided) overlaid on the button.
 *
 * Feedback:
 *   • Renders its own toast and sync-error modal via the shared hook.
 *     This keeps toast/modal co-located with the button that triggered them.
 */

import React from "react";
import { useAgentGraphSave } from "../hooks/useAgentGraphSave.ts";

// ── Props ──────────────────────────────────────────────────────────────────

interface AgentCanvasSaveButtonProps {
  /**
   * When true, renders a small numeric badge on the button.
   * Feature-flag: off by default, non-blocking.
   */
  showBadge?: boolean;
  /**
   * Number to display in the badge (e.g. unsaved-change count).
   * Only visible when showBadge is true and value > 0.
   */
  dirtyCount?: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function AgentCanvasSaveButton({
  showBadge = false,
  dirtyCount,
}: AgentCanvasSaveButtonProps) {
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

  // Hidden when no project, or nothing to save
  if (!hasProject || !isDirty) return null;

  const hasBadge = showBadge && typeof dirtyCount === "number" && dirtyCount > 0;

  return (
    <>
      {/* ── Canvas save overlay ────────────────────────────────────────── */}
      <div
        className="canvas-save-overlay"
        // Prevent canvas pan events from being blocked by this overlay
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Badge (optional, feature-flag) */}
        {hasBadge && (
          <span
            className="canvas-save-overlay__badge"
            aria-label={`${dirtyCount} unsaved change${dirtyCount !== 1 ? "s" : ""}`}
          >
            {dirtyCount! > 99 ? "99+" : dirtyCount}
          </span>
        )}

        <button
          className={[
            "agent-graph-save-btn",
            "agent-graph-save-btn--canvas",
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
              : "Save & Sync Delegations (unsaved changes)"
          }
          title="Save & Sync Delegations — writes agent graph and syncs delegation permissions to disk"
        >
          {isSavingGraph ? (
            <>
              <span className="agent-graph-save-btn__spinner" aria-hidden="true" />
              Saving…
            </>
          ) : (
            <>
              <span aria-hidden="true">💾</span>
              Save &amp; Sync Delegations
            </>
          )}
        </button>
      </div>

      {/* ── Toast notification ──────────────────────────────────────────── */}
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

      {/* ── Sync error modal ──────────────────────────────────────────────── */}
      {syncErrorModal && (
        <div
          className="agent-graph-sync-error-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="canvas-sync-error-modal-title"
        >
          <div className="agent-graph-sync-error-modal">
            <h3
              id="canvas-sync-error-modal-title"
              className="agent-graph-sync-error-modal__title"
            >
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
