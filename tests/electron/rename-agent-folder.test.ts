/**
 * tests/electron/rename-agent-folder.test.ts
 *
 * Unit tests for the handleRenameAgentFolder extracted handler function.
 *
 * Tests use real temporary directories to verify:
 *   - No-op when oldSlug === newSlug
 *   - CONFLICT error when target folder already exists
 *   - Renames behaviors/<oldSlug> to behaviors/<newSlug>
 *   - Creates new folder when old folder doesn't exist
 *   - Updates profilePath in .adata
 *   - Updates agentName in .adata
 *   - Updates profile[].filePath entries in .adata
 *   - Handles missing .adata gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleRenameAgentFolder } from "../../src/electron/rename-agent-folder.ts";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

// ── Fixtures ─────────────────────────────────────────────────────────────

const AGENT_ID = "00000000-0000-0000-0000-000000000001";

let tmpDir: string;

async function setupProject(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "af-rename-"));
  await mkdir(join(tmpDir, "behaviors"), { recursive: true });
  await mkdir(join(tmpDir, "metadata"), { recursive: true });
  return tmpDir;
}

async function cleanup() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function makeAdata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    agentId: AGENT_ID,
    agentName: "old-agent",
    profilePath: "behaviors/old-agent/profile.md",
    profile: [
      {
        id: "p1",
        selector: "System Prompt",
        filePath: "behaviors/old-agent/system.md",
        order: 0,
        enabled: true,
      },
      {
        id: "p2",
        selector: "Some Aspect",
        filePath: "behaviors/old-agent/aspect.md",
        order: 1,
        enabled: true,
      },
    ],
    ...overrides,
  };
}

// ── no-op when oldSlug === newSlug ─────────────────────────────────────────

describe("handleRenameAgentFolder — no-op when slugs are equal", () => {
  beforeEach(setupProject);
  afterEach(cleanup);

  it("returns success without touching disk", async () => {
    const result = await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "my-agent",
      newSlug: "my-agent",
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });
});

// ── CONFLICT when target folder exists ────────────────────────────────────

describe("handleRenameAgentFolder — CONFLICT when target exists", () => {
  beforeEach(setupProject);
  afterEach(cleanup);

  it("returns CONFLICT errorCode when behaviors/<newSlug> already exists", async () => {
    await mkdir(join(tmpDir, "behaviors", "new-agent"), { recursive: true });

    const result = await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CONFLICT");
    expect(result.error).toContain("new-agent");
  });
});

// ── Renames behaviors folder ───────────────────────────────────────────────

describe("handleRenameAgentFolder — renames behaviors folder", () => {
  beforeEach(setupProject);
  afterEach(cleanup);

  it("renames behaviors/<oldSlug> to behaviors/<newSlug>", async () => {
    const oldDir = join(tmpDir, "behaviors", "old-agent");
    const newDir = join(tmpDir, "behaviors", "new-agent");
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, "profile.md"), "# old-agent\n");

    const result = await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    expect(result.success).toBe(true);

    // Old folder should no longer exist
    let oldExists = true;
    try { await stat(oldDir); } catch { oldExists = false; }
    expect(oldExists).toBe(false);

    // New folder should exist
    let newExists = false;
    try { await stat(newDir); newExists = true; } catch { newExists = false; }
    expect(newExists).toBe(true);
  });

  it("creates behaviors/<newSlug> when old folder is missing", async () => {
    const newDir = join(tmpDir, "behaviors", "new-agent");

    const result = await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "ghost-agent",
      newSlug: "new-agent",
    });

    expect(result.success).toBe(true);

    let newExists = false;
    try { await stat(newDir); newExists = true; } catch { newExists = false; }
    expect(newExists).toBe(true);
  });
});

// ── Updates .adata file ────────────────────────────────────────────────────

describe("handleRenameAgentFolder — updates .adata references", () => {
  beforeEach(setupProject);
  afterEach(cleanup);

  it("updates profilePath in .adata", async () => {
    const adataPath = join(tmpDir, "metadata", `${AGENT_ID}.adata`);
    await writeFile(adataPath, JSON.stringify(makeAdata()), "utf-8");
    await mkdir(join(tmpDir, "behaviors", "old-agent"), { recursive: true });

    await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    const updated = JSON.parse(await readFile(adataPath, "utf-8")) as Record<string, unknown>;
    expect(updated.profilePath).toBe("behaviors/new-agent/profile.md");
  });

  it("updates agentName in .adata", async () => {
    const adataPath = join(tmpDir, "metadata", `${AGENT_ID}.adata`);
    await writeFile(adataPath, JSON.stringify(makeAdata()), "utf-8");
    await mkdir(join(tmpDir, "behaviors", "old-agent"), { recursive: true });

    await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    const updated = JSON.parse(await readFile(adataPath, "utf-8")) as Record<string, unknown>;
    expect(updated.agentName).toBe("new-agent");
  });

  it("updates profile[].filePath entries that start with old prefix", async () => {
    const adataPath = join(tmpDir, "metadata", `${AGENT_ID}.adata`);
    await writeFile(adataPath, JSON.stringify(makeAdata()), "utf-8");
    await mkdir(join(tmpDir, "behaviors", "old-agent"), { recursive: true });

    await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    const updated = JSON.parse(await readFile(adataPath, "utf-8")) as Record<string, unknown>;
    const profile = updated.profile as Array<Record<string, unknown>>;
    expect(profile[0].filePath).toBe("behaviors/new-agent/system.md");
    expect(profile[1].filePath).toBe("behaviors/new-agent/aspect.md");
  });

  it("handles missing .adata gracefully (still returns success)", async () => {
    await mkdir(join(tmpDir, "behaviors", "old-agent"), { recursive: true });

    const result = await handleRenameAgentFolder({
      projectDir: tmpDir,
      agentId: AGENT_ID,
      oldSlug: "old-agent",
      newSlug: "new-agent",
    });

    expect(result.success).toBe(true);
  });
});
