/**
 * src/ui/components/PropertiesPanel.tsx
 *
 * Right-side contextual properties panel for AgentsFlow.
 *
 * Behaviour:
 *   - Fixed on the right edge of the editor canvas area.
 *   - Collapsible/expandable via a header button ([>] to collapse, [<] to expand).
 *   - Animated width transition on collapse/expand (CSS transition).
 *   - Panel state (open/closed) lives in agentFlowStore (panelOpen).
 *   - On mount, restores panelOpen from .afproj (ui.panelOpen) via projectStore.
 *
 * Content is context-sensitive based on selectionContext:
 *   "none"  → placeholder: "Select an agent or connection to edit its properties."
 *   "node"  → AgentAdapterForm (adapter section)
 *   "link"  → Link rule editing form (ruleType toggle + delegationType select + ruleDetails textarea)
 *
 * The link rule form reads/writes through agentFlowStore.updateLink(id, fields).
 * Changes are reflected immediately in-memory and synced to .afproj via projectStore.
 *
 * Rule Type toggle:
 *   - The user can freely select either "Delegation" or "Response" for any link.
 *   - There are no graph-based or algorithmic restrictions.
 *
 * The panel uses a flex-row sibling layout inside editor-view__main so it
 * never blocks canvas panning/zooming. pointer-events are managed carefully.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAgentFlowStore } from "../store/agentFlowStore.ts";
import { useProjectStore } from "../store/projectStore.ts";
import type { LinkRuleType, DelegationType } from "../store/agentFlowStore.ts";
import type { PermissionsModalTarget } from "../store/agentFlowStore.ts";
import { SelectModelModal } from "./SelectModelModal.tsx";

// ── Placeholder message map ────────────────────────────────────────────────

const PLACEHOLDER_MESSAGES = {
  none: "Select an agent or connection to edit its properties.",
} as const;

// ── AgentAdapterForm ──────────────────────────────────────────────────────
// Rendered inside the content area when selectionContext === "node".

interface AgentAdapterFormProps {
  agentId: string;
}

/** Adapter options available to the user */
const ADAPTER_OPTIONS = [
  { value: "", label: "None" },
  { value: "opencode", label: "OpenCode" },
] as const;

type AdapterValue = "" | "opencode";

/** Provider options for the OpenCode adapter */
const OPENCODE_PROVIDERS: string[] = [
  "GitHub-Copilot",
  "OpenAI",
  "OpenRouter",
  "ClaudeCode",
  "Ollama",
  "OpenCode-Zen",
  "OpenCode-Go",
];

// ── Temperature helpers ────────────────────────────────────────────────────
// Temperature is stored as a float (0.0..1.0) in .adata[opencode.temperature].
// The UI field is a number input (type="number", min=0.0, max=1.0, step=0.01).

/** Default temperature as float (0.5 = balanced value) */
export const OPENCODE_TEMPERATURE_DEFAULT = 0.5;

/** Help text displayed below the temperature input field */
export const OPENCODE_TEMPERATURE_HELP_TEXT =
  "0 = less randomness — 1.0 = more randomness";

/**
 * Returns true if the temperature value is a finite number in [0.0, 1.0].
 * Returns false for NaN, Infinity, values below 0, or values above 1.
 * @example isValidTemperature(0.5) → true
 * @example isValidTemperature(NaN) → false
 * @example isValidTemperature(1.01) → false
 */
export function isValidTemperature(value: number): boolean {
  return typeof value === "number" && isFinite(value) && value >= 0.0 && value <= 1.0;
}

// ── Hidden field helpers ───────────────────────────────────────────────────
// Hidden is stored as a boolean in .adata[opencode.hidden].
// The toggle is only visible when the agent is a Sub-Agent.

/** Default hidden value */
export const OPENCODE_HIDDEN_DEFAULT = false;

/** Tooltip text shown when the ? button is clicked */
export const OPENCODE_HIDDEN_TOOLTIP_TEXT =
  "When enabled, this sub-agent will not appear in the @ autocomplete menu for other agents.";

/** Label shown when hidden is true */
export const OPENCODE_HIDDEN_LABEL_TRUE = "Hidden";

/** Label shown when hidden is false */
export const OPENCODE_HIDDEN_LABEL_FALSE = "Visible";

// ── Steps field helpers ────────────────────────────────────────────────────
// Steps is stored as a number in .adata[opencode.steps].
// Optional integer, min=7, max=100, default=7.

/** Default steps value */
export const OPENCODE_STEPS_DEFAULT = 7;

/** Minimum steps value */
export const OPENCODE_STEPS_MIN = 7;

/** Maximum steps value */
export const OPENCODE_STEPS_MAX = 100;

/**
 * Returns true if the steps value is a valid integer in [STEPS_MIN, STEPS_MAX],
 * or if the field is empty (optional).
 */
export function isValidSteps(value: number | null): boolean {
  if (value === null) return true;
  return (
    typeof value === "number" &&
    isFinite(value) &&
    Number.isInteger(value) &&
    value >= OPENCODE_STEPS_MIN &&
    value <= OPENCODE_STEPS_MAX
  );
}

// ── Color field helpers ────────────────────────────────────────────────────
// Color is stored as a hex string in .adata[opencode.color].
// Required, default "#ffffff".

/** Default color value */
export const OPENCODE_COLOR_DEFAULT = "#ffffff";

/** Regex for valid hex color strings: #RRGGBB or #RGB */
export const OPENCODE_COLOR_HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Returns true if the value is a valid hex color string (#RGB or #RRGGBB).
 */
export function isValidColor(value: string): boolean {
  return typeof value === "string" && OPENCODE_COLOR_HEX_REGEX.test(value);
}

function AgentAdapterForm({ agentId }: AgentAdapterFormProps) {
  const project = useProjectStore((s) => s.project);

  // ── Local UI state ─────────────────────────────────────────────────────
  /** The value currently shown in the dropdown */
  const [selectedAdapter, setSelectedAdapter] = useState<AdapterValue>("");
  /** The adapter that has been successfully created (persisted in .adata) */
  const [createdAdapter, setCreatedAdapter] = useState<string | null>(null);
  /** Whether the initial adapter value has been loaded from .adata */
  const [isLoaded, setIsLoaded] = useState(false);
  /** Inline error text below the selector */
  const [inlineError, setInlineError] = useState<string | null>(null);
  /** Whether to show the floating toast */
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  /** Whether "Adapter created!" success text should show */
  const [showSuccess, setShowSuccess] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load existing adapter from .adata on agentId / project change ──────
  useEffect(() => {
    if (!project) return;

    setIsLoaded(false);
    setCreatedAdapter(null);
    setSelectedAdapter("");
    setInlineError(null);
    setShowSuccess(false);

    window.agentsFlow
      .adataGetAdapter({ projectDir: project.projectDir, agentId })
      .then((result) => {
        if (result.success && result.adapter) {
          setCreatedAdapter(result.adapter);
          setSelectedAdapter(result.adapter as AdapterValue);
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, [agentId, project?.projectDir]);

  // ── Toast management ───────────────────────────────────────────────────
  function showErrorToast(msg: string) {
    setToastMessage(msg);
    setShowToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setShowToast(false);
    }, 4000);
  }

  function dismissToast() {
    setShowToast(false);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }

  // ── Create Adapter button handler ──────────────────────────────────────
  async function handleCreateAdapter() {
    if (!project) return;

    // Clear previous success
    setShowSuccess(false);
    setInlineError(null);

    // Validate: must have a real adapter selected
    if (!selectedAdapter) {
      const msg = "Please select an adapter before creating.";
      setInlineError(msg);
      showErrorToast(msg);
      return;
    }

    // Validate: adapter must not already exist for this agent
    if (createdAdapter !== null) {
      const msg = `Adapter "${createdAdapter}" is already created for this agent.`;
      setInlineError(msg);
      showErrorToast(msg);
      return;
    }

    // Persist to .adata
    try {
      const result = await window.agentsFlow.adataSetAdapter({
        projectDir: project.projectDir,
        agentId,
        adapter: selectedAdapter,
      });

      if (!result.success) {
        const msg = result.error ?? "Failed to create adapter.";
        setInlineError(msg);
        showErrorToast(msg);
        return;
      }

      // Success
      setCreatedAdapter(selectedAdapter);
      setInlineError(null);
      setShowSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create adapter.";
      setInlineError(msg);
      showErrorToast(msg);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div className="agent-adapter-form">
        <div className="agent-adapter-form__loading">Loading...</div>
      </div>
    );
  }

  // Hide "None" option once an adapter has been created
  const visibleOptions = createdAdapter !== null
    ? ADAPTER_OPTIONS.filter((o) => o.value !== "")
    : ADAPTER_OPTIONS;

  return (
    <div className="agent-adapter-form">
      {/* ── Section heading ──────────────────────────────────────────────── */}
      <div className="agent-adapter-form__section-heading">Adapter</div>

      {/* ── Adapter selector ──────────────────────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="adapter-select"
        >
          Adapter type
        </label>
        <select
          id="adapter-select"
          className="form-field__select agent-adapter-form__select"
          value={selectedAdapter}
          onChange={(e) => {
            setSelectedAdapter(e.target.value as AdapterValue);
            setInlineError(null);
            setShowSuccess(false);
          }}
          aria-label="Select adapter"
          // Lock selector once adapter is created
          disabled={createdAdapter !== null}
        >
          {visibleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Inline error below selector */}
        {inlineError && (
          <span className="agent-adapter-form__inline-error" role="alert">
            {inlineError}
          </span>
        )}
      </div>

      {/* ── Create Adapter button ──────────────────────────────────────────── */}
      <button
        type="button"
        className="btn btn--primary agent-adapter-form__create-btn"
        onClick={handleCreateAdapter}
        disabled={createdAdapter !== null}
        aria-label="Create adapter"
      >
        Create Adapter
      </button>

      {/* Success message below button */}
      {showSuccess && (
        <span className="agent-adapter-form__success" role="status">
          Adapter created!
        </span>
      )}

      {/* ── OpenCode config fields (only when opencode adapter is active) ─── */}
      {createdAdapter === "opencode" && (
        <OpenCodeConfigForm agentId={agentId} />
      )}

      {/* ── Agent Profiles section (always visible once adapter is created) ── */}
      <AgentProfilesSection agentId={agentId} />

      {/* ── Permissions section (always visible once a node is selected) ───── */}
      <PermissionsSection agentId={agentId} />

      {/* ── Temperature field (opencode only, directly below profiles) ────── */}
      {createdAdapter === "opencode" && (
        <TemperatureField agentId={agentId} />
      )}

      {/* ── Floating error toast ────────────────────────────────────────────── */}
      {showToast && (
        <div className="agent-graph-toast agent-graph-toast--error" role="alert">
          <span>{toastMessage}</span>
          <button
            className="agent-graph-toast__close"
            onClick={dismissToast}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── AgentProfilesSection ───────────────────────────────────────────────────
// Shown in the Properties Panel below the Model field.
// Contains a "Manage Profiles" button that opens the AgentProfileModal portal.
// The modal itself is mounted at the App root level via React Portal so it
// escapes the PropertiesPanel stacking context and appears above all overlays.

interface AgentProfilesSectionProps {
  agentId: string;
}

function AgentProfilesSection({ agentId }: AgentProfilesSectionProps) {
  const project = useProjectStore((s) => s.project);
  const openProfileModal = useAgentFlowStore((s) => s.openProfileModal);

  // Find agent name from the flow store for the modal subtitle
  const agents = (useAgentFlowStore as typeof useAgentFlowStore)((s) => s.agents);
  const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;

  if (!project) return null;

  return (
    <div className="agent-profiles-section">
      <div className="agent-adapter-form__section-heading">Agent Profiles</div>
      <button
        type="button"
        className="btn btn--ghost agent-profiles-section__open-btn"
        onClick={() =>
          openProfileModal({
            agentId,
            agentName,
            projectDir: project.projectDir,
          })
        }
        aria-label="Manage agent profiles"
      >
        Manage Profiles
      </button>
    </div>
  );
}

// ── PermissionsSection ─────────────────────────────────────────────────────
// Shown in the Properties Panel below the Agent Profiles section.
// Always visible once a node is selected (not gated by adapter type).
// Contains a "Manage Permissions" button that opens the PermissionsModal portal.
// The modal itself is mounted at the App root level via React Portal so it
// escapes the PropertiesPanel stacking context and appears above all overlays.

interface PermissionsSectionProps {
  agentId: string;
}

function PermissionsSection({ agentId }: PermissionsSectionProps) {
  const project = useProjectStore((s) => s.project);
  const openPermissionsModal = useAgentFlowStore((s) => s.openPermissionsModal);

  // Find agent name from the flow store for the modal subtitle
  const agents = useAgentFlowStore((s) => s.agents);
  const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;

  if (!project) return null;

  return (
    <div className="permissions-section">
      <div className="agent-adapter-form__section-heading">Permissions</div>
      <button
        type="button"
        className="btn btn--ghost permissions-section__open-btn"
        onClick={() =>
          openPermissionsModal({
            agentId,
            agentName,
            projectDir: project.projectDir,
          } satisfies PermissionsModalTarget)
        }
        aria-label="Manage agent permissions"
      >
        Manage Permissions
      </button>
    </div>
  );
}

// ── TemperatureField ───────────────────────────────────────────────────────
// Allows the user to set the temperature as a float (0.0..1.0) via a number input.
// Shows help text, validates that the value is required and within [0.0, 1.0].

interface TemperatureFieldProps {
  agentId: string;
}

function TemperatureField({ agentId }: TemperatureFieldProps) {
  const project = useProjectStore((s) => s.project);

  // Determine agent type for conditional Hidden toggle visibility
  const agents = useAgentFlowStore((s) => s.agents);
  const updateAgent = useAgentFlowStore((s) => s.updateAgent);
  const agentFromStore = agents.find((a) => a.id === agentId);
  const agentType = agentFromStore?.type ?? "Agent";
  const isSubagent = agentType === "Sub-Agent";
  // Track the store's hidden value so we can detect external changes (e.g. modal save)
  const storeHidden = agentFromStore?.hidden ?? false;

  // ── Temperature state ─────────────────────────────────────────────────
  // Display as string to allow partial typing (e.g. "0."); persist as float
  const [rawValue, setRawValue] = useState<string>(String(OPENCODE_TEMPERATURE_DEFAULT));
  const [temperatureError, setTemperatureError] = useState<string | null>(null);

  // ── Hidden state ──────────────────────────────────────────────────────
  const [hidden, setHidden] = useState<boolean>(OPENCODE_HIDDEN_DEFAULT);
  const [showHiddenTooltip, setShowHiddenTooltip] = useState(false);

  // ── Steps state ───────────────────────────────────────────────────────
  // Display as string to allow partial typing; null means unset (use default)
  const [rawSteps, setRawSteps] = useState<string>(String(OPENCODE_STEPS_DEFAULT));
  const [stepsError, setStepsError] = useState<string | null>(null);

  // ── Color state ───────────────────────────────────────────────────────
  const [colorText, setColorText] = useState<string>(OPENCODE_COLOR_DEFAULT);
  const [colorError, setColorError] = useState<string | null>(null);

  // ── Loaded state ──────────────────────────────────────────────────────
  const [isLoaded, setIsLoaded] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sync hidden when store changes externally (e.g. modal save) ───────
  // Skip if the change was initiated by this component (handleHiddenToggle
  // already calls setHidden before this fires).
  const isLocalToggleRef = useRef(false);
  useEffect(() => {
    if (isLocalToggleRef.current) {
      isLocalToggleRef.current = false;
      return;
    }
    setHidden(storeHidden);
  }, [storeHidden]);

  // ── Load existing config from .adata ──────────────────────────────────
  useEffect(() => {
    if (!project) return;

    setIsLoaded(false);
    setRawValue(String(OPENCODE_TEMPERATURE_DEFAULT));
    setTemperatureError(null);
    setHidden(OPENCODE_HIDDEN_DEFAULT);
    setShowHiddenTooltip(false);
    setRawSteps(String(OPENCODE_STEPS_DEFAULT));
    setStepsError(null);
    setColorText(OPENCODE_COLOR_DEFAULT);
    setColorError(null);

    window.agentsFlow
      .adataGetOpenCodeConfig({ projectDir: project.projectDir, agentId })
      .then((result) => {
        if (result.success && result.config) {
          const cfg = result.config;
          // Temperature
          setRawValue(
            isValidTemperature(cfg.temperature)
              ? String(cfg.temperature)
              : String(OPENCODE_TEMPERATURE_DEFAULT)
          );
          // Hidden
          setHidden(typeof cfg.hidden === "boolean" ? cfg.hidden : OPENCODE_HIDDEN_DEFAULT);
          // Steps
          const steps = cfg.steps;
          setRawSteps(
            steps !== null && steps !== undefined ? String(steps) : String(OPENCODE_STEPS_DEFAULT)
          );
          // Color
          setColorText(
            isValidColor(cfg.color ?? "") ? cfg.color : OPENCODE_COLOR_DEFAULT
          );
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, [agentId, project?.projectDir]);

  // ── Generic persist: reads current state and writes all fields ─────────
  function persistAll(overrides: {
    temperature?: number;
    hidden?: boolean;
    steps?: number | null;
    color?: string;
  }) {
    if (!project) return;
    window.agentsFlow
      .adataGetOpenCodeConfig({ projectDir: project.projectDir, agentId })
      .then((result) => {
        const cfg = result.success && result.config ? result.config : null;
        const currentProvider = cfg ? cfg.provider : (OPENCODE_PROVIDERS[0] ?? "");
        const currentModel = cfg ? cfg.model : "";
        const currentTemp =
          "temperature" in overrides
            ? (overrides.temperature as number)
            : cfg && isValidTemperature(cfg.temperature)
            ? cfg.temperature
            : OPENCODE_TEMPERATURE_DEFAULT;
        const currentHidden =
          "hidden" in overrides
            ? (overrides.hidden as boolean)
            : cfg
            ? cfg.hidden
            : OPENCODE_HIDDEN_DEFAULT;
        const currentSteps =
          "steps" in overrides
            ? (overrides.steps as number | null)
            : cfg
            ? cfg.steps
            : OPENCODE_STEPS_DEFAULT;
        const currentColor =
          "color" in overrides
            ? (overrides.color as string)
            : cfg
            ? cfg.color
            : OPENCODE_COLOR_DEFAULT;
        return window.agentsFlow.adataSetOpenCodeConfig({
          projectDir: project.projectDir,
          agentId,
          config: {
            provider: currentProvider,
            model: currentModel,
            temperature: currentTemp,
            hidden: currentHidden,
            steps: currentSteps,
            color: currentColor,
          },
        });
      })
      .catch(() => {
        // Persist failure is silent — non-blocking
      });
  }

  // ── Temperature handlers ───────────────────────────────────────────────
  function handleTemperatureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const strVal = e.target.value;
    setRawValue(strVal);
    setTemperatureError(null);

    const numVal = parseFloat(strVal);

    if (strVal.trim() === "" || isNaN(numVal)) {
      setTemperatureError("Temperature is required.");
      return;
    }

    if (!isValidTemperature(numVal)) {
      setTemperatureError("Temperature must be between 0.0 and 1.0.");
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistAll({ temperature: numVal });
    }, 400);
  }

  function handleTemperatureBlur() {
    const numVal = parseFloat(rawValue);
    if (rawValue.trim() === "" || isNaN(numVal) || !isValidTemperature(numVal)) {
      setRawValue(String(OPENCODE_TEMPERATURE_DEFAULT));
      setTemperatureError(null);
      persistAll({ temperature: OPENCODE_TEMPERATURE_DEFAULT });
    }
  }

  // ── Hidden handlers ────────────────────────────────────────────────────
  function handleHiddenToggle() {
    const next = !hidden;
    isLocalToggleRef.current = true; // prevent sync effect from overwriting our optimistic update
    setHidden(next);
    persistAll({ hidden: next });
    // Keep agentFlowStore in sync so AgentEditModal reads the latest value
    updateAgent(agentId, { hidden: next });
  }

  // ── Steps handlers ─────────────────────────────────────────────────────
  function handleStepsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const strVal = e.target.value;
    setRawSteps(strVal);
    setStepsError(null);

    // Allow empty string — treated as default
    if (strVal.trim() === "") {
      if (stepsSaveTimerRef.current) clearTimeout(stepsSaveTimerRef.current);
      stepsSaveTimerRef.current = setTimeout(() => {
        persistAll({ steps: OPENCODE_STEPS_DEFAULT });
      }, 400);
      return;
    }

    const numVal = parseInt(strVal, 10);
    if (isNaN(numVal) || !isValidSteps(numVal)) {
      setStepsError(`Steps must be a whole number between ${OPENCODE_STEPS_MIN} and ${OPENCODE_STEPS_MAX}.`);
      return;
    }

    if (stepsSaveTimerRef.current) clearTimeout(stepsSaveTimerRef.current);
    stepsSaveTimerRef.current = setTimeout(() => {
      persistAll({ steps: numVal });
    }, 400);
  }

  function handleStepsBlur() {
    const numVal = parseInt(rawSteps, 10);
    if (rawSteps.trim() === "" || isNaN(numVal) || !isValidSteps(numVal)) {
      setRawSteps(String(OPENCODE_STEPS_DEFAULT));
      setStepsError(null);
      persistAll({ steps: OPENCODE_STEPS_DEFAULT });
    }
  }

  // ── Color handlers ─────────────────────────────────────────────────────
  function handleColorTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setColorText(val);
    setColorError(null);

    if (!isValidColor(val)) {
      setColorError("Color must be a valid hex value (e.g. #ffffff).");
      return;
    }

    persistAll({ color: val });
  }

  function handleColorPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setColorText(val);
    setColorError(null);
    persistAll({ color: val });
  }

  function handleColorBlur() {
    if (!isValidColor(colorText)) {
      setColorText(OPENCODE_COLOR_DEFAULT);
      setColorError(null);
      persistAll({ color: OPENCODE_COLOR_DEFAULT });
    }
  }

  if (!isLoaded) return null;

  return (
    <div className="opencode-temperature-section">
      <div className="agent-adapter-form__section-heading">OpenCode Settings</div>

      {/* ── Temperature number input ──────────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="opencode-temperature-input"
        >
          Temperature
        </label>
        <input
          id="opencode-temperature-input"
          type="number"
          className={[
            "form-field__input",
            "opencode-config-form__temperature-input",
            temperatureError ? "opencode-config-form__temperature-input--error" : "",
          ].filter(Boolean).join(" ")}
          value={rawValue}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={handleTemperatureChange}
          onBlur={handleTemperatureBlur}
          aria-label="OpenCode temperature"
          aria-describedby="opencode-temperature-help"
          aria-invalid={temperatureError !== null}
          autoComplete="off"
          required
        />
        {temperatureError && (
          <span
            className="agent-adapter-form__inline-error"
            role="alert"
            id="opencode-temperature-error"
          >
            {temperatureError}
          </span>
        )}
        <span
          className="opencode-config-form__temperature-help"
          id="opencode-temperature-help"
        >
          {OPENCODE_TEMPERATURE_HELP_TEXT}
        </span>
      </div>

      {/* ── Hidden toggle (sub-agent only) ────────────────────────────── */}
      {isSubagent && (
        <div className="agent-adapter-form__field opencode-hidden-field">
          <div className="opencode-hidden-field__label-row">
            <label
              className="agent-adapter-form__label"
              htmlFor="opencode-hidden-toggle"
            >
              Hidden
            </label>
            {/* ? help button */}
            <button
              type="button"
              className="opencode-hidden-field__help-btn"
              aria-label="Hidden field help"
              onClick={() => setShowHiddenTooltip((v) => !v)}
            >
              ?
            </button>
          </div>
          {showHiddenTooltip && (
            <div
              className="opencode-hidden-field__tooltip"
              role="tooltip"
              id="opencode-hidden-tooltip"
            >
              {OPENCODE_HIDDEN_TOOLTIP_TEXT}
            </div>
          )}
          <label
            htmlFor="opencode-hidden-toggle"
            className="agent-hidden-toggle__track"
          >
            <input
              id="opencode-hidden-toggle"
              type="checkbox"
              className="agent-hidden-toggle__input"
              checked={hidden}
              onChange={() => handleHiddenToggle()}
              aria-label={hidden ? "Hidden: true" : "Hidden: false"}
            />
            <span className="agent-hidden-toggle__thumb" aria-hidden="true" />
          </label>
        </div>
      )}

      {/* ── Steps number input (optional) ─────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="opencode-steps-input"
        >
          Steps
          <span className="link-rule-form__label-optional"> (optional)</span>
        </label>
        <input
          id="opencode-steps-input"
          type="number"
          className={[
            "form-field__input",
            "opencode-config-form__steps-input",
            stepsError ? "opencode-config-form__steps-input--error" : "",
          ].filter(Boolean).join(" ")}
          value={rawSteps}
          min={OPENCODE_STEPS_MIN}
          max={OPENCODE_STEPS_MAX}
          step={1}
          onChange={handleStepsChange}
          onBlur={handleStepsBlur}
          aria-label="OpenCode steps"
          aria-invalid={stepsError !== null}
          autoComplete="off"
        />
        {stepsError && (
          <span
            className="agent-adapter-form__inline-error"
            role="alert"
            id="opencode-steps-error"
          >
            {stepsError}
          </span>
        )}
      </div>

      {/* ── Color picker + hex text input ─────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="opencode-color-text"
        >
          Color
        </label>
        <div className="opencode-color-field__row">
          <input
            id="opencode-color-picker"
            type="color"
            className="opencode-color-field__picker"
            value={isValidColor(colorText) ? colorText : OPENCODE_COLOR_DEFAULT}
            onChange={handleColorPickerChange}
            aria-label="OpenCode color picker"
          />
          <input
            id="opencode-color-text"
            type="text"
            className={[
              "form-field__input",
              "opencode-color-field__text",
              colorError ? "opencode-color-field__text--error" : "",
            ].filter(Boolean).join(" ")}
            value={colorText}
            onChange={handleColorTextChange}
            onBlur={handleColorBlur}
            placeholder="#ffffff"
            aria-label="OpenCode color hex value"
            aria-invalid={colorError !== null}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        {colorError && (
          <span
            className="agent-adapter-form__inline-error"
            role="alert"
            id="opencode-color-error"
          >
            {colorError}
          </span>
        )}
      </div>
    </div>
  );
}

// ── OpenCodeConfigForm ─────────────────────────────────────────────────────
// Rendered below the adapter section when adapter === "opencode".
// Shows a Provider dropdown and a Model text input.
// Both values are persisted under the 'opencode' key in .adata.

interface OpenCodeConfigFormProps {
  agentId: string;
}

function OpenCodeConfigForm({ agentId }: OpenCodeConfigFormProps) {
  const project = useProjectStore((s) => s.project);

  const [provider, setProvider] = useState<string>(OPENCODE_PROVIDERS[0] ?? "");
  const [model, setModel] = useState<string>("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectModelOpen, setSelectModelOpen] = useState(false);

  // Track last persisted provider+model to avoid redundant writes
  const lastPersistedRef = useRef<{ provider: string; model: string } | null>(null);

  // ── Load existing config from .adata ────────────────────────────────────
  useEffect(() => {
    if (!project) return;

    setIsLoaded(false);
    setProvider(OPENCODE_PROVIDERS[0] ?? "");
    setModel("");
    lastPersistedRef.current = null;

    window.agentsFlow
      .adataGetOpenCodeConfig({ projectDir: project.projectDir, agentId })
      .then((result) => {
        if (result.success && result.config) {
          setProvider(result.config.provider || (OPENCODE_PROVIDERS[0] ?? ""));
          setModel(result.config.model || "");
          lastPersistedRef.current = {
            provider: result.config.provider || (OPENCODE_PROVIDERS[0] ?? ""),
            model: result.config.model || "",
          };
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, [agentId, project?.projectDir]);

  // ── Persist helper (provider + model only; other fields handled separately) ─
  const persist = useCallback(
    (nextProvider: string, nextModel: string) => {
      if (!project) return;
      // Avoid redundant writes
      const last = lastPersistedRef.current;
      if (last && last.provider === nextProvider && last.model === nextModel) return;
      lastPersistedRef.current = { provider: nextProvider, model: nextModel };
      // Read current full config to include in write
      window.agentsFlow
        .adataGetOpenCodeConfig({ projectDir: project.projectDir, agentId })
        .then((result) => {
          const cfg = result.success && result.config ? result.config : null;
          const currentTemp =
            cfg && isValidTemperature(cfg.temperature)
              ? cfg.temperature
              : OPENCODE_TEMPERATURE_DEFAULT;
          const currentHidden = cfg ? cfg.hidden : OPENCODE_HIDDEN_DEFAULT;
          const currentSteps = cfg ? cfg.steps : OPENCODE_STEPS_DEFAULT;
          const currentColor = cfg ? cfg.color : OPENCODE_COLOR_DEFAULT;
          return window.agentsFlow.adataSetOpenCodeConfig({
            projectDir: project.projectDir,
            agentId,
            config: {
              provider: nextProvider,
              model: nextModel,
              temperature: currentTemp,
              hidden: currentHidden,
              steps: currentSteps,
              color: currentColor,
            },
          });
        })
        .catch(() => {
          // Persist failure is silent — non-blocking
        });
    },
    [agentId, project]
  );

  if (!isLoaded) return null;

  return (
    <div className="opencode-config-form">
      {/* ── Section heading ─────────────────────────────────────────── */}
      <div className="agent-adapter-form__section-heading">OpenCode Settings</div>

      {/* ── Select Model button ──────────────────────────────────────── */}
      <button
        type="button"
        className="btn btn--secondary select-model-btn"
        onClick={() => setSelectModelOpen(true)}
        aria-label="Open model selector"
      >
        Select Model
      </button>

      {/* ── Select Model modal ───────────────────────────────────────── */}
      <SelectModelModal
        open={selectModelOpen}
        onClose={() => setSelectModelOpen(false)}
        onSelectModel={(modelId) => {
          // modelId is "provider/model" — split and persist both fields
          const slashIdx = modelId.indexOf("/");
          if (slashIdx !== -1) {
            const selectedProvider = modelId.slice(0, slashIdx);
            const selectedModel = modelId.slice(slashIdx + 1);
            setProvider(selectedProvider);
            setModel(selectedModel);
            persist(selectedProvider, selectedModel);
          } else {
            // Fallback: treat entire string as model name
            setModel(modelId);
            persist(provider, modelId);
          }
        }}
      />

      {/* ── Provider readonly input ──────────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="opencode-provider-input"
        >
          Provider
        </label>
        <input
          id="opencode-provider-input"
          type="text"
          className="form-field__input opencode-config-form__readonly-input"
          value={provider}
          readOnly
          aria-label="OpenCode provider"
          aria-readonly="true"
          tabIndex={-1}
        />
      </div>

      {/* ── Model readonly input ─────────────────────────────────────── */}
      <div className="agent-adapter-form__field">
        <label
          className="agent-adapter-form__label"
          htmlFor="opencode-model-input"
        >
          Model
        </label>
        <input
          id="opencode-model-input"
          type="text"
          className="form-field__input opencode-config-form__readonly-input"
          value={model}
          readOnly
          placeholder="No model selected"
          aria-label="OpenCode model"
          aria-readonly="true"
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

// ── LinkRuleForm ───────────────────────────────────────────────────────────
// Rendered inside the content area when selectionContext === "link".

interface LinkRuleFormProps {
  linkId: string;
}

function LinkRuleForm({ linkId }: LinkRuleFormProps) {
  const links = useAgentFlowStore((s) => s.links);
  const updateLink = useAgentFlowStore((s) => s.updateLink);
  const saveProject = useProjectStore((s) => s.saveProject);
  const project = useProjectStore((s) => s.project);

  const link = links.find((l) => l.id === linkId);

  if (!link) {
    return (
      <div className="properties-panel__placeholder">
        <span className="properties-panel__placeholder-icon" aria-hidden="true">🔗</span>
        <p className="properties-panel__placeholder-text">
          Connection not found.
        </p>
      </div>
    );
  }

  /** Persist the updated link rules to .afproj */
  function persistLinks(nextLinks: typeof links) {
    if (!project) return;
    const existingProperties = (project.properties ?? {}) as Record<string, unknown>;
    const linksData = nextLinks.map((l) => ({
      id: l.id,
      fromAgentId: l.fromAgentId,
      toAgentId: l.toAgentId,
      ruleType: l.ruleType,
      delegationType: l.delegationType,
      ruleDetails: l.ruleDetails,
    }));
    const merged = { ...existingProperties, "flow.links": linksData };
    saveProject({ properties: merged }).catch(() => {
      // Non-critical — link rule persistence failure is silent
    });
  }

  function handleRuleTypeChange(value: LinkRuleType) {
    updateLink(linkId, { ruleType: value });
    // Persist after state update — get latest links from store
    const nextLinks = useAgentFlowStore.getState().links.map((l) =>
      l.id === linkId ? { ...l, ruleType: value } : l
    );
    persistLinks(nextLinks);
  }

  function handleDelegationTypeChange(value: DelegationType) {
    updateLink(linkId, { delegationType: value });
    const nextLinks = useAgentFlowStore.getState().links.map((l) =>
      l.id === linkId ? { ...l, delegationType: value } : l
    );
    persistLinks(nextLinks);
  }

  function handleRuleDetailsChange(value: string) {
    updateLink(linkId, { ruleDetails: value });
    const nextLinks = useAgentFlowStore.getState().links.map((l) =>
      l.id === linkId ? { ...l, ruleDetails: value } : l
    );
    persistLinks(nextLinks);
  }

  return (
    <div className="link-rule-form">
      {/* ── Connection header ──────────────────────────────────────────── */}
      <div className="link-rule-form__header">
        <span className="link-rule-form__header-icon" aria-hidden="true">🔗</span>
        <span className="link-rule-form__header-title">Connection Rule</span>
      </div>

      {/* ── Rule Type toggle: Delegation / Response ─────────────────────── */}
      <div className="link-rule-form__section">
        <label className="link-rule-form__section-label" id="rule-type-label">
          Rule Type
        </label>
        <div
          className="link-rule-form__toggle-group"
          role="radiogroup"
          aria-labelledby="rule-type-label"
        >
          <button
            type="button"
            className={[
              "link-rule-form__toggle-btn",
              link.ruleType === "Delegation" ? "link-rule-form__toggle-btn--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => handleRuleTypeChange("Delegation")}
            aria-pressed={link.ruleType === "Delegation"}
            aria-label="Set rule type to Delegation"
          >
            Delegation
          </button>
          <button
            type="button"
            className={[
              "link-rule-form__toggle-btn",
              link.ruleType === "Response" ? "link-rule-form__toggle-btn--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => handleRuleTypeChange("Response")}
            aria-pressed={link.ruleType === "Response"}
            aria-label="Set rule type to Response"
          >
            Response
          </button>
        </div>
      </div>

      {/* ── Delegation Type select (only when Delegation is selected) ────── */}
      {link.ruleType === "Delegation" && (
        <div className="link-rule-form__section">
          <label
            className="link-rule-form__section-label"
            htmlFor="delegation-type-select"
          >
            Delegation Type
          </label>
          <select
            id="delegation-type-select"
            className="form-field__select link-rule-form__select"
            value={link.delegationType}
            onChange={(e) =>
              handleDelegationTypeChange(e.target.value as DelegationType)
            }
            aria-label="Delegation type"
          >
            <option value="Optional">Optional</option>
            <option value="Mandatory">Mandatory</option>
            <option value="Conditional">Conditional</option>
          </select>
        </div>
      )}

      {/* ── Rule Details textarea ──────────────────────────────────────── */}
      <div className="link-rule-form__section link-rule-form__section--grow">
        <label
          className="link-rule-form__section-label"
          htmlFor="rule-details-textarea"
        >
          Rule Details
          <span className="link-rule-form__label-optional"> (optional)</span>
        </label>
        <textarea
          id="rule-details-textarea"
          className="form-field__textarea link-rule-form__textarea"
          value={link.ruleDetails}
          onChange={(e) => handleRuleDetailsChange(e.target.value)}
          placeholder="Describe the rule logic or conditions..."
          rows={5}
          aria-label="Rule details"
        />
      </div>
    </div>
  );
}

// ── PropertiesPanel ────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const panelOpen = useAgentFlowStore((s) => s.panelOpen);
  const selectionContext = useAgentFlowStore((s) => s.selectionContext);
  const selectedLinkId = useAgentFlowStore((s) => s.selectedLinkId);
  const selectedNodeId = useAgentFlowStore((s) => s.selectedNodeId);
  const openPanel = useAgentFlowStore((s) => s.openPanel);
  const closePanel = useAgentFlowStore((s) => s.closePanel);
  const togglePanel = useAgentFlowStore((s) => s.togglePanel);

  const project = useProjectStore((s) => s.project);
  const saveProject = useProjectStore((s) => s.saveProject);

  // ── Restore panelOpen from .afproj on project load ───────────────────────
  useEffect(() => {
    if (!project) return;
    const savedPanelOpen = (project.properties as Record<string, unknown> | undefined)?.["ui.panelOpen"];
    if (typeof savedPanelOpen === "boolean") {
      if (savedPanelOpen) {
        openPanel();
      } else {
        closePanel();
      }
    }
    // Only run on project change, not on every panelOpen toggle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectDir]);

  // ── Persist panelOpen to .afproj when it changes ─────────────────────────
  useEffect(() => {
    if (!project) return;
    // Merge into existing properties
    const existingProperties = (project.properties ?? {}) as Record<string, unknown>;
    const merged = { ...existingProperties, "ui.panelOpen": panelOpen };
    saveProject({ properties: merged }).catch(() => {
      // Non-critical — panel state persistence failure is silent
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // ── Determine content to show ─────────────────────────────────────────────
  const showLinkForm = selectionContext === "link" && selectedLinkId !== null;
  const showNodeForm = selectionContext === "node" && selectedNodeId !== null;
  const showPlaceholder = !showLinkForm && !showNodeForm;

  return (
    <aside
      className={`properties-panel${panelOpen ? " properties-panel--open" : " properties-panel--closed"}`}
      aria-label="Properties panel"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="properties-panel__header">
        {panelOpen && (
          <span className="properties-panel__title">Properties</span>
        )}
        <button
          className="properties-panel__toggle"
          onClick={togglePanel}
          title={panelOpen ? "Collapse properties panel" : "Expand properties panel"}
          aria-label={panelOpen ? "Collapse properties panel" : "Expand properties panel"}
          aria-expanded={panelOpen}
        >
          {panelOpen ? "[<]" : "[>]"}
        </button>
      </header>

      {/* ── Content area (hidden when collapsed) ────────────────────────── */}
      <div
        className="properties-panel__content"
        aria-hidden={!panelOpen}
      >
        {/* ── Link rule editing form ──────────────────────────────────── */}
        {showLinkForm && selectedLinkId && (
          <LinkRuleForm linkId={selectedLinkId} />
        )}

        {/* ── Agent adapter form ───────────────────────────────────────── */}
        {showNodeForm && selectedNodeId && (
          <AgentAdapterForm agentId={selectedNodeId} />
        )}

        {/* ── Placeholder (no selection) ───────────────────────────────── */}
        {showPlaceholder && (
          <div className="properties-panel__placeholder">
            <span className="properties-panel__placeholder-icon" aria-hidden="true">📋</span>
            <p className="properties-panel__placeholder-text">
              {PLACEHOLDER_MESSAGES.none}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
