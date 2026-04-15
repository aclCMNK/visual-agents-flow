/**
 * electron-main/src/fs/filter.ts
 *
 * FolderExplorer — Entry Filter
 * ─────────────────────────────
 * Decides whether a filesystem entry (file or directory) should be shown
 * to the user in the FolderExplorer UI.
 *
 * WHY THIS EXISTS
 * ────────────────
 * The IPC handler `FS_LIST_HOME_DIR` receives raw `fs.readdir` results and
 * needs a single, tested function to decide which entries surface in the UI.
 * Bundling this logic here (separate from the handler) makes it:
 *   - Trivially unit-testable without any Electron dependency.
 *   - Easy to extend (new rule → one place to change).
 *   - Safe: all string operations are platform-normalised.
 *
 * DESIGN RULES
 * ─────────────
 * 1. `shouldShowEntry` is a PURE function — no I/O, no side effects.
 * 2. All name comparisons use lowercased, trimmed strings to be
 *    case-insensitive and whitespace-tolerant.
 * 3. Patterns in blocklists are matched against the BASENAME only, never
 *    a full path, to avoid accidental cross-platform issues.
 * 4. No third-party dependencies.
 *
 * PLATFORM NOTES
 * ──────────────
 * - On Windows, filenames are case-insensitive by default but NTFS can be
 *   configured as case-sensitive. We normalise to lowercase for comparisons.
 * - Entries with names containing control characters (U+0000–U+001F) or
 *   path separators (`/`, `\`) are blocked unconditionally — they cannot
 *   represent safe, navigable paths on any supported platform.
 * - `\n` / `\r` inside a name would allow an attacker to inject fake
 *   entries when the listing is serialised; blocked in UNSAFE_NAME_RE.
 */

import { basename, extname } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Minimal representation of a filesystem entry as returned by
 * `fs.readdir(path, { withFileTypes: true })` (a `Dirent`-compatible shape).
 *
 * Using a plain interface (not importing `Dirent` directly) lets the filter
 * module be tested in plain Node without importing `node:fs` at all.
 */
export interface FsEntry {
  /** Raw filename as returned by the OS — may contain any Unicode characters. */
  name: string;
  /** Whether this entry is a directory (MUST be set correctly by the caller). */
  isDirectory: boolean;
}

/**
 * Options that override the default filter configuration for a single call.
 * All fields are optional — omit to accept the default.
 */
export interface FilterOptions {
  /**
   * If `true`, entries whose names start with `.` are shown.
   * Default: `false` (hidden entries are NOT shown).
   */
  showHidden?: boolean;

  /**
   * If `true`, only directories are shown (files are excluded).
   * Default: `true` — the FolderExplorer is a directory picker.
   */
  directoriesOnly?: boolean;

  /**
   * Additional blocklist patterns (exact lowercase basenames) added on top
   * of `DEFAULT_CONFIG.blocklist`.
   * E.g. `["vendor", "dist"]`
   */
  extraBlocklist?: string[];

  /**
   * If provided, REPLACES `DEFAULT_CONFIG.allowedExtensions`.
   * Applies only when `directoriesOnly` is `false`.
   * An empty array means "allow all extensions".
   */
  allowedExtensions?: string[];
}

/**
 * Resolved, merged configuration used internally by `shouldShowEntry`.
 * Produced by merging `DEFAULT_CONFIG` with caller-supplied `FilterOptions`.
 */
export interface ResolvedFilterConfig {
  showHidden: boolean;
  directoriesOnly: boolean;
  /** All-lowercase combined blocklist (default + extra). */
  blocklist: ReadonlySet<string>;
  /** All-lowercase allowed extensions. Empty set = allow all. */
  allowedExtensions: ReadonlySet<string>;
}

// ── Default Configuration ─────────────────────────────────────────────────

/**
 * Default blocked entry names (exact, lowercase).
 *
 * These are system artefacts that are safe to hide in a user-facing explorer:
 *   - macOS resource fork / metadata directories
 *   - Windows system directories surfacing in home drives
 *   - Snap/Flatpak runtime stores that clutter the listing
 *   - VCS hidden state (surfacing via showHidden=true still blocked here
 *     for intentional suppressions)
 *
 * This list is intentionally conservative — only names that are NEVER useful
 * to navigate are included.
 */
const DEFAULT_BLOCKLIST: readonly string[] = [
  // macOS
  ".ds_store",
  "__macosx",
  ".localized",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  // Windows
  "thumbs.db",
  "desktop.ini",
  "$recycle.bin",
  "system volume information",
  // Linux / snap
  "snap",
];

/**
 * Default allowed file extensions when `directoriesOnly` is `false`.
 * An empty array means "allow all".
 *
 * Because this module's primary use-case is a directory picker (showHidden
 * false, directoriesOnly true), this default is intentionally permissive.
 */
const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [];

/**
 * The default filter configuration.
 *
 * Callers can override individual fields via `FilterOptions` without needing
 * to know or redeclare the full configuration.
 */
export const DEFAULT_CONFIG: Readonly<{
  showHidden: boolean;
  directoriesOnly: boolean;
  blocklist: readonly string[];
  allowedExtensions: readonly string[];
}> = {
  showHidden: false,
  directoriesOnly: true,
  blocklist: DEFAULT_BLOCKLIST,
  allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS,
} as const;

// ── Safety Constants ───────────────────────────────────────────────────────

/**
 * Matches filenames that contain characters which are unsafe to display or
 * process in any listing context, regardless of other rules:
 *
 *   - Control characters U+0000–U+001F (includes \n, \r, \t, NUL)
 *   - Path separators  `/` and `\`  — a name containing these would allow
 *     directory traversal when naively joined with a parent path.
 *
 * These names are rejected BEFORE any other rule is evaluated.
 */
const UNSAFE_NAME_RE = /[\u0000-\u001f/\\]/;

// ── Core Logic ────────────────────────────────────────────────────────────

/**
 * Merges `DEFAULT_CONFIG` with the caller-supplied `options` into a single
 * `ResolvedFilterConfig` ready for use by `shouldShowEntry`.
 *
 * This is exposed so callers that call `shouldShowEntry` in a tight loop
 * can build the config once and reuse it:
 *
 * ```ts
 * const config = buildConfig({ showHidden: true });
 * const visible = entries.filter(e => shouldShowEntry(e, config));
 * ```
 */
export function buildConfig(options?: FilterOptions): ResolvedFilterConfig {
  const showHidden = options?.showHidden ?? DEFAULT_CONFIG.showHidden;
  const directoriesOnly =
    options?.directoriesOnly ?? DEFAULT_CONFIG.directoriesOnly;

  // Merge blocklists (default + caller extras), all lowercased
  const mergedBlocklist = [
    ...DEFAULT_CONFIG.blocklist,
    ...(options?.extraBlocklist?.map((s) => s.toLowerCase()) ?? []),
  ];

  // Allowed extensions: caller overrides entirely, or use default
  const rawExtensions =
    options?.allowedExtensions ?? DEFAULT_CONFIG.allowedExtensions;

  return {
    showHidden,
    directoriesOnly,
    blocklist: new Set(mergedBlocklist.map((s) => s.toLowerCase())),
    allowedExtensions: new Set(rawExtensions.map((e) => e.toLowerCase())),
  };
}

/**
 * Decides whether a filesystem entry should be shown to the user.
 *
 * ### Evaluation order (first failing rule eliminates the entry)
 *
 * 1. **Unsafe name** — names with control characters or path separators are
 *    always rejected. This is a hard safety guard.
 * 2. **Empty name** — an entry with an empty basename is rejected.
 * 3. **Double-dot** — the special `..` entry (parent directory) is excluded;
 *    navigation is handled explicitly by the "Up" button, not by listing `..`.
 * 4. **Hidden** — if `showHidden` is `false`, entries starting with `.` are
 *    excluded. This also covers `.` (current directory).
 * 5. **Blocklist** — exact lowercase-name match against the combined blocklist.
 * 6. **Directories-only** — if `directoriesOnly` is `true`, non-directory
 *    entries are excluded.
 * 7. **Extension allowlist** — if `allowedExtensions` is non-empty and the
 *    entry is a file, entries with unlisted extensions are excluded.
 *
 * @param entry   - The filesystem entry to evaluate.
 * @param options - Optional overrides; merged with `DEFAULT_CONFIG` via
 *                  `buildConfig`. Pass a pre-built `ResolvedFilterConfig`
 *                  for hot paths (detected by `blocklist instanceof Set`).
 * @returns `true` if the entry should be shown, `false` otherwise.
 */
export function shouldShowEntry(
  entry: FsEntry,
  options?: FilterOptions | ResolvedFilterConfig,
): boolean {
  const config = isResolvedConfig(options)
    ? options
    : buildConfig(options as FilterOptions | undefined);

  const name = entry.name;

  // ── Rule 1: Unsafe name ──────────────────────────────────────────────────
  // This guard must run before any other string operation on `name`.
  if (UNSAFE_NAME_RE.test(name)) {
    return false;
  }

  // ── Rule 2: Empty name ───────────────────────────────────────────────────
  // An empty basename cannot represent a valid navigable entry.
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // ── Rule 3: Double-dot (parent dir alias) ────────────────────────────────
  // `..` is not a real child entry; the "Up" button handles parent navigation.
  // Also block `.` (current-dir alias) for the same reason.
  if (name === ".." || name === ".") {
    return false;
  }

  // ── Rule 4: Hidden entries ───────────────────────────────────────────────
  // Names starting with `.` are "hidden" by Unix convention.
  if (!config.showHidden && name.startsWith(".")) {
    return false;
  }

  // ── Rule 5: Blocklist ────────────────────────────────────────────────────
  // Case-insensitive exact match against the combined blocklist.
  const lowerName = name.toLowerCase();
  if (config.blocklist.has(lowerName)) {
    return false;
  }

  // ── Rule 6: Directories-only ─────────────────────────────────────────────
  // When the explorer is in directory-picker mode, files are hidden.
  if (config.directoriesOnly && !entry.isDirectory) {
    return false;
  }

  // ── Rule 7: Extension allowlist ──────────────────────────────────────────
  // Applies only to files (directories have no meaningful extension).
  if (
    !entry.isDirectory &&
    config.allowedExtensions.size > 0
  ) {
    // Use basename of the name (not a full path) for ext extraction.
    // `extname` returns "" for names with no extension (e.g. "Makefile").
    const ext = extname(basename(name)).toLowerCase();
    if (!config.allowedExtensions.has(ext)) {
      return false;
    }
  }

  // All rules passed — show the entry.
  return true;
}

// ── filterEntries (batch helper) ──────────────────────────────────────────

/**
 * Filters an array of `FsEntry` objects using `shouldShowEntry`, building
 * the config once for the entire batch.
 *
 * This is the recommended API for the IPC handler:
 *
 * ```ts
 * import { filterEntries } from "./filter.js";
 *
 * const entries = await readdir(safePath, { withFileTypes: true });
 * const visible = filterEntries(
 *   entries.map(d => ({ name: d.name, isDirectory: d.isDirectory() })),
 *   { showHidden: true },
 * );
 * ```
 *
 * @param entries - Raw entries from `fs.readdir`.
 * @param options - Optional filter overrides.
 * @returns A new array containing only the entries that should be shown.
 */
export function filterEntries(
  entries: FsEntry[],
  options?: FilterOptions,
): FsEntry[] {
  const config = buildConfig(options);
  return entries.filter((e) => shouldShowEntry(e, config));
}

// ── Internal Helpers ──────────────────────────────────────────────────────

/**
 * Type guard: returns `true` if `v` is already a `ResolvedFilterConfig`
 * (i.e. has a `blocklist` property that is a `Set`).
 *
 * This lets `shouldShowEntry` accept both the raw `FilterOptions` shape and
 * a pre-built config, avoiding redundant `buildConfig` calls in hot paths.
 */
function isResolvedConfig(
  v: FilterOptions | ResolvedFilterConfig | undefined,
): v is ResolvedFilterConfig {
  return v !== undefined && (v as ResolvedFilterConfig).blocklist instanceof Set;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────
// These tests are written as pure Node.js assertions (no test framework needed)
// so they can be copy-pasted into any test runner (Vitest, Jest, Node --test).
//
// To run with Node's built-in test runner (Node ≥ 18):
//   npx tsx --test electron-main/src/fs/filter.ts
//   node --loader ts-node/esm --test electron-main/src/fs/filter.ts
//
// To run with Vitest (if set up in the project):
//   vitest run electron-main/src/fs/filter.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline unit tests for `shouldShowEntry` and `filterEntries`.
 *
 * Import this in your test runner or execute this file directly to run them.
 * Each `testCase` call is self-contained and throws on failure.
 *
 * ```ts
 * import { runFilterTests } from "./filter.js";
 * runFilterTests(); // throws if any assertion fails
 * ```
 */
export function runFilterTests(): void {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string): void {
    if (!condition) {
      failed++;
      console.error(`  ✗ FAIL: ${message}`);
    } else {
      passed++;
      console.log(`  ✓ ${message}`);
    }
  }

  function dir(name: string): FsEntry {
    return { name, isDirectory: true };
  }
  function file(name: string): FsEntry {
    return { name, isDirectory: false };
  }

  console.log("\n── shouldShowEntry — default config ──");

  // Basic directory shown
  assert(shouldShowEntry(dir("Documents")), "regular dir is shown");
  assert(shouldShowEntry(dir("Projects")), "regular dir with capital is shown");

  // File hidden in default (directoriesOnly=true)
  assert(!shouldShowEntry(file("readme.md")), "file hidden when directoriesOnly=true");

  // Hidden entries hidden by default
  assert(!shouldShowEntry(dir(".config")), "dot-dir hidden by default");
  assert(!shouldShowEntry(file(".bashrc")), "dot-file hidden by default");

  // Special aliases always hidden
  assert(!shouldShowEntry(dir(".")), "dot (cwd) always hidden");
  assert(!shouldShowEntry(dir("..")), "double-dot (parent) always hidden");

  // Blocklist — exact match (case-insensitive)
  assert(!shouldShowEntry(dir("snap")), "snap blocked by default blocklist");
  assert(!shouldShowEntry(dir(".DS_Store")), ".DS_Store blocked (hidden + blocklist)");
  assert(!shouldShowEntry(dir(".Trashes")), ".Trashes blocked");

  console.log("\n── shouldShowEntry — showHidden=true ──");

  const showHiddenOpts: FilterOptions = { showHidden: true };
  assert(shouldShowEntry(dir(".config"), showHiddenOpts), "dot-dir shown when showHidden=true");
  // .bashrc is a file; directoriesOnly is still true by default, so it stays hidden
  assert(
    !shouldShowEntry(file(".bashrc"), showHiddenOpts),
    ".bashrc hidden because directoriesOnly=true even when showHidden=true",
  );
  // With both showHidden AND directoriesOnly=false, the dot-file becomes visible
  assert(
    shouldShowEntry(file(".bashrc"), { showHidden: true, directoriesOnly: false }),
    ".bashrc shown when showHidden=true AND directoriesOnly=false",
  );

  // showHidden=true but blocklist still applies
  assert(
    !shouldShowEntry(dir("snap"), showHiddenOpts),
    "snap still blocked even when showHidden=true",
  );

  console.log("\n── shouldShowEntry — directoriesOnly=false ──");

  const filesOpts: FilterOptions = { directoriesOnly: false };
  assert(shouldShowEntry(file("readme.md"), filesOpts), "file shown when directoriesOnly=false");
  assert(shouldShowEntry(dir("Documents"), filesOpts), "dir still shown when directoriesOnly=false");

  console.log("\n── shouldShowEntry — allowedExtensions ──");

  const mdOpts: FilterOptions = { directoriesOnly: false, allowedExtensions: [".md", ".txt"] };
  assert(shouldShowEntry(file("notes.md"), mdOpts), ".md file allowed");
  assert(shouldShowEntry(file("log.txt"), mdOpts), ".txt file allowed");
  assert(!shouldShowEntry(file("script.sh"), mdOpts), ".sh file blocked by extension allowlist");
  assert(!shouldShowEntry(file("Makefile"), mdOpts), "no-extension file blocked by allowlist");
  assert(shouldShowEntry(dir("docs"), mdOpts), "directory still passes even with extension allowlist");

  console.log("\n── shouldShowEntry — extraBlocklist ──");

  const extraOpts: FilterOptions = { extraBlocklist: ["vendor", "node_modules"] };
  assert(!shouldShowEntry(dir("vendor"), extraOpts), "vendor blocked via extraBlocklist");
  assert(!shouldShowEntry(dir("node_modules"), extraOpts), "node_modules blocked via extraBlocklist");
  assert(!shouldShowEntry(dir("Vendor"), extraOpts), "Vendor (upper) blocked case-insensitively");
  assert(shouldShowEntry(dir("src"), extraOpts), "src still shown");

  console.log("\n── shouldShowEntry — corner cases ──");

  // Name with newline — unsafe character
  assert(!shouldShowEntry(dir("foo\nbar")), "name with newline is blocked (unsafe)");
  // Name with carriage return
  assert(!shouldShowEntry(dir("foo\rbar")), "name with CR is blocked (unsafe)");
  // Name with NUL byte
  assert(!shouldShowEntry(dir("foo\0bar")), "name with NUL is blocked (unsafe)");
  // Name with tab (control char)
  assert(!shouldShowEntry(dir("foo\tbar")), "name with tab is blocked (unsafe)");
  // Name with forward slash — path injection attempt
  assert(!shouldShowEntry(dir("foo/bar")), "name with / is blocked (path separator)");
  // Name with backslash — Windows path injection attempt
  assert(!shouldShowEntry(dir("foo\\bar")), "name with \\ is blocked (path separator)");
  // Name that is only spaces
  assert(!shouldShowEntry({ name: "   ", isDirectory: true }), "whitespace-only name blocked");
  // Empty name
  assert(!shouldShowEntry({ name: "", isDirectory: true }), "empty name blocked");
  // Name with double dot prefix — "..hidden" starts with "." so hidden by default
  assert(!shouldShowEntry(dir("..hidden")), "..hidden starts with dot, hidden by default");
  assert(shouldShowEntry(dir("..hidden"), { showHidden: true }), "..hidden shown when showHidden=true");
  // Name that is literally only dots more than two
  assert(!shouldShowEntry(dir("...")), "... starts with dot, hidden by default");
  // Unicode name — fully valid
  assert(shouldShowEntry(dir("Документы")), "Cyrillic directory name is valid");
  assert(shouldShowEntry(dir("文档")), "CJK directory name is valid");
  assert(shouldShowEntry(dir("Ñoño")), "Latin-extended directory name is valid");

  console.log("\n── filterEntries (batch) ──");

  const batch: FsEntry[] = [
    dir("Documents"),
    dir(".config"),
    dir("snap"),
    file("readme.md"),
    dir(".."),
    dir("Projects"),
    { name: "bad\nname", isDirectory: true },
  ];
  const result = filterEntries(batch);
  assert(result.length === 2, `filterEntries default: 2 entries visible (got ${result.length})`);
  assert(result.some((e) => e.name === "Documents"), "Documents visible");
  assert(result.some((e) => e.name === "Projects"), "Projects visible");

  const resultHidden = filterEntries(batch, { showHidden: true });
  // .config shown, snap blocked, file blocked (directoriesOnly=true), .. blocked, bad\nname blocked
  assert(resultHidden.some((e) => e.name === ".config"), ".config visible with showHidden");
  assert(!resultHidden.some((e) => e.name === "snap"), "snap still blocked with showHidden");

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) {
    throw new Error(`filter.ts tests: ${failed} test(s) failed.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Example Usage (quick reference for IPC handler authors)
// ─────────────────────────────────────────────────────────────────────────────
//
// ❶ Most common — directory picker, no hidden dirs:
//
//   import { filterEntries } from "./filter.js";
//   const entries = await readdir(safePath, { withFileTypes: true });
//   const visible = filterEntries(
//     entries.map(d => ({ name: d.name, isDirectory: d.isDirectory() })),
//   );
//
// ❷ Show hidden dirs too (user toggled a setting):
//
//   const visible = filterEntries(mapped, { showHidden: true });
//
// ❸ File picker for markdown files:
//
//   const visible = filterEntries(mapped, {
//     directoriesOnly: false,
//     allowedExtensions: [".md"],
//   });
//
// ❹ Hot path — pre-build config for a large directory:
//
//   import { buildConfig, shouldShowEntry } from "./filter.js";
//   const config = buildConfig({ showHidden: false, extraBlocklist: ["dist"] });
//   const visible = entries.filter(e => shouldShowEntry(e, config));
//
// ❺ Custom blocklist (project node_modules, vendor, etc.):
//
//   const visible = filterEntries(mapped, {
//     extraBlocklist: ["node_modules", "vendor", ".git"],
//   });
