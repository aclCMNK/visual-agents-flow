/**
 * src/loader/repairer.ts
 *
 * Automatic repair logic for common AgentFlow project issues.
 *
 * The repairer takes the validated state and a list of ValidationIssues,
 * and produces (or applies) RepairActions.
 *
 * In dry-run mode: proposes actions without applying them.
 * In repair mode: applies the actions and writes the modified files atomically.
 */

import { randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import type { Afproj, AgentRef } from "../schemas/afproj.schema.ts";
import type { Adata } from "../schemas/adata.schema.ts";
import type { ValidationIssue, RepairAction } from "./types.ts";
import { atomicWriteJson, atomicWriteText } from "./lock-manager.ts";
import { fileExists } from "./file-reader.ts";

// ── Repairer configuration ─────────────────────────────────────────────────

export interface RepairerInput {
  afproj: Afproj;
  adataByAgentId: Map<string, Adata>;
  issues: ValidationIssue[];
  projectDir: string;
  afprojPath: string;
  /** If true, actions are proposed but not applied */
  dryRun: boolean;
}

export interface RepairerResult {
  actions: RepairAction[];
  /** Modified afproj (may differ if repairs were applied to it) */
  afproj: Afproj;
  /** Modified adata map */
  adataByAgentId: Map<string, Adata>;
}

// ── Main repair function ───────────────────────────────────────────────────

/**
 * Analyze issues and produce or apply repair actions.
 */
export async function repairProject(input: RepairerInput): Promise<RepairerResult> {
  const { issues, projectDir, afprojPath, dryRun } = input;

  // Work with mutable copies
  let afproj = structuredClone(input.afproj) as Afproj;
  const adataByAgentId = new Map(
    Array.from(input.adataByAgentId.entries()).map(([k, v]) => [k, structuredClone(v) as Adata])
  );

  const actions: RepairAction[] = [];

  // Process each issue and decide repair strategy
  for (const issue of issues) {
    const repair = await buildRepairAction(issue, {
      afproj,
      adataByAgentId,
      projectDir,
      afprojPath,
      dryRun,
    });

    if (repair) {
      actions.push(repair);

      // Apply the repair to our working copies (mutations)
      if (!dryRun) {
        applyRepair(repair, afproj, adataByAgentId);
      }
    }
  }

  // Write modified files if not dry-run
  if (!dryRun && actions.some((a) => a.applied)) {
    // Write .afproj if any repair touched it
    const afprojRepairs = actions.filter(
      (a) => a.applied && a.targetFile === afprojPath
    );
    if (afprojRepairs.length > 0) {
      await atomicWriteJson(afprojPath, afproj);
    }

    // Write .adata files that were modified
    const modifiedAdataFiles = new Set(
      actions
        .filter((a) => a.applied && a.targetFile.endsWith(".adata"))
        .map((a) => a.targetFile)
    );

    for (const adataPath of modifiedAdataFiles) {
      const agentId = basename(adataPath, ".adata");
      const adata = adataByAgentId.get(agentId);
      if (adata) {
        await atomicWriteJson(adataPath, adata);
      }
    }
  }

  return { actions, afproj, adataByAgentId };
}

// ── Repair action builders ─────────────────────────────────────────────────

interface RepairContext {
  afproj: Afproj;
  adataByAgentId: Map<string, Adata>;
  projectDir: string;
  afprojPath: string;
  dryRun: boolean;
}

async function buildRepairAction(
  issue: ValidationIssue,
  ctx: RepairContext
): Promise<RepairAction | null> {
  const { afprojPath, projectDir, dryRun } = ctx;

  switch (issue.code) {
    // ── No entrypoint: set the first agent as entrypoint ────────────────
    case "NO_ENTRYPOINT": {
      if (ctx.afproj.agents.length === 0) return null;
      const firstAgent = ctx.afproj.agents[0];
      if (!firstAgent) return null;
      return {
        kind: "set-entrypoint",
        description: `Set agent "${firstAgent.id}" (${firstAgent.name}) as the project entrypoint.`,
        targetFile: afprojPath,
        fieldPath: `agents[0].isEntrypoint`,
        newValue: true,
        applied: !dryRun,
      };
    }

    // ── Missing profile.md: create a minimal placeholder ────────────────
    case "MISSING_PROFILE_FILE": {
      const match = issue.source.match(/agents\[([^\]]+)\]\.profilePath/);
      if (!match) return null;
      const agentId = match[1];
      const agentRef = ctx.afproj.agents.find((a) => a.id === agentId);
      if (!agentRef) return null;

      const absPath = join(projectDir, agentRef.profilePath);
      const alreadyExists = await fileExists(absPath);
      if (alreadyExists) return null;

      const content = `# ${agentRef.name}\n\n> Auto-generated profile. Edit this file to define the agent's behavior.\n`;

      if (!dryRun) {
        await atomicWriteText(absPath, content);
      }

      return {
        kind: "create-file",
        description: `Created minimal profile.md for agent "${agentId}" at "${agentRef.profilePath}".`,
        targetFile: absPath,
        applied: !dryRun,
      };
    }

    // ── Duplicate agent ID: assign a new UUID ───────────────────────────
    case "DUPLICATE_AGENT_ID": {
      const match = issue.source.match(/agents/);
      if (!match) return null;
      // Find the second occurrence of the duplicate ID
      const dupId = issue.message.match(/"([0-9a-f-]{36})"/)?.[1];
      if (!dupId) return null;

      const agentRefs = ctx.afproj.agents.filter((a) => a.id === dupId);
      if (agentRefs.length < 2) return null;
      const secondRef = agentRefs[1];
      if (!secondRef) return null;

      const newId = randomUUID();
      return {
        kind: "dedup-id",
        description: `Assigned new UUID "${newId}" to duplicate agent previously at "${dupId}".`,
        targetFile: afprojPath,
        fieldPath: `agents[duplicate].id`,
        newValue: newId,
        applied: !dryRun,
      };
    }

    // ── Multiple entrypoints: keep only the first ───────────────────────
    case "MULTIPLE_ENTRYPOINTS": {
      return {
        kind: "set-entrypoint",
        description: `Cleared isEntrypoint on all agents except the first declared entrypoint.`,
        targetFile: afprojPath,
        fieldPath: `agents[*].isEntrypoint`,
        newValue: false,
        applied: !dryRun,
      };
    }

    // ── adata.agentId mismatch: fix to match expected ID ────────────────
    case "ADATA_ID_MISMATCH": {
      const match = issue.source.match(/metadata\/([^.]+)\.adata/);
      if (!match) return null;
      const expectedId = match[1];
      if (!expectedId) return null;

      const adataPath = join(projectDir, "metadata", `${expectedId}.adata`);
      return {
        kind: "set-field",
        description: `Set adata.agentId to "${expectedId}" in ${expectedId}.adata.`,
        targetFile: adataPath,
        fieldPath: "agentId",
        newValue: expectedId,
        applied: !dryRun,
      };
    }

    // ── Other issues — no auto-repair available ─────────────────────────
    default:
      return null;
  }
}

// ── Mutation applier ───────────────────────────────────────────────────────

/**
 * Apply a repair action's mutation to the in-memory objects.
 * This modifies afproj or adataByAgentId in place.
 */
function applyRepair(
  action: RepairAction,
  afproj: Afproj,
  adataByAgentId: Map<string, Adata>
): void {
  if (!action.applied) return;

  switch (action.kind) {
    case "set-entrypoint": {
      if (action.fieldPath === "agents[0].isEntrypoint") {
        // Set only the first agent as entrypoint
        for (let i = 0; i < afproj.agents.length; i++) {
          const agent = afproj.agents[i];
          if (agent) {
            (agent as AgentRef).isEntrypoint = i === 0;
          }
        }
      } else if (action.fieldPath === "agents[*].isEntrypoint") {
        // Keep only the first entrypoint
        let foundFirst = false;
        for (const agent of afproj.agents) {
          if (agent.isEntrypoint && !foundFirst) {
            foundFirst = true;
          } else {
            (agent as AgentRef).isEntrypoint = false;
          }
        }
      }
      break;
    }

    case "set-field": {
      if (action.fieldPath === "agentId" && action.targetFile.endsWith(".adata")) {
        const agentId = basename(action.targetFile, ".adata");
        const adata = adataByAgentId.get(agentId);
        if (adata && typeof action.newValue === "string") {
          (adata as Adata).agentId = action.newValue;
        }
      }
      break;
    }

    case "dedup-id": {
      // Find and update the duplicate in the agents array
      if (typeof action.newValue === "string") {
        const dupId = action.description.match(/previously at "([0-9a-f-]{36})"/)?.[1];
        if (dupId) {
          let firstSeen = false;
          for (const agent of afproj.agents) {
            if (agent.id === dupId) {
              if (firstSeen) {
                (agent as AgentRef).id = action.newValue as string;
                break;
              }
              firstSeen = true;
            }
          }
        }
      }
      break;
    }

    // create-file and fix-path only touch the filesystem — no in-memory changes needed
    case "create-file":
    case "fix-path":
    case "remove-orphan":
      break;
  }
}
