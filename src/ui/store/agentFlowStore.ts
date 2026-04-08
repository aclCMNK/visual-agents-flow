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
 * @deprecated InputPortId is kept for backwards compatibility but is no longer
 * used to describe port positions. Links now connect node centers directly.
 */
export type InputPortId = "left" | "bottom" | "top";

/** A directed link from one agent node center to another agent node center */
export interface AgentLink {
  /** Unique link identifier */
  id: string;
  /** ID of the source agent */
  fromAgentId: string;
  /** ID of the target agent */
  toAgentId: string;
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
}

/** State for the flow store */
export interface AgentFlowState {
  /** All agent nodes placed on the canvas */
  agents: CanvasAgent[];
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
   * Add a directed link from one agent to another (center-to-center).
   * No-ops if fromAgentId === toAgentId or if an identical link already exists.
   * Multiple links between different pairs are allowed.
   */
  addLink(fromAgentId: string, toAgentId: string): void;
  /** Delete a link by id */
  deleteLink(id: string): void;
  /** Select a link (for deletion or inspection) */
  selectLink(id: string | null): void;
}

export type AgentFlowStore = AgentFlowState & AgentFlowActions;

// ── Initial state ──────────────────────────────────────────────────────────

const initialState: AgentFlowState = {
  agents: [],
  isPlacing: false,
  editingAgentId: null,
  links: [],
  selectedLinkId: null,
};

// ── Store ──────────────────────────────────────────────────────────────────

export const useAgentFlowStore = create<AgentFlowStore>((set) => ({
  ...initialState,

  startPlacement() {
    set({ isPlacing: true });
  },

  commitPlacement(x, y) {
    const newAgent: CanvasAgent = {
      id: uuid(),
      name: "New Agent",
      description: "",
      type: "Agent",
      isOrchestrator: false,
      x,
      y,
    };
    set((state) => ({
      agents: [...state.agents, newAgent],
      isPlacing: false,
    }));
  },

  cancelPlacement() {
    set({ isPlacing: false });
  },

  renameAgent(id, newName) {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, name: newName.trim() || a.name } : a
      ),
    }));
  },

  updateAgent(id, fields) {
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== id) return a;
        const nextType = fields.type !== undefined ? fields.type : a.type;
        return {
          ...a,
          name: fields.name !== undefined ? fields.name.trim() || a.name : a.name,
          description: fields.description !== undefined ? fields.description : a.description,
          type: nextType,
          // isOrchestrator is only persisted when type is Agent; reset to false for Sub-Agent
          isOrchestrator:
            nextType === "Agent"
              ? (fields.isOrchestrator !== undefined ? fields.isOrchestrator : a.isOrchestrator)
              : false,
        };
      }),
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
    }));
  },

  moveAgent(id, x, y) {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, x, y } : a
      ),
    }));
  },

  openEditModal(id) {
    set({ editingAgentId: id });
  },

  closeEditModal() {
    set({ editingAgentId: null });
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
      };
      return { links: [...state.links, newLink] };
    });
  },

  deleteLink(id) {
    set((state) => ({
      links: state.links.filter((l) => l.id !== id),
      selectedLinkId: state.selectedLinkId === id ? null : state.selectedLinkId,
    }));
  },

  selectLink(id) {
    set({ selectedLinkId: id });
  },
}));
