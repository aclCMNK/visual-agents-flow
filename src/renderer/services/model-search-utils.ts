/**
 * src/renderer/services/model-search-utils.ts
 *
 * Pure utility functions for the model search feature.
 * Combines CLI model list with models.dev extended data.
 * No side effects, no state — fully testable in isolation.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelSearchEntry {
	provider: string;
	model: string;
	fullId: string;                    // "provider/model"
	inputCostPer1M: number | null;     // USD per 1M tokens input
	outputCostPer1M: number | null;    // USD per 1M tokens output
	hasReasoning: boolean | null;      // null = no info
	contextWindow: number | null;      // tokens
	maxOutput: number | null;          // tokens
	hasExtendedInfo: boolean;          // false if no data in models.dev
}

// ── Internal types for models.dev JSON structure ──────────────────────────────

interface ModelsDevEntry {
	id?: string;
	cost?: {
		input?: unknown;
		output?: unknown;
	};
	reasoning?: unknown;
	limit?: {
		context?: unknown;
		output?: unknown;
	};
	[key: string]: unknown;
}

interface ModelsDevData {
	models?: unknown[];
}

// ── buildModelsDevIndex ───────────────────────────────────────────────────────

/**
 * Builds a flat dictionary from models.dev JSON data.
 * Key: 'provider/model' as-is (exact value of the id field, no case transformation).
 * Value: the raw model metadata object from the API JSON.
 *
 * Example:
 *   { "anthropic/claude-opus-4-5": { id: "anthropic/claude-opus-4-5", cost: {...}, ... } }
 */
export function buildModelsDevIndex(
	modelsDevData: unknown | null,
): Record<string, ModelsDevEntry> {
	const index: Record<string, ModelsDevEntry | {}> = {};

	const rawData = modelsDevData as ModelsDevData | null;
	if (!rawData || typeof rawData !== "object") return index;

	for (const provider in rawData) {
		const value = (rawData as Record<string, ModelsDevEntry>)[provider];
		if (!value?.models || typeof value?.models !== "object") continue;
		const models = value?.models;
		if(!models) continue;
		for (const model in models) {
			const fullModel: string = provider + "/" + model;
			const entry = (models as Record<string, ModelsDevEntry>)[model] as ModelsDevEntry | undefined;
			index[fullModel] = entry ?? {};
		}
	}

	console.log("[buildModelsDevIndex] index built:", JSON.stringify(index, null, 2));

	return index;
}

// ── buildModelSearchEntries ───────────────────────────────────────────────────

/**
 * Crosses the CLI model list with models.dev extended data.
 * Returns a sorted array of ModelSearchEntry.
 *
 * Lookup strategy: direct dictionary lookup using 'provider/model' in lowercase.
 * The CLI line is used as-is (lowercased) to look up in the flat index built
 * from models.dev JSON. No normalization beyond lowercasing is applied.
 *
 * Multi-slash model names are fully supported (e.g. provider="openrouter",
 * model="openai/gpt-4.1" → key="openrouter/openai/gpt-4.1").
 *
 * @param cliModels    - Map from `useOpencodeModels`: { provider: string[] }
 * @param modelsDevData - Raw JSON from `useModelsApi`: unknown | null
 */
export function buildModelSearchEntries(
	cliModels: Record<string, string[]>,
	modelsDevData: unknown | null,
): ModelSearchEntry[] {
	// ── Build flat index: 'provider/model' (lowercase) → metadata object ──────
	const index = buildModelsDevIndex(modelsDevData);
	console.log(12312312, modelsDevData);

	// ── Build entries ─────────────────────────────────────────────────────────
	const entries: ModelSearchEntry[] = [];

	for (const [provider, modelList] of Object.entries(cliModels)) {
		for (const model of modelList) {
			const fullId = `${provider}/${model}`;
			// Direct lookup: use CLI string as-is (no case transformation)
			const entry = index[fullId];

			const inputCostPer1M = typeof entry?.cost?.input === "number" ? entry.cost.input : null;
			const outputCostPer1M = typeof entry?.cost?.output === "number" ? entry.cost.output : null;
			const hasReasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : null;
			const contextWindow = typeof entry?.limit?.context === "number" ? entry.limit.context : null;
			const maxOutput = typeof entry?.limit?.output === "number" ? entry.limit.output : null;
			const hasExtendedInfo = entry !== undefined;

			entries.push({
				provider,
				model,
				fullId,
				inputCostPer1M,
				outputCostPer1M,
				hasReasoning,
				contextWindow,
				maxOutput,
				hasExtendedInfo,
			});
		}
	}

	// ── Sort by provider then model ───────────────────────────────────────────
	entries.sort((a, b) => {
		const providerCmp = a.provider.localeCompare(b.provider);
		if (providerCmp !== 0) return providerCmp;
		return a.model.localeCompare(b.model);
	});

	return entries;
}

// ── filterModelEntries ────────────────────────────────────────────────────────

/**
 * Filters model entries by a free-text query against all visible fields.
 * Case-insensitive. Empty query returns all entries.
 *
 * @param entries - Full list of ModelSearchEntry
 * @param query   - User-typed search string
 */
export function filterModelEntries(
	entries: ModelSearchEntry[],
	query: string,
): ModelSearchEntry[] {
	const trimmed = query.trim();
	if (!trimmed) return entries;

	const normalized = trimmed.toLowerCase();

	return entries.filter((entry) => {
		const searchable = [
			entry.provider,
			entry.model,
			entry.fullId,
			entry.inputCostPer1M !== null ? `${entry.inputCostPer1M}` : "no info",
			entry.outputCostPer1M !== null ? `${entry.outputCostPer1M}` : "no info",
			entry.hasReasoning === true ? "yes reasoning" : entry.hasReasoning === false ? "no reasoning" : "",
			entry.contextWindow !== null ? `${entry.contextWindow}` : "",
			entry.maxOutput !== null ? `${entry.maxOutput}` : "",
		].join(" ").toLowerCase();

		return searchable.includes(normalized);
	});
}
