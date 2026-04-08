/**
 * src/ui/components/AgentTreeItem.tsx
 *
 * AgentTreeItem — renders a single row in the left-panel agent tree.
 *
 * Features:
 *   - Shows agent name (and description as a subtitle if present)
 *   - Shows agent type badge ("Agent" / "Sub-Agent") and orchestrator indicator
 *   - Edit (✏️) button opens the AgentEditModal
 *   - Delete (✕) button removes the agent from state (canvas + tree)
 *   - Double-click on the name opens the AgentEditModal
 *   - All mutations go through agentFlowStore — no intermediate state
 */

import type { CanvasAgent } from "../store/agentFlowStore.ts";
import { useAgentFlowStore } from "../store/agentFlowStore.ts";

// ── Props ──────────────────────────────────────────────────────────────────

export interface AgentTreeItemProps {
  agent: CanvasAgent;
}

// ── Component ──────────────────────────────────────────────────────────────

export function AgentTreeItem({ agent }: AgentTreeItemProps) {
  const openEditModal = useAgentFlowStore((s) => s.openEditModal);
  const deleteAgent = useAgentFlowStore((s) => s.deleteAgent);

  return (
    <div className="agent-tree-item">
      {/* Name + optional description + type badges */}
      <div className="agent-tree-item__info">
        <div className="agent-tree-item__title-row">
          <span
            className="agent-tree-item__name"
            onDoubleClick={() => openEditModal(agent.id)}
            title="Double-click to edit"
          >
            {agent.name}
          </span>
          <span
            className={`agent-tree-item__type-badge${agent.type === "Sub-Agent" ? " agent-tree-item__type-badge--sub" : ""}`}
          >
            {agent.type}
          </span>
          {agent.type === "Agent" && agent.isOrchestrator && (
            <span
              className="agent-tree-item__orchestrator-badge"
              title="Orchestrator"
              aria-label="Orchestrator"
            >
              🎯
            </span>
          )}
        </div>
        {agent.description && (
          <span className="agent-tree-item__desc" title={agent.description}>
            {agent.description}
          </span>
        )}
      </div>

      {/* Action buttons — visible on hover */}
      <div className="agent-tree-item__actions">
        <button
          className="agent-tree-item__btn agent-tree-item__btn--edit"
          onClick={() => openEditModal(agent.id)}
          title="Edit agent"
          aria-label={`Edit ${agent.name}`}
        >
          ✏️
        </button>
        <button
          className="agent-tree-item__btn agent-tree-item__btn--delete"
          onClick={() => deleteAgent(agent.id)}
          title="Delete agent"
          aria-label={`Delete ${agent.name}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
