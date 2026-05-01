/**
 * tests/electron/ipc/models-api.test.ts
 *
 * Unit tests for electron-main/src/ipc/models-api.ts
 */

import { describe, it, expect } from "bun:test";
import type { IpcMain } from "electron";
import {
  handleGetModels,
  registerModelsApiHandlers,
  MODELS_API_CHANNELS,
  type ModelsApiDeps,
} from "../../../electron-main/src/ipc/models-api.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PATH = "/fake/models/api/models.dev.json";
const FAKE_DATA = { models: [{ id: "gpt-4" }] };
const fakeEvent = {} as Electron.IpcMainInvokeEvent;

/** Builds a deps object with sensible defaults, overridable per-test. */
function makeDeps(overrides: Partial<ModelsApiDeps> = {}): ModelsApiDeps {
  return {
    getCacheFilePath: () => FAKE_PATH,
    isCacheStale: async () => false,
    downloadAndSave: async () => {},
    readCacheFile: async () => FAKE_DATA,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleGetModels", () => {
  it("returns status 'fresh' when cache is not stale", async () => {
    const deps = makeDeps({ isCacheStale: async () => false });

    const result = await handleGetModels(fakeEvent, deps);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("fresh");
    expect(result.data).toEqual(FAKE_DATA);
    expect(result.error).toBeUndefined();
  });

  it("returns status 'downloaded' when cache is stale and download succeeds", async () => {
    const deps = makeDeps({
      isCacheStale: async () => true,
      downloadAndSave: async () => {},
      readCacheFile: async () => FAKE_DATA,
    });

    const result = await handleGetModels(fakeEvent, deps);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("downloaded");
    expect(result.data).toEqual(FAKE_DATA);
  });

  it("returns status 'fallback' when cache is stale, download fails, but old cache exists", async () => {
    const OLD_DATA = { models: [{ id: "old-model" }] };
    const deps = makeDeps({
      isCacheStale: async () => true,
      downloadAndSave: async () => { throw new Error("Network error"); },
      readCacheFile: async () => OLD_DATA,
    });

    const result = await handleGetModels(fakeEvent, deps);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("fallback");
    expect(result.data).toEqual(OLD_DATA);
    expect(result.error).toContain("Network error");
  });

  it("returns status 'unavailable' when cache is stale, download fails, and no cache exists", async () => {
    const deps = makeDeps({
      isCacheStale: async () => true,
      downloadAndSave: async () => { throw new Error("Connection refused"); },
      readCacheFile: async () => null,
    });

    const result = await handleGetModels(fakeEvent, deps);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.data).toBeNull();
    expect(result.error).toContain("Connection refused");
  });

  it("returns status 'unavailable' on unexpected error from isCacheStale", async () => {
    const deps = makeDeps({
      isCacheStale: async () => { throw new Error("Unexpected fs error"); },
    });

    const result = await handleGetModels(fakeEvent, deps);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.data).toBeNull();
  });
});

describe("registerModelsApiHandlers", () => {
  it("registers the GET_MODELS channel on ipcMain", () => {
    const registeredChannels: string[] = [];
    const mockIpcMain = {
      handle: (channel: string, _fn: unknown) => {
        registeredChannels.push(channel);
      },
    } as unknown as IpcMain;

    registerModelsApiHandlers(mockIpcMain);

    expect(registeredChannels).toContain(MODELS_API_CHANNELS.GET_MODELS);
    expect(registeredChannels).toHaveLength(1);
  });
});
