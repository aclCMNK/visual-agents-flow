# 📋 Spec: Git Divergent Local Changes — Auto-Branch on Remote Connect

**Version:** 1.0  
**Date:** 2026-04-29  
**Status:** Ready for Implementation  
**Scope:** `src/electron/git-branches.ts`, `src/electron/bridge.types.ts`, `src/ui/hooks/useGitConfig.ts`, `src/ui/components/GitIntegrationModal/`

---

## 🎯 Objective

When the user connects a remote repository to an existing local project, the system must detect whether the local state diverges from the remote (uncommitted changes, diverged history, or incompatible HEAD). If divergence is detected, the system must automatically:

1. Create a new local branch (`local-changes-<YYYYMMDD-HHmmss>`) and move all local changes there.
2. Checkout the remote main branch and sync it via pull.
3. Notify the user clearly about what happened and where their changes are.

The temporary branch must be fully visible and usable in the editor's branch panel.

---

## 🧩 Context & Background

### Current Flow (as-is)

The `connect()` function in `useGitConfig.ts` does:
1. `gitSetRemote` → sets `origin`
2. `gitSaveCredentials` (optional)
3. `gitSetIdentity`
4. `gitDetectMainBranch`
5. `gitEnsureLocalBranch` → checkout + pull

**Problem:** Step 5 (`gitEnsureLocalBranch`) calls `git pull --ff-only`. If the local repo has:
- Uncommitted changes (dirty working tree)
- Local commits not in remote (ahead)
- Diverged history (both ahead and behind)

...the pull will fail with `E_DIRTY_WORKING_DIR` or `E_MERGE_CONFLICT`, and the user is left with a broken state and a cryptic error.

### Divergence Scenarios to Handle

| Scenario | Description | Detection Method |
|---|---|---|
| **Dirty working tree** | Uncommitted changes (staged or unstaged) | `git status --porcelain` returns non-empty |
| **Local ahead** | Local commits not pushed to remote | `aheadCount > 0` after fetch |
| **Diverged** | Both ahead and behind (split history) | `aheadCount > 0 && behindCount > 0` |
| **HEAD mismatch** | Local HEAD is not an ancestor of remote HEAD | `git merge-base --is-ancestor HEAD origin/<branch>` fails |

---

## 🏗️ Architecture

### New IPC Channel

```
GIT_HANDLE_DIVERGENCE: "git:handle-divergence"
```

**Request:**
```typescript
interface GitHandleDivergenceRequest {
  projectDir: string;
  remoteBranch: string; // e.g. "main"
}
```

**Response:**
```typescript
type GitHandleDivergenceResponse =
  | GitHandleDivergenceResult
  | GitOperationError;

interface GitHandleDivergenceResult {
  ok: true;
  divergenceDetected: boolean;
  /**
   * Name of the temporary branch created, if divergence was detected.
   * null when divergenceDetected === false.
   */
  savedBranch: string | null;
  /**
   * Human-readable summary of what happened.
   * Always present when divergenceDetected === true.
   */
  message: string | null;
}
```

### New Error Code

Add to `GitOperationErrorCode` union in `bridge.types.ts`:

```typescript
| "E_DIVERGENCE_SAVE_FAILED"
```

Used when the system detects divergence but fails to create the safety branch (e.g. stash fails, branch creation fails).

---

## 🔧 Backend Implementation

### File: `src/electron/git-branches.ts`

#### New function: `detectDivergence`

```typescript
/**
 * Detects whether the local repo diverges from origin/<remoteBranch>.
 * Returns a structured result with the type of divergence found.
 * Requires that `git fetch origin` has already been called.
 */
async function detectDivergence(
  projectDir: string,
  remoteBranch: string,
): Promise<{
  hasDirtyTree: boolean;
  aheadCount: number;
  behindCount: number;
  headIsAncestor: boolean;
}> {
  // 1. Check dirty working tree
  const statusRes = await runGit(projectDir, ["status", "--porcelain"]);
  const hasDirtyTree = statusRes.exitCode === 0 && statusRes.stdout.trim().length > 0;

  // 2. Count ahead/behind vs origin/<remoteBranch>
  const aheadRes = await runGit(projectDir, [
    "rev-list", "--count", `origin/${remoteBranch}..HEAD`
  ]);
  const behindRes = await runGit(projectDir, [
    "rev-list", "--count", `HEAD..origin/${remoteBranch}`
  ]);
  const aheadCount = aheadRes.exitCode === 0
    ? parseInt(aheadRes.stdout || "0", 10) || 0
    : 0;
  const behindCount = behindRes.exitCode === 0
    ? parseInt(behindRes.stdout || "0", 10) || 0
    : 0;

  // 3. Check if HEAD is ancestor of remote
  const ancestorRes = await runGit(projectDir, [
    "merge-base", "--is-ancestor", "HEAD", `origin/${remoteBranch}`
  ]);
  const headIsAncestor = ancestorRes.exitCode === 0;

  return { hasDirtyTree, aheadCount, behindCount, headIsAncestor };
}
```

#### New function: `handleDivergence`

```typescript
/**
 * Main orchestrator for the divergence resolution flow.
 *
 * Steps:
 *   1. git fetch origin
 *   2. detectDivergence()
 *   3. If no divergence → return { ok: true, divergenceDetected: false }
 *   4. Generate branch name: local-changes-<YYYYMMDD-HHmmss>
 *   5. git stash (if dirty tree)
 *   6. git checkout -b <tempBranch>
 *   7. git stash pop (if stash was used)
 *   8. git add -A && git commit -m "WIP: local changes saved before remote sync"
 *      (only if there are staged/unstaged changes after stash pop, or if ahead)
 *   9. git checkout <remoteBranch>  (or create from origin/<remoteBranch>)
 *  10. git pull --ff-only
 *  11. Return { ok: true, divergenceDetected: true, savedBranch, message }
 */
async function handleDivergence(
  projectDir: string,
  remoteBranch: string,
): Promise<GitHandleDivergenceResponse> {
  // ... (see detailed steps below)
}
```

#### Detailed Step Logic

**Step 1 — Fetch:**
```
git fetch origin
```
- Timeout: 20s
- On failure: return `toGitError(fetchRes, "Failed to fetch remote.")`

**Step 2 — Detect:**
Call `detectDivergence(projectDir, remoteBranch)`.

**Step 3 — Early exit if clean:**
```typescript
const isDiverged =
  divergence.hasDirtyTree ||
  divergence.aheadCount > 0 ||
  !divergence.headIsAncestor;

if (!isDiverged) {
  return { ok: true, divergenceDetected: false, savedBranch: null, message: null };
}
```

**Step 4 — Generate branch name:**
```typescript
const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const tempBranch = `local-changes-${datePart}-${timePart}`;
```

**Step 5 — Stash if dirty:**
```typescript
let stashCreated = false;
if (divergence.hasDirtyTree) {
  const stashRes = await runGit(projectDir, [
    "stash", "push", "--include-untracked", "-m", `agentsflow-divergence-${datePart}-${timePart}`
  ]);
  if (stashRes.exitCode !== 0) {
    return gitError(
      "E_DIVERGENCE_SAVE_FAILED",
      "Could not stash local changes before creating safety branch.",
      stashRes.stderr || undefined,
    );
  }
  stashCreated = true;
}
```

**Step 6 — Create temp branch from current HEAD:**
```typescript
const createRes = await runGit(projectDir, ["checkout", "-b", tempBranch]);
if (createRes.exitCode !== 0) {
  // Attempt to restore stash before failing
  if (stashCreated) {
    await runGit(projectDir, ["stash", "pop"]);
  }
  return gitError(
    "E_DIVERGENCE_SAVE_FAILED",
    `Could not create safety branch '${tempBranch}'.`,
    createRes.stderr || undefined,
  );
}
```

**Step 7 — Restore stash on temp branch:**
```typescript
if (stashCreated) {
  const popRes = await runGit(projectDir, ["stash", "pop"]);
  if (popRes.exitCode !== 0) {
    // Non-fatal: stash pop failed but branch exists. Log and continue.
    // The stash is still accessible via `git stash list`.
  }
}
```

**Step 8 — Commit all changes on temp branch:**
```typescript
// Check if there's anything to commit
const statusAfterPop = await runGit(projectDir, ["status", "--porcelain"]);
const hasChangesToCommit = statusAfterPop.stdout.trim().length > 0;

if (hasChangesToCommit) {
  await runGit(projectDir, ["add", "-A"]);
  await runGit(projectDir, [
    "commit", "-m",
    `chore: save local changes before remote sync [agentsflow-auto]`
  ]);
}
// If aheadCount > 0 but no dirty tree, commits are already on the branch — no action needed.
```

**Step 9 — Checkout remote main branch:**
```typescript
// Check if local branch for remoteBranch exists
const localExistsRes = await runGit(projectDir, [
  "show-ref", "--verify", "--quiet", `refs/heads/${remoteBranch}`
]);

let checkoutRes: RunGitResult;
if (localExistsRes.exitCode === 0) {
  checkoutRes = await runGit(projectDir, ["checkout", remoteBranch]);
} else {
  checkoutRes = await runGit(projectDir, [
    "checkout", "-b", remoteBranch, `origin/${remoteBranch}`
  ]);
}

if (checkoutRes.exitCode !== 0) {
  return gitError(
    "E_DIVERGENCE_SAVE_FAILED",
    `Local changes saved to '${tempBranch}', but could not checkout '${remoteBranch}'.`,
    checkoutRes.stderr || undefined,
  );
}
```

**Step 10 — Pull:**
```typescript
const pullRes = await runGit(projectDir, ["pull", "--ff-only"], 30_000);
if (pullRes.exitCode !== 0) {
  return gitError(
    "E_DIVERGENCE_SAVE_FAILED",
    `Local changes saved to '${tempBranch}', but pull failed on '${remoteBranch}'.`,
    pullRes.stderr || undefined,
  );
}
```

**Step 11 — Return success:**
```typescript
return {
  ok: true,
  divergenceDetected: true,
  savedBranch: tempBranch,
  message: `Your local changes have been saved in the branch '${tempBranch}'. You can merge them into '${remoteBranch}' when ready.`,
};
```

#### IPC Handler Registration

In `registerGitBranchesHandlers`:

```typescript
ipcMain.handle(
  IPC_CHANNELS.GIT_HANDLE_DIVERGENCE,
  async (_event, req: GitHandleDivergenceRequest) => {
    return handleDivergence(req.projectDir, req.remoteBranch);
  },
);
```

---

## 🔌 Bridge Types Changes

### File: `src/electron/bridge.types.ts`

#### 1. Add IPC channel

```typescript
// In IPC_CHANNELS object:

/**
 * Detects divergence between local and remote, and if found:
 * creates a safety branch with local changes, then syncs local to remote main.
 * Returns GitHandleDivergenceResponse.
 */
GIT_HANDLE_DIVERGENCE: "git:handle-divergence",
```

#### 2. Add new types

```typescript
// ── Git Divergence handling ────────────────────────────────────────────────

/** Request payload for GIT_HANDLE_DIVERGENCE */
export interface GitHandleDivergenceRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** The remote main branch to sync to (e.g. "main", "master") */
  remoteBranch: string;
}

/** Successful result of divergence handling */
export interface GitHandleDivergenceResult {
  ok: true;
  /** Whether divergence was detected and handled */
  divergenceDetected: boolean;
  /**
   * Name of the temporary branch created to preserve local changes.
   * null when divergenceDetected === false.
   */
  savedBranch: string | null;
  /**
   * User-facing message describing what happened.
   * null when divergenceDetected === false.
   */
  message: string | null;
}

export type GitHandleDivergenceResponse =
  | GitHandleDivergenceResult
  | GitOperationError;
```

#### 3. Extend `GitOperationErrorCode`

```typescript
// Add to the existing union:
| "E_DIVERGENCE_SAVE_FAILED"
```

---

## 🖥️ Frontend Changes

### File: `src/ui/hooks/useGitConfig.ts`

#### New state fields

```typescript
// Add to GitConfigState:
divergenceHandled: boolean;
savedBranch: string | null;
divergenceMessage: string | null;
isHandlingDivergence: boolean;
divergenceError: string | null;
```

#### New actions

```typescript
// Add to GitConfigAction union:
| { type: "DIVERGENCE_START" }
| { type: "DIVERGENCE_SUCCESS"; savedBranch: string | null; message: string | null }
| { type: "DIVERGENCE_ERROR"; error: string }
| { type: "DIVERGENCE_DISMISS" }
```

#### Reducer cases

```typescript
case "DIVERGENCE_START":
  return { ...state, isHandlingDivergence: true, divergenceError: null };

case "DIVERGENCE_SUCCESS":
  return {
    ...state,
    isHandlingDivergence: false,
    divergenceHandled: action.savedBranch !== null,
    savedBranch: action.savedBranch,
    divergenceMessage: action.message,
    divergenceError: null,
  };

case "DIVERGENCE_ERROR":
  return {
    ...state,
    isHandlingDivergence: false,
    divergenceError: action.error,
  };

case "DIVERGENCE_DISMISS":
  return {
    ...state,
    divergenceHandled: false,
    savedBranch: null,
    divergenceMessage: null,
  };
```

#### Modified `connect()` function

Replace the current `gitEnsureLocalBranch` call with the divergence-aware flow:

```typescript
// After DETECT_MAIN_BRANCH_SUCCESS, before the final checkVisibility:

if (detectResult.branch !== null) {
  dispatch({ type: "DETECT_MAIN_BRANCH_SUCCESS", branch: detectResult.branch });

  // NEW: Handle divergence before syncing
  dispatch({ type: "DIVERGENCE_START" });
  const divergenceResult = await bridge.gitHandleDivergence({
    projectDir,
    remoteBranch: detectResult.branch,
  });

  if (!divergenceResult.ok) {
    dispatch({ type: "DIVERGENCE_ERROR", error: divergenceResult.message });
    // Non-fatal: still attempt ensureLocalBranch as fallback
  } else {
    dispatch({
      type: "DIVERGENCE_SUCCESS",
      savedBranch: divergenceResult.savedBranch,
      message: divergenceResult.message,
    });
    // gitHandleDivergence already did checkout + pull, so skip ensureLocalBranch
    void checkVisibility(params.url);
    return;
  }

  // Fallback path (divergence handler failed): try ensureLocalBranch
  const ensureResult = await bridge.gitEnsureLocalBranch({
    projectDir,
    branch: detectResult.branch,
  });
  if (!ensureResult.ok) {
    dispatch({ type: "CONNECT_ERROR", error: ensureResult.message });
    return;
  }
}
```

#### Export new state fields and `dismissDivergence` callback

```typescript
export interface UseGitConfigResult {
  // ... existing fields ...
  dismissDivergence: () => void;
}
```

---

### File: `src/ui/components/GitIntegrationModal/GitConfigPanel.tsx`

#### New: `DivergenceNotice` component (inline or extracted)

Display a persistent info banner when `divergenceHandled === true`:

```tsx
{state.divergenceHandled && state.divergenceMessage && (
  <div className="divergence-notice" role="status" aria-live="polite">
    <span className="divergence-notice__icon">🔀</span>
    <div className="divergence-notice__body">
      <strong>Local changes preserved</strong>
      <p>{state.divergenceMessage}</p>
    </div>
    <button
      type="button"
      className="divergence-notice__dismiss"
      onClick={dismissDivergence}
      aria-label="Dismiss"
    >
      ✕
    </button>
  </div>
)}
```

**Styling guidelines:**
- Background: `var(--color-info-bg)` (blue-tinted, non-alarming)
- Border-left: `3px solid var(--color-info-border)`
- Icon: branch/merge icon (🔀 or SVG equivalent)
- Dismissible via ✕ button
- Does NOT auto-dismiss (user must acknowledge)

#### Loading state during divergence handling

While `isHandlingDivergence === true`, show a spinner/progress indicator in the connect button area:

```tsx
{state.isHandlingDivergence && (
  <p className="git-config__status">
    Saving local changes to a safety branch…
  </p>
)}
```

---

### File: `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx`

No structural changes needed. The temporary branch (`local-changes-*`) will appear automatically in the branch list since `listBranches` reads all `refs/heads`. 

**Optional enhancement:** Add a visual badge for branches matching the pattern `local-changes-*`:

```tsx
{branch.name.startsWith("local-changes-") && (
  <span className="branch-badge branch-badge--saved" title="Auto-saved local changes">
    saved
  </span>
)}
```

---

## 🔗 Preload Bridge

### File: `src/electron/preload.ts`

Add the new channel to the exposed API:

```typescript
gitHandleDivergence: (req: GitHandleDivergenceRequest) =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE, req),
```

### File: `src/ui/hooks/useElectronBridge.ts`

Add the type signature for the new method to the bridge interface:

```typescript
gitHandleDivergence: (req: GitHandleDivergenceRequest) => Promise<GitHandleDivergenceResponse>;
```

---

## ⚠️ Edge Cases

### EC-01: Empty repo (no commits)
- `git rev-list` will fail on a repo with no commits.
- **Handling:** In `detectDivergence`, check for empty repo first:
  ```
  git rev-parse HEAD
  ```
  If this fails (exit code ≠ 0), treat as `aheadCount = 0`, `hasDirtyTree` from status only.
  If dirty tree on empty repo: stash → create branch → stash pop → commit → checkout new branch from `origin/<remoteBranch>`.

### EC-02: Stash pop conflict
- After `git stash pop`, there may be conflicts if the stash and the new branch diverge.
- **Handling:** If `stash pop` exits non-zero, do NOT abort. Leave the stash in place and add a note to the user message:
  ```
  "Note: Some changes could not be automatically restored. Run 'git stash list' to find them."
  ```

### EC-03: Branch name collision
- `local-changes-<timestamp>` is unique to the second. Collision is extremely unlikely but possible.
- **Handling:** If `git checkout -b <tempBranch>` fails with `E_BRANCH_ALREADY_EXISTS`, append a random 4-char suffix:
  ```
  local-changes-20260429-143022-a3f1
  ```

### EC-04: No remote commits yet (fresh remote)
- `origin/<remoteBranch>` may not exist if the remote is empty.
- **Handling:** `git rev-list --count origin/<remoteBranch>..HEAD` will fail. Treat `behindCount = 0`. If `hasDirtyTree` or `aheadCount > 0`, still create the safety branch and push to remote.

### EC-05: Detached HEAD state
- `getCurrentBranch` returns `""` when HEAD is detached.
- **Handling:** If current branch is empty (detached HEAD), skip divergence handling and return `{ ok: true, divergenceDetected: false }`. Log a warning.

### EC-06: User cancels mid-flow
- The IPC call is atomic from the renderer's perspective. No cancellation mid-flow.
- **Handling:** The operation completes or fails atomically. If it fails partway, the error message must describe the partial state (e.g. "branch created but pull failed").

### EC-07: Untracked files only (no staged/committed changes)
- `git status --porcelain` will show `??` lines for untracked files.
- **Handling:** `git stash push --include-untracked` handles this correctly. Ensure the flag is always included.

### EC-08: `.gitignore` blocks stash
- Some files may be ignored and not stashed.
- **Handling:** This is expected Git behavior. Ignored files are not part of the working tree for stash purposes. No special handling needed.

### EC-09: Remote branch name differs from local expectation
- `detectMainBranch` may return `"main"` but remote has `"master"` or vice versa.
- **Handling:** `handleDivergence` receives the branch name from `detectMainBranch`, which already resolves the correct remote branch. No additional handling needed.

### EC-10: Network failure during fetch
- `git fetch origin` may time out or fail.
- **Handling:** Return `toGitError(fetchRes, "Failed to fetch remote.")`. The `connect()` flow will surface this as a `CONNECT_ERROR`.

---

## 💬 UX Messaging

### Success notification (divergence detected and handled)

```
Your local changes have been saved in the branch 'local-changes-20260429-143022'.
You can merge them into 'main' when ready.
```

### Success notification (no divergence)

No notification shown. The connect flow proceeds silently.

### Error notification (divergence save failed)

```
Could not save local changes automatically. Please commit or stash your changes manually before connecting to the remote.
```

### Loading state

```
Saving local changes to a safety branch…
```

### Branch panel badge

```
saved  ← small badge on branches matching local-changes-*
```

---

## ✅ QA Checklist

### Backend Unit Tests (`tests/git-branches.test.ts` or similar)

- [ ] `detectDivergence` returns `hasDirtyTree: true` when working tree has uncommitted changes
- [ ] `detectDivergence` returns `hasDirtyTree: false` on clean working tree
- [ ] `detectDivergence` returns correct `aheadCount` when local has unpushed commits
- [ ] `detectDivergence` returns correct `behindCount` when remote has new commits
- [ ] `detectDivergence` returns `headIsAncestor: false` on diverged history
- [ ] `handleDivergence` returns `divergenceDetected: false` on clean, synced repo
- [ ] `handleDivergence` creates `local-changes-*` branch when dirty tree detected
- [ ] `handleDivergence` creates `local-changes-*` branch when local is ahead
- [ ] `handleDivergence` creates `local-changes-*` branch when history is diverged
- [ ] `handleDivergence` successfully checks out remote main branch after saving
- [ ] `handleDivergence` returns correct `savedBranch` name in response
- [ ] `handleDivergence` returns correct `message` string in response
- [ ] `handleDivergence` handles empty repo (no commits) without crashing
- [ ] `handleDivergence` handles detached HEAD gracefully
- [ ] `handleDivergence` handles branch name collision by appending suffix
- [ ] `handleDivergence` returns `E_DIVERGENCE_SAVE_FAILED` when stash fails
- [ ] `handleDivergence` returns `E_DIVERGENCE_SAVE_FAILED` when branch creation fails
- [ ] `handleDivergence` returns `E_DIVERGENCE_SAVE_FAILED` when pull fails (with partial state message)
- [ ] `handleDivergence` handles network timeout on fetch

### Integration / E2E Tests

- [ ] Full connect flow: clean repo → no divergence notice shown
- [ ] Full connect flow: dirty tree → `local-changes-*` branch created → notice shown
- [ ] Full connect flow: local ahead → `local-changes-*` branch created → notice shown
- [ ] Full connect flow: diverged history → `local-changes-*` branch created → notice shown
- [ ] After divergence handling, `GitBranchesPanel` shows the new `local-changes-*` branch
- [ ] `local-changes-*` branch is checkable/switchable from the branch panel
- [ ] Divergence notice is dismissible via ✕ button
- [ ] Divergence notice persists across panel re-renders until dismissed
- [ ] Error state shown when divergence save fails
- [ ] Loading spinner shown during `isHandlingDivergence`

### Manual QA Scenarios

- [ ] **Scenario A:** Open project with uncommitted changes → connect remote → verify branch created, main branch synced, notice shown
- [ ] **Scenario B:** Open project with local commits not in remote → connect remote → verify branch created, main branch synced
- [ ] **Scenario C:** Open project with clean, synced state → connect remote → verify no notice shown, no extra branch created
- [ ] **Scenario D:** Open project with diverged history (both ahead and behind) → connect remote → verify branch created
- [ ] **Scenario E:** Disconnect and reconnect remote → verify idempotent behavior (no duplicate branches)
- [ ] **Scenario F:** Verify `local-changes-*` branch appears in branch list and can be checked out
- [ ] **Scenario G:** Verify user can merge `local-changes-*` into main manually after the fact
- [ ] **Scenario H:** Simulate network failure during fetch → verify error message is clear
- [ ] **Scenario I:** Untracked files only (no staged changes) → verify they are included in the safety branch

---

## 📁 Files to Create / Modify

| File | Action | Description |
|---|---|---|
| `src/electron/bridge.types.ts` | **Modify** | Add `GIT_HANDLE_DIVERGENCE` channel, `GitHandleDivergenceRequest`, `GitHandleDivergenceResult`, `GitHandleDivergenceResponse`, `E_DIVERGENCE_SAVE_FAILED` error code |
| `src/electron/git-branches.ts` | **Modify** | Add `detectDivergence()`, `handleDivergence()`, register IPC handler |
| `src/electron/preload.ts` | **Modify** | Expose `gitHandleDivergence` on `window.agentsFlow` |
| `src/ui/hooks/useElectronBridge.ts` | **Modify** | Add `gitHandleDivergence` to bridge interface type |
| `src/ui/hooks/useGitConfig.ts` | **Modify** | Add divergence state fields, actions, reducer cases, modify `connect()` |
| `src/ui/components/GitIntegrationModal/GitConfigPanel.tsx` | **Modify** | Add `DivergenceNotice` banner, loading state |
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | **Modify** (optional) | Add `saved` badge for `local-changes-*` branches |

---

## 📝 Notes

- The `handleDivergence` function is **idempotent in intent** but not in execution: calling it twice will create two `local-changes-*` branches (different timestamps). This is acceptable behavior.
- The temporary branch is **never pushed to remote** automatically. The user must push it manually if they want to preserve it remotely.
- The commit message on the safety branch uses `[agentsflow-auto]` tag to make it identifiable in git log.
- The `git stash push --include-untracked` flag ensures untracked files are also preserved.
- The entire `handleDivergence` operation runs in the **main process** (Electron backend), never in the renderer. This avoids any CSP or sandboxing issues.
- The `detectDivergence` function assumes `git fetch origin` has already been called before it runs. `handleDivergence` always calls fetch first.
- Branch naming uses local time (not UTC) for human readability. This is intentional.
