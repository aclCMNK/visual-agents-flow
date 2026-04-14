/**
 * src/ui/store/agentFlowStore.ts
 *
 * Zustand store for the VISUAL agent flow editor.
 *
 * Responsibilities:
 *   - Tracks CanvasAgent nodes (id, name, description, type, isOrchestrator, position on canvas)
 *   - Controls "placement mode": when the user clicks "Nuevo agente",
 *     placement mode is activated and a ghost node follows the mouse.
 *     On click the ghost is committed as a real node. On Escape or cancel,
 *     placement mode is deactivated without creating anything.
 *   - Controls "edit modal": editingAgentId tracks which agent's modal is open.
 *   - Exposes actions to rename, update, delete and move agents (synced tree ↔ canvas ↔ state).
 *   - Tracks directed links between agent nodes (AgentLink).
 *     Each link connects a source node to a target node (center-to-center).
 *     Multiple links between the same pair are prevented.
 *     Links are purely visual/interaction; business semantics are handled separately.
 *
 * This store is intentionally separate from projectStore to keep concerns isolated.
 * The loaded-project agents (from .afproj) are read-only in this version.
 * Agents created here are new "canvas-only" agents pending save.
 */

import { create } from "zustand";
import type { SerializableProjectModel } from "../../electron/bridge.types.ts";
import { slugify, toSlug } from "../utils/slugUtils.ts";

/** Simple UUID-v4 generator (no external deps) */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

/** The role/type of an agent in the flow */
export type AgentType = "Agent" | "Sub-Agent";

/**
 * A special "User" node that represents the human end-user in the flow diagram.
 * It is purely visual/decorative: it can be moved and connected to other agents,
 * but it is NOT persisted as a real agent in behaviors or project configuration.
 * There can only be ONE UserNode on the canvas at a time.
 */
export interface UserNode {
  /** Unique identifier (constant: "user-node") */
  id: "user-node";
  /** Display name — always "User", never editable */
  name: "User";
  /** Canvas position (top-left of bounding box) */
  x: number;
  y: number;
}

/** The fixed ID for the UserNode. Used across store, canvas, and tests. */
export const USER_NODE_ID = "user-node" as const;

/**
 * @deprecated InputPortId is kept for backwards compatibility but is no longer
 * used to describe port positions. Links now connect node centers directly.
 */
export type InputPortId = "left" | "bottom" | "top";

/**
 * Rule type for a connection:
 *   "Delegation" — the source agent delegates work to the target agent.
 *   "Response"   — the source agent sends a response back to the target agent.
 */
export type LinkRuleType = "Delegation" | "Response";

/**
 * Delegation type — only meaningful when ruleType === "Delegation".
 *   "Optional"    — the delegation may or may not happen.
 *   "Mandatory"   — the delegation always happens.
 *   "Conditional" — the delegation happens based on a condition.
 */
export type DelegationType = "Optional" | "Mandatory" | "Conditional";

/** A directed link from one agent node center to another agent node center */
export interface AgentLink {
  /** Unique link identifier */
  id: string;
  /** ID of the source agent */
  fromAgentId: string;
  /** ID of the target agent */
  toAgentId: string;
  /**
   * Whether this connection represents a Delegation or a Response.
   * Defaults to "Delegation".
   */
  ruleType: LinkRuleType;
  /**
   * Delegation sub-type — only relevant when ruleType === "Delegation".
   * Defaults to "Optional".
   */
  delegationType: DelegationType;
  /**
   * Free-form rule description / condition logic written by the user.
   * Can be empty.
   */
  ruleDetails: string;
}

/** A visual agent node placed on the canvas */
export interface CanvasAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name shown in canvas node and sidebar tree */
  name: string;
  /** Optional description of what this agent does */
  description: string;
  /** Role of this agent: top-level Agent or Sub-Agent */
  type: AgentType;
  /**
   * Whether this agent acts as an orchestrator.
   * Only meaningful when type === "Agent".
   */
  isOrchestrator: boolean;
  /**
   * Whether this sub-agent is hidden from the @ autocomplete menu.
   * Only meaningful when type === "Sub-Agent". Always false for other types.
   * Defaults to false.
   */
  hidden: boolean;
  /** Position on the canvas (top-left corner of the node box) */
  x: number;
  y: number;
}

/** Partial fields that can be updated via the edit modal */
export interface AgentEditFields {
  name?: string;
  description?: string;
  type?: AgentType;
  isOrchestrator?: boolean;
  /**
   * Whether this sub-agent is hidden from the @ autocomplete menu.
   * Only meaningful when type === "Sub-Agent". Always persisted as false for other types.
   */
  hidden?: boolean;
}

/**
 * Payload for the global agent profile modal.
 * When non-null, the portal modal is shown above all other overlays.
 */
export interface ProfileModalTarget {
  /** The agent's UUID */
  agentId: string;
  /** Human-readable name for the modal subtitle */
  agentName: string;
  /** Absolute path to the project root */
  projectDir: string;
}

/**
 * Payload for the global permissions modal.
 * When non-null, the permissions portal modal is shown above all other overlays.
 */
export interface PermissionsModalTarget {
  /** The agent's UUID */
  agentId: string;
  /** Human-readable name for the modal subtitle */
  agentName: string;
  /** Absolute path to the project root */
  projectDir: string;
}

/** Partial fields that can be updated on a link's rule */
export interface LinkRuleFields {
  ruleType?: LinkRuleType;
  delegationType?: DelegationType;
  ruleDetails?: string;
}

/** The type of entity currently selected in the canvas */
export type SelectionContext = "none" | "node" | "link";

/** State for the flow store */
export interface AgentFlowState {
  /** All agent nodes placed on the canvas */
  agents: CanvasAgent[];
  /**
   * The special "User" node, if one has been added to the canvas.
   * null means no User node exists yet.
   * Only one UserNode is allowed at a time (enforced by addUserNode).
   */
  userNode: UserNode | null;
  /** Whether the app is currently in "placement mode" (ghost follows mouse) */
  isPlacing: boolean;
  /**
   * ID of the agent whose edit modal is currently open.
   * null means no modal is open.
   */
  editingAgentId: string | null;
  /** All directed links between agent nodes */
  links: AgentLink[];
  /** ID of the currently selected link (for deletion), or null */
  selectedLinkId: string | null;
  /**
   * Whether the right-side properties panel is open (expanded) or collapsed.
   * Persisted to .afproj as ui.panelOpen.
   */
  panelOpen: boolean;
  /**
   * What is currently selected in the canvas — determines which placeholder
   * the properties panel shows.
   */
  selectionContext: SelectionContext;
  /**
   * ID of the currently selected agent node on the canvas, or null.
   * Set when the user clicks/drags a node. Used by PropertiesPanel to know
   * which agent's properties to display.
   */
  selectedNodeId: string | null;
  /**
   * Whether there are unsaved changes in the agent graph (agents or links).
   * Set to true whenever agents/links are created, edited, or deleted.
   * Reset to false after a successful save.
   */
  isDirty: boolean;
  /**
   * Whether a graph save operation is in progress.
   */
  isSavingGraph: boolean;
  /**
   * When non-null, the global Agent Profile modal portal is shown above all overlays.
   * Contains the agent data needed to render the modal without prop-drilling through
   * the PropertiesPanel subtree.
   */
  profileModalTarget: ProfileModalTarget | null;
  /**
   * When non-null, the global Permissions modal portal is shown above all overlays.
   */
  permissionsModalTarget: PermissionsModalTarget | null;
}

/** Actions for the flow store */
export interface AgentFlowActions {
  /** Enter placement mode — ghost will follow the mouse until committed or cancelled */
  startPlacement(): void;
  /**
   * Commit the ghost node at the given canvas coordinates.
   * Creates a new CanvasAgent at (x, y) and exits placement mode.
   */
  commitPlacement(x: number, y: number): void;
  /** Cancel placement mode without creating any node */
  cancelPlacement(): void;
  /** Rename an agent by id — syncs across tree and canvas */
  renameAgent(id: string, newName: string): void;
  /**
   * Update one or more editable fields on an agent (name, description).
   * Used by the edit modal's Save button.
   */
  updateAgent(id: string, fields: AgentEditFields): void;
  /** Remove an agent by id from both canvas and tree (also removes all its links) */
  deleteAgent(id: string): void;
  /**
   * Move an agent node to a new position on the canvas.
   * Used by drag & drop.
   */
  moveAgent(id: string, x: number, y: number): void;
  /** Open the edit modal for an agent */
  openEditModal(id: string): void;
  /** Close the edit modal without saving */
  closeEditModal(): void;
  /**
   * Open the global Agent Profile modal portal.
   * Stores the target agent's data in the store so the portal (rendered in App)
   * can read it without prop-drilling through the PropertiesPanel tree.
   */
  openProfileModal(target: ProfileModalTarget): void;
  /** Close the global Agent Profile modal portal */
  closeProfileModal(): void;
  /**
   * Open the global Permissions modal portal.
   */
  openPermissionsModal(target: PermissionsModalTarget): void;
  /** Close the global Permissions modal portal */
  closePermissionsModal(): void;
  addLink(fromAgentId: string, toAgentId: string): void;
  /** Delete a link by id */
  deleteLink(id: string): void;
  /** Select a link (for deletion or inspection) */
  selectLink(id: string | null): void;
  /**
   * Update one or more rule fields on a link.
   * Used by the Properties Panel form when a link is selected.
   */
  updateLink(id: string, fields: LinkRuleFields): void;
  /** Open (expand) the right-side properties panel */
  openPanel(): void;
  /** Close (collapse) the right-side properties panel */
  closePanel(): void;
  /** Toggle the panel open/closed */
  togglePanel(): void;
  /**
   * Set the current canvas selection context.
   * Controls which placeholder message the properties panel displays.
   * Pass "none" when deselecting.
   */
  setSelectionContext(ctx: SelectionContext): void;
  /**
   * Select a canvas agent node by id (or null to deselect).
   * Also updates selectionContext to "node" (or "none" when null).
   */
  selectNode(id: string | null): void;
  /**
   * Mark the graph as having unsaved changes.
   * Called automatically by all mutating actions.
   */
  markDirty(): void;
  /**
   * Mark the graph as clean (no unsaved changes).
   * Called after a successful save.
   */
  markClean(): void;
  /**
   * Set the isSavingGraph flag. Used by the save button during async save.
   */
  setSavingGraph(saving: boolean): void;
  /**
   * Reset the flow store to its initial empty state.
   * Called when closing a project or before loading a new one.
   */
  resetFlow(): void;
  /**
   * Reconstruct agents and links from a loaded project.
   * Called after `openProject` succeeds to hydrate the canvas.
   * Also restores panelOpen from project.properties.ui.panelOpen.
   * Marks the store as clean (isDirty = false).
   */
  loadFromProject(project: SerializableProjectModel): void;
  /**
   * Add the special "User" node to the canvas at the given position.
   * No-op if a UserNode already exists (only one allowed).
   */
  addUserNode(x: number, y: number): void;
  /**
   * Remove the special "User" node from the canvas.
   * Also removes all links connected to it.
   */
  removeUserNode(): void;
  /**
   * Move the User node to a new canvas position.
   * No-op if no UserNode exists.
   */
  moveUserNode(x: number, y: number): void;
}

export type AgentFlowStore = AgentFlowState & AgentFlowActions;

// ── Initial state ──────────────────────────────────────────────────────────

const initialState: AgentFlowState = {
  agents: [],
  userNode: null,
  isPlacing: false,
  editingAgentId: null,
  links: [],
  selectedLinkId: null,
  panelOpen: true,
  selectionContext: "none",
  selectedNodeId: null,
  isDirty: false,
  isSavingGraph: false,
  profileModalTarget: null,
  permissionsModalTarget: null,
};

// ── Store ──────────────────────────────────────────────────────────────────

export const useAgentFlowStore = create<AgentFlowStore>((set) => ({
  ...initialState,

  startPlacement() {
    set({ isPlacing: true });
  },

  commitPlacement(x, y) {
    set((state) => {
      const existingSlugs = state.agents.map((a) => a.name);
      const newAgent: CanvasAgent = {
        id: uuid(),
        name: slugify("new-agent", existingSlugs),
        description: "",
        type: "Agent",
        isOrchestrator: false,
        hidden: false,
        x,
        y,
      };
      return {
        agents: [...state.agents, newAgent],
        isPlacing: false,
        isDirty: true,
      };
    });
  },

  cancelPlacement() {
    set({ isPlacing: false });
  },

  renameAgent(id, newName) {
    set((state) => {
      const slug = toSlug(newName.trim());
      if (!slug) return {}; // empty slug → no-op
      return {
        agents: state.agents.map((a) =>
          a.id === id ? { ...a, name: slug } : a
        ),
        isDirty: true,
      };
    });
  },

  updateAgent(id, fields) {
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== id) return a;
        const nextType = fields.type !== undefined ? fields.type : a.type;
        let nextName = a.name;
        if (fields.name !== undefined) {
          const slug = toSlug(fields.name.trim());
          nextName = slug || a.name; // fall back to existing slug if transform yields empty
        }
        return {
          ...a,
          name: nextName,
          description: fields.description !== undefined ? fields.description : a.description,
          type: nextType,
          // isOrchestrator is only persisted when type is Agent; reset to false for Sub-Agent
          isOrchestrator:
            nextType === "Agent"
              ? (fields.isOrchestrator !== undefined ? fields.isOrchestrator : a.isOrchestrator)
              : false,
          // hidden is only meaningful for Sub-Agent; always false for other types
          hidden:
            nextType === "Sub-Agent"
              ? (fields.hidden !== undefined ? fields.hidden : a.hidden)
              : false,
        };
      }),
      isDirty: true,
    }));
  },

  deleteAgent(id) {
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      // Remove all links connected to this agent
      links: state.links.filter((l) => l.fromAgentId !== id && l.toAgentId !== id),
      selectedLinkId: state.selectedLinkId
        ? state.links.find((l) => l.id === state.selectedLinkId && (l.fromAgentId === id || l.toAgentId === id))
          ? null
          : state.selectedLinkId
        : null,
      isDirty: true,
    }));
  },

  moveAgent(id, x, y) {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, x, y } : a
      ),
      isDirty: true,
    }));
  },

  openEditModal(id) {
    set({ editingAgentId: id });
  },

  closeEditModal() {
    set({ editingAgentId: null });
  },

  openProfileModal(target) {
    set({ profileModalTarget: target });
  },

  closeProfileModal() {
    set({ profileModalTarget: null });
  },

  openPermissionsModal(target) {
    set({ permissionsModalTarget: target });
  },

  closePermissionsModal() {
    set({ permissionsModalTarget: null });
  },

  addLink(fromAgentId, toAgentId) {
    // Prevent self-connections
    if (fromAgentId === toAgentId) return;
    set((state) => {
      // Prevent duplicate links between the exact same pair (same direction)
      const alreadyExists = state.links.some(
        (l) => l.fromAgentId === fromAgentId && l.toAgentId === toAgentId
      );
      if (alreadyExists) return {};
      const newLink: AgentLink = {
        id: uuid(),
        fromAgentId,
        toAgentId,
        ruleType: "Delegation",
        delegationType: "Optional",
        ruleDetails: "",
      };
      return { links: [...state.links, newLink], isDirty: true };
    });
  },

  deleteLink(id) {
    set((state) => ({
      links: state.links.filter((l) => l.id !== id),
      selectedLinkId: state.selectedLinkId === id ? null : state.selectedLinkId,
      isDirty: true,
    }));
  },

  selectLink(id) {
    set({ selectedLinkId: id });
  },

  updateLink(id, fields) {
    set((state) => ({
      links: state.links.map((l) => {
        if (l.id !== id) return l;
        return {
          ...l,
          ruleType:
            fields.ruleType !== undefined ? fields.ruleType : l.ruleType,
          delegationType:
            fields.delegationType !== undefined
              ? fields.delegationType
              : l.delegationType,
          ruleDetails:
            fields.ruleDetails !== undefined ? fields.ruleDetails : l.ruleDetails,
        };
      }),
      isDirty: true,
    }));
  },

  openPanel() {
    set({ panelOpen: true });
  },

  closePanel() {
    set({ panelOpen: false });
  },

  togglePanel() {
    set((state) => ({ panelOpen: !state.panelOpen }));
  },

  setSelectionContext(ctx) {
    set({ selectionContext: ctx });
  },

  selectNode(id) {
    set({
      selectedNodeId: id,
      selectionContext: id !== null ? "node" : "none",
      // Deselect any link when a node is selected
      selectedLinkId: null,
    });
  },

  markDirty() {
    set({ isDirty: true });
  },

  markClean() {
    set({ isDirty: false });
  },

  setSavingGraph(saving) {
    set({ isSavingGraph: saving });
  },

  resetFlow() {
    set({
      agents: [],
      links: [],
      userNode: null,
      isPlacing: false,
      editingAgentId: null,
      selectedLinkId: null,
      selectedNodeId: null,
      selectionContext: "none",
      isDirty: false,
      isSavingGraph: false,
      profileModalTarget: null,
      permissionsModalTarget: null,
    });
  },

  loadFromProject(project) {
    // ── Reconstruct agents from the project's serializable agent models ──────
    const agents: CanvasAgent[] = project.agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      type: a.agentType ?? "Agent",
      isOrchestrator: a.isOrchestrator ?? false,
      hidden: a.hidden ?? false,
      x: a.position?.x ?? 0,
      y: a.position?.y ?? 0,
    }));

    // ── Reconstruct links from connections[] + their metadata ────────────────
    // The .afproj stores "user-node" directly as the user ID in connections.
    // No remapping needed — both store and file use USER_NODE_ID ("user-node").
    const links: AgentLink[] = project.connections.map((c) => {
      const meta = c.metadata ?? {};
      const ruleType: LinkRuleType =
        meta.relationType === "Response" ? "Response" : "Delegation";
      const rawDT = meta.delegationType;
      const delegationType: DelegationType =
        rawDT === "Mandatory"
          ? "Mandatory"
          : rawDT === "Conditional"
          ? "Conditional"
          : "Optional";
      return {
        id: c.id,
        fromAgentId: c.fromAgentId,
        toAgentId: c.toAgentId,
        ruleType,
        delegationType,
        ruleDetails: meta.ruleDetails ?? "",
      };
    });

    // ── Restore UserNode from project.user.position ──────────────────────────
    let userNode: UserNode | null = null;
    if (project.user?.position) {
      userNode = {
        id: USER_NODE_ID,
        name: "User",
        x: project.user.position.x,
        y: project.user.position.y,
      };
    }

    // ── Restore panelOpen from project.properties.ui.panelOpen ──────────────
    const ui = (project.properties as Record<string, unknown>)?.ui as
      | Record<string, unknown>
      | undefined;
    const panelOpen = typeof ui?.panelOpen === "boolean" ? ui.panelOpen : true;

    set({
      agents,
      links,
      userNode, // restored from project.user.position (or null if no user node)
      panelOpen,
      isPlacing: false,
      editingAgentId: null,
      selectedLinkId: null,
      selectedNodeId: null,
      selectionContext: "none",
      isDirty: false,
      isSavingGraph: false,
      profileModalTarget: null,
      permissionsModalTarget: null,
    });
  },

  addUserNode(x, y) {
    set((state) => {
      // Only one UserNode is allowed at a time
      if (state.userNode !== null) return {};
      const node: UserNode = { id: "user-node", name: "User", x, y };
      return { userNode: node, isDirty: true };
    });
  },

  removeUserNode() {
    set((state) => {
      if (state.userNode === null) return {};
      // Remove all links connected to the user-node
      const links = state.links.filter(
        (l) => l.fromAgentId !== "user-node" && l.toAgentId !== "user-node"
      );
      return { userNode: null, links, isDirty: true };
    });
  },

  moveUserNode(x, y) {
    set((state) => {
      if (state.userNode === null) return {};
      return { userNode: { ...state.userNode, x, y }, isDirty: true };
    });
  },
}));
