/**
 * tests/electron/fs/models-api-cache.test.ts
 *
 * Unit tests for electron-main/src/fs/models-api-cache.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import {
  isCacheStale,
  downloadAndSave,
  readCacheFile,
  getCacheFilePath,
  MODELS_DEV_URL,
} from "../../../electron-main/src/fs/models-api-cache.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `models-api-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

// ── getCacheFilePath ──────────────────────────────────────────────────────────

describe("getCacheFilePath", () => {
  it("returns a path ending with models/api/models.dev.json", () => {
    const p = getCacheFilePath();
    expect(p).toMatch(/models[/\\]api[/\\]models\.dev\.json$/);
  });

  it("uses AGENTS_HOME env var when set", () => {
    const original = process.env["AGENTS_HOME"];
    process.env["AGENTS_HOME"] = "/custom/home";
    const p = getCacheFilePath();
    expect(p).toBe("/custom/home/models/api/models.dev.json");
    if (original === undefined) {
      delete process.env["AGENTS_HOME"];
    } else {
      process.env["AGENTS_HOME"] = original;
    }
  });
});

// ── isCacheStale ──────────────────────────────────────────────────────────────

describe("isCacheStale", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true for a non-existent file", async () => {
    const result = await isCacheStale(join(tmpDir, "nonexistent.json"));
    expect(result).toBe(true);
  });

  it("returns false for a file modified 4 days ago", async () => {
    const filePath = join(tmpDir, "cache.json");
    await writeFile(filePath, "{}", "utf-8");
    const fourDaysAgo = new Date(Date.now() - FOUR_DAYS_MS);
    await utimes(filePath, fourDaysAgo, fourDaysAgo);

    const result = await isCacheStale(filePath);
    expect(result).toBe(false);
  });

  it("returns true for a file modified exactly 5 days ago", async () => {
    const filePath = join(tmpDir, "cache.json");
    await writeFile(filePath, "{}", "utf-8");
    const fiveDaysAgo = new Date(Date.now() - FIVE_DAYS_MS);
    await utimes(filePath, fiveDaysAgo, fiveDaysAgo);

    const result = await isCacheStale(filePath);
    expect(result).toBe(true);
  });

  it("returns true for a file modified 6 days ago", async () => {
    const filePath = join(tmpDir, "cache.json");
    await writeFile(filePath, "{}", "utf-8");
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await utimes(filePath, sixDaysAgo, sixDaysAgo);

    const result = await isCacheStale(filePath);
    expect(result).toBe(true);
  });

  it("returns false for a file just created (mtime = now)", async () => {
    const filePath = join(tmpDir, "cache.json");
    await writeFile(filePath, "{}", "utf-8");

    const result = await isCacheStale(filePath);
    expect(result).toBe(false);
  });
});

// ── downloadAndSave ───────────────────────────────────────────────────────────

describe("downloadAndSave", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    // Restore global fetch
    (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  const originalFetch = globalThis.fetch;

  it("writes the JSON file on a successful fetch", async () => {
    const filePath = join(tmpDir, "models.dev.json");
    const mockData = { models: [{ id: "gpt-4" }] };

    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(mockData),
    });

    await downloadAndSave(filePath);

    const written = await readCacheFile(filePath);
    expect(written).toEqual(mockData);
  });

  it("creates parent directories if they do not exist", async () => {
    const filePath = join(tmpDir, "nested", "deep", "models.dev.json");
    const mockData = { models: [] };

    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(mockData),
    });

    await downloadAndSave(filePath);

    const written = await readCacheFile(filePath);
    expect(written).toEqual(mockData);
  });

  it("throws on HTTP 500 response", async () => {
    const filePath = join(tmpDir, "models.dev.json");

    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "error",
    });

    await expect(downloadAndSave(filePath)).rejects.toThrow("HTTP 500");
  });

  it("throws when fetch rejects (no network)", async () => {
    const filePath = join(tmpDir, "models.dev.json");

    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    await expect(downloadAndSave(filePath)).rejects.toThrow("ECONNREFUSED");
  });

  it("throws when response body is not valid JSON", async () => {
    const filePath = join(tmpDir, "models.dev.json");

    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "<html>Error page</html>",
    });

    await expect(downloadAndSave(filePath)).rejects.toThrow("not valid JSON");
  });
});

// ── readCacheFile ─────────────────────────────────────────────────────────────

describe("readCacheFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the parsed object for a valid JSON file", async () => {
    const filePath = join(tmpDir, "cache.json");
    const data = { models: [{ id: "claude-3" }] };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readCacheFile(filePath);
    expect(result).toEqual(data);
  });

  it("returns null for a non-existent file", async () => {
    const result = await readCacheFile(join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("returns null for a file with invalid JSON (does not throw)", async () => {
    const filePath = join(tmpDir, "bad.json");
    await writeFile(filePath, "not json at all {{{", "utf-8");

    const result = await readCacheFile(filePath);
    expect(result).toBeNull();
  });

  it("returns null for an empty file", async () => {
    const filePath = join(tmpDir, "empty.json");
    await writeFile(filePath, "", "utf-8");

    const result = await readCacheFile(filePath);
    expect(result).toBeNull();
  });
});
