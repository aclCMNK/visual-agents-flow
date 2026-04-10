/**
 * src/ui/components/Permissions/PermissionsModal.tsx
 *
 * Modal for managing agent permissions using an object-based shape.
 *
 * # Data model (stored in .adata)
 *
 *   permissions: {
 *     "perm": "value",              ← ungrouped permission
 *     "group": {                    ← permission group
 *       "perm": "value",
 *       ...
 *     },
 *     ...
 *   }
 *
 * # Layout
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  Permissions                                                   [✕] │
 *   │  Permissions for {agentName}                                       │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │  [+ Add permission]  [+ Add group]                                 │
 *   │                                                                    │
 *   │  ── Ungrouped permissions ──────────────────────────────────────── │
 *   │  read         [allow ▾]  [✕]                                       │
 *   │  execute      [ask ▾]    [✕]                                       │
 *   │                                                                    │
 *   │  ── Bash ───────────────────────────────────────────────────  [✕] │
 *   │    run-scripts   [allow ▾]  [✕]                                    │
 *   │    write-files   [deny ▾]   [✕]                                    │
 *   │    [+ Add permission]                                              │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │  [Save]                               [Close]                     │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * # Validation rules
 *
 *   - Permission name (ungrouped or within group): required, non-empty, unique within scope
 *   - Group name: required, non-empty, unique at top level
 *   - Value: required, one of "allow" | "deny" | "ask"
 *   - Group names must not conflict with ungrouped permission names
 *
 * # UX notes
 *
 *   - Changes are held in local state until "Save" is clicked
 *   - Saving calls ADATA_SET_PERMISSIONS and shows a success/error toast
 *   - Portal modal — rendered at document.body level via createPortal in App.tsx
 *   - "Close" button closes without saving
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { PermissionsObject, PermissionValue } from "../../../electron/bridge.types.ts";

// ── Constants ──────────────────────────────────────────────────────────────

/** Valid permission values */
export const PERMISSION_VALUES = ["allow", "deny", "ask"] as const;

// ── Props ──────────────────────────────────────────────────────────────────

export interface PermissionsModalProps {
  /** The agent's UUID */
  agentId: string;
  /** Human-readable agent name (shown in subtitle) */
  agentName: string;
  /** Absolute path to the project root */
  projectDir: string;
  /** Called when the user closes the modal */
  onClose: () => void;
}

// ── Utility: generate stable local IDs ────────────────────────────────────

let _localIdCounter = 0;
function makeLocalId(): string {
  return `local-${++_localIdCounter}`;
}

// ── Local working types ────────────────────────────────────────────────────

/** One ungrouped permission row */
interface LocalUngrouped {
  localId: string;
  name: string;
  value: PermissionValue;
  /** Validation error for this row */
  error?: string;
}

/** One permission entry inside a group */
interface LocalGroupPerm {
  localId: string;
  name: string;
  value: PermissionValue;
  /** Validation error for this row */
  error?: string;
}

/** A permission group */
interface LocalGroup {
  localId: string;
  name: string;
  perms: LocalGroupPerm[];
  /** Validation error for the group name */
  nameError?: string;
}

interface LocalState {
  ungrouped: LocalUngrouped[];
  groups: LocalGroup[];
}

// ── Conversion helpers ─────────────────────────────────────────────────────

function toLocalState(remote: PermissionsObject): LocalState {
  const ungrouped: LocalUngrouped[] = [];
  const groups: LocalGroup[] = [];

  for (const [key, value] of Object.entries(remote)) {
    if (typeof value === "string") {
      ungrouped.push({ localId: makeLocalId(), name: key, value, error: undefined });
    } else if (typeof value === "object" && value !== null) {
      const perms: LocalGroupPerm[] = Object.entries(value).map(([pKey, pVal]) => ({
        localId: makeLocalId(),
        name: pKey,
        value: pVal as PermissionValue,
        error: undefined,
      }));
      groups.push({ localId: makeLocalId(), name: key, perms, nameError: undefined });
    }
  }

  return { ungrouped, groups };
}

function toRemotePermissions(local: LocalState): PermissionsObject {
  const result: PermissionsObject = {};

  for (const u of local.ungrouped) {
    result[u.name.trim()] = u.value;
  }

  for (const g of local.groups) {
    const groupName = g.name.trim();
    const groupObj: Record<string, PermissionValue> = {};
    for (const p of g.perms) {
      groupObj[p.name.trim()] = p.value;
    }
    result[groupName] = groupObj;
  }

  return result;
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidateLocalStateResult {
  state: LocalState;
  hasErrors: boolean;
}

/**
 * Validates the local permissions state.
 *
 * Rules:
 *   - Ungrouped permission names: required, non-empty, unique across all top-level names
 *   - Group names: required, non-empty, unique across all top-level names
 *   - Group permission names: required, non-empty, unique within the same group
 *
 * Returns a new state with error fields filled in, and hasErrors flag.
 */
export function validateLocalState(state: LocalState): ValidateLocalStateResult {
  let hasErrors = false;

  // All top-level names (ungrouped perm names + group names) must be unique
  const topLevelNames = new Set<string>();

  // Validate ungrouped permissions
  const validatedUngrouped: LocalUngrouped[] = state.ungrouped.map((u) => {
    const trimmed = u.name.trim();
    let error: string | undefined;

    if (!trimmed) {
      error = "Permission name is required.";
      hasErrors = true;
    } else if (topLevelNames.has(trimmed.toLowerCase())) {
      error = `Duplicate name: "${trimmed}".`;
      hasErrors = true;
    } else {
      topLevelNames.add(trimmed.toLowerCase());
    }

    return { ...u, error };
  });

  // Validate groups
  const validatedGroups: LocalGroup[] = state.groups.map((g) => {
    const trimmedName = g.name.trim();
    let nameError: string | undefined;

    if (!trimmedName) {
      nameError = "Group name is required.";
      hasErrors = true;
    } else if (topLevelNames.has(trimmedName.toLowerCase())) {
      nameError = `Duplicate name: "${trimmedName}".`;
      hasErrors = true;
    } else {
      topLevelNames.add(trimmedName.toLowerCase());
    }

    // Validate permissions within the group
    const permNames = new Set<string>();
    const validatedPerms: LocalGroupPerm[] = g.perms.map((p) => {
      const trimmedPerm = p.name.trim();
      let error: string | undefined;

      if (!trimmedPerm) {
        error = "Permission name is required.";
        hasErrors = true;
      } else if (permNames.has(trimmedPerm.toLowerCase())) {
        error = `Duplicate name: "${trimmedPerm}".`;
        hasErrors = true;
      } else {
        permNames.add(trimmedPerm.toLowerCase());
      }

      return { ...p, error };
    });

    return { ...g, nameError, perms: validatedPerms };
  });

  return {
    state: { ungrouped: validatedUngrouped, groups: validatedGroups },
    hasErrors,
  };
}

// ── PermissionsModal ───────────────────────────────────────────────────────

export function PermissionsModal({
  agentId,
  agentName,
  projectDir,
  onClose,
}: PermissionsModalProps) {
  // ── State ─────────────────────────────────────────────────────────────
  const [localState, setLocalState] = useState<LocalState>({ ungrouped: [], groups: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Toast state
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load permissions on mount ─────────────────────────────────────────
  const loadPermissions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await window.agentsFlow.adataGetPermissions({ projectDir, agentId });
      if (result.success) {
        setLocalState(toLocalState(result.permissions));
      } else {
        setLoadError(result.error ?? "Failed to load permissions.");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load permissions.");
    } finally {
      setIsLoading(false);
    }
  }, [agentId, projectDir]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  // ── Toast helpers ─────────────────────────────────────────────────────
  function showToast(msg: string, kind: "success" | "error") {
    setToast({ msg, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), kind === "success" ? 2500 : 5000);
  }

  // ── Keyboard: close on Escape ─────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Handlers: ungrouped permissions ──────────────────────────────────

  function handleAddPermission() {
    setLocalState((prev) => ({
      ...prev,
      ungrouped: [
        ...prev.ungrouped,
        { localId: makeLocalId(), name: "", value: "allow", error: undefined },
      ],
    }));
  }

  function handleRemoveUngrouped(localId: string) {
    setLocalState((prev) => ({
      ...prev,
      ungrouped: prev.ungrouped.filter((u) => u.localId !== localId),
    }));
  }

  function handleUngroupedNameChange(localId: string, name: string) {
    setLocalState((prev) => ({
      ...prev,
      ungrouped: prev.ungrouped.map((u) =>
        u.localId === localId ? { ...u, name, error: undefined } : u
      ),
    }));
  }

  function handleUngroupedValueChange(localId: string, value: PermissionValue) {
    setLocalState((prev) => ({
      ...prev,
      ungrouped: prev.ungrouped.map((u) =>
        u.localId === localId ? { ...u, value } : u
      ),
    }));
  }

  // ── Handlers: groups ───────────────────────────────────────────────────

  function handleAddGroup() {
    setLocalState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { localId: makeLocalId(), name: "", perms: [], nameError: undefined },
      ],
    }));
  }

  function handleRemoveGroup(localId: string) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.localId !== localId),
    }));
  }

  function handleGroupNameChange(localId: string, name: string) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.localId === localId ? { ...g, name, nameError: undefined } : g
      ),
    }));
  }

  // ── Handlers: permissions inside a group ──────────────────────────────

  function handleAddGroupPerm(groupLocalId: string) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.localId === groupLocalId
          ? {
              ...g,
              perms: [
                ...g.perms,
                { localId: makeLocalId(), name: "", value: "allow" as PermissionValue, error: undefined },
              ],
            }
          : g
      ),
    }));
  }

  function handleRemoveGroupPerm(groupLocalId: string, permLocalId: string) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.localId === groupLocalId
          ? { ...g, perms: g.perms.filter((p) => p.localId !== permLocalId) }
          : g
      ),
    }));
  }

  function handleGroupPermNameChange(groupLocalId: string, permLocalId: string, name: string) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.localId === groupLocalId
          ? {
              ...g,
              perms: g.perms.map((p) =>
                p.localId === permLocalId ? { ...p, name, error: undefined } : p
              ),
            }
          : g
      ),
    }));
  }

  function handleGroupPermValueChange(groupLocalId: string, permLocalId: string, value: PermissionValue) {
    setLocalState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.localId === groupLocalId
          ? {
              ...g,
              perms: g.perms.map((p) =>
                p.localId === permLocalId ? { ...p, value } : p
              ),
            }
          : g
      ),
    }));
  }

  // ── Save handler ───────────────────────────────────────────────────────

  async function handleSave() {
    const { state: validated, hasErrors } = validateLocalState(localState);
    if (hasErrors) {
      setLocalState(validated);
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.agentsFlow.adataSetPermissions({
        projectDir,
        agentId,
        permissions: toRemotePermissions(validated),
      });
      if (result.success) {
        showToast("Permissions saved.", "success");
      } else {
        showToast(result.error ?? "Failed to save permissions.", "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save permissions.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  const hasContent = localState.ungrouped.length > 0 || localState.groups.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Permissions modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal permissions-modal">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="modal__header permissions-modal__header">
          <div className="permissions-modal__header-text">
            <h2 className="modal__title">Permissions</h2>
            <p className="permissions-modal__subtitle">
              Permissions for <strong>{agentName}</strong>
            </p>
          </div>
          <button
            type="button"
            className="modal__close-btn"
            onClick={onClose}
            aria-label="Close permissions modal"
          >
            ✕
          </button>
        </header>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="modal__body permissions-modal__body">
          {/* Loading state */}
          {isLoading && (
            <p className="permissions-modal__loading" role="status">
              Loading permissions…
            </p>
          )}

          {/* Load error */}
          {!isLoading && loadError && (
            <p className="permissions-modal__error" role="alert">
              {loadError}
            </p>
          )}

          {/* ── Toolbar ──────────────────────────────────────────── */}
          {!isLoading && (
            <div className="permissions-modal__toolbar">
              <button
                type="button"
                className="btn btn--ghost permissions-modal__add-perm-btn"
                onClick={handleAddPermission}
                aria-label="Add permission"
              >
                + Add permission
              </button>
              <button
                type="button"
                className="btn btn--ghost permissions-modal__add-group-btn"
                onClick={handleAddGroup}
                aria-label="Add group"
              >
                + Add group
              </button>
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────── */}
          {!isLoading && !hasContent && !loadError && (
            <p className="permissions-modal__empty">
              No permissions defined. Click <strong>+ Add permission</strong> or{" "}
              <strong>+ Add group</strong> to begin.
            </p>
          )}

          {/* ── Ungrouped permissions section ─────────────────────── */}
          {!isLoading && localState.ungrouped.length > 0 && (
            <div className="permissions-modal__section">
              <div className="permissions-modal__section-heading">Ungrouped permissions</div>
              {localState.ungrouped.map((u) => (
                <div key={u.localId} className="permissions-modal__perm-row">
                  <input
                    type="text"
                    className={[
                      "form-field__input",
                      "permissions-modal__perm-name-input",
                      u.error ? "permissions-modal__input--error" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    value={u.name}
                    onChange={(e) => handleUngroupedNameChange(u.localId, e.target.value)}
                    placeholder="Permission name"
                    aria-label="Permission name"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <select
                    className="form-field__select permissions-modal__perm-value-select"
                    value={u.value}
                    onChange={(e) =>
                      handleUngroupedValueChange(u.localId, e.target.value as PermissionValue)
                    }
                    aria-label="Permission value"
                  >
                    {PERMISSION_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--ghost permissions-modal__remove-perm-btn"
                    onClick={() => handleRemoveUngrouped(u.localId)}
                    aria-label={`Remove permission ${u.name || "unnamed"}`}
                    title="Remove permission"
                  >
                    ✕
                  </button>
                  {u.error && (
                    <span className="permissions-modal__field-error" role="alert">
                      {u.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Groups section ────────────────────────────────────── */}
          {!isLoading &&
            localState.groups.map((g) => (
              <div key={g.localId} className="permissions-modal__group-block">
                {/* ── Group header ───────────────────────────── */}
                <div className="permissions-modal__group-header">
                  <input
                    type="text"
                    className={[
                      "form-field__input",
                      "permissions-modal__group-name-input",
                      g.nameError ? "permissions-modal__input--error" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    value={g.name}
                    onChange={(e) => handleGroupNameChange(g.localId, e.target.value)}
                    placeholder="Group name (e.g. Bash)"
                    aria-label="Group name"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost permissions-modal__remove-group-btn"
                    onClick={() => handleRemoveGroup(g.localId)}
                    aria-label={`Remove group ${g.name || "unnamed"}`}
                    title="Remove group"
                  >
                    ✕
                  </button>
                </div>
                {g.nameError && (
                  <span className="permissions-modal__field-error" role="alert">
                    {g.nameError}
                  </span>
                )}

                {/* ── Permissions inside the group ──────────── */}
                <div className="permissions-modal__group-perms">
                  {g.perms.map((p) => (
                    <div key={p.localId} className="permissions-modal__perm-row permissions-modal__perm-row--indented">
                      <input
                        type="text"
                        className={[
                          "form-field__input",
                          "permissions-modal__perm-name-input",
                          p.error ? "permissions-modal__input--error" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        value={p.name}
                        onChange={(e) =>
                          handleGroupPermNameChange(g.localId, p.localId, e.target.value)
                        }
                        placeholder="Permission name"
                        aria-label="Permission name"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <select
                        className="form-field__select permissions-modal__perm-value-select"
                        value={p.value}
                        onChange={(e) =>
                          handleGroupPermValueChange(
                            g.localId,
                            p.localId,
                            e.target.value as PermissionValue
                          )
                        }
                        aria-label="Permission value"
                      >
                        {PERMISSION_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn--ghost permissions-modal__remove-perm-btn"
                        onClick={() => handleRemoveGroupPerm(g.localId, p.localId)}
                        aria-label={`Remove permission ${p.name || "unnamed"}`}
                        title="Remove permission"
                      >
                        ✕
                      </button>
                      {p.error && (
                        <span
                          className="permissions-modal__field-error permissions-modal__perm-error"
                          role="alert"
                        >
                          {p.error}
                        </span>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn--ghost permissions-modal__add-perm-btn permissions-modal__add-group-perm-btn"
                    onClick={() => handleAddGroupPerm(g.localId)}
                    aria-label={`Add permission to group ${g.name || "unnamed"}`}
                  >
                    + Add permission
                  </button>
                </div>
              </div>
            ))}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer className="modal__footer permissions-modal__footer">
          <button
            type="button"
            className="btn btn--primary permissions-modal__save-btn"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            aria-label="Save permissions"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn--ghost permissions-modal__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </footer>

        {/* ── Toast ──────────────────────────────────────────────── */}
        {toast && (
          <div
            className={`agent-graph-toast ${toast.kind === "error" ? "agent-graph-toast--error" : "agent-graph-toast--success"}`}
            role="alert"
          >
            <span>{toast.msg}</span>
            <button
              className="agent-graph-toast__close"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
