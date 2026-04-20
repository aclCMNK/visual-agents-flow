/**
 * src/ui/hooks/useAgentGraphSave.ts
 *
 * Shared hook for agent-graph save logic.
 *
 * Centralises ALL save-related state and side-effects so that both
 * AgentGraphSaveButton (global topbar) and AgentCanvasSaveButton (canvas
 * overlay) can consume identical behaviour without duplicating:
 *   - IPC call (bridge.saveAgentGraph)
 *   - Serialisation of agents/links/userNode
 *   - Toast notification state
 *   - Sync-error modal state
 *   - Retry-sync handler
 *
 * Usage:
 *   const save = useAgentGraphSave();
 *   <button onClick={save.handleSave} disabled={save.isDisabled}>Save</button>
 */

import { useCallback, useEffect, useState } from "react";
import { useAgentFlowStore } from "../store/agentFlowStore.ts";
import { useProjectStore } from "../store/projectStore.ts";
import type {
  AgentGraphEdge,
  AgentGraphNode,
  SaveAgentGraphRequest,
} from "../../electron/bridge.types.ts";

// ── Bridge accessor ────────────────────────────────────────────────────────

function getBridge() {
  if (
    typeof window !== "undefined" &&
    typeof (window as Window & typeof globalThis).agentsFlow !== "undefined"
  ) {
    return window.agentsFlow;
  }
  return null;
}

// ── Toast ──────────────────────────────────────────────────────────────────

export type ToastKind = "success" | "error";

export interface SaveToast {
  kind: ToastKind;
  message: string;
}

export interface SyncErrorModal {
  errors: string[];
}

// ── Hook return type ───────────────────────────────────────────────────────

export interface UseAgentGraphSaveReturn {
  /** True when there are unsaved changes */
  isDirty: boolean;
  /** True while the async save IPC call is running */
  isSavingGraph: boolean;
  /** Combined disabled flag: !isDirty || isSavingGraph || !project */
  isDisabled: boolean;
  /** Project is loaded (false = no project open) */
  hasProject: boolean;
  /** Execute the save — idempotent guard: no-op if already saving / clean */
  handleSave: () => Promise<void>;
  /** Retry the permissions.task sync after a partial failure */
  handleRetrySync: () => Promise<void>;
  /** True while the retry sync IPC call is running */
  isRetryingSync: boolean;
  /** Current toast notification (null = none) */
  toast: SaveToast | null;
  setToast: (t: SaveToast | null) => void;
  /** Current sync-error modal (null = hidden) */
  syncErrorModal: SyncErrorModal | null;
  setSyncErrorModal: (m: SyncErrorModal | null) => void;
}

// ── Hook implementation ────────────────────────────────────────────────────

export function useAgentGraphSave(): UseAgentGraphSaveReturn {
  const project = useProjectStore((s) => s.project);

  const isDirty          = useAgentFlowStore((s) => s.isDirty);
  const isSavingGraph    = useAgentFlowStore((s) => s.isSavingGraph);
  const agents           = useAgentFlowStore((s) => s.agents);
  const links            = useAgentFlowStore((s) => s.links);
  const userNode         = useAgentFlowStore((s) => s.userNode);
  const markClean        = useAgentFlowStore((s) => s.markClean);
  const setSavingGraph   = useAgentFlowStore((s) => s.setSavingGraph);
  const syncTaskPermissions = useAgentFlowStore((s) => s.syncTaskPermissions);

  const [toast, setToast] = useState<SaveToast | null>(null);
  const [syncErrorModal, setSyncErrorModal] = useState<SyncErrorModal | null>(null);
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const delay = toast.kind === "success" ? 2500 : 5000;
    const t = setTimeout(() => setToast(null), delay);
    return () => clearTimeout(t);
  }, [toast]);

  // ── handleSave ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!isDirty || isSavingGraph || !project) return;

    const bridge = getBridge();
    if (!bridge) {
      setToast({ kind: "error", message: "Not running in Electron — save unavailable." });
      return;
    }

    setSavingGraph(true);

    // Serialise agents (nodes)
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

    // Serialise links (edges)
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
      userPosition: userNode ? { x: userNode.x, y: userNode.y } : undefined,
    };

    try {
      const result = await bridge.saveAgentGraph(req);
      if (result.success) {
        markClean();

        const syncResult = result.syncResult;
        if (syncResult && syncResult.errors.length > 0) {
          setSyncErrorModal({ errors: syncResult.errors });
          setToast({ kind: "success", message: "Project saved!" });
        } else {
          const syncMsg = syncResult
            ? ` (${syncResult.updated} agent${syncResult.updated !== 1 ? "s" : ""} synced)`
            : "";
          setToast({ kind: "success", message: `Project saved!${syncMsg}` });
        }
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

  // ── handleRetrySync ────────────────────────────────────────────────────────

  const handleRetrySync = useCallback(async () => {
    if (!project?.projectDir || isRetryingSync) return;
    setIsRetryingSync(true);
    try {
      const result = await syncTaskPermissions(project.projectDir);
      if (result.errors.length === 0) {
        setSyncErrorModal(null);
        setToast({
          kind: "success",
          message: `Sync completed (${result.updated} agent${result.updated !== 1 ? "s" : ""} updated).`,
        });
      } else {
        setSyncErrorModal({ errors: result.errors });
      }
    } catch (err) {
      setSyncErrorModal({ errors: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setIsRetryingSync(false);
    }
  }, [project, isRetryingSync, syncTaskPermissions]);

  return {
    isDirty,
    isSavingGraph,
    isDisabled: !isDirty || isSavingGraph || !project,
    hasProject: !!project,
    handleSave,
    handleRetrySync,
    isRetryingSync,
    toast,
    setToast,
    syncErrorModal,
    setSyncErrorModal,
  };
}
