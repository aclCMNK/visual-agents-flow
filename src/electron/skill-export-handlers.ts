/**
 * src/electron/skill-export-handlers.ts
 *
 * Pure backend utilities for skills export.
 *
 * # Responsibilities
 *
 *   - getActiveSkills: reads all metadata/*.adata files, extracts the allowed
 *     skills from `permissions.skills` (only entries with value "allow"),
 *     expands wildcard patterns against the real skills/ directory, deduplicates,
 *     and returns a sorted list of unique skill entries to export.
 *     Also returns warnings for skills that are allowed but have no matching
 *     directory on disk.
 *
 *   - copySkillDirWithConflict: copies a single skill directory from the source
 *     `skills/` tree to a destination `skills/` tree, invoking a callback whenever
 *     a file already exists at the destination so the caller (IPC handler) can
 *     ask the user what to do.
 *
 * # Separation principle
 *
 *   These functions are intentionally separated from ipc-handlers.ts so they can
 *   be unit-tested without Electron IPC dependency. The IPC handler in
 *   ipc-handlers.ts imports and calls these functions.
 *
 * # Skill directory naming
 *
 *   In `permissions.skills`, skill names follow the dash-joined convention used by
 *   `listSkillsFromDir` in skills-handlers.ts:
 *     "kb-search"         → directory `skills/kb-search/`
 *     "agents-summarizer" → directory `skills/agents/summarizer/`
 *
 *   Internally, `skillDirName` is the slash-separated relative path from skills/:
 *     "kb-search"         → skillDirName = "kb-search"
 *     "agents-summarizer" → skillDirName = "agents/summarizer"
 *
 *   Wildcards: a key ending in `*` (e.g. `"kb*"`) matches any skill whose
 *   dash-joined name starts with the prefix before `*`. `"*"` alone matches all.
 */

import { join, relative, sep } from "node:path";
import {
  readdir,
  readFile,
  stat,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A skill entry with its directory name (relative to skills/).
 * Used to identify which directories to copy during export.
 */
export interface ActiveSkillEntry {
  /** Skill directory path, relative to skills/. E.g. "kb-search" or "agents/summarizer" */
  skillDirName: string;
}

/**
 * Result from getActiveSkills including warnings for allowed-but-missing skills.
 */
export interface GetActiveSkillsResult {
  /** Skills that are allowed AND have a real directory in skills/ */
  skills: ActiveSkillEntry[];
  /**
   * Skill names (dash-joined) that appear in permissions.skills with value "allow"
   * (or matched by a wildcard pattern) but have NO directory in skills/.
   */
  warnings: string[];
}

/**
 * Conflict action returned by the conflict callback.
 *
 *   "replace"     — replace only this file, continue with remaining files
 *   "replace-all" — replace this file AND all subsequent conflicts without asking
 *   "cancel"      — abort the entire export immediately
 */
export type SkillConflictAction = "replace" | "replace-all" | "cancel";

/**
 * Callback invoked when a destination file already exists.
 *
 * @param skillName  Skill directory name (e.g. "kb-search")
 * @param fileName   Relative file path within the skill dir (e.g. "SKILL.md")
 * @returns          The action the user chose
 */
export type SkillConflictCallback = (
  skillName: string,
  fileName: string,
) => Promise<SkillConflictAction>;

// ── SkillDirInfo ───────────────────────────────────────────────────────────

/**
 * Represents a skill found on disk.
 * Holds both the dash-joined name (for permissions matching) and the
 * slash-separated directory path (for file-system operations).
 */
export interface SkillDirInfo {
  /** Dash-joined name as used in permissions.skills: "kb-search", "agents-summarizer" */
  dashName: string;
  /** Slash-separated path relative to skills/: "kb-search", "agents/summarizer" */
  skillDirName: string;
}

// ── Internal: scan skills/ directory ──────────────────────────────────────

/**
 * Scans `skillsDir` recursively for directories that contain a SKILL.md file.
 * Returns a list of { dashName, skillDirName } for each skill found.
 *
 * Returns [] if `skillsDir` does not exist or is not a directory.
 */
export async function listSkillDirInfos(skillsDir: string): Promise<SkillDirInfo[]> {
  const infos: SkillDirInfo[] = [];

  // Check that skillsDir exists and is a directory
  try {
    const s = await stat(skillsDir);
    if (!s.isDirectory()) return [];
  } catch {
    return [];
  }

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let info;
      try {
        info = await stat(fullPath);
      } catch {
        continue;
      }

      if (info.isDirectory()) {
        // Check if this directory contains a SKILL.md directly
        const skillMdPath = join(fullPath, "SKILL.md");
        let hasSkillMd = false;
        try {
          const skillStat = await stat(skillMdPath);
          hasSkillMd = skillStat.isFile();
        } catch {
          hasSkillMd = false;
        }

        if (hasSkillMd) {
          // Build dash-joined name (same convention as listSkillsFromDir in skills-handlers.ts)
          const rel = relative(skillsDir, fullPath);
          const dashName = rel.split(sep).join("-");
          // Build slash-separated path (for file-system copy operations)
          const skillDirName = rel.split(sep).join("/");
          infos.push({ dashName, skillDirName });
        }

        // Always recurse deeper for nested skills
        await walk(fullPath);
      }
    }
  }

  await walk(skillsDir);
  return infos.sort((a, b) => a.dashName.localeCompare(b.dashName));
}

// ── Internal: wildcard matching ────────────────────────────────────────────

/**
 * Returns all skills whose dashName matches `pattern`.
 *
 * Matching rules (case-insensitive):
 *   - "*" alone          → all skills
 *   - "prefix*"          → skills whose dashName starts with `prefix`
 *   - exact name (no *)  → skills whose dashName equals `pattern`
 *
 * Returns [] if no skills match.
 */
function matchPattern(pattern: string, available: SkillDirInfo[]): SkillDirInfo[] {
  const lower = pattern.toLowerCase();

  if (lower === "*") return [...available];

  if (lower.endsWith("*")) {
    const prefix = lower.slice(0, -1);
    return available.filter((s) => s.dashName.toLowerCase().startsWith(prefix));
  }

  return available.filter((s) => s.dashName.toLowerCase() === lower);
}

// ── Internal: read permissions.skills from a parsed .adata ─────────────────

/**
 * Extracts the `permissions.skills` group from a parsed .adata object.
 * Returns a map of `{ skillNameOrPattern → permissionValue }`.
 * Returns {} if permissions or permissions.skills is absent/malformed.
 */
function extractPermissionsSkills(parsed: Record<string, unknown>): Record<string, string> {
  const perms = parsed.permissions;
  if (typeof perms !== "object" || perms === null || Array.isArray(perms)) {
    return {};
  }

  const permsObj = perms as Record<string, unknown>;
  const skillsGroup = permsObj["skills"];

  if (typeof skillsGroup !== "object" || skillsGroup === null || Array.isArray(skillsGroup)) {
    return {};
  }

  const group = skillsGroup as Record<string, unknown>;
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(group)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }

  return result;
}

// ── getActiveSkills ────────────────────────────────────────────────────────

/**
 * Reads all `metadata/*.adata` files in `projectDir`, extracts allowed skills
 * from `permissions.skills` (only entries with value "allow"), expands wildcard
 * patterns against the real `skills/` directory, deduplicates, and returns:
 *
 *   - `skills`:   sorted list of skill entries that WILL be exported (have a real directory)
 *   - `warnings`: skill names (dash-joined) that are allowed but have no matching directory
 *
 * Patterns supported (case-insensitive):
 *   - Exact name:  "kb-search"  → matches only that directory
 *   - Prefix glob: "kb*"        → all directories whose dash-name starts with "kb"
 *   - Star:        "*"          → all directories in skills/
 *
 * Returns { skills: [], warnings: [] } if:
 *   - metadata directory does not exist
 *   - no .adata files exist
 *   - no agent has any allowed skill in permissions.skills
 */
export async function getActiveSkills(projectDir: string): Promise<GetActiveSkillsResult> {
  const metadataDir = join(projectDir, "metadata");

  // Check metadata directory exists
  try {
    const s = await stat(metadataDir);
    if (!s.isDirectory()) return { skills: [], warnings: [] };
  } catch {
    return { skills: [], warnings: [] };
  }

  // Read all .adata files
  let adataFiles: string[];
  try {
    const entries = await readdir(metadataDir);
    adataFiles = entries.filter((e) => e.endsWith(".adata"));
  } catch {
    return { skills: [], warnings: [] };
  }

  // Scan available skill directories ONCE
  const skillsDir = join(projectDir, "skills");
  const availableSkills = await listSkillDirInfos(skillsDir);

  // Collect all "allowed" skill patterns from all .adata files
  // A pattern is a key in permissions.skills with value "allow"
  const allowedPatterns = new Set<string>();

  for (const adataFile of adataFiles) {
    const adataPath = join(metadataDir, adataFile);
    let raw: string;
    try {
      raw = await readFile(adataPath, "utf-8");
    } catch {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const permSkills = extractPermissionsSkills(parsed);

    for (const [pattern, value] of Object.entries(permSkills)) {
      if (value === "allow") {
        allowedPatterns.add(pattern);
      }
    }
  }

  // Expand patterns against available skills
  const resolvedDirNames = new Set<string>(); // skillDirName (slash-path)
  const warnedPatterns = new Set<string>();   // patterns with no match on disk

  for (const pattern of allowedPatterns) {
    const matches = matchPattern(pattern, availableSkills);
    if (matches.length === 0) {
      warnedPatterns.add(pattern);
    } else {
      for (const match of matches) {
        resolvedDirNames.add(match.skillDirName);
      }
    }
  }

  // Build final sorted list
  const skills: ActiveSkillEntry[] = Array.from(resolvedDirNames)
    .sort()
    .map((skillDirName) => ({ skillDirName }));

  const warnings: string[] = Array.from(warnedPatterns).sort();

  return { skills, warnings };
}

// ── copySkillDirWithConflict ───────────────────────────────────────────────

/**
 * Copies a single skill directory from `srcSkillsDir/<skillDirName>` to
 * `destSkillsDir/<skillDirName>`, recursively.
 *
 * When a destination file already exists, `onConflict` is called and the
 * returned action controls what happens:
 *   - "replace"     → overwrite this file, continue normally for the rest
 *   - "replace-all" → overwrite all remaining conflicts without asking again
 *   - "cancel"      → stop immediately, return { aborted: true }
 *
 * @param srcSkillsDir   Absolute path to the source `skills/` directory
 * @param destSkillsDir  Absolute path to the destination `skills/` directory
 * @param skillDirName   Relative name of the skill dir (e.g. "kb-search")
 * @param onConflict     Callback invoked when a file already exists at dest
 * @returns              { aborted: boolean } — true if user chose "cancel"
 */
export async function copySkillDirWithConflict(
  srcSkillsDir: string,
  destSkillsDir: string,
  skillDirName: string,
  onConflict: SkillConflictCallback,
): Promise<{ aborted: boolean }> {
  const srcDir = join(srcSkillsDir, skillDirName);
  const destDir = join(destSkillsDir, skillDirName);

  // Verify source exists
  try {
    const s = await stat(srcDir);
    if (!s.isDirectory()) return { aborted: false }; // not a dir — skip silently
  } catch {
    return { aborted: false }; // source missing — skip silently
  }

  // Internal state: once the user chooses replace-all, we stop asking
  let replaceAll = false;

  async function walk(src: string, dest: string): Promise<boolean> {
    // Ensure destination directory exists
    await mkdir(dest, { recursive: true });

    let entries: string[];
    try {
      entries = await readdir(src);
    } catch {
      return false; // silently skip unreadable directories
    }

    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);

      let entryInfo;
      try {
        entryInfo = await stat(srcPath);
      } catch {
        continue;
      }

      if (entryInfo.isDirectory()) {
        const aborted = await walk(srcPath, destPath);
        if (aborted) return true;
      } else if (entryInfo.isFile()) {
        const destExists = existsSync(destPath);

        if (destExists && !replaceAll) {
          // Compute relative file path within the skill dir for the user message
          const relFile = relative(srcDir, srcPath).replace(/\\/g, "/");
          const action = await onConflict(skillDirName, relFile);

          if (action === "cancel") return true;    // abort
          if (action === "replace-all") replaceAll = true;
          // "replace" or "replace-all" → fall through to copy
        }

        await copyFile(srcPath, destPath);
      }
    }

    return false; // not aborted
  }

  const aborted = await walk(srcDir, destDir);
  return { aborted };
}

// ── exportActiveSkills (orchestration helper) ─────────────────────────────

/**
 * High-level orchestrator: reads all active skills from `projectDir` (via
 * permissions.skills with value "allow"), then copies each one from
 * `{projectDir}/skills/` to `{destDir}/skills/`, using `onConflict` to
 * resolve file collisions.
 *
 * Stops immediately if any skill copy returns `aborted: true`.
 *
 * @param projectDir  Absolute path to the project directory
 * @param destDir     Absolute path to the export destination directory
 * @param onConflict  Conflict resolution callback
 * @returns           { aborted, copiedSkills, skippedSkills, warnings }
 */
export async function exportActiveSkills(
  projectDir: string,
  destDir: string,
  onConflict: SkillConflictCallback,
): Promise<{
  aborted: boolean;
  copiedSkills: string[];
  skippedSkills: string[];
  warnings: string[];
}> {
  const { skills: activeSkills, warnings } = await getActiveSkills(projectDir);
  const srcSkillsDir = join(projectDir, "skills");
  const destSkillsDir = join(destDir, "skills");

  console.log("[exportActiveSkills] Reading skills from:", srcSkillsDir, "Writing export to:", destSkillsDir);
  if (warnings.length > 0) {
    console.warn("[exportActiveSkills] Skills allowed but missing from disk:", warnings.join(", "));
  }

  const copiedSkills: string[] = [];
  const skippedSkills: string[] = [];

  for (const { skillDirName } of activeSkills) {
    // Skip if source directory doesn't exist (graceful)
    const srcSkillDir = join(srcSkillsDir, skillDirName);
    try {
      const s = await stat(srcSkillDir);
      if (!s.isDirectory()) {
        skippedSkills.push(skillDirName);
        continue;
      }
    } catch {
      skippedSkills.push(skillDirName);
      continue;
    }

    const result = await copySkillDirWithConflict(
      srcSkillsDir,
      destSkillsDir,
      skillDirName,
      onConflict,
    );

    if (result.aborted) {
      return { aborted: true, copiedSkills, skippedSkills, warnings };
    }

    copiedSkills.push(skillDirName);
  }

  return { aborted: false, copiedSkills, skippedSkills, warnings };
}
