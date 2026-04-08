/**
 * src/ui/components/NewProjectModal.tsx
 *
 * Modal dialog for creating a new AgentFlow project.
 *
 * Flow:
 *   1. User types a project name (required) and optional description.
 *   2. User clicks "Choose Folder" → native dialog (SELECT_NEW_PROJECT_DIR).
 *   3. The chosen dir is validated immediately (VALIDATE_NEW_PROJECT_DIR).
 *   4. A new subdirectory named after the project slug is ALWAYS created inside
 *      the selected folder. Files are never placed directly in the user's folder.
 *   5. On "Create Project", the form is submitted and the store action runs.
 *   6. On success the modal closes and the editor opens.
 *   7. On error an error banner is shown inside the modal.
 *
 * Edge cases handled:
 *   - User cancels the folder dialog → no change in state
 *   - Directory has no write permissions → error banner
 *   - Directory already contains a project subdir with same name → error banner
 *   - Network/IPC error → error banner with retry
 *   - Escape key / backdrop click → closes modal, resets form
 *
 * This component is purely presentational — all async work goes through
 * the projectStore.createProject and projectStore.validateNewProjectDir actions.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useProjectStore } from "../store/projectStore.ts";
import type { NewProjectDirValidation } from "../../electron/bridge.types.ts";

// ── Props ──────────────────────────────────────────────────────────────────

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function NewProjectModal({ isOpen, onClose }: NewProjectModalProps) {
  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [dirValidation, setDirValidation] = useState<NewProjectDirValidation | null>(null);
  const [isValidatingDir, setIsValidatingDir] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── Store ──────────────────────────────────────────────────────────────
  const { isLoading, selectNewProjectDir, validateNewProjectDir, createProject } = useProjectStore();

  // ── Refs ───────────────────────────────────────────────────────────────
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Reset form when modal opens ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setSelectedDir(null);
      setDirValidation(null);
      setLocalError(null);
      // Focus name input after a tick (so the modal has rendered)
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ── Escape key closes modal ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  // ── Backdrop click closes modal ────────────────────────────────────────
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && !isLoading) {
        onClose();
      }
    },
    [isLoading, onClose]
  );

  // ── Choose directory via native dialog ─────────────────────────────────
  const handleChooseDir = useCallback(async () => {
    setLocalError(null);
    setDirValidation(null);

    try {
      // Invoke the native folder picker via the store (goes through IPC bridge safely)
      const dir = await selectNewProjectDir();
      if (!dir) return; // User cancelled

      setSelectedDir(dir);
      setIsValidatingDir(true);

      // Immediately validate the chosen dir (checks write permission on the base dir)
      const validation = await validateNewProjectDir(dir);

      if (validation === null) {
        // Bridge error — validation failed to execute (e.g. IPC error)
        setLocalError("Could not validate the selected folder. Check the error banner above.");
        return;
      }

      setDirValidation(validation);

      if (!validation.valid) {
        setLocalError(validation.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(message);
    } finally {
      setIsValidatingDir(false);
    }
  }, [selectNewProjectDir, validateNewProjectDir]);

  // ── Form validation ────────────────────────────────────────────────────
  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    selectedDir !== null &&
    (dirValidation?.valid ?? false) &&
    !isLoading &&
    !isValidatingDir;

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !selectedDir) return;
      setLocalError(null);

      // The project-factory always creates a named subdirectory inside selectedDir.
      // No `createSubdir` flag needed — it is always enforced on the main process.
      const result = await createProject({
        projectDir: selectedDir,
        name: trimmedName,
        description: description.trim(),
      });

      if (result.success) {
        onClose();
      } else {
        setLocalError(result.error ?? "Failed to create project.");
      }
    },
    [canSubmit, selectedDir, trimmedName, description, createProject, onClose]
  );

  // ── Render ─────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  const dirStatusIcon = isValidatingDir
    ? "⏳"
    : !dirValidation
    ? null
    : dirValidation.valid
    ? dirValidation.severity === "warn"
      ? "⚠️"
      : "✅"
    : "❌";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-modal-title"
      onClick={handleBackdropClick}
    >
      <div
        className="modal new-project-modal"
        ref={dialogRef}
        tabIndex={-1}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="modal__header">
          <h2 className="modal__title" id="new-project-modal-title">
            New Project
          </h2>
          <button
            className="modal__close-btn"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </header>

        {/* ── Error banner ─────────────────────────────────────────── */}
        {localError && (
          <div className="modal__error-banner" role="alert">
            <span aria-hidden="true">❌</span>
            <span>{localError}</span>
            <button
              className="modal__error-dismiss"
              onClick={() => setLocalError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Form ─────────────────────────────────────────────────── */}
        <form className="modal__body" onSubmit={handleSubmit} noValidate>
          {/* Name */}
          <div className="form-field">
            <label htmlFor="new-project-name" className="form-field__label">
              Project Name <span aria-hidden="true" className="form-field__required">*</span>
            </label>
            <input
              id="new-project-name"
              ref={nameInputRef}
              type="text"
              className="form-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Agent Project"
              maxLength={200}
              required
              disabled={isLoading}
              aria-required="true"
            />
            {trimmedName.length === 0 && name.length > 0 && (
              <span className="form-field__hint form-field__hint--error">
                Project name cannot be empty.
              </span>
            )}
          </div>

          {/* Description */}
          <div className="form-field">
            <label htmlFor="new-project-description" className="form-field__label">
              Description <span className="form-field__optional">(optional)</span>
            </label>
            <textarea
              id="new-project-description"
              className="form-field__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              maxLength={2000}
              rows={3}
              disabled={isLoading}
            />
          </div>

          {/* Directory picker */}
          <div className="form-field">
            <label className="form-field__label">
              Location <span aria-hidden="true" className="form-field__required">*</span>
            </label>
            <p className="form-field__hint form-field__hint--info">
              A new folder named after the project will be created inside the selected location.
            </p>

            <div className="form-field__dir-row">
              <span
                className="form-field__dir-path"
                title={selectedDir ?? "No folder selected"}
                aria-live="polite"
              >
                {selectedDir ?? (
                  <span className="form-field__dir-placeholder">No folder selected</span>
                )}
                {dirStatusIcon && (
                  <span className="form-field__dir-status" aria-label={dirValidation?.message}>
                    {" "}{dirStatusIcon}
                  </span>
                )}
              </span>

              <button
                type="button"
                className="btn btn--secondary form-field__dir-btn"
                onClick={handleChooseDir}
                disabled={isLoading || isValidatingDir}
              >
                {isValidatingDir ? "Validating…" : "Choose Folder"}
              </button>
            </div>

            {/* Validation message */}
            {dirValidation && (
              <span
                className={`form-field__hint ${
                  !dirValidation.valid
                    ? "form-field__hint--error"
                    : dirValidation.severity === "warn"
                    ? "form-field__hint--warn"
                    : "form-field__hint--ok"
                }`}
                aria-live="polite"
              >
                {dirValidation.message}
              </span>
            )}

            {/* Preview of the project subdirectory that will be created */}
            {selectedDir && trimmedName.length > 0 && dirValidation?.valid && (
              <p className="form-field__hint form-field__hint--ok" aria-live="polite">
                Project will be created at: <code>{selectedDir}/{trimmedName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}</code>
              </p>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <footer className="modal__footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!canSubmit}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                "Create Project"
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
