/**
 * tests/loader/schema-validator.test.ts
 *
 * Unit tests for schema-validator.ts
 *
 * Tests:
 * - validateAfproj: valid, invalid, partial
 * - validateAdata: valid, invalid
 * - hasAfprojIdentity / hasAdataIdentity
 * - validateAdataBatch
 */

import { describe, it, expect } from "bun:test";
import {
  validateAfproj,
  validateAdata,
  validateAdataBatch,
  hasAfprojIdentity,
  hasAdataIdentity,
} from "../../src/loader/schema-validator.ts";
import { makeAfproj, makeAdataA, AGENT_A_ID, AGENT_B_ID, CONN_ID } from "./fixtures/project-factory.ts";

// ── validateAfproj ─────────────────────────────────────────────────────────

describe("validateAfproj", () => {
  it("returns success for a valid .afproj object", () => {
    const raw = makeAfproj();
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.issues).toHaveLength(0);
    expect(result.data?.name).toBe("Test Project");
  });

  it("returns errors for missing required fields", () => {
    const result = validateAfproj({}, "test.afproj");

    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("reports missing name field", () => {
    const raw = { ...makeAfproj(), name: "" };
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
    const nameIssue = result.issues.find((i) => i.message.includes("name"));
    expect(nameIssue).toBeDefined();
  });

  it("reports invalid createdAt (not ISO 8601)", () => {
    const raw = { ...makeAfproj(), createdAt: "not-a-date" };
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
    const dtIssue = result.issues.find((i) => i.message.toLowerCase().includes("createdat"));
    expect(dtIssue).toBeDefined();
  });

  it("reports invalid agent UUID", () => {
    const raw = makeAfproj({
      agents: [
        {
          id: "not-a-uuid",
          name: "Agent",
          profilePath: `behaviors/not-a-uuid/profile.md`,
          adataPath: `metadata/not-a-uuid.adata`,
          isEntrypoint: true,
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });

  it("reports invalid profilePath format", () => {
    const raw = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Agent",
          profilePath: "wrong/path/file.md", // must match behaviors/<id>/profile.md
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });

  it("tags issues with the provided source path", () => {
    const result = validateAfproj({}, "my-project.afproj");
    expect(result.issues.every((i) => i.source === "my-project.afproj")).toBe(true);
  });

  it("applies default values when optional fields are missing", () => {
    const raw = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Minimal Project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = validateAfproj(raw, "min.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(1);
    expect(result.data?.agents).toEqual([]);
    expect(result.data?.connections).toEqual([]);
    expect(result.data?.properties).toEqual({});
  });
});

// ── validateAdata ──────────────────────────────────────────────────────────

describe("validateAdata", () => {
  it("returns success for a valid .adata object", () => {
    const raw = makeAdataA();
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.issues).toHaveLength(0);
    expect(result.data?.agentId).toBe(AGENT_A_ID);
  });

  it("reports missing agentId", () => {
    const { agentId: _removed, ...rawNoId } = makeAdataA();
    const result = validateAdata(rawNoId, "metadata/test.adata");

    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.message.toLowerCase().includes("agentid"))).toBe(true);
  });

  it("reports invalid agentId (not UUID)", () => {
    const raw = { ...makeAdataA(), agentId: "not-a-uuid" };
    const result = validateAdata(raw, "metadata/test.adata");

    expect(result.success).toBe(false);
  });

  it("reports invalid aspect filePath format", () => {
    const raw = makeAdataA({
      aspects: [
        {
          id: "bad-aspect",
          name: "Bad Aspect",
          filePath: "wrong/path/aspect.md", // must match behaviors/<agentId>/<name>.md
          order: 0,
          enabled: true,
          metadata: {},
        },
      ],
    });
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(false);
  });

  it("reports invalid skill filePath format", () => {
    const raw = makeAdataA({
      skills: [
        {
          id: "bad-skill",
          name: "Bad Skill",
          filePath: "wrong/skill.md", // must match skills/<name>.md
          enabled: true,
        },
      ],
    });
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const raw = {
      agentId: AGENT_A_ID,
      agentName: "test-agent",
      profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(true);
    expect(result.data?.aspects).toEqual([]);
    expect(result.data?.skills).toEqual([]);
    expect(result.data?.subagents).toEqual([]);
    expect(result.data?.metadata).toEqual({});
  });
});

// ── validateAdataBatch ─────────────────────────────────────────────────────

describe("validateAdataBatch", () => {
  it("validates multiple .adata files and aggregates issues", () => {
    const entries: Array<[string, unknown]> = [
      [`metadata/${AGENT_A_ID}.adata`, makeAdataA()],
      [`metadata/${AGENT_B_ID}.adata`, {}], // invalid
    ];

    const { results, allIssues } = validateAdataBatch(entries);

    expect(results.size).toBe(2);
    expect(results.get(`metadata/${AGENT_A_ID}.adata`)?.success).toBe(true);
    expect(results.get(`metadata/${AGENT_B_ID}.adata`)?.success).toBe(false);
    expect(allIssues.length).toBeGreaterThan(0);
  });

  it("returns empty issues when all entries are valid", () => {
    const entries: Array<[string, unknown]> = [
      [`metadata/${AGENT_A_ID}.adata`, makeAdataA()],
    ];

    const { allIssues } = validateAdataBatch(entries);
    expect(allIssues).toHaveLength(0);
  });
});

// ── Identity checks ────────────────────────────────────────────────────────

describe("hasAfprojIdentity", () => {
  it("returns true for object with name and version", () => {
    expect(hasAfprojIdentity({ name: "Test", version: 1 })).toBe(true);
  });

  it("returns false for object missing name", () => {
    expect(hasAfprojIdentity({ version: 1 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasAfprojIdentity(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(hasAfprojIdentity("string")).toBe(false);
    expect(hasAfprojIdentity(42)).toBe(false);
  });
});

describe("hasAdataIdentity", () => {
  it("returns true for object with agentId and version", () => {
    expect(hasAdataIdentity({ agentId: AGENT_A_ID, version: 1 })).toBe(true);
  });

  it("returns false for object missing agentId", () => {
    expect(hasAdataIdentity({ version: 1 })).toBe(false);
  });

  it("returns false for empty agentId string", () => {
    expect(hasAdataIdentity({ agentId: "", version: 1 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasAdataIdentity(null)).toBe(false);
  });
});

// ── Slug validation in schemas ─────────────────────────────────────────────

describe("AgentRefSchema — slug-only agent name", () => {
  it("accepts a valid slug as agent name in .afproj", () => {
    const raw = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "support-agent",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.agents[0]?.name).toBe("support-agent");
  });

  it("rejects a free-text (non-slug) agent name in .afproj", () => {
    const raw = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "Support Agent",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
    const nameIssue = result.issues.find((i) => i.message.toLowerCase().includes("name"));
    expect(nameIssue).toBeDefined();
  });

  it("rejects an agent name with uppercase letters in .afproj", () => {
    const raw = makeAfproj({
      agents: [
        {
          id: AGENT_A_ID,
          name: "SupportAgent",
          profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
          adataPath: `metadata/${AGENT_A_ID}.adata`,
          isEntrypoint: true,
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });
});

describe("AdataSchema — slug-only agentName", () => {
  it("accepts a valid slug as agentName in .adata", () => {
    const raw = { ...makeAdataA(), agentName: "support-agent" };
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(true);
    expect(result.data?.agentName).toBe("support-agent");
  });

  it("rejects a free-text (non-slug) agentName in .adata", () => {
    const raw = { ...makeAdataA(), agentName: "Support Agent" };
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(false);
    const nameIssue = result.issues.find((i) => i.message.toLowerCase().includes("agentname"));
    expect(nameIssue).toBeDefined();
  });

  it("rejects agentName with uppercase in .adata", () => {
    const raw = { ...makeAdataA(), agentName: "SupportAgent" };
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(false);
  });
});

// ── ConnectionSchema — user-node as endpoint ───────────────────────────────

describe("ConnectionSchema — user-node as connection endpoint", () => {
  it("accepts 'user-node' as fromAgentId in a connection", () => {
    const raw = makeAfproj({
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
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.connections[0]?.fromAgentId).toBe("user-node");
  });

  it("accepts 'user-node' as toAgentId in a connection", () => {
    const raw = makeAfproj({
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
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.connections[0]?.toAgentId).toBe("user-node");
  });

  it("rejects a non-UUID non-slug value as connection endpoint", () => {
    const raw = makeAfproj({
      connections: [
        {
          id: CONN_ID,
          fromAgentId: "Not A Valid ID!", // invalid
          toAgentId: AGENT_A_ID,
          type: "default",
          metadata: {},
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });

  it("rejects an empty string as connection endpoint", () => {
    const raw = makeAfproj({
      connections: [
        {
          id: CONN_ID,
          fromAgentId: AGENT_A_ID,
          toAgentId: "", // empty
          type: "default",
          metadata: {},
        },
      ],
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });
});

// ── AfprojSchema — user object ─────────────────────────────────────────────

describe("AfprojSchema — user object", () => {
  it("accepts a valid user object with user_id 'user-node' and position", () => {
    const raw = makeAfproj({
      user: { user_id: "user-node", position: { x: 120, y: 300 } },
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.user?.user_id).toBe("user-node");
    expect(result.data?.user?.position).toEqual({ x: 120, y: 300 });
  });

  it("accepts a user object without position (position is optional)", () => {
    const raw = makeAfproj({
      user: { user_id: "user-node" },
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.user?.user_id).toBe("user-node");
    expect(result.data?.user?.position).toBeUndefined();
  });

  it("leaves user undefined when the user field is absent (no user node on canvas)", () => {
    const raw = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Minimal Project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = validateAfproj(raw, "min.afproj");

    expect(result.success).toBe(true);
    expect(result.data?.user).toBeUndefined();
  });

  it("rejects a user object with user_id other than 'user-node'", () => {
    const raw = makeAfproj({
      // @ts-expect-error — intentionally invalid for test
      user: { user_id: "human" },
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });

  it("rejects a user object with uppercase user_id", () => {
    const raw = makeAfproj({
      // @ts-expect-error — intentionally invalid for test
      user: { user_id: "User-Node" },
    });
    const result = validateAfproj(raw, "test.afproj");

    expect(result.success).toBe(false);
  });
});

describe("SubagentDeclSchema — slug-only subagent name", () => {
  it("accepts a valid slug as subagent name", () => {
    const raw = makeAdataA({
      subagents: [
        {
          id: "d4e5f6a7-b8c9-0123-defa-123456789003",
          name: "ticket-classifier",
          description: "Classifies tickets",
          profilePath: `behaviors/${AGENT_A_ID}/classifier-subagent.md`,
          aspects: [],
          skills: [],
          metadata: {},
        },
      ],
    });
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(true);
  });

  it("rejects a free-text subagent name", () => {
    const raw = makeAdataA({
      subagents: [
        {
          id: "d4e5f6a7-b8c9-0123-defa-123456789003",
          name: "Ticket Classifier",
          description: "Classifies tickets",
          profilePath: `behaviors/${AGENT_A_ID}/classifier-subagent.md`,
          aspects: [],
          skills: [],
          metadata: {},
        },
      ],
    });
    const result = validateAdata(raw, `metadata/${AGENT_A_ID}.adata`);

    expect(result.success).toBe(false);
  });
});
