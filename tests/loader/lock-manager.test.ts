/**
 * tests/loader/lock-manager.test.ts
 *
 * Unit tests for lock-manager.ts
 *
 * Tests:
 * - acquireLock / release
 * - atomicWriteJson: creates file with correct content
 * - atomicWriteText: creates file with correct content
 * - getLockInfo: locked / unlocked states
 * - forceReleaseLock
 * - Concurrent lock contention
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  acquireLock,
  atomicWriteJson,
  atomicWriteText,
  getLockInfo,
  forceReleaseLock,
} from "../../src/loader/lock-manager.ts";

// ── Setup ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `agentsflow-lock-test-${randomUUID().slice(0, 8)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── acquireLock ────────────────────────────────────────────────────────────

describe("acquireLock", () => {
  it("acquires and releases a lock successfully", async () => {
    const target = join(testDir, "test.json");
    const release = await acquireLock(target);

    const lockInfo = await getLockInfo(target);
    expect(lockInfo.locked).toBe(true);

    await release();

    const infoAfter = await getLockInfo(target);
    expect(infoAfter.locked).toBe(false);
  });

  it("prevents a second lock while first is held (times out)", async () => {
    const target = join(testDir, "contested.json");
    const release1 = await acquireLock(target);

    try {
      // This should fail after retries since lock is held
      const lockPromise = acquireLock(target);
      await expect(lockPromise).rejects.toThrow();
    } finally {
      await release1();
    }
  }, 10_000);

  it("breaks a stale lock and acquires successfully", async () => {
    const target = join(testDir, "stale.json");
    const lp = `${target}.lock`;

    // Write a stale lock (timestamp far in the past)
    const staleMeta = {
      pid: 99999,
      timestamp: Date.now() - 60_000, // 60s ago — well past STALE_MS
      token: randomUUID(),
    };
    await writeFile(lp, JSON.stringify(staleMeta), "utf-8");

    // Should succeed by breaking the stale lock
    const release = await acquireLock(target);
    const info = await getLockInfo(target);
    expect(info.locked).toBe(true);
    await release();
  });
});

// ── getLockInfo ────────────────────────────────────────────────────────────

describe("getLockInfo", () => {
  it("returns locked: false when no lock file exists", async () => {
    const target = join(testDir, "unlocked.json");
    const info = await getLockInfo(target);

    expect(info.locked).toBe(false);
    expect(info.stale).toBe(false);
  });

  it("returns locked: true with pid when lock is held", async () => {
    const target = join(testDir, "locked.json");
    const release = await acquireLock(target);

    try {
      const info = await getLockInfo(target);
      expect(info.locked).toBe(true);
      expect(info.pid).toBe(process.pid);
      expect(info.lockedAt).toBeInstanceOf(Date);
    } finally {
      await release();
    }
  });

  it("marks stale lock correctly", async () => {
    const target = join(testDir, "stale-info.json");
    const lp = `${target}.lock`;

    await writeFile(
      lp,
      JSON.stringify({ pid: 99999, timestamp: Date.now() - 60_000, token: "x" }),
      "utf-8"
    );

    const info = await getLockInfo(target);
    expect(info.locked).toBe(true);
    expect(info.stale).toBe(true);
  });
});

// ── forceReleaseLock ───────────────────────────────────────────────────────

describe("forceReleaseLock", () => {
  it("removes a lock file forcefully", async () => {
    const target = join(testDir, "force-release.json");
    const release = await acquireLock(target);

    // Force release (don't use the returned release fn)
    await forceReleaseLock(target);

    const info = await getLockInfo(target);
    expect(info.locked).toBe(false);

    // Cleanup the original release (should be a no-op now)
    await release();
  });

  it("does not throw when no lock exists", async () => {
    const target = join(testDir, "no-lock.json");
    // Should not throw
    await expect(forceReleaseLock(target)).resolves.toBeUndefined();
  });
});

// ── atomicWriteJson ────────────────────────────────────────────────────────

describe("atomicWriteJson", () => {
  it("writes valid JSON to a file", async () => {
    const target = join(testDir, "output.json");
    const data = { name: "Test", value: 42, nested: { arr: [1, 2, 3] } };

    await atomicWriteJson(target, data);

    const raw = await readFile(target, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  it("creates parent directories if they don't exist", async () => {
    const target = join(testDir, "deep", "nested", "output.json");
    await atomicWriteJson(target, { ok: true });

    const raw = await readFile(target, "utf-8");
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it("overwrites an existing file atomically", async () => {
    const target = join(testDir, "overwrite.json");
    await atomicWriteJson(target, { version: 1 });
    await atomicWriteJson(target, { version: 2 });

    const raw = await readFile(target, "utf-8");
    expect(JSON.parse(raw).version).toBe(2);
  });

  it("uses the specified indentation", async () => {
    const target = join(testDir, "indent.json");
    await atomicWriteJson(target, { a: 1 }, 4);

    const raw = await readFile(target, "utf-8");
    expect(raw).toContain("    \"a\""); // 4-space indent
  });

  it("does not leave a .tmp file after writing", async () => {
    const target = join(testDir, "no-tmp.json");
    await atomicWriteJson(target, { x: 1 });

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(testDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ── atomicWriteText ────────────────────────────────────────────────────────

describe("atomicWriteText", () => {
  it("writes text content to a file", async () => {
    const target = join(testDir, "profile.md");
    const content = "# My Agent\n\nSome behavior text.\n";

    await atomicWriteText(target, content);

    const read = await readFile(target, "utf-8");
    expect(read).toBe(content);
  });

  it("creates parent directories if they don't exist", async () => {
    const target = join(testDir, "behaviors", "agent-1", "profile.md");
    await atomicWriteText(target, "# Profile\n");

    const read = await readFile(target, "utf-8");
    expect(read).toBe("# Profile\n");
  });

  it("handles empty content", async () => {
    const target = join(testDir, "empty.md");
    await atomicWriteText(target, "");

    const read = await readFile(target, "utf-8");
    expect(read).toBe("");
  });
});
