/**
 * src/loader/types.ts
 *
 * Core in-memory models and type definitions for the AgentFlow Project Loader.
 *
 * These types represent the hydrated, validated state of a project after
 * all files have been read, validated, and cross-checked.
 */

import type { Afproj, AgentRef, Connection } from "../schemas/afproj.schema.ts";
import type { Adata, AspectRef, SkillRef, SubagentDecl } from "../schemas/adata.schema.ts";

// ── Severity ───────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning" | "info";

// ── Validation issue ───────────────────────────────────────────────────────

/**
 * A single validation finding (error, warning, or info).
 * Produced by schema validators and cross-validators.
 */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /**
   * Source of the issue: which file and (optionally) which field path.
   * Example: "my-project.afproj" or "metadata/abc-123.adata#agentId"
   */
  source: string;
  /** Suggested repair action, if applicable */
  repairHint?: string;
}

// ── Repair action ──────────────────────────────────────────────────────────

export type RepairActionKind =
  | "set-field"        // Set a missing/invalid field to a generated value
  | "remove-orphan"    // Remove a reference that points to a non-existent resource
  | "create-file"      // Create a missing file with minimal valid content
  | "fix-path"         // Correct a malformed path
  | "set-entrypoint"   // Mark the first agent as entrypoint when none is set
  | "dedup-id";        // Regenerate a duplicate ID

/**
 * A concrete repair action proposed (dry-run) or applied (repair mode).
 */
export interface RepairAction {
  kind: RepairActionKind;
  description: string;
  /** The file that would be / was modified */
  targetFile: string;
  /** JSON path within the file, if applicable */
  fieldPath?: string;
  /** The value that was set (for set-field, fix-path, dedup-id) */
  newValue?: unknown;
  /** Was this action actually applied (false in dry-run) */
  applied: boolean;
}

// ── In-memory models ───────────────────────────────────────────────────────

/**
 * Hydrated subagent — combines SubagentDecl with resolved content.
 */
export interface SubagentModel {
  id: string;
  name: string;
  description: string;
  profileContent?: string;  // Contents of profilePath file, if present
  aspects: AspectRef[];
  skills: SkillRef[];
  metadata: Record<string, string>;
}

/**
 * Hydrated agent — combines AgentRef + Adata + resolved file contents.
 */
export interface AgentModel {
  /** From AgentRef (afproj) */
  ref: AgentRef;
  /** Parsed .adata content */
  adata: Adata;
  /** Contents of profile.md */
  profileContent: string;
  /**
   * Map from aspect filePath → file content.
   * Only populated when loadBehaviorFiles = true.
   */
  aspectContents: Map<string, string>;
  /**
   * Map from skill filePath → file content.
   * Only populated when loadSkillFiles = true.
   */
  skillContents: Map<string, string>;
  /** Hydrated subagents */
  subagents: SubagentModel[];
  /** True if this agent is the entrypoint of the flow */
  isEntrypoint: boolean;
}

/**
 * Complete in-memory representation of a loaded AgentFlow project.
 */
export interface ProjectModel {
  /** Absolute path to the project directory */
  projectDir: string;
  /** Absolute path to the .afproj file */
  afprojPath: string;
  /** Parsed .afproj content */
  afproj: Afproj;
  /** All hydrated agents, indexed by agent ID */
  agents: Map<string, AgentModel>;
  /** All connections (edges) from the .afproj */
  connections: Connection[];
  /** The designated entrypoint agent, if any */
  entrypoint?: AgentModel;
  /** Timestamp when the project was loaded */
  loadedAt: string;
}

// ── Loader options ─────────────────────────────────────────────────────────

export interface LoaderOptions {
  /**
   * dry-run: validate and report issues without modifying any files.
   * repair: validate, report, AND apply auto-repair actions.
   * load: validate and return the ProjectModel (default).
   */
  mode?: "load" | "dry-run" | "repair";

  /**
   * Whether to load the content of behavior markdown files into memory.
   * Default: true. Set to false for fast validation-only passes.
   */
  loadBehaviorFiles?: boolean;

  /**
   * Whether to load the content of skill markdown files into memory.
   * Default: true.
   */
  loadSkillFiles?: boolean;

  /**
   * If true, warnings do NOT prevent a successful load.
   * If false (default), warnings are included in the report but load still succeeds.
   * Errors always prevent a successful load.
   */
  strict?: boolean;
}

// ── Load result ────────────────────────────────────────────────────────────

/**
 * The structured result returned by ProjectLoader.load().
 */
export interface LoadResult {
  /**
   * Whether the project was loaded successfully.
   * True even if there are warnings (unless strict: true and warnings found).
   * False if any errors were found, or if mode=dry-run.
   */
  success: boolean;

  /**
   * The hydrated project model.
   * Present only when success=true and mode="load" or mode="repair".
   */
  project?: ProjectModel;

  /** All validation issues found during loading */
  issues: ValidationIssue[];

  /**
   * Repair actions proposed (dry-run) or applied (repair mode).
   * Empty when mode="load".
   */
  repairActions: RepairAction[];

  /** Counts summary */
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    repairsApplied: number;
    repairsProposed: number;
    agentsLoaded: number;
    filesRead: number;
  };

  /** ISO 8601 timestamp of this load operation */
  timestamp: string;

  /** Time taken to complete the load, in milliseconds */
  durationMs: number;
}

// ── Internal file read record ──────────────────────────────────────────────

/** Internal tracking of a file read during loading */
export interface FileReadRecord {
  path: string;
  content: string;
  sizeBytes: number;
}
