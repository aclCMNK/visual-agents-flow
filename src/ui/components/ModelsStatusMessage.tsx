/**
 * src/ui/components/ModelsStatusMessage.tsx
 *
 * Models Status Message — informational banner for models.dev data state
 * ────────────────────────────────────────────────────────────────────────
 * Renders a compact, non-blocking text message in the ProjectBrowser
 * indicating the current state of the models.dev API data download.
 *
 * BEHAVIOUR
 * ─────────
 *   kind: "info"    → Shown while loading; no auto-dismiss.
 *   kind: "success" → Auto-dismiss after 3 seconds.
 *   kind: "warning" → Auto-dismiss after 5 seconds.
 *   kind: "error"   → Permanent; user must click ✕ to dismiss.
 *
 * ACCESSIBILITY
 * ─────────────
 *   role="status"   for info, success, warning (polite announcements)
 *   role="alert"    for error (assertive — requires user attention)
 *   aria-live="polite"    for non-error kinds
 *   aria-live="assertive" for error
 */

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MessageKind = "info" | "success" | "warning" | "error";

export interface ModelsStatusMessageProps {
  message: string;
  kind: MessageKind;
  /** If true, shows a ✕ button for manual dismissal (used for "error" kind). */
  dismissible: boolean;
  /** Called when the user clicks the ✕ button or auto-dismiss fires. */
  onDismiss?: () => void;
}

// ── Auto-dismiss delays ───────────────────────────────────────────────────────

const AUTO_DISMISS_DELAYS: Partial<Record<MessageKind, number>> = {
  success: 3_000,
  warning: 5_000,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelsStatusMessage({
  message,
  kind,
  dismissible,
  onDismiss,
}: ModelsStatusMessageProps) {
  const [visible, setVisible] = useState(true);

  // Reset visibility whenever the message or kind changes
  useEffect(() => {
    setVisible(true);
  }, [message, kind]);

  // Auto-dismiss for success (3s) and warning (5s)
  useEffect(() => {
    const delay = AUTO_DISMISS_DELAYS[kind];
    if (delay === undefined) return;

    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, delay);

    return () => clearTimeout(timer);
  }, [kind, message, onDismiss]);

  if (!visible) return null;

  const isError = kind === "error";
  const role = isError ? "alert" : "status";
  const ariaLive = isError ? "assertive" : "polite";

  return (
    <div
      className={`models-status-message models-status-message--${kind}`}
      role={role}
      aria-live={ariaLive}
    >
      <span className="models-status-message__text">{message}</span>
      {dismissible && (
        <button
          className="models-status-message__close"
          onClick={() => {
            setVisible(false);
            onDismiss?.();
          }}
          aria-label="Dismiss models data notification"
          type="button"
        >
          ✕
        </button>
      )}
    </div>
  );
}
