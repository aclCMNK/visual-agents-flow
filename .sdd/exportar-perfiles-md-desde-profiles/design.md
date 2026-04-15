# Design: Export Agent Profiles to .md Files

**Change**: `exportar-perfiles-md-desde-profiles`  
**Date**: 2026-04-15  

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React UI Layer                                                 │
│  ├─ ExportModal.tsx (add "Export Agent Profiles" button)        │
│  └─ SkillConflictDialog.tsx (reused for conflict handling)      │
└────────────┬────────────────────────────────────────────────────┘
             │ (IPC call)
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Bridge Types & Handlers (ipc-handlers.ts)                      │
│  ├─ IPC_CHANNELS.EXPORT_AGENT_PROFILES                          │
│  ├─ Handler: collectAndExportProfiles(projectDir, destDir)      │
│  └─ Conflict callback via promptId + ipcMain.once()            │
└────────────┬────────────────────────────────────────────────────┘
             │ (Node.js call)
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Pure Logic Layer (profile-export-handlers.ts)                  │
│  ├─ collectProfilesToExport(projectDir)                         │
│  ├─ validateProfileFiles(projectDir, toExport)                  │
│  └─ exportAgentProfiles(projectDir, destDir, onConflict)        │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure (Implementation Plan)

### New Files

**`src/electron/profile-export-handlers.ts`** (Pure Backend Logic)
```typescript
// Type definitions
interface ProfileToExport {
  agentId: string;
  agentName: string;
  profiles: AgentProfile[];
}

interface ProfileValidationResult {
  agentId: string;
  profiles: Array<{ profile: AgentProfile; exists: boolean; error?: string }>;
}

interface ProfileExportResult {
  success: boolean;
  exported: Array<{ agentName: string; path: string }>;
  skipped: Array<{ agentName: string; reason: string }>;
  warnings: Array<{ agentId: string; profileId: string; filePath: string; reason: string }>;
  summary: { totalAgents: number; exportedCount: number; skippedCount: number; warningCount: number };
}

// Main functions
export async function collectProfilesToExport(projectDir: string): Promise<ProfileToExport[]>
export async function validateProfileFiles(projectDir: string, toExport: ProfileToExport[]): Promise<ProfileValidationResult[]>
export async function exportAgentProfiles(
  projectDir: string,
  destDir: string,
  onConflict: (destinationPath: string) => Promise<'replace' | 'replace-all' | 'cancel'>
): Promise<ProfileExportResult>

// Helpers
function buildDestinationPath(projectName: string, agentName: string, destDir: string): string
async function concatenateProfileFiles(filePaths: string[], projectDir: string): Promise<{ content: string; warnings: string[] }>
async function writeAtomicFile(sourcePath: string, destPath: string): Promise<void>
function validateRelativePath(filePath: string): boolean
```

### Modified Files

**`src/electron/bridge.types.ts`**
- Add types for request/response:
  ```typescript
  interface ExportAgentProfilesRequest {
    projectDir: string;
    destDir: string;
  }

  interface ExportAgentProfilesResult {
    success: boolean;
    exported: Array<{ agentName: string; path: string }>;
    skipped: Array<{ agentName: string; reason: string }>;
    warnings: string[];
    summary: { totalAgents: number; exportedCount: number; skippedCount: number };
  }

  interface ProfileConflictNotification {
    promptId: string;
    destinationPath: string;
    agentName: string;
  }
  ```
- Add channel constant:
  ```typescript
  EXPORT_AGENT_PROFILES = 'export-agent-profiles'
  PROFILE_CONFLICT_PROMPT = 'profile-conflict-prompt'
  PROFILE_CONFLICT_RESPONSE = 'profile-conflict-response'
  ```

**`src/electron/ipc-handlers.ts`**
- Add handler:
  ```typescript
  ipcMain.handle('export-agent-profiles', async (event, request: ExportAgentProfilesRequest) => {
    // Implement with conflict callback support (promptId pattern)
  })
  ```

**`src/electron/preload.ts`**
- Expose bridge method:
  ```typescript
  agentsFlow.exportAgentProfiles = (req: ExportAgentProfilesRequest) => ipcRenderer.invoke('...')
  ```

**`src/ui/components/ExportModal/ExportModal.tsx`**
- Add "Export Agent Profiles" button in the Agents tab
- Call new bridge method when clicked
- Show `SkillConflictDialog` on conflict notifications

---

## Key Implementation Details

### 1. Profile Collection Algorithm
```
FOR EACH agent in projectDir/metadata/*.adata:
  IF agent.profile[] is non-empty:
    SORT by profile.order (stable sort)
    ADD to toExport list
RETURN toExport
```

### 2. Pre-Validation Strategy
```
FOR EACH agent in toExport:
  FOR EACH profile in agent.profiles:
    TRY stat(projectDir / profile.filePath)
    ON missing:
      ADD warning: { agentId, profileId, filePath, reason: "not found" }
    ON permission error:
      ADD warning: { agentId, profileId, filePath, reason: "permission denied" }
RETURN warnings
```

### 3. Concatenation
```
FOR EACH profile in agent.profiles (in order):
  IF profile.enabled == false:
    SKIP (don't read, don't include in output)
  content += readFile(projectDir / profile.filePath, 'utf-8')
  STRIP BOM if present on first read
WRITE concatenated content to destination path
```

### 4. Conflict Callback Pattern
```
WHEN destination file already exists:
  promptId = generateId()
  SEND event to renderer: { promptId, destinationPath, agentName }
  WAIT for response via ipcMain.once(`profile-conflict-response-${promptId}`)
  TIMEOUT after 30 seconds
  HANDLE response: 'replace' | 'replace-all' | 'cancel'
    IF 'cancel': ABORT entire export, return partial results
    IF 'replace': Continue with this file, ask again for next conflict
    IF 'replace-all': Continue with all remaining conflicts without asking
```

### 5. Path Construction Rules
```
Destination: [exportDir]/prompts/[projectName]/[agentName].md

Example:
  exportDir: /home/user/exports
  projectName: "MyAgents"
  agentName: "research-agent"
  Result: /home/user/exports/prompts/MyAgents/research-agent.md

Rules:
  - projectName: taken from .afproj name (or normalized from dirname)
  - agentName: taken from agent.name (sanitized for filesystem: replace / with -)
  - All directories created with mkdir(..., { recursive: true })
```

### 6. Error Handling & Validation

**Path Validation**
- Profile `filePath` must be relative (no leading `/`)
- Use `path.isAbsolute()` check + schema validation
- Reject paths with `..` or suspicious patterns
- Use `realpath()` to resolve symlinks and verify boundaries

**File I/O Error Handling**
- Try-catch on each file read
- Collect errors as warnings; don't fail entire operation
- Report specific error codes (ENOENT, EACCES, EISDIR, etc.)

**Destination Validation**
- Verify destination dir is under $HOME (FolderExplorer ensures this)
- Check write permission before starting export
- Fail fast if destination is not writable

---

## Testing Strategy

### Unit Tests (`src/electron/profile-export-handlers.test.ts`)
- ✅ `collectProfilesToExport`: Correct agents filtered, profiles sorted by order
- ✅ `validateProfileFiles`: Missing files detected, warnings collected
- ✅ `exportAgentProfiles`: Files concatenated in order, destination created
- ✅ Disabled profiles skipped (not included in output)
- ✅ BOM handling: UTF-8 BOM stripped on read
- ✅ Path validation: Absolute paths rejected, relative paths validated
- ✅ Conflict callback: Invoked when file exists, result respected

### Integration Tests (`src/electron/ipc-handlers.test.ts`)
- ✅ IPC handler receives request, calls backend, returns result
- ✅ Conflict prompt sent to renderer, response handled via promptId
- ✅ promptId mismatch detected, timeout handled gracefully
- ✅ Replace-all works correctly across multiple conflicts

### E2E Tests (`src/ui/components/ExportModal/ExportModal.test.tsx`)
- ✅ Export button renders and is disabled until export dir selected
- ✅ Modal shows conflict dialog on file conflict
- ✅ "Replace All" works correctly
- ✅ Cancel aborts operation
- ✅ Result summary shows exported agents + warnings

---

## Configuration & Constants

### Destination Directory Structure
```
[exportDir]/
└─ prompts/
   └─ [projectName]/
      ├─ agent-1.md
      ├─ agent-2.md
      └─ ...
```

### Export Result Summary
```typescript
{
  "exported": [
    { "agentName": "research-agent", "path": "/path/to/research-agent.md" },
    { "agentName": "writer-agent", "path": "/path/to/writer-agent.md" }
  ],
  "skipped": [
    { "agentName": "admin-agent", "reason": "no profiles defined" },
    { "agentName": "cache-agent", "reason": "all profiles have errors" }
  ],
  "warnings": [
    "research-agent: profile 'system-prompt.md' not found",
    "writer-agent: missing read permission on 'behaviors/xyz/tools.md'"
  ],
  "summary": {
    "totalAgents": 4,
    "exportedCount": 2,
    "skippedCount": 2,
    "warningCount": 3
  }
}
```

---

## Deployment Notes

### No Breaking Changes
- Existing ExportModal behavior unchanged
- New button is additive (doesn't affect Skills export, Configs export, etc.)
- IPC channels are new (no existing code depends on them)
- Bridge types are extended (additive, backward compatible)

### Performance Considerations
- Profile files typically small (< 100 KB each)
- Simple readFile + concatenate approach suitable for MVP
- Monitor production for streaming needs if profiles grow

### Logging
- Log each agent export attempt with destination path
- Log warnings for missing files
- Log conflict resolutions (Replace / Replace All)
- Log final summary with counts

---

**Status**: Ready for specification and implementation.
