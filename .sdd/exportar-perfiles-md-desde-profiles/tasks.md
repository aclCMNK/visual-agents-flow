# Tasks: Export Agent Profiles to .md Files

**Change**: `exportar-perfiles-md-desde-profiles`  
**Date**: 2026-04-15  
**Phases**: 4 (Backend Logic → IPC Integration → UI Integration → Tests)

---

## Phase 1: Pure Backend Logic

### Task 1.1: Create `src/electron/profile-export-handlers.ts`

**Description**: Implement pure Node.js file I/O logic for profile export (no IPC dependency).

**Functions to Implement**:
- `collectProfilesToExport(projectDir: string)` → Returns agent profiles to export
- `validateProfileFiles(projectDir: string, toExport: ProfileToExport[])` → Returns validation results with warnings
- `exportAgentProfiles(projectDir: string, destDir: string, onConflict: ConflictCallback)` → Main export orchestrator

**Acceptance Criteria**:
- ✅ Reads `.adata` files for all agents in `metadata/`
- ✅ Filters agents with non-empty `profile[]` arrays
- ✅ Sorts profiles by `order` field (stable sort)
- ✅ Validates profile file paths (relative only, no traversal)
- ✅ Pre-validates all files exist before writing destination
- ✅ Handles missing/unreadable files as warnings (not errors)
- ✅ Concatenates profiles WITHOUT extra delimiters or newlines
- ✅ Strips UTF-8 BOM from each file
- ✅ Writes to temporary file, atomically renames to destination
- ✅ Handles file conflicts via callback (replace / replace-all / cancel)
- ✅ Returns detailed result with exported[], skipped[], warnings[]

**Test Coverage**:
- Covered by: `tests/electron/profile-export-handlers.test.ts` (Unit tests)
  - ✅ collectProfilesToExport: agents filtered, profiles sorted
  - ✅ validateProfileFiles: missing files detected, warnings collected
  - ✅ exportAgentProfiles: files concatenated, destination created
  - ✅ Disabled profiles skipped (not included in output)
  - ✅ Conflict callback invoked and result respected
  - ✅ BOM handling
  - ✅ Path validation

**Blocked By**: None  
**Blocks**: Task 2.1

---

### Task 1.2: Create Unit Test Suite for Profile Export Handlers

**Description**: Implement comprehensive unit tests for `profile-export-handlers.ts`.

**Test Cases** (minimum):
- collectProfilesToExport
  - ✅ Project with 2 agents (1 with profiles, 1 without) → Collect 1 agent
  - ✅ Agent with 5 profiles, mixed order → Sorted correctly
  - ✅ Agent with all disabled profiles → Still collected (for validate step)
  - ✅ Project with no agents → Empty collection (no error)
  
- validateProfileFiles
  - ✅ All files exist → No warnings
  - ✅ 1 file missing → Warning collected
  - ✅ File EACCES (permission denied) → Warning with error detail
  - ✅ File is directory, not file → Warning: "is directory"
  - ✅ Disabled profiles not validated (skipped)
  - ✅ Disabled profile still in collection but not in validation warnings

- exportAgentProfiles
  - ✅ Happy path: 2 agents exported successfully
  - ✅ 1 profile missing → Exported with warning
  - ✅ File conflict → Callback invoked, Replace respected
  - ✅ File conflict → Callback invoked, Replace-All works for multiple files
  - ✅ File conflict → Cancel aborts export, returns partial results
  - ✅ Destination dir created if not exists
  - ✅ Atomic write: write to .tmp, rename to destination
  - ✅ BOM handling: UTF-8 BOM stripped from file
  - ✅ Concatenation: no extra newlines between profiles

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Code coverage > 85% for profile-export-handlers.ts
- ✅ Tests run in < 2 seconds

**Blocked By**: Task 1.1  
**Blocks**: Task 2.1

---

## Phase 2: IPC Integration

### Task 2.1: Update Bridge Types and Add IPC Handler

**Description**: Extend `bridge.types.ts` and `ipc-handlers.ts` to support profile export.

**Changes to `src/electron/bridge.types.ts`**:
- Add types:
  ```typescript
  interface ExportAgentProfilesRequest { projectDir: string; destDir: string; }
  interface ExportAgentProfilesResult { success: boolean; exported[]; skipped[]; warnings[]; summary; }
  interface ProfileConflictNotification { promptId: string; destinationPath: string; agentName: string; }
  ```
- Add channel constants:
  ```typescript
  EXPORT_AGENT_PROFILES = 'export-agent-profiles'
  PROFILE_CONFLICT_PROMPT = 'profile-conflict-prompt'
  PROFILE_CONFLICT_RESPONSE = 'profile-conflict-response'
  ```

**Changes to `src/electron/ipc-handlers.ts`**:
- Add handler:
  ```typescript
  ipcMain.handle('export-agent-profiles', async (event, req) => {
    // Implement conflict callback pattern (promptId + ipcMain.once)
    // Call profile-export-handlers functions
    // Return ExportAgentProfilesResult
  })
  ```
- Implement conflict callback:
  ```typescript
  onConflict = async (destPath) => {
    promptId = generateId()
    event.sender.send('profile-conflict-prompt', { promptId, destPath })
    // Wait for response via ipcMain.once() with timeout
  }
  ```

**Acceptance Criteria**:
- ✅ IPC channel registered and callable from renderer
- ✅ Handler receives projectDir and destDir
- ✅ Handler calls profile-export-handlers functions
- ✅ Conflict callback sends promptId to renderer
- ✅ Response received via ipcMain.once()
- ✅ Timeout after 30 seconds if no response
- ✅ Returns ExportAgentProfilesResult to renderer

**Test Coverage**:
- Covered by: `tests/electron/ipc-handlers.test.ts` (Integration tests)
  - ✅ IPC handler callable from renderer
  - ✅ Request/response serialization
  - ✅ Conflict prompt sent with promptId
  - ✅ Response received and processed
  - ✅ Replace / Replace-All / Cancel handled correctly

**Blocked By**: Task 1.1  
**Blocks**: Task 3.1

---

### Task 2.2: Update Preload Bridge

**Description**: Expose profile export method in `src/electron/preload.ts`.

**Changes**:
- Add method to window.agentsFlow bridge:
  ```typescript
  exportAgentProfiles(req: ExportAgentProfilesRequest): Promise<ExportAgentProfilesResult>
  ```
- Use ipcRenderer.invoke() to call handler

**Acceptance Criteria**:
- ✅ Method exposed on window.agentsFlow
- ✅ Type-safe (TS types match bridge.types)
- ✅ Callable from React components
- ✅ Returns result promise

**Blocked By**: Task 2.1  
**Blocks**: Task 3.1

---

## Phase 3: UI Integration

### Task 3.1: Add Export Button to ExportModal Component

**Description**: Add "Export Agent Profiles" button to `src/ui/components/ExportModal/ExportModal.tsx`.

**Changes**:
- Add button in Agents tab (next to "Export Skills" button if it exists, or in a new section)
- Button text: "Export Agent Profiles"
- Button disabled until export destination folder selected
- On click:
  - Call window.agentsFlow.exportAgentProfiles({ projectDir, destDir })
  - Show loading state during export
  - Handle result and display summary

**Acceptance Criteria**:
- ✅ Button renders in Agents tab
- ✅ Button disabled when export dir not selected
- ✅ Button enabled when export dir selected
- ✅ Loading indicator shown during export
- ✅ Result summary displayed after export completes
- ✅ Errors/warnings shown clearly

**Blocked By**: Task 2.2  
**Blocks**: Task 3.2

---

### Task 3.2: Integrate Conflict Dialog

**Description**: Reuse `SkillConflictDialog` component for profile export conflicts.

**Changes to ExportModal or new sub-component**:
- Listen for 'profile-conflict-prompt' event from IPC
- Show `SkillConflictDialog` with agent name and destination path
- Handle user's choice: Replace / Replace All / Cancel
- Send response via ipcRenderer.send('profile-conflict-response', { promptId, action })

**Acceptance Criteria**:
- ✅ Conflict dialog shown when file already exists
- ✅ Dialog displays: agent name, destination path
- ✅ User can select: Replace This / Replace All / Cancel
- ✅ Response sent back to main process with promptId
- ✅ Export continues (Replace) or stops (Cancel) accordingly

**Blocked By**: Task 3.1  
**Blocks**: Task 4.1

---

### Task 3.3: Display Result Summary

**Description**: Show export results to user after export completes.

**Changes to ExportModal**:
- After export result received, display summary:
  - Exported agents count and list
  - Skipped agents count and reasons
  - Warnings list (missing files, permissions, etc.)
- Provide "Copy to Clipboard" button for result summary
- Provide "Done" or "Close" button

**Acceptance Criteria**:
- ✅ Summary displayed after export
- ✅ Exported agents listed with paths
- ✅ Skipped agents listed with reasons
- ✅ Warnings list shown and scrollable if long
- ✅ Copy to clipboard works
- ✅ Modal can be closed

**Blocked By**: Task 3.2  
**Blocks**: Task 4.1

---

## Phase 4: Testing & Verification

### Task 4.1: Create Integration Tests for IPC Handler

**Description**: Implement integration tests in `tests/electron/ipc-handlers.test.ts` for profile export.

**Test Cases**:
- ✅ Handler callable with valid projectDir + destDir
- ✅ Valid export returns ExportAgentProfilesResult
- ✅ Conflict prompt sent with promptId + destinationPath
- ✅ Handler waits for response via promptId
- ✅ Replace action replaces file, export continues
- ✅ Replace-All action replaces all remaining files
- ✅ Cancel action aborts export, returns partial results
- ✅ Timeout on conflict prompt (30s) handled gracefully
- ✅ promptId mismatch detected (old prompt ID ignored)

**Acceptance Criteria**:
- ✅ All tests pass
- ✅ Coverage > 80% for ipc-handlers export code
- ✅ Tests run in < 5 seconds

**Blocked By**: Task 2.2  
**Blocks**: Verification

---

### Task 4.2: Create E2E Tests for ExportModal

**Description**: Implement E2E tests in `tests/ui/ExportModal.test.tsx` for profile export UI.

**Test Cases**:
- ✅ Button renders in Agents tab
- ✅ Button disabled until export dir selected
- ✅ Button enabled when export dir selected
- ✅ Loading indicator shown during export
- ✅ Conflict dialog shown on file conflict
- ✅ Replace This action replaces 1 file, continues
- ✅ Replace All action replaces all conflicts
- ✅ Cancel action aborts export
- ✅ Result summary displayed after export
- ✅ Summary shows exported count, skipped count, warnings

**Acceptance Criteria**:
- ✅ All tests pass
- ✅ UI flow works end-to-end
- ✅ Tests run in < 10 seconds

**Blocked By**: Task 3.3  
**Blocks**: Verification

---

### Task 4.3: Manual Testing Checklist

**Description**: Manual testing of the complete export flow.

**Scenarios**:
- ✅ Create test project with 3 agents, each with 2-3 profiles
- ✅ Export to new destination → All agents exported successfully
- ✅ Export again to same destination → Conflict dialog shown, Replace All works
- ✅ Create invalid profile path → Warning shown, export continues
- ✅ Disable a profile → Profile excluded from output
- ✅ Choose Cancel on conflict → Export aborts, partial results shown
- ✅ Close and reopen ExportModal → State reset correctly
- ✅ Check exported files → Content correct (no extra newlines, BOM removed)

**Acceptance Criteria**:
- ✅ All scenarios pass
- ✅ No crashes or hangs
- ✅ Result summary accurate

**Blocked By**: Task 4.2  
**Blocks**: Verification

---

## Summary

**Total Tasks**: 10  
**Phases**:
1. **Phase 1** (Backend Logic): Tasks 1.1, 1.2
2. **Phase 2** (IPC Integration): Tasks 2.1, 2.2
3. **Phase 3** (UI Integration): Tasks 3.1, 3.2, 3.3
4. **Phase 4** (Testing & Verification): Tasks 4.1, 4.2, 4.3

**Dependency Order**:
```
1.1 ──┬──> 2.1 ──> 2.2 ──> 3.1 ──> 3.2 ──> 3.3 ──> 4.2 ──> Verify
1.2 ──┤       └──> 4.1 ──────────────────────────┘
       └──> 4.3 ──> Verify
```

**Estimated Time**: 4-6 hours development + testing

**Status**: Ready for implementation.
