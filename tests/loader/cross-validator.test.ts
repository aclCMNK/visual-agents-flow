/**
 * tests/loader/cross-validator.test.ts
 *
 * Unit tests for cross-validator.ts
 *
 * Tests:
 * - Duplicate agent IDs in .afproj
 * - Missing profile/adata files
 * - Orphan .adata files (no matching AgentRef)
 * - Invalid connection endpoints
 * - Entrypoint validation (none / multiple)
 * - profilePath mismatch between AgentRef and .adata
 * - Duplicate aspect IDs
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { crossValidate, hasErrors, filterBySeverity } from "../../src/loader/cross-validator.ts";
import {
  createProjectFixture,
  makeAfproj,
  makeAdataA,
  makeAdataB,
  AGENT_A_ID,
  AGENT_B_ID,
  CONN_ID,
  type ProjectFixture,
} from "./fixtures/project-factory.ts";
import type { Afproj } from "../../src/schemas/afproj.schema.ts";
import type { Adata } from "../../src/schemas/adata.schema.ts";

// ── Setup helpers ─────────────────────────────────────────────────────────

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createProjectFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

async function runCrossValidation(
  afproj: Afproj,
  adataByAgentId: Map<string, Adata>
) {
  return crossValidate({
    afproj,
    adataByAgentId,
    projectDir: fixture.projectDir,
  });
}

// ── Valid project ─────────────────────────────────────────────────────────

describe("crossValidate — valid project", () => {
  it("returns no errors for a valid project", async () => {
    const afproj = makeAfproj();
    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    expect(hasErrors(result.issues)).toBe(false);
    expect(result.validAgentIds.has(AGENT_A_ID)).toBe(true);
    expect(result.validAgentIds.has(AGENT_B_ID)).toBe(true);
  });

  it("returns validAgentIds with all agent IDs", async () => {
    const afproj = makeAfproj();
    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);
    expect(result.validAgentIds.size).toBe(2);
  });
});

// ── Duplicate agent IDs ────────────────────────────────────────────────────

describe("crossValidate — duplicate agent IDs", () => {
  it("reports error for duplicate agent ID in .afproj", async () => {
    const afproj = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Agent A",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
        {
          id: AGENT_A_ID, // duplicate!
          name: "Agent A Duplicate",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: false,
        },
      ],
      connections: [],
    });

    const adataByAgentId = new Map<string, Adata>([[AGENT_A_ID, makeAdataA()]]);
    const result = await runCrossValidation(afproj, adataByAgentId);

    const dupError = result.issues.find((i) => i.code === "DUPLICATE_AGENT_ID");
    expect(dupError).toBeDefined();
    expect(dupError?.severity).toBe("error");
  });
});

// ── Missing files ──────────────────────────────────────────────────────────

describe("crossValidate — missing files", () => {
  it("reports error for missing profile.md", async () => {
    // Create fixture WITHOUT profile files
    const noProfileFixture = await createProjectFixture({ skipProfileFiles: true });
    try {
      const afproj = makeAfproj();
      const adataByAgentId = new Map<string, Adata>([
        [AGENT_A_ID, makeAdataA()],
        [AGENT_B_ID, makeAdataB()],
      ]);

      const result = await crossValidate({
        afproj,
        adataByAgentId,
        projectDir: noProfileFixture.projectDir,
      });

      const missingProfile = result.issues.filter((i) => i.code === "MISSING_PROFILE_FILE");
      expect(missingProfile.length).toBeGreaterThan(0);
    } finally {
      await noProfileFixture.cleanup();
    }
  });

  it("reports error for missing .adata referenced in .afproj", async () => {
    const afproj = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Support Agent",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/non-existent.adata`, // missing!
          isEntrypoint: true,
        },
      ],
      connections: [],
    });

    const adataByAgentId = new Map<string, Adata>([[AGENT_A_ID, makeAdataA()]]);
    const result = await runCrossValidation(afproj, adataByAgentId);

    const missing = result.issues.find((i) => i.code === "MISSING_ADATA_FILE");
    expect(missing).toBeDefined();
  });

  it("reports error for missing aspect file", async () => {
    const adataA = makeAdataA({
      aspects: [
        {
          id: "missing-aspect",
          name: "Missing Aspect",
          filePath: `behaviors/${AGENT_A_ID}/does-not-exist.md`, // missing!
          order: 0,
          enabled: true,
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, adataA],
      [AGENT_B_ID, makeAdataB()],
    ]);
    const result = await runCrossValidation(makeAfproj(), adataByAgentId);

    const missing = result.issues.find((i) => i.code === "MISSING_ASPECT_FILE");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("error");
  });

  it("reports error for missing skill file", async () => {
    const adataA = makeAdataA({
      skills: [
        {
          id: "missing-skill",
          name: "Missing Skill",
          filePath: "skills/does-not-exist.md", // missing!
          enabled: true,
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, adataA],
      [AGENT_B_ID, makeAdataB()],
    ]);
    const result = await runCrossValidation(makeAfproj(), adataByAgentId);

    const missing = result.issues.find((i) => i.code === "MISSING_SKILL_FILE");
    expect(missing).toBeDefined();
  });
});

// ── Orphan .adata ─────────────────────────────────────────────────────────

describe("crossValidate — orphan .adata", () => {
  it("reports error for .adata with no matching AgentRef in .afproj", async () => {
    const afproj = makeAfproj({ agents: [], connections: [] });
    const orphanId = "00000000-0000-0000-0000-000000000001";
    const adataByAgentId = new Map<string, Adata>([
      [orphanId, makeAdataA({ agentId: orphanId })],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    const orphanError = result.issues.find((i) => i.code === "ORPHAN_ADATA");
    expect(orphanError).toBeDefined();
    expect(orphanError?.severity).toBe("error");
  });
});

// ── Connection validation ─────────────────────────────────────────────────

describe("crossValidate — connections", () => {
  it("reports error for connection with unknown fromAgentId", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000099";
    const afproj = makeAfproj({
      connections: [
        {
          id: "e5f6a7b8-c9d0-1234-efab-234567890004",
          fromAgentId: unknownId, // not in agents!
          toAgentId: AGENT_B_ID,
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);
    const connError = result.issues.find((i) => i.code === "INVALID_CONNECTION_FROM");
    expect(connError).toBeDefined();
  });

  it("reports error for connection with unknown toAgentId", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000099";
    const afproj = makeAfproj({
      connections: [
        {
          id: "e5f6a7b8-c9d0-1234-efab-234567890004",
          fromAgentId: AGENT_A_ID,
          toAgentId: unknownId, // not in agents!
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);
    const connError = result.issues.find((i) => i.code === "INVALID_CONNECTION_TO");
    expect(connError).toBeDefined();
  });
});

// ── Entrypoint validation ─────────────────────────────────────────────────

describe("crossValidate — entrypoints", () => {
  it("reports warning when no agent is marked as entrypoint", async () => {
    const afproj = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Agent A",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: false, // no entrypoint!
        },
      ],
      connections: [],
    });

    const adataByAgentId = new Map<string, Adata>([[AGENT_A_ID, makeAdataA()]]);
    const result = await runCrossValidation(afproj, adataByAgentId);

    const noEpWarning = result.issues.find((i) => i.code === "NO_ENTRYPOINT");
    expect(noEpWarning).toBeDefined();
    expect(noEpWarning?.severity).toBe("warning");
  });

  it("reports error when multiple agents are marked as entrypoint", async () => {
    const afproj = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Agent A",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
        {
          id: AGENT_B_ID,
          name: "Agent B",
          profilePath: `behaviors/${AGENT_B_ID}/profile.md`,
          adataPath: `metadata/${AGENT_B_ID}.adata`,
          isEntrypoint: true, // second entrypoint!
        },
      ],
      connections: [],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);
    const multiEpError = result.issues.find((i) => i.code === "MULTIPLE_ENTRYPOINTS");
    expect(multiEpError).toBeDefined();
    expect(multiEpError?.severity).toBe("error");
  });

  it("accepts a project with no agents (empty project) with info only", async () => {
    const afproj = makeAfproj({ agents: [], connections: [] });
    const adataByAgentId = new Map<string, Adata>();

    const result = await runCrossValidation(afproj, adataByAgentId);

    expect(hasErrors(result.issues)).toBe(false);
    const infoMsg = result.issues.find((i) => i.code === "EMPTY_PROJECT");
    expect(infoMsg?.severity).toBe("info");
  });
});

// ── profilePath mismatch ──────────────────────────────────────────────────

describe("crossValidate — profilePath consistency", () => {
  it("reports error when AgentRef.profilePath differs from adata.profilePath", async () => {
    const adataA = makeAdataA({
      profilePath: `behaviors/${AGENT_A_ID}/different-profile.md`, // mismatch!
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, adataA],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(makeAfproj(), adataByAgentId);

    const mismatch = result.issues.find((i) => i.code === "PROFILE_PATH_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("error");
  });
});

// ── User node connections ─────────────────────────────────────────────────

describe("crossValidate — user node connections", () => {
  it("passes validation for a user→agent connection (user-node as fromAgentId)", async () => {
    const afproj = makeAfproj({
      user: { user_id: "user-node" },
      connections: [
        {
          id: CONN_ID,
          fromAgentId: "user-node", // canonical user node ID
          toAgentId: AGENT_A_ID,
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    const fromError = result.issues.find((i) => i.code === "INVALID_CONNECTION_FROM");
    expect(fromError).toBeUndefined();
    expect(hasErrors(result.issues)).toBe(false);
  });

  it("passes validation for an agent→user connection (user-node as toAgentId)", async () => {
    const afproj = makeAfproj({
      user: { user_id: "user-node" },
      connections: [
        {
          id: CONN_ID,
          fromAgentId: AGENT_A_ID,
          toAgentId: "user-node", // canonical user node ID
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    const toError = result.issues.find((i) => i.code === "INVALID_CONNECTION_TO");
    expect(toError).toBeUndefined();
    expect(hasErrors(result.issues)).toBe(false);
  });

  it("fails validation for an unknown slug that is not the user-node ID", async () => {
    const afproj = makeAfproj({
      user: { user_id: "user-node" },
      connections: [
        {
          id: CONN_ID,
          fromAgentId: "ghost-user", // slug but NOT "user-node"
          toAgentId: AGENT_A_ID,
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    const fromError = result.issues.find((i) => i.code === "INVALID_CONNECTION_FROM");
    expect(fromError).toBeDefined();
    expect(fromError?.severity).toBe("error");
  });

  it("fails validation when no user object is present but connection uses 'user-node'", async () => {
    const afproj = makeAfproj({
      user: undefined, // no user node in this project
      connections: [
        {
          id: CONN_ID,
          fromAgentId: "user-node", // user-node not registered
          toAgentId: AGENT_A_ID,
          type: "default",
          metadata: {},
        },
      ],
    });

    const adataByAgentId = new Map<string, Adata>([
      [AGENT_A_ID, makeAdataA()],
      [AGENT_B_ID, makeAdataB()],
    ]);

    const result = await runCrossValidation(afproj, adataByAgentId);

    const fromError = result.issues.find((i) => i.code === "INVALID_CONNECTION_FROM");
    expect(fromError).toBeDefined();
    expect(fromError?.severity).toBe("error");
  });
});

// ── filterBySeverity helper ───────────────────────────────────────────────

describe("filterBySeverity", () => {
  it("filters issues by severity correctly", () => {
    const issues = [
      { severity: "error" as const, code: "ERR", message: "err", source: "f" },
      { severity: "warning" as const, code: "WARN", message: "warn", source: "f" },
      { severity: "info" as const, code: "INFO", message: "info", source: "f" },
    ];

    expect(filterBySeverity(issues, "error")).toHaveLength(1);
    expect(filterBySeverity(issues, "warning")).toHaveLength(1);
    expect(filterBySeverity(issues, "info")).toHaveLength(1);
  });
});
