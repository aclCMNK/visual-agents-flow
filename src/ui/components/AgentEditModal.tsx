/**
 * src/ui/components/AgentEditModal.tsx
 *
 * AgentEditModal — modal dialog to edit an agent's name, description,
 * type and orchestrator flag.
 *
 * Triggered when the user clicks the ✏️ pencil icon on any agent node
 * (canvas or sidebar tree). Displays:
 *   - Name field (required, text input)
 *   - Description field (optional, textarea)
 *   - Type select (Agent | Sub-Agent)
 *   - "is Orchestrator?" checkbox — shown only when Type === "Agent"
 *   - Save button — persists changes to agentFlowStore and closes
 *   - Cancel button — discards changes and closes
 *
 * Closes on:
 *   - Save click
 *   - Cancel click
 *
 * State: uses local draft state; only commits to store on Save.
 */

import { useEffect, useRef, useState } from "react";
import { type AgentType, useAgentFlowStore } from "../store/agentFlowStore.ts";

// ── Component ──────────────────────────────────────────────────────────────

export function AgentEditModal() {
  const editingAgentId = useAgentFlowStore((s) => s.editingAgentId);
  const agents = useAgentFlowStore((s) => s.agents);
  const updateAgent = useAgentFlowStore((s) => s.updateAgent);
  const closeEditModal = useAgentFlowStore((s) => s.closeEditModal);

  const agent = agents.find((a) => a.id === editingAgentId) ?? null;

  // Local draft state — only written to store on Save
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftType, setDraftType] = useState<AgentType>("Agent");
  const [draftIsOrchestrator, setDraftIsOrchestrator] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset draft whenever the modal opens for a (possibly different) agent
  useEffect(() => {
    if (agent) {
      setDraftName(agent.name);
      setDraftDescription(agent.description);
      setDraftType(agent.type);
      setDraftIsOrchestrator(agent.isOrchestrator);
      // Auto-focus the name field after the DOM settles
      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
    }
  }, [agent?.id]); // intentionally keyed on id so it resets when agent changes

  if (!editingAgentId || !agent) return null;

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleSave() {
    const trimmedName = draftName.trim();
    if (!trimmedName) return; // name is required
    updateAgent(agent!.id, {
      name: trimmedName,
      description: draftDescription,
      type: draftType,
      // Only pass isOrchestrator when type is Agent; store resets it otherwise
      isOrchestrator: draftType === "Agent" ? draftIsOrchestrator : false,
    });
    closeEditModal();
  }

  function handleCancel() {
    closeEditModal();
  }

  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      handleSave();
    }
  }

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as AgentType;
    setDraftType(next);
    // Reset orchestrator flag when switching away from Agent
    if (next !== "Agent") setDraftIsOrchestrator(false);
  }

  const nameIsEmpty = draftName.trim().length === 0;

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
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
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
              className={`form-field__input${nameIsEmpty ? " form-field__input--error" : ""}`}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Agent name"
              autoComplete="off"
              spellCheck={false}
            />
            {nameIsEmpty && (
              <span className="form-field__hint form-field__hint--error">
                Name is required.
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
                />
                <span className="orch-checkbox__box" aria-hidden="true" />
                <span className="orch-checkbox__label">is Orchestrator?</span>
              </label>
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────── */}
          <div className="modal__footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={nameIsEmpty}
              title={nameIsEmpty ? "Name is required" : "Save changes"}
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
