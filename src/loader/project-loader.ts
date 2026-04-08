/**
 * src/loader/project-loader.ts
 *
 * ProjectLoader — the main orchestrator for loading and validating
 * an AgentFlow project from disk.
 *
 * Usage:
 *   const loader = new ProjectLoader(projectDir);
 *   const result = await loader.load({ mode: "load" });
 *
 * Modes:
 *   - "load"     → validate + build ProjectModel (default)
 *   - "dry-run"  → validate + report issues, no file writes, no ProjectModel
 *   - "repair"   → validate + auto-repair + build ProjectModel
 */

import { join, basename } from "node:path";
import type { Afproj } from "../schemas/afproj.schema.ts";
import type { Adata } from "../schemas/adata.schema.ts";
import {
  readJsonFile,
  readTextFile,
  findAfprojFiles,
  findAdataFiles,
  resolveProjectPath,
  fileExists,
} from "./file-reader.ts";
import {
  validateAfproj,
  validateAdata,
} from "./schema-validator.ts";
import { crossValidate } from "./cross-validator.ts";
import { repairProject } from "./repairer.ts";
import type {
  LoaderOptions,
  LoadResult,
  ProjectModel,
  AgentModel,
  SubagentModel,
  ValidationIssue,
  RepairAction,
} from "./types.ts";

// ── ProjectLoader ─────────────────────────────────────────────────────────

export class ProjectLoader {
  private readonly projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /**
   * Load (and optionally validate + repair) a project from disk.
   *
   * @param options - Loader options (mode, loadBehaviorFiles, etc.)
   */
  async load(options: LoaderOptions = {}): Promise<LoadResult> {
    const startMs = Date.now();
    const timestamp = new Date().toISOString();
    const {
      mode = "load",
      loadBehaviorFiles = true,
      loadSkillFiles = true,
    } = options;

    const allIssues: ValidationIssue[] = [];
    const repairActions: RepairAction[] = [];
    let filesRead = 0;

    // ── Step 1: Locate .afproj file ──────────────────────────────────────
    const afprojFiles = await findAfprojFiles(this.projectDir);

    if (afprojFiles.length === 0) {
      allIssues.push({
        severity: "error",
        code: "NO_AFPROJ_FILE",
        message: `No .afproj file found in project directory "${this.projectDir}".`,
        source: this.projectDir,
        repairHint: "Create a <project-name>.afproj file in the project directory.",
      });
      return this.buildFailResult(allIssues, repairActions, startMs, timestamp);
    }

    if (afprojFiles.length > 1) {
      allIssues.push({
        severity: "error",
        code: "MULTIPLE_AFPROJ_FILES",
        message: `Multiple .afproj files found: [${afprojFiles.map((f) => basename(f)).join(", ")}]. Only one is allowed per project.`,
        source: this.projectDir,
        repairHint: "Keep only one .afproj file in the project root.",
      });
      return this.buildFailResult(allIssues, repairActions, startMs, timestamp);
    }

    const afprojPath = afprojFiles[0]!;

    // ── Step 2: Read and validate .afproj ────────────────────────────────
    let rawAfproj: unknown;
    try {
      rawAfproj = await readJsonFile(afprojPath);
      filesRead++;
    } catch (err) {
      allIssues.push({
        severity: "error",
        code: "AFPROJ_READ_ERROR",
        message: `Cannot read .afproj: ${err instanceof Error ? err.message : String(err)}`,
        source: basename(afprojPath),
      });
      return this.buildFailResult(allIssues, repairActions, startMs, timestamp);
    }

    const afprojValidation = validateAfproj(rawAfproj, basename(afprojPath));
    allIssues.push(...afprojValidation.issues);

    if (!afprojValidation.success || !afprojValidation.data) {
      return this.buildFailResult(allIssues, repairActions, startMs, timestamp);
    }

    let afproj = afprojValidation.data;

    // ── Step 3: Discover and validate all .adata files ──────────────────
    const adataFiles = await findAdataFiles(this.projectDir);
    const adataByAgentId = new Map<string, Adata>();

    for (const adataFile of adataFiles) {
      const agentId = basename(adataFile, ".adata");

      let rawAdata: unknown;
      try {
        rawAdata = await readJsonFile(adataFile);
        filesRead++;
      } catch (err) {
        allIssues.push({
          severity: "error",
          code: "ADATA_READ_ERROR",
          message: `Cannot read .adata: ${err instanceof Error ? err.message : String(err)}`,
          source: `metadata/${agentId}.adata`,
        });
        continue;
      }

      const adataValidation = validateAdata(rawAdata, `metadata/${agentId}.adata`);
      allIssues.push(...adataValidation.issues);

      if (adataValidation.success && adataValidation.data) {
        adataByAgentId.set(agentId, adataValidation.data);
      }
    }

    // ── Step 4: Cross-validation ─────────────────────────────────────────
    const crossResult = await crossValidate({
      afproj,
      adataByAgentId,
      projectDir: this.projectDir,
    });
    allIssues.push(...crossResult.issues);

    // ── Step 5: Apply repairs (repair mode only) ─────────────────────────
    if (mode === "repair") {
      const repairResult = await repairProject({
        afproj,
        adataByAgentId,
        issues: allIssues,
        projectDir: this.projectDir,
        afprojPath,
        dryRun: false,
      });
      repairActions.push(...repairResult.actions);
      afproj = repairResult.afproj;
      // Update adataByAgentId with repaired versions
      for (const [k, v] of repairResult.adataByAgentId) {
        adataByAgentId.set(k, v);
      }
    }

    // ── Step 6: Dry-run proposals (dry-run mode only) ────────────────────
    if (mode === "dry-run") {
      const dryRunResult = await repairProject({
        afproj,
        adataByAgentId,
        issues: allIssues,
        projectDir: this.projectDir,
        afprojPath,
        dryRun: true,
      });
      repairActions.push(...dryRunResult.actions);

      return this.buildDryRunResult(allIssues, repairActions, startMs, timestamp);
    }

    // ── Step 7: Check for blocking errors ───────────────────────────────
    const errors = allIssues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      return this.buildFailResult(allIssues, repairActions, startMs, timestamp);
    }

    // ── Step 8: Build ProjectModel ───────────────────────────────────────
    const project = await this.buildProjectModel(
      afproj,
      afprojPath,
      adataByAgentId,
      loadBehaviorFiles,
      loadSkillFiles,
      allIssues
    );

    filesRead += project.agents.size; // count agent file reads

    const durationMs = Date.now() - startMs;

    return {
      success: true,
      project,
      issues: allIssues,
      repairActions,
      summary: {
        errors: allIssues.filter((i) => i.severity === "error").length,
        warnings: allIssues.filter((i) => i.severity === "warning").length,
        infos: allIssues.filter((i) => i.severity === "info").length,
        repairsApplied: repairActions.filter((a) => a.applied).length,
        repairsProposed: repairActions.filter((a) => !a.applied).length,
        agentsLoaded: project.agents.size,
        filesRead,
      },
      timestamp,
      durationMs,
    };
  }

  // ── ProjectModel builder ─────────────────────────────────────────────────

  private async buildProjectModel(
    afproj: Afproj,
    afprojPath: string,
    adataByAgentId: Map<string, Adata>,
    loadBehaviorFiles: boolean,
    loadSkillFiles: boolean,
    issues: ValidationIssue[]
  ): Promise<ProjectModel> {
    const agents = new Map<string, AgentModel>();
    let entrypoint: AgentModel | undefined;

    for (const agentRef of afproj.agents) {
      const adata = adataByAgentId.get(agentRef.id);
      if (!adata) continue; // Already reported as missing in cross-validation

      // Read profile.md
      const profileAbsPath = resolveProjectPath(this.projectDir, agentRef.profilePath);
      let profileContent = "";

      if (loadBehaviorFiles) {
        try {
          const rec = await readTextFile(profileAbsPath);
          profileContent = rec.content;
        } catch {
          // Issue already reported by cross-validator — use empty string
        }
      }

      // Read aspect files
      const aspectContents = new Map<string, string>();
      if (loadBehaviorFiles) {
        for (const aspect of adata.aspects) {
          const absPath = resolveProjectPath(this.projectDir, aspect.filePath);
          try {
            const rec = await readTextFile(absPath);
            aspectContents.set(aspect.filePath, rec.content);
          } catch {
            // Issue already reported — skip content
          }
        }
      }

      // Read skill files
      const skillContents = new Map<string, string>();
      if (loadSkillFiles) {
        for (const skill of adata.skills) {
          const absPath = resolveProjectPath(this.projectDir, skill.filePath);
          try {
            const rec = await readTextFile(absPath);
            skillContents.set(skill.filePath, rec.content);
          } catch {
            // Issue already reported — skip content
          }
        }
      }

      // Build subagent models
      const subagents: SubagentModel[] = [];
      for (const sub of adata.subagents) {
        let subProfileContent: string | undefined;
        if (loadBehaviorFiles && sub.profilePath) {
          const subAbsPath = resolveProjectPath(this.projectDir, sub.profilePath);
          try {
            const rec = await readTextFile(subAbsPath);
            subProfileContent = rec.content;
          } catch {
            // Reported by cross-validator — skip
          }
        }

        subagents.push({
          id: sub.id,
          name: sub.name,
          description: sub.description,
          profileContent: subProfileContent,
          aspects: sub.aspects,
          skills: sub.skills,
          metadata: sub.metadata,
        });
      }

      const agentModel: AgentModel = {
        ref: agentRef,
        adata,
        profileContent,
        aspectContents,
        skillContents,
        subagents,
        isEntrypoint: agentRef.isEntrypoint,
      };

      agents.set(agentRef.id, agentModel);

      if (agentRef.isEntrypoint) {
        entrypoint = agentModel;
      }
    }

    return {
      projectDir: this.projectDir,
      afprojPath,
      afproj,
      agents,
      connections: afproj.connections,
      entrypoint,
      loadedAt: new Date().toISOString(),
    };
  }

  // ── Result builders ──────────────────────────────────────────────────────

  private buildFailResult(
    issues: ValidationIssue[],
    repairActions: RepairAction[],
    startMs: number,
    timestamp: string
  ): LoadResult {
    return {
      success: false,
      issues,
      repairActions,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        infos: issues.filter((i) => i.severity === "info").length,
        repairsApplied: 0,
        repairsProposed: 0,
        agentsLoaded: 0,
        filesRead: 0,
      },
      timestamp,
      durationMs: Date.now() - startMs,
    };
  }

  private buildDryRunResult(
    issues: ValidationIssue[],
    repairActions: RepairAction[],
    startMs: number,
    timestamp: string
  ): LoadResult {
    return {
      success: false, // dry-run never returns a project model
      issues,
      repairActions,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        infos: issues.filter((i) => i.severity === "info").length,
        repairsApplied: 0,
        repairsProposed: repairActions.length,
        agentsLoaded: 0,
        filesRead: 0,
      },
      timestamp,
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Convenience function ──────────────────────────────────────────────────

/**
 * Load a project from a directory path.
 * Shorthand for: new ProjectLoader(projectDir).load(options)
 */
export async function loadProject(
  projectDir: string,
  options?: LoaderOptions
): Promise<LoadResult> {
  const loader = new ProjectLoader(projectDir);
  return loader.load(options);
}
