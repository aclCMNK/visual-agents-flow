/**
 * electron-main/src/fs/homeJail.ts
 *
 * Home-Jail: Utilities for safely constraining all filesystem access
 * to paths WITHIN the user's HOME directory.
 *
 * WHY THIS EXISTS
 * ────────────────
 * Electron main processes have full Node.js filesystem access. If a path
 * received from the renderer (or any external source) is used directly in
 * fs operations, an attacker (or a bug) can traverse outside the intended
 * root via sequences like `../../etc/passwd` or symbolic links pointing
 * outside HOME. This module provides a central, tested "jail" so every IPC
 * handler that touches the filesystem can validate paths with one call.
 *
 * DESIGN RULES
 * ─────────────
 * 1. HOME_ROOT is determined once at module-load time and is immutable.
 * 2. All validation is done on RESOLVED (realpath) paths — symlinks are
 *    followed before checking containment, so a symlink pointing outside
 *    HOME is rejected even if its lexical path looks safe.
 * 3. Path normalisation uses `path.resolve` + `path.normalize` to collapse
 *    `.`, `..`, and redundant separators before any comparison.
 * 4. No third-party dependencies — only Node.js built-ins:
 *    - `node:path`    — portable path manipulation (sep, resolve, normalize)
 *    - `node:fs`      — realpathSync for symlink resolution (sync is fine at
 *                       module-init; async variant used in exported functions)
 *    - `node:os`      — homedir() fallback when env var is not set
 *
 * PLATFORM NOTES
 * ──────────────
 * - `path.resolve` and `path.normalize` are cross-platform (Win/Mac/Linux).
 * - `String.startsWith` comparison on resolved paths is safe because
 *   `path.resolve` always uses the OS separator consistently.
 * - We append a trailing separator to HOME_ROOT before the startsWith check
 *   to avoid false positives like /home/user2 being considered inside /home/user.
 */

import { resolve, normalize, sep } from "node:path";
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";

// ── HOME_ROOT ─────────────────────────────────────────────────────────────

/**
 * The root directory that all validated paths must reside within.
 *
 * Resolution order (first defined wins):
 *   1. `AGENTS_HOME` environment variable  — custom override (e.g. for tests)
 *   2. `HOME` environment variable          — standard Unix home
 *   3. `USERPROFILE` environment variable   — standard Windows home
 *   4. `os.homedir()`                       — Node.js OS-level fallback
 *
 * The resolved value is normalised (no trailing separator) so comparisons
 * remain consistent on all platforms.
 *
 * Why realpathSync here?
 * We call realpathSync once at module initialisation to resolve any symbolic
 * links in the HOME path itself (some systems symlink /home → /private/home
 * on macOS). If realpath fails (e.g. the home dir doesn't exist in a weird
 * container environment), we fall back to the normalised, unresolved path.
 */
function resolveHomeRoot(): string {
  // Pick the first defined env var or fall back to os.homedir()
  const raw =
    process.env["AGENTS_HOME"] ??
    process.env["HOME"] ??
    process.env["USERPROFILE"] ??
    homedir();

  // Normalise away any trailing separators or redundant segments
  const normalised = normalize(resolve(raw));

  // Resolve symlinks in the home path itself (e.g. /home → /private/home on macOS)
  try {
    return realpathSync(normalised);
  } catch {
    // If realpath fails (rare — e.g. path doesn't exist yet), use the normalised form
    return normalised;
  }
}

/**
 * The jail root. All validated paths must be equal to or inside this directory.
 *
 * This constant is exported so callers can display it in error messages
 * and so tests can inspect the resolved value.
 */
export const HOME_ROOT: string = resolveHomeRoot();

// ── getHomeDir ────────────────────────────────────────────────────────────

/**
 * Returns the home directory path used as the jail root.
 *
 * This is always the same as `HOME_ROOT` but provided as a function
 * so callers that prefer a function call style (and future implementations
 * that might make this async) have a stable API.
 */
export function getHomeDir(): string {
  return HOME_ROOT;
}

// ── resolveWithinHome ─────────────────────────────────────────────────────

/**
 * Resolves `inputPath` to an absolute, normalised path and validates that
 * it resides strictly within `HOME_ROOT` (the home-jail boundary).
 *
 * What this function does, step by step:
 *
 *   1. `path.resolve(inputPath)` — make the path absolute relative to CWD
 *      if it was relative; also collapses `.` and `..` lexically.
 *   2. `path.normalize(...)` — collapse redundant separators (e.g. `//`).
 *   3. `fs.realpath(...)` — follow all symbolic links to their real targets.
 *      This is the critical anti-traversal step: a symlink at
 *      ~/safe-looking/link → /etc/passwd would be resolved to /etc/passwd
 *      which is outside HOME_ROOT and therefore rejected.
 *   4. Containment check using `startsWith(HOME_ROOT + sep)` — the trailing
 *      separator prevents `/home/user2` from matching `/home/user`.
 *      We also accept exact equality with HOME_ROOT itself.
 *
 * @param inputPath - The path to resolve and validate (absolute or relative)
 * @returns The resolved absolute path if it is inside HOME_ROOT
 * @throws {Error} if the resolved path is outside HOME_ROOT (traversal attempt)
 * @throws {Error} if `inputPath` is empty or only whitespace
 * @throws {Error} if the path does not exist on disk (realpath requires existence)
 */
export async function resolveWithinHome(inputPath: string): Promise<string> {
  // Guard: reject empty or whitespace-only paths immediately
  if (!inputPath || inputPath.trim() === "") {
    throw new Error("homeJail: path must not be empty");
  }

  // Step 1 & 2: Absolute + normalised (lexical only — no I/O yet)
  const lexicalAbsolute = normalize(resolve(inputPath));

  // Step 3: Resolve all symlinks to get the true on-disk path.
  // realpath rejects paths that don't exist — this is intentional:
  // a non-existent path cannot be safely validated for symlink traversal.
  let resolved: string;
  try {
    resolved = await realpath(lexicalAbsolute);
  } catch (err) {
    // Re-throw with a clearer message that includes the attempted path
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`homeJail: cannot resolve path "${inputPath}": ${msg}`);
  }

  // Step 4: Containment check — path must be HOME_ROOT itself or a
  // subdirectory of it.
  //
  // We check TWO conditions:
  //   a) exact match:   resolved === HOME_ROOT
  //   b) subdirectory:  resolved.startsWith(HOME_ROOT + sep)
  //
  // The `+ sep` suffix prevents the false-positive case where HOME_ROOT is
  // "/home/user" and the resolved path is "/home/username" — without the
  // separator, startsWith would incorrectly return true.
  const isExactMatch = resolved === HOME_ROOT;
  const isSubdirectory = resolved.startsWith(HOME_ROOT + sep);

  if (!isExactMatch && !isSubdirectory) {
    throw new Error(
      `homeJail: path "${inputPath}" resolves to "${resolved}" which is outside HOME_ROOT "${HOME_ROOT}"`,
    );
  }

  return resolved;
}

// ── isPathInsideHome ──────────────────────────────────────────────────────

/**
 * Returns `true` if `inputPath`, after full symlink resolution, is equal to
 * or inside `HOME_ROOT`; returns `false` otherwise (including on any error).
 *
 * This is the non-throwing convenience wrapper around `resolveWithinHome`.
 * Callers that want to check containment without handling exceptions (e.g.
 * in a guard clause or filter) should use this function.
 *
 * Important: this function calls `realpath` internally, so it performs real
 * I/O. A path that does not exist on disk will return `false` (not an error).
 *
 * @param inputPath - The path to check
 * @returns Promise<boolean> — true if inside HOME_ROOT, false otherwise
 */
export async function isPathInsideHome(inputPath: string): Promise<boolean> {
  try {
    await resolveWithinHome(inputPath);
    return true;
  } catch {
    // Any error (traversal detected, path doesn't exist, empty string, etc.)
    // is treated as "not inside home" — safe default
    return false;
  }
}

// ── assertWithinHome ──────────────────────────────────────────────────────

/**
 * Convenience alias for `resolveWithinHome` with a more explicit name for
 * use in IPC handlers that need to assert (and throw) on boundary violations.
 *
 * Usage:
 *   const safePath = await assertWithinHome(req.filePath);
 *   // safePath is guaranteed to be inside HOME_ROOT
 *   await readFile(safePath, "utf-8");
 *
 * @param inputPath - Path to validate
 * @returns The resolved path if valid
 * @throws if the path is outside HOME_ROOT or cannot be resolved
 */
export async function assertWithinHome(inputPath: string): Promise<string> {
  return resolveWithinHome(inputPath);
}
