/**
 * src/loader/file-reader.ts
 *
 * Async file reading utilities for the AgentFlow project loader.
 * All paths are resolved relative to a given project root directory.
 *
 * Responsibilities:
 * - Read and parse JSON files (with descriptive error wrapping)
 * - Read markdown files as strings
 * - Check file existence without throwing
 * - List files matching a glob pattern within the project directory
 */

import { readFile, access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, relative } from "node:path";
import type { FileReadRecord } from "./types.ts";

// ── JSON reading ───────────────────────────────────────────────────────────

/**
 * Read a JSON file and parse it. Throws a descriptive Error on failure.
 *
 * @param absolutePath - Absolute path to the JSON file
 * @returns Parsed JSON value (unknown — caller is responsible for validation)
 */
export async function readJsonFile(absolutePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read file "${absolutePath}": ${msg}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in "${absolutePath}": ${msg}`);
  }
}

// ── Markdown / text reading ────────────────────────────────────────────────

/**
 * Read a text file (e.g. markdown) as a UTF-8 string.
 * Throws a descriptive Error if the file cannot be read.
 *
 * @param absolutePath - Absolute path to the text file
 */
export async function readTextFile(absolutePath: string): Promise<FileReadRecord> {
  let content: string;
  try {
    content = await readFile(absolutePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read file "${absolutePath}": ${msg}`);
  }

  return {
    path: absolutePath,
    content,
    sizeBytes: Buffer.byteLength(content, "utf-8"),
  };
}

// ── Existence check ────────────────────────────────────────────────────────

/**
 * Returns true if the given path exists and is accessible (read-only check).
 */
export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the given path is a regular file (not a directory).
 */
export async function isFile(absolutePath: string): Promise<boolean> {
  try {
    const s = await stat(absolutePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Returns true if the given path is a directory.
 */
export async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    const s = await stat(absolutePath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ── Project-relative resolution ────────────────────────────────────────────

/**
 * Resolve a relative path (as stored in .afproj / .adata) to an absolute path.
 *
 * @param projectDir - Absolute path to the project root directory
 * @param relativePath - Relative path from the project root
 */
export function resolveProjectPath(projectDir: string, relativePath: string): string {
  return resolve(projectDir, relativePath);
}

/**
 * Compute the relative path from a project directory to an absolute path.
 * Useful when recording file paths back into models.
 */
export function toRelativePath(projectDir: string, absolutePath: string): string {
  return relative(projectDir, absolutePath);
}

// ── File discovery ─────────────────────────────────────────────────────────

/**
 * Find all `.afproj` files directly in the given directory (non-recursive).
 * Returns absolute paths.
 */
export async function findAfprojFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".afproj"))
      .map((e) => join(dirPath, e.name));
  } catch {
    return [];
  }
}

/**
 * Find all `.adata` files in `<projectDir>/metadata/` (non-recursive).
 * Returns absolute paths.
 */
export async function findAdataFiles(projectDir: string): Promise<string[]> {
  const metadataDir = join(projectDir, "metadata");
  try {
    const entries = await readdir(metadataDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".adata"))
      .map((e) => join(metadataDir, e.name));
  } catch {
    return [];
  }
}

/**
 * Find all markdown files in a behavior directory for a given agent.
 * Returns absolute paths.
 *
 * @param projectDir - Project root directory
 * @param agentId - The agent's UUID
 */
export async function findBehaviorFiles(
  projectDir: string,
  agentId: string
): Promise<string[]> {
  const behaviorDir = join(projectDir, "behaviors", agentId);
  try {
    const entries = await readdir(behaviorDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(behaviorDir, e.name));
  } catch {
    return [];
  }
}

/**
 * Find all skill markdown files in `<projectDir>/skills/`.
 * Returns absolute paths.
 */
export async function findSkillFiles(projectDir: string): Promise<string[]> {
  const skillsDir = join(projectDir, "skills");
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(skillsDir, e.name));
  } catch {
    return [];
  }
}
