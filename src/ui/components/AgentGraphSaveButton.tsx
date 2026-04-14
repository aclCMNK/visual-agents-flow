/**
 * src/ui/components/AgentGraphSaveButton.tsx
 *
 * Save button for the agent graph editor.
 *
 * Behavior:
 *   - Only enabled (active) when `isDirty === true` in the agentFlowStore.
 *   - On click: serializes agents and links from the store and calls the
 *     `project:save-agent-graph` IPC channel via window.agentsFlow.
 *   - On success: calls markClean() and shows a brief "Project saved!" toast.
 *   - On error: shows an error toast for 5 seconds.
 *   - While saving: shows a spinner and disables the button.
 *
 * All text labels are in English. No change to other editor logic.
 */

import { useCallback, useEffect, useState } from "react";
import { useAgentFlowStore } from "../store/agentFlowStore.ts";
import { useProjectStore } from "../store/projectStore.ts";
import type { AgentGraphEdge, AgentGraphNode, SaveAgentGraphRequest } from "../../electron/bridge.types.ts";

// ── Bridge accessor (matches pattern in projectStore.ts) ───────────────────

function getBridge() {
  if (
    typeof window !== "undefined" &&
    typeof (window as Window & typeof globalThis).agentsFlow !== "undefined"
  ) {
    return window.agentsFlow;
  }
  return null;
}

// ── Toast state type ───────────────────────────────────────────────────────

type ToastKind = "success" | "error";

interface Toast {
  kind: ToastKind;
  message: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function AgentGraphSaveButton() {
  const project = useProjectStore((s) => s.project);

  const isDirty = useAgentFlowStore((s) => s.isDirty);
  const isSavingGraph = useAgentFlowStore((s) => s.isSavingGraph);
  const agents = useAgentFlowStore((s) => s.agents);
  const links = useAgentFlowStore((s) => s.links);
  const userNode = useAgentFlowStore((s) => s.userNode);
  const markClean = useAgentFlowStore((s) => s.markClean);
  const setSavingGraph = useAgentFlowStore((s) => s.setSavingGraph);

  const [toast, setToast] = useState<Toast | null>(null);

  // Auto-dismiss the toast after a delay
  useEffect(() => {
    if (!toast) return;
    const delay = toast.kind === "success" ? 2500 : 5000;
    const t = setTimeout(() => setToast(null), delay);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSave = useCallback(async () => {
    if (!isDirty || isSavingGraph || !project) return;

    const bridge = getBridge();
    if (!bridge) {
      setToast({ kind: "error", message: "Not running in Electron — save unavailable." });
      return;
    }

    setSavingGraph(true);

    // Serialize agents (nodes)
    const agentNodes: AgentGraphNode[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      type: a.type,
      isOrchestrator: a.isOrchestrator,
      hidden: a.type === "Sub-Agent" ? a.hidden : false,
      x: a.x,
      y: a.y,
    }));

    // Serialize links (edges).
    // The internal store uses "user-node" as the UserNode ID, which is also
    // the canonical ID used in the .afproj file — no remapping needed.
    const edges: AgentGraphEdge[] = links.map((l) => ({
      id: l.id,
      fromAgentId: l.fromAgentId,
      toAgentId: l.toAgentId,
      relationType: l.ruleType,
      delegationType: l.delegationType,
      ruleDetails: l.ruleDetails,
    }));

    const req: SaveAgentGraphRequest = {
      projectDir: project.projectDir,
      agents: agentNodes,
      edges,
      // Include user node position so it can be persisted in .afproj
      userPosition: userNode ? { x: userNode.x, y: userNode.y } : undefined,
    };

    try {
      const result = await bridge.saveAgentGraph(req);
      if (result.success) {
        markClean();
        setToast({ kind: "success", message: "Project saved!" });
      } else {
        setToast({ kind: "error", message: result.error ?? "Save failed." });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast({ kind: "error", message });
    } finally {
      setSavingGraph(false);
    }
  }, [isDirty, isSavingGraph, project, agents, links, userNode, markClean, setSavingGraph]);

  // Don't render if no project is open
  if (!project) return null;

  const isDisabled = !isDirty || isSavingGraph;

  return (
    <>
      {/* ── Save button ──────────────────────────────────────────────── */}
      <button
        className={[
          "agent-graph-save-btn",
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
            : isDirty
            ? "Save project (unsaved changes)"
            : "Save project (no unsaved changes)"
        }
        title={
          isDirty
            ? "Save agent graph to disk"
            : "No unsaved changes"
        }
      >
        {isSavingGraph ? (
          <>
            <span className="agent-graph-save-btn__spinner" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <span aria-hidden="true">{isDirty ? "💾" : "✓"}</span>
            {isDirty ? "Save" : "Saved"}
          </>
        )}
      </button>

      {/* ── Toast notification ──────────────────────────────────────── */}
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
    </>
  );
}
