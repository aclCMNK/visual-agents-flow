# AgentFlow Project Loader

The loader reads and validates an AgentFlow project from disk, building a fully hydrated in-memory model. It supports three operation modes: **load**, **dry-run**, and **repair**.

---

## Quick Start

```typescript
import { loadProject } from "./src/loader/index.ts";

// Load a project (default mode)
const result = await loadProject("/path/to/my-project");

if (result.success) {
  console.log(`Loaded ${result.project!.agents.size} agents`);
} else {
  console.error("Errors:", result.issues.filter(i => i.severity === "error"));
}
```

---

## Operation Modes

### `load` (default)

Validates the project and builds the in-memory `ProjectModel`. Returns `success: true` if no errors are found (warnings are reported but do not block loading).

```typescript
const result = await loadProject("/path/to/project", { mode: "load" });

if (result.success) {
  const project = result.project!;
  // project.agents  — Map<agentId, AgentModel>
  // project.connections  — Connection[]
  // project.entrypoint   — AgentModel | undefined
}
```

### `dry-run`

Validates the project and proposes repair actions **without modifying any files**. Always returns `success: false` and `project: undefined`.

```typescript
const result = await loadProject("/path/to/project", { mode: "dry-run" });

console.log("Issues found:", result.issues.length);
console.log("Repairs proposed:", result.repairActions.length);

// All actions have applied: false
result.repairActions.forEach(action => {
  console.log(`[${action.kind}] ${action.description} → ${action.targetFile}`);
});
```

### `repair`

Validates the project, applies all auto-repairable issues, and then attempts to load. Returns `success: true` if the project is valid after repairs.

```typescript
const result = await loadProject("/path/to/project", { mode: "repair" });

console.log(`Repairs applied: ${result.summary.repairsApplied}`);
result.repairActions
  .filter(a => a.applied)
  .forEach(a => console.log(`Fixed: ${a.description}`));
```

---

## Loader Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"load" \| "dry-run" \| "repair"` | `"load"` | Operation mode |
| `loadBehaviorFiles` | `boolean` | `true` | Read aspect and profile `.md` files into memory |
| `loadSkillFiles` | `boolean` | `true` | Read skill `.md` files into memory |
| `strict` | `boolean` | `false` | If true, warnings also cause `success: false` |

Set `loadBehaviorFiles: false` and `loadSkillFiles: false` for fast validation-only passes that skip reading markdown content.

---

## Type Reference

### `LoadResult`

Returned by every call to `loadProject()` or `ProjectLoader.load()`.

```typescript
interface LoadResult {
  success: boolean;           // False on any error, or when mode=dry-run
  project?: ProjectModel;     // Present only when success=true and mode != dry-run
  issues: ValidationIssue[];  // All validation findings
  repairActions: RepairAction[];  // Proposed or applied repairs
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    repairsApplied: number;
    repairsProposed: number;
    agentsLoaded: number;
    filesRead: number;
  };
  timestamp: string;   // ISO 8601
  durationMs: number;
}
```

### `ValidationIssue`

A single finding from schema or cross-validation.

```typescript
interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;       // Machine-readable code, e.g. "MISSING_PROFILE_FILE"
  message: string;    // Human-readable description
  source: string;     // File path + optional field, e.g. "metadata/abc.adata#agentId"
  repairHint?: string;
}
```

**Error codes:**

| Code | Severity | Description |
|------|----------|-------------|
| `NO_AFPROJ_FILE` | error | No `.afproj` file found in the project directory |
| `MULTIPLE_AFPROJ_FILES` | error | More than one `.afproj` file found |
| `AFPROJ_READ_ERROR` | error | `.afproj` could not be read or parsed |
| `AFPROJ_SCHEMA_ERROR` | error | `.afproj` failed Zod schema validation |
| `ADATA_READ_ERROR` | error | An `.adata` file could not be read or parsed |
| `ADATA_SCHEMA_ERROR` | error | An `.adata` file failed Zod schema validation |
| `MISSING_PROFILE_FILE` | error | A `profile.md` file referenced in the manifest does not exist |
| `MISSING_ADATA_FILE` | error | An `.adata` file referenced in the manifest does not exist |
| `MISSING_ASPECT_FILE` | error | An aspect `.md` file referenced in `.adata` does not exist |
| `MISSING_SKILL_FILE` | error | A skill `.md` file referenced in `.adata` does not exist |
| `DUPLICATE_AGENT_ID` | error | Two agents in the manifest share the same ID |
| `ORPHAN_ADATA` | error | An `.adata` file exists on disk but is not referenced in the manifest |
| `INVALID_CONNECTION` | error | A connection references an agent ID that is not in the manifest |
| `ADATA_ID_MISMATCH` | error | The `agentId` field in `.adata` does not match the filename |
| `MULTIPLE_ENTRYPOINTS` | error | More than one agent is marked as entrypoint |
| `NO_ENTRYPOINT` | warning | No agent is marked as entrypoint |
| `PROFILE_PATH_MISMATCH` | warning | The `profilePath` in `.afproj` and `.adata` differ for the same agent |
| `DUPLICATE_SUBAGENT_ID` | warning | Two subagents within the same agent share the same ID |

### `RepairAction`

A concrete repair that was proposed or applied.

```typescript
interface RepairAction {
  kind: "set-field" | "remove-orphan" | "create-file" | "fix-path" | "set-entrypoint" | "dedup-id";
  description: string;
  targetFile: string;   // File that was or would be modified
  fieldPath?: string;   // JSON path within the file
  newValue?: unknown;   // The value that was set
  applied: boolean;     // false in dry-run, true when actually written
}
```

### `ProjectModel`

The fully hydrated in-memory project.

```typescript
interface ProjectModel {
  projectDir: string;
  afprojPath: string;
  afproj: Afproj;                     // Parsed .afproj data
  agents: Map<string, AgentModel>;    // Keyed by agent ID
  connections: Connection[];
  entrypoint?: AgentModel;
  loadedAt: string;                   // ISO 8601
}
```

### `AgentModel`

A hydrated agent combining manifest data and `.adata` content.

```typescript
interface AgentModel {
  ref: AgentRef;                          // From .afproj
  adata: Adata;                           // Parsed .adata
  profileContent: string;                 // Contents of profile.md
  aspectContents: Map<string, string>;    // filePath → content
  skillContents: Map<string, string>;     // filePath → content
  subagents: SubagentModel[];
  isEntrypoint: boolean;
}
```

---

## Auto-Repair Strategies

The repairer handles the following issue codes automatically:

| Issue Code | Repair | Kind |
|------------|--------|------|
| `NO_ENTRYPOINT` | Sets `isEntrypoint: true` on the first agent in the manifest | `set-entrypoint` |
| `MULTIPLE_ENTRYPOINTS` | Keeps the first entrypoint, clears all others | `set-field` |
| `MISSING_PROFILE_FILE` | Creates a minimal placeholder `profile.md` | `create-file` |
| `DUPLICATE_AGENT_ID` | Regenerates a new UUID for the duplicate agent | `dedup-id` |
| `ADATA_ID_MISMATCH` | Overwrites the `agentId` field in `.adata` to match the filename | `set-field` |

Issues not in this list are reported but not auto-repaired.

---

## Extension Guide

### Adding a New Validation Rule

1. Open `src/loader/cross-validator.ts`
2. Add a new check function following the existing pattern:
   ```typescript
   function checkMyNewRule(afproj: Afproj, adataMap: Map<string, Adata>): ValidationIssue[] {
     const issues: ValidationIssue[] = [];
     // ... your logic
     return issues;
   }
   ```
3. Call it from `runCrossValidation()` and collect its results.
4. Add the new `code` to the issue codes table in this README.

### Adding a New Repair Strategy

1. Open `src/loader/repairer.ts`
2. Add a new handler in `applyRepairs()`:
   ```typescript
   if (issue.code === "MY_NEW_CODE") {
     // Build a RepairAction and push to actions[]
     // Optionally call atomicWriteJson() to persist the fix
   }
   ```
3. Add an entry to the auto-repair table in this README.

### Using the Loader Programmatically

```typescript
import { ProjectLoader } from "./src/loader/index.ts";

const loader = new ProjectLoader("/path/to/project");

// Fast schema-only check (no markdown loading, no model building)
const dryResult = await loader.load({
  mode: "dry-run",
  loadBehaviorFiles: false,
  loadSkillFiles: false,
});

if (dryResult.repairActions.length > 0) {
  // Apply repairs and reload
  const repairResult = await loader.load({ mode: "repair" });
  console.log("Project repaired and loaded:", repairResult.success);
}
```

---

## Project Directory Layout

```
<project-dir>/
├── <name>.afproj                          # Project manifest (JSON)
├── metadata/
│   └── <agentId>.adata                    # Per-agent metadata (JSON)
├── behaviors/
│   └── <agentId>/
│       ├── profile.md                     # Agent system prompt
│       └── <aspectId>.md                  # Behavior aspect files
└── skills/
    └── <skillId>.md                       # Shared skill files
```
