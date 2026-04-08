/**
 * src/ui/components/ProjectSaveBar.tsx
 *
 * ProjectSaveBar — inline editable fields for the project's name and
 * description, with a Save button that calls projectStore.saveProject().
 *
 * Behavior:
 *   - Shows the current project name and description as editable inputs.
 *   - Tracks local dirty state (unsaved changes).
 *   - On Save: calls store.saveProject() with only the changed fields.
 *   - On Discard: resets inputs to the last saved values.
 *   - Shows a spinner while saving, and a brief success indicator on completion.
 *   - If save fails, displays the error inline.
 *
 * Constraints:
 *   - Only name and description are editable here (other fields require
 *     direct .afproj editing).
 *   - Name must not be empty.
 */

import { useState, useEffect, useCallback } from "react";
import { useProjectStore } from "../store/projectStore.ts";

// ── Component ──────────────────────────────────────────────────────────────

export function ProjectSaveBar() {
  const { project, isSaving, lastError, saveProject, clearError } = useProjectStore();

  const [localName, setLocalName] = useState(project?.name ?? "");
  const [localDescription, setLocalDescription] = useState(project?.description ?? "");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync local state when the project changes (e.g., after a reload)
  useEffect(() => {
    setLocalName(project?.name ?? "");
    setLocalDescription(project?.description ?? "");
  }, [project?.name, project?.description]);

  const isDirty =
    localName !== (project?.name ?? "") ||
    localDescription !== (project?.description ?? "");

  const nameIsValid = localName.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!isDirty || !nameIsValid) return;

    clearError();
    setSaveSuccess(false);

    await saveProject({
      ...(localName !== project?.name ? { name: localName.trim() } : {}),
      ...(localDescription !== project?.description ? { description: localDescription } : {}),
    });

    // Only flash success if the store didn't record an error.
    const currentError = useProjectStore.getState().lastError;
    if (!currentError) {
      setSaveSuccess(true);
      const t = setTimeout(() => setSaveSuccess(false), 2000);
      return () => clearTimeout(t);
    }
  }, [isDirty, nameIsValid, localName, localDescription, project, saveProject, clearError]);

  const handleDiscard = useCallback(() => {
    setLocalName(project?.name ?? "");
    setLocalDescription(project?.description ?? "");
    clearError();
    setSaveSuccess(false);
  }, [project, clearError]);

  if (!project) return null;

  return (
    <div
      className={`project-save-bar ${isDirty ? "project-save-bar--dirty" : ""}`}
      role="group"
      aria-label="Edit project metadata"
    >
      {/* ── Name field ─────────────────────────────────────────────── */}
      <div className="project-save-bar__field">
        <label className="project-save-bar__label" htmlFor="project-name-input">
          Name
        </label>
        <input
          id="project-name-input"
          className={`project-save-bar__input ${!nameIsValid ? "project-save-bar__input--error" : ""}`}
          type="text"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          disabled={isSaving}
          placeholder="Project name"
          aria-required
          aria-invalid={!nameIsValid}
          aria-describedby={!nameIsValid ? "project-name-error" : undefined}
          maxLength={80}
        />
        {!nameIsValid && (
          <span id="project-name-error" className="project-save-bar__field-error" role="alert">
            Name cannot be empty
          </span>
        )}
      </div>

      {/* ── Description field ───────────────────────────────────────── */}
      <div className="project-save-bar__field project-save-bar__field--grow">
        <label className="project-save-bar__label" htmlFor="project-description-input">
          Description
        </label>
        <input
          id="project-description-input"
          className="project-save-bar__input"
          type="text"
          value={localDescription}
          onChange={(e) => setLocalDescription(e.target.value)}
          disabled={isSaving}
          placeholder="Short project description (optional)"
          maxLength={200}
        />
      </div>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="project-save-bar__actions">
        {isDirty && (
          <button
            className="project-save-bar__btn project-save-bar__btn--ghost"
            onClick={handleDiscard}
            disabled={isSaving}
            aria-label="Discard changes"
          >
            Discard
          </button>
        )}

        <button
          className={`project-save-bar__btn project-save-bar__btn--save ${saveSuccess ? "project-save-bar__btn--saved" : ""}`}
          onClick={handleSave}
          disabled={isSaving || !isDirty || !nameIsValid}
          aria-busy={isSaving}
          aria-label={isSaving ? "Saving…" : saveSuccess ? "Saved" : "Save project"}
        >
          {isSaving ? (
            <>
              <span className="project-save-bar__spinner" aria-hidden="true" />
              Saving…
            </>
          ) : saveSuccess ? (
            <><span aria-hidden="true">✅</span> Saved</>
          ) : (
            <><span aria-hidden="true">💾</span> Save</>
          )}
        </button>
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {lastError && (
        <div className="project-save-bar__error" role="alert">
          <span aria-hidden="true">⚠️</span> {lastError}
          <button
            className="project-save-bar__error-close"
            onClick={clearError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
