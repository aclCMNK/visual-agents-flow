/**
 * tests/renderer/components/ModelsStatusMessage.test.tsx
 *
 * Unit tests for the ModelsStatusMessage component logic.
 *
 * Since @testing-library/react is not installed, we test the pure logic
 * exported from ProjectBrowser (deriveModelsMessage) which drives what
 * ModelsStatusMessage receives as props.
 *
 * Tests cover:
 *   - Returns correct text, kind, and dismissible for each status
 *   - Returns null for "fresh" and null status (silent)
 *   - Returns info message while loading
 */

import { describe, it, expect } from "bun:test";
import { deriveModelsMessage } from "../../../src/ui/components/ProjectBrowser.tsx";

describe("deriveModelsMessage", () => {
  describe("loading state", () => {
    it("returns info message while loading=true regardless of status", () => {
      const msg = deriveModelsMessage(true, null);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Updating models data...");
      expect(msg!.kind).toBe("info");
      expect(msg!.dismissible).toBe(false);
    });

    it("returns info message while loading=true even if status is 'fresh'", () => {
      const msg = deriveModelsMessage(true, "fresh");
      expect(msg).not.toBeNull();
      expect(msg!.kind).toBe("info");
    });
  });

  describe("status: fresh", () => {
    it("returns null for status 'fresh' (silent)", () => {
      const msg = deriveModelsMessage(false, "fresh");
      expect(msg).toBeNull();
    });
  });

  describe("status: null (initial state)", () => {
    it("returns null for status null", () => {
      const msg = deriveModelsMessage(false, null);
      expect(msg).toBeNull();
    });
  });

  describe("status: downloaded", () => {
    it("returns success message for status 'downloaded'", () => {
      const msg = deriveModelsMessage(false, "downloaded");
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Models data updated!");
      expect(msg!.kind).toBe("success");
      expect(msg!.dismissible).toBe(false);
    });
  });

  describe("status: fallback", () => {
    it("returns warning message for status 'fallback'", () => {
      const msg = deriveModelsMessage(false, "fallback");
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Failed to update models data, using previous version");
      expect(msg!.kind).toBe("warning");
      expect(msg!.dismissible).toBe(false);
    });
  });

  describe("status: unavailable", () => {
    it("returns error message for status 'unavailable'", () => {
      const msg = deriveModelsMessage(false, "unavailable");
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Failed to download models data. Some features may be limited.");
      expect(msg!.kind).toBe("error");
      expect(msg!.dismissible).toBe(true);
    });
  });
});
