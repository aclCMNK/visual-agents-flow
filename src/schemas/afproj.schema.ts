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

// ── Slug validation ────────────────────────────────────────────────────────

/**
 * Shared slug schema for agent names in .afproj agent references.
 * Only lowercase alphanumeric characters and hyphens are allowed.
 * Must not start or end with a hyphen, and must be 2–64 characters.
 */
const agentSlugSchema = z
  .string()
  .min(2, "name must be at least 2 characters")
  .max(64, "name must be at most 64 characters")
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "name must be a slug: lowercase letters, digits, and hyphens only, no leading/trailing hyphens"
  );

// ── User ID ────────────────────────────────────────────────────────────────

/**
 * The canonical ID for the special "User" node.
 * This value is used in connections (fromAgentId / toAgentId) to represent
 * the human end-user in the flow. Must be a valid slug.
 *
 * @deprecated The constant name USER_ID_DEFAULT is kept for backward
 * compatibility; its value changed from "user" to "user-node".
 */
export const USER_ID_DEFAULT = "user-node" as const;

/**
 * Schema for the `user` object stored at the root of .afproj.
 * Replaces the legacy flat `user_id` string field.
 *
 * Shape:
 *   {
 *     "user_id": "user-node",   // always the canonical constant
 *     "position": { "x": 120, "y": 300 }  // optional — absent on first save
 *   }
 */
export const UserObjectSchema = z.object({
  /** Always "user-node" — the canonical ID for the User node */
  user_id: z.literal("user-node"),
  /** Canvas position where the User node was last placed */
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

/**
 * Schema for a valid agent endpoint in a connection.
 * Accepts either a UUID v4 (for regular agents) or exactly the
 * user_id value from the project root (for the User node).
 *
 * Note: We allow any slug-like string here; cross-validation enforces
 * that the value matches either a known agent UUID or the project's user_id.
 */
const connectionEndpointSchema = z.union([
  z.guid(),
  z.string().regex(
    /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/,
    "endpoint must be a UUID or a valid slug (user_id)"
  ),
]);

// ── Connection / Edge ──────────────────────────────────────────────────────

/**
 * A directed connection between two agents (or an agent and a subagent).
 * The fromAgentId / toAgentId may reference a regular agent UUID or the
 * special user_id (e.g. "user") to represent the end-user in the flow.
 * Used to model flow topology in the canvas.
 */
export const ConnectionSchema = z.object({
  id: z.guid(),
  fromAgentId: connectionEndpointSchema,
  toAgentId: connectionEndpointSchema,
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
  name: agentSlugSchema,
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
  /**
   * The special "User" node descriptor.
   * Contains the canonical user_id ("user-node") and the last canvas position.
   *
   * Rules:
   *   - user.user_id is always "user-node" (the canonical constant).
   *   - user.position is optional — absent if the user node was never placed.
   *   - When absent, no User node is shown on the canvas on load.
   *
   * Migration: legacy files with a flat `user_id` string at root are migrated
   * to this structure by the IPC handler before writing.
   */
  user: UserObjectSchema.optional(),
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
export type UserObject = z.infer<typeof UserObjectSchema>;
