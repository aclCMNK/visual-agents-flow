/**
 * tests/renderer/components/ProjectBrowser.test.tsx
 *
 * Integration tests for the models status message logic in ProjectBrowser.
 *
 * Since @testing-library/react is not installed, we test the pure
 * deriveModelsMessage function that drives the UI integration.
 *
 * Tests cover:
 *   - Shows "Updating models data..." while loading: true
 *   - No message when status: "fresh"
 *   - Shows "Models data updated!" when status: "downloaded" (success, not dismissible)
 *   - Shows warning when status: "fallback" (not dismissible — auto-dismiss in component)
 *   - Shows error when status: "unavailable" (dismissible)
 *   - Returns null when status is null (initial state)
 */

import { describe, it, expect } from "bun:test";
import { deriveModelsMessage } from "../../../src/ui/components/ProjectBrowser.tsx";
import type { ModelsApiStatus } from "../../../src/renderer/services/models-api.ts";

describe("ProjectBrowser — models status message integration (deriveModelsMessage)", () => {
  it("shows 'Updating models data...' while loading: true", () => {
    const msg = deriveModelsMessage(true, null);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Updating models data...");
    expect(msg!.kind).toBe("info");
  });

  it("does not show any models message when status: 'fresh'", () => {
    const msg = deriveModelsMessage(false, "fresh");
    expect(msg).toBeNull();
  });

  it("shows 'Models data updated!' when status: 'downloaded'", () => {
    const msg = deriveModelsMessage(false, "downloaded");
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Models data updated!");
    expect(msg!.kind).toBe("success");
    expect(msg!.dismissible).toBe(false); // auto-dismiss handled by component
  });

  it("shows warning message when status: 'fallback'", () => {
    const msg = deriveModelsMessage(false, "fallback");
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Failed to update models data, using previous version");
    expect(msg!.kind).toBe("warning");
    expect(msg!.dismissible).toBe(false); // auto-dismiss handled by component
  });

  it("shows error message when status: 'unavailable'", () => {
    const msg = deriveModelsMessage(false, "unavailable");
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Failed to download models data. Some features may be limited.");
    expect(msg!.kind).toBe("error");
    expect(msg!.dismissible).toBe(true); // permanent until user closes
  });

  it("shows no message when status is null (initial state before hook resolves)", () => {
    const msg = deriveModelsMessage(false, null);
    expect(msg).toBeNull();
  });

  it("'unavailable' message is dismissible (user can close it)", () => {
    const msg = deriveModelsMessage(false, "unavailable");
    expect(msg!.dismissible).toBe(true);
  });

  it("'downloaded' message is NOT dismissible (auto-dismiss at 3s)", () => {
    const msg = deriveModelsMessage(false, "downloaded");
    expect(msg!.dismissible).toBe(false);
  });

  it("'fallback' message is NOT dismissible (auto-dismiss at 5s)", () => {
    const msg = deriveModelsMessage(false, "fallback");
    expect(msg!.dismissible).toBe(false);
  });
});
