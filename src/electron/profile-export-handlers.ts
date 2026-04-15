/**
 * src/electron/profile-export-handlers.ts
 *
 * Pure backend utilities for agent profile export.
 *
 * # Responsibilities
 *
 *   - collectProfilesToExport: reads all metadata/*.adata files, extracts agents
 *     with non-empty profile[] arrays, returns sorted profile groups.
 *
 *   - validateProfileFiles: pre-validates all profile files exist and are readable,
 *     collects warnings for missing/unreadable files.
 *
 *   - exportAgentProfiles: main orchestrator that validates, concatenates profiles,
 *     writes to destination with atomic writes and conflict handling.
 *
 * # Separation principle
 *
 *   These functions are intentionally separated from ipc-handlers.ts so they can
 *   be unit-tested without Electron IPC dependency.
 */

import { join, isAbsolute, resolve, relative } from 'node:path';
import {
  readdir,
  readFile,
  stat,
  mkdir,
  rename,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';

import type { AgentProfile } from '../types/agent.ts';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProfileToExport {
  agentId: string;
  agentName: string;
  profiles: AgentProfile[];
}

export interface ProfileValidationWarning {
  agentId: string;
  profileId: string;
  filePath: string;
  reason: string;
}

export interface ProfileValidationResult {
  agentId: string;
  agentName: string;
  validProfiles: Array<{ profile: AgentProfile; exists: boolean; error?: string }>;
}

export interface ProfileExportedItem {
  agentName: string;
  path: string;
}

export interface ProfileSkippedItem {
  agentName: string;
  reason: string;
}

export interface ProfileExportResult {
  success: boolean;
  exported: ProfileExportedItem[];
  skipped: ProfileSkippedItem[];
  warnings: string[];
  summary: {
    totalAgents: number;
    exportedCount: number;
    skippedCount: number;
    warningCount: number;
  };
}

export type ProfileConflictAction = 'replace' | 'replace-all' | 'cancel';

export type ProfileConflictCallback = (
  destinationPath: string,
  agentName: string,
) => Promise<ProfileConflictAction>;

// ── Helper: Load agent metadata ────────────────────────────────────────────

interface AgentAdata {
  profile?: AgentProfile[];
  metadata?: {
    name?: string;
  };
}

async function loadAgentAdata(filePath: string): Promise<AgentAdata | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as AgentAdata;
  } catch (err) {
    console.warn(`Failed to load adata from ${filePath}:`, err);
    return null;
  }
}

// ── Main Functions ─────────────────────────────────────────────────────────

/**
 * Collects all agents with non-empty profile[] arrays from the project.
 * Profiles are sorted by order field (stable sort).
 */
export async function collectProfilesToExport(
  projectDir: string,
): Promise<ProfileToExport[]> {
  const metadataDir = join(projectDir, 'metadata');

  if (!existsSync(metadataDir)) {
    return [];
  }

  try {
    const files = await readdir(metadataDir);
    const result: ProfileToExport[] = [];

    for (const file of files) {
      if (!file.endsWith('.adata')) continue;

      const filePath = join(metadataDir, file);
      const adata = await loadAgentAdata(filePath);
      if (!adata) continue;

      const profiles = adata.profile || [];
      if (profiles.length === 0) continue;

      // Sort by order field (stable sort)
      const sorted = [...profiles].sort((a, b) => {
        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
        return orderDiff !== 0 ? orderDiff : 0; // Stable: preserve array order for same order value
      });

      const agentId = file.replace('.adata', '');
      const agentName = adata.metadata?.name || agentId;

      result.push({
        agentId,
        agentName,
        profiles: sorted,
      });
    }

    return result;
  } catch (err) {
    console.error(`Failed to collect profiles from ${metadataDir}:`, err);
    return [];
  }
}

/**
 * Pre-validates all profile files exist and are readable.
 * Collects warnings for missing/unreadable files.
 * Disabled profiles are NOT validated (skipped).
 */
export async function validateProfileFiles(
  projectDir: string,
  toExport: ProfileToExport[],
): Promise<ProfileValidationWarning[]> {
  const warnings: ProfileValidationWarning[] = [];

  for (const agent of toExport) {
    for (const profile of agent.profiles) {
      // Skip disabled profiles
      if (profile.enabled === false) continue;

      // Validate relative path
      if (!validateRelativePath(profile.filePath)) {
        warnings.push({
          agentId: agent.agentId,
          profileId: profile.id,
          filePath: profile.filePath,
          reason: 'invalid path (must be relative)',
        });
        continue;
      }

      const fullPath = join(projectDir, profile.filePath);

      try {
        const stats = await stat(fullPath);
        if (!stats.isFile()) {
          warnings.push({
            agentId: agent.agentId,
            profileId: profile.id,
            filePath: profile.filePath,
            reason: 'path is not a regular file (is directory?)',
          });
        }
      } catch (err: any) {
        const reason =
          err.code === 'ENOENT'
            ? 'file not found'
            : err.code === 'EACCES'
              ? 'permission denied'
              : `error: ${err.code || err.message}`;
        warnings.push({
          agentId: agent.agentId,
          profileId: profile.id,
          filePath: profile.filePath,
          reason,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validates that a file path is relative and doesn't contain traversal patterns.
 */
function validateRelativePath(filePath: string): boolean {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  if (isAbsolute(filePath)) return false;
  if (filePath.includes('..')) return false;
  if (filePath.startsWith('/')) return false;
  return true;
}

/**
 * Reads all profile files for an agent and concatenates them.
 * Strips UTF-8 BOM from each file.
 * Returns content and any warnings encountered during read.
 */
async function concatenateProfileFiles(
  filePaths: string[],
  projectDir: string,
): Promise<{ content: string; warnings: string[] }> {
  const warnings: string[] = [];
  let content = '';

  for (const filePath of filePaths) {
    try {
      let fileContent = await readFile(join(projectDir, filePath), 'utf-8');

      // Strip UTF-8 BOM if present
      if (fileContent.charCodeAt(0) === 0xfeff) {
        fileContent = fileContent.slice(1);
      }

      content += fileContent;
    } catch (err: any) {
      warnings.push(`Failed to read ${filePath}: ${err.message}`);
    }
  }

  return { content, warnings };
}

/**
 * Atomically writes content to destination:
 * 1. Write to [destPath].tmp
 * 2. Rename .tmp to destination
 * On error, .tmp file left behind (safe, not used).
 */
async function writeAtomicFile(
  content: string,
  destPath: string,
): Promise<void> {
  const tmpPath = `${destPath}.tmp`;

  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, destPath);
  } catch (err) {
    // Clean up .tmp file if rename failed
    try {
      await unlink(tmpPath);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Builds the destination path for an agent's exported profiles.
 * Format: [exportDir]/prompts/[projectName]/[agentName].md
 */
function buildDestinationPath(
  projectName: string,
  agentName: string,
  exportDir: string,
): string {
  // Sanitize agent name (replace / with -)
  const sanitizedName = agentName.replace(/\//g, '-');
  return join(exportDir, 'prompts', projectName, `${sanitizedName}.md`);
}

/**
 * Extracts project name from project directory path.
 * Falls back to directory name if derivation fails.
 */
function extractProjectName(projectDir: string): string {
  const parts = projectDir.split(/[\\/]/);
  return parts[parts.length - 1] || 'project';
}

// ── Main Export Function ───────────────────────────────────────────────────

/**
 * Main orchestrator for agent profile export.
 * Collects, validates, concatenates, and writes profiles with conflict handling.
 */
export async function exportAgentProfiles(
  projectDir: string,
  exportDir: string,
  onConflict: ProfileConflictCallback,
): Promise<ProfileExportResult> {
  const exported: ProfileExportedItem[] = [];
  const skipped: ProfileSkippedItem[] = [];
  const allWarnings: string[] = [];
  let replaceAll = false;

  try {
    // Step 1: Collect profiles
    const toExport = await collectProfilesToExport(projectDir);
    if (toExport.length === 0) {
      return {
        success: false,
        exported: [],
        skipped: [],
        warnings: ['No agents with profiles found'],
        summary: {
          totalAgents: 0,
          exportedCount: 0,
          skippedCount: 0,
          warningCount: 1,
        },
      };
    }

    // Step 2: Pre-validate all files
    const validationWarnings = await validateProfileFiles(projectDir, toExport);
    for (const w of validationWarnings) {
      allWarnings.push(
        `${w.agentId}: profile '${w.filePath}' - ${w.reason}`,
      );
    }

    // Step 3: Extract project name
    const projectName = extractProjectName(projectDir);

    // Step 4: For each agent, concatenate and export
    for (const agent of toExport) {
      try {
        // Collect enabled profiles
        const enabledProfiles = agent.profiles.filter((p) => p.enabled !== false);
        if (enabledProfiles.length === 0) {
          skipped.push({
            agentName: agent.agentName,
            reason: 'no enabled profiles',
          });
          continue;
        }

        // Concatenate profile files
        const { content, warnings: concatWarnings } = await concatenateProfileFiles(
          enabledProfiles.map((p) => p.filePath),
          projectDir,
        );

        allWarnings.push(...concatWarnings.map((w) => `${agent.agentName}: ${w}`));

        // Skip if all profiles failed to read
        if (content.length === 0 && enabledProfiles.length > 0) {
          skipped.push({
            agentName: agent.agentName,
            reason: 'all profiles failed to read',
          });
          continue;
        }

        // Build destination path
        const destPath = buildDestinationPath(projectName, agent.agentName, exportDir);

        // Ensure destination directory exists
        await mkdir(join(exportDir, 'prompts', projectName), { recursive: true });

        // Check for conflict
        let shouldWrite = true;
        if (existsSync(destPath)) {
          if (!replaceAll) {
            const action = await onConflict(destPath, agent.agentName);
            if (action === 'cancel') {
              allWarnings.push(`Export cancelled by user at agent '${agent.agentName}'`);
              break; // Stop processing remaining agents
            }
            if (action === 'replace-all') {
              replaceAll = true;
            }
          }
          // If replace or replace-all, shouldWrite stays true
        }

        // Write the file
        if (shouldWrite) {
          await writeAtomicFile(content, destPath);
          exported.push({
            agentName: agent.agentName,
            path: destPath,
          });
        }
      } catch (err: any) {
        allWarnings.push(`Error exporting ${agent.agentName}: ${err.message}`);
        skipped.push({
          agentName: agent.agentName,
          reason: `export failed: ${err.message}`,
        });
      }
    }

    // Step 5: Return result
    return {
      success: exported.length > 0,
      exported,
      skipped,
      warnings: allWarnings,
      summary: {
        totalAgents: toExport.length,
        exportedCount: exported.length,
        skippedCount: skipped.length,
        warningCount: allWarnings.length,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      exported: [],
      skipped: [],
      warnings: [`Fatal error during profile export: ${err.message}`],
      summary: {
        totalAgents: 0,
        exportedCount: 0,
        skippedCount: 0,
        warningCount: 1,
      },
    };
  }
}
