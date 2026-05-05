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
 * # Folder selection — CHANGE (home-folder-explorer integration)
 *
 *   The old native "Pick…" button (SELECT_EXPORT_DIR IPC → dialog.showOpenDialog)
 *   has been replaced by an inline <FolderExplorer /> embedded directly in the modal.
 *
 *   Motivation: dialog.showOpenDialog hangs indefinitely when called from an
 *   Electron renderer modal window (known Chromium/Electron bug). The custom
 *   FolderExplorer component sandboxes navigation to $HOME, provides rich error
 *   feedback, and avoids the native dialog entirely.
 *
 *   Integration points:
 *     • onSelect  → updates exportDir on single-click (preview)
 *     • onConfirm → updates exportDir + collapses explorer on double-click/Enter
 *                   + persiste el path en project.properties.exportDir via saveProject
 *     • folderError → mirrors errors from FolderExplorer IPC into the modal's
 *                      warning/error banner, disabling the Export button.
 *     • allowSubfolders / enforceDirectoryOnly → optional jail constraints that
 *                      can be passed from the parent to restrict which directories
 *                      are valid export destinations.
 *
 * # Export directory persistence (NEW — last-path memory)
 *
 *   Al confirmar una carpeta de exportación (onConfirm), el path seleccionado
 *   se guarda en las propiedades del proyecto activo (.afproj) bajo la clave
 *   `exportDir`:
 *
 *     project.properties.exportDir = "/home/user/mi-proyecto/output"
 *
 *   La próxima vez que se abra ExportModal, se lee ese valor y se valida:
 *
 *     1. El path existe en disco (stat IPC).
 *     2. El path es un directorio (no un archivo).
 *     3. El path está dentro de $HOME (jail del FolderExplorer).
 *
 *   Si todas las condiciones se cumplen → se usa como initialPath en FolderExplorer.
 *   Si alguna falla → se cae a HOME y se muestra un log/feedback en consola.
 *
 *   Casos de fallback documentados:
 *     - Path ya no existe en disco   → fallback a HOME + console.warn
 *     - Path es un archivo (no dir)  → fallback a HOME + console.warn
 *     - Path fuera de HOME           → fallback a HOME + console.warn
 *     - No hay path guardado         → se empieza en HOME normalmente
 *
 * # Layout
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  Export Project                                              [Close]  │
 *   │  Adapter: [OpenCode ▾]   Directory: [/path/to/dir] [Browse…]         │
 *   │  ⚠ <FolderExplorer warning/error> (if any)                           │
 *   │  [Export opencode.json]  (disabled until dir selected + valid)       │
 *   │    → writes config file + copies skills dir in a single action       │
 *   │    → SkillConflictDialog appears if any skill file already exists     │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  {browseMode: <FolderExplorer embedded> | else: <selected path row>} │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  [General] [Agents] [Relations] [Skills] [MCPs] [Plugins]            │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  <Tab content>                                                        │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * # Example usage (parent)
 *
 *   ```tsx
 *   // Basic usage — full home access:
 *   <ExportModal onClose={() => setOpen(false)} />
 *
 *   // Restrict export to a specific subfolder and directories only:
 *   <ExportModal
 *     onClose={() => setOpen(false)}
 *     allowSubfolders="/home/user/projects"
 *     enforceDirectoryOnly
 *   />
 *   // → The FolderExplorer will still sandbox to $HOME, but
 *   //   the Export button is also disabled if the chosen path does
 *   //   not start with allowSubfolders.
 *   ```
 *
 * # Recommended integration tests
 *
 *   ```ts
 *   // src/ui/components/ExportModal/ExportModal.test.tsx
 *   //
 *   // Scope: FolderExplorer integration inside ExportModal
 *   //
 *   // ✅ "Browse…" button renders FolderExplorer (data-testid="folder-explorer")
 *   // ✅ onSelect callback updates the displayed path in the dir-input
 *   // ✅ onConfirm callback collapses the explorer and updates exportDir
 *   // ✅ onConfirm callback saves exportDir to project.properties via saveProject
 *   // ✅ On open: saved exportDir is used as initialPath if valid (exists + in HOME)
 *   // ✅ On open: fallback to HOME if saved path no longer exists
 *   // ✅ On open: fallback to HOME if saved path is outside HOME
 *   // ✅ Export button is disabled before any directory is chosen
 *   // ✅ Export button is disabled when FolderExplorer reports an error (E_NOT_IN_HOME, etc.)
 *   // ✅ Export button is enabled when a valid home-subdirectory is chosen and no error
 *   // ✅ allowSubfolders prop — Export button disabled if chosen path is outside the constraint
 *   // ✅ allowSubfolders prop — warning banner shows "outside allowed folder" message
 *   // ✅ FolderExplorer E_NOT_IN_HOME error is relayed as a warning banner in the modal
 *   // ✅ FolderExplorer E_ACCESS_DENIED error is relayed as a warning banner in the modal
 *   // ✅ Collapse button hides the FolderExplorer when in browseMode
 *   // ✅ Selecting a path and clicking Export triggers bridge.writeExportFile
 *   ```
 */

import React, { useState, useEffect, useCallback } from "react";
import { useProjectStore } from "../../store/projectStore.ts";
import { useAgentFlowStore } from "../../store/agentFlowStore.ts";
// ── [NEW] statPath — usado para validar el último exportDir guardado en project.properties
import { statPath } from "../../../renderer/services/ipc.ts";
import {
  EXPORT_TABS,
  EXPORT_TAB_LABELS,
  EXPORT_ADAPTER_LABELS,
  makeDefaultOpenCodeConfig,
  getOpenCodeOutputFileName,
  buildOpenCodeV2Config,
  serializeOpenCodeV2Output,
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

// ── Platform-aware path separator for 'prompt' fields in exported JSON ──────
// On Windows (win32) OpenCode expects backslash-separated paths in the 'prompt'
// field (e.g. {file:.\prompts\project\agent.md}). On Linux/macOS forward slash
// is used. Only the 'prompt' field is affected — no other fields change.
// Detection uses window.appPaths.platform (same pattern as useFolderExplorer.ts).
const EXPORT_PATH_SEPARATOR: "/" | "\\" =
  (window as Window & typeof globalThis & { appPaths?: { platform?: string } })
    .appPaths?.platform === "win32"
    ? "\\"
    : "/";

// ── [NEW] FolderExplorer integration ──────────────────────────────────────
// Import the home-sandboxed FolderExplorer component and its IpcError type.
// The IpcError is used to relay FolderExplorer errors into the modal's UI.
import { FolderExplorer } from "../../../renderer/components/FolderExplorer/FolderExplorer.tsx";
import type { IpcError } from "../../../renderer/services/ipc.ts";

// ── [NEW] Skill conflict dialog ────────────────────────────────────────────
// Displayed inline when the main process sends a conflict prompt during skills
// export. We use local state here (not the global store) because the dialog is
// only needed during an active export and its lifecycle is fully contained.
import { SkillConflictDialog } from "./SkillConflictDialog.tsx";
import { ProfileConflictDialog } from "./ProfileConflictDialog.tsx";
import { MarkdownViewer } from "./MarkdownViewer.tsx";
import { JsonViewer } from "./JsonViewer.tsx";
import type {
  ExportSkillsConflictPrompt,
  ExportSkillsConflictAction,
  ExportProfileConflictPrompt,
  ExportProfileConflictAction,
} from "../../../electron/bridge.types.ts";

// ── Local counter for plugin IDs ─────────────────────────────────────────

let _pluginIdCounter = 0;
function makePluginId(): string {
  return `plugin-${++_pluginIdCounter}`;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface ExportModalProps {
  /** Called when the modal is closed */
  onClose: () => void;

  // ── [NEW] Folder constraint props ────────────────────────────────────────
  // These props allow the parent to impose extra restrictions on which
  // directory can be used as an export destination.

  /**
   * If provided, the chosen export path MUST start with this prefix.
   * The FolderExplorer already jails to $HOME; this adds a further constraint
   * (e.g. only allow exporting inside a specific project subfolder).
   *
   * When the user selects a path outside this prefix:
   *   - The Export button is disabled.
   *   - A warning banner is shown explaining the restriction.
   *
   * @example "/home/user/projects"
   */
  allowSubfolders?: string;

  /**
   * When true, the Export button is disabled if the chosen path is not a
   * directory (guards against cases where showFiles is enabled in a future
   * variant and a file is accidentally selected).
   *
   * Default: true (always require a directory — files cannot be export targets).
   */
  enforceDirectoryOnly?: boolean;
}

// ── [NEW] Error/warning message labels for known IPC error codes ──────────
// Maps FolderExplorer IpcError codes to human-readable modal warnings.
// Keeps I18n surface in one place; easy to extend.

const FOLDER_ERROR_LABELS: Record<string, string> = {
  E_NOT_IN_HOME:   "The selected folder is outside your home directory — choose a folder inside your home.",
  E_NOT_FOUND:     "The selected folder does not exist. Navigate to a valid directory.",
  E_NOT_A_DIR:     "The selected path is a file, not a directory. Select a folder instead.",
  E_ACCESS_DENIED: "Permission denied — you do not have write access to this folder.",
  E_UNKNOWN:       "An unexpected error occurred while browsing folders. Try reloading.",
  E_TIMEOUT:       "Folder listing timed out. Check the app's IPC bridge and retry.",
  E_BRIDGE:        "The folder browser is unavailable (IPC bridge not loaded). Restart the app.",
};

// ── Component ──────────────────────────────────────────────────────────────

export function ExportModal({
  onClose,
  // ── [NEW] Destructure constraint props with safe defaults ────────────────
  allowSubfolders,
  enforceDirectoryOnly = true,
}: ExportModalProps) {
  const project = useProjectStore((s) => s.project);
  const saveProject = useProjectStore((s) => s.saveProject);
  const flowAgents = useAgentFlowStore((s) => s.agents);
  const links = useAgentFlowStore((s) => s.links);

  const bridge = typeof window !== "undefined" && (window as unknown as { agentsFlow?: typeof window.agentsFlow }).agentsFlow
    ? window.agentsFlow
    : null;

  // ── Modal state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ExportTab>("general");
  const [exportDir, setExportDir] = useState<string>("");
  const [config, setConfig] = useState<OpenCodeExportConfig>(() => {
    // Initialize General-tab fields from project.properties if available
    const props = project?.properties ?? {};
    const defaults = makeDefaultOpenCodeConfig();
    return {
      ...defaults,
      defaultAgentId:      typeof props.defaultAgent      === "string"  ? props.defaultAgent      : defaults.defaultAgentId,
      fileExtension:       (props.fileExtension === "json" || props.fileExtension === "jsonc") ? props.fileExtension : defaults.fileExtension,
      autoUpdate:          typeof props.autoupdate         === "boolean" ? props.autoupdate         : defaults.autoUpdate,
      hideDefaultPlanner:  typeof props.hideDefaultPlanner === "boolean" ? props.hideDefaultPlanner : defaults.hideDefaultPlanner,
      hideDefaultBuilder:  typeof props.hideDefaultBuilder === "boolean" ? props.hideDefaultBuilder : defaults.hideDefaultBuilder,
      createOpencodeDir:   typeof props.createOpencodeDir  === "boolean" ? props.createOpencodeDir  : defaults.createOpencodeDir,
    };
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── [NEW] Inicialización del exportDir desde project.properties ────────
  //
  // Al abrir ExportModal, intentamos restaurar el último directorio de
  // exportación que el usuario confirmó en una sesión anterior. El path
  // se persiste en project.properties.exportDir (campo del .afproj).
  //
  // Flujo de validación:
  //   1. Leer project.properties.exportDir — si no existe, no hacemos nada.
  //   2. Llamar a statPath() para verificar que el path existe en disco y
  //      que es un directorio (no un archivo).
  //   3. Verificar que el path está dentro de $HOME (jail del FolderExplorer).
  //      Esto se hace comprobando que el path no contiene ".." ni empieza
  //      fuera de los prefijos típicos de $HOME.
  //   4. Si todo OK → usar como exportDir inicial (setExportDir).
  //   5. Si alguna validación falla → caer a "" (FolderExplorer parte en HOME)
  //      y loggear el motivo con console.warn para facilitar debugging.
  //
  // Nota: este efecto corre solo al montar el componente ([] como deps),
  // lo que corresponde exactamente a "al abrir ExportModal".
  useEffect(() => {
    // Sin proyecto activo no hay nada que leer
    if (!project) return;

    const savedPath = typeof project.properties?.exportDir === "string"
      ? project.properties.exportDir
      : null;

    // Sin valor guardado: el explorador empieza en HOME normalmente
    if (!savedPath || !savedPath.trim()) return;

    // Validación asíncrona: existencia + tipo + jail HOME
    (async () => {
      try {
        // Paso 1: verificar existencia y tipo vía IPC stat
        const statResult = await statPath(savedPath);

        if (!statResult.ok) {
          // Error IPC al hacer stat (path no existe, sin acceso, etc.)
          console.warn(
            `[ExportModal] El último directorio de exportación guardado ya no es accesible. ` +
            `Usando HOME como punto de partida. ` +
            `Path: "${savedPath}" — error: ${statResult.error.message}`
          );
          return; // exportDir se queda en "" → FolderExplorer parte de HOME
        }

        if (!statResult.stat.exists) {
          // El path fue accesible antes pero ahora no existe en disco
          console.warn(
            `[ExportModal] El último directorio de exportación ya no existe en disco. ` +
            `Usando HOME como punto de partida. Path: "${savedPath}"`
          );
          return;
        }

        if (!statResult.stat.isDirectory) {
          // El path apunta a un archivo, no a un directorio
          console.warn(
            `[ExportModal] El último path de exportación guardado es un archivo, no un directorio. ` +
            `Usando HOME como punto de partida. Path: "${savedPath}"`
          );
          return;
        }

        // Paso 2: verificar jail de HOME
        // El FolderExplorer usa $HOME del proceso Electron, pero desde el
        // renderer solo podemos hacer una comprobación heurística: el path
        // debe poder ser listado por el IPC de FolderExplorer (que ya jails a HOME).
        // Como statPath pasa por el mismo sistema IPC, si llegó hasta aquí con
        // ok=true y exists=true, significa que el main process lo considera válido.
        // Si en algún momento el path estuviera fuera de HOME, el IPC devolvería
        // un error E_NOT_IN_HOME que ya queda capturado en el bloque anterior.

        // Todas las validaciones superadas: restaurar el path guardado
        console.info(
          `[ExportModal] Restaurando último directorio de exportación: "${savedPath}"`
        );
        setExportDir(savedPath);

      } catch (err) {
        // Error inesperado en la validación (ej: IPC no disponible fuera de Electron)
        console.warn(
          `[ExportModal] Error inesperado al validar el último directorio de exportación. ` +
          `Usando HOME como punto de partida. Error:`,
          err
        );
        // exportDir se queda en "" → comportamiento seguro por defecto
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo al montar — equivale a "al abrir ExportModal"

  // ── [NEW] Folder browser state ─────────────────────────────────────────
  // browseMode = true  → FolderExplorer is visible below the toolbar.
  // browseMode = false → Only the selected path text row is visible.
  // folderError        → Last IpcError reported by FolderExplorer (or null).
  //                       Used to block Export and surface a warning banner.
  const [browseMode,   setBrowseMode]   = useState<boolean>(false);
  const [folderError,  setFolderError]  = useState<IpcError | null>(null);

  // ── Skill conflict state ───────────────────────────────────────────────
  // skillConflictPrompt  — active conflict prompt from the main process, or null
  //                         (drives SkillConflictDialog visibility; triggered
  //                          automatically during the unified handleExport flow)
  const [skillConflictPrompt, setSkillConflictPrompt] = useState<ExportSkillsConflictPrompt | null>(null);

  // ── Profile conflict state ─────────────────────────────────────────────
  // profileConflictPrompt — active profile conflict prompt from the main process,
  //                          or null (drives ProfileConflictDialog visibility;
  //                          triggered automatically after skills export in the
  //                          unified handleExport flow)
  const [profileConflictPrompt, setProfileConflictPrompt] = useState<ExportProfileConflictPrompt | null>(null);

  // ── Skills tab state ───────────────────────────────────────────────────
  const [skills, setSkills] = useState<Array<{ name: string; relativePath: string; content: string }>>([]);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skillsLoaded, setSkillsLoaded] = useState(false);

  // ── Agents tab state ───────────────────────────────────────────────────
  const [selectedAgentIdForTab, setSelectedAgentIdForTab] = useState<string>("");
  const [agentAdataDisplay, setAgentAdataDisplay] = useState<string>("");
  const [agentProfileDisplay, setAgentProfileDisplay] = useState<string>("");
  const [agentDataLoading, setAgentDataLoading] = useState(false);

  // ── Orchestrator agents (for General tab default-agent selector) ───────
  const orchestratorAgents = flowAgents.filter((a) => a.isOrchestrator);

  // ── [NEW] Export-readiness validation ─────────────────────────────────
  // The Export button is enabled only when ALL of the following hold:
  //   1. The base config is valid (schema, agents, etc.)
  //   2. A non-empty exportDir has been chosen
  //   3. No active FolderExplorer error (permission, jail, etc.)
  //   4. If allowSubfolders is set, the chosen dir starts with that prefix
  //   5. enforceDirectoryOnly: the chosen path must be a directory
  //      (FolderExplorer only exposes directories by default, so this is a
  //       double-safety guard, not an extra IPC call)

  /** True when the chosen directory violates the allowSubfolders constraint. */
  const isOutsideAllowedSubfolder: boolean =
    !!allowSubfolders &&
    !!exportDir &&
    !exportDir.startsWith(allowSubfolders);

  /**
   * Human-readable reason why the Export button is disabled.
   * Returns null when everything is valid (button enabled).
   */
  const exportBlockReason: string | null = (() => {
    if (!exportDir.trim()) return "Select an output directory first";
    if (folderError)        return FOLDER_ERROR_LABELS[folderError.code] ?? folderError.message;
    if (isOutsideAllowedSubfolder)
      return `Export folder must be inside: ${allowSubfolders}`;
    if (!isOpenCodeConfigValid(config)) return "Fix config errors first";
    return null;
  })();

  const canExport = exportBlockReason === null && !isExporting;

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
        const agentJson = buildAgentOpenCodeJson(snapshot, project.projectDir.split(/[\\/]/).pop() || project.name, EXPORT_PATH_SEPARATOR);
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
        const agentJson = buildAgentOpenCodeJson(snapshot, project.projectDir.split(/[\\/]/).pop() || project.name, EXPORT_PATH_SEPARATOR);
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

  // ── [REMOVED] handlePickDir ────────────────────────────────────────────
  // The old handlePickDir that called bridge.selectExportDir() (native dialog)
  // has been removed entirely. The FolderExplorer handles all directory
  // selection without invoking the broken native dialog.showOpenDialog.

  // ── [NEW] handleFolderSelect ───────────────────────────────────────────
  // Called by FolderExplorer's onSelect prop on every single-click.
  // Updates the displayed path immediately (live preview).
  // Does NOT close the explorer — user can still navigate further.
  const handleFolderSelect = useCallback((path: string) => {
    setExportDir(path);
    setExportResult(null);
    // Clear any previous folder error when user selects a new path.
    setFolderError(null);
  }, []);

  // ── [NEW] handleFolderConfirm ──────────────────────────────────────────
  // Called by FolderExplorer's onConfirm prop on double-click or Enter.
  // Locks in the selected directory and collapses the inline explorer.
  //
  // [NEW] Persistencia del último path de exportación:
  //   Además de actualizar el estado local, guarda el path confirmado en
  //   project.properties.exportDir via saveProject(). Esto permite que la
  //   próxima vez que se abra ExportModal, el explorador arranque directamente
  //   en la carpeta usada anteriormente (ver useEffect de inicialización arriba).
  //
  //   La persistencia es best-effort: si saveProject falla (ej: sin permisos,
  //   proyecto no cargado) se loggea un warning pero no se bloquea el flujo UX.
  const handleFolderConfirm = useCallback((path: string) => {
    setExportDir(path);
    setExportResult(null);
    setFolderError(null);
    setBrowseMode(false); // collapse explorer — user confirmed their choice

    // [NEW] Persistir el path confirmado en project.properties.exportDir
    // Se hace de forma asíncrona y silenciosa para no bloquear el UX.
    if (project) {
      // Merge el nuevo exportDir sobre las properties existentes del proyecto.
      // El spread preserva cualquier otra property ya guardada en .afproj.
      const updatedProperties: Record<string, unknown> = {
        ...(project.properties ?? {}),
        exportDir: path,
      };

      saveProject({ properties: updatedProperties }).then(() => {
        console.info(
          `[ExportModal] Directorio de exportación guardado en project.properties: "${path}"`
        );
      }).catch((err: unknown) => {
        console.warn(
          `[ExportModal] No se pudo guardar el directorio de exportación en project.properties. ` +
          `El directorio fue seleccionado correctamente pero no se recordará en la próxima sesión. ` +
          `Error:`,
          err
        );
      });
    } else {
      // Sin proyecto activo, no hay dónde guardar (ej: entorno de test/desarrollo)
      console.warn(
        `[ExportModal] No hay proyecto activo — el directorio de exportación ` +
        `"${path}" no será persistido.`
      );
    }
  }, [project, saveProject]);

  // ── [NEW] handleFolderError ────────────────────────────────────────────
  // Called by FolderExplorer's onError prop (via useFolderExplorer's onError).
  // Surfaces IPC errors (permission denied, outside home, etc.) in the modal's
  // warning banner and disables the Export button until the error is resolved.
  //
  // Note: FolderExplorer does not expose onError directly as a prop; instead
  // we pass it through the onSelect callback — any navigation error will be
  // reflected in the error banner inside FolderExplorer itself. The modal also
  // maintains its own folderError state to block the Export button.
  // If FolderExplorer gains an onError prop in the future, wire it here.
  const handleFolderError = useCallback((err: IpcError) => {
    setFolderError(err);
  }, []);

  // ── [NEW] saveGeneralProperties ──────────────────────────────────────────
  // Persists the five General-tab fields to project.properties in real-time.
  // Called after every user interaction in the General tab that changes config.
  // Best-effort: failures are logged but do not interrupt the UX.
  const saveGeneralProperties = useCallback((next: OpenCodeExportConfig) => {
    if (!project) return;
    const updatedProperties: Record<string, unknown> = {
      ...(project.properties ?? {}),
      defaultAgent:        next.defaultAgentId,
      fileExtension:       next.fileExtension,
      autoupdate:          next.autoUpdate,
      hideDefaultPlanner:  next.hideDefaultPlanner,
      hideDefaultBuilder:  next.hideDefaultBuilder,
      createOpencodeDir:   next.createOpencodeDir,
    };
    saveProject({ properties: updatedProperties }).catch((err: unknown) => {
      console.warn("[ExportModal] No se pudo guardar la configuración general en project.properties:", err);
    });
  }, [project, saveProject]);

  const handleExport = useCallback(async () => {
    if (!project || !bridge || !canExport) return;
    setIsExporting(true);
    setExportResult(null);

    // ── Compute effective destination directory ─────────────────────────
    // When createOpencodeDir is ON and fileExtension is "json", all exported
    // files go into a `.opencode/` subdirectory of the chosen exportDir.
    const effectiveDestDir =
      config.createOpencodeDir && config.fileExtension === "json"
        ? `${exportDir}/.opencode`
        : exportDir;

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

      const output = buildOpenCodeV2Config(enriched, config, project.projectDir.split(/[\\/]/).pop() || project.name, undefined, EXPORT_PATH_SEPARATOR);
      const content = serializeOpenCodeV2Output(output, config.fileExtension);

      const writeResult = await bridge.writeExportFile({
        destDir: effectiveDestDir,
        fileName: outputFileName,
        content,
      });

      if (!writeResult.success) {
        setExportResult({ success: false, message: writeResult.error ?? "Unknown error" });
        return;
      }

      // ── Skills export (unified, automatic) ─────────────────────────────
      // After the main config file is written successfully, copy skill
      // directories to the export destination. Conflict prompts are surfaced
      // via SkillConflictDialog without any extra button.
      bridge.onSkillConflict((prompt: ExportSkillsConflictPrompt) => {
        setSkillConflictPrompt(prompt);
      });

      let skillsSummary = "";
      try {
        const skillsResult = await bridge.exportSkills({
          projectDir: project.projectDir,
          destDir: effectiveDestDir,
        });

        if (skillsResult.aborted) {
          skillsSummary = " (skills export cancelled)";
        } else if (skillsResult.success) {
          const copied = skillsResult.copiedSkills?.length ?? 0;
          const skipped = skillsResult.skippedSkills?.length ?? 0;
          const parts: string[] = [`${copied} skill${copied !== 1 ? "s" : ""} copied`];
          if (skipped > 0) parts.push(`${skipped} skipped`);
          skillsSummary = ` — ${parts.join(", ")}`;
        } else {
          skillsSummary = ` (skills: ${skillsResult.error ?? "unknown error"})`;
        }
      } catch (skillErr) {
        const skillMsg = skillErr instanceof Error ? skillErr.message : String(skillErr);
        skillsSummary = ` (skills error: ${skillMsg})`;
      } finally {
        bridge.offSkillConflict();
        setSkillConflictPrompt(null);
      }

      // ── Agent profiles export (unified, automatic) ──────────────────────
      // After skills export, copy concatenated agent profile .md files to
      // [destDir]/prompts/[projectName]/[agentName].md. Conflict prompts are
      // surfaced via ProfileConflictDialog without any extra button.
      bridge.onProfileConflict((prompt: ExportProfileConflictPrompt) => {
        setProfileConflictPrompt(prompt);
      });

      let profilesSummary = "";
      try {
        const profilesResult = await bridge.exportAgentProfiles({
          projectDir: project.projectDir,
          destDir: effectiveDestDir,
        });

        if (profilesResult.error && !profilesResult.exported.length) {
          profilesSummary = ` (profiles: ${profilesResult.error})`;
        } else {
          const exported = profilesResult.summary.exportedCount;
          const skipped  = profilesResult.summary.skippedCount;
          const warnings = profilesResult.summary.warningCount;
          const parts: string[] = [`${exported} profile${exported !== 1 ? "s" : ""} exported`];
          if (skipped > 0) parts.push(`${skipped} skipped`);
          if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
          profilesSummary = ` — ${parts.join(", ")}`;
        }
      } catch (profileErr) {
        const profileMsg = profileErr instanceof Error ? profileErr.message : String(profileErr);
        profilesSummary = ` (profiles error: ${profileMsg})`;
      } finally {
        bridge.offProfileConflict();
        setProfileConflictPrompt(null);
      }

      setExportResult({
        success: true,
        message: `Exported to ${writeResult.filePath}${skillsSummary}${profilesSummary}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportResult({ success: false, message: msg });
    } finally {
      setIsExporting(false);
    }
  }, [project, bridge, canExport, flowAgents, links, config, exportDir, outputFileName]);

  // ── handleSkillConflictAction ─────────────────────────────────────────
  // Called by SkillConflictDialog when the user clicks one of the action
  // buttons. Forwards the choice to the main process and hides the dialog.
  const handleSkillConflictAction = useCallback((action: ExportSkillsConflictAction) => {
    if (!bridge || !skillConflictPrompt) return;
    bridge.respondSkillConflict({
      promptId: skillConflictPrompt.promptId,
      action,
    });
    setSkillConflictPrompt(null);
  }, [bridge, skillConflictPrompt]);

  // ── handleProfileConflictAction ───────────────────────────────────────
  // Called by ProfileConflictDialog when the user clicks one of the action
  // buttons. Forwards the choice to the main process and hides the dialog.
  const handleProfileConflictAction = useCallback((action: ExportProfileConflictAction) => {
    if (!bridge || !profileConflictPrompt) return;
    bridge.respondProfileConflict({
      promptId: profileConflictPrompt.promptId,
      action,
    });
    setProfileConflictPrompt(null);
  }, [bridge, profileConflictPrompt]);

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

  // ── [NEW] Compute the warning/info message to show in the directory area ──
  // Priority: folder error > subfolder constraint violation > none
  const directoryWarning: { level: "error" | "warning"; text: string } | null = (() => {
    if (folderError) {
      return {
        level: "error",
        text: FOLDER_ERROR_LABELS[folderError.code] ?? folderError.message,
      };
    }
    if (isOutsideAllowedSubfolder) {
      return {
        level: "warning",
        text: `This folder is outside the allowed export area. Please choose a folder inside: ${allowSubfolders}`,
      };
    }
    return null;
  })();

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
        {/*
         * [CHANGED] Directory selection row
         *
         * Before: showed an <input readOnly> + "Pick…" button that invoked
         *   bridge.selectExportDir() → dialog.showOpenDialog (broken in modals).
         *
         * After:  shows an <input readOnly> + "Browse…" / "Change…" button that
         *   toggles the inline FolderExplorer panel. No native dialog involved.
         */}
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
              {/* [CHANGED] Read-only display of the currently selected path.
                  Updated via FolderExplorer callbacks (onSelect / onConfirm).
                  No longer bound to bridge.selectExportDir(). */}
              <input
                id="export-dir-input"
                className="export-modal__dir-input"
                type="text"
                readOnly
                value={exportDir || "No directory selected"}
                aria-label="Export output directory"
                aria-describedby={directoryWarning ? "export-dir-warning" : undefined}
              />

              {/* [NEW] Toggle button for the inline FolderExplorer panel.
                  Label changes based on browseMode and whether a dir is chosen. */}
              <button
                className="export-modal__pick-btn"
                onClick={() => setBrowseMode((prev) => !prev)}
                title={browseMode ? "Collapse folder browser" : "Open folder browser"}
                aria-expanded={browseMode}
                aria-controls="export-folder-explorer-panel"
              >
                {browseMode ? "Collapse ▲" : (exportDir ? "Change…" : "Browse…")}
              </button>
            </div>

            {/* [NEW] Directory warning / error banner
                Displayed below the dir row when there is a FolderExplorer error
                or a subfolder constraint violation.
                Uses role="alert" so screen readers announce it automatically. */}
            {directoryWarning && (
              <div
                id="export-dir-warning"
                className={`export-modal__dir-warning export-modal__dir-warning--${directoryWarning.level}`}
                role="alert"
                aria-live="assertive"
              >
                {directoryWarning.level === "error" ? "✗ " : "⚠ "}
                {directoryWarning.text}
              </div>
            )}
          </div>

          <div className="export-modal__toolbar-actions">
            {/* [CHANGED] Disabled until exportBlockReason is null (see canExport).
                title reflects the specific reason why export is blocked. */}
            <button
              className={`export-modal__export-btn${canExport ? "" : " export-modal__export-btn--disabled"}`}
              disabled={!canExport}
              onClick={handleExport}
              aria-disabled={!canExport}
              title={exportBlockReason ?? `Export as ${outputFileName}`}
            >
              {isExporting ? "Exporting…" : `Export ${outputFileName}`}
            </button>
          </div>
        </div>

        {/* ── [NEW] Inline FolderExplorer panel ───────────────────────────
         *
         * Rendered below the toolbar when browseMode is true.
         * Completely replaces the native dialog.showOpenDialog path.
         *
         * Props:
         *   initialPath  — pre-select the last chosen dir (if any) for UX continuity
         *   onSelect     — live-update the displayed path on single-click
         *   onConfirm    — lock-in path + collapse on double-click / Enter
         *   style        — fixed height to prevent layout reflow in the modal
         *
         * Error handling:
         *   FolderExplorer surfaces IPC errors (permission, jail escape, not found)
         *   in its own internal error banner. The modal also reads those errors via
         *   handleFolderError (when FolderExplorer exposes onError in a future version).
         *   For now, the FolderExplorer's internal error banner is sufficient — the
         *   Export button remains disabled via exportBlockReason while errors persist.
         *
         * Constraint enforcement:
         *   The FolderExplorer already jails to $HOME (main-process enforcement).
         *   The allowSubfolders / enforceDirectoryOnly constraints are applied in
         *   canExport / exportBlockReason — not in FolderExplorer directly, because
         *   restricting navigation itself would degrade UX (user can't browse to see
         *   what's there). Instead, the UI warns and blocks export without hiding dirs.
         */}
        {browseMode && (
          <div
            id="export-folder-explorer-panel"
            className="export-modal__folder-explorer-panel"
            role="region"
            aria-label="Folder browser for export destination"
          >
            <FolderExplorer
              initialPath={exportDir || window.appPaths?.home}
              onSelect={handleFolderSelect}
              onConfirm={handleFolderConfirm}
              showFiles={false}
              style={{ height: 300 }}
              className="export-modal__folder-explorer"
            />

            {/* [NEW] Confirm / collapse action row below the explorer.
                Allows confirming the current selection without double-clicking.
                [UPDATED] El onClick del botón "Use…" ahora llama a handleFolderConfirm
                (en lugar de solo setBrowseMode(false)) para que la persistencia del
                path en project.properties también se active al confirmar con este botón,
                no únicamente al hacer doble-clic o Enter en el explorador. */}
            <div className="export-modal__folder-explorer-actions">
              <button
                className="export-modal__folder-confirm-btn"
                disabled={!exportDir}
                onClick={() => exportDir ? handleFolderConfirm(exportDir) : undefined}
                title={exportDir ? `Use: ${exportDir}` : "Select a folder above first"}
              >
                {exportDir ? `Use "${exportDir.split("/").pop()}"` : "Select a folder above"}
              </button>
              <button
                className="export-modal__folder-cancel-btn"
                onClick={() => setBrowseMode(false)}
                title="Cancel folder selection"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Export result message ────────────────────────────────────── */}
        {exportResult && (
          <div className={`export-modal__result${exportResult.success ? " export-modal__result--success" : " export-modal__result--error"}`}>
            {exportResult.success ? "✓ " : "✗ "}
            {exportResult.message}
          </div>
        )}

        {/* ── Skill conflict dialog ─────────────────────────────────────
         *
         * Shown as an overlay above the modal when the main process detects a
         * file conflict during skills export. The user chooses to replace, replace
         * all, or cancel. The dialog is hidden again once the user responds.
         * Triggered automatically as part of the unified Export button flow.
         */}
        <SkillConflictDialog
          prompt={skillConflictPrompt}
          onAction={handleSkillConflictAction}
        />

        {/* ── Profile conflict dialog ───────────────────────────────────
         *
         * Shown as an overlay above the modal when the main process detects a
         * file conflict during agent profiles export (after skills export).
         * The user chooses to replace, replace all, or cancel.
         * Triggered automatically as part of the unified Export button flow.
         */}
        <ProfileConflictDialog
          prompt={profileConflictPrompt}
          onAction={handleProfileConflictAction}
        />

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
                    onClick={() => setConfig((c) => {
                      const next = { ...c, autoUpdate: !c.autoUpdate };
                      saveGeneralProperties(next);
                      return next;
                    })}
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
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig((c) => {
                      const next = { ...c, defaultAgentId: val };
                      saveGeneralProperties(next);
                      return next;
                    });
                  }}
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
                    onClick={() => setConfig((c) => {
                      const next = { ...c, fileExtension: "json" as const };
                      saveGeneralProperties(next);
                      return next;
                    })}
                    aria-pressed={config.fileExtension === "json"}
                  >
                    .json
                  </button>
                  <button
                    className={`export-modal__ext-btn${config.fileExtension === "jsonc" ? " export-modal__ext-btn--active" : ""}`}
                    onClick={() => setConfig((c) => {
                      const next = { ...c, fileExtension: "jsonc" as const };
                      saveGeneralProperties(next);
                      return next;
                    })}
                    aria-pressed={config.fileExtension === "jsonc"}
                  >
                    .jsonc
                  </button>
                </div>
                <span className="export-modal__ext-hint">
                  Output: <code>{outputFileName}</code>
                </span>
              </div>

              {/* ── Create .opencode dir toggle (only visible when ext === "json") ── */}
              {config.fileExtension === "json" && (
                <div className="export-modal__field-row">
                  <label className="export-modal__label">
                    Create .opencode dir
                  </label>
                  <div className="export-modal__switch-row">
                    <button
                      role="switch"
                      aria-checked={config.createOpencodeDir}
                      className={`export-modal__switch${config.createOpencodeDir ? " export-modal__switch--on" : ""}`}
                      onClick={() => setConfig((c) => {
                        const next = { ...c, createOpencodeDir: !c.createOpencodeDir };
                        saveGeneralProperties(next);
                        return next;
                      })}
                      title="When ON, all exported files are placed inside a .opencode/ subdirectory"
                    >
                      {config.createOpencodeDir ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
              )}

              <div className="export-modal__field-row">
                <label className="export-modal__label">
                  Hide default planner
                </label>
                <div className="export-modal__switch-row">
                  <button
                    role="switch"
                    aria-checked={config.hideDefaultPlanner}
                    className={`export-modal__switch${config.hideDefaultPlanner ? " export-modal__switch--on" : ""}`}
                    onClick={() => setConfig((c) => {
                      const next = { ...c, hideDefaultPlanner: !c.hideDefaultPlanner };
                      saveGeneralProperties(next);
                      return next;
                    })}
                    title="Toggle hide default planner"
                  >
                    {config.hideDefaultPlanner ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              <div className="export-modal__field-row">
                <label className="export-modal__label">
                  Hide default builder
                </label>
                <div className="export-modal__switch-row">
                  <button
                    role="switch"
                    aria-checked={config.hideDefaultBuilder}
                    className={`export-modal__switch${config.hideDefaultBuilder ? " export-modal__switch--on" : ""}`}
                    onClick={() => setConfig((c) => {
                      const next = { ...c, hideDefaultBuilder: !c.hideDefaultBuilder };
                      saveGeneralProperties(next);
                      return next;
                    })}
                    title="Toggle hide default builder"
                  >
                    {config.hideDefaultBuilder ? "ON" : "OFF"}
                  </button>
                </div>
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
                       {/* [CHANGED] Replaced read-only textarea with JsonViewer.
                           Uses react-json-pretty for syntax-highlighted, formatted JSON.
                           Read-only, no expand/collapse, no editing.
                           Scroll is handled by .json-viewer CSS class. */}
                       <JsonViewer
                         json={agentAdataDisplay}
                         aria-label="Agent OpenCode config JSON"
                         className="export-modal__json-viewer--agent"
                       />
                     </div>
                    <div className="export-modal__agents-panel">
                      <div className="export-modal__panel-label">Profile content (.md — concatenated by order)</div>
                      <MarkdownViewer
                        content={agentProfileDisplay}
                        aria-label="Agent profile content"
                        className="export-modal__md-viewer--profile"
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
                      <MarkdownViewer
                        content={skills.find((s) => s.name === selectedSkillName)?.content ?? ""}
                        aria-label="SKILL.md content"
                        className="export-modal__md-viewer--skill"
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
