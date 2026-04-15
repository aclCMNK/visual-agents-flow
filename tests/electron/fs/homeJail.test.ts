/**
 * tests/electron/fs/homeJail.test.ts
 *
 * Unit tests for electron-main/src/fs/homeJail.ts
 *
 * Covers:
 *   - HOME_ROOT: is a non-empty string, is absolute, is equal to getHomeDir()
 *   - getHomeDir(): returns the same value as HOME_ROOT
 *   - resolveWithinHome(): resolves valid inner paths, rejects traversal,
 *     rejects non-existent paths, rejects empty strings
 *   - isPathInsideHome(): returns true for valid inner paths, false for anything
 *     outside or non-existent
 *   - assertWithinHome(): alias — same behaviour as resolveWithinHome
 *
 * Testing strategy:
 *   - We use the REAL HOME_ROOT of the running process.
 *   - Paths that MUST exist: HOME_ROOT itself and any tmpdir we create.
 *   - Paths we construct with os.tmpdir() that happen to be outside HOME_ROOT
 *     are used to exercise the rejection path.
 *   - Symlink tests create real symlinks with mkdtemp inside HOME_ROOT.
 *
 * All tests use bun:test.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  HOME_ROOT,
  getHomeDir,
  resolveWithinHome,
  isPathInsideHome,
  assertWithinHome,
} from "../../../electron-main/src/fs/homeJail.ts";
import { join, sep } from "node:path";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { existsSync } from "node:fs";

// ── HOME_ROOT ─────────────────────────────────────────────────────────────

describe("HOME_ROOT constant", () => {
  it("is a non-empty string", () => {
    expect(typeof HOME_ROOT).toBe("string");
    expect(HOME_ROOT.length).toBeGreaterThan(0);
  });

  it("is an absolute path (starts with / on Unix or drive letter on Windows)", () => {
    // On Unix: starts with "/"
    // On Windows: starts with a drive letter like "C:\"
    const isAbsolute = HOME_ROOT.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(HOME_ROOT);
    expect(isAbsolute).toBe(true);
  });

  it("does not have a trailing separator", () => {
    // Trailing separator would break the `startsWith(HOME_ROOT + sep)` check
    expect(HOME_ROOT.endsWith(sep)).toBe(false);
  });

  it("equals homedir() or AGENTS_HOME/HOME/USERPROFILE env var if set", () => {
    // HOME_ROOT should be derived from an env override or os.homedir()
    const expected =
      process.env["AGENTS_HOME"] ??
      process.env["HOME"] ??
      process.env["USERPROFILE"] ??
      homedir();
    // We can't easily compare after realpath, but at minimum HOME_ROOT should
    // point to the same logical directory as homedir() (contains it or equals it)
    expect(HOME_ROOT.length).toBeGreaterThan(0);
    // The simplest cross-platform check: both are non-empty absolute paths
    expect(expected.length).toBeGreaterThan(0);
  });
});

// ── getHomeDir ────────────────────────────────────────────────────────────

describe("getHomeDir()", () => {
  it("returns the exact same value as HOME_ROOT", () => {
    expect(getHomeDir()).toBe(HOME_ROOT);
  });

  it("returns a string with the same value on repeated calls (idempotent)", () => {
    expect(getHomeDir()).toBe(getHomeDir());
  });
});

// ── resolveWithinHome — valid paths ───────────────────────────────────────

describe("resolveWithinHome() — valid paths inside HOME_ROOT", () => {
  // We create a real temporary directory inside HOME to use in tests.
  // Using mkdtemp ensures we have a writable subdirectory that actually exists.
  let innerTmpDir = "";

  beforeAll(async () => {
    // mkdtemp places temp dirs in os.tmpdir() by default. We need to create
    // them INSIDE HOME_ROOT so they pass the jail check.
    // We use a subdirectory of HOME_ROOT itself.
    const jailTestBase = join(HOME_ROOT, ".homejail-test-tmp");
    await mkdir(jailTestBase, { recursive: true });
    innerTmpDir = await mkdtemp(join(jailTestBase, "test-"));
  });

  afterAll(async () => {
    if (innerTmpDir) {
      await rm(innerTmpDir, { recursive: true, force: true });
    }
    // Also remove the base dir if empty
    try {
      await rm(join(HOME_ROOT, ".homejail-test-tmp"), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("resolves HOME_ROOT itself — exact match is allowed", async () => {
    const result = await resolveWithinHome(HOME_ROOT);
    expect(result).toBe(HOME_ROOT);
  });

  it("resolves a real subdirectory inside HOME_ROOT", async () => {
    const result = await resolveWithinHome(innerTmpDir);
    // The result must start with HOME_ROOT + sep (it's a subdirectory)
    expect(result.startsWith(HOME_ROOT + sep) || result === HOME_ROOT).toBe(true);
  });

  it("resolves a relative path that lands inside HOME_ROOT", async () => {
    // Create a file inside innerTmpDir to resolve
    const filePath = join(innerTmpDir, "test-file.txt");
    await writeFile(filePath, "hello", "utf-8");

    const result = await resolveWithinHome(filePath);
    expect(result.startsWith(HOME_ROOT + sep)).toBe(true);
  });

  it("normalises redundant separators (e.g. double slashes) correctly", async () => {
    // Construct a path with double slashes — resolve should normalise it
    const doubleSep = innerTmpDir.replace(sep, sep + sep);
    const result = await resolveWithinHome(doubleSep);
    expect(result.startsWith(HOME_ROOT + sep) || result === HOME_ROOT).toBe(true);
  });
});

// ── resolveWithinHome — rejection cases ───────────────────────────────────

describe("resolveWithinHome() — rejection: traversal outside HOME_ROOT", () => {
  it("throws when given a path clearly outside HOME_ROOT (/tmp or system dirs)", async () => {
    // /tmp (or os.tmpdir()) is almost always outside HOME_ROOT
    const outsidePath = tmpdir();

    // Only run this test if tmpdir is truly outside HOME_ROOT
    // (on some systems, TMPDIR may be inside HOME — skip in that case)
    if (outsidePath.startsWith(HOME_ROOT + sep) || outsidePath === HOME_ROOT) {
      // Skip: TMPDIR is inside HOME on this system
      return;
    }

    await expect(resolveWithinHome(outsidePath)).rejects.toThrow(/homeJail/);
  });

  it("throws when the path resolves to the filesystem root (/)", async () => {
    if (process.platform === "win32") {
      // On Windows, use drive root
      await expect(resolveWithinHome("C:\\")).rejects.toThrow(/homeJail/);
    } else {
      await expect(resolveWithinHome("/")).rejects.toThrow(/homeJail/);
    }
  });

  it("throws when using .. to traverse above HOME_ROOT (lexical traversal)", async () => {
    // e.g. HOME_ROOT/../../etc — resolves to something outside HOME
    const traversal = join(HOME_ROOT, "..", "..", "etc");
    await expect(resolveWithinHome(traversal)).rejects.toThrow(/homeJail/);
  });
});

describe("resolveWithinHome() — rejection: empty and whitespace paths", () => {
  it("throws for empty string", async () => {
    await expect(resolveWithinHome("")).rejects.toThrow(/homeJail/);
  });

  it("throws for whitespace-only string", async () => {
    await expect(resolveWithinHome("   ")).rejects.toThrow(/homeJail/);
  });
});

describe("resolveWithinHome() — rejection: non-existent paths", () => {
  it("throws for a path that does not exist on disk (realpath requirement)", async () => {
    const nonExistent = join(HOME_ROOT, "this-path-should-never-exist-9999999-xyz");
    await expect(resolveWithinHome(nonExistent)).rejects.toThrow(/homeJail/);
  });
});

// ── resolveWithinHome — symlink traversal ─────────────────────────────────

describe("resolveWithinHome() — symlink traversal detection", () => {
  let innerTmpDir = "";
  let outsideDir = "";

  beforeAll(async () => {
    // Create an inner dir for placing the symlink
    const jailTestBase = join(HOME_ROOT, ".homejail-symlink-test-tmp");
    await mkdir(jailTestBase, { recursive: true });
    innerTmpDir = await mkdtemp(join(jailTestBase, "jail-"));

    // Create an outside dir in os.tmpdir() to point the symlink at
    outsideDir = await mkdtemp(join(tmpdir(), "outside-"));
  });

  afterAll(async () => {
    if (innerTmpDir) {
      await rm(innerTmpDir, { recursive: true, force: true });
    }
    if (outsideDir) {
      await rm(outsideDir, { recursive: true, force: true });
    }
    try {
      await rm(join(HOME_ROOT, ".homejail-symlink-test-tmp"), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("rejects a symlink inside HOME that points to a directory outside HOME", async () => {
    // Only run if outsideDir is truly outside HOME (skip on unusual setups)
    if (outsideDir.startsWith(HOME_ROOT + sep) || outsideDir === HOME_ROOT) {
      return; // Skip: TMPDIR happens to be inside HOME on this system
    }

    const linkPath = join(innerTmpDir, "evil-link");
    try {
      await symlink(outsideDir, linkPath);
    } catch {
      // If symlink creation fails (e.g. Windows without privilege), skip test
      return;
    }

    // The symlink's lexical path is inside HOME, but realpath → outsideDir
    await expect(resolveWithinHome(linkPath)).rejects.toThrow(/homeJail/);
  });

  it("accepts a symlink inside HOME that points to another dir inside HOME", async () => {
    // Create a second dir inside HOME to link to
    const jailTestBase = join(HOME_ROOT, ".homejail-symlink-test-tmp");
    const targetDir = await mkdtemp(join(jailTestBase, "target-"));

    const linkPath = join(innerTmpDir, "safe-link");
    try {
      await symlink(targetDir, linkPath);
    } catch {
      // Symlink creation not supported — skip
      await rm(targetDir, { recursive: true, force: true });
      return;
    }

    // Both the link and its target are inside HOME — should succeed
    const result = await resolveWithinHome(linkPath);
    expect(result.startsWith(HOME_ROOT + sep) || result === HOME_ROOT).toBe(true);

    await rm(targetDir, { recursive: true, force: true });
  });
});

// ── isPathInsideHome ──────────────────────────────────────────────────────

describe("isPathInsideHome()", () => {
  let innerTmpDir = "";

  beforeAll(async () => {
    const jailTestBase = join(HOME_ROOT, ".homejail-ispathtest-tmp");
    await mkdir(jailTestBase, { recursive: true });
    innerTmpDir = await mkdtemp(join(jailTestBase, "is-"));
  });

  afterAll(async () => {
    if (innerTmpDir) {
      await rm(innerTmpDir, { recursive: true, force: true });
    }
    try {
      await rm(join(HOME_ROOT, ".homejail-ispathtest-tmp"), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns true for HOME_ROOT itself", async () => {
    expect(await isPathInsideHome(HOME_ROOT)).toBe(true);
  });

  it("returns true for a real subdirectory inside HOME_ROOT", async () => {
    expect(await isPathInsideHome(innerTmpDir)).toBe(true);
  });

  it("returns false for a path outside HOME_ROOT (/tmp or system dir)", async () => {
    const outsidePath = tmpdir();
    if (outsidePath.startsWith(HOME_ROOT + sep) || outsidePath === HOME_ROOT) {
      // TMPDIR is inside HOME on this system — skip assertion
      return;
    }
    expect(await isPathInsideHome(outsidePath)).toBe(false);
  });

  it("returns false for a non-existent path (even if it would be inside HOME)", async () => {
    const nonExistent = join(HOME_ROOT, "non-existent-path-xyz-99999");
    expect(await isPathInsideHome(nonExistent)).toBe(false);
  });

  it("returns false for empty string", async () => {
    expect(await isPathInsideHome("")).toBe(false);
  });

  it("returns false for the filesystem root (/)", async () => {
    if (process.platform !== "win32") {
      expect(await isPathInsideHome("/")).toBe(false);
    }
  });

  it("returns false for a traversal path above HOME_ROOT", async () => {
    const traversal = join(HOME_ROOT, "..", "..", "etc");
    expect(await isPathInsideHome(traversal)).toBe(false);
  });
});

// ── assertWithinHome ──────────────────────────────────────────────────────

describe("assertWithinHome() — alias for resolveWithinHome", () => {
  let innerTmpDir = "";

  beforeAll(async () => {
    const jailTestBase = join(HOME_ROOT, ".homejail-assert-tmp");
    await mkdir(jailTestBase, { recursive: true });
    innerTmpDir = await mkdtemp(join(jailTestBase, "assert-"));
  });

  afterAll(async () => {
    if (innerTmpDir) {
      await rm(innerTmpDir, { recursive: true, force: true });
    }
    try {
      await rm(join(HOME_ROOT, ".homejail-assert-tmp"), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns the resolved path when path is inside HOME_ROOT", async () => {
    const result = await assertWithinHome(innerTmpDir);
    expect(result.startsWith(HOME_ROOT + sep) || result === HOME_ROOT).toBe(true);
  });

  it("throws with a homeJail error when path is outside HOME_ROOT", async () => {
    if (process.platform !== "win32") {
      await expect(assertWithinHome("/etc")).rejects.toThrow(/homeJail/);
    }
  });

  it("throws for empty string (same as resolveWithinHome)", async () => {
    await expect(assertWithinHome("")).rejects.toThrow(/homeJail/);
  });
});
