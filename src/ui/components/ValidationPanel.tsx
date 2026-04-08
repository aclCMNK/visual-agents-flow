/**
 * src/ui/components/ValidationPanel.tsx
 *
 * Validation Panel — displays the errors, warnings, and info messages
 * produced by the ProjectLoader after an open or validate operation.
 *
 * Shows:
 *   - A summary badge row (errors / warnings / infos / repairs)
 *   - A grouped, filterable issue list
 *   - Repair action proposals (from dry-run)
 *   - Actions: fix (repair mode), proceed anyway (if only warnings), close
 *
 * This panel is shown automatically after:
 *   - A project is opened and has issues (load mode)
 *   - The user explicitly validates a project (dry-run mode)
 */

import { useState } from "react";
import { useProjectStore, selectErrors, selectWarnings, selectInfos } from "../store/projectStore.ts";
import type { BridgeValidationIssue } from "../../electron/bridge.types.ts";

// ── Sub-components ─────────────────────────────────────────────────────────

type SeverityFilter = "all" | "error" | "warning" | "info";

interface IssueBadgeProps {
  count: number;
  severity: "error" | "warning" | "info";
  active: boolean;
  onClick: () => void;
}

function IssueBadge({ count, severity, active, onClick }: IssueBadgeProps) {
  const icons: Record<string, string> = {
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  return (
    <button
      className={`validation-panel__badge validation-panel__badge--${severity} ${active ? "validation-panel__badge--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Show ${count} ${severity}${count !== 1 ? "s" : ""}`}
    >
      <span aria-hidden="true">{icons[severity]}</span>
      <span className="validation-panel__badge-count">{count}</span>
      <span className="validation-panel__badge-label">
        {severity}{count !== 1 ? "s" : ""}
      </span>
    </button>
  );
}

interface IssueRowProps {
  issue: BridgeValidationIssue;
  index: number;
}

function IssueRow({ issue, index }: IssueRowProps) {
  const [expanded, setExpanded] = useState(false);
  const icons: Record<string, string> = {
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  return (
    <li
      className={`validation-panel__issue validation-panel__issue--${issue.severity}`}
      aria-label={`${issue.severity}: ${issue.message}`}
    >
      <button
        className="validation-panel__issue-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`issue-details-${index}`}
      >
        <span className="validation-panel__issue-icon" aria-hidden="true">
          {icons[issue.severity]}
        </span>
        <span className="validation-panel__issue-code">[{issue.code}]</span>
        <span className="validation-panel__issue-message">{issue.message}</span>
        <span
          className={`validation-panel__issue-chevron ${expanded ? "validation-panel__issue-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {expanded && (
        <div
          id={`issue-details-${index}`}
          className="validation-panel__issue-details"
        >
          <dl className="validation-panel__issue-meta">
            <dt>Source</dt>
            <dd>
              <code>{issue.source}</code>
            </dd>

            {issue.repairHint && (
              <>
                <dt>Repair hint</dt>
                <dd>{issue.repairHint}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ValidationPanel() {
  const store = useProjectStore();
  const {
    project,
    lastLoadResult,
    lastValidationResult,
    isLoading,
    isValidating,
    isRepairing,
    navigate,
    closeProject,
    repairAndReload,
  } = store;

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");

  const activeResult = lastValidationResult ?? lastLoadResult;
  const allIssues = activeResult?.issues ?? [];
  const errors = selectErrors(store);
  const warnings = selectWarnings(store);
  const infos = selectInfos(store);
  const repairActions = activeResult?.repairActions ?? [];
  const summary = activeResult?.summary;

  const hasErrors = errors.length > 0;
  const isDryRun = activeResult != null && !activeResult.success && repairActions.length > 0;
  const isBusy = isLoading || isValidating || isRepairing;

  // ── Filtered issues ──────────────────────────────────────────────────────

  const filteredIssues = allIssues.filter(
    (issue) => severityFilter === "all" || issue.severity === severityFilter
  );

  // ── Filter handler ───────────────────────────────────────────────────────

  function handleFilterChange(filter: SeverityFilter) {
    setSeverityFilter((current) => (current === filter ? "all" : filter));
  }

  // ── No result state ──────────────────────────────────────────────────────

  if (!activeResult) {
    return (
      <div className="validation-panel validation-panel--empty">
        <p>No validation data. Open or validate a project first.</p>
        <button
          className="validation-panel__btn validation-panel__btn--secondary"
          onClick={() => navigate("browser")}
        >
          ← Back to Project Browser
        </button>
      </div>
    );
  }

  return (
    <div className="validation-panel">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="validation-panel__toolbar">
        <button
          className="validation-panel__btn validation-panel__btn--ghost"
          onClick={() => navigate("browser")}
          aria-label="Back to Project Browser"
        >
          ← Back
        </button>

        <h2 className="validation-panel__title">
          {isDryRun ? "Validation Report" : "Project Issues"}
          {project && (
            <span className="validation-panel__project-name">
              {" "}
              — {project.name}
            </span>
          )}
        </h2>

        <div className="validation-panel__toolbar-actions">
          {project && (
            <button
              className="validation-panel__btn validation-panel__btn--ghost"
              onClick={() => navigate("editor")}
              disabled={hasErrors}
              title={hasErrors ? "Fix errors before opening the editor" : "Open editor"}
            >
              Open Editor →
            </button>
          )}
          {project && (
            <button
              className="validation-panel__btn validation-panel__btn--ghost"
              onClick={closeProject}
            >
              Close Project
            </button>
          )}
        </div>
      </div>

      {/* ── Summary row ──────────────────────────────────────────────── */}
      <div className="validation-panel__summary" aria-label="Issue summary">
        <IssueBadge
          count={errors.length}
          severity="error"
          active={severityFilter === "error"}
          onClick={() => handleFilterChange("error")}
        />
        <IssueBadge
          count={warnings.length}
          severity="warning"
          active={severityFilter === "warning"}
          onClick={() => handleFilterChange("warning")}
        />
        <IssueBadge
          count={infos.length}
          severity="info"
          active={severityFilter === "info"}
          onClick={() => handleFilterChange("info")}
        />

        {summary && (
          <div className="validation-panel__meta">
            <span>{summary.agentsLoaded} agent{summary.agentsLoaded !== 1 ? "s" : ""} loaded</span>
            <span>{summary.filesRead} files read</span>
            {activeResult.durationMs > 0 && (
              <span>{activeResult.durationMs}ms</span>
            )}
          </div>
        )}
      </div>

      {/* ── Result status ─────────────────────────────────────────────── */}
      <div
        className={`validation-panel__status ${activeResult.success ? "validation-panel__status--ok" : "validation-panel__status--fail"}`}
        role="status"
      >
        {activeResult.success ? (
          <>
            <span aria-hidden="true">✅</span>
            Project loaded successfully
            {warnings.length > 0 && ` with ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`}
          </>
        ) : (
          <>
            <span aria-hidden="true">❌</span>
            {isDryRun
              ? `Validation found ${errors.length} error${errors.length !== 1 ? "s" : ""}`
              : `Load failed — ${errors.length} blocking error${errors.length !== 1 ? "s" : ""}`}
          </>
        )}
      </div>

      {/* ── Repair actions (dry-run proposals) ───────────────────────── */}
      {repairActions.length > 0 && (
        <section
          className="validation-panel__repairs"
          aria-label="Proposed repair actions"
        >
          <h3 className="validation-panel__repairs-title">
            <span aria-hidden="true">🔧</span>
            {repairActions.filter((a) => a.applied).length > 0
              ? "Applied Repairs"
              : "Proposed Repairs"}
            <span className="validation-panel__repairs-count">
              {repairActions.length}
            </span>
          </h3>
          <ul className="validation-panel__repairs-list" role="list">
            {repairActions.map((action, i) => (
              <li key={i} className="validation-panel__repair-item">
                <span
                  className={`validation-panel__repair-status ${action.applied ? "validation-panel__repair-status--applied" : "validation-panel__repair-status--proposed"}`}
                  aria-label={action.applied ? "Applied" : "Proposed"}
                >
                  {action.applied ? "✅" : "○"}
                </span>
                <span className="validation-panel__repair-kind">
                  [{action.kind}]
                </span>
                <span className="validation-panel__repair-desc">
                  {action.description}
                </span>
                <code className="validation-panel__repair-file">
                  {action.targetFile}
                </code>
              </li>
            ))}
          </ul>

          {/* Apply repairs button */}
          {!repairActions.every((a) => a.applied) && project && (
            <button
              className="validation-panel__btn validation-panel__btn--primary"
              onClick={() => repairAndReload(project.projectDir)}
              disabled={isBusy}
              aria-busy={isRepairing}
            >
              {isRepairing ? "Applying repairs…" : "Apply Repairs & Reload"}
            </button>
          )}
        </section>
      )}

      {/* ── Issue list ────────────────────────────────────────────────── */}
      {filteredIssues.length > 0 ? (
        <section
          className="validation-panel__issues"
          aria-label={`${filteredIssues.length} issue${filteredIssues.length !== 1 ? "s" : ""}`}
        >
          <ul className="validation-panel__issues-list" role="list">
            {filteredIssues.map((issue, i) => (
              <IssueRow key={`${issue.code}-${i}`} issue={issue} index={i} />
            ))}
          </ul>
        </section>
      ) : (
        <div className="validation-panel__no-issues" aria-live="polite">
          {severityFilter !== "all" ? (
            <p>No {severityFilter}s found.</p>
          ) : (
            <p>
              <span aria-hidden="true">✅</span> No issues found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
