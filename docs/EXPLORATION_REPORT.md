# 🔍 SDD Explore Phase: Save Agent Graph Metadata Loss

**Project**: AgentsFlow Editor  
**Focus Area**: Technical investigation of metadata loss during save operations  
**Status**: ✅ Exploration Complete  
**Severity**: 🔴 CRITICAL  

---

## Investigation Report

### 1. Current State: How the System Works

The save flow consists of two independent IPC operations:

#### A. Global Save Button (Top-Right UI)
- Component: `AgentGraphSaveButton.tsx`
- Trigger: User clicks "Save" button after editing agent on canvas
- Serialization: Sends only **8 fields**
  - `id, name, description, type, isOrchestrator, hidden, x, y`
  - ❌ Omits: permissions, skills, aspects, profile, metadata

#### B. IPC Handler: SAVE_AGENT_GRAPH
- File: `src/electron/ipc-handlers.ts` (lines 613-793)
- Purpose: Persist visual graph to disk
- Process:
  1. Read existing `.adata` files from disk (preserves current state) ✅
  2. Construct new `.adata` object from request + existing data
  3. Write `.adata` atomically to disk

#### C. Permissions Save (Separate Flow)
- Component: `PermissionsModal.tsx`
- IPC Handler: `ADATA_SET_PERMISSIONS` (independent endpoint)
- Purpose: Save/update permissions separately
- Status: Works correctly when called directly ✅

---

### 2. Root Cause Identified

**Location**: `src/electron/ipc-handlers.ts`, lines 726-750

**The Problem**:

```typescript
// Lines 726-750: Constructor of .adata object
const adata: Record<string, unknown> = {
  version: 1,
  agentId: node.id,
  agentName: node.name,
  description: node.description,
  aspects: (existing.aspects as unknown[]) ?? [],           // ✅ PRESERVED
  skills: (existing.skills as unknown[]) ?? [],            // ✅ PRESERVED
  subagents: (existing.subagents as unknown[]) ?? [],      // ✅ PRESERVED
  profilePath: ...,
  profile: (existing.profile as unknown[]) ?? [],          // ✅ PRESERVED
  metadata: {
    ...((existing.metadata as Record<string, unknown>) ?? {}),  // ✅ PRESERVED
    agentType: node.type,
    isOrchestrator: String(node.isOrchestrator),
    hidden: node.type === "Sub-Agent" ? String(node.hidden) : "false",
  },
  createdAt: (existing.createdAt as string) ?? now,
  updatedAt: now,
  // ❌ MISSING: permissions field not included
};
```

**Why It Happens**:
- The code reads `existing.permissions` from disk (line 715-724) ✅
- But when constructing the new `adata` object, there's **no line** to preserve it
- All other fields (aspects, skills, subagents, profile, metadata) are explicitly preserved
- Permissions are simply forgotten ❌

---

### 3. Affected Areas

| Component | File | Lines | Issue |
|-----------|------|-------|-------|
| Save Button (UI) | `AgentGraphSaveButton.tsx` | 78-87 | Serializes only 8 fields; missing metadata |
| IPC Handler | `ipc-handlers.ts` | 726-750 | Missing permissions preservation |
| Write to Disk | `ipc-handlers.ts` | 752 | Writes incomplete `.adata` |
| Type Definition | `bridge.types.ts` | (need ID) | `AgentGraphNode` only has 8 fields |
| Canvas Agent | `agentFlowStore.ts` | 108-131 | `CanvasAgent` type doesn't include perms |

---

### 4. Failure Scenario (Step-by-Step)

```
┌─ Initial State ─────────────────────────────────────────┐
│  .adata on disk:                                        │
│  {                                                      │
│    "agentId": "orch-123",                              │
│    "permissions": { "Bash": { "run": "allow" } }        │
│    "skills": [...], "aspects": [...]                   │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ User opens Permissions Modal
         │   Defines: Bash.run = "allow"
         │   Clicks Save → ADATA_SET_PERMISSIONS ✅
         │
         ├─→ Permissions saved to .adata ✅
         │
         ├─→ User edits agent name on canvas
         │   Activates "isDirty" flag ✓
         │
         ├─→ User clicks global "Save" button
         │   AgentGraphSaveButton triggered
         │   Serializes: {id, name, desc, type, isOrch, hidden, x, y}
         │
         ├─→ IPC: SAVE_AGENT_GRAPH
         │   Reads existing .adata from disk
         │   existing.permissions = { "Bash": { "run": "allow" } } ✅
         │
         ├─→ Constructs new .adata object
         │   aspects: (existing.aspects) ?? [] ✅
         │   skills: (existing.skills) ?? [] ✅
         │   metadata: {...existing.metadata} ✅
         │   permissions: ??? ❌ NOT INCLUDED
         │
         ├─→ Writes .adata to disk
         │   JSON.stringify(adata) → missing permissions field
         │
└─ Final State ──────────────────────────────────────────┐
│  .adata on disk:                                        │
│  {                                                      │
│    "agentId": "orch-123",                              │
│    "permissions": undefined ❌ LOST!                    │
│    "skills": [...], "aspects": [...]                   │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
```

---

### 5. Audit Trail: Code Path

**AgentGraphSaveButton.tsx (Lines 66-123)**
```typescript
// Serialization ONLY sends visual state
const agentNodes: AgentGraphNode[] = agents.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  type: a.type,
  isOrchestrator: a.isOrchestrator,
  hidden: a.type === "Sub-Agent" ? a.hidden : false,
  x: a.x,
  y: a.y,
  // ❌ No permissions, skills, aspects, profile, metadata
}));
```

**ipc-handlers.ts (Lines 716-752)**
```typescript
// Read existing (correct)
let existing: Record<string, unknown> = {};
try {
  const raw = await readFile(adataPath, "utf-8");
  existing = JSON.parse(raw) as Record<string, unknown>;
}

// Construct new (MISSING permissions)
const adata: Record<string, unknown> = {
  version: 1,
  agentId: node.id,
  agentName: node.name,
  description: node.description,
  aspects: (existing.aspects as unknown[]) ?? [],
  skills: (existing.skills as unknown[]) ?? [],
  subagents: (existing.subagents as unknown[]) ?? [],
  profilePath: ...,
  profile: (existing.profile as unknown[]) ?? [],
  metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ... },
  createdAt: (existing.createdAt as string) ?? now,
  updatedAt: now,
  // ❌ CRITICAL: NO permissions line here
};

// Write (incomplete)
await atomicWriteJson(adataPath, adata);
```

---

### 6. Impact Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| **Severity** | 🔴 CRITICAL | Orchestrator loses delegation permissions; data silently lost |
| **Likelihood** | 🟡 MEDIUM | Requires 3 steps: define perms → edit agent → save |
| **Scope** | 🔴 HIGH | Affects any agent with permissions defined |
| **User Visibility** | 🔴 NONE | No warning; user unaware permissions disappeared |
| **Data Recovery** | 🟡 PARTIAL | Can recover from git history or backups only |

**Risk Score**: `CRITICAL × MEDIUM × HIGH = 🔴 CRITICAL PRIORITY`

---

### 7. Related Components at Risk

| Field | Preserved? | Status | Risk |
|-------|-----------|--------|------|
| `aspects` | ✅ Yes | Safe | Low |
| `skills` | ✅ Yes | Safe | Low |
| `subagents` | ✅ Yes | Safe | Low |
| `profile` | ✅ Yes | Safe | Low |
| `metadata` | ✅ Yes | Safe | Low |
| `permissions` | ❌ No | **BROKEN** | 🔴 CRITICAL |
| `opencode` | ? Unknown | Unknown | Medium |
| Other fields | ? Unknown | Unknown | Unknown |

---

### 8. Why This Happened

1. **Code Smell**: Lines 731-740 explicitly preserve multiple fields
2. **Incomplete Pattern**: Developer followed pattern for some fields but missed permissions
3. **No Validation**: No checks to ensure all fields are preserved
4. **Separate Architecture**: Permissions use different IPC endpoint (no coordination)
5. **Test Gap**: No integration test for full save cycle with permissions

---

### 9. Proposed Solutions

### Option A: Quick Fix (RECOMMENDED)
**Effort**: 5 minutes | **Risk**: Very Low | **Completeness**: Partial

Add one line to preserve permissions:
```typescript
permissions: (existing.permissions as Record<string, unknown>) ?? undefined,
```

**Pros**:
- Immediate fix for the critical bug
- One-line change, minimal risk of side effects
- Follows existing pattern for other fields

**Cons**:
- Doesn't address architectural fragmentation
- Doesn't verify all other fields are preserved

### Option B: Comprehensive Fix (RECOMMENDED FOR FUTURE)
**Effort**: 2-3 hours | **Risk**: Low | **Completeness**: Complete

1. Audit schema to identify all top-level fields
2. Ensure all fields are preserved (not just permissions)
3. Add validation layer to catch missing fields
4. Add integration tests for full save cycle

**Pros**:
- Prevents similar issues with other fields
- Adds safety guardrails
- Improves code quality

**Cons**:
- Takes longer to implement
- May discover other issues

### Option C: Architectural Refactor (FUTURE CONSIDERATION)
**Effort**: 1-2 days | **Risk**: Medium | **Completeness**: Best

Unify save operations:
- Combine SAVE_AGENT_GRAPH + ADATA_SET_PERMISSIONS into single coordinated operation
- Load all metadata into UI state for consistency
- Save all metadata in single transaction

**Pros**:
- Better consistency between UI and disk
- Prevents future fragmentation bugs

**Cons**:
- Significant refactor
- Risk of regression in existing functionality

---

### 10. Testing Strategy

#### Critical Test Case:
```gherkin
Scenario: Permissions survive graph save
  Given an agent with permissions defined
  When I edit the agent's name on the canvas
  And I click the global Save button
  Then the agent's permissions should still exist in .adata
  And the permissions values should be unchanged
```

#### Implementation:
```typescript
// tests/electron/save-agent-graph-preserves-metadata.test.ts
describe("SAVE_AGENT_GRAPH preserves metadata", () => {
  it("should preserve permissions when editing agent", async () => {
    // 1. Create initial .adata with permissions
    const adataPath = "metadata/agent-123.adata";
    const initialData = {
      agentId: "agent-123",
      permissions: { Bash: { run: "allow" } },
      // ... other fields
    };
    await fs.writeFile(adataPath, JSON.stringify(initialData));

    // 2. Call SAVE_AGENT_GRAPH with modified agent
    await handleSaveAgentGraph({
      projectDir: testDir,
      agents: [{
        id: "agent-123",
        name: "new-name",  // ← Changed
        description: "Updated",
        type: "Agent",
        isOrchestrator: true,
        hidden: false,
        x: 100,
        y: 200,
      }],
      edges: [],
    });

    // 3. Verify permissions preserved
    const saved = JSON.parse(await fs.readFile(adataPath, "utf-8"));
    expect(saved.permissions).toEqual({ Bash: { run: "allow" } });
  });

  it("should also preserve skills, aspects, and profile", async () => {
    // Similar test for other metadata fields
  });
});
```

---

### 11. Recommendations

### Immediate Actions (This Sprint)
1. ✅ Apply one-line fix to preserve permissions
2. ✅ Add integration test from section 10
3. ✅ Add audit logging to detect future losses
4. ✅ Update code comments to document field preservation

### Follow-Up Actions (Next Sprint)
1. Audit all `.adata` fields to ensure complete preservation
2. Add pre-save validation layer
3. Consider architectural improvements (Option C above)
4. Update documentation on metadata persistence

### Prevention Measures
1. Add TSLint rule to flag incomplete object literals in this area
2. Add pre-commit hook to run metadata preservation tests
3. Update developer documentation with "metadata preservation checklist"
4. Add metrics/logging to detect metadata corruption in production

---

### 12. Ready for Proposal

**Status**: ✅ YES - Ready to move to proposal phase

**Next Steps**:
1. Create a formal proposal (sdd-propose) with recommended approach
2. Design technical solution (sdd-design)
3. Break into implementation tasks (sdd-tasks)
4. Implement fix (sdd-apply)
5. Verify solution (sdd-verify)

**Recommended Approach**: Option A (quick fix) + Option B improvements (audit + tests)

---

## Conclusions

| Finding | Evidence |
|---------|----------|
| **Root Cause** | Missing `permissions` line in adata object constructor (ipc-handlers.ts:741-750) |
| **Severity** | CRITICAL - Orchestrator loses delegation permissions |
| **Likelihood** | MEDIUM - Requires specific 3-step user workflow |
| **Impact Scope** | HIGH - Any agent with permissions defined |
| **Fix Complexity** | LOW - One-line addition |
| **Test Gap** | HIGH - No integration test for full save cycle |
| **Risk of Regression** | LOW - Single, isolated change |
| **Architecture Debt** | MEDIUM - Permissions use separate IPC endpoint |

---

## Audit Checkpoints

- ✅ Identified exact code location
- ✅ Traced complete failure path
- ✅ Verified root cause (not architectural)
- ✅ Assessed impact and risk
- ✅ Designed test cases
- ✅ Proposed solutions with trade-offs
- ✅ Identified prevention measures

**Ready for**: Proposal → Design → Implementation → Verification
