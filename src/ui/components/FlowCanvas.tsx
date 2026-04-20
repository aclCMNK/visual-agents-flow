/**
 * src/ui/components/FlowCanvas.tsx
 *
 * FlowCanvas — the visual agent flow editor canvas.
 *
 * Interaction model:
 *   - POINTER mode (default):
 *     · MOVE node: drag only from the handle button (≡) in the top-right corner of each node.
 *     · SELECT node: click anywhere on the node body → selects the node & opens properties panel.
 *     · CONNECT nodes: drag from the dedicated connection grip (⊕ icon) visible on node hover.
 *       Release over a different node to create a link. Release elsewhere to cancel.
 *       A plain click on the node body NEVER initiates a connection drag.
 *   - HAND (PAN) mode:
 *     · Click+drag anywhere on the canvas (even over nodes) to pan the viewport.
 *     · Node interactions (move, connect) are disabled while panning.
 *     · Nodes receive pointer-events: none via CSS so the canvas receives all events.
 *
 *   - LINKS: rendered as rounded polyline paths (orthogonal segments with filleted corners).
 *   - ZOOM: mouse wheel or slider (10%–400%), centered on canvas midpoint.
 *   - PAN + ZOOM: persisted to .afproj via projectStore.saveProject({ properties: { canvasView } }).
 *
 * Component overview:
 *   - CanvasNode: renders a single placed agent node
 *   - LinksSvg: SVG layer rendered below nodes, draws all links + in-progress drag line
 *   - GhostNode: transparent preview following the cursor in placement mode
 *   - CanvasToolPanel: floating top-left panel with Pointer / Hand mode buttons
 *   - CanvasZoomPanel: floating bottom-right panel with zoom slider + center button
 *   - FlowCanvas: main orchestrator component
 *
 * State separation:
 *   - dragRef / draggingId: track node MOVE drag (handle only)
 *   - linkDragRef / linkDrag: track CONNECT drag (body area)
 *   - panRef / isPanning: track canvas PAN (hand mode drag)
 *   - panOffset / zoom: viewport transform state
 *   Both node-drag and link-drag are mutually exclusive with pan.
 *
 * All mutations go through agentFlowStore (single source of truth).
 * Viewport state (pan + zoom) is saved to projectStore.properties.canvasView.
 */

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useReducer } from "react";
import { type AgentType, useAgentFlowStore, USER_NODE_ID } from "../store/agentFlowStore.ts";
import { useProjectStore } from "../store/projectStore.ts";
import { useEditorConfig } from "../hooks/useEditorConfig.ts";
import { AgentCanvasSaveButton } from "./AgentCanvasSaveButton.tsx";

// ── User Node dimensions ───────────────────────────────────────────────────
// The User node is a circle; we use diameter for both width and height.
export const USER_NODE_DIAMETER = 80;

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

// ── Zoom constraints ───────────────────────────────────────────────────────

const ZOOM_MIN = 0.10; // 10%
const ZOOM_MAX = 4.00; // 400%
const ZOOM_DEFAULT = 1.00;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// ── Link colors & geometry ─────────────────────────────────────────────────

export const LINK_COLOR = "#6366f1";                // indigo — Delegation (matches --color-primary)
export const LINK_SELECTED_COLOR = "#a5b4fc";       // lighter indigo accent for selected Delegation
export const LINK_RESPONSE_COLOR = "#AE9400";       // dark yellow — Response rule type
export const LINK_RESPONSE_SELECTED_COLOR = "#D4B800"; // brighter yellow for selected Response

/** Base stroke width for a normal (unselected) link. */
const LINK_STROKE_WIDTH = 2.5;
/** Extra width added on top of LINK_STROKE_WIDTH when the link is selected. */
const LINK_STROKE_SELECTED_EXTRA = 3;
/** Width of the invisible hitbox path (for click detection). */
const LINK_HIT_WIDTH = 20;

/** Fillet radius for rounded corners on polyline links (px). */
const LINK_CORNER_R = 16;

// ── Tool mode ──────────────────────────────────────────────────────────────

type CanvasTool = "pointer" | "hand";

// ── Viewport state ─────────────────────────────────────────────────────────

interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

// ── Material Icon SVGs (inline — no external CDN needed, CSP-safe) ─────────

/** Pointer / arrow cursor icon */
function IconCursor({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M4 0l16 12.3-6.7 1-3 6.7L4 0z" />
    </svg>
  );
}

/** Open hand / pan tool icon */
function IconHand({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M21 7c0-1.1-.9-2-2-2-.28 0-.54.06-.79.15C17.93 4.46 17.24 4 16.5 4c-.45 0-.86.15-1.19.4C14.96 3.57 14.26 3 13.5 3c-.55 0-1.04.22-1.4.57L12 3.5V2c0-1.1-.9-2-2-2S8 .9 8 2v8.08c-.38-.34-.85-.6-1.38-.73-1.57-.38-2.98.85-2.6 2.42L5.42 16c.63 2.56 2.99 4 5.58 4h2c3.31 0 6-2.69 6-6V9c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

/** Target / center view icon */
function IconTarget({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </svg>
  );
}

/** Reset zoom icon — magnifying glass with circular refresh arrow */
function IconResetZoom({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {/* Magnifying glass lens */}
      <circle cx="10" cy="10" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      {/* Magnifying glass handle */}
      <line x1="14.2" y1="14.2" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Circular refresh arrow around the lens (top-right arc + arrowhead) */}
      <path
        d="M15 5.5A7.5 7.5 0 0 0 10 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <polygon points="15,3 15,7 11.5,5" fill="currentColor" />
    </svg>
  );
}

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

// ── User Canvas Node ───────────────────────────────────────────────────────
// A special immutable circular node representing the end-user in the flow.
// - Cannot be edited, renamed, deleted, or configured.
// - Can be moved with drag (handle button).
// - Can participate in connections (grip drag).

interface UserCanvasNodeProps {  x: number;
  y: number;
  isDragging: boolean;
  dragX?: number;
  dragY?: number;
  /** Whether this node is currently selected (shows glow) */
  isSelected: boolean;
  /** Whether this node is highlighted as a link drop target */
  isLinkTarget: boolean;
  /** Whether a link drag is currently in progress (from any node) */
  isLinkDragActive: boolean;
  /** Called when the user starts dragging the handle (to move the node) */
  onHandleMouseDown: (id: string, e: React.MouseEvent) => void;
  /** Called when user starts dragging from the dedicated connection grip */
  onGripMouseDown: (id: string, e: React.MouseEvent) => void;
  /** Called when the node body is clicked (select only) */
  onBodyClick: (id: string) => void;
  /** Called when mouse enters this node during a link-drag */
  onNodeMouseEnterDuringLink: (id: string) => void;
  /** Called when mouse leaves this node during a link-drag */
  onNodeMouseLeaveDuringLink: () => void;
  /** Called when mouse is released on this node during a link-drag */
  onNodeMouseUpDuringLink: (id: string) => void;
}

function UserCanvasNode({
  x, y,
  isDragging, dragX, dragY,
  isSelected, isLinkTarget, isLinkDragActive,
  onHandleMouseDown,
  onGripMouseDown,
  onBodyClick,
  onNodeMouseEnterDuringLink,
  onNodeMouseLeaveDuringLink,
  onNodeMouseUpDuringLink,
}: UserCanvasNodeProps) {
  const left = isDragging && dragX !== undefined ? dragX : x;
  const top  = isDragging && dragY !== undefined ? dragY : y;

  function handleBodyMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onBodyClick(USER_NODE_ID);
  }

  function handleGripMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onGripMouseDown(USER_NODE_ID, e);
  }

  return (
    <div
      className={[
        "flow-canvas__user-node",
        isDragging       ? "flow-canvas__user-node--dragging"          : "",
        isSelected       ? "flow-canvas__user-node--selected"          : "",
        isLinkTarget     ? "flow-canvas__user-node--link-target"       : "",
        isLinkDragActive ? "flow-canvas__user-node--link-drag-active"  : "",
      ].filter(Boolean).join(" ")}
      style={{
        left,
        top,
        width:  USER_NODE_DIAMETER,
        height: USER_NODE_DIAMETER,
      }}
      aria-label="User node"
      onMouseEnter={() => { onNodeMouseEnterDuringLink(USER_NODE_ID); }}
      onMouseLeave={() => { onNodeMouseLeaveDuringLink(); }}
      onMouseUp={() => { onNodeMouseUpDuringLink(USER_NODE_ID); }}
      onClick={(e) => { e.stopPropagation(); }}
    >
      {/* ── Handle: drag to move ─────────────────────────────────────── */}
      <button
        className="flow-canvas__user-node__handle"
        onMouseDown={(e) => { onHandleMouseDown(USER_NODE_ID, e); }}
        title="Drag to move"
        aria-label="Move User node"
      >
        ≡
      </button>

      {/* ── Body: click to select ────────────────────────────────────── */}
      <div
        className="flow-canvas__user-node__body"
        onMouseDown={handleBodyMouseDown}
        title="User — immutable node"
      >
        {/* Person silhouette SVG icon */}
        <svg
          className="flow-canvas__user-node__icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="currentColor"
        >
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
        </svg>
        <span className="flow-canvas__user-node__label">User</span>
      </div>

      {/* ── Connection grip ──────────────────────────────────────────── */}
      <div
        className="flow-canvas__user-node__grip"
        onMouseDown={handleGripMouseDown}
        title="Drag to connect to an agent"
        aria-label="Connect from User node"
      >
        <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
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

// ── Floating Tool Panel ────────────────────────────────────────────────────

interface CanvasToolPanelProps {
  activeTool: CanvasTool;
  onSelectTool: (tool: CanvasTool) => void;
}

function CanvasToolPanel({ activeTool, onSelectTool }: CanvasToolPanelProps) {
  return (
    <div className="canvas-tool-panel" role="toolbar" aria-label="Canvas tools">
      <button
        className={`canvas-tool-panel__btn${activeTool === "pointer" ? " canvas-tool-panel__btn--active" : ""}`}
        onClick={() => onSelectTool("pointer")}
        title="Pointer — select / move / connect nodes"
        aria-pressed={activeTool === "pointer"}
        aria-label="Pointer mode"
      >
        <IconCursor size={20} />
      </button>
      <button
        className={`canvas-tool-panel__btn${activeTool === "hand" ? " canvas-tool-panel__btn--active" : ""}`}
        onClick={() => onSelectTool("hand")}
        title="Hand — click+drag to pan the canvas"
        aria-pressed={activeTool === "hand"}
        aria-label="Hand (pan) mode"
      >
        <IconHand size={20} />
      </button>
    </div>
  );
}

// ── Floating Zoom Panel ────────────────────────────────────────────────────

interface CanvasZoomPanelProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onCenterView: () => void;
  onResetZoom: () => void;
}

function CanvasZoomPanel({ zoom, onZoomChange, onCenterView, onResetZoom }: CanvasZoomPanelProps) {
  const pct = Math.round(zoom * 100);

  // Map zoom (0.10–4.00) to slider value (0–100) with log scale for feel
  // We use a simple linear mapping over the clamped range
  const sliderMin = ZOOM_MIN;
  const sliderMax = ZOOM_MAX;

  function zoomToSlider(z: number): number {
    // Log scale: slider 0→100 maps to zoom log(min)→log(max)
    const logMin = Math.log(sliderMin);
    const logMax = Math.log(sliderMax);
    const logZ = Math.log(z);
    return ((logZ - logMin) / (logMax - logMin)) * 100;
  }

  function sliderToZoom(v: number): number {
    const logMin = Math.log(sliderMin);
    const logMax = Math.log(sliderMax);
    return Math.exp(logMin + (v / 100) * (logMax - logMin));
  }

  const sliderValue = zoomToSlider(clampZoom(zoom));

  // Track fill gradient for visual feedback
  const pctFill = sliderValue;
  const trackStyle = {
    background: `linear-gradient(to right, var(--color-primary) ${pctFill}%, var(--color-surface-2) ${pctFill}%)`,
  };

  return (
    <div className="canvas-zoom-panel" role="group" aria-label="Zoom controls">
      <span className="canvas-zoom-panel__label" aria-live="polite" aria-label="Zoom level">
        {pct}%
      </span>
      <input
        type="range"
        className="canvas-zoom-panel__slider"
        min={0}
        max={100}
        step={0.5}
        value={sliderValue}
        onChange={(e) => {
          const newZoom = clampZoom(sliderToZoom(Number(e.target.value)));
          onZoomChange(newZoom);
        }}
        style={trackStyle}
        aria-label="Zoom slider"
        aria-valuemin={Math.round(ZOOM_MIN * 100)}
        aria-valuemax={Math.round(ZOOM_MAX * 100)}
        aria-valuenow={pct}
      />
      <button
        className="canvas-zoom-panel__center-btn"
        onClick={onCenterView}
        title="Center view — fit all nodes in canvas"
        aria-label="Center view"
      >
        <IconTarget size={16} />
      </button>
      <button
        className="canvas-zoom-panel__center-btn"
        onClick={onResetZoom}
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100%"
      >
        <IconResetZoom size={16} />
      </button>
    </div>
  );
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
  /** Whether this node is currently selected (shows glow) */
  isSelected: boolean;
  /** Whether this node is highlighted as a link drop target */
  isLinkTarget: boolean;
  /** Whether a link drag is currently in progress (from any node) */
  isLinkDragActive: boolean;
  /** Current canvas zoom level — used to counter-scale action buttons */
  zoom: number;
  /** Called when the user starts dragging the handle (to move the node) */
  onHandleMouseDown: (id: string, e: React.MouseEvent) => void;
  /** Called when user starts dragging from the dedicated connection grip */
  onGripMouseDown: (agentId: string, e: React.MouseEvent) => void;
  /** Called when the node body is clicked (select only — no link drag) */
  onBodyClick: (agentId: string) => void;
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
  isSelected, isLinkTarget, isLinkDragActive,
  zoom,
  onHandleMouseDown,
  onGripMouseDown,
  onBodyClick,
  onNodeMouseEnterDuringLink,
  onNodeMouseLeaveDuringLink,
  onNodeMouseUpDuringLink,
}: CanvasNodeProps) {
  const openEditModal = useAgentFlowStore((s) => s.openEditModal);
  const deleteAgent = useAgentFlowStore((s) => s.deleteAgent);

  const left = isDragging && dragX !== undefined ? dragX : x;
  const top  = isDragging && dragY !== undefined ? dragY : y;
  const nodeW = getNodeW(isOrchestrator);

  /** Node body click — selects the node, never starts a link drag */
  function handleBodyMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onBodyClick(id);
  }

  /** Connection grip mousedown — immediately starts a link drag */
  function handleGripMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onGripMouseDown(id, e);
  }

  return (
    <div
      className={[
        "flow-canvas__node",
        isDragging      ? "flow-canvas__node--dragging"     : "",
        isOrchestrator  ? "flow-canvas__node--orchestrator" : "",
        isSelected      ? "flow-canvas__node--selected"     : "",
        isLinkTarget    ? "flow-canvas__node--link-target"  : "",
        isLinkDragActive ? "flow-canvas__node--link-drag-active" : "",
      ].filter(Boolean).join(" ")}
      style={{ left, top, width: nodeW, height: NODE_H }}
      aria-label={`Agent: ${name}`}
      onMouseEnter={() => { onNodeMouseEnterDuringLink(id); }}
      onMouseLeave={() => { onNodeMouseLeaveDuringLink(); }}
      onMouseUp={() => { onNodeMouseUpDuringLink(id); }}
      onClick={(e) => { e.stopPropagation(); }}
    >
      {/* ── Actions row: handle (drag to move) + edit + delete ──────────── */}
      <div
        className="flow-canvas__node-actions"
        style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top right" }}
      >
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

      {/* ── Node body — click to select, NOT for starting connections ───── */}
      <div
        className="flow-canvas__node-body"
        onMouseDown={handleBodyMouseDown}
        title={name}
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

      {/* ── Connection grip — drag from here to create a link ────────────── */}
      <div
        className="flow-canvas__node-grip"
        onMouseDown={handleGripMouseDown}
        title="Drag to connect to another agent"
        aria-label={`Connect from ${name}`}
      >
        <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ── Links SVG Layer ────────────────────────────────────────────────────────
// Rendered BENEATH the node divs so nodes always appear on top.

/** Size of the arrowhead triangle in pixels (half-base and height). */
const ARROW_SIZE = 10; // half-base of triangle (total base = 2×ARROW_SIZE)
const ARROW_HEIGHT = 14; // height of the triangle along the direction vector
/** Gap between arrowhead tip and node border edge (px). */
const ARROW_MARGIN = 2;

/**
 * Compute the point on the rectangular border of the destination node that
 * the incoming line (from `from`) intersects.
 *
 * The node occupies [nx, ny] … [nx+nw, ny+nh] in canvas space.
 * We cast a ray from the node center outward toward `from` and find where
 * it exits the node rectangle. That exit point is the border contact.
 */
function getNodeBorderPoint(
  from: { x: number; y: number },
  nx: number, ny: number,
  nw: number, nh: number,
): { x: number; y: number } {
  const cx = nx + nw / 2;
  const cy = ny + nh / 2;

  const dx = from.x - cx;
  const dy = from.y - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    // Degenerate — source and dest centers coincide, return right edge
    return { x: cx + nw / 2, y: cy };
  }

  // Compute t for intersection with each of the 4 sides, keep the smallest positive t
  // Right: x = cx + nw/2  →  t = (nw/2) / |dx| when dx !== 0
  // Left:  x = cx - nw/2
  // Bottom: y = cy + nh/2
  // Top:   y = cy - nh/2
  const hw = nw / 2;
  const hh = nh / 2;

  let tMin = Infinity;

  if (Math.abs(dx) > 0.001) {
    const t1 = hw / Math.abs(dx);   // right or left
    tMin = Math.min(tMin, t1);
  }
  if (Math.abs(dy) > 0.001) {
    const t2 = hh / Math.abs(dy);   // top or bottom
    tMin = Math.min(tMin, t2);
  }

  // Border contact (on the node border, in the direction toward `from`)
  return {
    x: cx + dx * tMin,
    y: cy + dy * tMin,
  };
}

/**
 * Build the SVG polygon `points` string for a solid arrowhead triangle.
 *
 * The tip is placed at `tipX, tipY`.
 * The triangle points from `from` toward `tipX, tipY` (i.e. it "arrives" at tip).
 *
 * @param tipX   - tip of the arrowhead (on/near the node border)
 * @param tipY
 * @param fromX  - where the line comes from (direction source)
 * @param fromY
 * @param size   - half-width of the triangle base
 * @param height - length of the triangle along the direction axis
 */
function arrowheadPoints(
  tipX: number, tipY: number,
  fromX: number, fromY: number,
  size: number, height: number,
): string {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return "";

  // Unit vector along arrival direction
  const ux = dx / len;
  const uy = dy / len;

  // Perpendicular unit vector
  const px = -uy;
  const py =  ux;

  // Base center = tip - height * unit
  const bx = tipX - ux * height;
  const by = tipY - uy * height;

  // Two base corners
  const b1x = bx + px * size;
  const b1y = by + py * size;
  const b2x = bx - px * size;
  const b2y = by - py * size;

  return `${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`;
}

interface LinksSvgProps {
  agents: Array<{ id: string; x: number; y: number; isOrchestrator: boolean }>;
  links: Array<{ id: string; fromAgentId: string; toAgentId: string; ruleType: string }>;
  selectedLinkId: string | null;
  /** Live drag state for the in-progress link being drawn */
  linkDrag: LinkDragState | null;
  onLinkClick: (linkId: string, e: React.MouseEvent<SVGElement>) => void;
}

/** Resolve the effective node width for link endpoint calculations */
function resolveNodeW(id: string, isOrchestrator: boolean): number {
  if (id === USER_NODE_ID) return USER_NODE_DIAMETER;
  return getNodeW(isOrchestrator);
}

/** Resolve the effective node height for link endpoint calculations */
function resolveNodeH(id: string): number {
  if (id === USER_NODE_ID) return USER_NODE_DIAMETER;
  return NODE_H;
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
    const bx = x2;
    const by = y1;

    const seg1 = Math.abs(bx - x1);
    const seg2 = Math.abs(y2 - by);
    const r = Math.min(LINK_CORNER_R, seg1 / 2, seg2 / 2);

    const d1x = Math.sign(bx - x1);
    const d2y = Math.sign(y2 - by);

    const asx = bx - d1x * r;
    const asy = by;
    const aex = bx;
    const aey = by + d2y * r;

    const sweep = d1x * d2y > 0 ? 1 : 0;

    return (
      `M${x1},${y1}` +
      ` L${asx},${asy}` +
      ` A${r},${r} 0 0 ${sweep} ${aex},${aey}` +
      ` L${x2},${y2}`
    );
  }

  /**
   * Compute the arrowhead position and orientation for a connection that
   * arrives at the destination node.
   */
  function computeArrowhead(
    fromCenter: { x: number; y: number },
    toNodeId: string,
    toNodeX: number, toNodeY: number,
    toNodeW: number,
  ): { tipX: number; tipY: number; fromDirX: number; fromDirY: number } | null {
    const toNodeH = resolveNodeH(toNodeId);
    const toCX = toNodeX + toNodeW / 2;
    const toCY = toNodeY + toNodeH / 2;

    const EPS = 0.5;
    const dx = toCX - fromCenter.x;
    const dy = toCY - fromCenter.y;

    if (Math.sqrt(dx * dx + dy * dy) < 0.001) return null;

    let fromDirX: number;
    let fromDirY: number;
    let approachX: number;
    let approachY: number;

    if (Math.abs(dx) < EPS) {
      fromDirX = 0;
      fromDirY = dy > 0 ? 1 : -1;
      approachX = toCX;
      approachY = toCY - fromDirY * 1000;
    } else if (Math.abs(dy) < EPS) {
      fromDirX = dx > 0 ? 1 : -1;
      fromDirY = 0;
      approachX = toCX - fromDirX * 1000;
      approachY = toCY;
    } else {
      fromDirX = 0;
      fromDirY = dy > 0 ? 1 : -1;
      approachX = toCX;
      approachY = toCY - fromDirY * 1000;
    }

    const border = getNodeBorderPoint(
      { x: approachX, y: approachY },
      toNodeX, toNodeY,
      toNodeW, toNodeH,
    );

    const tipX = border.x - fromDirX * ARROW_MARGIN;
    const tipY = border.y - fromDirY * ARROW_MARGIN;

    return { tipX, tipY, fromDirX, fromDirY };
  }

  return (
    <svg
      className="flow-canvas__links-svg"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {/* ── Established links ──────────────────────────────────────────── */}
      {links.map((link) => {
        const fromAgent = getAgentPos(link.fromAgentId);
        const toAgent   = getAgentPos(link.toAgentId);
        if (!fromAgent || !toAgent) return null;

        const fromNodeW = resolveNodeW(fromAgent.id, fromAgent.isOrchestrator);
        const toNodeW   = resolveNodeW(toAgent.id, toAgent.isOrchestrator);
        const fromNodeH = resolveNodeH(fromAgent.id);
        const toNodeH   = resolveNodeH(toAgent.id);

        const from = {
          x: fromAgent.x + fromNodeW / 2,
          y: fromAgent.y + fromNodeH / 2,
        };
        const to = {
          x: toAgent.x + toNodeW / 2,
          y: toAgent.y + toNodeH / 2,
        };
        const isSelected = link.id === selectedLinkId;
        const isResponse = link.ruleType === "Response";
        const baseColor     = isResponse ? LINK_RESPONSE_COLOR : LINK_COLOR;
        const selectedColor = isResponse ? LINK_RESPONSE_SELECTED_COLOR : LINK_SELECTED_COLOR;
        const strokeColor = isSelected ? selectedColor : baseColor;
        const strokeWidth = isSelected
          ? LINK_STROKE_WIDTH + LINK_STROKE_SELECTED_EXTRA
          : LINK_STROKE_WIDTH;
        const d = makeRoundedPolylinePath(from.x, from.y, to.x, to.y);

        // Arrowhead on the destination end
        const arrow = computeArrowhead(from, toAgent.id, toAgent.x, toAgent.y, toNodeW);
        const arrowPts = arrow
          ? arrowheadPoints(
              arrow.tipX, arrow.tipY,
              arrow.tipX - arrow.fromDirX,
              arrow.tipY - arrow.fromDirY,
              ARROW_SIZE,
              ARROW_HEIGHT,
            )
          : "";

        return (
          <g key={link.id}>
            {/*
             * 1. HITBOX — wide invisible stroke for precise click detection.
             *    Must appear FIRST in the DOM (painted below the visible path).
             *    Uses pointer-events: stroke so SVG hit-tests the stroke area
             *    regardless of fill/color. The parent SVG has pointer-events: none
             *    but individual children can override it.
             */}
            <path
              d={d}
              fill="none"
              stroke="rgba(0,0,0,0)"
              strokeWidth={LINK_HIT_WIDTH}
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onClick={(e) => onLinkClick(link.id, e)}
            />
            {/*
             * 2. GLOW — rendered between hitbox and visible path (selected only).
             *    pointer-events: none — purely visual, doesn't intercept clicks.
             */}
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke={selectedColor}
                strokeWidth={strokeWidth + 5}
                strokeLinecap="round"
                opacity={0.18}
                style={{ pointerEvents: "none" }}
              />
            )}
            {/*
             * 3. VISIBLE path — the actual rendered line.
             *    pointer-events: none — hitbox above handles all clicks.
             *    strokeWidth grows by LINK_STROKE_SELECTED_EXTRA when selected.
             */}
            <path
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
              className={isSelected ? "flow-canvas__link--selected" : "flow-canvas__link"}
            />
            {/*
             * 4. ARROWHEAD — solid triangle at destination border.
             *    pointer-events: none — must not block selection of the line.
             */}
            {arrowPts && (
              <polygon
                points={arrowPts}
                fill={strokeColor}
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
        // Arrowhead at the drag cursor tip (no destination node yet)
        // Direction = from start toward current mouse position
        const dx = linkDrag.currentX - linkDrag.startX;
        const dy = linkDrag.currentY - linkDrag.startY;
        const len = Math.sqrt(dx * dx + dy * dy);
        const dragArrowPts = len > ARROW_HEIGHT
          ? arrowheadPoints(
              linkDrag.currentX, linkDrag.currentY,
              linkDrag.startX, linkDrag.startY,
              ARROW_SIZE,
              ARROW_HEIGHT,
            )
          : "";

        return (
          <g>
            <path
              d={d}
              fill="none"
              stroke={LINK_COLOR}
              strokeWidth={LINK_STROKE_WIDTH}
              strokeDasharray="8 4"
              strokeLinecap="round"
              opacity={0.7}
              style={{ pointerEvents: "none" }}
            />
            {dragArrowPts && (
              <polygon
                points={dragArrowPts}
                fill={LINK_COLOR}
                opacity={0.7}
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>
        );
      })()}
    </svg>
  );
}

// ── FlowCanvas ─────────────────────────────────────────────────────────────

export function FlowCanvas() {
  const agents          = useAgentFlowStore((s) => s.agents);
  const userNode        = useAgentFlowStore((s) => s.userNode);
  const isPlacing       = useAgentFlowStore((s) => s.isPlacing);
  const commitPlacement = useAgentFlowStore((s) => s.commitPlacement);
  const cancelPlacement = useAgentFlowStore((s) => s.cancelPlacement);
  const moveAgent       = useAgentFlowStore((s) => s.moveAgent);
  const moveUserNode    = useAgentFlowStore((s) => s.moveUserNode);
  const links           = useAgentFlowStore((s) => s.links);
  const selectedLinkId  = useAgentFlowStore((s) => s.selectedLinkId);
  const selectedNodeId  = useAgentFlowStore((s) => s.selectedNodeId);
  const addLink         = useAgentFlowStore((s) => s.addLink);
  const deleteLink      = useAgentFlowStore((s) => s.deleteLink);
  const selectLink      = useAgentFlowStore((s) => s.selectLink);
  const setSelectionContext = useAgentFlowStore((s) => s.setSelectionContext);
  const selectNode      = useAgentFlowStore((s) => s.selectNode);

  // Project store (for persisting viewport state)
  const project      = useProjectStore((s) => s.project);
  const saveProject  = useProjectStore((s) => s.saveProject);

  // ── Editor config (from project properties.editor) ───────────────────────
  const editorConfig = useEditorConfig();

  const canvasRef    = useRef<HTMLDivElement>(null);
  const viewportRef  = useRef<HTMLDivElement>(null);

  // ── Tool mode ─────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<CanvasTool>("pointer");

  // ── Viewport: pan + zoom ──────────────────────────────────────────────────
  // Initial values are loaded from project.properties.canvasView if available.

  const getInitialViewport = useCallback((): ViewportState => {
    const cv = (project?.properties as Record<string, unknown> | undefined)?.canvasView as ViewportState | undefined;
    return {
      panX: cv?.panX ?? 0,
      panY: cv?.panY ?? 0,
      zoom: clampZoom(cv?.zoom ?? ZOOM_DEFAULT),
    };
  }, []); // only on mount

  const [viewport, setViewport] = useState<ViewportState>(getInitialViewport);

  // Ref so pan/zoom handlers always have the latest viewport without stale closures
  const viewportRef2 = useRef<ViewportState>(viewport);
  useLayoutEffect(() => { viewportRef2.current = viewport; }, [viewport]);

  // Debounce save to avoid hammering the IPC bridge on every frame during zoom/pan
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleViewportSave = useCallback((vp: ViewportState) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const props = {
        ...(project?.properties as Record<string, unknown> ?? {}),
        canvasView: { panX: vp.panX, panY: vp.panY, zoom: vp.zoom },
      };
      saveProject({ properties: props });
    }, 800); // 800ms debounce
  }, [project, saveProject]);

  const updateViewport = useCallback((next: Partial<ViewportState>) => {
    setViewport((prev) => {
      const merged: ViewportState = {
        panX: next.panX ?? prev.panX,
        panY: next.panY ?? prev.panY,
        zoom: next.zoom !== undefined ? clampZoom(next.zoom) : prev.zoom,
      };
      viewportRef2.current = merged;
      scheduleViewportSave(merged);
      return merged;
    });
  }, [scheduleViewportSave]);

  // ── Pan (hand mode) state ─────────────────────────────────────────────────

  const isPanningRef = useRef(false);
  const panStartRef  = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // ── Gesture pan state (touchpad two-finger + middle mouse button) ─────────
  // Separate from hand-mode pan — does not require activeTool === "hand".
  // Does not disable node interactions.
  const [isGesturePanning, setIsGesturePanning] = useState(false);
  const midMousePanStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const isMidMousePanningRef = useRef(false);

  // ── Placement mode state ─────────────────────────────────────────────────
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Node drag & drop state (MOVE — from handle only) ─────────────────────
  const dragRef = useRef<DragState | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  // ── Link drag state (CONNECT — from body) ────────────────────────────────
  const linkDragRef = useRef<LinkDragState | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);

  // ── Canvas rect helper ───────────────────────────────────────────────────
  function getCanvasRect(): DOMRect | null {
    return canvasRef.current?.getBoundingClientRect() ?? null;
  }

  /**
   * Convert a client-space mouse position to canvas-local (viewport-space) coordinates.
   * Accounts for the current pan and zoom transforms.
   */
  function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = getCanvasRect();
    if (!rect) return { x: clientX, y: clientY };
    const vp = viewportRef2.current;
    return {
      x: (clientX - rect.left - vp.panX) / vp.zoom,
      y: (clientY - rect.top  - vp.panY) / vp.zoom,
    };
  }

  // ── Placement mode mouse tracking ─────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacing) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    setMousePos(pos);
  }, [isPlacing]);

  // Click on canvas: commit placement or deselect link
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // If we just finished panning, swallow the click
    if (isPanningRef.current) return;

    if (isPlacing) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      const x = pos.x - NODE_W_DEFAULT / 2;
      const y = pos.y - NODE_H / 2;
      commitPlacement(x, y);
      return;
    }
    // Click on blank canvas → deselect any selected link and clear selection context
    selectLink(null);
    selectNode(null);
  }, [isPlacing, commitPlacement, selectLink, selectNode]);

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

  // ── PAN drag (hand mode) ──────────────────────────────────────────────────
  //
  // We attach document-level listeners synchronously on mousedown so that:
  //   1. The drag works even if the mouse exits the canvas element.
  //   2. No useEffect timing issues (listeners are live immediately).
  //
  // When panning starts we set a flag so that the click handler ignores the
  // next click event that fires after mouseup.

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "hand") return;
    if (e.button !== 0) return;

    // Never start panning when the click originates from a floating panel.
    // We check both the exact target and any of its ancestors so that clicks
    // on child elements inside the panels (e.g. the slider thumb, SVG icons,
    // the center-view button) are also excluded.
    const target = e.target as Element;
    if (
      target.closest(".canvas-tool-panel") ||
      target.closest(".canvas-zoom-panel") ||
      target.closest(".canvas-save-overlay")
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const vp = viewportRef2.current;
    panStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panX: vp.panX,
      panY: vp.panY,
    };
    isPanningRef.current = false; // not yet — needs to move first
    setIsPanning(false);

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - panStartRef.current.mouseX;
      const dy = ev.clientY - panStartRef.current.mouseY;

      // Only enter "panning" state after at least 3px movement (prevents micro-jitter)
      if (!isPanningRef.current && Math.abs(dx) + Math.abs(dy) > 3) {
        isPanningRef.current = true;
        setIsPanning(true);
      }

      if (!isPanningRef.current) return;

      const newPanX = panStartRef.current.panX + dx;
      const newPanY = panStartRef.current.panY + dy;
      // Mutate ref directly for instant visual feedback (no React re-render per frame)
      viewportRef2.current = { ...viewportRef2.current, panX: newPanX, panY: newPanY };

      if (viewportRef.current) {
        viewportRef.current.style.transform =
          `translate(${newPanX}px, ${newPanY}px) scale(${viewportRef2.current.zoom})`;
      }
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const finalVp = viewportRef2.current;
      setIsPanning(false);

      // Sync React state and persist
      if (isPanningRef.current) {
        setViewport({ ...finalVp });
        scheduleViewportSave(finalVp);
      }

      // Keep flag true for one more tick so click handler ignores next click
      // (reset after 50ms)
      setTimeout(() => { isPanningRef.current = false; }, 50);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [activeTool, scheduleViewportSave]);

  // ── Touchpad two-finger pan (wheel event without ctrlKey) ─────────────────
  //
  // Strategy: browsers fire `wheel` for both:
  //   - Pinch-to-zoom:        deltaX/deltaY small, ctrlKey = true  → we use this for zoom
  //   - Two-finger scroll:    deltaX/deltaY large, ctrlKey = false → we use this for pan
  //
  // Guard: only active when editorConfig.touchpad === true.
  // The speed factor editorConfig.touchpad_pan scales the deltas.
  // We apply the deltas directly (no drag state needed — wheel events are discrete).

  const handleWheelPan = useCallback((e: WheelEvent) => {
    // ctrlKey = true → pinch-to-zoom — let the existing zoom handler take it
    if (e.ctrlKey) return;

    // Touchpad pan disabled by project config
    if (!editorConfig.touchpad) return;

    // Prevent the browser from scrolling the page
    e.preventDefault();

    const speed = editorConfig.touchpad_pan;
    const vp = viewportRef2.current;

    const newPanX = vp.panX - e.deltaX * speed;
    const newPanY = vp.panY - e.deltaY * speed;

    // Apply immediately via ref for zero-lag visual feedback
    viewportRef2.current = { ...vp, panX: newPanX, panY: newPanY };
    if (viewportRef.current) {
      viewportRef.current.style.transform =
        `translate(${newPanX}px, ${newPanY}px) scale(${vp.zoom})`;
    }

    // Show grabbing cursor briefly while gesturing
    setIsGesturePanning(true);

    // Debounce: sync React state + schedule save after gesture settles.
    // Re-use scheduleViewportSave (shared debounce timer) so this doesn't race
    // with zoom or hand-mode saves.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const final = viewportRef2.current;
      setViewport({ ...final });
      setIsGesturePanning(false);
      scheduleViewportSave(final);
    }, 300);
  }, [editorConfig.touchpad, editorConfig.touchpad_pan, scheduleViewportSave]);

  // Attach wheel listener with { passive: false } so we can call preventDefault.
  // Must be a native addEventListener (not React synthetic) to set passive: false.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheelPan, { passive: false });
    return () => { canvas.removeEventListener("wheel", handleWheelPan); };
  }, [handleWheelPan]);

  // ── Middle mouse button pan ───────────────────────────────────────────────
  //
  // Active regardless of activeTool (no need to switch to hand mode).
  // Speed scaled by editorConfig.mouse_pan.
  // Shows "grabbing" cursor while dragging (via flow-canvas--gesture-panning).
  // Does NOT disable node pointer events (node interactions still work after release).

  const handleMiddleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return; // middle button only

    // Never initiate from floating panels
    const target = e.target as Element;
    if (
      target.closest(".canvas-tool-panel") ||
      target.closest(".canvas-zoom-panel") ||
      target.closest(".canvas-save-overlay")
    ) {
      return;
    }

    e.preventDefault();

    const vp = viewportRef2.current;
    midMousePanStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panX: vp.panX,
      panY: vp.panY,
    };
    isMidMousePanningRef.current = false;

    const speed = editorConfig.mouse_pan;

    function onMouseMove(ev: MouseEvent) {
      const dx = (ev.clientX - midMousePanStartRef.current.mouseX) * speed;
      const dy = (ev.clientY - midMousePanStartRef.current.mouseY) * speed;

      if (!isMidMousePanningRef.current && Math.abs(dx) + Math.abs(dy) > 3) {
        isMidMousePanningRef.current = true;
        setIsGesturePanning(true);
      }

      if (!isMidMousePanningRef.current) return;

      const newPanX = midMousePanStartRef.current.panX + dx;
      const newPanY = midMousePanStartRef.current.panY + dy;

      // Apply via ref for zero-lag visual feedback
      viewportRef2.current = { ...viewportRef2.current, panX: newPanX, panY: newPanY };
      if (viewportRef.current) {
        viewportRef.current.style.transform =
          `translate(${newPanX}px, ${newPanY}px) scale(${viewportRef2.current.zoom})`;
      }
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const finalVp = viewportRef2.current;
      setIsGesturePanning(false);

      if (isMidMousePanningRef.current) {
        setViewport({ ...finalVp });
        scheduleViewportSave(finalVp);
      }

      isMidMousePanningRef.current = false;
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [editorConfig.mouse_pan, scheduleViewportSave]);

  // ── Zoom (slider) ─────────────────────────────────────────────────────────

  const handleZoomChange = useCallback((newZoom: number) => {
    // Zoom centered on canvas midpoint
    const rect = getCanvasRect();
    if (!rect) {
      updateViewport({ zoom: newZoom });
      return;
    }
    const vp = viewportRef2.current;
    const cx = rect.width  / 2;
    const cy = rect.height / 2;
    // Keep the canvas-space point at the center fixed
    const worldX = (cx - vp.panX) / vp.zoom;
    const worldY = (cy - vp.panY) / vp.zoom;
    const newPanX = cx - worldX * newZoom;
    const newPanY = cy - worldY * newZoom;
    updateViewport({ zoom: newZoom, panX: newPanX, panY: newPanY });
  }, [updateViewport]);

  // ── Center view ────────────────────────────────────────────────────────────

  const handleCenterView = useCallback(() => {
    const rect = getCanvasRect();
    if (!rect) return;

    if (agents.length === 0) {
      // No nodes — just reset to origin
      updateViewport({ panX: 0, panY: 0, zoom: 1 });
      return;
    }

    // Compute bounding box of all agents
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of agents) {
      const w = getNodeW(a.isOrchestrator);
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x + w);
      maxY = Math.max(maxY, a.y + NODE_H);
    }

    const PADDING = 60;
    const contentW = maxX - minX + PADDING * 2;
    const contentH = maxY - minY + PADDING * 2;
    const scaleX = rect.width  / contentW;
    const scaleY = rect.height / contentH;
    const newZoom = clampZoom(Math.min(scaleX, scaleY));

    const newPanX = (rect.width  - (maxX + minX) * newZoom) / 2;
    const newPanY = (rect.height - (maxY + minY) * newZoom) / 2;

    updateViewport({ panX: newPanX, panY: newPanY, zoom: newZoom });
  }, [agents, updateViewport]);

  // ── Reset zoom to 100% ────────────────────────────────────────────────────

  const handleResetZoom = useCallback(() => {
    handleZoomChange(1.00);
  }, [handleZoomChange]);

  // ── Apply viewport transform to DOM ───────────────────────────────────────
  // We drive the transform via React state (not just refs) so that zooming
  // and centering are smooth via the React reconciler.

  const viewportTransform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;

  // ── Node MOVE drag (handle button only) ───────────────────────────────────

  const moveAgentRef   = useRef(moveAgent);
  const moveUserNodeRef = useRef(moveUserNode);
  useLayoutEffect(() => { moveAgentRef.current = moveAgent; }, [moveAgent]);
  useLayoutEffect(() => { moveUserNodeRef.current = moveUserNode; }, [moveUserNode]);

  const canvasRefForDrag = canvasRef;

  const startDrag = useCallback((agentId: string, e: React.MouseEvent) => {
    if (isPlacing) return;
    if (activeTool === "hand") return; // no node drag in pan mode
    if (draggingIdRef.current !== null) return;

    e.stopPropagation();

    const rect = canvasRefForDrag.current?.getBoundingClientRect() ?? null;
    if (!rect) return;

    // Resolve the starting position — either a regular agent or the user node
    const storeState = useAgentFlowStore.getState();
    let nodeX: number;
    let nodeY: number;
    const isUserNode = agentId === USER_NODE_ID;

    if (isUserNode) {
      if (!storeState.userNode) return;
      nodeX = storeState.userNode.x;
      nodeY = storeState.userNode.y;
    } else {
      const agent = storeState.agents.find((a) => a.id === agentId);
      if (!agent) return;
      nodeX = agent.x;
      nodeY = agent.y;
    }

    // Moving a node → select this node (sets selectionContext to "node")
    selectNode(agentId);

    const vp = viewportRef2.current;
    const mouseCanvasX = (e.clientX - rect.left - vp.panX) / vp.zoom;
    const mouseCanvasY = (e.clientY - rect.top  - vp.panY) / vp.zoom;

    const initialState: DragState = {
      agentId,
      offsetX: mouseCanvasX - nodeX,
      offsetY: mouseCanvasY - nodeY,
      currentX: nodeX,
      currentY: nodeY,
    };

    dragRef.current = initialState;
    draggingIdRef.current = agentId;

    setDraggingId(agentId);
    setDragPos({ x: nodeX, y: nodeY });

    function onMouseMove(ev: MouseEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      const r = canvasRefForDrag.current?.getBoundingClientRect() ?? null;
      if (!r) return;
      const vp2 = viewportRef2.current;

      const newX = (ev.clientX - r.left - vp2.panX) / vp2.zoom - ds.offsetX;
      const newY = (ev.clientY - r.top  - vp2.panY) / vp2.zoom - ds.offsetY;

      ds.currentX = newX;
      ds.currentY = newY;

      setDragPos({ x: newX, y: newY });
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const ds = dragRef.current;
      if (ds) {
        if (ds.agentId === USER_NODE_ID) {
          moveUserNodeRef.current(ds.currentX, ds.currentY);
        } else {
          moveAgentRef.current(ds.agentId, ds.currentX, ds.currentY);
        }
      }

      dragRef.current = null;
      draggingIdRef.current = null;

      setDraggingId(null);
      setDragPos({ x: 0, y: 0 });
      forceUpdate();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [isPlacing, activeTool, canvasRefForDrag, selectNode]);

  // ── Link CONNECT drag (connection grip only) ──────────────────────────────

  const startLinkDrag = useCallback((agentId: string, e: React.MouseEvent) => {
    if (isPlacing) return;
    if (activeTool === "hand") return; // no link drag in pan mode
    e.preventDefault();
    e.stopPropagation();

    const rect = getCanvasRect();
    if (!rect) return;

    // Resolve start position — support both regular agents and the user node
    let startX: number;
    let startY: number;

    if (agentId === USER_NODE_ID) {
      const un = useAgentFlowStore.getState().userNode;
      if (!un) return;
      // Center of the circular user node
      startX = un.x + USER_NODE_DIAMETER / 2;
      startY = un.y + USER_NODE_DIAMETER / 2;
    } else {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      const nodeW = getNodeW(agent.isOrchestrator);
      const center = getNodeCenter(agent.x, agent.y, nodeW);
      startX = center.x;
      startY = center.y;
    }

    // Grip interaction → also selects this node
    selectNode(agentId);

    const cur = clientToCanvas(e.clientX, e.clientY);

    const state: LinkDragState = {
      fromAgentId: agentId,
      startX,
      startY,
      currentX: cur.x,
      currentY: cur.y,
      hoverTargetId: null,
    };
    linkDragRef.current = state;
    setLinkDrag({ ...state });
  }, [isPlacing, agents, activeTool, selectNode]);

  // ── Node body click — select only, never starts a link drag ───────────────

  const handleBodyClick = useCallback((agentId: string) => {
    if (isPlacing) return;
    if (activeTool === "hand") return;
    selectNode(agentId);
  }, [isPlacing, activeTool, selectNode]);

  // Node hover callbacks (used during link-drag to highlight drop targets)
  const handleNodeEnterDuringLink = useCallback((agentId: string) => {
    const ld = linkDragRef.current;
    if (!ld) return;
    if (ld.fromAgentId === agentId) return;
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
      const pos = clientToCanvas(e.clientX, e.clientY);
      ld.currentX = pos.x;
      ld.currentY = pos.y;
      setLinkDrag({ ...ld });
    }

    function onMouseUp() {
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
    const next = linkId === selectedLinkId ? null : linkId;
    selectLink(next);
    setSelectionContext(next !== null ? "link" : "none");
  }, [selectLink, selectedLinkId, setSelectionContext]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isDraggingLink = linkDrag !== null;

  /**
   * Live agent positions for the SVG links layer.
   * While a node is being dragged, its position in the store is NOT yet updated.
   * We substitute the live dragPos so that connection lines follow the dragged node.
   * Also includes the UserNode (as a virtual "agent" entry) so links to/from it render.
   */
  const liveAgentPositions: Array<{ id: string; x: number; y: number; isOrchestrator: boolean }> = [
    ...agents.map((a) => ({
      id: a.id,
      x: draggingId === a.id ? dragPos.x : a.x,
      y: draggingId === a.id ? dragPos.y : a.y,
      isOrchestrator: a.isOrchestrator,
    })),
    // Include user node in link rendering — use its center for link endpoints.
    // We use NODE_W set to USER_NODE_DIAMETER so the center calculation works.
    ...(userNode ? [{
      id: USER_NODE_ID,
      x: draggingId === USER_NODE_ID ? dragPos.x : userNode.x,
      y: draggingId === USER_NODE_ID ? dragPos.y : userNode.y,
      isOrchestrator: false,
    }] : []),
  ];

  return (
    <div
      ref={canvasRef}
      className={[
        "flow-canvas",
        isPlacing         ? "flow-canvas--placing"          : "",
        draggingId        ? "flow-canvas--dragging-active"  : "",
        isDraggingLink    ? "flow-canvas--linking"          : "",
        activeTool === "hand" ? "flow-canvas--pan-mode"     : "",
        isPanning         ? "flow-canvas--panning"          : "",
        isGesturePanning  ? "flow-canvas--gesture-panning"  : "",
      ].filter(Boolean).join(" ")}
      onMouseMove={handleMouseMove}
      onClick={handleCanvasClick}
      onMouseDown={(e) => {
        handleCanvasMouseDown(e);
        handleMiddleMouseDown(e);
      }}
      aria-label="Flow canvas"
      role="region"
    >
      {/* ── Viewport: all nodes + SVG links live here, transformed for pan/zoom ── */}
      <div
        ref={viewportRef}
        className={`flow-canvas__viewport${(isPanning || isGesturePanning) ? " flow-canvas__viewport--panning" : ""}`}
        style={{ transform: viewportTransform }}
      >
        {/* SVG links layer — rendered first in DOM so nodes appear above */}
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
            isSelected={selectedNodeId === agent.id}
            isLinkTarget={
              isDraggingLink &&
              linkDrag?.hoverTargetId === agent.id &&
              linkDrag?.fromAgentId !== agent.id
            }
            isLinkDragActive={isDraggingLink}
            zoom={viewport.zoom}
            onHandleMouseDown={startDrag}
            onGripMouseDown={startLinkDrag}
            onBodyClick={handleBodyClick}
            onNodeMouseEnterDuringLink={handleNodeEnterDuringLink}
            onNodeMouseLeaveDuringLink={handleNodeLeaveDuringLink}
            onNodeMouseUpDuringLink={handleNodeMouseUpDuringLink}
          />
        ))}

        {/* User node — circular, immutable, participates in connections */}
        {userNode && (
          <UserCanvasNode
            x={userNode.x}
            y={userNode.y}
            isDragging={draggingId === USER_NODE_ID}
            dragX={draggingId === USER_NODE_ID ? dragPos.x : undefined}
            dragY={draggingId === USER_NODE_ID ? dragPos.y : undefined}
            isSelected={selectedNodeId === USER_NODE_ID}
            isLinkTarget={
              isDraggingLink &&
              linkDrag?.hoverTargetId === USER_NODE_ID &&
              linkDrag?.fromAgentId !== USER_NODE_ID
            }
            isLinkDragActive={isDraggingLink}
            onHandleMouseDown={startDrag}
            onGripMouseDown={startLinkDrag}
            onBodyClick={handleBodyClick}
            onNodeMouseEnterDuringLink={handleNodeEnterDuringLink}
            onNodeMouseLeaveDuringLink={handleNodeLeaveDuringLink}
            onNodeMouseUpDuringLink={handleNodeMouseUpDuringLink}
          />
        )}

        {/* Ghost node follows the mouse in placement mode */}
        {isPlacing && (
          <GhostNode x={mousePos.x} y={mousePos.y} />
        )}
      </div>
      {/* /viewport */}

      {/* ── Floating tool panel (top-left, outside viewport transform) ── */}
      <CanvasToolPanel activeTool={activeTool} onSelectTool={setActiveTool} />

      {/* ── Floating zoom panel (bottom-right, outside viewport transform) ── */}
      <CanvasZoomPanel
        zoom={viewport.zoom}
        onZoomChange={handleZoomChange}
        onCenterView={handleCenterView}
        onResetZoom={handleResetZoom}
      />

      {/* ── Canvas Save overlay (top-right, z-index 300) ─────────────────── */}
      <AgentCanvasSaveButton />

      {/* Empty state hint (when no nodes and not placing) */}
      {agents.length === 0 && !userNode && !isPlacing && (
        <div className="flow-canvas__empty">
          <span aria-hidden="true">🤖</span>
          <p>Click <strong>+ New agent</strong> in the sidebar to add your first agent.</p>
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
