/**
 * tests/renderer/services/model-search-utils.test.ts
 *
 * Unit tests for src/renderer/services/model-search-utils.ts
 */

import { describe, it, expect } from "bun:test";
import {
  buildModelsDevIndex,
  buildModelSearchEntries,
  filterModelEntries,
  type ModelSearchEntry,
} from "../../../src/renderer/services/model-search-utils.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLI_MODELS = {
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

const MODELS_DEV_DATA = {
  models: [
    {
      id: "anthropic/claude-opus-4-5",
      cost: { input: 15, output: 75 },
      reasoning: true,
      limit: { context: 200000, output: 32000 },
    },
    {
      id: "openai/gpt-4o",
      cost: { input: 2.5, output: 10 },
      reasoning: false,
      limit: { context: 128000, output: 16384 },
    },
  ],
};

// ── buildModelsDevIndex ───────────────────────────────────────────────────────

describe("buildModelsDevIndex", () => {
  it("builds a flat dictionary keyed by lowercase provider/model", () => {
    const index = buildModelsDevIndex(MODELS_DEV_DATA);
    expect(Object.keys(index)).toHaveLength(2);
    expect(index["anthropic/claude-opus-4-5"]).toBeDefined();
    expect(index["openai/gpt-4o"]).toBeDefined();
  });

  it("lowercases keys from uppercase ids", () => {
    const data = {
      models: [{ id: "Anthropic/Claude-Opus-4-5", cost: { input: 15, output: 75 } }],
    };
    const index = buildModelsDevIndex(data);
    expect(index["anthropic/claude-opus-4-5"]).toBeDefined();
    expect(index["Anthropic/Claude-Opus-4-5"]).toBeUndefined();
  });

  it("preserves hyphens and dots in keys", () => {
    const data = {
      models: [{ id: "openrouter/openai/gpt-4.1", cost: { input: 2, output: 8 } }],
    };
    const index = buildModelsDevIndex(data);
    expect(index["openrouter/openai/gpt-4.1"]).toBeDefined();
  });

  it("handles multi-slash ids (three segments)", () => {
    const data = {
      models: [{ id: "ollama/mistral/mixtral-8x7b-instruct-v0.1", cost: { input: 0, output: 0 } }],
    };
    const index = buildModelsDevIndex(data);
    expect(index["ollama/mistral/mixtral-8x7b-instruct-v0.1"]).toBeDefined();
  });

  it("returns empty object for null input", () => {
    expect(buildModelsDevIndex(null)).toEqual({});
  });

  it("returns empty object for data without models array", () => {
    expect(buildModelsDevIndex({})).toEqual({});
    expect(buildModelsDevIndex({ models: "not-an-array" })).toEqual({});
  });

  it("skips entries without a valid id", () => {
    const data = {
      models: [
        { cost: { input: 1, output: 2 } },
        { id: "", cost: { input: 1, output: 2 } },
        { id: "valid/model", cost: { input: 1, output: 2 } },
      ],
    };
    const index = buildModelsDevIndex(data);
    expect(Object.keys(index)).toHaveLength(1);
    expect(index["valid/model"]).toBeDefined();
  });

  it("stores the raw metadata object as value", () => {
    const index = buildModelsDevIndex(MODELS_DEV_DATA);
    const entry = index["anthropic/claude-opus-4-5"];
    expect(entry.cost?.input).toBe(15);
    expect(entry.cost?.output).toBe(75);
    expect(entry.reasoning).toBe(true);
    expect(entry.limit?.context).toBe(200000);
  });
});

// ── buildModelSearchEntries ───────────────────────────────────────────────────

describe("buildModelSearchEntries", () => {
  it("returns entries for all CLI models", () => {
    const entries = buildModelSearchEntries(CLI_MODELS, MODELS_DEV_DATA);
    expect(entries.length).toBe(4);
  });

  it("fills extended info when models.dev has a match", () => {
    const entries = buildModelSearchEntries(CLI_MODELS, MODELS_DEV_DATA);
    const opus = entries.find((e) => e.fullId === "anthropic/claude-opus-4-5");
    expect(opus).toBeDefined();
    expect(opus!.inputCostPer1M).toBe(15);
    expect(opus!.outputCostPer1M).toBe(75);
    expect(opus!.hasReasoning).toBe(true);
    expect(opus!.contextWindow).toBe(200000);
    expect(opus!.maxOutput).toBe(32000);
    expect(opus!.hasExtendedInfo).toBe(true);
  });

  it("sets null fields and hasExtendedInfo=false when no match", () => {
    const entries = buildModelSearchEntries(CLI_MODELS, MODELS_DEV_DATA);
    const mini = entries.find((e) => e.fullId === "openai/gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.inputCostPer1M).toBeNull();
    expect(mini!.outputCostPer1M).toBeNull();
    expect(mini!.hasReasoning).toBeNull();
    expect(mini!.contextWindow).toBeNull();
    expect(mini!.maxOutput).toBeNull();
    expect(mini!.hasExtendedInfo).toBe(false);
  });

  it("returns empty array for empty CLI models", () => {
    const entries = buildModelSearchEntries({}, MODELS_DEV_DATA);
    expect(entries).toEqual([]);
  });

  it("handles null modelsDevData gracefully", () => {
    const entries = buildModelSearchEntries(CLI_MODELS, null);
    expect(entries.length).toBe(4);
    entries.forEach((e) => {
      expect(e.hasExtendedInfo).toBe(false);
      expect(e.inputCostPer1M).toBeNull();
    });
  });

  it("sorts entries by provider then model", () => {
    const entries = buildModelSearchEntries(CLI_MODELS, null);
    const providers = entries.map((e) => e.provider);
    expect(providers[0]).toBe("anthropic");
    expect(providers[1]).toBe("anthropic");
    expect(providers[2]).toBe("openai");
    expect(providers[3]).toBe("openai");
    expect(entries[0].model).toBe("claude-opus-4-5");
    expect(entries[1].model).toBe("claude-sonnet-4-5");
    expect(entries[2].model).toBe("gpt-4o");
    expect(entries[3].model).toBe("gpt-4o-mini");
  });

  it("sets fullId as provider/model", () => {
    const entries = buildModelSearchEntries({ openai: ["gpt-4o"] }, null);
    expect(entries[0].fullId).toBe("openai/gpt-4o");
  });

  it("matches when models.dev id has uppercase provider (lowercased in index)", () => {
    const cliModels = { anthropic: ["claude-opus-4-5"] };
    const devData = {
      models: [
        {
          id: "Anthropic/claude-opus-4-5",
          cost: { input: 15, output: 75 },
          reasoning: true,
          limit: { context: 200000, output: 32000 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].inputCostPer1M).toBe(15);
  });

  it("does NOT match when models.dev id uses underscores and CLI uses hyphens", () => {
    // Lookup is exact (lowercase only): "gpt-4o-mini" ≠ "gpt_4o_mini"
    const cliModels = { openai: ["gpt-4o-mini"] };
    const devData = {
      models: [
        {
          id: "openai/gpt_4o_mini",
          cost: { input: 0.15, output: 0.6 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(false);
  });

  it("matches when CLI provider has uppercase letters (lowercased for lookup)", () => {
    const cliModels = { OpenAI: ["gpt-4o"] };
    const devData = {
      models: [
        {
          id: "openai/gpt-4o",
          cost: { input: 2.5, output: 10 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].outputCostPer1M).toBe(10);
  });

  it("preserves original provider and model names in the entry (not lowercased)", () => {
    const cliModels = { Anthropic: ["Claude-Opus"] };
    const devData = {
      models: [
        {
          id: "anthropic/claude-opus",
          cost: { input: 5, output: 20 },
          reasoning: null,
          limit: { context: 100000, output: 8000 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].provider).toBe("Anthropic");
    expect(entries[0].model).toBe("Claude-Opus");
    expect(entries[0].fullId).toBe("Anthropic/Claude-Opus");
    expect(entries[0].hasExtendedInfo).toBe(true);
  });

  // ── Multi-slash model names ───────────────────────────────────────────────

  it("matches openrouter/openai/gpt-4.1 — two slashes in fullId", () => {
    const cliModels = { openrouter: ["openai/gpt-4.1"] };
    const devData = {
      models: [
        {
          id: "openrouter/openai/gpt-4.1",
          cost: { input: 2, output: 8 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries).toHaveLength(1);
    expect(entries[0].provider).toBe("openrouter");
    expect(entries[0].model).toBe("openai/gpt-4.1");
    expect(entries[0].fullId).toBe("openrouter/openai/gpt-4.1");
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].inputCostPer1M).toBe(2);
    expect(entries[0].outputCostPer1M).toBe(8);
  });

  it("matches ollama/mistral/mixtral-8x7b-instruct-v0.1 — three segments", () => {
    const cliModels = { ollama: ["mistral/mixtral-8x7b-instruct-v0.1"] };
    const devData = {
      models: [
        {
          id: "ollama/mistral/mixtral-8x7b-instruct-v0.1",
          cost: { input: 0, output: 0 },
          reasoning: false,
          limit: { context: 32768, output: 4096 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries).toHaveLength(1);
    expect(entries[0].provider).toBe("ollama");
    expect(entries[0].model).toBe("mistral/mixtral-8x7b-instruct-v0.1");
    expect(entries[0].fullId).toBe("ollama/mistral/mixtral-8x7b-instruct-v0.1");
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].contextWindow).toBe(32768);
  });

  it("matches multi-slash model with mixed casing on both sides", () => {
    // CLI: provider="OpenRouter", model="OpenAI/GPT-4.1"
    // lookup key: "openrouter/openai/gpt-4.1" → matches index key
    const cliModels = { OpenRouter: ["OpenAI/GPT-4.1"] };
    const devData = {
      models: [
        {
          id: "openrouter/openai/gpt-4.1",
          cost: { input: 2, output: 8 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].provider).toBe("OpenRouter");
    expect(entries[0].model).toBe("OpenAI/GPT-4.1");
    expect(entries[0].fullId).toBe("OpenRouter/OpenAI/GPT-4.1");
    expect(entries[0].inputCostPer1M).toBe(2);
  });

  it("returns hasExtendedInfo=false when multi-slash model has no match", () => {
    const cliModels = { openrouter: ["anthropic/claude-unknown-v99"] };
    const devData = {
      models: [
        { id: "openrouter/anthropic/claude-3-opus", cost: { input: 15, output: 75 } },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(false);
    expect(entries[0].inputCostPer1M).toBeNull();
  });

  it("handles mix of single-slash and multi-slash models in same provider", () => {
    const cliModels = {
      openrouter: ["openai/gpt-4.1", "meta-llama/llama-3.1-8b-instruct"],
      openai: ["gpt-4o"],
    };
    const devData = {
      models: [
        {
          id: "openrouter/openai/gpt-4.1",
          cost: { input: 2, output: 8 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
        {
          id: "openai/gpt-4o",
          cost: { input: 2.5, output: 10 },
          reasoning: false,
          limit: { context: 128000, output: 16384 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries).toHaveLength(3);

    const gpt41 = entries.find((e) => e.fullId === "openrouter/openai/gpt-4.1");
    expect(gpt41).toBeDefined();
    expect(gpt41!.hasExtendedInfo).toBe(true);
    expect(gpt41!.inputCostPer1M).toBe(2);

    const llama = entries.find((e) => e.model === "meta-llama/llama-3.1-8b-instruct");
    expect(llama).toBeDefined();
    expect(llama!.hasExtendedInfo).toBe(false);

    const gpt4o = entries.find((e) => e.fullId === "openai/gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.hasExtendedInfo).toBe(true);
    expect(gpt4o!.inputCostPer1M).toBe(2.5);
  });

  it("matches model with hyphens and numbers in multiple segments", () => {
    // e.g. "vertex-ai/gemini-1.5-pro-002" — hyphens and dots preserved
    const cliModels = { "vertex-ai": ["gemini-1.5-pro-002"] };
    const devData = {
      models: [
        {
          id: "vertex-ai/gemini-1.5-pro-002",
          cost: { input: 1.25, output: 5 },
          reasoning: false,
          limit: { context: 1000000, output: 8192 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].inputCostPer1M).toBe(1.25);
    expect(entries[0].contextWindow).toBe(1000000);
  });

  it("matches deeply nested model with hyphens across three segments", () => {
    // e.g. provider="openrouter", model="meta-llama/llama-3.3-70b-instruct"
    const cliModels = { openrouter: ["meta-llama/llama-3.3-70b-instruct"] };
    const devData = {
      models: [
        {
          id: "openrouter/meta-llama/llama-3.3-70b-instruct",
          cost: { input: 0.12, output: 0.3 },
          reasoning: false,
          limit: { context: 131072, output: 8192 },
        },
      ],
    };
    const entries = buildModelSearchEntries(cliModels, devData);
    expect(entries[0].hasExtendedInfo).toBe(true);
    expect(entries[0].fullId).toBe("openrouter/meta-llama/llama-3.3-70b-instruct");
    expect(entries[0].inputCostPer1M).toBe(0.12);
    expect(entries[0].maxOutput).toBe(8192);
  });
});

// ── filterModelEntries ────────────────────────────────────────────────────────

const SAMPLE_ENTRIES: ModelSearchEntry[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-5",
    fullId: "anthropic/claude-opus-4-5",
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    hasReasoning: true,
    contextWindow: 200000,
    maxOutput: 32000,
    hasExtendedInfo: true,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    fullId: "openai/gpt-4o-mini",
    inputCostPer1M: null,
    outputCostPer1M: null,
    hasReasoning: null,
    contextWindow: null,
    maxOutput: null,
    hasExtendedInfo: false,
  },
];

describe("filterModelEntries", () => {
  it("returns all entries for empty query", () => {
    expect(filterModelEntries(SAMPLE_ENTRIES, "")).toHaveLength(2);
    expect(filterModelEntries(SAMPLE_ENTRIES, "   ")).toHaveLength(2);
  });

  it("filters by provider name", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "anthropic");
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("anthropic");
  });

  it("filters by model name", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "gpt-4o-mini");
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-4o-mini");
  });

  it("filters by cost value", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "15");
    expect(result).toHaveLength(1);
    expect(result[0].fullId).toBe("anthropic/claude-opus-4-5");
  });

  it("filters by reasoning 'yes'", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "yes");
    expect(result).toHaveLength(1);
    expect(result[0].hasReasoning).toBe(true);
  });

  it("filters by 'no info' for null fields", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "no info");
    expect(result).toHaveLength(1);
    expect(result[0].fullId).toBe("openai/gpt-4o-mini");
  });

  it("is case-insensitive", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "ANTHROPIC");
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no match", () => {
    const result = filterModelEntries(SAMPLE_ENTRIES, "zzz-no-match");
    expect(result).toHaveLength(0);
  });

  it("filters multi-slash model by partial fullId", () => {
    const entries: ModelSearchEntry[] = [
      {
        provider: "openrouter",
        model: "openai/gpt-4.1",
        fullId: "openrouter/openai/gpt-4.1",
        inputCostPer1M: 2,
        outputCostPer1M: 8,
        hasReasoning: false,
        contextWindow: 128000,
        maxOutput: 16384,
        hasExtendedInfo: true,
      },
    ];
    expect(filterModelEntries(entries, "openrouter/openai")).toHaveLength(1);
    expect(filterModelEntries(entries, "gpt-4.1")).toHaveLength(1);
    expect(filterModelEntries(entries, "gpt-4.2")).toHaveLength(0);
  });
});
