/**
 * src/ui/components/ModelSearchPanel.tsx
 *
 * Model search panel — embeddable in SelectModelModal.
 *
 * Combines the opencode CLI model list with models.dev extended data,
 * provides live filtering, and calls onSelectModel when the user picks a row.
 */

import React, { useState, useMemo } from "react";
import { useOpencodeModels } from "../../renderer/hooks/useOpencodeModels.ts";
import { useModelsApi } from "../../renderer/hooks/useModelsApi.ts";
import {
  buildModelSearchEntries,
  filterModelEntries,
} from "../../renderer/services/model-search-utils.ts";
import "../styles/model-search-panel.css";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ModelSearchPanelProps {
  /** Callback when the user selects a model. Receives "provider/model". */
  onSelectModel: (modelId: string) => void;
  /** Initial query for the search input. */
  initialQuery?: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelSearchPanel({ onSelectModel, initialQuery = "" }: ModelSearchPanelProps) {
  const { models: cliModels, loading: cliLoading, error: cliError, refetch } = useOpencodeModels();
  const { data: modelsDevData, loading: devLoading } = useModelsApi();

  const [query, setQuery] = useState(initialQuery);

  const isLoading = cliLoading || devLoading;

  const allEntries = useMemo(
    () => buildModelSearchEntries(cliModels, modelsDevData),
    [cliModels, modelsDevData],
  );

  const filteredEntries = useMemo(
    () => filterModelEntries(allEntries, query),
    [allEntries, query],
  );

  return (
    <div className="model-search-panel">
      {/* ── Search input ───────────────────────────────────────────────── */}
      <div className="model-search-panel__search">
        <input
          type="text"
          className="model-search-panel__input"
          placeholder="Search by provider, model, cost, reasoning..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="Search models"
        />
      </div>

      {/* ── Results area ───────────────────────────────────────────────── */}
      <div className="model-search-panel__results">

        {/* Estado: loading */}
        {isLoading && (
          <div className="model-search-panel__loading" role="status">
            <span className="model-search-panel__spinner" aria-hidden="true" />
            Loading models...
          </div>
        )}

        {/* Estado: error CLI */}
        {!isLoading && cliError && (
          <div className="model-search-panel__error" role="alert">
            <p>
              {cliError.includes("not found in PATH")
                ? "opencode CLI not found. Make sure opencode is installed and in your PATH."
                : cliError}
            </p>
            <button type="button" className="btn btn--secondary" onClick={refetch}>
              Retry
            </button>
          </div>
        )}

        {/* Estado: sin modelos disponibles */}
        {!isLoading && !cliError && allEntries.length === 0 && (
          <p className="model-search-panel__empty">
            No models available. Make sure opencode is configured.
          </p>
        )}

        {/* Estado: sin resultados para el query */}
        {!isLoading && !cliError && allEntries.length > 0 && filteredEntries.length === 0 && query && (
          <p className="model-search-panel__empty">
            No models found for &ldquo;{query}&rdquo;
          </p>
        )}

        {/* Estado: tabla de resultados */}
        {!isLoading && !cliError && filteredEntries.length > 0 && (
          <table className="model-search-panel__table" role="grid">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Model</th>
                <th scope="col">Input ($/1M)</th>
                <th scope="col">Output ($/1M)</th>
                <th scope="col">Reasoning</th>
                <th scope="col">Context</th>
                <th scope="col">Max Output</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr
                  key={entry.fullId}
                  className="model-search-panel__row"
                  onClick={() => onSelectModel(entry.fullId)}
                  role="row"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectModel(entry.fullId)}
                  aria-label={`Select ${entry.fullId}`}
                >
                  <td>{entry.provider}</td>
                  <td>{entry.model}</td>
                  <td>{entry.inputCostPer1M !== null ? `$${entry.inputCostPer1M}` : "—"}</td>
                  <td>{entry.outputCostPer1M !== null ? `$${entry.outputCostPer1M}` : "—"}</td>
                  <td>
                    {entry.hasReasoning === true
                      ? "✓"
                      : entry.hasReasoning === false
                        ? "✗"
                        : "—"}
                  </td>
                  <td>{entry.contextWindow !== null ? formatTokens(entry.contextWindow) : "—"}</td>
                  <td>{entry.maxOutput !== null ? formatTokens(entry.maxOutput) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
