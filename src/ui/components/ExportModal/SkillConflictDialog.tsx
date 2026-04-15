/**
 * src/ui/components/ExportModal/SkillConflictDialog.tsx
 *
 * Modal dialog displayed when a skill file already exists at the export
 * destination and the user must decide whether to overwrite it.
 *
 * # Trigger
 *
 *   Rendered by App.tsx as a global portal (createPortal → document.body)
 *   when `skillConflictPrompt` is non-null in agentFlowStore.
 *
 * # Actions
 *
 *   Replace This  — replace only the current conflicting file, continue asking
 *   Replace All   — replace this file AND all remaining conflicts silently
 *   Cancel        — abort the entire skills export immediately
 *
 * # Props
 *
 *   prompt    The conflict prompt received from the main process.
 *             Contains: promptId, skillName, fileName.
 *   onAction  Called with the user's chosen action. Parent is responsible for
 *             forwarding the response to the main process via respondSkillConflict().
 *
 * # Accessibility
 *
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby points to the dialog title
 *   - Buttons have descriptive title attributes
 */

import React from "react";
import type { ExportSkillsConflictPrompt, ExportSkillsConflictAction } from "../../../electron/bridge.types.ts";

// ── Props ──────────────────────────────────────────────────────────────────

export interface SkillConflictDialogProps {
  /** The conflict prompt sent by the main process. null = dialog hidden. */
  prompt: ExportSkillsConflictPrompt | null;
  /** Called when the user selects an action. */
  onAction: (action: ExportSkillsConflictAction) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SkillConflictDialog({ prompt, onAction }: SkillConflictDialogProps) {
  if (!prompt) return null;

  const { skillName, fileName } = prompt;

  // Message format: "[skillName]/fileName ya existe. ¿Reemplazar?"
  const conflictPath = `${skillName}/${fileName}`;

  return (
    <div
      className="skill-conflict-dialog__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-conflict-dialog-title"
    >
      <div className="skill-conflict-dialog__container">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="skill-conflict-dialog__header">
          <h2
            id="skill-conflict-dialog-title"
            className="skill-conflict-dialog__title"
          >
            File already exists
          </h2>
        </div>

        {/* ── Message ──────────────────────────────────────────────── */}
        <div className="skill-conflict-dialog__body">
          <p className="skill-conflict-dialog__message">
            <code className="skill-conflict-dialog__path">{conflictPath}</code>
            {" "}ya existe. ¿Reemplazar?
          </p>
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="skill-conflict-dialog__actions">
          <button
            className="skill-conflict-dialog__btn skill-conflict-dialog__btn--replace"
            onClick={() => onAction("replace")}
            title="Replace this file and continue asking for subsequent conflicts"
            autoFocus
          >
            Replace This
          </button>
          <button
            className="skill-conflict-dialog__btn skill-conflict-dialog__btn--replace-all"
            onClick={() => onAction("replace-all")}
            title="Replace this and all remaining conflicting files without asking again"
          >
            Replace All
          </button>
          <button
            className="skill-conflict-dialog__btn skill-conflict-dialog__btn--cancel"
            onClick={() => onAction("cancel")}
            title="Cancel the entire skills export"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
