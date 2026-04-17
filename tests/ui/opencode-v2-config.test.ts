/**
 * tests/ui/opencode-v2-config.test.ts
 *
 * Unit tests for the OpenCode V2 config builder:
 *   - buildOpenCodeV2AgentEntry
 *   - buildOpenCodeV2Config
 *   - serializeOpenCodeV2Output
 *   - OPENCODE_V2_WATCHER_IGNORE constant
 */

import { describe, it, expect } from "bun:test";
import {
  buildOpenCodeV2AgentEntry,
  buildOpenCodeV2Config,
  serializeOpenCodeV2Output,
  OPENCODE_V2_WATCHER_IGNORE,
  makeDefaultOpenCodeConfig,
} from "../../src/ui/components/ExportModal/export-logic.ts";
import type {
  AgentExportSnapshot,
  OpenCodeExportConfig,
} from "../../src/ui/components/ExportModal/export-logic.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

const makeAgent = (overrides: Partial<AgentExportSnapshot> = {}): AgentExportSnapshot => ({
  id: "agent-uuid-1",
  name: "my-agent",
  description: "A test agent",
  isOrchestrator: false,
  profileContent: "",
  agentType: "Agent",
  adataProperties: {
    opencode: {
      provider: "anthropic",
      model: "claude-3-5",
      temperature: 0.7,
      hidden: false,
      steps: 14,
      color: "#aabbcc",
    },
  },
  ...overrides,
});

const makeConfig = (overrides: Partial<OpenCodeExportConfig> = {}): OpenCodeExportConfig => ({
  ...makeDefaultOpenCodeConfig(),
  ...overrides,
});

// ── OPENCODE_V2_WATCHER_IGNORE ─────────────────────────────────────────────

describe("OPENCODE_V2_WATCHER_IGNORE", () => {
  it("contains node_modules/**", () => {
    expect(OPENCODE_V2_WATCHER_IGNORE).toContain("node_modules/**");
  });

  it("contains dist/**", () => {
    expect(OPENCODE_V2_WATCHER_IGNORE).toContain("dist/**");
  });

  it("contains .git/**", () => {
    expect(OPENCODE_V2_WATCHER_IGNORE).toContain(".git/**");
  });

  it("has exactly 3 entries", () => {
    expect(OPENCODE_V2_WATCHER_IGNORE.length).toBe(3);
  });
});

// ── buildOpenCodeV2AgentEntry — mode ───────────────────────────────────────

describe("buildOpenCodeV2AgentEntry — mode from agentType", () => {
  it("mode is 'primary' when agentType is Agent", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ agentType: "Agent" }), "proj");
    expect(result["my-agent"]!.mode).toBe("primary");
  });

  it("mode is 'subagent' when agentType is Sub-Agent", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ agentType: "Sub-Agent" }), "proj");
    expect(result["my-agent"]!.mode).toBe("subagent");
  });

  it("mode is independent of isOrchestrator", () => {
    // Even if isOrchestrator=true, mode depends on agentType
    const resultA = buildOpenCodeV2AgentEntry(
      makeAgent({ agentType: "Sub-Agent", isOrchestrator: true }),
      "proj",
    );
    expect(resultA["my-agent"]!.mode).toBe("subagent");

    const resultB = buildOpenCodeV2AgentEntry(
      makeAgent({ agentType: "Agent", isOrchestrator: false }),
      "proj",
    );
    expect(resultB["my-agent"]!.mode).toBe("primary");
  });
});

// ── buildOpenCodeV2AgentEntry — prompt ────────────────────────────────────

describe("buildOpenCodeV2AgentEntry — prompt path", () => {
  it("uses 'prompts' (plural) directory", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "my-agent" }), "my-project");
    expect(result["my-agent"]!.prompt).toBe("{file:./prompts/my-project/my-agent.md}");
  });

  it("project name is lowercased but agentName is verbatim", () => {
    // agentName stays verbatim; only the project folder segment is lowercased
    const agent = makeAgent({ name: "My Agent" });
    const result = buildOpenCodeV2AgentEntry(agent, "My Project");
    expect(result["My Agent"]!.prompt).toBe("{file:./prompts/my project/My Agent.md}");
  });

  it("project name is lowercased — spaces and accents preserved except case", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "worker" }), "Drass MemorIA");
    expect(result["worker"]!.prompt).toBe("{file:./prompts/drass memoria/worker.md}");
  });

  it("agentName is the top-level key (verbatim)", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "Research-Agent" }), "proj");
    expect(Object.keys(result)).toEqual(["Research-Agent"]);
  });

  it("DevTeam_1 project → folder lowercased, agent file verbatim", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "El Jefe" }), "DevTeam_1");
    expect(result["El Jefe"]!.prompt).toBe("{file:./prompts/devteam_1/El Jefe.md}");
  });

  it("project with hyphens → only lowercased", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "Sub-Worker" }), "My-Project-X");
    expect(result["Sub-Worker"]!.prompt).toBe("{file:./prompts/my-project-x/Sub-Worker.md}");
  });

  it("project with accented chars → only lowercased", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "Coordinador" }), "ÉquipoÁgil");
    expect(result["Coordinador"]!.prompt).toBe("{file:./prompts/équipoágil/Coordinador.md}");
  });

  it("agent name with accents stays verbatim", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent({ name: "Agénte Líder" }), "DevTeam_1");
    expect(result["Agénte Líder"]!.prompt).toBe("{file:./prompts/devteam_1/Agénte Líder.md}");
  });
});

// ── buildOpenCodeV2AgentEntry — model ─────────────────────────────────────

describe("buildOpenCodeV2AgentEntry — model", () => {
  it("model is 'provider/model' in lowercase", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "Anthropic", model: "Claude-3-5" } } }),
      "proj",
    );
    expect(result["my-agent"]!.model).toBe("anthropic/claude-3-5");
  });

  it("model is lowercased when only model is set", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "", model: "GPT-4o" } } }),
      "proj",
    );
    expect(result["my-agent"]!.model).toBe("gpt-4o");
  });

  it("model is empty string when both are absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.model).toBe("");
  });
});

// ── buildOpenCodeV2AgentEntry — temperature ───────────────────────────────

describe("buildOpenCodeV2AgentEntry — temperature", () => {
  it("uses temperature from adata", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { temperature: 0.42 } } }),
      "proj",
    );
    expect(result["my-agent"]!.temperature).toBe(0.42);
  });

  it("defaults to 0.05 when temperature is absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.temperature).toBe(0.05);
  });
});

// ── buildOpenCodeV2AgentEntry — step ──────────────────────────────────────

describe("buildOpenCodeV2AgentEntry — step (always present)", () => {
  it("uses steps value from adata", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { steps: 20 } } }),
      "proj",
    );
    expect(result["my-agent"]!.step).toBe(20);
  });

  it("defaults to 7 when steps is absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.step).toBe(7);
  });

  it("defaults to 7 when steps is null", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { steps: null } } }),
      "proj",
    );
    expect(result["my-agent"]!.step).toBe(7);
  });

  it("step is always a number (never undefined)", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: {} }),
      "proj",
    );
    expect(typeof result["my-agent"]!.step).toBe("number");
  });
});

// ── buildOpenCodeV2AgentEntry — permission ────────────────────────────────

describe("buildOpenCodeV2AgentEntry — permission (always present)", () => {
  it("includes permission when adata has permissions", () => {
    const perms = { Bash: { run: "allow" as const } };
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {}, permissions: perms } }),
      "proj",
    );
    expect(result["my-agent"]!.permission).toEqual(perms);
  });

  it("permission is {} when adata has no permissions", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.permission).toEqual({});
  });

  it("permission is {} when adata.permissions is empty object", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {}, permissions: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.permission).toEqual({});
  });

  it("permission key is always present (never undefined)", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent(), "proj");
    expect("permission" in result["my-agent"]!).toBe(true);
  });
});

// ── buildOpenCodeV2AgentEntry — color ────────────────────────────────────

describe("buildOpenCodeV2AgentEntry — color", () => {
  it("uses color from adata", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { color: "#ff0000" } } }),
      "proj",
    );
    expect(result["my-agent"]!.color).toBe("#ff0000");
  });

  it("defaults to #ffffff when color is absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: {} } }),
      "proj",
    );
    expect(result["my-agent"]!.color).toBe("#ffffff");
  });
});

// ── buildOpenCodeV2AgentEntry — enabled ───────────────────────────────────

describe("buildOpenCodeV2AgentEntry — enabled", () => {
  it("enabled is always true", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent(), "proj");
    expect(result["my-agent"]!.enabled).toBe(true);
  });
});

// ── buildOpenCodeV2AgentEntry — throws on empty name ──────────────────────

describe("buildOpenCodeV2AgentEntry — validation", () => {
  it("throws when agentName is empty", () => {
    expect(() =>
      buildOpenCodeV2AgentEntry(makeAgent({ name: "" }), "proj"),
    ).toThrow();
  });
});

// ── buildOpenCodeV2AgentEntry — exact field set ───────────────────────────

describe("buildOpenCodeV2AgentEntry — no extra / no missing fields", () => {
  it("entry has exactly the required 10 fields (including hidden)", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent(), "proj");
    const entry  = result["my-agent"]!;
    const keys   = Object.keys(entry).sort();
    expect(keys).toEqual(
      ["color", "description", "enabled", "hidden", "mode", "model", "permission", "prompt", "step", "temperature"].sort(),
    );
  });

  it("serializes cleanly to JSON (no undefined values)", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent(), "proj");
    const json   = JSON.parse(JSON.stringify(result));
    const entry  = json["my-agent"];
    expect(entry).toBeDefined();
    expect(entry.step).toBeDefined();
    expect(entry.permission).toBeDefined();
    expect(entry.color).toBeDefined();
  });
});

// ── buildOpenCodeV2Config — top-level structure ───────────────────────────

describe("buildOpenCodeV2Config — top-level structure", () => {
  it("output has $schema field", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "my-proj");
    expect(out.$schema).toBeTruthy();
  });

  it("$schema defaults to opencode.ai/config.json when schemaUrl is empty", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig({ schemaUrl: "" }), "proj");
    expect(out.$schema).toBe("https://opencode.ai/config.json");
  });

  it("$schema is the configured URL when set", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ schemaUrl: "https://example.com/schema.json" }),
      "proj",
    );
    expect(out.$schema).toBe("https://example.com/schema.json");
  });

  it("default_agent is empty string when no default is set", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(out.default_agent).toBe("");
  });

  it("default_agent is verbatim agent name when defaultAgentId matches", () => {
    const agent = makeAgent({ id: "abc-uuid", name: "My Orchestrator" });
    const out   = buildOpenCodeV2Config(
      [agent],
      makeConfig({ defaultAgentId: "abc-uuid" }),
      "proj",
    );
    expect(out.default_agent).toBe("My Orchestrator");
  });

  it("autoupdate is true when autoUpdate is true", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig({ autoUpdate: true }), "proj");
    expect(out.autoupdate).toBe(true);
  });

  it("autoupdate is false when autoUpdate is false", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig({ autoUpdate: false }), "proj");
    expect(out.autoupdate).toBe(false);
  });

  it("watcher has ignore array", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(Array.isArray(out.watcher.ignore)).toBe(true);
  });

  it("watcher.ignore contains node_modules/**", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(out.watcher.ignore).toContain("node_modules/**");
  });

  it("mcp is an object", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(typeof out.mcp).toBe("object");
    expect(out.mcp).not.toBeNull();
  });

  it("mcp is always {}", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(out.mcp).toEqual({});
  });

  it("agent is an object", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(typeof out.agent).toBe("object");
  });

  it("agent object has an entry for each agent", () => {
    const agents = [
      makeAgent({ id: "a1", name: "agent-one" }),
      makeAgent({ id: "a2", name: "agent-two" }),
    ];
    const out = buildOpenCodeV2Config(agents, makeConfig(), "proj");
    expect(Object.keys(out.agent)).toContain("agent-one");
    expect(Object.keys(out.agent)).toContain("agent-two");
    expect(Object.keys(out.agent).length).toBe(2);
  });
});

// ── buildOpenCodeV2Config — plugin field ──────────────────────────────────

describe("buildOpenCodeV2Config — plugin", () => {
  it("plugin is empty array when no plugins", () => {
    const out = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    expect(out.plugin).toEqual([]);
  });

  it("plugin contains non-empty path strings", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({
        plugins: [
          { localId: "p1", path: "./plugin.js" },
          { localId: "p2", path: "/abs/path.ts" },
        ],
      }),
      "proj",
    );
    expect(out.plugin).toEqual(["./plugin.js", "/abs/path.ts"]);
  });

  it("plugin filters out empty-path entries", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({
        plugins: [
          { localId: "p1", path: "  " },
          { localId: "p2", path: "./valid.ts" },
        ],
      }),
      "proj",
    );
    expect(out.plugin).toEqual(["./valid.ts"]);
  });
});

// ── buildOpenCodeV2Config — top-level field presence ─────────────────────

describe("buildOpenCodeV2Config — all top-level fields always present", () => {
  it("output has exactly the 7 required top-level keys", () => {
    const out  = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    const keys = Object.keys(out).sort();
    expect(keys).toEqual(
      ["$schema", "agent", "autoupdate", "default_agent", "mcp", "plugin", "watcher"].sort(),
    );
  });
});

// ── buildOpenCodeV2Config — full integration example ─────────────────────

describe("buildOpenCodeV2Config — full integration snapshot", () => {
  it("produces the complete expected structure", () => {
    const agents = [
      makeAgent({
        id: "orch-id",
        name: "orchestrator",
        description: "Main orchestrator agent",
        agentType: "Agent",
        adataProperties: {
          opencode: {
            provider: "github-copilot",
            model: "claude-sonnet-4",
            temperature: 0.1,
            steps: 20,
            color: "#336699",
          },
          permissions: { Bash: { "run-scripts": "allow" as const } },
        },
      }),
      makeAgent({
        id: "sub-id",
        name: "sub-worker",
        description: "A sub-agent",
        agentType: "Sub-Agent",
        adataProperties: {
          opencode: {
            provider: "openai",
            model: "gpt-4o",
            temperature: 0.5,
            steps: 7,
            color: "#ffffff",
          },
        },
      }),
    ];

    const config = makeConfig({
      schemaUrl:      "https://opencode.ai/config.json",
      autoUpdate:     true,
      defaultAgentId: "orch-id",
      plugins: [{ localId: "p1", path: "./my-plugin.js" }],
    });

    const out = buildOpenCodeV2Config(agents, config, "my-project");

    expect(out.$schema).toBe("https://opencode.ai/config.json");
    expect(out.default_agent).toBe("orchestrator");
    expect(out.autoupdate).toBe(true);
    expect(out.watcher.ignore).toEqual(["node_modules/**", "dist/**", ".git/**"]);
    expect(out.plugin).toEqual(["./my-plugin.js"]);
    expect(out.mcp).toEqual({});

    const orch = out.agent["orchestrator"]!;
    expect(orch.enabled).toBe(true);
    expect(orch.hidden).toBe(false);
    expect(orch.mode).toBe("primary");
    expect(orch.prompt).toBe("{file:./prompts/my-project/orchestrator.md}");
    expect(orch.model).toBe("github-copilot/claude-sonnet-4");
    expect(orch.description).toBe("Main orchestrator agent");
    expect(orch.temperature).toBe(0.1);
    expect(orch.step).toBe(20);
    expect(orch.color).toBe("#336699");
    expect(orch.permission).toEqual({ Bash: { "run-scripts": "allow" } });

    const sub = out.agent["sub-worker"]!;
    expect(sub.mode).toBe("subagent");
    expect(sub.hidden).toBe(false);
    expect(sub.prompt).toBe("{file:./prompts/my-project/sub-worker.md}");
    expect(sub.model).toBe("openai/gpt-4o");
    expect(sub.permission).toEqual({});
  });
});

// ── serializeOpenCodeV2Output ─────────────────────────────────────────────

describe("serializeOpenCodeV2Output", () => {
  it("produces valid JSON for json extension", () => {
    const out  = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    const json = serializeOpenCodeV2Output(out, "json");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces valid JSON for jsonc extension", () => {
    const out  = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    const json = serializeOpenCodeV2Output(out, "jsonc");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces indented output (contains newlines)", () => {
    const out  = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    const json = serializeOpenCodeV2Output(out, "json");
    expect(json).toContain("\n");
  });

  it("output contains $schema key", () => {
    const out    = buildOpenCodeV2Config([makeAgent()], makeConfig(), "proj");
    const json   = serializeOpenCodeV2Output(out, "json");
    const parsed = JSON.parse(json);
    expect(parsed.$schema).toBeTruthy();
  });

  it("output contains 'agent' key with agent entries", () => {
    const out    = buildOpenCodeV2Config([makeAgent({ name: "test-agent" })], makeConfig(), "proj");
    const json   = serializeOpenCodeV2Output(out, "json");
    const parsed = JSON.parse(json);
    expect(parsed.agent["test-agent"]).toBeDefined();
  });
});

// ── buildOpenCodeV2AgentEntry — hidden field ──────────────────────────────

describe("buildOpenCodeV2AgentEntry — hidden field (always present)", () => {
  it("hidden is false when opencode.hidden is false", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "a", model: "b", hidden: false } } }),
      "proj",
    );
    expect(result["my-agent"]!.hidden).toBe(false);
  });

  it("hidden is true when opencode.hidden is true", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "a", model: "b", hidden: true } } }),
      "proj",
    );
    expect(result["my-agent"]!.hidden).toBe(true);
  });

  it("hidden is false when opencode.hidden is absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "a", model: "b" } } }),
      "proj",
    );
    expect(result["my-agent"]!.hidden).toBe(false);
  });

  it("hidden is false when opencode.hidden is null", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: { opencode: { provider: "a", model: "b", hidden: null } } }),
      "proj",
    );
    expect(result["my-agent"]!.hidden).toBe(false);
  });

  it("hidden is false when opencode is entirely absent", () => {
    const result = buildOpenCodeV2AgentEntry(
      makeAgent({ adataProperties: {} }),
      "proj",
    );
    expect(result["my-agent"]!.hidden).toBe(false);
  });

  it("hidden key is always present (never undefined)", () => {
    const result = buildOpenCodeV2AgentEntry(makeAgent(), "proj");
    expect("hidden" in result["my-agent"]!).toBe(true);
    expect(typeof result["my-agent"]!.hidden).toBe("boolean");
  });
});

// ── buildOpenCodeV2Config — agent inclusion filter ────────────────────────

describe("buildOpenCodeV2Config — agent inclusion: model check", () => {
  const allMdExist = () => true;

  it("includes agent when both provider and model are non-empty", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "anthropic", model: "claude-3" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).toContain("my-agent");
  });

  it("excludes agent when provider is missing", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "", model: "claude-3" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });

  it("excludes agent when model is missing", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "anthropic", model: "" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });

  it("excludes agent when both provider and model are absent", () => {
    const agent = makeAgent({ adataProperties: { opencode: {} } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });

  it("excludes agent when opencode block is entirely absent", () => {
    const agent = makeAgent({ adataProperties: {} });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });

  it("excludes agent when provider is whitespace-only", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "  ", model: "claude-3" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", allMdExist);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });
});

describe("buildOpenCodeV2Config — agent inclusion: md file check", () => {
  const withModel = makeAgent({ adataProperties: { opencode: { provider: "anthropic", model: "claude-3" } } });

  it("includes agent when md file exists", () => {
    const out = buildOpenCodeV2Config([withModel], makeConfig(), "proj", () => true);
    expect(Object.keys(out.agent)).toContain("my-agent");
  });

  it("excludes agent when md file does not exist", () => {
    const out = buildOpenCodeV2Config([withModel], makeConfig(), "proj", () => false);
    expect(Object.keys(out.agent)).not.toContain("my-agent");
  });

  it("mdFileExists receives the verbatim projectName and agentName", () => {
    const calls: Array<[string, string]> = [];
    const agent = makeAgent({ name: "El Jefe", adataProperties: { opencode: { provider: "a", model: "b" } } });
    buildOpenCodeV2Config([agent], makeConfig(), "DevTeam_1", (proj, agentName) => {
      calls.push([proj, agentName]);
      return true;
    });
    expect(calls).toEqual([["DevTeam_1", "El Jefe"]]);
  });

  it("includes only agents whose md file exists (mixed batch)", () => {
    const agentA = makeAgent({ id: "a1", name: "has-md",    adataProperties: { opencode: { provider: "a", model: "b" } } });
    const agentB = makeAgent({ id: "a2", name: "no-md",     adataProperties: { opencode: { provider: "a", model: "b" } } });
    const agentC = makeAgent({ id: "a3", name: "also-has",  adataProperties: { opencode: { provider: "a", model: "b" } } });

    const existingMds = new Set(["has-md", "also-has"]);
    const out = buildOpenCodeV2Config(
      [agentA, agentB, agentC],
      makeConfig(),
      "proj",
      (_proj, name) => existingMds.has(name),
    );

    expect(Object.keys(out.agent)).toContain("has-md");
    expect(Object.keys(out.agent)).toContain("also-has");
    expect(Object.keys(out.agent)).not.toContain("no-md");
    expect(Object.keys(out.agent).length).toBe(2);
  });
});

describe("buildOpenCodeV2Config — agent inclusion: both checks required", () => {
  it("excludes agent that has model but no md file", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", () => false);
    expect(Object.keys(out.agent)).toHaveLength(0);
  });

  it("excludes agent that has md file but no model", () => {
    const agent = makeAgent({ adataProperties: { opencode: {} } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", () => true);
    expect(Object.keys(out.agent)).toHaveLength(0);
  });

  it("excludes agent that has neither md file nor model", () => {
    const agent = makeAgent({ adataProperties: {} });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", () => false);
    expect(Object.keys(out.agent)).toHaveLength(0);
  });

  it("empty agent list → empty agent object", () => {
    const out = buildOpenCodeV2Config([], makeConfig(), "proj", () => true);
    expect(out.agent).toEqual({});
  });
});

// ── buildOpenCodeV2Config — hidden on exported agents ─────────────────────

describe("buildOpenCodeV2Config — exported agents always have hidden field", () => {
  const mdExist = () => true;

  it("hidden is false when opencode.hidden is absent", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(out.agent["my-agent"]!.hidden).toBe(false);
  });

  it("hidden is true when opencode.hidden is true", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b", hidden: true } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(out.agent["my-agent"]!.hidden).toBe(true);
  });

  it("hidden is false when opencode.hidden is null", () => {
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b", hidden: null } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(out.agent["my-agent"]!.hidden).toBe(false);
  });

  it("hidden key is always present in each exported entry", () => {
    const agents = [
      makeAgent({ id: "a1", name: "alpha", adataProperties: { opencode: { provider: "a", model: "b", hidden: true } } }),
      makeAgent({ id: "a2", name: "beta",  adataProperties: { opencode: { provider: "a", model: "b" } } }),
    ];
    const out = buildOpenCodeV2Config(agents, makeConfig(), "proj", mdExist);
    expect("hidden" in out.agent["alpha"]!).toBe(true);
    expect("hidden" in out.agent["beta"]!).toBe(true);
    expect(out.agent["alpha"]!.hidden).toBe(true);
    expect(out.agent["beta"]!.hidden).toBe(false);
  });
});

// ── buildOpenCodeV2Config — hideDefaultPlanner / hideDefaultBuilder ───────

describe("buildOpenCodeV2Config — hideDefaultPlanner injection", () => {
  const mdExist = () => true;

  it("injects agent.plan = { hidden: true } when hideDefaultPlanner is true", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ hideDefaultPlanner: true }),
      "proj",
      mdExist,
    );
    expect(out.agent["plan"]).toEqual({ hidden: true });
  });

  it("does not inject agent.plan when hideDefaultPlanner is false", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ hideDefaultPlanner: false }),
      "proj",
      mdExist,
    );
    expect("plan" in out.agent).toBe(false);
  });

  it("skips injection when a real agent named 'plan' already exists", () => {
    const planAgent = makeAgent({
      id: "plan-id",
      name: "plan",
      adataProperties: { opencode: { provider: "anthropic", model: "claude-3" } },
    });
    const out = buildOpenCodeV2Config(
      [planAgent],
      makeConfig({ hideDefaultPlanner: true }),
      "proj",
      mdExist,
    );
    // The real agent entry should remain (has all OpenCodeV2AgentEntry fields)
    expect(out.agent["plan"]).toBeDefined();
    expect("enabled" in out.agent["plan"]!).toBe(true);
  });
});

describe("buildOpenCodeV2Config — hideDefaultBuilder injection", () => {
  const mdExist = () => true;

  it("injects agent.build = { hidden: true } when hideDefaultBuilder is true", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ hideDefaultBuilder: true }),
      "proj",
      mdExist,
    );
    expect(out.agent["build"]).toEqual({ hidden: true });
  });

  it("does not inject agent.build when hideDefaultBuilder is false", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ hideDefaultBuilder: false }),
      "proj",
      mdExist,
    );
    expect("build" in out.agent).toBe(false);
  });

  it("skips injection when a real agent named 'build' already exists", () => {
    const buildAgent = makeAgent({
      id: "build-id",
      name: "build",
      adataProperties: { opencode: { provider: "anthropic", model: "claude-3" } },
    });
    const out = buildOpenCodeV2Config(
      [buildAgent],
      makeConfig({ hideDefaultBuilder: true }),
      "proj",
      mdExist,
    );
    // The real agent entry should remain (has all OpenCodeV2AgentEntry fields)
    expect(out.agent["build"]).toBeDefined();
    expect("enabled" in out.agent["build"]!).toBe(true);
  });
});

describe("buildOpenCodeV2Config — hideDefaultPlanner + hideDefaultBuilder combined", () => {
  const mdExist = () => true;

  it("injects both plan and build when both flags are true", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent()],
      makeConfig({ hideDefaultPlanner: true, hideDefaultBuilder: true }),
      "proj",
      mdExist,
    );
    expect(out.agent["plan"]).toEqual({ hidden: true });
    expect(out.agent["build"]).toEqual({ hidden: true });
  });

  it("real agents are unaffected when both flags are true", () => {
    const out = buildOpenCodeV2Config(
      [makeAgent({ name: "my-agent", adataProperties: { opencode: { provider: "a", model: "b" } } })],
      makeConfig({ hideDefaultPlanner: true, hideDefaultBuilder: true }),
      "proj",
      mdExist,
    );
    expect(out.agent["my-agent"]).toBeDefined();
    expect("enabled" in out.agent["my-agent"]!).toBe(true);
  });
});

describe("buildOpenCodeV2Config — edge cases", () => {
  const mdExist = () => true;

  it("agent name with accents is verbatim key", () => {
    const agent = makeAgent({ name: "Agénte Líder", adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(Object.keys(out.agent)).toContain("Agénte Líder");
  });

  it("agent name with uppercase stays verbatim", () => {
    const agent = makeAgent({ name: "MyAgent", adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(Object.keys(out.agent)).toContain("MyAgent");
  });

  it("project name with accents is passed verbatim to mdFileExists", () => {
    const calls: string[] = [];
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b" } } });
    buildOpenCodeV2Config([agent], makeConfig(), "ÉquipoÁgil", (proj) => {
      calls.push(proj);
      return true;
    });
    expect(calls[0]).toBe("ÉquipoÁgil");
  });

  it("agent name with special chars (spaces, dashes, underscores) is verbatim", () => {
    const name = "El Jefe-1_X";
    const agent = makeAgent({ name, adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj", mdExist);
    expect(Object.keys(out.agent)).toContain(name);
  });

  it("mdFileExists default (no 4th arg) includes all agents with model", () => {
    // Without passing mdFileExists, it defaults to () => true
    const agent = makeAgent({ adataProperties: { opencode: { provider: "a", model: "b" } } });
    const out   = buildOpenCodeV2Config([agent], makeConfig(), "proj");
    expect(Object.keys(out.agent)).toContain("my-agent");
  });

  it("hidden: false on agent even when opencode block is absent (fallback)", () => {
    // adataProperties has no opencode — if somehow it passes filter (e.g. manually)
    // we test buildOpenCodeV2AgentEntry directly
    const result = buildOpenCodeV2AgentEntry(makeAgent({ adataProperties: {} }), "proj");
    expect(result["my-agent"]!.hidden).toBe(false);
  });
});

