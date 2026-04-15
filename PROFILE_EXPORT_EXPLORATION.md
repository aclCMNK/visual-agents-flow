# Exploration: Agent Profile Export to .md Files

**Date**: 2026-04-15  
**Status**: ✅ Ready for Proposal  
**Request**: Export agent profiles (profile[] array from .adata) as concatenated .md files  

---

## Current State

The AgentsFlow project has a sophisticated architecture for agent metadata management and export:

### 1. **Agent Profile System** (Already Implemented)
- **Field**: `profile[]` array in `metadata/<agentId>.adata`
- **Type**: `AgentProfile[]` defined in `src/types/agent.ts`
- **Structure**:
  ```ts
  interface AgentProfile {
    readonly id: string;           // UUID v4
    selector: string;               // "System Prompt", "Memory", "Tools", etc.
    filePath: string;              // relative path from project root
    label?: string;
    order: number;                 // compilation order
    enabled: boolean;              // can be disabled without deletion
  }
  ```
- **Storage**: Persisted in `.adata` JSON; normalization & migration exists in `src/storage/adata.ts` and `src/storage/migrate-profiles.ts`

### 2. **Current Export Architecture**
- **Export Modal**: `src/ui/components/ExportModal/ExportModal.tsx`
  - Tabs: General, Agents, Relations, Skills, MCPs, Plugins
  - Exports OpenCode JSON config
  - Folder selection: home-sandboxed `FolderExplorer` (embedded in-app)
  - Last-used export dir: saved in `project.properties.exportDir`

- **Skills Export Pattern** (reference model for conflict handling):
  - Handler: `src/electron/skill-export-handlers.ts`
  - Process: read .adata → extract allowed skills → check disk → copy with conflict callback
  - Modal: `SkillConflictDialog.tsx` (Replace This / Replace All / Cancel)
  - Pattern: callback-based conflict resolution via `ipcMain.once()`

### 3. **IPC/Bridge Architecture**
- **Channels**: `src/electron/bridge.types.ts` (IPC_CHANNELS const)
- **Handlers**: `src/electron/ipc-handlers.ts` (main process)
- **Renderer calls**: via `window.agentsFlow` bridge
- **File I/O**:
  - `mkdir(path, { recursive: true })` for directory creation
  - `writeFile()` for file writes
  - `readFile()` for reads
  - Error handling: normalized `IpcError` (kind, code, message)

### 4. **Path Management**
- **Conventions**:
  - Behaviors: `behaviors/<agentId>/<filename>.md`
  - Skills: `skills/<skillName>/SKILL.md`
  - Metadata: `metadata/<agentId>.adata`
  - Profiles: arbitrary `.md` files, relative path from project root
- **Validation**: 
  - Profile paths: schema-validated (must be relative)
  - Destination: home-jail enforced by FolderExplorer

## Affected Areas

### Primary Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/electron/profile-export-handlers.ts` | **CREATE** | Pure export logic (no IPC) |
| `src/electron/ipc-handlers.ts` | **MODIFY** | Add EXPORT_AGENT_PROFILES handler + conflict callback |
| `src/electron/bridge.types.ts` | **MODIFY** | Add channel + request/result types |
| `src/electron/preload.ts` | **MODIFY** | Expose bridge method |
| `src/ui/components/ExportModal/ExportModal.tsx` | **MODIFY** | Add export button + call bridge |

### Secondary Files (Reference/Study)
- `src/types/agent.ts` — AgentProfile interface
- `src/storage/adata.ts` — profile normalization
- `src/electron/skill-export-handlers.ts` — conflict handling pattern
- `src/ui/components/ExportModal/SkillConflictDialog.tsx` — reuse component

## Implementation Approach: Pure File Concatenation

**Core Logic**: For each agent with non-empty `profile[]`:
1. Read all profile files in order (sorted by `order` field)
2. Concatenate their content directly (no extra delimiters, no blank lines added)
3. Write concatenated result to `[exportDir]/prompts/[projectName]/[agentName].md`
4. Pre-validate: collect all missing files; report as warnings
5. On conflict: show modal (Replace / Replace All / Cancel) per file

**Why this approach**:
- ✅ Simple, predictable logic
- ✅ Follows existing skills-export pattern
- ✅ Clear responsibility boundary
- ✅ Easy to test and validate
- ✅ Can be enhanced later (pre-check dialog, async, resume)

## Key Risks & Mitigations

### Risk 1: Path Traversal / Jailbreak
**Impact**: HIGH — could write outside HOME  
**Mitigations**:
- Profile `filePath` validated by schema (relative path only)
- Destination validated by FolderExplorer (under $HOME)
- Use `path.join()` + `realpath()` verification before write
- Reject any escaped paths

### Risk 2: Missing Profile Files (Late Discovery)
**Impact**: MEDIUM — user expects all files exported  
**Mitigations**:
- Pre-validate ALL files exist before writing ANY destination
- Collect warnings: { agentId, profileId, filePath } for each missing file
- Report warnings clearly in export result
- Log with full context

### Risk 3: Partial Write on Process Crash
**Impact**: MEDIUM — destination file half-written  
**Mitigations**:
- Write to temporary file (`.tmp`) first
- Use atomic `rename()` after successful write
- If interrupted, `.tmp` file left behind (safe, can be cleaned)

### Risk 4: Large File Memory Issues
**Impact**: LOW (typical: 1–10 profiles × 50 KB each)  
**Mitigations**:
- For MVP, use simple readFile() + concatenate + writeFile()
- Monitor in production; switch to streaming if needed
- Profile files are typically small (< 100 KB each)

### Risk 5: Encoding Issues (UTF-8 BOM, mixed encodings)
**Impact**: LOW  
**Mitigations**:
- Always read/write as UTF-8 (enforce in handler)
- Remove UTF-8 BOM on read if present
- **Critical**: No extra newlines/delimiters between concatenated files

### Risk 6: Concurrent Exports to Same Destination
**Impact**: LOW (user-chosen destination, unlikely to conflict)  
**Mitigations**:
- Rely on filesystem atomicity + conflict dialog
- If conflict modal shows "Replace All", confirm all first

### Risk 7: Modal State Leak (Prompt Pending Forever)
**Impact**: LOW  
**Mitigations**:
- Add promptId timeout (30s) on main side
- Clear old prompt IDs to prevent stale responses

## Edge Cases

| Case | Handling |
|------|----------|
| Agent has empty profile[] | Skip agent entirely |
| Profile file doesn't exist | Report as warning; skip that profile; continue with others |
| Profile file unreadable (permission) | Report as warning with error detail |
| Destination directory doesn't exist | Create with mkdir(..., {recursive: true}) |
| Destination file already exists | Show conflict modal (Replace / Replace All / Cancel) |
| Destination directory not writable | Fail with clear error message |
| Profile points to directory (not file) | Stat check; report as warning |
| Circular symlink in path | realpath() will detect; report as invalid path |
| User clicks Cancel on conflict modal | Abort entire operation; report how many exported before abort |
| Profile order field invalid (negative) | Use stable sort; treat as 0 |
| filePath is absolute (not relative) | Schema validation prevents; but add runtime check as safety |

## Implementation Tasks (from Proposal Phase)

### Task 1: Pure Logic Layer
- **File**: Create `src/electron/profile-export-handlers.ts`
- **Functions**:
  - `collectProfilesToExport(projectDir)` → { agentId, agentName, profiles[] }[]
  - `validateProfileFiles(projectDir, toExport)` → { valid, warnings }
  - `exportAgentProfiles(projectDir, destDir, onConflict)` → { success, exported, skipped, warnings }
- **No IPC/UI dependency** (pure Node.js file I/O)

### Task 2: IPC Integration
- **Files**: 
  - Add channel `EXPORT_AGENT_PROFILES` to `bridge.types.ts`
  - Add handler in `ipc-handlers.ts`
  - Update preload.ts
- **Conflict Callback**: Same pattern as EXPORT_SKILLS (promptId + ipcMain.once)

### Task 3: UI Integration
- **Files**: 
  - ExportModal component
  - Reuse `SkillConflictDialog` for conflict prompts
- **Button**: "Export Agent Profiles" (or integrate into existing Export flow)
- **Result Summary**: Show list of exported agents + warnings

## File Structure (After Implementation)

```
src/electron/
├── profile-export-handlers.ts     [NEW] Pure logic, no IPC
├── ipc-handlers.ts               [MODIFY] Add EXPORT_AGENT_PROFILES handler
├── bridge.types.ts               [MODIFY] Add channel + types
├── preload.ts                    [MODIFY] Expose bridge method
└── ...

src/ui/components/ExportModal/
├── ExportModal.tsx               [MODIFY] Add profile export button
├── export-logic.ts               [STUDY] Existing export patterns
├── SkillConflictDialog.tsx        [REUSE] For profile conflicts
└── ...
```

## Testing Strategy (for Proposal Phase)

### Unit Tests (`profile-export-handlers.test.ts`)
- ✅ collectProfilesToExport: correct agents filtered, profiles sorted by order
- ✅ validateProfileFiles: missing files detected, warnings collected
- ✅ exportAgentProfiles: files concatenated in order, destination created
- ✅ Conflict callback invoked when file exists, result respected

### Integration Tests (`ipc-handlers.test.ts`)
- ✅ IPC handler receives request, calls backend, returns result
- ✅ Conflict prompt sent to renderer, response handled
- ✅ promptId mismatch detected, timeout handled

### E2E Tests (ExportModal.test.tsx)
- ✅ Export button renders and is disabled until export dir selected
- ✅ Modal shows conflict dialog on file conflict
- ✅ "Replace All" works correctly
- ✅ Cancel aborts operation

## Summary

**Status**: ✅ **Ready for Proposal**

This exploration is complete. The feature is well-scoped, follows existing patterns (skills export), and has manageable risks. Implementation can proceed in 3 discrete tasks with clear responsibilities and test strategies.

The key insight is that this is essentially a "smarter file copy" operation: validate → concatenate → write with conflict handling. All infrastructure (IPC, conflict modal, bridge) already exists; we just need to plug in the profile-specific logic.
