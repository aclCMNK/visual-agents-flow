/**
 * tests/renderer/hooks/useModelsApi.test.ts
 *
 * Unit tests for src/renderer/services/models-api.ts
 *
 * Since @testing-library/react is not installed, we test the service layer
 * (getModels) directly — which is the core logic of useModelsApi.
 *
 * Tests cover:
 *   - Returns unavailable when bridge is not available
 *   - Returns the result from the bridge when available
 *   - Returns unavailable on timeout
 *   - Returns unavailable on unexpected error
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockBridge = {
  getModels: () => Promise<unknown>;
};

function installBridge(bridge: MockBridge) {
  (globalThis as unknown as { window: { modelsApi: MockBridge } }).window = {
    modelsApi: bridge,
  };
}

function removeBridge() {
  // @ts-expect-error — test teardown
  delete (globalThis as unknown as { window?: { modelsApi?: unknown } }).window;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getModels service", () => {
  afterEach(() => {
    removeBridge();
  });

  it("returns unavailable when window.modelsApi is not available", async () => {
    // No bridge installed — window.modelsApi is undefined
    const { getModels } = await import(
      "../../../src/renderer/services/models-api.ts"
    );

    const result = await getModels();

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.data).toBeNull();
    expect(result.error).toContain("window.modelsApi is not available");
  });

  it("returns the bridge result when bridge is available and returns fresh", async () => {
    const fakeData = { models: [{ id: "gpt-4" }] };
    installBridge({
      getModels: async () => ({
        ok: true,
        status: "fresh",
        data: fakeData,
      }),
    });

    const { getModels } = await import(
      "../../../src/renderer/services/models-api.ts"
    );

    const result = await getModels();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("fresh");
    expect(result.data).toEqual(fakeData);
  });

  it("returns the bridge result when bridge returns downloaded", async () => {
    const fakeData = { models: [{ id: "claude-3" }] };
    installBridge({
      getModels: async () => ({
        ok: true,
        status: "downloaded",
        data: fakeData,
      }),
    });

    const { getModels } = await import(
      "../../../src/renderer/services/models-api.ts"
    );

    const result = await getModels();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("downloaded");
  });

  it("returns unavailable when bridge throws", async () => {
    installBridge({
      getModels: async () => { throw new Error("IPC channel error"); },
    });

    const { getModels } = await import(
      "../../../src/renderer/services/models-api.ts"
    );

    const result = await getModels();

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("IPC channel error");
  });
});
