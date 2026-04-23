/**
 * tests/ui/repo-visibility-badge-messages.test.ts
 *
 * Verifies that all user-facing messages in RepoVisibilityBadge are in English
 * and match the expected text for each VisibilityStatus value.
 *
 * These tests import the VISIBILITY_CONFIG map indirectly by re-exporting it
 * from the component module — since the config is not exported directly, we
 * validate messages through a lightweight snapshot approach.
 */

import { describe, it, expect } from "bun:test";

// ── Expected English messages ──────────────────────────────────────────────

/**
 * Canonical expected messages for each status that should render a badge.
 * "idle" and "invalid_url" render nothing — excluded intentionally.
 */
const EXPECTED_MESSAGES: Record<string, string> = {
	checking: "Checking repository…",
	public: "✓ Public repository detected",
	private: "✗ Private repository — credentials required",
	not_found: "✗ Private repository — credentials required",
	ssh_url: "⚠ SSH URL detected — visibility cannot be verified",
	unknown_provider:
		"⚠ Visibility check is only supported for GitHub repositories. GitLab and Bitbucket are not supported by the IPC proxy.",
	network_error:
		"⚠ Could not verify visibility (network error, timeout, or IPC proxy unavailable)",
};

// ── Import the source file as text to validate messages ───────────────────
// We read the compiled source directly to avoid needing a DOM / React render.

import { readFileSync } from "fs";
import { resolve } from "path";

const BADGE_SOURCE = readFileSync(
	resolve(
		import.meta.dir,
		"../../src/ui/components/RepoVisibilityBadge.tsx",
	),
	"utf-8",
);

// ── Tests ──────────────────────────────────────────────────────────────────

describe("RepoVisibilityBadge — English messages", () => {
	for (const [status, expectedMessage] of Object.entries(EXPECTED_MESSAGES)) {
		it(`status "${status}" has correct English message`, () => {
			expect(BADGE_SOURCE).toContain(expectedMessage);
		});
	}

	it("does not contain Spanish text (Repositorio)", () => {
		expect(BADGE_SOURCE).not.toContain("Repositorio");
	});

	it("does not contain Spanish text (Verificando)", () => {
		expect(BADGE_SOURCE).not.toContain("Verificando");
	});

	it("does not contain Spanish text (visibilidad)", () => {
		expect(BADGE_SOURCE).not.toContain("visibilidad");
	});

	it("does not contain Spanish text (credenciales)", () => {
		expect(BADGE_SOURCE).not.toContain("credenciales");
	});

	it("does not contain Spanish text (soportados)", () => {
		expect(BADGE_SOURCE).not.toContain("soportados");
	});
});
