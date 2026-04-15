import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import {
  collectProfilesToExport,
  validateProfileFiles,
  exportAgentProfiles,
  type ProfileToExport,
  type ProfileConflictCallback,
} from '../../src/electron/profile-export-handlers';

let testProjectDir: string;

beforeAll(async () => {
  testProjectDir = join(tmpdir(), `test-profiles-${Date.now()}`);
  await mkdir(testProjectDir, { recursive: true });
});

afterAll(async () => {
  if (existsSync(testProjectDir)) {
    await rm(testProjectDir, { recursive: true });
  }
});

describe('profile-export-handlers', () => {
  describe('collectProfilesToExport', () => {
    test('should collect agents with non-empty profile arrays', async () => {
      const metadataDir = join(testProjectDir, 'metadata');
      await mkdir(metadataDir, { recursive: true });

      // Create agent 1 with profiles
      await writeFile(
        join(metadataDir, 'agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'Agent One' },
          profile: [
            { id: '1', selector: 'System', filePath: 'behaviors/agent-1/system.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/agent-1/memory.md', order: 1, enabled: true },
          ],
        }),
      );

      // Create agent 2 without profiles
      await writeFile(
        join(metadataDir, 'agent-2.adata'),
        JSON.stringify({
          metadata: { name: 'Agent Two' },
          profile: [],
        }),
      );

      const result = await collectProfilesToExport(testProjectDir);

      expect(result).toHaveLength(1);
      expect(result[0].agentName).toBe('Agent One');
      expect(result[0].profiles).toHaveLength(2);
    });

    test('should sort profiles by order field', async () => {
      const sortTestDir = join(testProjectDir, 'sort-project');
      const metadataDir = join(sortTestDir, 'metadata');
      await mkdir(metadataDir, { recursive: true });

      await writeFile(
        join(metadataDir, 'agent.adata'),
        JSON.stringify({
          metadata: { name: 'Test Agent' },
          profile: [
            { id: '1', selector: 'System', filePath: 'f1.md', order: 2, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'f2.md', order: 0, enabled: true },
            { id: '3', selector: 'Tools', filePath: 'f3.md', order: 1, enabled: true },
          ],
        }),
      );

      const result = await collectProfilesToExport(sortTestDir);
      const agent = result.find((a) => a.agentName === 'Test Agent');

      expect(agent).toBeDefined();
      expect(agent?.profiles[0].order).toBe(0);
      expect(agent?.profiles[1].order).toBe(1);
      expect(agent?.profiles[2].order).toBe(2);
    });

    test('should handle empty metadata directory', async () => {
      const emptyDir = join(testProjectDir, 'empty-project');
      await mkdir(emptyDir, { recursive: true });

      const result = await collectProfilesToExport(emptyDir);
      expect(result).toHaveLength(0);
    });
  });

  describe('validateProfileFiles', () => {
    test('should detect missing profile files', async () => {
      const validateTestDir = join(testProjectDir, 'validate-missing');
      const behaviorDir = join(validateTestDir, 'behaviors');
      await mkdir(behaviorDir, { recursive: true });

      // Create one file that exists
      await writeFile(join(behaviorDir, 'system.md'), 'content');

      const toExport: ProfileToExport[] = [
        {
          agentId: 'agent-1',
          agentName: 'Agent One',
          profiles: [
            { id: '1', selector: 'System', filePath: 'behaviors/system.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/missing.md', order: 1, enabled: true },
          ],
        },
      ];

      const warnings = await validateProfileFiles(validateTestDir, toExport);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].filePath).toBe('behaviors/missing.md');
      expect(warnings[0].reason).toContain('file not found');
    });

    test('should skip disabled profiles from validation', async () => {
      await mkdir(join(testProjectDir, 'behaviors'), { recursive: true });
      await writeFile(join(testProjectDir, 'behaviors/file.md'), 'content');

      const toExport: ProfileToExport[] = [
        {
          agentId: 'agent-1',
          agentName: 'Agent One',
          profiles: [
            { id: '1', selector: 'System', filePath: 'behaviors/file.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/missing.md', order: 1, enabled: false },
          ],
        },
      ];

      const warnings = await validateProfileFiles(testProjectDir, toExport);

      // Only the enabled profile is validated, disabled profile is skipped
      expect(warnings).toHaveLength(0);
    });

    test('should validate all files exist before returning', async () => {
      const testDir = join(testProjectDir, 'validate-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      // Create one valid file
      await writeFile(join(testDir, 'behaviors/system.md'), '# System');

      const toExport: ProfileToExport[] = [
        {
          agentId: 'agent-1',
          agentName: 'Agent One',
          profiles: [
            { id: '1', selector: 'System', filePath: 'behaviors/system.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/memory.md', order: 1, enabled: true },
          ],
        },
      ];

      const warnings = await validateProfileFiles(testDir, toExport);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].reason).toContain('file not found');
    });
  });

  describe('exportAgentProfiles', () => {
    test('should concatenate profiles without extra delimiters', async () => {
      const testDir = join(testProjectDir, 'concat-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'metadata'), { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      // Create profile files
      await writeFile(join(testDir, 'behaviors/system.md'), '# System Prompt\nRole: assistant');
      await writeFile(join(testDir, 'behaviors/memory.md'), '# Memory\nStore facts');

      // Create agent metadata
      await writeFile(
        join(testDir, 'metadata/agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'TestAgent' },
          profile: [
            { id: '1', selector: 'System', filePath: 'behaviors/system.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/memory.md', order: 1, enabled: true },
          ],
        }),
      );

      const exportDir = join(testDir, 'export');
      const result = await exportAgentProfiles(testDir, exportDir, async () => 'replace');

      expect(result.success).toBe(true);
      expect(result.exported).toHaveLength(1);

      const exportedPath = result.exported[0].path;
      const content = await import('node:fs/promises').then((fs) => fs.readFile(exportedPath, 'utf-8'));
      expect(content).toBe('# System Prompt\nRole: assistant# Memory\nStore facts');
    });

    test('should skip disabled profiles', async () => {
      const testDir = join(testProjectDir, 'disabled-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'metadata'), { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      // Create profile files
      await writeFile(join(testDir, 'behaviors/system.md'), 'System');
      await writeFile(join(testDir, 'behaviors/memory.md'), 'Memory');

      await writeFile(
        join(testDir, 'metadata/agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'TestAgent' },
          profile: [
            { id: '1', selector: 'System', filePath: 'behaviors/system.md', order: 0, enabled: true },
            { id: '2', selector: 'Memory', filePath: 'behaviors/memory.md', order: 1, enabled: false },
          ],
        }),
      );

      const exportDir = join(testDir, 'export');
      const result = await exportAgentProfiles(testDir, exportDir, async () => 'replace');

      expect(result.success).toBe(true);

      const content = await import('node:fs/promises').then((fs) => fs.readFile(result.exported[0].path, 'utf-8'));
      expect(content).toBe('System');
    });

    test('should create destination directories', async () => {
      const testDir = join(testProjectDir, 'mkdir-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'metadata'), { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      await writeFile(join(testDir, 'behaviors/profile.md'), 'content');
      await writeFile(
        join(testDir, 'metadata/agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'TestAgent' },
          profile: [{ id: '1', selector: 'System', filePath: 'behaviors/profile.md', order: 0, enabled: true }],
        }),
      );

      const exportDir = join(testDir, 'nested', 'export', 'path');
      const result = await exportAgentProfiles(testDir, exportDir, async () => 'replace');

      expect(result.success).toBe(true);
      expect(existsSync(result.exported[0].path)).toBe(true);
    });

    test('should handle file conflicts with replace action', async () => {
      const conflictDir = join(testProjectDir, 'my-project');
      await mkdir(conflictDir, { recursive: true });
      await mkdir(join(conflictDir, 'metadata'), { recursive: true });
      await mkdir(join(conflictDir, 'behaviors'), { recursive: true });

      await writeFile(join(conflictDir, 'behaviors/profile.md'), 'new content');
      await writeFile(
        join(conflictDir, 'metadata/agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'TestAgent' },
          profile: [{ id: '1', selector: 'System', filePath: 'behaviors/profile.md', order: 0, enabled: true }],
        }),
      );

      const exportDir = join(conflictDir, 'export');

      // First export to establish the file
      const firstResult = await exportAgentProfiles(conflictDir, exportDir, async () => 'replace');
      expect(firstResult.success).toBe(true);
      const exportedPath = firstResult.exported[0].path;

      // Now modify the source and export again to trigger conflict
      await writeFile(join(conflictDir, 'behaviors/profile.md'), 'newer content');

      let conflictCalled = false;
      const result = await exportAgentProfiles(conflictDir, exportDir, async (destPath) => {
        conflictCalled = true;
        return 'replace';
      });

      expect(conflictCalled).toBe(true);
      expect(result.success).toBe(true);

      const content = await import('node:fs/promises').then((fs) => fs.readFile(exportedPath, 'utf-8'));
      expect(content).toBe('newer content');
    });

    test('should respect replace-all action', async () => {
      const testDir = join(testProjectDir, 'replace-all-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'metadata'), { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      // Create multiple agents
      for (let i = 1; i <= 2; i++) {
        await writeFile(join(testDir, `behaviors/agent-${i}.md`), `Agent ${i}`);
        await writeFile(
          join(testDir, `metadata/agent-${i}.adata`),
          JSON.stringify({
            metadata: { name: `Agent${i}` },
            profile: [{ id: '1', selector: 'System', filePath: `behaviors/agent-${i}.md`, order: 0, enabled: true }],
          }),
        );
      }

      const exportDir = join(testDir, 'export');
      await mkdir(exportDir, { recursive: true });
      await mkdir(join(exportDir, 'prompts/test-dir'), { recursive: true });

      // Pre-create conflicting files
      for (let i = 1; i <= 2; i++) {
        await writeFile(join(exportDir, `prompts/test-dir/agent${i}.md`), 'old');
      }

      let conflictCount = 0;
      const result = await exportAgentProfiles(testDir, exportDir, async () => {
        conflictCount++;
        return conflictCount === 1 ? 'replace-all' : 'replace'; // First returns replace-all
      });

      expect(result.success).toBe(true);
      expect(result.exported.length).toBeGreaterThanOrEqual(1);
    });

    test('should cancel export on user request', async () => {
      const cancelDir = join(testProjectDir, 'cancel-proj');
      await mkdir(cancelDir, { recursive: true });
      await mkdir(join(cancelDir, 'metadata'), { recursive: true });
      await mkdir(join(cancelDir, 'behaviors'), { recursive: true });

      // Create 2 agents
      for (let i = 1; i <= 2; i++) {
        await writeFile(join(cancelDir, `behaviors/agent-${i}.md`), `Content ${i}`);
        await writeFile(
          join(cancelDir, `metadata/agent-${i}.adata`),
          JSON.stringify({
            metadata: { name: `Agent${i}` },
            profile: [{ id: '1', selector: 'System', filePath: `behaviors/agent-${i}.md`, order: 0, enabled: true }],
          }),
        );
      }

      const exportDir = join(cancelDir, 'export');

      // First export to establish files
      await exportAgentProfiles(cancelDir, exportDir, async () => 'replace');

      // Now try export with cancel callback
      let callCount = 0;
      const result = await exportAgentProfiles(cancelDir, exportDir, async () => {
        callCount++;
        return callCount === 1 ? 'cancel' : 'replace';
      });

      // Should have only exported the first agent before cancel was called
      expect(callCount).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('cancelled'))).toBe(true);
    });

    test('should collect warnings for missing files', async () => {
      const testDir = join(testProjectDir, 'warnings-test');
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'metadata'), { recursive: true });
      await mkdir(join(testDir, 'behaviors'), { recursive: true });

      await writeFile(
        join(testDir, 'metadata/agent-1.adata'),
        JSON.stringify({
          metadata: { name: 'TestAgent' },
          profile: [
            { id: '1', selector: 'System', filePath: 'behaviors/missing.md', order: 0, enabled: true },
          ],
        }),
      );

      const exportDir = join(testDir, 'export');
      const result = await exportAgentProfiles(testDir, exportDir, async () => 'replace');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.skipped.some((s) => s.agentName === 'TestAgent')).toBe(true);
    });
  });
});
