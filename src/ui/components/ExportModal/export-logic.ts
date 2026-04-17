/**
 * src/ui/components/ExportModal/export-logic.ts
 *
 * Pure, adapter-agnostic export logic for the ExportModal.
 *
 * # Architecture
 *
 * The export system is designed to be extensible to multiple adapters.
 * Currently only "opencode" is implemented. The structure is:
 *
 *   ExportAdapter<TConfig>
 *     │
 *     ├── id          — stable adapter identifier (e.g. "opencode")
 *     ├── label       — display label (e.g. "OpenCode")
 *     ├── defaultConfig() → TConfig
 *     └── build(project, agents, links, config) → ExportResult
 *
 * Adding a new adapter: implement ExportAdapter and add it to EXPORT_ADAPTERS.
 *
 * # OpenCode adapter
 *
 * Produces an OpenCode-compatible config JSON with the following structure:
 *
 *   {
 *     "$schema":      "...",
 *     "auto-update":  true,
 *     "default-agent": "<orchestrator-slug>",
 *     "agents": [
 *       {
 *         "name": "<slug>",
 *         "description": "...",
 *         "system": "<concatenated .md profiles>",
 *         ...
 *       }
 *     ],
 *     "plugins": ["<path>", ...]
 *   }
 */

import type { SerializableAgentModel, SerializableConnection, PermissionsObject } from "../../../electron/bridge.types.ts";
import { toSlug } from "../../utils/slugUtils.ts";

// ── Shared types ───────────────────────────────────────────────────────────

/** A tab identifier for the export modal */
export type ExportTab = "general" | "agents" | "relations" | "skills" | "mcps" | "plugins";

/** All defined export tabs */
export const EXPORT_TABS: ExportTab[] = [
  "general",
  "agents",
  "relations",
  "skills",
  "mcps",
  "plugins",
];

/** Human-readable labels for each tab */
export const EXPORT_TAB_LABELS: Record<ExportTab, string> = {
  general:   "General",
  agents:    "Agents",
  relations: "Relations",
  skills:    "Skills",
  mcps:      "MCPs",
  plugins:   "Plugins",
};

// ── Plugin entry ───────────────────────────────────────────────────────────

/** A single plugin file path entry */
export interface PluginEntry {
  /** Local stable ID for list operations */
  localId: string;
  /** Absolute or relative path to the .js/.ts plugin file */
  path: string;
  /** Validation error message, if any */
  error?: string;
}

// ── OpenCode adapter config ────────────────────────────────────────────────

/** Configuration for the OpenCode export adapter */
export interface OpenCodeExportConfig {
  /** The $schema URL for the generated config file */
  schemaUrl: string;
  /** Whether to include auto-update: true in the output */
  autoUpdate: boolean;
  /**
   * Agent ID chosen as default agent (orchestrator).
   * Empty string = no default agent set.
   */
  defaultAgentId: string;
  /**
   * File extension for the exported config.
   * "json"  → opencode.json
   * "jsonc" → opencode.jsonc
   */
  fileExtension: "json" | "jsonc";
  /** Plugin paths to include in the output */
  plugins: PluginEntry[];
  /** Whether to hide the default planner agent in the exported config */
  hideDefaultPlanner: boolean;
  /** Whether to hide the default builder agent in the exported config */
  hideDefaultBuilder: boolean;
}

/** Default schema URL for OpenCode config files */
export const OPENCODE_SCHEMA_URL_DEFAULT =
  "https://opencode.ai/config.json";

/** Constructs the default OpenCodeExportConfig */
export function makeDefaultOpenCodeConfig(): OpenCodeExportConfig {
  return {
    schemaUrl: OPENCODE_SCHEMA_URL_DEFAULT,
    autoUpdate: true,
    defaultAgentId: "",
    fileExtension: "json",
    plugins: [],
    hideDefaultPlanner: false,
    hideDefaultBuilder: false,
  };
}

/** The output filename based on the extension setting */
export function getOpenCodeOutputFileName(ext: "json" | "jsonc"): string {
  return ext === "jsonc" ? "opencode.jsonc" : "opencode.json";
}

// ── Agent data snapshot ────────────────────────────────────────────────────

/**
 * A snapshot of a single agent's data needed for export.
 * Combines data from the canvas store and from loaded project data.
 */
export interface AgentExportSnapshot {
  id: string;
  name: string;
  description: string;
  isOrchestrator: boolean;
  /** Concatenated profile .md content (from AgentProfileModal / profileContent) */
  profileContent: string;
  /** JSON-serializable properties from .adata (opencode config, skills, etc.) */
  adataProperties: Record<string, unknown>;
  /** Agent type: "Agent" or "Sub-Agent" */
  agentType: "Agent" | "Sub-Agent";
}

// ── Relation data ──────────────────────────────────────────────────────────

/**
 * For a given agent, describes its in/out relations in the flow.
 */
export interface AgentRelations {
  /** Connections that delegate TO this agent (from other agents or user) */
  inbound: AgentRelationEntry[];
  /** Connections FROM this agent to other agents */
  outbound: AgentRelationEntry[];
}

export interface AgentRelationEntry {
  /** ID of the connected agent (or "user-node") */
  agentId: string;
  /** Display name of the connected node */
  agentName: string;
  /** Rule type of the connection */
  ruleType: string;
  /** Delegation type when ruleType === "Delegation" */
  delegationType?: string;
  /** Rule details */
  ruleDetails?: string;
}

// ── Agent OpenCode JSON preview ────────────────────────────────────────────

/**
 * The exact shape of one agent's entry in the OpenCode config JSON
 * (as shown in the Agents tab textarea and used in the final export).
 *
 * Field rules (per spec docs/specs/exporter-opencode.md):
 *   - enabled:      always true
 *   - hidden:       only present when agent is a Sub-Agent AND hidden === true
 *   - mode:         "primary" if orchestrator, "subagent" otherwise
 *   - prompt:       "{file:./prompt/<projName>/<agentName>.md}"
 *   - description:  from basic agent edit modal
 *   - model:        "<provider>/<model>" from .adata.opencode
 *   - temperature:  from .adata.opencode.temperature
 *   - step:         from .adata.opencode.steps (omitted when null/undefined)
 *   - color:        from .adata.opencode.color
 *   - permissions:  from .adata.permissions (omitted when empty)
 */
export interface AgentOpenCodeEntry {
  enabled: true;
  hidden?: true;
  mode: "primary" | "subagent";
  prompt: string;
  description: string;
  model: string;
  temperature: number;
  step?: number;
  color: string;
  permissions?: PermissionsObject;
}

/**
 * Builds the OpenCode JSON entry for a single agent, exactly as required by
 * the spec: `{ "[agent_name]": { enabled, [hidden], mode, prompt, ... } }`.
 *
 * This is a pure function — no side effects.
 *
 * @param agent       - Snapshot of the agent (from canvas store + adata)
 * @param projectName - Name of the .afproj project (used to build prompt path)
 * @returns A plain object `{ [agentName]: AgentOpenCodeEntry }` ready for JSON.stringify
 */
export function buildAgentOpenCodeJson(
  agent: AgentExportSnapshot,
  projectName: string,
): Record<string, AgentOpenCodeEntry> {
  const projSlug = toSlug(projectName) || "project";
  const agentSlug = toSlug(agent.name) || agent.name;

  // ── mode ────────────────────────────────────────────────────────────────
  const mode: "primary" | "subagent" = agent.isOrchestrator ? "primary" : "subagent";

  // ── prompt path ─────────────────────────────────────────────────────────
  const prompt = `{file:./prompt/${projSlug}/${agentSlug}.md}`;

  // ── opencode config from adataProperties ────────────────────────────────
  const ocConfig = agent.adataProperties?.opencode as Record<string, unknown> | undefined;

  const provider = typeof ocConfig?.provider === "string" ? ocConfig.provider : "";
  const model    = typeof ocConfig?.model    === "string" ? ocConfig.model    : "";
  const modelStr = provider && model ? `${provider}/${model}` : model || provider || "";

  const temperature = typeof ocConfig?.temperature === "number" && isFinite(ocConfig.temperature)
    ? ocConfig.temperature
    : 0.05;

  const rawSteps = ocConfig?.steps;
  const step: number | undefined =
    typeof rawSteps === "number" && isFinite(rawSteps) && rawSteps !== null
      ? rawSteps
      : undefined;

  const color = typeof ocConfig?.color === "string" && ocConfig.color
    ? ocConfig.color
    : "#ffffff";

  // ── hidden: only present when Sub-Agent AND hidden === true ──────────────
  const isSubAgent = agent.agentType === "Sub-Agent";
  const adataHidden = typeof ocConfig?.hidden === "boolean" ? ocConfig.hidden : false;
  const includeHidden = isSubAgent && adataHidden;

  // ── permissions ─────────────────────────────────────────────────────────
  const rawPerms = agent.adataProperties?.permissions;
  const permissions: PermissionsObject | undefined =
    rawPerms && typeof rawPerms === "object" && !Array.isArray(rawPerms) && Object.keys(rawPerms).length > 0
      ? (rawPerms as PermissionsObject)
      : undefined;

  // ── assemble entry ───────────────────────────────────────────────────────
  const entry: AgentOpenCodeEntry = {
    enabled: true,
    ...(includeHidden ? { hidden: true } : {}),
    mode,
    prompt,
    description: agent.description,
    model: modelStr,
    temperature,
    ...(step !== undefined ? { step } : {}),
    color,
    ...(permissions !== undefined ? { permissions } : {}),
  };

  return { [agent.name]: entry };
}

// ── OpenCode output shape ──────────────────────────────────────────────────

/** The shape of the generated OpenCode config JSON */
export interface OpenCodeOutput {
  $schema?: string;
  "auto-update"?: boolean;
  "default-agent"?: string;
  agents: OpenCodeAgentOutput[];
  plugins?: string[];
}

export interface OpenCodeAgentOutput {
  name: string;
  description?: string;
  system?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  steps?: number;
  /** Whether the agent is marked as orchestrator in the flow */
  instructions?: string;
  [key: string]: unknown;
}

// ── Core export function ───────────────────────────────────────────────────

/**
 * Builds an OpenCode configuration object from the given project data.
 *
 * This is a pure function — no side effects.
 *
 * @param agents     - Array of agent snapshots
 * @param connections - Array of serializable connections
 * @param config     - OpenCode export configuration
 * @returns The generated config as a plain object (ready for JSON.stringify)
 */
export function buildOpenCodeConfig(
  agents: AgentExportSnapshot[],
  connections: SerializableConnection[],
  config: OpenCodeExportConfig,
): OpenCodeOutput {
  const output: OpenCodeOutput = {
    agents: [],
  };

  // Include $schema if non-empty
  if (config.schemaUrl.trim()) {
    output.$schema = config.schemaUrl.trim();
  }

  // Include auto-update
  if (config.autoUpdate !== undefined) {
    output["auto-update"] = config.autoUpdate;
  }

  // Include default-agent if one is selected
  if (config.defaultAgentId) {
    const defaultAgent = agents.find((a) => a.id === config.defaultAgentId);
    if (defaultAgent) {
      output["default-agent"] = defaultAgent.name;
    }
  }

  // Build agents array
  output.agents = agents.map((agent) => {
    const agentOut: OpenCodeAgentOutput = {
      name: agent.name,
    };

    if (agent.description) {
      agentOut.description = agent.description;
    }

    // Profile content → system prompt
    if (agent.profileContent && agent.profileContent.trim()) {
      agentOut.system = agent.profileContent.trim();
    }

    // OpenCode adapter config
    const ocConfig = agent.adataProperties?.opencode as Record<string, unknown> | undefined;
    if (ocConfig) {
      if (typeof ocConfig.provider === "string" && ocConfig.provider) {
        agentOut.provider = ocConfig.provider;
      }
      if (typeof ocConfig.model === "string" && ocConfig.model) {
        agentOut.model = ocConfig.model;
      }
      if (typeof ocConfig.temperature === "number") {
        agentOut.temperature = ocConfig.temperature;
      }
      if (typeof ocConfig.steps === "number" && ocConfig.steps !== null) {
        agentOut.steps = ocConfig.steps;
      }
    }

    return agentOut;
  });

  // Include plugins
  const validPlugins = config.plugins
    .map((p) => p.path.trim())
    .filter((p) => p.length > 0);
  if (validPlugins.length > 0) {
    output.plugins = validPlugins;
  }

  return output;
}

/**
 * Serializes the OpenCode output to a formatted JSON string.
 *
 * @param output     - The OpenCode config object
 * @param extension  - "json" or "jsonc"
 * @returns Formatted JSON string
 */
export function serializeOpenCodeOutput(
  output: OpenCodeOutput,
  extension: "json" | "jsonc",
): string {
  // Both json and jsonc use JSON.stringify — jsonc just has a different file extension
  // In a future version, jsonc could include comments for documentation.
  void extension; // currently same serialization for both
  return JSON.stringify(output, null, 2);
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates OpenCodeExportConfig and returns whether the Export button
 * should be enabled.
 *
 * Rules:
 *   - schemaUrl: may be empty (just means no $schema key in output)
 *   - fileExtension: must be "json" or "jsonc"
 *   - plugins: each non-empty path must end with .js or .ts
 *
 * @returns true if config is valid and export can proceed
 */
export function isOpenCodeConfigValid(config: OpenCodeExportConfig): boolean {
  if (!["json", "jsonc"].includes(config.fileExtension)) return false;

  for (const plugin of config.plugins) {
    const p = plugin.path.trim();
    if (p && !p.endsWith(".js") && !p.endsWith(".ts")) {
      return false;
    }
  }

  return true;
}

/**
 * Validates all plugin entries and returns an updated array with errors set.
 */
export function validatePlugins(plugins: PluginEntry[]): { entries: PluginEntry[]; hasErrors: boolean } {
  let hasErrors = false;

  const entries = plugins.map((p) => {
    const trimmed = p.path.trim();
    let error: string | undefined;

    if (trimmed && !trimmed.endsWith(".js") && !trimmed.endsWith(".ts")) {
      error = "Plugin path must end with .js or .ts";
      hasErrors = true;
    }

    return { ...p, error };
  });

  return { entries, hasErrors };
}

// ── Relation helpers ───────────────────────────────────────────────────────

/**
 * Computes the inbound and outbound relations for a given agent.
 *
 * @param agentId   - The agent's UUID (or "user-node")
 * @param agents    - All agents in the project
 * @param connections - All connections in the project
 * @returns AgentRelations for the given agent
 */
export function getAgentRelations(
  agentId: string,
  agents: Pick<SerializableAgentModel, "id" | "name">[],
  connections: SerializableConnection[],
): AgentRelations {
  const findName = (id: string) => {
    if (id === "user-node") return "User";
    return agents.find((a) => a.id === id)?.name ?? id;
  };

  const inbound: AgentRelationEntry[] = connections
    .filter((c) => c.toAgentId === agentId)
    .map((c) => ({
      agentId: c.fromAgentId,
      agentName: findName(c.fromAgentId),
      ruleType: c.metadata?.relationType ?? "Delegation",
      delegationType: c.metadata?.delegationType,
      ruleDetails: c.metadata?.ruleDetails,
    }));

  const outbound: AgentRelationEntry[] = connections
    .filter((c) => c.fromAgentId === agentId)
    .map((c) => ({
      agentId: c.toAgentId,
      agentName: findName(c.toAgentId),
      ruleType: c.metadata?.relationType ?? "Delegation",
      delegationType: c.metadata?.delegationType,
      ruleDetails: c.metadata?.ruleDetails,
    }));

  return { inbound, outbound };
}

// ── Adapter registry ───────────────────────────────────────────────────────

/** Supported export adapter identifiers */
export type ExportAdapterId = "opencode";

/** Human-readable adapter labels */
export const EXPORT_ADAPTER_LABELS: Record<ExportAdapterId, string> = {
  opencode: "OpenCode",
};

/** All available adapter IDs */
export const EXPORT_ADAPTER_IDS: ExportAdapterId[] = ["opencode"];

// ── OpenCode V2 output shape ───────────────────────────────────────────────
//
// The V2 format uses the opencode.json structure expected by OpenCode ≥1.x:
//
//   {
//     "$schema":      "...",
//     "default_agent": "<agentName>",
//     "autoupdate":   true,
//     "watcher":      { "ignore": [...] },
//     "plugin":       [...strings...],
//     "mcp":          {},
//     "agent": {
//       "<agentName>": {
//         "enabled":     true,
//         "mode":        "primary" | "subagent",
//         "prompt":      "{file:./prompts/[project]/[agentName].md}",
//         "model":       "<provider/model>",
//         "description": "...",
//         "temperature": <number>,
//         "step":        <number>,
//         "permission":  { ... },
//         "color":       "<hex>"
//       }
//     }
//   }
//
// Rules:
//   - ALL fields must always be present — no optional omissions.
//   - agentName key and .md filename are VERBATIM from .adata (no slugification).
//   - mode = agentType "Agent"→"primary", "Sub-Agent"→"subagent"
//   - prompt uses "prompts" (plural) directory
//   - model is "<provider>/<model>" in lowercase
//   - step defaults to 7 when missing or null
//   - permission is {} when agent has no permissions
//   - If any required source field is absent, buildOpenCodeV2Config throws

/** Watcher ignore patterns always included in V2 output */
export const OPENCODE_V2_WATCHER_IGNORE = [
  "node_modules/**",
  "dist/**",
  ".git/**",
] as const;

/**
 * The exact shape of one agent's entry in the OpenCode V2 config.
 *
 * ALL fields are required — none may be omitted.
 * hidden is always present: true when opencode.hidden===true in .adata, false otherwise.
 */
export interface OpenCodeV2AgentEntry {
  enabled: true;
  hidden: boolean;
  mode: "primary" | "subagent";
  prompt: string;
  model: string;
  description: string;
  temperature: number;
  step: number;
  permission: PermissionsObject | Record<string, never>;
  color: string;
}

/** The full shape of the generated OpenCode V2 config JSON */
export interface OpenCodeV2Output {
  $schema: string;
  default_agent: string;
  autoupdate: boolean;
  watcher: { ignore: string[] };
  plugin: string[];
  mcp: Record<string, unknown>;
  agent: Record<string, OpenCodeV2AgentEntry>;
}

/**
 * Builds the OpenCode V2 JSON entry for a single agent.
 *
 * All fields are always present. Defaults are applied for missing optional
 * source values (temperature→0.05, step→7, color→#ffffff, permission→{}).
 *
 * agentName is verbatim from agent.name — NOT slugified.
 * prompt path uses "prompts" (plural) and verbatim project/agent names.
 * model is "<provider>/<model>" in lowercase.
 * mode is derived from agentType: "Agent"→"primary", "Sub-Agent"→"subagent".
 *
 * @throws Error if agent.name is empty (cannot build a valid key)
 */
export function buildOpenCodeV2AgentEntry(
  agent: AgentExportSnapshot,
  projectName: string,
): Record<string, OpenCodeV2AgentEntry> {
  const agentName = agent.name;
  if (!agentName) {
    throw new Error(`Agent ID "${agent.id}" has an empty agentName — cannot build V2 config entry.`);
  }

  // ── mode — derived from agentType (not isOrchestrator) ────────────────
  const mode: "primary" | "subagent" =
    agent.agentType === "Agent" ? "primary" : "subagent";

  // ── prompt — verbatim names, "prompts" directory (plural) ─────────────
  const prompt = `{file:./prompts/${projectName.toLowerCase()}/${agentName}.md}`;

  // ── opencode config from adataProperties ──────────────────────────────
  const ocConfig = agent.adataProperties?.opencode as Record<string, unknown> | undefined;

  const provider = typeof ocConfig?.provider === "string" ? ocConfig.provider : "";
  const model    = typeof ocConfig?.model    === "string" ? ocConfig.model    : "";
  const combined = provider && model ? `${provider}/${model}` : model || provider || "";
  const modelStr = combined.toLowerCase();

  const temperature =
    typeof ocConfig?.temperature === "number" && isFinite(ocConfig.temperature)
      ? ocConfig.temperature
      : 0.05;

  const rawSteps = ocConfig?.steps;
  const step: number =
    typeof rawSteps === "number" && isFinite(rawSteps)
      ? rawSteps
      : 7;

  const color =
    typeof ocConfig?.color === "string" && ocConfig.color
      ? ocConfig.color
      : "#ffffff";

  // ── permission — always present, even when empty ───────────────────────
  const rawPerms = agent.adataProperties?.permissions;
  const permission: PermissionsObject | Record<string, never> =
    rawPerms && typeof rawPerms === "object" && !Array.isArray(rawPerms)
      ? (rawPerms as PermissionsObject)
      : {};

  // ── hidden — always present; true only when opencode.hidden === true ────
  const hidden: boolean = ocConfig?.hidden === true;

  const entry: OpenCodeV2AgentEntry = {
    enabled: true,
    hidden,
    mode,
    prompt,
    model: modelStr,
    description: agent.description,
    temperature,
    step,
    permission,
    color,
  };

  return { [agentName]: entry };
}

/**
 * Builds an OpenCode V2 configuration object.
 *
 * ALL top-level fields are always present.
 * - $schema defaults to "https://opencode.ai/config.json" when schemaUrl is empty.
 * - default_agent is the verbatim name of the selected agent, or "" if none.
 * - plugin is the list of non-empty plugin paths.
 * - mcp is always {}.
 * - watcher is always { ignore: OPENCODE_V2_WATCHER_IGNORE }.
 *
 * Agent inclusion rules (BOTH must be satisfied):
 *   1. The agent has non-empty opencode.provider AND opencode.model in .adata.
 *   2. mdFileExists(projectName, agentName) returns true.
 *
 * @param agents         - All agent snapshots
 * @param config         - Export configuration
 * @param projectName    - Verbatim project name (folder is lowercased internally)
 * @param mdFileExists   - Optional predicate: (projectName, agentName) => boolean.
 *                         Defaults to () => true. Pass a real filesystem check in
 *                         production; pass a stub in tests.
 *
 * @throws Error if any included agent has an empty name (see buildOpenCodeV2AgentEntry).
 */
export function buildOpenCodeV2Config(
  agents: AgentExportSnapshot[],
  config: OpenCodeExportConfig,
  projectName: string,
  mdFileExists: (projectName: string, agentName: string) => boolean = () => true,
): OpenCodeV2Output {
  // ── agent inclusion filter ─────────────────────────────────────────────
  const includedAgents = agents.filter((agent) => {
    // Rule 1: must have both provider and model defined (non-empty strings)
    const ocConfig = agent.adataProperties?.opencode as Record<string, unknown> | undefined;
    const provider = typeof ocConfig?.provider === "string" ? ocConfig.provider.trim() : "";
    const model    = typeof ocConfig?.model    === "string" ? ocConfig.model.trim()    : "";
    if (!provider || !model) return false;

    // Rule 2: the .md profile file must exist
    if (!mdFileExists(projectName, agent.name)) return false;

    return true;
  });

  // default_agent — verbatim name from the selected agent
  let default_agent = "";
  if (config.defaultAgentId) {
    const defaultAgent = agents.find((a) => a.id === config.defaultAgentId);
    if (defaultAgent) {
      default_agent = defaultAgent.name;
    }
  }

  // plugin — non-empty paths only
  const plugin = config.plugins
    .map((p) => p.path.trim())
    .filter((p) => p.length > 0);

  // agent object — keyed by verbatim agentName, only included agents
  const agentObj: Record<string, OpenCodeV2AgentEntry> = {};
  for (const agent of includedAgents) {
    const entry = buildOpenCodeV2AgentEntry(agent, projectName);
    Object.assign(agentObj, entry);
  }

  // ── Inject hidden overrides for built-in OpenCode agents ──────────────────
  //
  // If config.hideDefaultPlanner is true → inject { hidden: true } under "plan".
  // If config.hideDefaultBuilder is true → inject { hidden: true } under "build".
  //
  // These are minimal synthetic entries recognised by OpenCode to suppress its
  // built-in plan/build agents. They are cast to OpenCodeV2AgentEntry to satisfy
  // the map type — at runtime OpenCode only reads the "hidden" field for these.
  //
  // The injection is SKIPPED (with a console warning) when a real agent with that
  // name was already included from includedAgents — to avoid silently overwriting
  // a user-defined agent called "plan" or "build".
  //
  // See: OpenCodeExportConfig.hideDefaultPlanner / hideDefaultBuilder
  if (config.hideDefaultPlanner) {
    if ("plan" in agentObj) {
      console.warn(
        "Export: omitida inyección de campo hidden para plan/build; ya existe un agente real con ese nombre",
      );
    } else {
      agentObj["plan"] = { hidden: true } as unknown as OpenCodeV2AgentEntry;
    }
  }

  if (config.hideDefaultBuilder) {
    if ("build" in agentObj) {
      console.warn(
        "Export: omitida inyección de campo hidden para plan/build; ya existe un agente real con ese nombre",
      );
    } else {
      agentObj["build"] = { hidden: true } as unknown as OpenCodeV2AgentEntry;
    }
  }

  return {
    $schema:       config.schemaUrl.trim() || OPENCODE_SCHEMA_URL_DEFAULT,
    default_agent,
    autoupdate:    config.autoUpdate,
    watcher:       { ignore: [...OPENCODE_V2_WATCHER_IGNORE] },
    plugin,
    mcp:           {},
    agent:         agentObj,
  };
}

/**
 * Serializes the OpenCode V2 output to a formatted JSON string.
 *
 * Both "json" and "jsonc" use the same serialization — jsonc has a
 * different file extension but the same content (no embedded comments).
 */
export function serializeOpenCodeV2Output(
  output: OpenCodeV2Output,
  extension: "json" | "jsonc",
): string {
  void extension;
  return JSON.stringify(output, null, 2);
}
