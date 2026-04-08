/**
 * afproj.schema.ts
 *
 * Zod schema for the `.afproj` project descriptor file.
 * This is the central manifest for an AgentFlow project.
 *
 * Structure: <project-dir>/<project-name>.afproj (JSON)
 *
 * Uses Zod v4 top-level API (z.guid(), z.iso.datetime(), etc.)
 */

import { z } from "zod";

// ── Connection / Edge ──────────────────────────────────────────────────────

/**
 * A directed connection between two agents (or an agent and a subagent).
 * Used to model flow topology in the canvas.
 */
export const ConnectionSchema = z.object({
  id: z.guid(),
  fromAgentId: z.guid(),
  toAgentId: z.guid(),
  /** Optional label shown on the edge in the canvas */
  label: z.string().max(200).optional(),
  /** Connection type discriminant — extend for future edge types */
  type: z.enum(["default", "conditional", "fallback"]).default("default"),
  metadata: z.record(z.string(), z.string()).default({}),
});

// ── Agent entry in .afproj ─────────────────────────────────────────────────

/**
 * Lightweight reference to an agent stored in this project.
 * Full agent data lives in `metadata/<agentId>.adata`.
 * Behavior markdown files live in `behaviors/<agentId>/`.
 */
export const AgentRefSchema = z.object({
  id: z.guid(),
  name: z.string().min(1).max(100),
  /** Relative path to the primary profile markdown file */
  profilePath: z
    .string()
    .regex(
      /^behaviors\/[^/]+\/profile\.md$/,
      "profilePath must match: behaviors/<agentId>/profile.md"
    ),
  /** Relative path to the .adata metadata file */
  adataPath: z
    .string()
    .regex(
      /^metadata\/[^/]+\.adata$/,
      "adataPath must match: metadata/<agentId>.adata"
    ),
  /** Whether this agent is the entry point of the flow */
  isEntrypoint: z.boolean().default(false),
  /** Display position in the canvas (optional — UI concerns) */
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
});

// ── .afproj root schema ────────────────────────────────────────────────────

export const AfprojSchema = z.object({
  /** Schema version for migration support */
  version: z.number().int().positive().default(1),
  /** Unique project identifier (UUID v4) */
  id: z.guid(),
  /** Human-readable project name */
  name: z.string().min(1, "project name is required").max(200),
  /**
   * Short project description, editable from the UI and persisted on save.
   * Falls back gracefully to empty string when absent (backward compat).
   */
  description: z.string().max(2000).default(""),
  /** All agents registered in this project */
  agents: z.array(AgentRefSchema).default([]),
  /** Directed connections between agents */
  connections: z.array(ConnectionSchema).default([]),
  /** Free-form project-level properties / metadata */
  properties: z.record(z.string(), z.unknown()).default({}),
  /** ISO 8601 creation timestamp */
  createdAt: z.iso.datetime(),
  /** ISO 8601 last-modified timestamp */
  updatedAt: z.iso.datetime(),
});

// ── Inferred types ─────────────────────────────────────────────────────────

export type Connection = z.infer<typeof ConnectionSchema>;
export type AgentRef = z.infer<typeof AgentRefSchema>;
export type Afproj = z.infer<typeof AfprojSchema>;
