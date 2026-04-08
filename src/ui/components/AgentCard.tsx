/**
 * src/ui/components/AgentCard.tsx
 *
 * AgentCard — displays a single agent from the loaded ProjectModel.
 *
 * Shows:
 *   - Agent name + role badge (entrypoint / agent)
 *   - Description from .adata
 *   - Aspects count, skills count, subagents count
 *   - A truncated preview of the profile.md content (if loaded)
 *   - Filepath for the .adata metadata file
 *
 * Used by the EditorView (canvas placeholder) to list all agents in the
 * currently open project.
 *
 * This component is purely presentational — it receives all data as props
 * and emits events via onSelect / onInspect.
 */

import type { SerializableAgentModel } from "../../electron/bridge.types.ts";

// ── Props ──────────────────────────────────────────────────────────────────

export interface AgentCardProps {
  agent: SerializableAgentModel;
  /** Whether this card is currently selected */
  selected?: boolean;
  /** Called when the card is clicked */
  onSelect?: (agentId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

// ── Component ──────────────────────────────────────────────────────────────

export function AgentCard({ agent, selected = false, onSelect }: AgentCardProps) {
  const hasProfile = agent.profileContent && agent.profileContent.trim().length > 0;
  const totalBehaviors = agent.aspects.filter((a) => a.enabled).length;
  const totalSkills = agent.skills.filter((s) => s.enabled).length;
  const totalSubagents = agent.subagents.length;

  return (
    <article
      className={`agent-card ${selected ? "agent-card--selected" : ""} ${agent.isEntrypoint ? "agent-card--entrypoint" : ""}`}
      aria-selected={selected}
      aria-label={`Agent: ${agent.name}`}
      onClick={() => onSelect?.(agent.id)}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="agent-card__header">
        <div className="agent-card__title-row">
          <h3 className="agent-card__name">{agent.name}</h3>
          {agent.isEntrypoint && (
            <span className="agent-card__badge agent-card__badge--entrypoint" aria-label="Entrypoint agent">
              ⚡ entrypoint
            </span>
          )}
        </div>
        <p className="agent-card__id" title={agent.id}>
          <span aria-hidden="true">🆔</span> <code>{agent.id}</code>
        </p>
      </header>

      {/* ── Description ────────────────────────────────────────────── */}
      {agent.description && (
        <p className="agent-card__description">
          {truncate(agent.description)}
        </p>
      )}

      {/* ── Profile preview ────────────────────────────────────────── */}
      {hasProfile && (
        <blockquote className="agent-card__profile-preview">
          {truncate(agent.profileContent, 160)}
        </blockquote>
      )}

      {/* ── Metrics ────────────────────────────────────────────────── */}
      <footer className="agent-card__footer">
        <div className="agent-card__metrics">
          {totalBehaviors > 0 && (
            <span
              className="agent-card__metric"
              title={`${totalBehaviors} enabled aspect${totalBehaviors !== 1 ? "s" : ""}`}
            >
              <span aria-hidden="true">🧩</span> {totalBehaviors} aspect{totalBehaviors !== 1 ? "s" : ""}
            </span>
          )}
          {totalSkills > 0 && (
            <span
              className="agent-card__metric"
              title={`${totalSkills} enabled skill${totalSkills !== 1 ? "s" : ""}`}
            >
              <span aria-hidden="true">⚙️</span> {totalSkills} skill{totalSkills !== 1 ? "s" : ""}
            </span>
          )}
          {totalSubagents > 0 && (
            <span
              className="agent-card__metric"
              title={`${totalSubagents} subagent${totalSubagents !== 1 ? "s" : ""}`}
            >
              <span aria-hidden="true">🤖</span> {totalSubagents} subagent{totalSubagents !== 1 ? "s" : ""}
            </span>
          )}
          {totalBehaviors === 0 && totalSkills === 0 && totalSubagents === 0 && (
            <span className="agent-card__metric agent-card__metric--empty">
              No aspects or skills configured
            </span>
          )}
        </div>

        <span className="agent-card__path" title={agent.adataPath}>
          {agent.adataPath.split("/").pop()}
        </span>
      </footer>
    </article>
  );
}
