/**
 * src/loader/cross-validator.ts
 *
 * Cross-validation logic for AgentFlow projects.
 * Runs after individual schema validation passes.
 *
 * Checks:
 * 1. Agent IDs are unique across the project
 * 2. Every AgentRef.profilePath and AgentRef.adataPath files exist on disk
 * 3. Every .adata agentId matches a corresponding AgentRef in .afproj
 * 4. Every aspect filePath and skill filePath referenced in .adata exists on disk
 * 5. All connection fromAgentId/toAgentId refer to known agents
 * 6. Exactly one (or zero) entrypoint agents are declared
 * 7. Subagent IDs are unique within each agent
 * 8. AgentRef.profilePath matches Adata.profilePath for the same agent
 */

import { join } from "node:path";
import type { Afproj } from "../schemas/afproj.schema.ts";
import type { Adata } from "../schemas/adata.schema.ts";
import { fileExists } from "./file-reader.ts";
import type { ValidationIssue } from "./types.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CrossValidationInput {
  afproj: Afproj;
  /** Map from agentId → validated Adata */
  adataByAgentId: Map<string, Adata>;
  /** Absolute path to the project root directory */
  projectDir: string;
}

export interface CrossValidationResult {
  issues: ValidationIssue[];
  /** Set of all valid agent IDs found */
  validAgentIds: Set<string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function err(
  code: string,
  message: string,
  source: string,
  repairHint?: string
): ValidationIssue {
  return { severity: "error", code, message, source, repairHint };
}

function warn(
  code: string,
  message: string,
  source: string,
  repairHint?: string
): ValidationIssue {
  return { severity: "warning", code, message, source, repairHint };
}

function info(
  code: string,
  message: string,
  source: string
): ValidationIssue {
  return { severity: "info", code, message, source };
}

// ── Main cross-validator ───────────────────────────────────────────────────

/**
 * Run all cross-validation checks on a project.
 * Returns all issues found (errors, warnings, infos) and the set of valid agent IDs.
 */
export async function crossValidate(
  input: CrossValidationInput
): Promise<CrossValidationResult> {
  const { afproj, adataByAgentId, projectDir } = input;
  const issues: ValidationIssue[] = [];
  const afprojSource = `${afproj.name}.afproj`;

  // ── 1. Unique agent IDs in .afproj ──────────────────────────────────────
  const agentIdsSeen = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const agentRef of afproj.agents) {
    if (agentIdsSeen.has(agentRef.id)) {
      duplicateIds.add(agentRef.id);
      issues.push(
        err(
          "DUPLICATE_AGENT_ID",
          `Duplicate agent ID "${agentRef.id}" in .afproj agents array.`,
          `${afprojSource}#agents`,
          "Regenerate a unique UUID for each agent."
        )
      );
    }
    agentIdsSeen.add(agentRef.id);
  }

  const validAgentIds = new Set(agentIdsSeen);

  // ── 2. Check referenced files exist (profilePath, adataPath) ──────────
  for (const agentRef of afproj.agents) {
    const profileAbsPath = join(projectDir, agentRef.profilePath);
    const adataAbsPath = join(projectDir, agentRef.adataPath);

    const profileExists = await fileExists(profileAbsPath);
    if (!profileExists) {
      issues.push(
        err(
          "MISSING_PROFILE_FILE",
          `Agent "${agentRef.id}" profilePath "${agentRef.profilePath}" does not exist.`,
          `${afprojSource}#agents[${agentRef.id}].profilePath`,
          `Create the file at: ${agentRef.profilePath}`
        )
      );
    }

    const adataFileExists = await fileExists(adataAbsPath);
    if (!adataFileExists) {
      issues.push(
        err(
          "MISSING_ADATA_FILE",
          `Agent "${agentRef.id}" adataPath "${agentRef.adataPath}" does not exist.`,
          `${afprojSource}#agents[${agentRef.id}].adataPath`,
          `Create the .adata file at: ${agentRef.adataPath}`
        )
      );
    }
  }

  // ── 3. Every .adata must have a matching AgentRef in .afproj ──────────
  for (const [agentId, adata] of adataByAgentId) {
    if (!agentIdsSeen.has(agentId)) {
      issues.push(
        err(
          "ORPHAN_ADATA",
          `Found .adata for agentId "${agentId}" but no matching AgentRef in .afproj.`,
          `metadata/${agentId}.adata`,
          `Add the agent reference to .afproj agents array, or remove the orphan .adata file.`
        )
      );
    }

    // ── 3b. agentId in .adata must match the file reference ─────────────
    if (adata.agentId !== agentId) {
      issues.push(
        err(
          "ADATA_ID_MISMATCH",
          `adata.agentId "${adata.agentId}" does not match the expected agentId "${agentId}" derived from the file path.`,
          `metadata/${agentId}.adata#agentId`,
          `Set adata.agentId to "${agentId}".`
        )
      );
    }
  }

  // ── 4. Validate aspect and skill file paths in each .adata ───────────
  for (const [agentId, adata] of adataByAgentId) {
    const adataSource = `metadata/${agentId}.adata`;

    // Check aspect file paths
    for (const aspect of adata.aspects) {
      const aspectAbsPath = join(projectDir, aspect.filePath);
      const exists = await fileExists(aspectAbsPath);
      if (!exists) {
        issues.push(
          err(
            "MISSING_ASPECT_FILE",
            `Aspect "${aspect.id}" references filePath "${aspect.filePath}" which does not exist.`,
            `${adataSource}#aspects[${aspect.id}].filePath`,
            `Create the aspect file at: ${aspect.filePath}`
          )
        );
      }
    }

    // Check skill file paths
    for (const skill of adata.skills) {
      const skillAbsPath = join(projectDir, skill.filePath);
      const exists = await fileExists(skillAbsPath);
      if (!exists) {
        issues.push(
          err(
            "MISSING_SKILL_FILE",
            `Skill "${skill.id}" references filePath "${skill.filePath}" which does not exist.`,
            `${adataSource}#skills[${skill.id}].filePath`,
            `Create the skill file at: ${skill.filePath}`
          )
        );
      }
    }

    // Check duplicate aspect IDs within this agent
    const aspectIds = new Set<string>();
    for (const aspect of adata.aspects) {
      if (aspectIds.has(aspect.id)) {
        issues.push(
          warn(
            "DUPLICATE_ASPECT_ID",
            `Duplicate aspect ID "${aspect.id}" in agent "${agentId}".`,
            `${adataSource}#aspects`,
            `Assign unique IDs to each aspect.`
          )
        );
      }
      aspectIds.add(aspect.id);
    }

    // Check subagent file paths (if profilePath is declared)
    const subagentIds = new Set<string>();
    for (const sub of adata.subagents) {
      if (subagentIds.has(sub.id)) {
        issues.push(
          warn(
            "DUPLICATE_SUBAGENT_ID",
            `Duplicate subagent ID "${sub.id}" in agent "${agentId}".`,
            `${adataSource}#subagents`,
            `Assign unique UUIDs to each subagent.`
          )
        );
      }
      subagentIds.add(sub.id);

      if (sub.profilePath) {
        const subProfileAbsPath = join(projectDir, sub.profilePath);
        const exists = await fileExists(subProfileAbsPath);
        if (!exists) {
          issues.push(
            warn(
              "MISSING_SUBAGENT_PROFILE",
              `Subagent "${sub.id}" in agent "${agentId}" references profilePath "${sub.profilePath}" which does not exist.`,
              `${adataSource}#subagents[${sub.id}].profilePath`,
              `Create the file at: ${sub.profilePath}`
            )
          );
        }
      }
    }
  }

  // ── 5. Validate connections reference known agents ──────────────────
  // Connection endpoints may be a regular agent UUID OR the project's user_id.
  // The user object is optional — if absent, no user node is in the graph.
  const userId = afproj.user?.user_id;

  for (const conn of afproj.connections) {
    const fromIsAgent = agentIdsSeen.has(conn.fromAgentId);
    const fromIsUser = conn.fromAgentId === userId;
    if (!fromIsAgent && !fromIsUser) {
      issues.push(
        err(
          "INVALID_CONNECTION_FROM",
          `Connection "${conn.id}" fromAgentId "${conn.fromAgentId}" is not a known agent or the project user_id ("${userId}").`,
          `${afprojSource}#connections[${conn.id}].fromAgentId`,
          `Remove the connection, register the agent in .afproj, or ensure the ID matches the project user_id.`
        )
      );
    }
    const toIsAgent = agentIdsSeen.has(conn.toAgentId);
    const toIsUser = conn.toAgentId === userId;
    if (!toIsAgent && !toIsUser) {
      issues.push(
        err(
          "INVALID_CONNECTION_TO",
          `Connection "${conn.id}" toAgentId "${conn.toAgentId}" is not a known agent or the project user_id ("${userId}").`,
          `${afprojSource}#connections[${conn.id}].toAgentId`,
          `Remove the connection, register the agent in .afproj, or ensure the ID matches the project user_id.`
        )
      );
    }
  }

  // Duplicate connection IDs
  const connIdsSeen = new Set<string>();
  for (const conn of afproj.connections) {
    if (connIdsSeen.has(conn.id)) {
      issues.push(
        err(
          "DUPLICATE_CONNECTION_ID",
          `Duplicate connection ID "${conn.id}" in .afproj.`,
          `${afprojSource}#connections`,
          `Regenerate a unique UUID for each connection.`
        )
      );
    }
    connIdsSeen.add(conn.id);
  }

  // ── 6. Entrypoint validation ────────────────────────────────────────
  const entrypoints = afproj.agents.filter((a) => a.isEntrypoint);

  if (entrypoints.length === 0 && afproj.agents.length > 0) {
    issues.push(
      warn(
        "NO_ENTRYPOINT",
        `No agent is marked as entrypoint. The flow has no defined start.`,
        `${afprojSource}#agents`,
        `Set isEntrypoint: true on one agent.`
      )
    );
  }

  if (entrypoints.length > 1) {
    issues.push(
      err(
        "MULTIPLE_ENTRYPOINTS",
        `Multiple agents are marked as entrypoint: [${entrypoints.map((a) => a.id).join(", ")}]. Only one is allowed.`,
        `${afprojSource}#agents`,
        `Set isEntrypoint: true on exactly one agent.`
      )
    );
  }

  // ── 7. profilePath consistency between AgentRef and .adata ──────────
  for (const agentRef of afproj.agents) {
    const adata = adataByAgentId.get(agentRef.id);
    if (adata && adata.profilePath !== agentRef.profilePath) {
      issues.push(
        err(
          "PROFILE_PATH_MISMATCH",
          `AgentRef profilePath "${agentRef.profilePath}" does not match adata.profilePath "${adata.profilePath}" for agent "${agentRef.id}".`,
          `${afprojSource}#agents[${agentRef.id}].profilePath`,
          `Align the profilePath in both .afproj and the agent's .adata file.`
        )
      );
    }
  }

  // ── 8. Project has at least one agent (info only) ───────────────────
  if (afproj.agents.length === 0) {
    issues.push(
      info(
        "EMPTY_PROJECT",
        `Project "${afproj.name}" has no agents defined.`,
        afprojSource
      )
    );
  }

  return { issues, validAgentIds };
}

// ── Helpers: issue predicates ──────────────────────────────────────────────

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function filterBySeverity(
  issues: ValidationIssue[],
  severity: ValidationIssue["severity"]
): ValidationIssue[] {
  return issues.filter((i) => i.severity === severity);
}
