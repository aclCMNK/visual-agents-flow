/**
 * src/loader/lock-manager.ts
 *
 * File locking and atomic write utilities for the AgentFlow project loader.
 *
 * Locking strategy:
 * - Uses a `.lock` file as an advisory lock (lockfile pattern).
 * - Lock file contains the PID and timestamp of the holder.
 * - Stale locks (older than LOCK_STALE_MS) are automatically broken.
 * - Atomic writes use a temp file + rename to prevent partial writes.
 *
 * This is intentionally a pure-Node.js implementation (no native bindings)
 * so it works in Bun, Node, and Electron without native module issues.
 */

import {
  writeFile,
  rename,
  unlink,
  mkdir,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ── Constants ──────────────────────────────────────────────────────────────

/** Lock files older than this (ms) are considered stale and broken automatically */
const LOCK_STALE_MS = 30_000;

/** How long to wait between lock acquisition retries (ms) */
const LOCK_RETRY_INTERVAL_MS = 50;

/** Maximum number of retries before giving up on acquiring a lock */
const LOCK_MAX_RETRIES = 40; // 40 * 50ms = 2s max wait

// ── Lock file content ──────────────────────────────────────────────────────

interface LockMeta {
  pid: number;
  timestamp: number;
  token: string;
}

function lockPath(targetPath: string): string {
  return `${targetPath}.lock`;
}

function writeLockContent(): string {
  const meta: LockMeta = {
    pid: process.pid,
    timestamp: Date.now(),
    token: randomUUID(),
  };
  return JSON.stringify(meta);
}

async function readLockMeta(lp: string): Promise<LockMeta | null> {
  try {
    const raw = await readFile(lp, "utf-8");
    return JSON.parse(raw) as LockMeta;
  } catch {
    return null;
  }
}

function isStale(meta: LockMeta): boolean {
  return Date.now() - meta.timestamp > LOCK_STALE_MS;
}

// ── Lock acquisition ───────────────────────────────────────────────────────

/**
 * Acquire an exclusive advisory lock on a file.
 * Returns a release function. Throws if the lock cannot be acquired.
 *
 * @param targetPath - Absolute path to the file being locked
 */
export async function acquireLock(targetPath: string): Promise<() => Promise<void>> {
  const lp = lockPath(targetPath);
  const content = writeLockContent();

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    // Check for existing lock
    if (existsSync(lp)) {
      const existing = await readLockMeta(lp);
      if (existing && isStale(existing)) {
        // Break stale lock
        try {
          await unlink(lp);
        } catch {
          // Another process may have already removed it — continue
        }
      } else {
        // Lock is held — wait and retry
        await sleep(LOCK_RETRY_INTERVAL_MS);
        continue;
      }
    }

    // Ensure the parent directory exists before writing the lock file
    try {
      await ensureDir(dirname(lp));
    } catch {
      // Ignore mkdir errors — may already exist
    }

    // Attempt to write lock file (non-atomic, but good enough for advisory locks)
    try {
      await writeFile(lp, content, { flag: "wx" }); // wx = fail if exists
      // Lock acquired
      return async () => {
        try {
          await unlink(lp);
        } catch {
          // Already removed — ignore
        }
      };
    } catch (err) {
      // Another process won the race — retry
      if (isEEXIST(err)) {
        await sleep(LOCK_RETRY_INTERVAL_MS);
        continue;
      }
      throw new Error(
        `Failed to acquire lock on "${targetPath}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `Could not acquire lock on "${targetPath}" after ${LOCK_MAX_RETRIES} retries. ` +
      `Another process may be holding it. Delete "${lp}" manually if it is stale.`
  );
}

// ── Atomic writes ──────────────────────────────────────────────────────────

/**
 * Atomically write JSON to a file.
 * Writes to a temp file first, then renames to the target path.
 * Acquires a lock during the operation.
 *
 * @param targetPath - Absolute path to the destination file
 * @param data - Data to serialize as JSON
 * @param indent - JSON indentation spaces (default: 2)
 */
export async function atomicWriteJson(
  targetPath: string,
  data: unknown,
  indent = 2
): Promise<void> {
  const release = await acquireLock(targetPath);
  try {
    await ensureDir(dirname(targetPath));
    const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
    const content = JSON.stringify(data, null, indent) + "\n";

    await writeFile(tmpPath, content, { encoding: "utf-8", flag: "w" });
    await rename(tmpPath, targetPath);
  } finally {
    await release();
  }
}

/**
 * Atomically write text content to a file.
 * Writes to a temp file first, then renames to the target path.
 * Acquires a lock during the operation.
 *
 * @param targetPath - Absolute path to the destination file
 * @param content - Text content to write
 */
export async function atomicWriteText(
  targetPath: string,
  content: string
): Promise<void> {
  const release = await acquireLock(targetPath);
  try {
    await ensureDir(dirname(targetPath));
    const tmpPath = `${targetPath}.${randomUUID()}.tmp`;

    await writeFile(tmpPath, content, { encoding: "utf-8", flag: "w" });
    await rename(tmpPath, targetPath);
  } finally {
    await release();
  }
}

// ── Utility functions ──────────────────────────────────────────────────────

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEEXIST(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

// ── Lock info (for diagnostics) ────────────────────────────────────────────

export interface LockInfo {
  locked: boolean;
  stale: boolean;
  pid?: number;
  lockedAt?: Date;
}

/**
 * Check the current lock state of a file without acquiring it.
 * Useful for diagnostics and UI status indicators.
 */
export async function getLockInfo(targetPath: string): Promise<LockInfo> {
  const lp = lockPath(targetPath);
  const meta = await readLockMeta(lp);

  if (!meta) {
    return { locked: false, stale: false };
  }

  return {
    locked: true,
    stale: isStale(meta),
    pid: meta.pid,
    lockedAt: new Date(meta.timestamp),
  };
}

/**
 * Force-release a lock on a file.
 * Use only when a process has died and left a stale lock.
 */
export async function forceReleaseLock(targetPath: string): Promise<void> {
  const lp = lockPath(targetPath);
  try {
    await unlink(lp);
  } catch {
    // Already gone — ignore
  }
}
