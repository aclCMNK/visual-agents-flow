/**
 * src/ui/components/AgentEditModal.tsx
 *
 * AgentEditModal — modal dialog to edit an agent's name, description,
 * type and orchestrator flag.
 *
 * Triggered when the user clicks the ✏️ pencil icon on any agent node
 * (canvas or sidebar tree). Displays:
 *   - Name field (required, text input)
 *   - Live slug preview — shows how the input will be stored
 *   - Inline conflict/reserved error when the slug is already in use
 *   - Description field (optional, textarea)
 *   - Type select (Agent | Sub-Agent)
 *   - "is Orchestrator?" checkbox — shown only when Type === "Agent"
 *   - "Hidden" toggle — shown only when Type === "Sub-Agent"
 *     Hides the sub-agent from the @ autocomplete menu.
 *   - Save button — persists changes to agentFlowStore and closes
 *   - Cancel button — discards changes and closes
 *
 * Slug behavior:
 *   - The agent's final stored name is always a slug derived from the input.
 *   - The slug is generated via `toSlug()` and shown live beneath the field.
 *   - If the resulting slug is identical to the current agent name, it is
 *     treated as "unchanged" (no conflict, no rename IPC call).
 *   - If the slug conflicts with another agent's name, an error is shown
 *     and Save is blocked.
 *   - On a successful save with a changed slug, the IPC `renameAgentFolder`
 *     call is made to rename the behaviors folder on disk.
 *
 * Closes on:
 *   - Save click (after successful IPC call when slug changed)
 *   - Cancel click
 *
 * State: uses local draft state; only commits to store on Save.
 */

import { useEffect, useRef, useState } from "react";
import { type AgentType, useAgentFlowStore } from "../store/agentFlowStore.ts";
import { useProjectStore } from "../store/projectStore.ts";
import { toSlug, isSlugValid } from "../utils/slugUtils.ts";

// ── Component ──────────────────────────────────────────────────────────────

export function AgentEditModal() {
  const editingAgentId = useAgentFlowStore((s) => s.editingAgentId);
  const agents = useAgentFlowStore((s) => s.agents);
  const updateAgent = useAgentFlowStore((s) => s.updateAgent);
  const closeEditModal = useAgentFlowStore((s) => s.closeEditModal);
  const project = useProjectStore((s) => s.project);

  const agent = agents.find((a) => a.id === editingAgentId) ?? null;

  // Local draft state — only written to store on Save
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftType, setDraftType] = useState<AgentType>("Agent");
  const [draftIsOrchestrator, setDraftIsOrchestrator] = useState(false);
  const [draftHidden, setDraftHidden] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset draft whenever the modal opens for a (possibly different) agent
  useEffect(() => {
    if (agent) {
      setDraftName(agent.name);
      setDraftDescription(agent.description);
      setDraftType(agent.type);
      setDraftIsOrchestrator(agent.isOrchestrator);
      setDraftHidden(agent.hidden ?? false);
      setSaveError(null);
      // Auto-focus the name field after the DOM settles
      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
    }
  }, [agent?.id]); // intentionally keyed on id so it resets when agent changes

  if (!editingAgentId || !agent) return null;

  // ── Slug derivation ──────────────────────────────────────────────────────

  const derivedSlug = toSlug(draftName.trim());
  const slugUnchanged = derivedSlug === agent.name;

  // All slugs currently used by OTHER agents (exclude the agent being edited)
  const otherAgentSlugs = agents
    .filter((a) => a.id !== editingAgentId)
    .map((a) => a.name);

  // Slug-level validation
  const slugIsEmpty = derivedSlug.length === 0;
  const slugHasConflict =
    !slugIsEmpty && !slugUnchanged && !isSlugValid(derivedSlug, otherAgentSlugs);

  const canSave = !slugIsEmpty && !slugHasConflict && !isSaving;

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!canSave) return;
    setSaveError(null);
    setIsSaving(true);

    try {
      // If slug changed and we have a project loaded, rename the folder on disk
      if (!slugUnchanged && project) {
        const result = await window.agentsFlow.renameAgentFolder({
          projectDir: project.projectDir,
          agentId: agent!.id,
          oldSlug: agent!.name,
          newSlug: derivedSlug,
        });

        if (!result.success) {
          setSaveError(result.error ?? "Failed to rename agent folder.");
          setIsSaving(false);
          return;
        }
      }

      // Commit the new slug to the store
      updateAgent(agent!.id, {
        name: derivedSlug,
        description: draftDescription,
        type: draftType,
        isOrchestrator: draftType === "Agent" ? draftIsOrchestrator : false,
        hidden: draftType === "Sub-Agent" ? draftHidden : false,
      });

      closeEditModal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    closeEditModal();
  }

  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      void handleSave();
    }
  }

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as AgentType;
    setDraftType(next);
    // Reset orchestrator flag when switching away from Agent
    if (next !== "Agent") setDraftIsOrchestrator(false);
    // Reset hidden to false immediately when switching away from Sub-Agent
    if (next !== "Sub-Agent") setDraftHidden(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit agent: ${agent.name}`}
    >
      <div className="modal agent-edit-modal">
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="modal__header">
          <h2 className="modal__title">Edit Agent</h2>
          <button
            className="modal__close-btn"
            onClick={handleCancel}
            aria-label="Close"
            title="Cancel"
          >
            ✕
          </button>
        </header>

        {/* ── Body ────────────────────────────────────────────────── */}
        <form
          className="modal__body"
          onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
          onKeyDown={handleFormKeyDown}
          noValidate
        >
          {/* Name */}
          <div className="form-field">
            <label className="form-field__label" htmlFor="agent-edit-name">
              Name <span className="form-field__required">*</span>
            </label>
            <input
              id="agent-edit-name"
              ref={nameInputRef}
              className={`form-field__input${(slugIsEmpty || slugHasConflict) ? " form-field__input--error" : ""}`}
              type="text"
              value={draftName}
              onChange={(e) => { setDraftName(e.target.value); setSaveError(null); }}
              placeholder="Agent name"
              autoComplete="off"
              spellCheck={false}
              disabled={isSaving}
            />

            {/* Live slug preview */}
            {!slugIsEmpty && (
              <span
                className="form-field__hint"
                data-testid="slug-preview"
              >
                Slug: <code>{derivedSlug}</code>
              </span>
            )}

            {/* Validation errors */}
            {slugIsEmpty && (
              <span className="form-field__hint form-field__hint--error">
                Name is required.
              </span>
            )}
            {slugHasConflict && (
              <span
                className="form-field__hint form-field__hint--error"
                data-testid="slug-conflict-error"
              >
                This slug is already in use by another agent.
              </span>
            )}
          </div>

          {/* Description */}
          <div className="form-field">
            <label className="form-field__label" htmlFor="agent-edit-desc">
              Description <span className="form-field__optional">(optional)</span>
            </label>
            <textarea
              id="agent-edit-desc"
              className="form-field__textarea"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              placeholder="Describe what this agent does…"
              rows={4}
              disabled={isSaving}
            />
          </div>

          {/* Type */}
          <div className="form-field">
            <label className="form-field__label" htmlFor="agent-edit-type">
              Type
            </label>
            <select
              id="agent-edit-type"
              className="form-field__select"
              value={draftType}
              onChange={handleTypeChange}
              disabled={isSaving}
            >
              <option value="Agent">Agent</option>
              <option value="Sub-Agent">Sub-Agent</option>
            </select>
          </div>

          {/* is Orchestrator? — only visible when Type === "Agent" */}
          {draftType === "Agent" && (
            <div className="form-field">
              <label className="orch-checkbox" htmlFor="agent-edit-orchestrator">
                <input
                  id="agent-edit-orchestrator"
                  type="checkbox"
                  className="orch-checkbox__input"
                  checked={draftIsOrchestrator}
                  onChange={(e) => setDraftIsOrchestrator(e.target.checked)}
                  disabled={isSaving}
                />
                <span className="orch-checkbox__box" aria-hidden="true" />
                <span className="orch-checkbox__label">is Orchestrator?</span>
              </label>
            </div>
          )}

          {/* Hidden toggle — only visible when Type === "Sub-Agent" */}
          {draftType === "Sub-Agent" && (
            <div className="form-field">
              <label className="agent-hidden-toggle" htmlFor="agent-edit-hidden">
                <span className="agent-hidden-toggle__label">Hidden</span>
                <span className="agent-hidden-toggle__track">
                  <input
                    id="agent-edit-hidden"
                    type="checkbox"
                    className="agent-hidden-toggle__input"
                    checked={draftHidden}
                    onChange={(e) => setDraftHidden(e.target.checked)}
                    disabled={isSaving}
                  />
                  <span className="agent-hidden-toggle__thumb" aria-hidden="true" />
                </span>
              </label>
              <p className="agent-hidden-toggle__hint">
                Hide a subagent from the @ autocomplete menu with{" "}
                <code className="agent-hidden-toggle__code">hidden: true</code>.
                Useful for internal subagents that should only be invoked
                programmatically by other agents via the Task tool. This only
                affects user visibility in the autocomplete menu. Hidden agents
                can still be invoked by the model via the Task tool if
                permissions allow.
              </p>
            </div>
          )}

          {/* Save error */}
          {saveError && (
            <div
              className="form-field__hint form-field__hint--error"
              data-testid="save-error"
            >
              {saveError}
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────── */}
          <div className="modal__footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!canSave}
              title={
                slugIsEmpty
                  ? "Name is required"
                  : slugHasConflict
                  ? "Slug conflict — choose a different name"
                  : "Save changes"
              }
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
