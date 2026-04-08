/**
 * src/ui/components/FlowCanvas.tsx
 *
 * FlowCanvas — the visual agent flow editor canvas.
 *
 * Interaction model:
 *   - MOVE node: drag only from the handle button (≡) in the top-right corner of each node.
 *   - CONNECT nodes: click and drag from any visible part of the node body
 *     (anywhere except the actions area: handle button and delete button).
 *     Release over a different node to create a link. Release elsewhere to cancel.
 *   - LINKS: rendered as rounded polyline paths (orthogonal segments with filleted corners).
 *     Straight line if nodes are aligned; L-shape (one turn) or Z-shape (two turns) otherwise.
 *     Corners are smoothed with a fixed arc radius (LINK_CORNER_R px). No splines/beziers.
 *     No arrows, no ports, no triangles.
 *   - LINK SELECTION: click on a link path to select it (wide transparent hitbox).
 *     Press Delete/Supr to remove selected link.
 *   - Multiple links between different node pairs are allowed.
 *     Self-connections are prevented.
 *
 * Component overview:
 *   - CanvasNode: renders a single placed agent node with:
 *       · Handle button (≡) top-right — drag to move node
 *       · Delete button (✕) top-right — removes node
 *       · Edit button (✏️) top-right — opens edit modal
 *       · Node body — drag to start a link connection
 *   - LinksSvg: SVG layer rendered below nodes, draws all links + in-progress drag line
 *   - GhostNode: transparent preview following the cursor in placement mode
 *   - FlowCanvas: main orchestrator component
 *
 * State separation:
 *   - dragRef / draggingId: track node MOVE drag (handle only)
 *   - linkDragRef / linkDrag: track CONNECT drag (body area)
 *   Both are mutually exclusive — a body drag starts as a connect, not a move.
 *
 * All mutations go through agentFlowStore (single source of truth).
 */

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useReducer } from "react";
import { type AgentType, useAgentFlowStore } from "../store/agentFlowStore.ts";

// ── Node dimensions ────────────────────────────────────────────────────────

const NODE_H = 100;
const NODE_W_DEFAULT = 100;
const NODE_W_ORCHESTRATOR = 400;

function getNodeW(isOrchestrator: boolean): number {
  return isOrchestrator ? NODE_W_ORCHESTRATOR : NODE_W_DEFAULT;
}

/** Get the visual center of a node (canvas-relative coordinates) */
function getNodeCenter(nodeX: number, nodeY: number, nodeW: number): { x: number; y: number } {
  return {
    x: nodeX + nodeW / 2,
    y: nodeY + NODE_H / 2,
  };
}

// ── Link colors & geometry ─────────────────────────────────────────────────

export const LINK_COLOR = "#6366f1";           // indigo — matches --color-primary
export const LINK_SELECTED_COLOR = "#a5b4fc";  // lighter indigo accent for selected

/** Fillet radius for rounded corners on polyline links (px). */
const LINK_CORNER_R = 16;

// ── Ghost node (placement mode) ────────────────────────────────────────────

interface GhostNodeProps {
  x: number;
  y: number;
}

function GhostNode({ x, y }: GhostNodeProps) {
  return (
    <div
      className="flow-canvas__ghost"
      style={{ left: x - NODE_W_DEFAULT / 2, top: y - NODE_H / 2 }}
      aria-hidden="true"
    >
      <span className="flow-canvas__ghost-label">New Agent</span>
    </div>
  );
}

// ── Drag state (move) ─────────────────────────────────────────────────────

interface DragState {
  agentId: string;
  offsetX: number;
  offsetY: number;
  currentX: number;
  currentY: number;
}

// ── Link drag state ───────────────────────────────────────────────────────

interface LinkDragState {
  /** ID of the source agent */
  fromAgentId: string;
  /** Canvas-relative coordinates of the source node center (start of line) */
  startX: number;
  startY: number;
  /** Current mouse position (canvas-relative) */
  currentX: number;
  currentY: number;
  /** Target agent we're hovering over, if any */
  hoverTargetId: string | null;
}

// ── Canvas Agent Node ──────────────────────────────────────────────────────

interface CanvasNodeProps {
  id: string;
  name: string;
  type: AgentType;
  isOrchestrator: boolean;
  x: number;
  y: number;
  isDragging: boolean;
  dragX?: number;
  dragY?: number;
  /** Whether this node is highlighted as a link drop target */
  isLinkTarget: boolean;
  /** Called when the user starts dragging the handle (to move the node) */
  onHandleMouseDown: (id: string, e: React.MouseEvent) => void;
  /** Called when user starts dragging from the node body (to create a link) */
  onBodyLinkDragStart: (agentId: string, e: React.MouseEvent) => void;
  /** Called when mouse enters this node during a link-drag */
  onNodeMouseEnterDuringLink: (agentId: string) => void;
  /** Called when mouse leaves this node during a link-drag */
  onNodeMouseLeaveDuringLink: () => void;
  /** Called when mouse is released on this node during a link-drag */
  onNodeMouseUpDuringLink: (agentId: string) => void;
}

function CanvasNode({
  id, name, type, isOrchestrator, x, y,
  isDragging, dragX, dragY,
  isLinkTarget,
  onHandleMouseDown,
  onBodyLinkDragStart,
  onNodeMouseEnterDuringLink,
  onNodeMouseLeaveDuringLink,
  onNodeMouseUpDuringLink,
}: CanvasNodeProps) {
  const openEditModal = useAgentFlowStore((s) => s.openEditModal);
  const deleteAgent = useAgentFlowStore((s) => s.deleteAgent);

  const left = isDragging && dragX !== undefined ? dragX : x;
  const top  = isDragging && dragY !== undefined ? dragY : y;
  const nodeW = getNodeW(isOrchestrator);

  /** The node body handles link-drag-start on mousedown */
  function handleBodyMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onBodyLinkDragStart(id, e);
  }

  return (
    <div
      className={[
        "flow-canvas__node",
        isDragging      ? "flow-canvas__node--dragging"     : "",
        isOrchestrator  ? "flow-canvas__node--orchestrator" : "",
        isLinkTarget    ? "flow-canvas__node--link-target"  : "",
      ].filter(Boolean).join(" ")}
      style={{ left, top, width: nodeW, height: NODE_H }}
      aria-label={`Agent: ${name}`}
      onMouseEnter={() => { onNodeMouseEnterDuringLink(id); }}
      onMouseLeave={() => { onNodeMouseLeaveDuringLink(); }}
      onMouseUp={() => { onNodeMouseUpDuringLink(id); }}
    >
      {/* ── Actions row: handle (drag to move) + edit + delete ──────────── */}
      <div className="flow-canvas__node-actions">
        {/* Handle button — drag starts node move */}
        <button
          className="flow-canvas__node-btn flow-canvas__node-btn--handle"
          onMouseDown={(e) => { onHandleMouseDown(id, e); }}
          title="Drag to move"
          aria-label={`Move ${name}`}
        >
          ≡
        </button>

        {/* Edit button */}
        <button
          className="flow-canvas__node-btn flow-canvas__node-btn--edit"
          onClick={(e) => { e.stopPropagation(); openEditModal(id); }}
          title="Edit agent"
          aria-label={`Edit ${name}`}
        >
          ✏️
        </button>

        {/* Delete button */}
        <button
          className="flow-canvas__node-btn flow-canvas__node-btn--delete"
          onClick={(e) => { e.stopPropagation(); deleteAgent(id); }}
          title="Delete agent"
          aria-label={`Delete ${name}`}
        >
          ✕
        </button>
      </div>

      {/* ── Node body — drag here to start a link connection ────────────── */}
      <div
        className="flow-canvas__node-body flow-canvas__node-body--connectable"
        onMouseDown={handleBodyMouseDown}
        title="Drag to connect to another agent"
      >
        <span
          className="flow-canvas__node-label"
          onDoubleClick={(e) => { e.stopPropagation(); openEditModal(id); }}
          title={name}
        >
          {name}
        </span>
        <div className="flow-canvas__node-meta">
          <span
            className={`flow-canvas__node-type${type === "Sub-Agent" ? " flow-canvas__node-type--sub" : ""}`}
          >
            {type}
          </span>
          {type === "Agent" && isOrchestrator && (
            <span className="flow-canvas__node-orchestrator" title="Orchestrator">
              🎯
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Links SVG Layer ────────────────────────────────────────────────────────
// Rendered BENEATH the node divs so nodes always appear on top.

interface LinksSvgProps {
  agents: Array<{ id: string; x: number; y: number; isOrchestrator: boolean }>;
  links: Array<{ id: string; fromAgentId: string; toAgentId: string }>;
  selectedLinkId: string | null;
  /** Live drag state for the in-progress link being drawn */
  linkDrag: LinkDragState | null;
  onLinkClick: (linkId: string, e: React.MouseEvent<SVGElement>) => void;
}

function LinksSvg({ agents, links, selectedLinkId, linkDrag, onLinkClick }: LinksSvgProps) {
  function getAgentPos(id: string) {
    return agents.find((a) => a.id === id);
  }

  /**
   * Build a rounded polyline SVG path between two points.
   *
   * Strategy:
   *   - If start and end share the same X (vertical) or same Y (horizontal),
   *     draw a straight line — no corners needed.
   *   - If nodes are offset in both axes, route through an L-shaped orthogonal
   *     path with the midpoint bend at the horizontal midpoint.
   *     The single corner is smoothed with a circular arc of radius LINK_CORNER_R.
   *
   * Arc direction: we use the SVG arc command (A rx ry x-rot large-arc sweep ex ey).
   *   - rx = ry = LINK_CORNER_R  (circular arc)
   *   - large-arc = 0            (always the shorter arc)
   *   - sweep = 1 or 0           (computed per corner to turn the right way)
   *
   * Corner anatomy (one vertex V in a polyline P0 → V → P1):
   *   1. Clamp the fillet radius so it never exceeds half the shorter adjacent segment.
   *   2. Walk `r` px back along P_prev→V to find the arc start (AS).
   *   3. Walk `r` px forward along V→P_next to find the arc end (AE).
   *   4. Emit: L AS, then A LINK_CORNER_R LINK_CORNER_R 0 0 sweep AE.
   */
  function makeRoundedPolylinePath(x1: number, y1: number, x2: number, y2: number): string {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const EPS = 0.5; // px threshold for "aligned"

    // ── Straight line (no turn needed) ───────────────────────────────────────
    if (Math.abs(dx) < EPS || Math.abs(dy) < EPS) {
      return `M${x1},${y1} L${x2},${y2}`;
    }

    // ── L-shaped path: go horizontally first, then vertically ─────────────────
    // Bend point: (x2, y1)
    const bx = x2;
    const by = y1;

    // Segment lengths
    const seg1 = Math.abs(bx - x1); // horizontal segment P0→B
    const seg2 = Math.abs(y2 - by); // vertical segment B→P2
    const r = Math.min(LINK_CORNER_R, seg1 / 2, seg2 / 2);

    // Direction vectors (unit)
    const d1x = Math.sign(bx - x1); // +1 or -1 (horizontal approach to corner)
    const d2y = Math.sign(y2 - by); // +1 or -1 (vertical departure from corner)

    // Arc start and end (walk r back from corner along each segment)
    const asx = bx - d1x * r;
    const asy = by;               // on horizontal segment → same Y as bend
    const aex = bx;
    const aey = by + d2y * r;    // on vertical segment → same X as bend

    // SVG arc sweep flag:
    //   sweep=1 means clockwise. We need to compute the correct turn direction.
    //   The cross product of (approach direction) × (departure direction) tells us:
    //   d1x * d2y > 0  →  turning right (CW) → sweep=1
    //   d1x * d2y < 0  →  turning left  (CCW) → sweep=0
    const sweep = d1x * d2y > 0 ? 1 : 0;

    return (
      `M${x1},${y1}` +
      ` L${asx},${asy}` +
      ` A${r},${r} 0 0 ${sweep} ${aex},${aey}` +
      ` L${x2},${y2}`
    );
  }

  return (
    <svg
      className="flow-canvas__links-svg"
      aria-hidden="true"
    >
      {/* ── Established links ──────────────────────────────────────────── */}
      {links.map((link) => {
        const fromAgent = getAgentPos(link.fromAgentId);
        const toAgent   = getAgentPos(link.toAgentId);
        if (!fromAgent || !toAgent) return null;

        const fromNodeW = getNodeW(fromAgent.isOrchestrator);
        const toNodeW   = getNodeW(toAgent.isOrchestrator);

        const from = getNodeCenter(fromAgent.x, fromAgent.y, fromNodeW);
        const to   = getNodeCenter(toAgent.x,   toAgent.y,   toNodeW);

        const isSelected = link.id === selectedLinkId;
        const strokeColor = isSelected ? LINK_SELECTED_COLOR : LINK_COLOR;
        const d = makeRoundedPolylinePath(from.x, from.y, to.x, to.y);

        return (
          <g key={link.id}>
            {/* Wide invisible hitbox for easier click selection */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={20}
              style={{ cursor: "pointer" }}
              onClick={(e) => onLinkClick(link.id, e)}
            />
            {/* Visible link — slightly thicker when selected */}
            <path
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={isSelected ? 3.5 : 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={isSelected ? "none" : undefined}
              style={{ cursor: "pointer", pointerEvents: "none" }}
              className={isSelected ? "flow-canvas__link--selected" : "flow-canvas__link"}
            />
            {/* Glow / outline effect for selected link */}
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke={LINK_SELECTED_COLOR}
                strokeWidth={8}
                strokeLinecap="round"
                opacity={0.18}
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>
        );
      })}

      {/* ── In-progress link drag ─────────────────────────────────────── */}
      {linkDrag && (() => {
        const d = makeRoundedPolylinePath(
          linkDrag.startX, linkDrag.startY,
          linkDrag.currentX, linkDrag.currentY,
        );
        return (
          <g>
            <path
              d={d}
              fill="none"
              stroke={LINK_COLOR}
              strokeWidth={2.5}
              strokeDasharray="8 4"
              strokeLinecap="round"
              opacity={0.7}
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })()}
    </svg>
  );
}

// ── FlowCanvas ─────────────────────────────────────────────────────────────

export function FlowCanvas() {
  const agents          = useAgentFlowStore((s) => s.agents);
  const isPlacing       = useAgentFlowStore((s) => s.isPlacing);
  const commitPlacement = useAgentFlowStore((s) => s.commitPlacement);
  const cancelPlacement = useAgentFlowStore((s) => s.cancelPlacement);
  const moveAgent       = useAgentFlowStore((s) => s.moveAgent);
  const links           = useAgentFlowStore((s) => s.links);
  const selectedLinkId  = useAgentFlowStore((s) => s.selectedLinkId);
  const addLink         = useAgentFlowStore((s) => s.addLink);
  const deleteLink      = useAgentFlowStore((s) => s.deleteLink);
  const selectLink      = useAgentFlowStore((s) => s.selectLink);

  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Placement mode state ─────────────────────────────────────────────────
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Node drag & drop state (MOVE — from handle only) ─────────────────────
  // Use refs as the single source of truth for drag state to avoid stale closures.
  // draggingIdRef is the canonical "am I dragging?" source; React state is only
  // used to trigger re-renders, not as the ground-truth value.
  const dragRef = useRef<DragState | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  // forceUpdate is used when we need to guarantee a re-render after refs mutate
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  // ── Link drag state (CONNECT — from body) ────────────────────────────────
  const linkDragRef = useRef<LinkDragState | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);

  // ── Canvas rect helper ───────────────────────────────────────────────────
  function getCanvasRect(): DOMRect | null {
    return canvasRef.current?.getBoundingClientRect() ?? null;
  }

  // ── Placement mode mouse tracking ─────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacing) return;
    const rect = getCanvasRect();
    if (!rect) return;
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, [isPlacing]);

  // Click on canvas: commit placement or deselect link
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isPlacing) {
      const rect = getCanvasRect();
      if (!rect) return;
      const x = e.clientX - rect.left - NODE_W_DEFAULT / 2;
      const y = e.clientY - rect.top - NODE_H / 2;
      commitPlacement(x, y);
      return;
    }
    // Click on blank canvas → deselect any selected link
    selectLink(null);
  }, [isPlacing, commitPlacement, selectLink]);

  // Escape key cancels placement
  useEffect(() => {
    if (!isPlacing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelPlacement();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlacing, cancelPlacement]);

  // Delete/Supr key removes selected link
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Supr") && selectedLinkId) {
        deleteLink(selectedLinkId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLinkId, deleteLink]);

  // ── Node MOVE drag (handle button only) ───────────────────────────────────
  //
  // Design goals (root-fix):
  //   1. Attach mousemove + mouseup listeners on `document` SYNCHRONOUSLY in
  //      onMouseDown — never inside a useEffect (which fires after the render cycle).
  //   2. Keep the dragging agent id in a REF (draggingIdRef) so the document
  //      listeners never have a stale closure on React state.
  //   3. `moveAgent` is accessed via moveAgentRef so it's always the latest version.
  //   4. `e.preventDefault()` is NOT called on mousedown — it can block mouseup
  //      propagation in Electron. We only stopPropagation to prevent body link-drag.
  //   5. mouseup ALWAYS clears both listeners, resets the ref AND the React state,
  //      and persists the final position. console.log calls are left for debugging.

  // Stable ref so the drag move/up handlers always see the current moveAgent action
  // without needing the action in their closure deps.
  const moveAgentRef = useRef(moveAgent);
  useLayoutEffect(() => { moveAgentRef.current = moveAgent; }, [moveAgent]);

  // Stable ref to always get the latest canvas bounding rect inside document listeners
  const canvasRefForDrag = canvasRef;

  const startDrag = useCallback((agentId: string, e: React.MouseEvent) => {
    if (isPlacing) return;
    // Guard: if already dragging (e.g. accidental double-mousedown), skip
    if (draggingIdRef.current !== null) {
      console.log("[drag] startDrag blocked — already dragging", draggingIdRef.current);
      return;
    }

    // stopPropagation prevents the canvas body link-drag from also firing,
    // but we do NOT call e.preventDefault() — that can block mouseup in Electron.
    e.stopPropagation();

    const rect = canvasRefForDrag.current?.getBoundingClientRect() ?? null;
    if (!rect) return;

    // Snapshot agent position at the moment drag starts.
    // We access the store directly here via the store getter to avoid
    // the stale-closure problem with `agents` in the useCallback dep array.
    const agentsNow = useAgentFlowStore.getState().agents;
    const agent = agentsNow.find((a) => a.id === agentId);
    if (!agent) return;

    const mouseCanvasX = e.clientX - rect.left;
    const mouseCanvasY = e.clientY - rect.top;

    const initialState: DragState = {
      agentId,
      offsetX: mouseCanvasX - agent.x,
      offsetY: mouseCanvasY - agent.y,
      currentX: agent.x,
      currentY: agent.y,
    };

    dragRef.current = initialState;
    draggingIdRef.current = agentId;

    // Sync React state for visual feedback
    setDraggingId(agentId);
    setDragPos({ x: agent.x, y: agent.y });

    console.log("[drag] START", agentId, { x: agent.x, y: agent.y });

    // ── Attach global listeners SYNCHRONOUSLY (no useEffect delay) ─────────

    function onMouseMove(ev: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      const r = canvasRefForDrag.current?.getBoundingClientRect() ?? null;
      if (!r) return;

      const newX = ev.clientX - r.left - ds.offsetX;
      const newY = ev.clientY - r.top  - ds.offsetY;

      ds.currentX = newX;
      ds.currentY = newY;

      // Update React state to re-render the node at the new position
      setDragPos({ x: newX, y: newY });
    }

    function onMouseUp(ev: MouseEvent) {
      console.log("[drag] MOUSEUP fired — button:", ev.button, "draggingId:", draggingIdRef.current);

      // Always remove listeners first (prevents any double-fire)
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const ds = dragRef.current;
      if (ds) {
        console.log("[drag] persisting position", ds.agentId, { x: ds.currentX, y: ds.currentY });
        // Persist the final position to the store
        moveAgentRef.current(ds.agentId, ds.currentX, ds.currentY);
      } else {
        console.warn("[drag] MOUSEUP — dragRef.current was null, position NOT persisted");
      }

      // Reset all drag state
      dragRef.current = null;
      draggingIdRef.current = null;

      // Update React state to end visual drag mode and force a clean re-render
      setDraggingId(null);
      setDragPos({ x: 0, y: 0 });
      forceUpdate();

      console.log("[drag] END — dragging cleared");
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    console.log("[drag] document listeners registered for", agentId);
  // NOTE: `agents` is intentionally REMOVED from deps — we use useAgentFlowStore.getState()
  // inside the callback to always get the latest agent position without recreating the callback.
  }, [isPlacing, canvasRefForDrag]);

  // ── Link CONNECT drag (node body) ─────────────────────────────────────────

  /**
   * Called when user starts dragging from the node body area.
   * We start a link-drag instead of a node-move drag.
   */
  const startLinkDrag = useCallback((agentId: string, e: React.MouseEvent) => {
    if (isPlacing) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = getCanvasRect();
    if (!rect) return;

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const nodeW = getNodeW(agent.isOrchestrator);
    const center = getNodeCenter(agent.x, agent.y, nodeW);

    const state: LinkDragState = {
      fromAgentId: agentId,
      startX: center.x,
      startY: center.y,
      currentX: e.clientX - rect.left,
      currentY: e.clientY - rect.top,
      hoverTargetId: null,
    };
    linkDragRef.current = state;
    setLinkDrag({ ...state });
  }, [isPlacing, agents]);

  // Node hover callbacks (used during link-drag to highlight drop targets)
  const handleNodeEnterDuringLink = useCallback((agentId: string) => {
    const ld = linkDragRef.current;
    if (!ld) return;
    if (ld.fromAgentId === agentId) return; // no self-connection highlight
    ld.hoverTargetId = agentId;
    setLinkDrag({ ...ld });
  }, []);

  const handleNodeLeaveDuringLink = useCallback(() => {
    const ld = linkDragRef.current;
    if (!ld) return;
    ld.hoverTargetId = null;
    setLinkDrag({ ...ld });
  }, []);

  const handleNodeMouseUpDuringLink = useCallback((agentId: string) => {
    const ld = linkDragRef.current;
    if (!ld) return;
    if (ld.fromAgentId !== agentId) {
      addLink(ld.fromAgentId, agentId);
    }
    linkDragRef.current = null;
    setLinkDrag(null);
  }, [addLink]);

  // Global mousemove/mouseup for link drag
  useEffect(() => {
    if (!linkDrag) return;

    function onMouseMove(e: MouseEvent) {
      const ld = linkDragRef.current;
      if (!ld) return;
      const rect = getCanvasRect();
      if (!rect) return;
      ld.currentX = e.clientX - rect.left;
      ld.currentY = e.clientY - rect.top;
      setLinkDrag({ ...ld });
    }

    function onMouseUp() {
      // Released over blank canvas — cancel
      linkDragRef.current = null;
      setLinkDrag(null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, [linkDrag !== null]); // only rebind when drag starts/ends

  // ── Link click (select) ───────────────────────────────────────────────────
  const handleLinkClick = useCallback((linkId: string, e: React.MouseEvent<SVGElement>) => {
    e.stopPropagation();
    selectLink(linkId === selectedLinkId ? null : linkId);
  }, [selectLink, selectedLinkId]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isDraggingLink = linkDrag !== null;

  /**
   * Live agent positions for the SVG links layer.
   * While a node is being dragged, its position in the store is NOT yet updated
   * (the store is only written on mouseup). We substitute the live dragPos so
   * that all connection lines follow the dragged node in real time.
   */
  const liveAgentPositions = agents.map((a) => ({
    id: a.id,
    x: draggingId === a.id ? dragPos.x : a.x,
    y: draggingId === a.id ? dragPos.y : a.y,
    isOrchestrator: a.isOrchestrator,
  }));

  return (
    <div
      ref={canvasRef}
      className={[
        "flow-canvas",
        isPlacing       ? "flow-canvas--placing"         : "",
        draggingId      ? "flow-canvas--dragging-active" : "",
        isDraggingLink  ? "flow-canvas--linking"         : "",
      ].filter(Boolean).join(" ")}
      onMouseMove={handleMouseMove}
      onClick={handleCanvasClick}
      aria-label="Flow canvas"
      role="region"
    >
      {/* SVG links layer — rendered first in DOM and z-index: 0 so nodes (z-index: 2) always appear above */}
      <LinksSvg
        agents={liveAgentPositions}
        links={links}
        selectedLinkId={selectedLinkId}
        linkDrag={linkDrag}
        onLinkClick={handleLinkClick}
      />

      {/* Placed agent nodes */}
      {agents.map((agent) => (
        <CanvasNode
          key={agent.id}
          id={agent.id}
          name={agent.name}
          type={agent.type}
          isOrchestrator={agent.isOrchestrator}
          x={agent.x}
          y={agent.y}
          isDragging={draggingId === agent.id}
          dragX={draggingId === agent.id ? dragPos.x : undefined}
          dragY={draggingId === agent.id ? dragPos.y : undefined}
          isLinkTarget={
            isDraggingLink &&
            linkDrag?.hoverTargetId === agent.id &&
            linkDrag?.fromAgentId !== agent.id
          }
          onHandleMouseDown={startDrag}
          onBodyLinkDragStart={startLinkDrag}
          onNodeMouseEnterDuringLink={handleNodeEnterDuringLink}
          onNodeMouseLeaveDuringLink={handleNodeLeaveDuringLink}
          onNodeMouseUpDuringLink={handleNodeMouseUpDuringLink}
        />
      ))}

      {/* Ghost node follows the mouse in placement mode */}
      {isPlacing && (
        <GhostNode x={mousePos.x} y={mousePos.y} />
      )}

      {/* Empty state hint (when no nodes and not placing) */}
      {agents.length === 0 && !isPlacing && (
        <div className="flow-canvas__empty">
          <span aria-hidden="true">🤖</span>
          <p>Click <strong>+ Nuevo agente</strong> in the sidebar to add your first agent.</p>
        </div>
      )}

      {/* Placement mode hint */}
      {isPlacing && (
        <div className="flow-canvas__placing-hint" aria-live="polite">
          Click to place the agent — press <kbd>Esc</kbd> to cancel
        </div>
      )}

      {/* Link selected hint */}
      {selectedLinkId && !isPlacing && (
        <div className="flow-canvas__placing-hint flow-canvas__placing-hint--link" aria-live="polite">
          Link selected — press <kbd>Supr</kbd> or <kbd>Delete</kbd> to remove
        </div>
      )}
    </div>
  );
}
