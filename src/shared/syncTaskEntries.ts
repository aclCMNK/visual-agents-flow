/**
 * src/shared/syncTaskEntries.ts
 *
 * Pure helper shared between:
 *   - The renderer store (agentFlowStore.ts → syncTaskPermissions)
 *   - The main-process IPC handler (ipc-handlers.ts → SAVE_AGENT_GRAPH)
 *
 * Computes the `SyncTasksEntry[]` payload from the current agent graph
 * (agents + edges) so that BOTH the manual "Sync Delegations" button and the
 * automatic post-save path use IDENTICAL logic (DRY).
 *
 * Rules:
 *   - ALL real canvas agents are included (not just delegators).
 *   - An agent gets `taskAgentNames: []` when it has no outgoing Delegation
 *     links → this causes handleSyncTasks to write `permissions.task: {}`,
 *     clearing any stale value that existed before a delegation was removed.
 *   - Only edges with `relationType === "Delegation"` contribute.
 *   - The special "user-node" is always excluded (it has no .adata file).
 *
 * This module has ZERO runtime dependencies on Electron, Node, or browser
 * globals — it is a pure function that can be tested anywhere.
 */

import type { SyncTasksEntry } from "../electron/bridge.types.ts";

// ── Minimal descriptor types ───────────────────────────────────────────────

/** Minimal agent descriptor consumed by buildSyncTaskEntries */
export interface SyncAgent {
  id: string;
  name: string;
}

/**
 * Minimal edge descriptor consumed by buildSyncTaskEntries.
 *
 * Both the renderer's `AgentLink.metadata.relationType` and the IPC payload's
 * `AgentGraphEdge.relationType` map to this single `relationType` field.
 * The caller is responsible for extracting the authoritative value.
 */
export interface SyncEdge {
  fromAgentId: string;
  toAgentId: string;
  /**
   * Authoritative relation type.
   * Only `"Delegation"` edges contribute to `permissions.task`.
   * `"Response"` and any other value are ignored.
   */
  relationType: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** The fixed ID of the special User node — excluded from all sync entries */
const USER_NODE_ID = "user-node";

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the `entries[]` array for a `SYNC_TASKS` IPC call.
 *
 * @param agents  All agent nodes currently on the canvas. The UserNode
 *                ("user-node") is filtered out automatically — it has no
 *                backing `.adata` file and must never appear in the output.
 * @param edges   All directed edges on the canvas. Only "Delegation" edges
 *                contribute to `permissions.task`; Response and other edge
 *                types are silently ignored.
 *
 * @returns One `SyncTasksEntry` per real agent (UserNode excluded):
 *   - Delegating agents → `taskAgentNames` = resolved names of delegation targets
 *   - Non-delegating agents → `taskAgentNames: []` (clears stale disk value)
 *
 * @example
 * const entries = buildSyncTaskEntries(store.agents, store.links.map(l => ({
 *   fromAgentId: l.fromAgentId,
 *   toAgentId:   l.toAgentId,
 *   relationType: l.metadata.relationType,
 * })));
 */
export function buildSyncTaskEntries(
  agents: SyncAgent[],
  edges: SyncEdge[],
): SyncTasksEntry[] {
  // Build id→name lookup — user-node always excluded
  const idToName = new Map<string, string>(
    agents
      .filter((a) => a.id !== USER_NODE_ID)
      .map((a) => [a.id, a.name]),
  );

  // Group Delegation edges: fromAgentId → Set<toAgentId>
  // Edges involving the user-node (either end) are excluded from task sync.
  const delegationMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.relationType !== "Delegation") continue;
    if (edge.fromAgentId === USER_NODE_ID || edge.toAgentId === USER_NODE_ID) continue;
    if (!delegationMap.has(edge.fromAgentId)) {
      delegationMap.set(edge.fromAgentId, new Set());
    }
    delegationMap.get(edge.fromAgentId)!.add(edge.toAgentId);
  }

  // Build one entry per real agent.
  // Delegators get their target names; non-delegators get [] (clears disk).
  return Array.from(idToName.entries()).map(([agentId]) => {
    const targets = delegationMap.get(agentId);
    return {
      agentId,
      taskAgentNames: targets
        ? Array.from(targets)
            .map((id) => idToName.get(id))
            .filter((name): name is string => name !== undefined)
        : [],
    };
  });
}
