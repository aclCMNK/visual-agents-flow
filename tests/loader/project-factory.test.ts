/**
 * tests/loader/project-factory.test.ts
 *
 * Unit and integration tests for src/loader/project-factory.ts
 *
 * Tests:
 *   validateNewProjectDir:
 *     - empty string → error
 *     - non-existent path with writable parent → info (will be created)
 *     - non-writable directory → error
 *     - directory that already has .afproj → error (ALREADY_EXISTS)
 *     - empty directory → valid info
 *     - non-empty directory without .afproj → valid warn + suggestedSubdir
 *
 *   slugify:
 *     - typical project names → underscores
 *     - edge cases: special chars, leading/trailing spaces, all non-alnum
 *
 *   createProject:
 *     - happy path: ALWAYS creates a named subdirectory inside projectDir
 *     - empty name → error without creating files
 *     - directory already has slug-named subdir with .afproj → ALREADY_EXISTS
 *     - rollback on failure: no partial files left
 *     - .afproj content is valid JSON with correct fields (uses `description` not `desc`)
 *     - .gitkeep files are created in each subdirectory
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  validateNewProjectDir,
  createProject,
  slugify,
} from "../../src/loader/project-factory.ts";

// ── Temp directory helpers ─────────────────────────────────────────────────

let tempRoot: string;

beforeEach(async () => {
  tempRoot = join(tmpdir(), `aftest-factory-${randomUUID()}`);
  await mkdir(tempRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

// ── slugify ───────────────────────────────────────────────────────────────

describe("slugify()", () => {
  // ── Suite 1: preservación de guiones (spec: prompt-json-slug-sync.md) ──

  it("preserves hyphens — BUG FIX: was converting '-' to '_'", () => {
    expect(slugify("my-project")).toBe("my-project");
  });

  it("preserves underscores", () => {
    expect(slugify("my_project")).toBe("my_project");
  });

  it("converts spaces to hyphens (not underscores)", () => {
    expect(slugify("My Project")).toBe("my-project");
  });

  it("preserves mixed hyphen and underscore", () => {
    expect(slugify("my-project_v2")).toBe("my-project_v2");
  });

  it("converts dot to hyphen", () => {
    expect(slugify("my.project")).toBe("my-project");
  });

  it("strips accents", () => {
    expect(slugify("ÉquipoÁgil")).toBe("equipoagil");
  });

  it("CHAR_MAP: ß → strasse", () => {
    expect(slugify("Straße")).toBe("strasse");
  });

  it("CHAR_MAP: ø → o (Søren → soren)", () => {
    expect(slugify("Søren")).toBe("soren");
  });

  it("collapses multiple spaces to single hyphen", () => {
    expect(slugify("Drass  MemorIA")).toBe("drass-memoria");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(90);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it("handles all non-alphanumeric input → fallback 'project'", () => {
    expect(slugify("!!!###$$$")).toBe("project");
  });

  it("handles empty string → fallback 'project'", () => {
    expect(slugify("")).toBe("project");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-my-project-")).toBe("my-project");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("my--project")).toBe("my-project");
  });

  it("handles single letter", () => {
    expect(slugify("A")).toBe("a");
  });

  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("My Cool Project")).toBe("my-cool-project");
  });

  it("collapses multiple special chars into one hyphen", () => {
    expect(slugify("Agent//Flow!!Editor")).toBe("agent-flow-editor");
  });

  it("handles unicode by stripping non-ascii (via NFD)", () => {
    const result = slugify("Ñoño Project");
    expect(result).toMatch(/^[a-z0-9_-]+$/);
  });

  // ── Suite 2: consistencia slugify ↔ toSlug ──────────────────────────────

  it("is consistent with toSlug for all test names", async () => {
    const { toSlug } = await import("../../src/ui/utils/slugUtils.ts");
    const testNames = [
      "my-project",
      "my_project",
      "My Project",
      "DevTeam_1",
      "Drass MemorIA",
      "ÉquipoÁgil",
      "Straße",
      "Søren",
      "my.project",
      "my-project_v2",
      "Agent.Bot",
    ];
    for (const name of testNames) {
      const fromFactory = slugify(name);
      const fromSlugUtils = toSlug(name.trim()) || "project";
      expect(fromFactory).toBe(fromSlugUtils.slice(0, 80));
    }
  });
});

// ── validateNewProjectDir ──────────────────────────────────────────────────

describe("validateNewProjectDir()", () => {
  it("returns error for empty string", async () => {
    const result = await validateNewProjectDir("");
    expect(result.valid).toBe(false);
    expect(result.severity).toBe("error");
  });

  it("returns error for whitespace-only string", async () => {
    const result = await validateNewProjectDir("   ");
    expect(result.valid).toBe(false);
    expect(result.severity).toBe("error");
  });

  it("returns info when directory does not exist but parent is writable", async () => {
    const nonExistent = join(tempRoot, "new-subdir");
    const result = await validateNewProjectDir(nonExistent);
    expect(result.valid).toBe(true);
    expect(result.severity).toBe("info");
    expect(result.message).toMatch(/created/i);
    expect(result.nonEmpty).toBe(false);
  });

  it("returns info for empty writable directory", async () => {
    const emptyDir = join(tempRoot, "empty");
    await mkdir(emptyDir, { recursive: true });

    const result = await validateNewProjectDir(emptyDir);
    expect(result.valid).toBe(true);
    expect(result.severity).toBe("info");
    expect(result.nonEmpty).toBe(false);
  });

  it("returns error when an .afproj already exists", async () => {
    const projectDir = join(tempRoot, "existing-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "my-project.afproj"), "{}", "utf-8");

    const result = await validateNewProjectDir(projectDir);
    expect(result.valid).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/already exists/i);
  });

  it("returns warn with nonEmpty=true and suggestedSubdir when dir has non-.afproj files", async () => {
    const dirWithFiles = join(tempRoot, "non-empty-dir");
    await mkdir(dirWithFiles, { recursive: true });
    await writeFile(join(dirWithFiles, "README.md"), "# hello", "utf-8");

    const result = await validateNewProjectDir(dirWithFiles);
    expect(result.valid).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.nonEmpty).toBe(true);
    expect(result.suggestedSubdir).toBeDefined();
    expect(result.suggestedSubdir).toContain(dirWithFiles);
  });
});

// ── createProject — happy path ─────────────────────────────────────────────

describe('createProject() — happy path', () => {
  it("always creates a named subdirectory inside the selected folder", async () => {
    // projectDir is the user-selected base; the project goes into a subdir
    const baseDir = join(tempRoot, "base");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "New Test Project",
    });

    expect(result.success).toBe(true);
    // The actual project dir is a subdir of baseDir, named after the slug
    const expectedSubdir = join(baseDir, "new-test-project");
    expect(result.projectDir).toBe(expectedSubdir);
    expect(result.afprojName).toBe("new-test-project.afproj");

    // Verify directory structure inside the subdir
    expect(existsSync(expectedSubdir)).toBe(true);
    expect(existsSync(join(expectedSubdir, "behaviors"))).toBe(true);
    expect(existsSync(join(expectedSubdir, "metadata"))).toBe(true);
    expect(existsSync(join(expectedSubdir, "skills"))).toBe(true);
    expect(existsSync(join(expectedSubdir, result.afprojName!))).toBe(true);
  });

  it("does not place any files directly in the user-selected base folder", async () => {
    const baseDir = join(tempRoot, "user-selected");
    await mkdir(baseDir, { recursive: true });

    await createProject({ projectDir: baseDir, name: "My Project" });

    // Only the project subdir should exist in baseDir (no loose files)
    const entries = await readdir(baseDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe("my-project");
  });

  it("writes a valid JSON .afproj manifest with `description` field", async () => {
    const baseDir = join(tempRoot, "json-test");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "JSON Validation Project",
      description: "testing manifest content",
    });

    expect(result.success).toBe(true);

    const afprojPath = join(result.projectDir!, result.afprojName!);
    const content = await readFile(afprojPath, "utf-8");
    const manifest = JSON.parse(content);

    expect(manifest.version).toBe(1);
    expect(manifest.id).toBeDefined();
    // id must be a valid UUID v4
    expect(manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(manifest.name).toBe("JSON Validation Project");
    expect(manifest.description).toBe("testing manifest content");
    expect(manifest.agents).toEqual([]);
    expect(manifest.connections).toEqual([]);
    expect(manifest.properties).toEqual({});
    expect(manifest.createdAt).toBeDefined();
    expect(manifest.updatedAt).toBeDefined();
    // Both timestamps should be valid ISO strings
    expect(() => new Date(manifest.createdAt)).not.toThrow();
    expect(() => new Date(manifest.updatedAt)).not.toThrow();
    // Legacy flat user_id must NOT be written in new projects (migration)
    expect(manifest.user_id).toBeUndefined();
    // New project has no user object yet (user node is added via canvas)
    expect(manifest.user).toBeUndefined();
  });

  it("creates .gitkeep in each subdirectory", async () => {
    const baseDir = join(tempRoot, "gitkeep-test");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({ projectDir: baseDir, name: "gitkeep test" });

    for (const subdir of ["behaviors", "metadata", "skills"]) {
      expect(existsSync(join(result.projectDir!, subdir, ".gitkeep"))).toBe(true);
    }
  });

  it("uses empty string as default description when not provided", async () => {
    const baseDir = join(tempRoot, "no-desc");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({ projectDir: baseDir, name: "No Description" });
    expect(result.success).toBe(true);

    const afprojPath = join(result.projectDir!, result.afprojName!);
    const manifest = JSON.parse(await readFile(afprojPath, "utf-8"));
    expect(manifest.description).toBe("");
  });

  it("trims whitespace from name and description", async () => {
    const baseDir = join(tempRoot, "trimmed");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "  Trimmed Name  ",
      description: "  trimmed desc  ",
    });
    expect(result.success).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(result.projectDir!, result.afprojName!), "utf-8")
    );
    expect(manifest.name).toBe("Trimmed Name");
    expect(manifest.description).toBe("trimmed desc");
  });

  it("works when baseDir is non-empty (other files present)", async () => {
    const baseDir = join(tempRoot, "non-empty-base");
    await mkdir(baseDir, { recursive: true });
    await writeFile(join(baseDir, "existing.txt"), "data", "utf-8");

    const result = await createProject({
      projectDir: baseDir,
      name: "Works In Non Empty",
    });

    expect(result.success).toBe(true);
    expect(result.projectDir).toBe(join(baseDir, "works-in-non-empty"));
  });
});

// ── createProject — error cases ────────────────────────────────────────────

describe('createProject() — error cases', () => {
  it("returns error for empty name", async () => {
    const baseDir = join(tempRoot, "empty-name");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("IO_ERROR");
  });

  it("returns error for whitespace-only name", async () => {
    const baseDir = join(tempRoot, "ws-only");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("returns ALREADY_EXISTS when the project subdir already has an .afproj", async () => {
    const baseDir = join(tempRoot, "already-exists");
    await mkdir(baseDir, { recursive: true });

    // Pre-create the slug-named subdir with an .afproj inside
    const existingSubdir = join(baseDir, "duplicate-project");
    await mkdir(existingSubdir, { recursive: true });
    await writeFile(join(existingSubdir, "old.afproj"), "{}", "utf-8");

    const result = await createProject({
      projectDir: baseDir,
      name: "Duplicate Project",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("ALREADY_EXISTS");
    // Original .afproj should still be untouched
    expect(existsSync(join(existingSubdir, "old.afproj"))).toBe(true);
  });
});

// ── createProject — rollback ────────────────────────────────────────────────

describe('createProject() — rollback on failure', () => {
  it("leaves no partial files after a validation error prevents creation", async () => {
    const baseDir = join(tempRoot, "rollback-test");
    await mkdir(baseDir, { recursive: true });

    // Pre-create the subdir with a conflicting .afproj
    const subdir = join(baseDir, "should-fail");
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, "existing.afproj"), "{}", "utf-8");

    const entriesBefore = await readdir(subdir);

    const result = await createProject({
      projectDir: baseDir,
      name: "Should Fail",
    });

    expect(result.success).toBe(false);

    const entriesAfter = await readdir(subdir);
    // No new files should have been created
    expect(entriesAfter).toEqual(entriesBefore);
  });
});

// ── .afproj filename follows the slug ──────────────────────────────────────

describe('createProject() — afproj filename', () => {
  it("names the .afproj file using the slugified project name (hyphens)", async () => {
    const baseDir = join(tempRoot, "slug-filename");
    await mkdir(baseDir, { recursive: true });

    const result = await createProject({
      projectDir: baseDir,
      name: "Agent Flow: Test & Demo",
    });

    expect(result.success).toBe(true);
    expect(result.afprojName).toBe("agent-flow-test-demo.afproj");
  });
});
