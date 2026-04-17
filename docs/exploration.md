# Exploration: Left Panel "Sync Tasks" Button Implementation

**Date**: 2026-04-16  
**Status**: ✅ EXPLORATION COMPLETE  
**Topic**: Add "Sync Tasks" button to left panel sidebar for syncing `permissions > task` fields across delegating agents  
**Investigator**: SDD Explorer

---

## Current State

### Left Panel Architecture

The left sidebar (agent tree) is currently built as follows:

**Location**: `src/ui/App.tsx` (lines 203-259)
```
EditorView
  └─> <aside class="editor-view__sidebar">
        ├─> .editor-view__sidebar-header
        │   ├─> <h2> "Agents" </h2>
        │   ├─> Agent count badge
        │   ├─> "+ New agent" button
        │   └─> "👤 Add User" / "👤 User ✓" conditional button
        └─> <ul class="editor-view__flow-agent-list">
            └─> flowAgents.map(agent => <AgentTreeItem agent={...} />)
```

**Key Components**:
- **App.tsx** — Root editor view, renders sidebar header
- **AgentTreeItem.tsx** (lines 1-97) — Individual agent row component
  - Shows agent name + type badge (Agent/Sub-Agent)
  - Shows orchestrator indicator (🎯)
  - Edit (✏️) and Delete (✕) buttons
  - Click to select agent → opens detail panel on right
  - Double-click to open edit modal

**State Management**:
- All agents stored in `useAgentFlowStore()` via Zustand
- Store state: `agents: CanvasAgent[]`
- Store actions: `startPlacement()`, `updateAgent()`, `deleteAgent()`, etc.
- Store also tracks delegation links: `links: AgentLink[]`
- Store state persisted to project at save via `SaveAgentGraphRequest`

### Current Sidebar Header Structure

The sidebar header (lines 206-238 in App.tsx) includes:
- Title: "Agents"
- Count badge: `{flowAgents.length}`
- "+ New agent" button
- "👤 Add User" button (conditional)

**No other buttons or actions exist in the header currently.**

### Permissions & Task Delegation Data Model

**Stored in**: `.adata` metadata files (JSON) at `metadata/<agentId>.adata`

**Permissions structure** (from `src/schemas/adata.schema.ts`):
```typescript
permissions?: {
  "ungroupedPerm": "allow" | "deny" | "ask",
  "GroupName": {
    "perm": "allow" | "deny" | "ask",
    ...
  },
  "skills": {
    "kb-search": "allow",
    "web*": "deny",
    ...
  }
}
```

**Task delegation** (from `docs/specs/exporter-opencode.md` lines 68, 118-122):
- Delegations exported as special skills: `skill-delegation-[subagent-name]`
- Stored in OpenCode export under `permissions`
- When agents delegate to subagents, a `permissions > task` field should track:
  - Target subagent name
  - Delegation type (Optional/Mandatory/Conditional)
  - Trigger conditions and rules

**Current Gap**: 
- `.adata` currently has `permissions` object (allow/deny/ask values)
- **NO explicit `permissions.task` structure is currently implemented**
- Task delegation info exists only in the **flow links** (canvas) as metadata:
  - `AgentLink` has: `fromAgentId`, `toAgentId`, `ruleType`, `delegationType`, `ruleDetails`
  - These are stored in `.afproj` file under `connections[]`

### Link Persistence (Agent Delegation)

**From `src/electron/bridge.types.ts`**:
```typescript
interface ConnectionData {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  label?: string;
  type: "default" | "conditional" | "fallback";
  metadata?: Record<string, string>; // { relationType, delegationType, ruleDetails }
}

interface AgentLink {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  relationType: "Delegation" | "Response";
  delegationType: "Optional" | "Mandatory" | "Conditional";
  ruleDetails: string;
}
```

**Sync Logic Needed**:
- When user clicks "Sync Tasks", iterate all agents
- For each agent that has outgoing "Delegation" links:
  - Read current `.adata` file
  - For each delegation link, update/create `permissions.tasks` structure with:
    - Target subagent ID/name
    - Delegation type and rules
  - Write updated `.adata` back to disk

---

## Affected Areas

### Frontend Components
- **`src/ui/App.tsx`** — EditorView sidebar header (lines 203-238)
  - Where to add the "Sync Tasks" button
  - Access to `flowAgents` and `links` from store
  
- **`src/ui/components/AgentTreeItem.tsx`** — Individual agent rows
  - No changes needed (unless we want per-agent sync indicator)

### State Management
- **`src/ui/store/agentFlowStore.ts`** (722 lines)
  - Already tracks agents + links
  - Need to add new action: `syncTaskPermissions()` or similar
  - Action should call Electron IPC handler

### Backend Handlers (Electron)
- **`src/electron/permissions-handlers.ts`** (177 lines)
  - Has `readPermissionsFromDisk()` and `writePermissionsToDisk()`
  - Need to extend with task-specific sync logic
  
- **`src/electron/ipc-handlers.ts`** — Main IPC router
  - Need to register new IPC channel: `SYNC_TASK_PERMISSIONS` or similar
  - Handler should coordinate sync across all agents

### Project Model
- **`src/loader/project-factory.ts`** — Project loading/creation
  - May need updates if new schema validation required

- **`src/schemas/adata.schema.ts`** (175 lines)
  - May need to extend `AdataSchema` to include `permissions.tasks` structure
  - Or define new `TaskDelegationSchema`

### IPC Bridge Types
- **`src/electron/bridge.types.ts`** — Type definitions
  - Need: `SyncTaskPermissionsRequest` / `SyncTaskPermissionsResult` types

---

## Key Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ UI: Left Panel "Sync Tasks" button                                      │
│ Location: src/ui/App.tsx lines 206-238 (sidebar header)                │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ onClick
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ Zustand Store Action: syncTaskPermissions()                             │
│ Location: src/ui/store/agentFlowStore.ts                               │
│ Responsibility: Extract delegations from this.links                     │
│ Call IPC bridge                                                         │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ window.electron.syncTaskPermissions({...})
                         │ 
┌────────────────────────▼────────────────────────────────────────────────┐
│ Preload Bridge: preload.ts                                              │
│ Location: src/electron/preload.ts                                       │
│ Responsibility: Marshal call to main process IPC                        │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ ipcRenderer.invoke('SYNC_TASK_PERMISSIONS', payload)
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ Main Process IPC Handler                                                │
│ Location: src/electron/ipc-handlers.ts                                  │
│ Channel: SYNC_TASK_PERMISSIONS                                          │
│ Responsibility: Parse request, call handler                             │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ Handler Function: handleSyncTaskPermissions()                           │
│ Location: src/electron/permissions-handlers.ts (NEW)                    │
│ Responsibility:                                                         │
│   1. For each agent in payload:                                         │
│      - Read its .adata file                                             │
│      - Find all delegations (links from this agent)                     │
│      - Build permissions.tasks object                                   │
│      - Write updated .adata back to disk                                │
│   2. Return success/error + count of synced agents                      │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
                         ▼
            IPC Response back to renderer
            UI shows toast: "✅ Synced {N} agents' task permissions"
```

---

## Approaches

### **Approach A: Simple Button in Sidebar Header (RECOMMENDED)**

**Location**: Add button to `src/ui/App.tsx` sidebar-header (after "+ New agent" button)

**Implementation**:
1. Add new store action in `agentFlowStore.ts`:
   ```typescript
   syncTaskPermissions(): Promise<void> {
     // Call IPC → backend sync logic
     // Show toast on success/error
   }
   ```

2. Register IPC handler in `src/electron/ipc-handlers.ts`:
   ```typescript
   ipcMain.handle(IPC_CHANNELS.SYNC_TASK_PERMISSIONS, async (event, req) => {
     return handleSyncTaskPermissions(req);
   });
   ```

3. Implement core logic in `src/electron/permissions-handlers.ts`:
   ```typescript
   export async function handleSyncTaskPermissions(
     req: SyncTaskPermissionsRequest
   ): Promise<SyncTaskPermissionsResult> {
     const results = [];
     for (const agentId of req.agentIds) {
       // Read .adata, sync tasks, write back
     }
     return { success: true, syncedCount: results.length };
   }
   ```

4. Add button to UI:
   ```tsx
   <button
     className="editor-view__sync-tasks-btn"
     onClick={() => syncTaskPermissions()}
     title="Sync all task delegations to .adata permissions"
     aria-label="Sync Tasks"
   >
     🔄 Sync Tasks
   </button>
   ```

**Pros**:
- Minimal UI changes (single button)
- Reuses existing permission-handlers infrastructure
- Clear separation of concerns (UI → Store → IPC → Handler)
- Easy to test (pure handler function)
- Consistent with existing patterns (ExportModal, SaveButton)

**Cons**:
- Operates on **ALL agents** (no filtering)
- No per-agent visibility into what was synced
- If sync fails partially, user sees generic error

**Effort**: Medium (2-3 hours)

---

### **Approach B: Per-Agent Sync Icons (More Granular)**

**Location**: Add small indicator icon on each `AgentTreeItem` in `src/ui/components/AgentTreeItem.tsx`

**Implementation**:
1. Add computed store selector to identify which agents have delegations:
   ```typescript
   getAgentsWithDelegations(): string[] {
     return this.agents
       .filter(a => this.links.some(l => l.fromAgentId === a.id && l.ruleType === 'Delegation'))
       .map(a => a.id);
   }
   ```

2. On each `AgentTreeItem` with delegations, show:
   - 🔄 icon if sync status is "pending"
   - ✅ icon if sync status is "done"
   - ⚠️ icon if sync failed

3. Allow per-agent sync via right-click context menu or icon click

**Pros**:
- User sees which agents have delegations
- Can sync individual agents if needed
- Better UX feedback (which agents were synced)

**Cons**:
- More UI complexity
- Requires agent-level sync tracking in store
- Context menu or icon area might clutter the tree
- More handler complexity (per-agent vs batch)

**Effort**: High (4-6 hours)

---

### **Approach C: Sync in Export Flow (Non-Interactive)**

**Location**: Automatically sync tasks when exporting to OpenCode

**Implementation**:
1. In `src/ui/components/ExportModal/export-logic.ts`:
   - Before generating OpenCode JSON, call sync handler
   - Ensure all `.adata` files have up-to-date `permissions.tasks`
   - Then export normally

2. User doesn't need to manually click "Sync Tasks"
   - It happens automatically during export

**Pros**:
- User never forgets to sync (automatic)
- Reduces manual steps
- Ensures export always has latest delegations

**Cons**:
- Hidden from user (less transparency)
- Export might fail if sync fails
- Can't inspect sync results before export
- Confuses mental model (export shouldn't have side effects on `.adata`)

**Effort**: Medium (1-2 hours)

---

### **Approach D: Sync on Save (Automatic)**

**Location**: Integrate with `AgentGraphSaveButton` save flow

**Implementation**:
1. When user clicks "Save" button in `src/ui/components/AgentGraphSaveButton.tsx`:
   - First save agent graph to `.afproj`
   - Then automatically sync task permissions

2. No new button needed, happens transparently

**Pros**:
- Automatic (user can't forget)
- Keeps `.adata` always in sync
- Minimal UI changes

**Cons**:
- Save operation takes longer (adds latency)
- User has no control over when sync happens
- If sync fails, save fails (tightly coupled)
- Hidden operation (bad discoverability)

**Effort**: Medium (1-2 hours)

---

## Recommendation

**Go with Approach A: Simple Button in Sidebar Header**

**Rationale**:
1. **Clarity**: User explicitly controls when sync happens
2. **Simplicity**: Minimal UI changes, reuses existing infrastructure
3. **Testability**: Pure handler function, easy to unit test
4. **Discoverability**: Button is visible and obvious
5. **Safety**: Doesn't tie sync to save (can sync without saving)
6. **Consistency**: Matches export/import pattern (explicit actions)

**Follow-up**: After Approach A works, consider adding Approach B (per-agent indicators) as an enhancement for better UX.

---

## Implementation Outline

### Phase 1: Schema & Types
1. Extend `AdataSchema` in `src/schemas/adata.schema.ts`:
   - Define `TaskDelegationSchema` structure
   - Update `AdataSchema.permissions` to support `tasks` field

2. Add IPC types in `src/electron/bridge.types.ts`:
   ```typescript
   interface SyncTaskPermissionsRequest {
     projectDir: string;
     agentIds: string[]; // All agents to sync, or empty = all
   }
   
   interface SyncTaskPermissionsResult {
     success: boolean;
     syncedCount: number;
     updatedAgents: string[]; // agent IDs that had tasks synced
     error?: string;
   }
   ```

### Phase 2: Backend Handler
1. Create `handleSyncTaskPermissions()` in `src/electron/permissions-handlers.ts`
2. For each agent:
   - Read `.adata` file
   - Extract all outgoing delegation links (from store via IPC request)
   - Build `permissions.tasks` object:
     ```typescript
     tasks: {
       [targetSubagentName]: {
         type: "delegation" | "response",
         delegationType: "Optional" | "Mandatory" | "Conditional",
         ruleDetails: string,
         syncedAt: ISO8601 timestamp
       }
     }
     ```
   - Write back to `.adata`

### Phase 3: Frontend Store Action
1. Add action to `useAgentFlowStore` in `src/ui/store/agentFlowStore.ts`:
   ```typescript
   async syncTaskPermissions(): Promise<void> {
     try {
       const response = await window.electron.syncTaskPermissions({
         projectDir: this.projectDir,
         agentIds: this.agents.map(a => a.id),
         links: this.links // Send link data for handler
       });
       showToast("success", `✅ Synced ${response.syncedCount} agents' task permissions`);
     } catch (err) {
       showToast("error", `❌ Sync failed: ${err.message}`);
     }
   }
   ```

### Phase 4: UI Button
1. Add button to sidebar-header in `src/ui/App.tsx`:
   ```tsx
   <button
     className="editor-view__sync-tasks-btn"
     onClick={() => useAgentFlowStore.getState().syncTaskPermissions()}
     disabled={flowAgents.length === 0}
     title="Sync task delegations to .adata permissions"
   >
     🔄 Sync Tasks
   </button>
   ```

### Phase 5: Testing
1. Unit test: Handler logic (mock .adata reads/writes)
2. Integration test: IPC round-trip
3. Manual test: Create agents with delegations, click button, verify .adata files updated

---

## Risks

### Risk 1: Schema Migration
- If adding `permissions.tasks` to existing `.adata` files, need backward compatibility
- **Mitigation**: Always preserve unknown keys when reading/writing `.adata`

### Risk 2: Partial Sync Failure
- If sync fails for one agent, user doesn't know which one(s)
- **Mitigation**: Return list of successfully synced agents + failed agent IDs in response

### Risk 3: Sync vs Save Consistency
- If user syncs but doesn't save, changes aren't persisted in `.afproj`
- **Mitigation**: Make clear that sync updates `.adata` files on disk, not canvas state

### Risk 4: Link Data Not Available
- Handler is in main process, but link data is in renderer state
- **Mitigation**: Pass `links: AgentLink[]` in IPC request payload

### Risk 5: Performance
- Syncing many agents with many delegations could be slow (file I/O)
- **Mitigation**: Add progress toast, make IPC call non-blocking

---

## Ready for Proposal

**Status**: ✅ YES

**Next Steps**:
1. Clarify with user: Should we add `permissions.tasks` to schema or use different field?
2. Determine: Should sync be all-agents or just project-loaded agents?
3. Confirm: When should sync happen (manual button, automatic on save, or both)?

**What the orchestrator should tell the user:**

> "The left panel currently shows an agent tree with individual agent controls (edit, delete). To add a 'Sync Tasks' button, we need to:
> 
> 1. **Add sync logic in the backend** (new handler to read/update delegation info from `.adata` files)
> 2. **Add IPC channel** for the renderer to call the sync handler
> 3. **Add a button to the sidebar header** with a clear label (🔄 Sync Tasks)
> 4. **Extend the permissions schema** to include delegation task metadata
> 
> The recommended approach is a simple button that syncs all agents' task delegations on-demand. Clicking it will:
> - Read all canvas links (delegations)
> - For each agent that delegates, update its `.adata` file
> - Add/update the `permissions.tasks` section with delegation info
> - Show a success toast with count of synced agents
> 
> This keeps the UI minimal, operation explicit, and data flow clear."

---

## Files to Create/Modify

| File | Change | Type |
|------|--------|------|
| `src/ui/App.tsx` | Add button to sidebar-header | UI |
| `src/ui/store/agentFlowStore.ts` | Add `syncTaskPermissions()` action | Store |
| `src/electron/ipc-handlers.ts` | Register SYNC_TASK_PERMISSIONS channel | Handler |
| `src/electron/permissions-handlers.ts` | Add `handleSyncTaskPermissions()` function | Handler |
| `src/electron/preload.ts` | Expose `syncTaskPermissions()` method | Bridge |
| `src/electron/bridge.types.ts` | Add request/result types | Types |
| `src/schemas/adata.schema.ts` | Extend schema with `tasks` field (optional) | Schema |
| `src/ui/styles/` | Add `.editor-view__sync-tasks-btn` CSS | Styles |

---

## Key Learnings

| Finding | Details |
|---------|---------|
| **Current Panel Structure** | Simple hierarchical: header (buttons) + agent list (tree items) |
| **State Architecture** | Canvas state in Zustand store, persisted via IPC to `.afproj` |
| **Delegation Model** | Stored as `AgentLink[]` in store, with `relationType`, `delegationType`, `ruleDetails` |
| **Permissions Storage** | Stored in `.adata` JSON files per agent; currently only "allow"/"deny"/"ask" values |
| **Sync Target** | Need to sync canvas link data (delegations) into `.adata` permission structure |
| **IPC Pattern** | Renderer → Preload → IPC → Main Handler → File I/O → Response |
| **Toast Pattern** | Existing toasts used for export/save feedback (ExportModal, SaveButton) |
| **No Schema Conflict** | Adding `permissions.tasks` won't conflict with existing `permissions` structure |

