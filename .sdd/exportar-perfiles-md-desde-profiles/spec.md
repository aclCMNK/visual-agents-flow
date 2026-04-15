# Specification: Export Agent Profiles to .md Files

**Change**: `exportar-perfiles-md-desde-profiles`  
**Date**: 2026-04-15  

---

## Requirements

### R1: Profile Collection
**Requirement**: System MUST collect all agents with non-empty `profile[]` arrays from the project.

**Acceptance Criteria**:
- ✅ All agents with `profile.length > 0` are included
- ✅ Agents with `profile.length === 0` are skipped (no error)
- ✅ Profiles are sorted by `order` field (ascending)
- ✅ Stable sort: when two profiles have same `order`, preserve array position
- ✅ Disabled profiles (`enabled === false`) are still collected but marked as disabled

**Test Scenarios**:
1. Project with 3 agents (2 with profiles, 1 without) → Collect 2 agents
2. Agent with 5 profiles, orders: [2, 0, 2, 1, 0] → Sort to [0, 0, 1, 2, 2]
3. Agent with `enabled: false` profile → Collected but marked disabled
4. Project with no agents → Return empty collection (no error)

---

### R2: Pre-Validation
**Requirement**: System MUST validate all profile files BEFORE writing ANY destination file.

**Acceptance Criteria**:
- ✅ For each profile's `filePath`, verify file exists on disk
- ✅ For each file, verify readable (no permission errors)
- ✅ Collect warnings for all errors; don't abort on individual file missing
- ✅ Return warning list with: { agentId, profileId, filePath, reason }
- ✅ Disabled profiles are not validated (skipped)

**Test Scenarios**:
1. Agent with 2 profiles, 1 exists, 1 missing → Warning for missing file only
2. Agent with 1 profile, EACCES (permission denied) → Warning with error detail
3. Agent with 1 profile, path points to directory not file → Warning: "is directory"
4. All profiles valid → Warnings array is empty
5. Project with symbolic link → realpath() validates, not broken symlink

---

### R3: Destination Path Construction
**Requirement**: Exported files MUST be written to standard location: `[exportDir]/prompts/[projectName]/[agentName].md`

**Acceptance Criteria**:
- ✅ Destination directory created with `mkdir(..., { recursive: true })`
- ✅ agentName sanitized: replace `/` with `-` (for filesystem safety)
- ✅ projectName extracted from `.afproj` name (or normalized from project dir)
- ✅ `.md` extension always added
- ✅ All paths are absolute (realized from exportDir)
- ✅ Destination must be under $HOME (FolderExplorer enforces)

**Test Scenarios**:
1. projectName: "My Agents", agentName: "research", exportDir: "/home/user/exp"
   → `/home/user/exp/prompts/My Agents/research.md`
2. agentName contains `/` → Replace with `-` before constructing path
3. exportDir: "/home/user" (relative path should not happen; FolderExplorer gives absolute)
4. Nested destination dir doesn't exist → Create all intermediate dirs

---

### R4: File Concatenation
**Requirement**: Profile files MUST be concatenated in order WITHOUT extra delimiters or newlines.

**Acceptance Criteria**:
- ✅ Read each enabled profile file in order (by `order` field)
- ✅ Concatenate directly: `content1 + content2 + ...`
- ✅ NO extra newlines between files
- ✅ NO headers, dividers, or markers inserted
- ✅ UTF-8 BOM removed from each file on read (if present)
- ✅ Final output is plain UTF-8 text
- ✅ Disabled profiles are not read or included

**Test Scenarios**:
1. 2 profiles: "# Prompt 1" + "# Prompt 2" → Output is "# Prompt 1# Prompt 2" (NO extra newline)
2. File with UTF-8 BOM (EF BB BF) → BOM stripped, content read normally
3. File with CRLF line endings → Preserved as-is (no conversion)
4. Empty profile file → Included as-is (contributes nothing to output)
5. Profile with Unicode characters (emoji, accents) → Preserved in UTF-8

---

### R5: Atomic File Write
**Requirement**: Destination file writes MUST be atomic to prevent partial files.

**Acceptance Criteria**:
- ✅ Write to temporary file: `[destPath].tmp`
- ✅ After successful write, atomically rename `.tmp` to destination
- ✅ On write error, `.tmp` file left behind (safe, not used)
- ✅ On rename error, both `.tmp` and destination preserved (safe)
- ✅ No partial destination file in case of process crash

**Test Scenarios**:
1. Successfully write 1 MB file → Destination created with correct content
2. Process killed during write → `.tmp` file may exist; destination untouched
3. Disk full during write → `.tmp` left behind; destination untouched
4. Rename succeeds → `.tmp` removed, destination has content

---

### R6: Conflict Handling (File Already Exists)
**Requirement**: When destination file already exists, prompt user via modal dialog.

**Acceptance Criteria**:
- ✅ Show conflict modal with: agent name, destination path
- ✅ Options: "Replace This File", "Replace All", "Cancel"
- ✅ "Replace This File" → Replace current file, continue with next
- ✅ "Replace All" → Replace current and all subsequent conflicts without prompting
- ✅ "Cancel" → Abort entire export, return partial results
- ✅ Conflict callback implemented as: promptId + ipcMain.once() (reuse skills-export pattern)

**Test Scenarios**:
1. First export to path → No conflict, file created
2. Second export to same path → Conflict modal shown
3. User selects "Replace This File" → File replaced, next agent starts
4. User selects "Replace All" on first conflict → All remaining conflicts auto-replaced
5. User selects "Cancel" → Export aborts, previously exported files remain

---

### R7: Warning Reporting
**Requirement**: Warnings (missing files, permission errors, etc.) MUST be reported to user.

**Acceptance Criteria**:
- ✅ Each warning includes: agent name, profile ID, file path, error reason
- ✅ Warnings don't stop export (profiles are skipped, export continues)
- ✅ Final result includes warnings array + count
- ✅ UI displays warnings prominently (list or collapsible section)
- ✅ Warnings logged to console/file for debugging

**Test Scenarios**:
1. Export with 1 missing profile → Warning shown, export continues
2. Export with 3 agents, 2 have missing profiles → 2 warnings shown, 1 agent exported
3. Permission denied on 1 profile → Warning with errno (EACCES), export continues
4. All profiles missing → Agent skipped entirely, warning list shown

---

### R8: Result Summary
**Requirement**: After export, system MUST return detailed result with exported/skipped counts and warnings.

**Acceptance Criteria**:
- ✅ Result includes: { success, exported[], skipped[], warnings[], summary }
- ✅ exported[] contains: { agentName, path }
- ✅ skipped[] contains: { agentName, reason }
- ✅ summary contains: { totalAgents, exportedCount, skippedCount, warningCount }
- ✅ success is true if at least 1 agent exported; false if 0 exported
- ✅ UI displays result summary to user

**Test Scenarios**:
1. Export 2 agents successfully → exported: 2, skipped: 0, success: true
2. Export 0 agents (all have errors) → exported: 0, skipped: 3, success: false
3. Mixed: 1 exported, 1 skipped, 2 warnings → All counts correct

---

### R9: Path Traversal Prevention
**Requirement**: Profile file paths MUST be validated to prevent directory traversal attacks.

**Acceptance Criteria**:
- ✅ Profile `filePath` must be relative (checked by schema validation + runtime)
- ✅ Reject paths containing `..` or starting with `/`
- ✅ Use `realpath()` to resolve symlinks and verify within project dir
- ✅ Destination path validated by FolderExplorer (must be under $HOME)
- ✅ No file writes outside project dir or home dir

**Test Scenarios**:
1. Profile filePath: "behaviors/agent/system.md" → Valid, allowed
2. Profile filePath: "/etc/passwd" (absolute) → Rejected, warning
3. Profile filePath: "../../../../../../etc/passwd" (traversal) → Rejected, warning
4. Profile filePath: "behaviors/agent/../../behaviors/agent/system.md" (relative traversal) → Checked with realpath()

---

### R10: UI Integration
**Requirement**: ExportModal MUST provide button and modal for profile export.

**Acceptance Criteria**:
- ✅ "Export Agent Profiles" button visible in Agents tab
- ✅ Button disabled until export destination selected
- ✅ On click, start export in background
- ✅ Show loading state during export
- ✅ On conflict, show SkillConflictDialog (reused from skills export)
- ✅ After export, show result summary (exported count, warnings, skipped)
- ✅ User can copy result summary to clipboard

**Test Scenarios**:
1. ExportModal rendered without export dir → Button disabled
2. Export dir selected → Button enabled
3. Click button → Export starts, loading indicator shown
4. Conflict during export → Modal appears with Replace/Replace All/Cancel
5. Export completes → Summary dialog shown

---

### R11: Disabled Profile Handling
**Requirement**: Profiles with `enabled: false` MUST be excluded from export.

**Acceptance Criteria**:
- ✅ Profiles with `enabled: false` are collected but marked disabled
- ✅ During pre-validation, disabled profiles are skipped (not validated)
- ✅ During concatenation, disabled profiles are not read or included
- ✅ Final output excludes all disabled profiles

**Test Scenarios**:
1. Agent with 3 profiles: [enabled: true, enabled: false, enabled: true]
   → Only profiles 1 and 3 included in output
2. Agent with all profiles disabled → Agent skipped, no file written

---

### R12: Error Logging
**Requirement**: All operations MUST be logged for debugging and auditing.

**Acceptance Criteria**:
- ✅ Log each agent export attempt with: agent name, destination path
- ✅ Log warnings for missing files with: agent name, profile ID, file path
- ✅ Log conflict resolutions: Replace / Replace All / Cancel + file count
- ✅ Log final summary: total agents, exported count, skipped count, warnings
- ✅ Logs include timestamps and context (project dir, export dir)

**Test Scenarios**:
1. Export successful → Log: "Exported agent 'research' to /path/to/research.md"
2. Profile missing → Log: "Warning: profile 'system-prompt.md' not found for agent 'research'"
3. User clicks Replace All → Log: "Replace All selected, remaining 5 conflicts will overwrite"
4. Export finalized → Log: "Profile export completed: 3 exported, 1 skipped, 2 warnings"

---

## Non-Functional Requirements

### NFR1: Performance
- Export operation completes within 5 seconds for typical project (< 10 agents, < 50 profiles total)
- Memory usage stays under 100 MB for profiles up to 10 MB total size
- UI remains responsive during export

### NFR2: Reliability
- No data corruption on partial export or process crash
- Atomic writes prevent partial destination files
- Conflict modal timeout prevents hung prompts (30s max)

### NFR3: Usability
- Result summary clearly shows what was exported and what failed
- Warnings are actionable (show missing file paths, error details)
- Export can be cancelled at any time without leaving partial files

### NFR4: Maintainability
- Code follows project conventions (file structure, naming, imports)
- Pure logic layer separated from IPC (testable without Electron)
- Tests cover happy path and error cases

---

**Status**: Ready for task breakdown and implementation.
