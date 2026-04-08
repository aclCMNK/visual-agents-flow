/**
 * adata.schema.ts
 *
 * Zod schema for `.adata` agent metadata files.
 * Each agent has its own `.adata` file at `metadata/<agentId>.adata`.
 *
 * This file stores the agent's runtime metadata, aspect references,
 * skill references, and subagent declarations.
 *
 * Uses Zod v4 top-level API (z.guid(), z.iso.datetime(), etc.)
 */

import { z } from "zod";

// ── Behavior / Aspect reference ────────────────────────────────────────────

/**
 * A reference to a behavior aspect markdown file.
 * The actual content lives in `behaviors/<agentId>/<aspectId>.md`.
 */
export const AspectRefSchema = z.object({
  id: z.string().min(1).max(100),
  /** Display name of the aspect */
  name: z.string().min(1).max(200),
  /** Relative path from project root to the aspect markdown file */
  filePath: z
    .string()
    .regex(
      /^behaviors\/[^/]+\/[^/]+\.md$/,
      "aspectRef.filePath must match: behaviors/<agentId>/<aspectId>.md"
    ),
  /**
   * Order index for rendering aspects in the UI.
   * Lower value = higher priority.
   */
  order: z.number().int().min(0).default(0),
  /** Whether this aspect is active / included in the compiled profile */
  enabled: z.boolean().default(true),
  metadata: z.record(z.string(), z.string()).default({}),
});

// ── Skill reference ────────────────────────────────────────────────────────

/**
 * A reference to a skill markdown file.
 * Skills live in `skills/<skillId>.md`.
 */
export const SkillRefSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  /** Relative path from project root to the skill markdown file */
  filePath: z
    .string()
    .regex(
      /^skills\/[^/]+\.md$/,
      "skillRef.filePath must match: skills/<skillId>.md"
    ),
  enabled: z.boolean().default(true),
});

// ── Subagent declaration ───────────────────────────────────────────────────

/**
 * Subagents are declared inside .adata.
 * Unlike top-level agents, subagents don't have their own .adata files;
 * all their metadata lives here.
 */
export const SubagentDeclSchema = z.object({
  id: z.guid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  /** Relative path to the subagent's profile markdown */
  profilePath: z
    .string()
    .regex(
      /^behaviors\/[^/]+\/[^/]+\.md$/,
      "subagent.profilePath must match: behaviors/<agentId>/<filename>.md"
    )
    .optional(),
  aspects: z.array(AspectRefSchema).default([]),
  skills: z.array(SkillRefSchema).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
});

// ── .adata root schema ─────────────────────────────────────────────────────

export const AdataSchema = z.object({
  /** Schema version for migration support */
  version: z.number().int().positive().default(1),
  /**
   * The UUID of the agent this .adata file belongs to.
   * Must match the corresponding AgentRef.id in .afproj.
   */
  agentId: z.guid(),
  /** Display name — must match the AgentRef.name in .afproj */
  agentName: z.string().min(1).max(100),
  description: z.string().max(1000).default(""),
  /**
   * Ordered list of behavior aspect references.
   * Order determines how aspects are compiled into profile.md.
   */
  aspects: z.array(AspectRefSchema).default([]),
  /** Skill references used by this agent */
  skills: z.array(SkillRefSchema).default([]),
  /** Subagents managed by this agent */
  subagents: z.array(SubagentDeclSchema).default([]),
  /**
   * Relative path to the compiled profile.md.
   * Must match AgentRef.profilePath in .afproj.
   */
  profilePath: z
    .string()
    .regex(
      /^behaviors\/[^/]+\/profile\.md$/,
      "adata.profilePath must match: behaviors/<agentId>/profile.md"
    ),
  /** Free-form agent-level metadata */
  metadata: z.record(z.string(), z.string()).default({}),
  /** ISO 8601 creation timestamp */
  createdAt: z.iso.datetime(),
  /** ISO 8601 last-modified timestamp */
  updatedAt: z.iso.datetime(),
});

// ── Inferred types ─────────────────────────────────────────────────────────

export type AspectRef = z.infer<typeof AspectRefSchema>;
export type SkillRef = z.infer<typeof SkillRefSchema>;
export type SubagentDecl = z.infer<typeof SubagentDeclSchema>;
export type Adata = z.infer<typeof AdataSchema>;
