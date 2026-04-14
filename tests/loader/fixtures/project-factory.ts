/**
 * tests/loader/fixtures/project-factory.ts
 *
 * Factory functions to create valid AgentFlow project structures on disk
 * for use in integration tests. Creates temporary directories with all
 * required files populated.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Afproj } from "../../../src/schemas/afproj.schema.ts";
import type { Adata } from "../../../src/schemas/adata.schema.ts";

// ── Fixture data ───────────────────────────────────────────────────────────

export const AGENT_A_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const AGENT_B_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
export const CONN_ID = "c3d4e5f6-a7b8-9012-cdef-012345678902";
export const SUBAGENT_ID = "d4e5f6a7-b8c9-0123-defa-123456789003";

export function makeAfproj(overrides: Partial<Afproj> = {}): Afproj {
  const now = "2026-04-06T10:00:00.000Z";
  return {
    version: 1,
    id: "f1e2d3c4-b5a6-7890-1234-567890abcdef",
    name: "Test Project",
    description: "Integration test project",
    user: { user_id: "user-node", position: { x: 100, y: 100 } },
    agents: [
      {
        id: AGENT_A_ID,
        name: "support-agent",
        profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
        adataPath: `metadata/${AGENT_A_ID}.adata`,
        isEntrypoint: true,
        position: { x: 100, y: 200 },
      },
      {
        id: AGENT_B_ID,
        name: "classifier-agent",
        profilePath: `behaviors/${AGENT_B_ID}/profile.md`,
        adataPath: `metadata/${AGENT_B_ID}.adata`,
        isEntrypoint: false,
      },
    ],
    connections: [
      {
        id: CONN_ID,
        fromAgentId: AGENT_A_ID,
        toAgentId: AGENT_B_ID,
        type: "default",
        metadata: {},
      },
    ],
    properties: { author: "test" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeAdataA(overrides: Partial<Adata> = {}): Adata {
  const now = "2026-04-06T10:00:00.000Z";
  return {
    version: 1,
    agentId: AGENT_A_ID,
    agentName: "support-agent",
    description: "Handles support tickets",
    aspects: [
      {
        id: "tone",
        name: "Tone",
        filePath: `behaviors/${AGENT_A_ID}/tone.md`,
        order: 0,
        enabled: true,
        metadata: {},
      },
    ],
    skills: [
      {
        id: "kb-search",
        name: "KB Search",
        filePath: "skills/kb-search.md",
        enabled: true,
      },
    ],
    subagents: [
      {
        id: SUBAGENT_ID,
        name: "ticket-classifier",
        description: "Classifies tickets",
        profilePath: `behaviors/${AGENT_A_ID}/classifier-subagent.md`,
        aspects: [],
        skills: [],
        metadata: {},
      },
    ],
    profilePath: `behaviors/${AGENT_A_ID}/profile.md`,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeAdataB(overrides: Partial<Adata> = {}): Adata {
  const now = "2026-04-06T10:00:00.000Z";
  return {
    version: 1,
    agentId: AGENT_B_ID,
    agentName: "classifier-agent",
    description: "Routes tickets",
    aspects: [
      {
        id: "classification-rules",
        name: "Classification Rules",
        filePath: `behaviors/${AGENT_B_ID}/classification-rules.md`,
        order: 0,
        enabled: true,
        metadata: {},
      },
    ],
    skills: [],
    subagents: [],
    profilePath: `behaviors/${AGENT_B_ID}/profile.md`,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Project directory builder ──────────────────────────────────────────────

export interface ProjectFixture {
  projectDir: string;
  afprojPath: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a complete valid project directory structure in a temp folder.
 */
export async function createProjectFixture(options: {
  afproj?: Partial<Afproj>;
  adataA?: Partial<Adata>;
  adataB?: Partial<Adata>;
  /** If true, do NOT create the profile.md files */
  skipProfileFiles?: boolean;
  /** If true, do NOT create the aspect/skill markdown files */
  skipBehaviorFiles?: boolean;
  /**
   * If true, only create .adata files for agents that are listed in the afproj.
   * Default: false (create both agentA and agentB .adata)
   */
  onlyAfprojAgents?: boolean;
  /** Project name for the directory */
  name?: string;
} = {}): Promise<ProjectFixture> {
  const uid = randomUUID().slice(0, 8);
  const projectDir = join(tmpdir(), `agentsflow-test-${uid}`);
  const projectName = options.name ?? "test-project";

  // Create directory structure
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "behaviors", AGENT_A_ID), { recursive: true });
  await mkdir(join(projectDir, "behaviors", AGENT_B_ID), { recursive: true });
  await mkdir(join(projectDir, "skills"), { recursive: true });

  // Write .afproj
  const afproj = makeAfproj(options.afproj ?? {});
  const afprojPath = join(projectDir, `${projectName}.afproj`);
  await writeFile(afprojPath, JSON.stringify(afproj, null, 2), "utf-8");

  // Determine which agent IDs are in the .afproj
  const afprojAgentIds = new Set(afproj.agents.map((a) => a.id));

  // Write .adata files
  const shouldWriteA = !options.onlyAfprojAgents || afprojAgentIds.has(AGENT_A_ID);
  const shouldWriteB = !options.onlyAfprojAgents || afprojAgentIds.has(AGENT_B_ID);

  if (shouldWriteA) {
    const adataA = makeAdataA(options.adataA ?? {});
    await writeFile(
      join(projectDir, "metadata", `${AGENT_A_ID}.adata`),
      JSON.stringify(adataA, null, 2),
      "utf-8"
    );
  }

  if (shouldWriteB) {
    const adataB = makeAdataB(options.adataB ?? {});
    await writeFile(
      join(projectDir, "metadata", `${AGENT_B_ID}.adata`),
      JSON.stringify(adataB, null, 2),
      "utf-8"
    );
  }

  // Write profile.md files
  if (!options.skipProfileFiles) {
    if (shouldWriteA) {
      await writeFile(
        join(projectDir, "behaviors", AGENT_A_ID, "profile.md"),
        `# Support Agent\n\nYou are a helpful support agent.\n`,
        "utf-8"
      );
    }
    if (shouldWriteB) {
      await writeFile(
        join(projectDir, "behaviors", AGENT_B_ID, "profile.md"),
        `# Classifier Agent\n\nYou classify support tickets.\n`,
        "utf-8"
      );
    }
  }

  // Write behaviors/ markdown files
  if (!options.skipBehaviorFiles) {
    if (shouldWriteA) {
      await writeFile(
        join(projectDir, "behaviors", AGENT_A_ID, "tone.md"),
        `## Tone\n\nBe friendly and concise.\n`,
        "utf-8"
      );
      await writeFile(
        join(projectDir, "behaviors", AGENT_A_ID, "classifier-subagent.md"),
        `## Classifier Subagent\n\nClassify tickets.\n`,
        "utf-8"
      );
    }
    if (shouldWriteB) {
      await writeFile(
        join(projectDir, "behaviors", AGENT_B_ID, "classification-rules.md"),
        `## Classification Rules\n\nUse these rules.\n`,
        "utf-8"
      );
    }
    // Skills are shared — always write if not skipBehaviorFiles
    await writeFile(
      join(projectDir, "skills", "kb-search.md"),
      `## Knowledge Base Search\n\nSearch the KB.\n`,
      "utf-8"
    );
  }

  return {
    projectDir,
    afprojPath,
    cleanup: async () => {
      await rm(projectDir, { recursive: true, force: true });
    },
  };
}
