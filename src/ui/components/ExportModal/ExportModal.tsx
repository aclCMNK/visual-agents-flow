/**
 * src/ui/components/ExportModal/ExportModal.tsx
 *
 * Export modal for the AgentsFlow editor.
 *
 * Lets users export the current agent flow project as an OpenCode-compatible
 * configuration file (opencode.json or opencode.jsonc).
 *
 * # Architecture
 *
 *   - Portal modal — rendered at document.body via createPortal in App.tsx
 *   - Reads project data from the project store + flow store
 *   - Pure logic is in export-logic.ts (tested separately)
 *   - IPC calls go through window.agentsFlow (bridge)
 *
 * # Layout
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  Export Project                                              [Close]  │
 *   │  Adapter: [OpenCode ▾]   Directory: [/path/to/dir] [Pick…]           │
 *   │  [Export opencode.json]  (disabled until dir selected + config valid) │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  [General] [Agents] [Relations] [Skills] [MCPs] [Plugins]            │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  <Tab content>                                                        │
 *   └──────────────────────────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from "react";
import { useProjectStore } from "../../store/projectStore.ts";
import { useAgentFlowStore } from "../../store/agentFlowStore.ts";
import {
  EXPORT_TABS,
  EXPORT_TAB_LABELS,
  EXPORT_ADAPTER_LABELS,
  makeDefaultOpenCodeConfig,
  getOpenCodeOutputFileName,
  buildOpenCodeConfig,
  serializeOpenCodeOutput,
  isOpenCodeConfigValid,
  validatePlugins,
  getAgentRelations,
  buildAgentOpenCodeJson,
  OPENCODE_SCHEMA_URL_DEFAULT,
} from "./export-logic.ts";
import type {
  ExportTab,
  OpenCodeExportConfig,
  PluginEntry,
  AgentExportSnapshot,
} from "./export-logic.ts";

// ── Local counter for plugin IDs ─────────────────────────────────────────

let _pluginIdCounter = 0;
function makePluginId(): string {
  return `plugin-${++_pluginIdCounter}`;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface ExportModalProps {
  /** Called when the modal is closed */
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExportModal({ onClose }: ExportModalProps) {
  const project = useProjectStore((s) => s.project);
  const flowAgents = useAgentFlowStore((s) => s.agents);
  const links = useAgentFlowStore((s) => s.links);

  const bridge = typeof window !== "undefined" && (window as unknown as { agentsFlow?: typeof window.agentsFlow }).agentsFlow
    ? window.agentsFlow
    : null;

  // ── Modal state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ExportTab>("general");
  const [exportDir, setExportDir] = useState<string>("");
  const [config, setConfig] = useState<OpenCodeExportConfig>(makeDefaultOpenCodeConfig);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── Skills tab state ───────────────────────────────────────────────────
  const [skills, setSkills] = useState<Array<{ name: string; relativePath: string; content: string }>>([]);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skillsLoaded, setSkillsLoaded] = useState(false);

  // ── Agents tab state ───────────────────────────────────────────────────
  const [selectedAgentIdForTab, setSelectedAgentIdForTab] = useState<string>("");
  const [agentAdataDisplay, setAgentAdataDisplay] = useState<string>("");
  const [agentProfileDisplay, setAgentProfileDisplay] = useState<string>("");
  const [agentDataLoading, setAgentDataLoading] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────
  const orchestratorAgents = flowAgents.filter((a) => a.isOrchestrator);
  const canExport = isOpenCodeConfigValid(config) && exportDir.trim().length > 0;

  const outputFileName = getOpenCodeOutputFileName(config.fileExtension);

  // ── Load skills when skills tab becomes active ─────────────────────────
  useEffect(() => {
    if (activeTab !== "skills" || skillsLoaded || !project || !bridge) return;

    bridge.listSkillsFull({ projectDir: project.projectDir })
      .then((result) => {
        if (result.success) {
          setSkills(result.skills);
        }
        setSkillsLoaded(true);
      })
      .catch(() => setSkillsLoaded(true));
  }, [activeTab, skillsLoaded, project, bridge]);

  // ── Load agent data when agent tab selection changes ───────────────────
  useEffect(() => {
    if (activeTab !== "agents" || !selectedAgentIdForTab || !project || !bridge) {
      setAgentAdataDisplay("");
      setAgentProfileDisplay("");
      return;
    }

    setAgentDataLoading(true);

    Promise.all([
      bridge.readAgentAdataRaw({ projectDir: project.projectDir, agentId: selectedAgentIdForTab }),
      bridge.readAgentProfilesFull({ projectDir: project.projectDir, agentId: selectedAgentIdForTab }),
    ]).then(([adataResult, profileResult]) => {
      // Build the exact OpenCode JSON structure from the agent + adata
      const canvasAgent = flowAgents.find((a) => a.id === selectedAgentIdForTab);
      if (canvasAgent && adataResult.success && adataResult.adata) {
        const snapshot: AgentExportSnapshot = {
          id: canvasAgent.id,
          name: canvasAgent.name,
          description: canvasAgent.description,
          isOrchestrator: canvasAgent.isOrchestrator,
          profileContent: "",
          adataProperties: adataResult.adata,
          agentType: canvasAgent.type,
        };
        const agentJson = buildAgentOpenCodeJson(snapshot, project.name);
        setAgentAdataDisplay(JSON.stringify(agentJson, null, 2));
      } else if (canvasAgent) {
        // No adata found — build with empty adataProperties
        const snapshot: AgentExportSnapshot = {
          id: canvasAgent.id,
          name: canvasAgent.name,
          description: canvasAgent.description,
          isOrchestrator: canvasAgent.isOrchestrator,
          profileContent: "",
          adataProperties: {},
          agentType: canvasAgent.type,
        };
        const agentJson = buildAgentOpenCodeJson(snapshot, project.name);
        setAgentAdataDisplay(JSON.stringify(agentJson, null, 2));
      } else {
        setAgentAdataDisplay("(agent not found)");
      }

      setAgentProfileDisplay(
        profileResult.success
          ? profileResult.concatenatedContent || "(no profiles)"
          : "(error reading profiles)"
      );
      setAgentDataLoading(false);
    }).catch(() => {
      setAgentAdataDisplay("(error)");
      setAgentProfileDisplay("(error)");
      setAgentDataLoading(false);
    });
  }, [activeTab, selectedAgentIdForTab, project, bridge, flowAgents]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handlePickDir = useCallback(async () => {
    if (!bridge) return;
    const result = await bridge.selectExportDir();
    if (result.dirPath) {
      setExportDir(result.dirPath);
      setExportResult(null);
    }
  }, [bridge]);

  const handleExport = useCallback(async () => {
    if (!project || !bridge || !canExport) return;
    setIsExporting(true);
    setExportResult(null);

    try {
      // Build agent snapshots (without full profile content — use placeholder)
      // Full profile content is fetched on the backend via the write path,
      // here we build from what we have in the store + stub profiles.
      const agentSnapshots: AgentExportSnapshot[] = flowAgents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        isOrchestrator: a.isOrchestrator,
        profileContent: "",  // will be enriched below
        adataProperties: {},
        agentType: a.type,
      }));

      // Fetch profiles + adata for each agent
      const enriched = await Promise.all(
        agentSnapshots.map(async (snap) => {
          const [adataResult, profileResult] = await Promise.all([
            bridge.readAgentAdataRaw({ projectDir: project.projectDir, agentId: snap.id }),
            bridge.readAgentProfilesFull({ projectDir: project.projectDir, agentId: snap.id }),
          ]);
          return {
            ...snap,
            profileContent: profileResult.success ? profileResult.concatenatedContent : "",
            adataProperties: adataResult.success && adataResult.adata ? adataResult.adata : {},
          };
        })
      );

      // Convert links to SerializableConnection format
      const connections = links.map((l) => ({
        id: l.id,
        fromAgentId: l.fromAgentId,
        toAgentId: l.toAgentId,
        type: "default" as const,
        metadata: {
          relationType: l.ruleType,
          delegationType: l.delegationType ?? "",
          ruleDetails: l.ruleDetails ?? "",
        },
      }));

      const output = buildOpenCodeConfig(enriched, connections, config);
      const content = serializeOpenCodeOutput(output, config.fileExtension);

      const writeResult = await bridge.writeExportFile({
        destDir: exportDir,
        fileName: outputFileName,
        content,
      });

      if (writeResult.success) {
        setExportResult({ success: true, message: `Exported to ${writeResult.filePath}` });
      } else {
        setExportResult({ success: false, message: writeResult.error ?? "Unknown error" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportResult({ success: false, message: msg });
    } finally {
      setIsExporting(false);
    }
  }, [project, bridge, canExport, flowAgents, links, config, exportDir, outputFileName]);

  // Plugin helpers
  const handleAddPlugin = useCallback(() => {
    setConfig((c) => ({
      ...c,
      plugins: [...c.plugins, { localId: makePluginId(), path: "" }],
    }));
  }, []);

  const handleRemovePlugin = useCallback((localId: string) => {
    setConfig((c) => ({
      ...c,
      plugins: c.plugins.filter((p) => p.localId !== localId),
    }));
  }, []);

  const handlePluginPathChange = useCallback((localId: string, newPath: string) => {
    setConfig((c) => {
      const { entries } = validatePlugins(
        c.plugins.map((p) => (p.localId === localId ? { ...p, path: newPath } : p))
      );
      return { ...c, plugins: entries };
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="export-modal__overlay" role="dialog" aria-modal="true" aria-label="Export Project">
      <div className="export-modal__container">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="export-modal__header">
          <div className="export-modal__header-title">
            <h2 className="export-modal__title">Export Project</h2>
          </div>
          <button
            className="export-modal__close-btn"
            onClick={onClose}
            aria-label="Close export modal"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Adapter + directory row ──────────────────────────────────── */}
        <div className="export-modal__toolbar">
          <div className="export-modal__toolbar-group">
            <label className="export-modal__label" htmlFor="export-adapter-select">
              Adapter
            </label>
            <select
              id="export-adapter-select"
              className="export-modal__select"
              value="opencode"
              onChange={() => {/* only opencode supported */}}
            >
              <option value="opencode">{EXPORT_ADAPTER_LABELS.opencode}</option>
            </select>
          </div>

          <div className="export-modal__toolbar-group export-modal__toolbar-group--dir">
            <label className="export-modal__label" htmlFor="export-dir-input">
              Output directory
            </label>
            <div className="export-modal__dir-row">
              <input
                id="export-dir-input"
                className="export-modal__dir-input"
                type="text"
                readOnly
                value={exportDir || "No directory selected"}
                aria-label="Export output directory"
              />
              <button
                className="export-modal__pick-btn"
                onClick={handlePickDir}
                title="Pick output directory"
              >
                Pick…
              </button>
            </div>
          </div>

          <div className="export-modal__toolbar-actions">
            <button
              className={`export-modal__export-btn${canExport && !isExporting ? "" : " export-modal__export-btn--disabled"}`}
              disabled={!canExport || isExporting}
              onClick={handleExport}
              aria-disabled={!canExport || isExporting}
              title={!exportDir ? "Select an output directory first" : !isOpenCodeConfigValid(config) ? "Fix config errors first" : `Export as ${outputFileName}`}
            >
              {isExporting ? "Exporting…" : `Export ${outputFileName}`}
            </button>
          </div>
        </div>

        {/* ── Export result message ────────────────────────────────────── */}
        {exportResult && (
          <div className={`export-modal__result${exportResult.success ? " export-modal__result--success" : " export-modal__result--error"}`}>
            {exportResult.success ? "✓ " : "✗ "}
            {exportResult.message}
          </div>
        )}

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div className="export-modal__tab-bar" role="tablist">
          {EXPORT_TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`export-modal__tab${activeTab === tab ? " export-modal__tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {EXPORT_TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* ── Tab content ─────────────────────────────────────────────── */}
        <div className="export-modal__tab-content">

          {/* ── General tab ─────────────────────────────────────────── */}
          {activeTab === "general" && (
            <div className="export-modal__tab-pane">
              <div className="export-modal__field-row">
                <label className="export-modal__label" htmlFor="export-schema-url">
                  Schema URL
                </label>
                <input
                  id="export-schema-url"
                  className="export-modal__text-input"
                  type="text"
                  value={config.schemaUrl}
                  placeholder={OPENCODE_SCHEMA_URL_DEFAULT}
                  onChange={(e) => setConfig((c) => ({ ...c, schemaUrl: e.target.value }))}
                />
              </div>

              <div className="export-modal__field-row">
                <label className="export-modal__label">
                  Auto update
                </label>
                <div className="export-modal__switch-row">
                  <button
                    role="switch"
                    aria-checked={config.autoUpdate}
                    className={`export-modal__switch${config.autoUpdate ? " export-modal__switch--on" : ""}`}
                    onClick={() => setConfig((c) => ({ ...c, autoUpdate: !c.autoUpdate }))}
                    title="Toggle auto-update"
                  >
                    {config.autoUpdate ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              <div className="export-modal__field-row">
                <label className="export-modal__label" htmlFor="export-default-agent">
                  Default agent (orchestrator)
                </label>
                <select
                  id="export-default-agent"
                  className="export-modal__select"
                  value={config.defaultAgentId}
                  onChange={(e) => setConfig((c) => ({ ...c, defaultAgentId: e.target.value }))}
                >
                  <option value="">(none)</option>
                  {orchestratorAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="export-modal__field-row">
                <label className="export-modal__label">
                  File extension
                </label>
                <div className="export-modal__ext-switch">
                  <button
                    className={`export-modal__ext-btn${config.fileExtension === "json" ? " export-modal__ext-btn--active" : ""}`}
                    onClick={() => setConfig((c) => ({ ...c, fileExtension: "json" }))}
                    aria-pressed={config.fileExtension === "json"}
                  >
                    .json
                  </button>
                  <button
                    className={`export-modal__ext-btn${config.fileExtension === "jsonc" ? " export-modal__ext-btn--active" : ""}`}
                    onClick={() => setConfig((c) => ({ ...c, fileExtension: "jsonc" }))}
                    aria-pressed={config.fileExtension === "jsonc"}
                  >
                    .jsonc
                  </button>
                </div>
                <span className="export-modal__ext-hint">
                  Output: <code>{outputFileName}</code>
                </span>
              </div>
            </div>
          )}

          {/* ── Agents tab ──────────────────────────────────────────── */}
          {activeTab === "agents" && (
            <div className="export-modal__tab-pane export-modal__tab-pane--agents">
              <div className="export-modal__field-row">
                <label className="export-modal__label" htmlFor="export-agent-select">
                  Agent
                </label>
                <select
                  id="export-agent-select"
                  className="export-modal__select"
                  value={selectedAgentIdForTab}
                  onChange={(e) => setSelectedAgentIdForTab(e.target.value)}
                >
                  <option value="">(select an agent)</option>
                  {flowAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {selectedAgentIdForTab && (
                agentDataLoading ? (
                  <div className="export-modal__loading">Loading agent data…</div>
                ) : (
                  <div className="export-modal__agents-panels">
                    <div className="export-modal__agents-panel">
                      <div className="export-modal__panel-label">OpenCode config (JSON)</div>
                      <textarea
                        className="export-modal__textarea export-modal__textarea--readonly"
                        readOnly
                        value={agentAdataDisplay}
                        rows={10}
                        aria-label="Agent OpenCode config JSON"
                      />
                    </div>
                    <div className="export-modal__agents-panel">
                      <div className="export-modal__panel-label">Profile content (.md — concatenated by order)</div>
                      <textarea
                        className="export-modal__textarea export-modal__textarea--readonly"
                        readOnly
                        value={agentProfileDisplay}
                        rows={10}
                        aria-label="Agent profile content"
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* ── Relations tab ───────────────────────────────────────── */}
          {activeTab === "relations" && (
            <div className="export-modal__tab-pane">
              <RelationsTabContent
                agents={flowAgents.map((a) => ({ id: a.id, name: a.name }))}
                links={links}
              />
            </div>
          )}

          {/* ── Skills tab ──────────────────────────────────────────── */}
          {activeTab === "skills" && (
            <div className="export-modal__tab-pane export-modal__tab-pane--skills">
              {!skillsLoaded ? (
                <div className="export-modal__loading">Loading skills…</div>
              ) : skills.length === 0 ? (
                <div className="export-modal__empty">
                  No skills found in <code>{project?.projectDir}/skills/</code>
                </div>
              ) : (
                <div className="export-modal__skills-layout">
                  <div className="export-modal__skills-tree">
                    <div className="export-modal__panel-label">Skills</div>
                    {skills.map((skill) => (
                      <button
                        key={skill.name}
                        className={`export-modal__skill-item${selectedSkillName === skill.name ? " export-modal__skill-item--active" : ""}`}
                        onClick={() => setSelectedSkillName(skill.name)}
                        title={skill.relativePath}
                      >
                        {skill.name}
                      </button>
                    ))}
                  </div>
                  <div className="export-modal__skills-content">
                    <div className="export-modal__panel-label">SKILL.md content</div>
                    {selectedSkillName ? (
                      <textarea
                        className="export-modal__textarea export-modal__textarea--readonly"
                        readOnly
                        value={skills.find((s) => s.name === selectedSkillName)?.content ?? ""}
                        rows={20}
                        aria-label="SKILL.md content"
                      />
                    ) : (
                      <div className="export-modal__empty">Select a skill to view its content</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MCPs tab ────────────────────────────────────────────── */}
          {activeTab === "mcps" && (
            <div className="export-modal__tab-pane export-modal__tab-pane--placeholder">
              <p className="export-modal__placeholder-text">
                This feature is not yet implemented.
              </p>
            </div>
          )}

          {/* ── Plugins tab ─────────────────────────────────────────── */}
          {activeTab === "plugins" && (
            <div className="export-modal__tab-pane">
              <div className="export-modal__plugins-header">
                <span className="export-modal__label">Plugin file paths (.js or .ts)</span>
                <button
                  className="export-modal__add-plugin-btn"
                  onClick={handleAddPlugin}
                >
                  + Add plugin
                </button>
              </div>

              {config.plugins.length === 0 ? (
                <div className="export-modal__empty">No plugins added yet.</div>
              ) : (
                <div className="export-modal__plugin-list">
                  {config.plugins.map((plugin) => (
                    <div key={plugin.localId} className="export-modal__plugin-row">
                      <input
                        type="text"
                        className={`export-modal__plugin-input${plugin.error ? " export-modal__plugin-input--error" : ""}`}
                        value={plugin.path}
                        placeholder="Path to plugin file (e.g. ./my-plugin.js)"
                        onChange={(e) => handlePluginPathChange(plugin.localId, e.target.value)}
                        aria-label="Plugin file path"
                      />
                      <button
                        className="export-modal__plugin-remove-btn"
                        onClick={() => handleRemovePlugin(plugin.localId)}
                        aria-label="Remove plugin"
                        title="Remove plugin"
                      >
                        ✕
                      </button>
                      {plugin.error && (
                        <span className="export-modal__plugin-error">{plugin.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>{/* end tab-content */}

      </div>{/* end container */}
    </div>
  );
}

// ── Relations tab sub-component ────────────────────────────────────────────

interface RelationsTabContentProps {
  agents: Array<{ id: string; name: string }>;
  links: Array<{
    id: string;
    fromAgentId: string;
    toAgentId: string;
    ruleType: string;
    delegationType?: string;
    ruleDetails?: string;
  }>;
}

function RelationsTabContent({ agents, links }: RelationsTabContentProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  // Include user-node as a pseudo-agent
  const allAgents = [{ id: "user-node", name: "User" }, ...agents];

  const relations =
    selectedAgentId
      ? getAgentRelations(
          selectedAgentId,
          agents,
          links.map((l) => ({
            id: l.id,
            fromAgentId: l.fromAgentId,
            toAgentId: l.toAgentId,
            type: "default" as const,
            metadata: {
              relationType: l.ruleType,
              delegationType: l.delegationType ?? "",
              ruleDetails: l.ruleDetails ?? "",
            },
          }))
        )
      : null;

  return (
    <div className="export-modal__relations">
      <div className="export-modal__field-row">
        <label className="export-modal__label" htmlFor="export-relations-agent-select">
          Agent
        </label>
        <select
          id="export-relations-agent-select"
          className="export-modal__select"
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          <option value="">(select an agent)</option>
          {allAgents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {relations && (
        <div className="export-modal__relations-content">
          <div className="export-modal__relations-section">
            <div className="export-modal__panel-label">Inbound connections (→ this agent)</div>
            {relations.inbound.length === 0 ? (
              <div className="export-modal__empty">No inbound connections</div>
            ) : (
              <ul className="export-modal__relations-list">
                {relations.inbound.map((r, i) => (
                  <li key={i} className="export-modal__relation-item">
                    <strong>{r.agentName}</strong>
                    <span className="export-modal__relation-rule"> [{r.ruleType}{r.delegationType ? ` / ${r.delegationType}` : ""}]</span>
                    {r.ruleDetails && <span className="export-modal__relation-details"> — {r.ruleDetails}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="export-modal__relations-section">
            <div className="export-modal__panel-label">Outbound connections (this agent →)</div>
            {relations.outbound.length === 0 ? (
              <div className="export-modal__empty">No outbound connections</div>
            ) : (
              <ul className="export-modal__relations-list">
                {relations.outbound.map((r, i) => (
                  <li key={i} className="export-modal__relation-item">
                    <strong>{r.agentName}</strong>
                    <span className="export-modal__relation-rule"> [{r.ruleType}{r.delegationType ? ` / ${r.delegationType}` : ""}]</span>
                    {r.ruleDetails && <span className="export-modal__relation-details"> — {r.ruleDetails}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
