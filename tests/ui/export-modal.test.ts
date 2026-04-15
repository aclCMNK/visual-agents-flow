/**
 * tests/ui/export-modal.test.ts
 *
 * Unit tests for the pure helpers exported from ExportModal/export-logic.ts
 * and for the exportModalOpen state in agentFlowStore.
 *
 * These tests are pure logic tests — no DOM, no React rendering.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  EXPORT_TABS,
  EXPORT_TAB_LABELS,
  EXPORT_ADAPTER_IDS,
  EXPORT_ADAPTER_LABELS,
  makeDefaultOpenCodeConfig,
  getOpenCodeOutputFileName,
  buildOpenCodeConfig,
  serializeOpenCodeOutput,
  isOpenCodeConfigValid,
  validatePlugins,
  getAgentRelations,
  buildAgentOpenCodeJson,
} from "../../src/ui/components/ExportModal/export-logic.ts";
import type {
  AgentExportSnapshot,
  OpenCodeExportConfig,
  PluginEntry,
} from "../../src/ui/components/ExportModal/export-logic.ts";
import type { SerializableConnection } from "../../src/electron/bridge.types.ts";
import { useAgentFlowStore } from "../../src/ui/store/agentFlowStore.ts";

// ── EXPORT_TABS ────────────────────────────────────────────────────────────

describe("EXPORT_TABS", () => {
  it("contains exactly 6 tabs", () => {
    expect(EXPORT_TABS.length).toBe(6);
  });

  it("contains all expected tab ids", () => {
    expect(EXPORT_TABS).toContain("general");
    expect(EXPORT_TABS).toContain("agents");
    expect(EXPORT_TABS).toContain("relations");
    expect(EXPORT_TABS).toContain("skills");
    expect(EXPORT_TABS).toContain("mcps");
    expect(EXPORT_TABS).toContain("plugins");
  });
});

// ── EXPORT_TAB_LABELS ──────────────────────────────────────────────────────

describe("EXPORT_TAB_LABELS", () => {
  it("has a label for every tab", () => {
    for (const tab of EXPORT_TABS) {
      expect(EXPORT_TAB_LABELS[tab]).toBeTruthy();
    }
  });

  it("has correct label for general", () => {
    expect(EXPORT_TAB_LABELS.general).toBe("General");
  });

  it("has correct label for plugins", () => {
    expect(EXPORT_TAB_LABELS.plugins).toBe("Plugins");
  });
});

// ── EXPORT_ADAPTER_IDS / LABELS ────────────────────────────────────────────

describe("EXPORT_ADAPTER_IDS", () => {
  it("contains opencode", () => {
    expect(EXPORT_ADAPTER_IDS).toContain("opencode");
  });
});

describe("EXPORT_ADAPTER_LABELS", () => {
  it("has a label for opencode", () => {
    expect(EXPORT_ADAPTER_LABELS.opencode).toBe("OpenCode");
  });
});

// ── makeDefaultOpenCodeConfig ──────────────────────────────────────────────

describe("makeDefaultOpenCodeConfig", () => {
  it("returns default schema URL", () => {
    const cfg = makeDefaultOpenCodeConfig();
    expect(cfg.schemaUrl).toBe("https://opencode.ai/config.json");
  });

  it("sets autoUpdate to true", () => {
    const cfg = makeDefaultOpenCodeConfig();
    expect(cfg.autoUpdate).toBe(true);
  });

  it("sets defaultAgentId to empty string", () => {
    const cfg = makeDefaultOpenCodeConfig();
    expect(cfg.defaultAgentId).toBe("");
  });

  it("sets fileExtension to json", () => {
    const cfg = makeDefaultOpenCodeConfig();
    expect(cfg.fileExtension).toBe("json");
  });

  it("returns empty plugins array", () => {
    const cfg = makeDefaultOpenCodeConfig();
    expect(cfg.plugins).toEqual([]);
  });
});

// ── getOpenCodeOutputFileName ──────────────────────────────────────────────

describe("getOpenCodeOutputFileName", () => {
  it("returns opencode.json for json extension", () => {
    expect(getOpenCodeOutputFileName("json")).toBe("opencode.json");
  });

  it("returns opencode.jsonc for jsonc extension", () => {
    expect(getOpenCodeOutputFileName("jsonc")).toBe("opencode.jsonc");
  });
});

// ── buildOpenCodeConfig ────────────────────────────────────────────────────

const makeAgent = (overrides: Partial<AgentExportSnapshot> = {}): AgentExportSnapshot => ({
  id: "agent-1",
  name: "my-agent",
  description: "A test agent",
  isOrchestrator: false,
  profileContent: "You are a helpful agent.",
  adataProperties: {},
  agentType: "Agent",
  ...overrides,
});

describe("buildOpenCodeConfig — structure", () => {
  it("includes $schema when schemaUrl is set", () => {
    const cfg = makeDefaultOpenCodeConfig();
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out.$schema).toBe("https://opencode.ai/config.json");
  });

  it("omits $schema when schemaUrl is empty", () => {
    const cfg = { ...makeDefaultOpenCodeConfig(), schemaUrl: "" };
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out.$schema).toBeUndefined();
  });

  it("includes auto-update when autoUpdate is true", () => {
    const cfg = makeDefaultOpenCodeConfig();
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out["auto-update"]).toBe(true);
  });

  it("includes auto-update false when autoUpdate is false", () => {
    const cfg = { ...makeDefaultOpenCodeConfig(), autoUpdate: false };
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out["auto-update"]).toBe(false);
  });

  it("produces an agents array", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    expect(Array.isArray(out.agents)).toBe(true);
    expect(out.agents.length).toBe(1);
  });

  it("maps agent name correctly", () => {
    const out = buildOpenCodeConfig([makeAgent({ name: "my-agent" })], [], makeDefaultOpenCodeConfig());
    expect(out.agents[0]?.name).toBe("my-agent");
  });

  it("maps agent description correctly", () => {
    const out = buildOpenCodeConfig([makeAgent({ description: "desc here" })], [], makeDefaultOpenCodeConfig());
    expect(out.agents[0]?.description).toBe("desc here");
  });

  it("maps profileContent to system prompt", () => {
    const out = buildOpenCodeConfig(
      [makeAgent({ profileContent: "You are an AI." })],
      [],
      makeDefaultOpenCodeConfig(),
    );
    expect(out.agents[0]?.system).toBe("You are an AI.");
  });

  it("omits system when profileContent is empty", () => {
    const out = buildOpenCodeConfig(
      [makeAgent({ profileContent: "" })],
      [],
      makeDefaultOpenCodeConfig(),
    );
    expect(out.agents[0]?.system).toBeUndefined();
  });
});

describe("buildOpenCodeConfig — default-agent", () => {
  it("sets default-agent when defaultAgentId matches an agent", () => {
    const agent = makeAgent({ id: "abc", name: "orchestrator" });
    const cfg = { ...makeDefaultOpenCodeConfig(), defaultAgentId: "abc" };
    const out = buildOpenCodeConfig([agent], [], cfg);
    expect(out["default-agent"]).toBe("orchestrator");
  });

  it("omits default-agent when defaultAgentId is empty", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    expect(out["default-agent"]).toBeUndefined();
  });

  it("omits default-agent when defaultAgentId does not match any agent", () => {
    const cfg = { ...makeDefaultOpenCodeConfig(), defaultAgentId: "nonexistent" };
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out["default-agent"]).toBeUndefined();
  });
});

describe("buildOpenCodeConfig — plugins", () => {
  it("includes plugins when present", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [
        { localId: "p1", path: "/path/to/plugin.js" },
        { localId: "p2", path: "./other.ts" },
      ],
    };
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out.plugins).toEqual(["/path/to/plugin.js", "./other.ts"]);
  });

  it("omits plugins key when no plugins", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    expect(out.plugins).toBeUndefined();
  });

  it("omits empty-path plugins", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [
        { localId: "p1", path: "  " },
        { localId: "p2", path: "./valid.ts" },
      ],
    };
    const out = buildOpenCodeConfig([makeAgent()], [], cfg);
    expect(out.plugins).toEqual(["./valid.ts"]);
  });
});

describe("buildOpenCodeConfig — opencode adapter fields", () => {
  it("maps provider from adataProperties.opencode", () => {
    const agent = makeAgent({
      adataProperties: { opencode: { provider: "anthropic", model: "claude-3-5" } },
    });
    const out = buildOpenCodeConfig([agent], [], makeDefaultOpenCodeConfig());
    expect(out.agents[0]?.provider).toBe("anthropic");
    expect(out.agents[0]?.model).toBe("claude-3-5");
  });

  it("maps temperature from adataProperties.opencode", () => {
    const agent = makeAgent({
      adataProperties: { opencode: { temperature: 0.7 } },
    });
    const out = buildOpenCodeConfig([agent], [], makeDefaultOpenCodeConfig());
    expect(out.agents[0]?.temperature).toBe(0.7);
  });
});

// ── serializeOpenCodeOutput ────────────────────────────────────────────────

describe("serializeOpenCodeOutput", () => {
  it("produces valid JSON for json extension", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    const json = serializeOpenCodeOutput(out, "json");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces valid JSON for jsonc extension", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    const json = serializeOpenCodeOutput(out, "jsonc");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces indented output", () => {
    const out = buildOpenCodeConfig([makeAgent()], [], makeDefaultOpenCodeConfig());
    const json = serializeOpenCodeOutput(out, "json");
    // Indented JSON contains newlines
    expect(json).toContain("\n");
  });

  it("includes agents array in output", () => {
    const out = buildOpenCodeConfig([makeAgent({ name: "test-agent" })], [], makeDefaultOpenCodeConfig());
    const json = serializeOpenCodeOutput(out, "json");
    const parsed = JSON.parse(json);
    expect(parsed.agents[0].name).toBe("test-agent");
  });
});

// ── isOpenCodeConfigValid ──────────────────────────────────────────────────

describe("isOpenCodeConfigValid — valid cases", () => {
  it("returns true for default config", () => {
    expect(isOpenCodeConfigValid(makeDefaultOpenCodeConfig())).toBe(true);
  });

  it("returns true with jsonc extension", () => {
    const cfg = { ...makeDefaultOpenCodeConfig(), fileExtension: "jsonc" as const };
    expect(isOpenCodeConfigValid(cfg)).toBe(true);
  });

  it("returns true with valid plugin paths", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [
        { localId: "p1", path: "./plugin.js" },
        { localId: "p2", path: "/abs/path.ts" },
      ],
    };
    expect(isOpenCodeConfigValid(cfg)).toBe(true);
  });

  it("returns true with empty-path plugins (not validated)", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [{ localId: "p1", path: "" }],
    };
    expect(isOpenCodeConfigValid(cfg)).toBe(true);
  });
});

describe("isOpenCodeConfigValid — invalid cases", () => {
  it("returns false for invalid fileExtension", () => {
    const cfg = { ...makeDefaultOpenCodeConfig(), fileExtension: "txt" as unknown as "json" };
    expect(isOpenCodeConfigValid(cfg)).toBe(false);
  });

  it("returns false when a plugin path has wrong extension", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [{ localId: "p1", path: "plugin.py" }],
    };
    expect(isOpenCodeConfigValid(cfg)).toBe(false);
  });

  it("returns false for plugin path ending in .jsx", () => {
    const cfg: OpenCodeExportConfig = {
      ...makeDefaultOpenCodeConfig(),
      plugins: [{ localId: "p1", path: "component.jsx" }],
    };
    expect(isOpenCodeConfigValid(cfg)).toBe(false);
  });
});

// ── validatePlugins ────────────────────────────────────────────────────────

describe("validatePlugins", () => {
  it("returns hasErrors=false for empty array", () => {
    const { hasErrors } = validatePlugins([]);
    expect(hasErrors).toBe(false);
  });

  it("returns hasErrors=false for valid .js path", () => {
    const { hasErrors, entries } = validatePlugins([
      { localId: "p1", path: "plugin.js" },
    ]);
    expect(hasErrors).toBe(false);
    expect(entries[0]?.error).toBeUndefined();
  });

  it("returns hasErrors=false for valid .ts path", () => {
    const { hasErrors } = validatePlugins([
      { localId: "p1", path: "plugin.ts" },
    ]);
    expect(hasErrors).toBe(false);
  });

  it("returns hasErrors=true for invalid extension", () => {
    const { hasErrors, entries } = validatePlugins([
      { localId: "p1", path: "plugin.py" },
    ]);
    expect(hasErrors).toBe(true);
    expect(entries[0]?.error).toBeTruthy();
  });

  it("returns hasErrors=false for empty path (skipped)", () => {
    const { hasErrors } = validatePlugins([
      { localId: "p1", path: "" },
    ]);
    expect(hasErrors).toBe(false);
  });

  it("sets error only on invalid entries, not valid ones", () => {
    const { entries } = validatePlugins([
      { localId: "p1", path: "good.js" },
      { localId: "p2", path: "bad.py" },
    ]);
    expect(entries[0]?.error).toBeUndefined();
    expect(entries[1]?.error).toBeTruthy();
  });
});

// ── getAgentRelations ──────────────────────────────────────────────────────

const makeConnection = (
  fromAgentId: string,
  toAgentId: string,
  overrides: Partial<SerializableConnection> = {},
): SerializableConnection => ({
  id: `${fromAgentId}->${toAgentId}`,
  fromAgentId,
  toAgentId,
  type: "default",
  metadata: { relationType: "Delegation", delegationType: "Optional", ruleDetails: "" },
  ...overrides,
});

describe("getAgentRelations — inbound", () => {
  it("returns empty inbound when no connections point to agent", () => {
    const { inbound } = getAgentRelations("agent-1", [], []);
    expect(inbound).toEqual([]);
  });

  it("returns inbound connections pointing to agent", () => {
    const agents = [
      { id: "agent-2", name: "sender" },
      { id: "agent-1", name: "receiver" },
    ];
    const conn = makeConnection("agent-2", "agent-1");
    const { inbound } = getAgentRelations("agent-1", agents, [conn]);
    expect(inbound.length).toBe(1);
    expect(inbound[0]?.agentId).toBe("agent-2");
    expect(inbound[0]?.agentName).toBe("sender");
  });

  it("resolves user-node to 'User' for inbound", () => {
    const conn = makeConnection("user-node", "agent-1");
    const { inbound } = getAgentRelations("agent-1", [], [conn]);
    expect(inbound[0]?.agentName).toBe("User");
  });
});

describe("getAgentRelations — outbound", () => {
  it("returns empty outbound when no connections leave agent", () => {
    const { outbound } = getAgentRelations("agent-1", [], []);
    expect(outbound).toEqual([]);
  });

  it("returns outbound connections from agent", () => {
    const agents = [
      { id: "agent-1", name: "sender" },
      { id: "agent-2", name: "receiver" },
    ];
    const conn = makeConnection("agent-1", "agent-2");
    const { outbound } = getAgentRelations("agent-1", agents, [conn]);
    expect(outbound.length).toBe(1);
    expect(outbound[0]?.agentId).toBe("agent-2");
    expect(outbound[0]?.agentName).toBe("receiver");
  });
});

describe("getAgentRelations — rule metadata", () => {
  it("extracts ruleType from connection metadata", () => {
    const conn = makeConnection("agent-2", "agent-1", {
      metadata: { relationType: "Handoff", delegationType: "Required", ruleDetails: "must handoff" },
    });
    const { inbound } = getAgentRelations("agent-1", [], [conn]);
    expect(inbound[0]?.ruleType).toBe("Handoff");
  });

  it("defaults ruleType to Delegation when metadata missing", () => {
    const conn: SerializableConnection = {
      id: "c1",
      fromAgentId: "agent-2",
      toAgentId: "agent-1",
      type: "default",
      metadata: undefined,
    };
    const { inbound } = getAgentRelations("agent-1", [], [conn]);
    expect(inbound[0]?.ruleType).toBe("Delegation");
  });
});

// ── agentFlowStore — exportModalOpen ──────────────────────────────────────

describe("agentFlowStore — exportModalOpen", () => {
  beforeEach(() => {
    useAgentFlowStore.getState().resetFlow();
  });

  it("starts with exportModalOpen = false", () => {
    const { exportModalOpen } = useAgentFlowStore.getState();
    expect(exportModalOpen).toBe(false);
  });

  it("openExportModal sets exportModalOpen to true", () => {
    useAgentFlowStore.getState().openExportModal();
    expect(useAgentFlowStore.getState().exportModalOpen).toBe(true);
  });

  it("closeExportModal sets exportModalOpen to false", () => {
    useAgentFlowStore.getState().openExportModal();
    useAgentFlowStore.getState().closeExportModal();
    expect(useAgentFlowStore.getState().exportModalOpen).toBe(false);
  });

  it("exportModalOpen is reset to false on resetFlow()", () => {
    useAgentFlowStore.getState().openExportModal();
    useAgentFlowStore.getState().resetFlow();
    expect(useAgentFlowStore.getState().exportModalOpen).toBe(false);
  });
});

// ── buildAgentOpenCodeJson ─────────────────────────────────────────────────

const makeAgentSnapshot = (overrides: Partial<AgentExportSnapshot> = {}): AgentExportSnapshot => ({
  id: "agent-uuid-1",
  name: "my-agent",
  description: "A test agent",
  isOrchestrator: false,
  profileContent: "",
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
  agentType: "Agent",
  ...overrides,
});

describe("buildAgentOpenCodeJson — structure", () => {
  it("uses agent name as the top-level key", () => {
    const result = buildAgentOpenCodeJson(makeAgentSnapshot({ name: "my-agent" }), "my-project");
    expect(Object.keys(result)).toEqual(["my-agent"]);
  });

  it("enabled is always true", () => {
    const result = buildAgentOpenCodeJson(makeAgentSnapshot(), "my-project");
    expect(result["my-agent"]?.enabled).toBe(true);
  });

  it("mode is 'primary' for orchestrator agents", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ isOrchestrator: true }),
      "my-project"
    );
    expect(result["my-agent"]?.mode).toBe("primary");
  });

  it("mode is 'subagent' for non-orchestrator agents", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ isOrchestrator: false }),
      "my-project"
    );
    expect(result["my-agent"]?.mode).toBe("subagent");
  });

  it("prompt uses proj name and agent name as slugs", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ name: "my-agent" }),
      "My Project"
    );
    expect(result["my-agent"]?.prompt).toBe("{file:./prompt/my-project/my-agent.md}");
  });

  it("prompt uses slugified project name", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ name: "my-agent" }),
      "Drass MemorIA"
    );
    expect(result["my-agent"]?.prompt).toBe("{file:./prompt/drass-memoria/my-agent.md}");
  });

  it("description is taken from agent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ description: "Does cool stuff" }),
      "proj"
    );
    expect(result["my-agent"]?.description).toBe("Does cool stuff");
  });

  it("model is 'provider/model' when both are set", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { provider: "anthropic", model: "claude-3-5" } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.model).toBe("anthropic/claude-3-5");
  });

  it("model is just model string when provider is absent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { provider: "", model: "claude-3-5" } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.model).toBe("claude-3-5");
  });

  it("model is empty string when both provider and model are absent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: {} },
      }),
      "proj"
    );
    expect(result["my-agent"]?.model).toBe("");
  });

  it("temperature is taken from adata opencode config", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { provider: "a", model: "b", temperature: 0.42 } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.temperature).toBe(0.42);
  });

  it("temperature defaults to 0.05 when absent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {} } }),
      "proj"
    );
    expect(result["my-agent"]?.temperature).toBe(0.05);
  });

  it("step is present when steps is a number", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { provider: "a", model: "b", temperature: 0.1, steps: 14 } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.step).toBe(14);
  });

  it("step is omitted when steps is null", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { provider: "a", model: "b", temperature: 0.1, steps: null } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.step).toBeUndefined();
  });

  it("step is omitted when steps is absent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {} } }),
      "proj"
    );
    expect(result["my-agent"]?.step).toBeUndefined();
  });

  it("color is taken from adata opencode config", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        adataProperties: { opencode: { color: "#ff0000" } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.color).toBe("#ff0000");
  });

  it("color defaults to #ffffff when absent", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {} } }),
      "proj"
    );
    expect(result["my-agent"]?.color).toBe("#ffffff");
  });
});

describe("buildAgentOpenCodeJson — hidden field edge cases", () => {
  it("hidden field is absent for a non-hidden Agent type", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ agentType: "Agent", adataProperties: { opencode: { hidden: false } } }),
      "proj"
    );
    expect(result["my-agent"]?.hidden).toBeUndefined();
  });

  it("hidden field is absent when agentType is Agent even if opencode.hidden is true", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ agentType: "Agent", adataProperties: { opencode: { hidden: true } } }),
      "proj"
    );
    expect(result["my-agent"]?.hidden).toBeUndefined();
  });

  it("hidden field is absent for Sub-Agent when hidden is false", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        agentType: "Sub-Agent",
        adataProperties: { opencode: { hidden: false } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.hidden).toBeUndefined();
  });

  it("hidden field is true for Sub-Agent when hidden is true", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({
        agentType: "Sub-Agent",
        adataProperties: { opencode: { hidden: true } },
      }),
      "proj"
    );
    expect(result["my-agent"]?.hidden).toBe(true);
  });

  it("hidden field is absent when adata has no opencode block", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ agentType: "Sub-Agent", adataProperties: {} }),
      "proj"
    );
    expect(result["my-agent"]?.hidden).toBeUndefined();
  });
});

describe("buildAgentOpenCodeJson — permissions field", () => {
  it("permissions is absent when empty", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {}, permissions: {} } }),
      "proj"
    );
    expect(result["my-agent"]?.permissions).toBeUndefined();
  });

  it("permissions is absent when not present in adata", () => {
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {} } }),
      "proj"
    );
    expect(result["my-agent"]?.permissions).toBeUndefined();
  });

  it("permissions is included when adata has permissions", () => {
    const perms = { Bash: { run: "allow" as const }, read: "deny" as const };
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {}, permissions: perms } }),
      "proj"
    );
    expect(result["my-agent"]?.permissions).toEqual(perms);
  });

  it("permissions includes skills group when present", () => {
    const perms = { skills: { "kb-search": "allow" as const } };
    const result = buildAgentOpenCodeJson(
      makeAgentSnapshot({ adataProperties: { opencode: {}, permissions: perms } }),
      "proj"
    );
    expect(result["my-agent"]?.permissions?.skills).toEqual({ "kb-search": "allow" });
  });
});

describe("buildAgentOpenCodeJson — no extra fields", () => {
  it("does not include unexpected fields", () => {
    const result = buildAgentOpenCodeJson(makeAgentSnapshot(), "proj");
    const entry = result["my-agent"]!;
    const allowedKeys = new Set(["enabled", "hidden", "mode", "prompt", "description", "model", "temperature", "step", "color", "permissions"]);
    for (const key of Object.keys(entry)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it("serializes cleanly to JSON (no undefined values)", () => {
    // Agent without optional fields: no steps, no hidden for Agent type, no permissions
    const snapshot = makeAgentSnapshot({
      agentType: "Agent",
      adataProperties: {
        opencode: {
          provider: "anthropic",
          model: "claude-3-5",
          temperature: 0.1,
          hidden: false,
          steps: null,
          color: "#ffffff",
        },
      },
    });
    const result = buildAgentOpenCodeJson(snapshot, "proj");
    const json = JSON.parse(JSON.stringify(result));
    const entry = json["my-agent"];
    expect(entry).toBeDefined();
    // JSON.stringify drops undefined — ensure no unexpected null/undefined keys appear
    expect(Object.keys(entry)).not.toContain("hidden");
    expect(Object.keys(entry)).not.toContain("step");
    expect(Object.keys(entry)).not.toContain("permissions");
  });
});

describe("buildAgentOpenCodeJson — full orchestrator agent", () => {
  it("produces correct complete structure for an orchestrator agent", () => {
    const snapshot = makeAgentSnapshot({
      name: "orchestrator",
      description: "Main orchestrator",
      isOrchestrator: true,
      agentType: "Agent",
      adataProperties: {
        opencode: {
          provider: "github-copilot",
          model: "claude-sonnet-4",
          temperature: 0.1,
          hidden: false,
          steps: 20,
          color: "#336699",
        },
        permissions: { Bash: { "run-scripts": "allow" as const } },
      },
    });
    const result = buildAgentOpenCodeJson(snapshot, "drass-project");
    const entry = result["orchestrator"]!;

    expect(entry.enabled).toBe(true);
    expect(entry.hidden).toBeUndefined();
    expect(entry.mode).toBe("primary");
    expect(entry.prompt).toBe("{file:./prompt/drass-project/orchestrator.md}");
    expect(entry.description).toBe("Main orchestrator");
    expect(entry.model).toBe("github-copilot/claude-sonnet-4");
    expect(entry.temperature).toBe(0.1);
    expect(entry.step).toBe(20);
    expect(entry.color).toBe("#336699");
    expect(entry.permissions).toEqual({ Bash: { "run-scripts": "allow" } });
  });
});

describe("buildAgentOpenCodeJson — hidden sub-agent", () => {
  it("produces correct complete structure for a hidden sub-agent", () => {
    const snapshot = makeAgentSnapshot({
      name: "hidden-worker",
      description: "A hidden sub-agent",
      isOrchestrator: false,
      agentType: "Sub-Agent",
      adataProperties: {
        opencode: {
          provider: "openai",
          model: "gpt-4o",
          temperature: 0.5,
          hidden: true,
          steps: null,
          color: "#ffffff",
        },
      },
    });
    const result = buildAgentOpenCodeJson(snapshot, "my-project");
    const entry = result["hidden-worker"]!;

    expect(entry.enabled).toBe(true);
    expect(entry.hidden).toBe(true);
    expect(entry.mode).toBe("subagent");
    expect(entry.prompt).toBe("{file:./prompt/my-project/hidden-worker.md}");
    expect(entry.step).toBeUndefined();
  });
});

// ── ExportModal sanity: FolderExplorer integration + exportDir persistence ──
//
// These static assertions guard against regressions in the ExportModal flow.
// They verify the key integration points:
//   1. FolderExplorer is used (not the legacy native dialog).
//   2. onConfirm saves exportDir to project.properties via saveProject.
//   3. On open, project.properties.exportDir is read as initialPath.
//   4. statPath is used to validate the saved path before restoring it.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_MODAL_PATH = join(__dirname, "../../src/ui/components/ExportModal/ExportModal.tsx");

describe("ExportModal — FolderExplorer integration sanity check", () => {
  it("imports and renders FolderExplorer component", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // Must import the FolderExplorer component
    expect(source).toContain('import { FolderExplorer }');
    // Must render it somewhere in JSX
    expect(source).toContain('<FolderExplorer');
  });

  it("uses statPath to validate the saved export dir on open", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // statPath is imported from ipc.ts and called in the initialization useEffect
    expect(source).toContain('import { statPath }');
    expect(source).toContain('statPath(savedPath)');
  });

  it("reads exportDir from project.properties on open", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // The initialization useEffect reads project.properties.exportDir via dot notation
    expect(source).toContain('project.properties');
    expect(source).toContain('properties?.exportDir');
  });

  it("saves exportDir to project.properties via saveProject on confirm", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // saveProject is extracted from projectStore and called in handleFolderConfirm
    expect(source).toContain('saveProject');
    // The exportDir key is written into properties
    expect(source).toContain('exportDir: path');
  });

  it("has fallback to HOME with console.warn when saved path is invalid", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // Fallback logging is implemented in the useEffect for invalid saved paths
    expect(source).toContain('console.warn');
    expect(source).toContain('Usando HOME como punto de partida');
  });

  it("handleFolderConfirm is defined and used by FolderExplorer onConfirm prop", async () => {
    const source = await readFile(EXPORT_MODAL_PATH, "utf-8");
    // The handler must exist
    expect(source).toContain('handleFolderConfirm');
    // FolderExplorer must wire it via onConfirm prop
    expect(source).toContain('onConfirm={handleFolderConfirm}');
  });
});
