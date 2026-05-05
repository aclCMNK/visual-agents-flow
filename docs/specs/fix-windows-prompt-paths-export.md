# 🐛 Fix: Windows Prompt Paths in JSON Export

**File:** `docs/specs/fix-windows-prompt-paths-export.md`  
**Status:** Ready for implementation  
**Scope:** `export-logic.ts` — functions `buildOpenCodeV2AgentEntry` and `buildAgentOpenCodeJson`

---

## 🎯 Problem

When the app runs on **Windows**, the exported `opencode.json` contains prompt paths using
forward slashes (`/`), which are not native to Windows and may cause issues with tools that
parse the path literally:

```json
"prompt": "{file:./prompts/my-project/my-agent.md}"
```

On Windows the expected output is:

```json
"prompt": "{file:.\\prompts\\my-project\\my-agent.md}"
```

On Linux/macOS the current behavior (`/`) must remain unchanged.

---

## 🔍 Root Cause

Both `buildOpenCodeV2AgentEntry` (line 614) and `buildAgentOpenCodeJson` (line 233) in
`src/ui/components/ExportModal/export-logic.ts` hardcode the prompt path using template
literals with `/` separators:

```ts
// buildOpenCodeV2AgentEntry — line 614
const prompt = `{file:./prompts/${projectName.toLowerCase()}/${agentName}.md}`;

// buildAgentOpenCodeJson — line 233
const prompt = `{file:./prompt/${projSlug}/${agentSlug}.md}`;
```

There is no platform-aware path separator logic in these functions.

---

## ✅ Platform Detection — How to Detect the OS

### In the renderer process (ExportModal context)

The platform is already exposed via the preload script:

```ts
// src/electron/preload.ts — line 737
platform: process.platform as "win32" | "linux" | "darwin",
```

And already consumed in the renderer via:

```ts
// src/renderer/hooks/useFolderExplorer.ts — line 106-109
const IS_WINDOWS: boolean =
  typeof (window as Window & { appPaths?: { platform?: string } }).appPaths?.platform === "string"
    ? (window as Window & { appPaths: { platform: string } }).appPaths.platform === "win32"
    : false;
```

### Pattern to use in export-logic.ts

Since `export-logic.ts` is a **pure module** (no DOM/window access), the platform must be
**injected as a parameter** — not read from `window` directly inside the function.
This keeps the functions testable and side-effect-free.

---

## 🏗️ Solution Design

### 1. Add a `pathSeparator` parameter to both builder functions

Both `buildOpenCodeV2AgentEntry` and `buildAgentOpenCodeJson` receive a new optional parameter:

```ts
separator?: "/" | "\\"
```

Default: `"/"` (preserves current behavior on Linux/macOS and in tests).

### 2. Use the separator when building the prompt path

Replace hardcoded `/` in the path segments with the injected separator:

```ts
// buildOpenCodeV2AgentEntry
const sep = separator ?? "/";
const prompt = `{file:.${sep}prompts${sep}${projectName.toLowerCase()}${sep}${agentName}.md}`;

// buildAgentOpenCodeJson
const sep = separator ?? "/";
const prompt = `{file:.${sep}prompt${sep}${projSlug}${sep}${agentSlug}.md}`;
```

> ⚠️ Note: the `{file:` prefix and `.md` suffix are NOT paths — they must never be modified.
> Only the internal path segments between `{file:` and `}` are affected.

### 3. Detect platform at the call site (ExportModal.tsx)

In `ExportModal.tsx`, where `buildAgentOpenCodeJson` and `buildOpenCodeV2AgentEntry` are called,
read the platform from `window.appPaths.platform` and pass the separator:

```ts
// At module or component level — same pattern as useFolderExplorer.ts
const IS_WINDOWS =
  typeof (window as Window & { appPaths?: { platform?: string } }).appPaths?.platform === "string"
    ? (window as Window & { appPaths: { platform: string } }).appPaths.platform === "win32"
    : false;

const pathSeparator: "/" | "\\" = IS_WINDOWS ? "\\" : "/";
```

Then pass it to the builder:

```ts
const agentJson = buildAgentOpenCodeJson(snapshot, project.name, pathSeparator);
// or
const entry = buildOpenCodeV2AgentEntry(agent, projectName, pathSeparator);
```

### 4. `buildOpenCodeV2Config` — propagate separator

`buildOpenCodeV2Config` calls `buildOpenCodeV2AgentEntry` internally. It must also accept and
forward the separator:

```ts
export function buildOpenCodeV2Config(
  agents: AgentExportSnapshot[],
  config: OpenCodeExportConfig,
  projectName: string,
  mdFileExists: (...) => boolean = () => true,
  separator?: "/" | "\\",   // ← new optional param
): OpenCodeV2Output
```

And forward it to each `buildOpenCodeV2AgentEntry(agent, projectName, separator)` call.

---

## 📁 Files to Modify

| File | Change |
|------|--------|
| `src/ui/components/ExportModal/export-logic.ts` | Add `separator` param to `buildAgentOpenCodeJson`, `buildOpenCodeV2AgentEntry`, `buildOpenCodeV2Config`. Use it when building the `prompt` string. |
| `src/ui/components/ExportModal/ExportModal.tsx` | Detect `IS_WINDOWS` from `window.appPaths.platform`. Derive `pathSeparator`. Pass it to all builder calls. |

---

## 🔒 Constraints & Safety Rules

| Rule | Detail |
|------|--------|
| **Default is `"/"`** | All existing callers (tests, other code) that don't pass `separator` continue to work unchanged. No breaking change. |
| **Only prompt path is affected** | The separator is applied ONLY to the `prompt` field value. No other field in the JSON output is touched. |
| **`{file:` prefix is literal** | The string `{file:` and the closing `}` are OpenCode syntax — never replace `/` inside them. Only the path segments after `{file:.` are affected. |
| **Plugin paths are NOT affected** | Plugin paths come from user input (already typed by the user). They are not modified. |
| **`$schema`, `model`, `color`, etc. are NOT affected** | Only the `prompt` field contains a generated path. |
| **Tests must pass on Linux** | All existing tests use the default separator (`"/"`). No test changes required unless new Windows-specific tests are added. |

---

## 🧪 Testing Guidance

### Existing tests (must still pass — no changes needed)
- All tests in `tests/ui/` that call `buildAgentOpenCodeJson` or `buildOpenCodeV2AgentEntry`
  without a separator argument must continue to produce `/`-separated paths.

### New tests to add (optional but recommended)
- `buildAgentOpenCodeJson(agent, project, "\\")` → prompt uses `\\` separators
- `buildOpenCodeV2AgentEntry(agent, project, "\\")` → prompt uses `\\` separators
- `buildOpenCodeV2Config(agents, config, project, () => true, "\\")` → all agent prompts use `\\`
- Verify that `$schema`, `model`, `color`, `description` are NOT affected by the separator

---

## 🔄 Exact Code Changes

### `export-logic.ts` — `buildAgentOpenCodeJson`

```ts
// BEFORE (line 222-233)
export function buildAgentOpenCodeJson(
  agent: AgentExportSnapshot,
  projectName: string,
): Record<string, AgentOpenCodeEntry> {
  ...
  const prompt = `{file:./prompt/${projSlug}/${agentSlug}.md}`;

// AFTER
export function buildAgentOpenCodeJson(
  agent: AgentExportSnapshot,
  projectName: string,
  separator: "/" | "\\" = "/",
): Record<string, AgentOpenCodeEntry> {
  ...
  const prompt = `{file:.${separator}prompt${separator}${projSlug}${separator}${agentSlug}.md}`;
```

### `export-logic.ts` — `buildOpenCodeV2AgentEntry`

```ts
// BEFORE (line 600-614)
export function buildOpenCodeV2AgentEntry(
  agent: AgentExportSnapshot,
  projectName: string,
): Record<string, OpenCodeV2AgentEntry> {
  ...
  const prompt = `{file:./prompts/${projectName.toLowerCase()}/${agentName}.md}`;

// AFTER
export function buildOpenCodeV2AgentEntry(
  agent: AgentExportSnapshot,
  projectName: string,
  separator: "/" | "\\" = "/",
): Record<string, OpenCodeV2AgentEntry> {
  ...
  const prompt = `{file:.${separator}prompts${separator}${projectName.toLowerCase()}${separator}${agentName}.md}`;
```

### `export-logic.ts` — `buildOpenCodeV2Config`

```ts
// BEFORE (line 689)
export function buildOpenCodeV2Config(
  agents: AgentExportSnapshot[],
  config: OpenCodeExportConfig,
  projectName: string,
  mdFileExists: (projectName: string, agentName: string) => boolean = () => true,
): OpenCodeV2Output {

// AFTER
export function buildOpenCodeV2Config(
  agents: AgentExportSnapshot[],
  config: OpenCodeExportConfig,
  projectName: string,
  mdFileExists: (projectName: string, agentName: string) => boolean = () => true,
  separator: "/" | "\\" = "/",
): OpenCodeV2Output {
```

And inside the loop (line 725-728):

```ts
// BEFORE
const entry = buildOpenCodeV2AgentEntry(agent, projectName);

// AFTER
const entry = buildOpenCodeV2AgentEntry(agent, projectName, separator);
```

### `ExportModal.tsx` — platform detection + call sites

Add near the top of the file (module level, outside the component):

```ts
// Platform detection — same pattern as useFolderExplorer.ts
const _IS_WINDOWS: boolean =
  typeof (window as Window & { appPaths?: { platform?: string } }).appPaths?.platform === "string"
    ? (window as Window & { appPaths: { platform: string } }).appPaths.platform === "win32"
    : false;

const EXPORT_PATH_SEPARATOR: "/" | "\\" = _IS_WINDOWS ? "\\" : "/";
```

Then at every call site of `buildAgentOpenCodeJson` (lines ~457, ~470) and
`buildOpenCodeV2Config` / `buildOpenCodeV2AgentEntry`, pass `EXPORT_PATH_SEPARATOR` as the
last argument.

---

## ⚠️ Risks

- **None for Linux/macOS**: default separator is `"/"` — zero behavioral change.
- **Windows only**: the `prompt` field in the JSON will now use `\\` instead of `/`.
  If OpenCode on Windows accepts both separators, this is a no-op improvement.
  If it requires `\\`, this is a required fix.
- **No cross-contamination**: plugin paths, schema URLs, model strings, colors are untouched.

---

## 📝 Notes

- The `window.appPaths.platform` approach is the **established pattern** in this codebase
  (see `useFolderExplorer.ts` line 100-109 and `preload.ts` line 737).
- Do NOT use `process.platform` in renderer code — it is not available in the renderer process.
- Do NOT use `path.sep` from Node — it is not available in the renderer process.
- The separator constant `EXPORT_PATH_SEPARATOR` should be defined at **module level** in
  `ExportModal.tsx`, not inside the component, to avoid re-evaluation on every render.
