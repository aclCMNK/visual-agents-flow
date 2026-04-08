/**
 * tests/loader/project-loader.test.ts
 *
 * Integration tests for ProjectLoader and loadProject.
 *
 * Tests:
 * - load (mode: "load"): success with valid project
 * - load: failure when no .afproj found
 * - load: failure when .afproj has schema errors
 * - load: failure with multiple .afproj files
 * - load: failure when required files are missing (cross-validation)
 * - dry-run mode: returns issues + repair proposals, no ProjectModel
 * - repair mode: applies repairs and returns a valid ProjectModel
 * - ProjectModel structure: agents, connections, entrypoint
 * - Convenience function loadProject()
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectLoader, loadProject } from "../../src/loader/project-loader.ts";
import {
  createProjectFixture,
  makeAfproj,
  makeAdataA,
  makeAdataB,
  AGENT_A_ID,
  AGENT_B_ID,
  type ProjectFixture,
} from "./fixtures/project-factory.ts";

// ── Setup ──────────────────────────────────────────────────────────────────

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createProjectFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

// ── mode: "load" — happy path ─────────────────────────────────────────────

describe('ProjectLoader — mode: "load" (happy path)', () => {
  it("successfully loads a valid project", async () => {
    const loader = new ProjectLoader(fixture.projectDir);
    const result = await loader.load({ mode: "load" });

    expect(result.success).toBe(true);
    expect(result.project).toBeDefined();
    expect(result.summary.errors).toBe(0);
    expect(result.summary.agentsLoaded).toBe(2);
  });

  it("builds correct ProjectModel structure", async () => {
    const result = await loadProject(fixture.projectDir);

    expect(result.success).toBe(true);
    const project = result.project!;

    expect(project.projectDir).toBe(fixture.projectDir);
    expect(project.agents.size).toBe(2);
    expect(project.connections).toHaveLength(1);
  });

  it("populates the entrypoint agent correctly", async () => {
    const result = await loadProject(fixture.projectDir);
    const project = result.project!;

    expect(project.entrypoint).toBeDefined();
    expect(project.entrypoint?.ref.id).toBe(AGENT_A_ID);
    expect(project.entrypoint?.isEntrypoint).toBe(true);
  });

  it("loads profile.md content for each agent", async () => {
    const result = await loadProject(fixture.projectDir, { loadBehaviorFiles: true });
    const project = result.project!;

    const agentA = project.agents.get(AGENT_A_ID);
    expect(agentA?.profileContent).toContain("Support Agent");
  });

  it("loads aspect file contents", async () => {
    const result = await loadProject(fixture.projectDir, { loadBehaviorFiles: true });
    const project = result.project!;

    const agentA = project.agents.get(AGENT_A_ID);
    const toneContent = agentA?.aspectContents.get(
      `behaviors/${AGENT_A_ID}/tone.md`
    );
    expect(toneContent).toContain("Tone");
  });

  it("loads skill file contents", async () => {
    const result = await loadProject(fixture.projectDir, { loadSkillFiles: true });
    const project = result.project!;

    const agentA = project.agents.get(AGENT_A_ID);
    const skillContent = agentA?.skillContents.get("skills/kb-search.md");
    expect(skillContent).toContain("Knowledge Base Search");
  });

  it("loads subagents for an agent", async () => {
    const result = await loadProject(fixture.projectDir);
    const project = result.project!;

    const agentA = project.agents.get(AGENT_A_ID);
    expect(agentA?.subagents).toHaveLength(1);
    expect(agentA?.subagents[0]?.name).toBe("Ticket Classifier");
  });

  it("skips behavior file loading when loadBehaviorFiles: false", async () => {
    const result = await loadProject(fixture.projectDir, { loadBehaviorFiles: false });
    const project = result.project!;

    const agentA = project.agents.get(AGENT_A_ID);
    expect(agentA?.profileContent).toBe("");
    expect(agentA?.aspectContents.size).toBe(0);
  });

  it("includes loadedAt timestamp", async () => {
    const result = await loadProject(fixture.projectDir);
    expect(result.project?.loadedAt).toBeDefined();
    expect(() => new Date(result.project!.loadedAt)).not.toThrow();
  });
});

// ── No .afproj found ──────────────────────────────────────────────────────

describe("ProjectLoader — no .afproj file", () => {
  it("returns failure when no .afproj exists in the directory", async () => {
    const emptyDir = join(tmpdir(), `agentsflow-empty-${randomUUID().slice(0, 8)}`);
    await mkdir(emptyDir, { recursive: true });

    try {
      const result = await loadProject(emptyDir);

      expect(result.success).toBe(false);
      expect(result.summary.errors).toBeGreaterThan(0);

      const noAfprojError = result.issues.find((i) => i.code === "NO_AFPROJ_FILE");
      expect(noAfprojError).toBeDefined();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns failure with multiple .afproj files", async () => {
    await writeFile(join(fixture.projectDir, "second.afproj"), "{}", "utf-8");

    const result = await loadProject(fixture.projectDir);

    expect(result.success).toBe(false);
    const multiError = result.issues.find((i) => i.code === "MULTIPLE_AFPROJ_FILES");
    expect(multiError).toBeDefined();
  });
});

// ── Schema validation failures ────────────────────────────────────────────

describe("ProjectLoader — schema validation failures", () => {
  it("returns failure when .afproj has invalid JSON", async () => {
    const badDir = join(tmpdir(), `agentsflow-bad-${randomUUID().slice(0, 8)}`);
    await mkdir(badDir, { recursive: true });

    try {
      await writeFile(join(badDir, "bad.afproj"), "{ invalid json }", "utf-8");
      const result = await loadProject(badDir);

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.code === "AFPROJ_READ_ERROR")).toBe(true);
    } finally {
      await rm(badDir, { recursive: true, force: true });
    }
  });

  it("returns failure when .afproj is missing required fields", async () => {
    const badDir = join(tmpdir(), `agentsflow-schema-${randomUUID().slice(0, 8)}`);
    await mkdir(badDir, { recursive: true });

    try {
      await writeFile(join(badDir, "bad.afproj"), JSON.stringify({ version: 1 }), "utf-8");
      const result = await loadProject(badDir);

      expect(result.success).toBe(false);
      expect(result.summary.errors).toBeGreaterThan(0);
    } finally {
      await rm(badDir, { recursive: true, force: true });
    }
  });
});

// ── Cross-validation failures ─────────────────────────────────────────────

describe("ProjectLoader — cross-validation failures", () => {
  it("returns failure when profile files are missing", async () => {
    const noProfileFixture = await createProjectFixture({ skipProfileFiles: true });
    try {
      const result = await loadProject(noProfileFixture.projectDir);

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.code === "MISSING_PROFILE_FILE")).toBe(true);
    } finally {
      await noProfileFixture.cleanup();
    }
  });

  it("reports warnings without failing load", async () => {
    // A project with no entrypoint produces a warning — load should still succeed
    // if there are no errors
    const noEntrypointFixture = await createProjectFixture({
      onlyAfprojAgents: true,
      afproj: {
        agents: [
          {
            id: AGENT_A_ID,
            name: "Support Agent",
            profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
            adataPath: `metadata/${AGENT_A_ID}.adata`,
            isEntrypoint: false, // no entrypoint
          },
        ],
        connections: [],
      } as Partial<import("../../src/schemas/afproj.schema.ts").Afproj>,
    });

    try {
      const result = await loadProject(noEntrypointFixture.projectDir);

      // Should succeed despite the warning
      expect(result.success).toBe(true);
      expect(result.summary.warnings).toBeGreaterThan(0);
      const noEpWarn = result.issues.find((i) => i.code === "NO_ENTRYPOINT");
      expect(noEpWarn?.severity).toBe("warning");
    } finally {
      await noEntrypointFixture.cleanup();
    }
  });
});

// ── mode: "dry-run" ───────────────────────────────────────────────────────

describe('ProjectLoader — mode: "dry-run"', () => {
  it("returns no ProjectModel in dry-run mode", async () => {
    const result = await loadProject(fixture.projectDir, { mode: "dry-run" });

    expect(result.project).toBeUndefined();
    expect(result.success).toBe(false); // dry-run never returns success=true
  });

  it("proposes repair actions in dry-run mode without applying them", async () => {
    // Use a project with no entrypoint to trigger the set-entrypoint repair
    const noEpFixture = await createProjectFixture({
      onlyAfprojAgents: true,
      afproj: {
        agents: [
          {
            id: AGENT_A_ID,
            name: "Agent A",
            profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
            adataPath: `metadata/${AGENT_A_ID}.adata`,
            isEntrypoint: false,
          },
        ],
        connections: [],
      } as Partial<import("../../src/schemas/afproj.schema.ts").Afproj>,
    });

    try {
      const result = await loadProject(noEpFixture.projectDir, { mode: "dry-run" });

      expect(result.repairActions.length).toBeGreaterThan(0);
      expect(result.repairActions.every((a) => !a.applied)).toBe(true);
      expect(result.summary.repairsProposed).toBeGreaterThan(0);
      expect(result.summary.repairsApplied).toBe(0);
    } finally {
      await noEpFixture.cleanup();
    }
  });
});

// ── mode: "repair" ────────────────────────────────────────────────────────

describe('ProjectLoader — mode: "repair"', () => {
  it("applies repairs and returns a successful result", async () => {
    // Project with no entrypoint — repair should fix it
    const noEpFixture = await createProjectFixture({
      onlyAfprojAgents: true,
      afproj: {
        agents: [
          {
            id: AGENT_A_ID,
            name: "Agent A",
            profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
            adataPath: `metadata/${AGENT_A_ID}.adata`,
            isEntrypoint: false, // will be repaired
          },
        ],
        connections: [],
      } as Partial<import("../../src/schemas/afproj.schema.ts").Afproj>,
    });

    try {
      const result = await loadProject(noEpFixture.projectDir, { mode: "repair" });

      expect(result.repairActions.some((a) => a.applied)).toBe(true);
      expect(result.summary.repairsApplied).toBeGreaterThan(0);
    } finally {
      await noEpFixture.cleanup();
    }
  });
});

// ── LoadResult summary ────────────────────────────────────────────────────

describe("LoadResult — summary", () => {
  it("summary counts match the issues array", async () => {
    const result = await loadProject(fixture.projectDir);

    const errorCount = result.issues.filter((i) => i.severity === "error").length;
    const warnCount = result.issues.filter((i) => i.severity === "warning").length;
    const infoCount = result.issues.filter((i) => i.severity === "info").length;

    expect(result.summary.errors).toBe(errorCount);
    expect(result.summary.warnings).toBe(warnCount);
    expect(result.summary.infos).toBe(infoCount);
  });

  it("includes a durationMs > 0", async () => {
    const result = await loadProject(fixture.projectDir);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("includes a valid ISO 8601 timestamp", async () => {
    const result = await loadProject(fixture.projectDir);
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── loadProject convenience function ─────────────────────────────────────

describe("loadProject (convenience function)", () => {
  it("is equivalent to new ProjectLoader().load()", async () => {
    const r1 = await loadProject(fixture.projectDir);
    const loader = new ProjectLoader(fixture.projectDir);
    const r2 = await loader.load();

    expect(r1.success).toBe(r2.success);
    expect(r1.summary.agentsLoaded).toBe(r2.summary.agentsLoaded);
    expect(r1.summary.errors).toBe(r2.summary.errors);
  });
});
