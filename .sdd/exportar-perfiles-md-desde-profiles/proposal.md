# Proposal: Export Agent Profiles to .md Files

**Change Name**: `exportar-perfiles-md-desde-profiles`  
**Date**: 2026-04-15  
**Status**: ✅ Ready for Implementation  

---

## Intent

Enable users to export agent profiles (concatenated markdown files) from the AgentsFlow project to a destination directory on disk. This allows agents' system prompts, memories, tools, and other profile components to be shared, versioned, or imported into other tools.

## Scope

### In Scope
- Read `profile[]` array from each agent's `.adata` metadata file
- Concatenate profile files in order (by `order` field)
- Write concatenated output to `[exportDir]/prompts/[projectName]/[agentName].md`
- Handle file conflicts (Replace / Replace All / Cancel)
- Report missing files and permission errors as warnings
- Reuse existing export infrastructure (ExportModal, IPC bridge, FolderExplorer)

### Out of Scope
- Modifying or editing profiles from the export UI
- Profile versioning or history tracking
- Integration with external profile databases
- Custom export formatting or templating

## Approach

### Core Logic
1. **Collection**: For each agent with non-empty `profile[]`, gather profiles sorted by `order`
2. **Validation**: Pre-validate all profile files exist; collect warnings for missing files
3. **Concatenation**: Read files in order, concatenate content directly (no extra delimiters)
4. **Conflict Handling**: Show modal on destination file conflict (Replace / Replace All / Cancel)
5. **Atomic Write**: Write to temporary file, then atomic rename to destination
6. **Reporting**: Return result with exported agents, skipped agents, and warnings

### Architecture Pattern
Follows existing **skills-export** pattern:
- Pure logic layer: `profile-export-handlers.ts` (Node.js file I/O, no IPC)
- IPC integration: Handler in `ipc-handlers.ts` + channel in `bridge.types.ts`
- UI integration: Button in `ExportModal.tsx` + reuse `SkillConflictDialog.tsx`
- Conflict callback: Uses `promptId` + `ipcMain.once()` (same as skills export)

## Key Design Decisions

1. **Pure concatenation** — No extra newlines, headers, or delimiters between profiles
2. **Relative path validation** — Profile `filePath` must be relative; rejected if absolute
3. **Pre-validation** — All missing files reported BEFORE writing ANY destination
4. **Atomic writes** — Write to `.tmp`, then `rename()` to prevent partial files
5. **UTF-8 only** — All reads/writes enforce UTF-8; remove BOM if present
6. **Stable sort** — When two profiles have same `order`, sort by array position

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Path traversal / jailbreak | HIGH | Schema validation + FolderExplorer boundary + realpath() check |
| Missing files discovered late | MEDIUM | Pre-validate ALL files before writing |
| Partial write on crash | MEDIUM | Atomic temp → rename pattern |
| Large file memory issues | LOW | Use simple readFile (MVP); monitor for streaming if needed |
| Modal state leak | LOW | 30s timeout + cleanup on promptId mismatch |
| Encoding issues (BOM, mixed UTF-8) | LOW | Enforce UTF-8, strip BOM on read |

## Success Criteria

- ✅ All profiles for an agent are concatenated and exported
- ✅ Missing profile files generate warnings, export continues
- ✅ File conflicts show modal and respect user choice
- ✅ Output path follows convention: `[exportDir]/prompts/[projectName]/[agentName].md`
- ✅ Atomic writes prevent partial files
- ✅ CLI/IPC logging shows clear status and warnings

## Deliverables

1. **Backend Logic**: `src/electron/profile-export-handlers.ts`
2. **IPC Integration**: Handler + channel + types
3. **UI Integration**: ExportModal button + conflict dialog
4. **Tests**: Unit + integration test coverage
5. **Documentation**: Inline comments + usage example in ExportModal

---

**Status**: Ready to proceed with design and specification.
