/**
 * tests/electron/permissions-handlers.test.ts
 *
 * Unit tests for src/electron/permissions-handlers.ts
 *
 * Covers:
 *   - normalisePermissions: invalid inputs, valid inputs, partial validity
 *   - handleGetPermissions: returns empty on missing file, returns permissions
 *   - handleSetPermissions: writes and reads back correctly
 *   - Serialization format: permissions: { "perm": "value", "group": { "perm": "value" } }
 *
 * All tests use bun:test (Strict TDD pattern).
 */

import { describe, it, expect } from "bun:test";
import {
  normalisePermissions,
  handleGetPermissions,
  handleSetPermissions,
} from "../../src/electron/permissions-handlers.ts";
import type { PermissionsObject } from "../../src/electron/bridge.types.ts";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

// ── normalisePermissions ────────────────────────────────────────────────────

describe("normalisePermissions — invalid inputs", () => {
  it("returns {} for undefined", () => {
    expect(normalisePermissions(undefined)).toEqual({});
  });

  it("returns {} for null", () => {
    expect(normalisePermissions(null)).toEqual({});
  });

  it("returns {} for non-object primitives", () => {
    expect(normalisePermissions("string")).toEqual({});
    expect(normalisePermissions(42)).toEqual({});
  });

  it("returns {} for arrays (old format — no longer valid)", () => {
    expect(normalisePermissions([])).toEqual({});
    expect(normalisePermissions([{ tool: "Bash", rules: [] }])).toEqual({});
  });

  it("returns {} for empty object", () => {
    expect(normalisePermissions({})).toEqual({});
  });

  it("skips entries with invalid values (numbers, booleans, null, arrays)", () => {
    const raw = { read: 42, write: true, exec: null, run: [] };
    expect(normalisePermissions(raw)).toEqual({});
  });

  it("skips ungrouped entries with invalid permission value (not allow/deny/ask)", () => {
    const raw = { read: "yes", write: "no", exec: "allow" };
    expect(normalisePermissions(raw)).toEqual({ exec: "allow" });
  });

  it("skips invalid entries inside a group, keeps valid ones", () => {
    const raw = { Bash: { run: "allow", bad: "yes", also: 42 } };
    const result = normalisePermissions(raw);
    expect(result).toEqual({ Bash: { run: "allow" } });
  });
});

describe("normalisePermissions — valid inputs", () => {
  it("normalises a single ungrouped permission", () => {
    const raw = { read: "allow" };
    expect(normalisePermissions(raw)).toEqual({ read: "allow" });
  });

  it("accepts all three valid permission values: allow, deny, ask", () => {
    const raw = { r1: "allow", r2: "deny", r3: "ask" };
    const result = normalisePermissions(raw);
    expect(result).toEqual({ r1: "allow", r2: "deny", r3: "ask" });
  });

  it("normalises a grouped permission", () => {
    const raw = { Bash: { run: "allow", write: "deny" } };
    const result = normalisePermissions(raw);
    expect(result).toEqual({ Bash: { run: "allow", write: "deny" } });
  });

  it("normalises mixed ungrouped and grouped permissions", () => {
    const raw = {
      read: "allow",
      execute: "ask",
      Bash: { "run-scripts": "allow", "write-files": "deny" },
      Edit: { write: "deny" },
    };
    const result = normalisePermissions(raw);
    expect(result).toEqual({
      read: "allow",
      execute: "ask",
      Bash: { "run-scripts": "allow", "write-files": "deny" },
      Edit: { write: "deny" },
    });
  });

  it("allows a group with no entries (empty object)", () => {
    const raw = { Bash: {} };
    expect(normalisePermissions(raw)).toEqual({ Bash: {} });
  });
});

// TRIANGULATE: mixed valid + invalid entries in same payload
describe("normalisePermissions — mixed valid and invalid", () => {
  it("keeps valid ungrouped and grouped entries, drops invalid ones", () => {
    const raw = {
      read: "allow",       // valid ungrouped
      bad: "yes",          // invalid value → skipped
      score: 100,          // invalid type → skipped
      Bash: {
        r1: "allow",       // valid group entry
        r2: "bad",         // invalid group value → skipped
      },
      Other: null,         // invalid group (null) → skipped
    };
    const result = normalisePermissions(raw);
    expect(result).toEqual({
      read: "allow",
      Bash: { r1: "allow" },
    });
  });
});

// ── handleGetPermissions + handleSetPermissions ────────────────────────────

describe("handleGetPermissions — file not found", () => {
  it("returns success:true with empty permissions object when .adata file is missing", async () => {
    const result = await handleGetPermissions({
      projectDir: "/non-existent-project-dir",
      agentId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
    expect(result.permissions).toEqual({});
  });
});

describe("handleGetPermissions — file exists but has no permissions key", () => {
  it("returns empty object when .adata has no permissions key", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);
      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1,
          agentId,
          agentName: "TestAgent",
          aspects: [],
          skills: [],
          subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      const result = await handleGetPermissions({ projectDir: tmpDir, agentId });
      expect(result.success).toBe(true);
      expect(result.permissions).toEqual({});
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("handleSetPermissions + handleGetPermissions — round-trip", () => {
  it("writes and reads back a permissions object correctly", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);

      // Create initial .adata file
      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1,
          agentId,
          agentName: "TestAgent",
          aspects: [],
          skills: [],
          subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      const perms: PermissionsObject = {
        read: "allow",
        execute: "ask",
        Bash: {
          "run-scripts": "allow",
          "write-files": "deny",
        },
        Edit: {
          "write-files": "deny",
        },
      };

      const setResult = await handleSetPermissions({
        projectDir: tmpDir,
        agentId,
        permissions: perms,
      });
      expect(setResult.success).toBe(true);

      const getResult = await handleGetPermissions({ projectDir: tmpDir, agentId });
      expect(getResult.success).toBe(true);
      expect(getResult.permissions).toEqual(perms);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves existing .adata fields when writing permissions", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);

      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1,
          agentId,
          agentName: "TestAgent",
          description: "preserved description",
          opencode: { provider: "OpenAI", model: "gpt-4o", temperature: 0.7 },
          aspects: [],
          skills: [],
          subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      await handleSetPermissions({
        projectDir: tmpDir,
        agentId,
        permissions: { read: "allow" },
      });

      const raw = JSON.parse(await readFile(adataPath, "utf-8")) as Record<string, unknown>;
      expect(raw.description).toBe("preserved description");
      expect((raw.opencode as Record<string, unknown>)?.provider).toBe("OpenAI");
      expect(typeof raw.permissions).toBe("object");
      expect(Array.isArray(raw.permissions)).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("overwrites permissions completely on each set (no merge)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);

      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1, agentId, agentName: "TestAgent",
          aspects: [], skills: [], subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      // First write
      await handleSetPermissions({
        projectDir: tmpDir, agentId,
        permissions: { read: "allow" },
      });

      // Second write — different data (first-write entries gone)
      await handleSetPermissions({
        projectDir: tmpDir, agentId,
        permissions: { Bash: { execute: "deny" } },
      });

      const getResult = await handleGetPermissions({ projectDir: tmpDir, agentId });
      expect(Object.keys(getResult.permissions)).toEqual(["Bash"]);
      expect(getResult.permissions["Bash"]).toEqual({ execute: "deny" });
      expect(getResult.permissions["read"]).toBeUndefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("can write empty permissions object to clear all permissions", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);

      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1, agentId, agentName: "TestAgent",
          permissions: { read: "allow" },
          aspects: [], skills: [], subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      await handleSetPermissions({ projectDir: tmpDir, agentId, permissions: {} });
      const result = await handleGetPermissions({ projectDir: tmpDir, agentId });
      expect(result.permissions).toEqual({});
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("handleSetPermissions — error cases", () => {
  it("returns success:false when .adata file does not exist", async () => {
    const result = await handleSetPermissions({
      projectDir: "/non-existent-project-dir",
      agentId: "00000000-0000-0000-0000-000000000001",
      permissions: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// TRIANGULATE: serialization format matches spec
describe("permissions serialization format", () => {
  it("serializes as 'permissions' key containing a plain object (not an array)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "agentsflow-perm-test-"));
    try {
      const metaDir = join(tmpDir, "metadata");
      await mkdir(metaDir, { recursive: true });
      const agentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const adataPath = join(metaDir, `${agentId}.adata`);

      await writeFile(
        adataPath,
        JSON.stringify({
          version: 1, agentId, agentName: "TestAgent",
          aspects: [], skills: [], subagents: [],
          profilePath: `behaviors/${agentId}/profile.md`,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      const perms: PermissionsObject = {
        read: "allow",
        execute: "ask",
        Bash: {
          "run-scripts": "allow",
          "write-files": "deny",
        },
      };

      await handleSetPermissions({ projectDir: tmpDir, agentId, permissions: perms });

      const raw = JSON.parse(await readFile(adataPath, "utf-8")) as Record<string, unknown>;

      // Must be a plain object, NOT an array
      expect(typeof raw.permissions).toBe("object");
      expect(Array.isArray(raw.permissions)).toBe(false);
      expect(raw.permissions).not.toBeNull();

      const stored = raw.permissions as Record<string, unknown>;

      // Ungrouped entries
      expect(stored["read"]).toBe("allow");
      expect(stored["execute"]).toBe("ask");

      // Grouped entry
      expect(typeof stored["Bash"]).toBe("object");
      expect(Array.isArray(stored["Bash"])).toBe(false);
      const bash = stored["Bash"] as Record<string, unknown>;
      expect(bash["run-scripts"]).toBe("allow");
      expect(bash["write-files"]).toBe("deny");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
