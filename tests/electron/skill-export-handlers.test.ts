/**
 * tests/electron/skill-export-handlers.test.ts
 *
 * Unit tests for src/electron/skill-export-handlers.ts
 *
 * Covers:
 *   - getActiveSkills: returns empty result for missing metadata dir
 *   - getActiveSkills: reads allowed skills from permissions.skills
 *   - getActiveSkills: only includes skills with value "allow" (not "deny" / "ask")
 *   - getActiveSkills: expands wildcard patterns ("kb*", "*")
 *   - getActiveSkills: deduplicates across agents
 *   - getActiveSkills: returns warnings for allowed patterns with no matching directory
 *   - getActiveSkills: ignores malformed .adata files gracefully
 *   - getActiveSkills: returns [] when permissions.skills is absent
 *   - listSkillDirInfos: returns dash-joined names and slash-separated paths
 *   - copySkillDirWithConflict: copies files when no conflict
 *   - copySkillDirWithConflict: invokes callback on conflict
 *   - copySkillDirWithConflict: respects "replace-all" (no callback after first)
 *   - copySkillDirWithConflict: aborts on "cancel"
 *   - copySkillDirWithConflict: skips missing source silently
 *   - exportActiveSkills: end-to-end orchestration with temp dirs
 *
 * All tests use bun:test and real temp directories (no mocking).
 */

import { describe, it, expect } from "bun:test";
import {
  getActiveSkills,
  listSkillDirInfos,
  copySkillDirWithConflict,
  exportActiveSkills,
} from "../../src/electron/skill-export-handlers.ts";
import { join } from "node:path";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Creates a minimal project structure with a metadata/ directory */
async function makeProject(base: string): Promise<string> {
  const projectDir = join(base, "project");
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  return projectDir;
}

/**
 * Writes a .adata file with a permissions.skills object.
 * `skillsPermissions` is a map of skillName/pattern → "allow"|"deny"|"ask".
 */
async function writeAdataWithPermissions(
  projectDir: string,
  agentId: string,
  skillsPermissions: Record<string, "allow" | "deny" | "ask">,
): Promise<void> {
  const metaDir = join(projectDir, "metadata");
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    join(metaDir, `${agentId}.adata`),
    JSON.stringify(
      {
        agentId,
        agentName: agentId,
        permissions: {
          skills: skillsPermissions,
        },
      },
      null,
      2,
    ),
  );
}

/**
 * Creates a skill directory with a SKILL.md file inside skills/.
 */
async function makeSkillDir(projectDir: string, ...pathParts: string[]): Promise<void> {
  const skillDir = join(projectDir, "skills", ...pathParts);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `# ${pathParts.join("-")} skill`);
}

// ── listSkillDirInfos ──────────────────────────────────────────────────────

describe("listSkillDirInfos — skill discovery", () => {
  it("returns [] when skills dir does not exist", async () => {
    const result = await listSkillDirInfos("/nonexistent/skills");
    expect(result).toEqual([]);
  });

  it("returns [] when skills dir has no SKILL.md directories", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-list-"));
    try {
      const skillsDir = join(tmp, "skills");
      await mkdir(skillsDir, { recursive: true });
      // An empty directory with no SKILL.md
      await mkdir(join(skillsDir, "no-skill-here"), { recursive: true });
      const result = await listSkillDirInfos(skillsDir);
      expect(result).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns dash-joined name and slash-path for a flat skill", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-list-"));
    try {
      const skillsDir = join(tmp, "skills");
      await mkdir(join(skillsDir, "kb-search"), { recursive: true });
      await writeFile(join(skillsDir, "kb-search", "SKILL.md"), "# KB Search");

      const result = await listSkillDirInfos(skillsDir);
      expect(result).toHaveLength(1);
      expect(result[0]!.dashName).toBe("kb-search");
      expect(result[0]!.skillDirName).toBe("kb-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns dash-joined name and slash-path for a nested skill", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-list-"));
    try {
      const skillsDir = join(tmp, "skills");
      await mkdir(join(skillsDir, "agents", "summarizer"), { recursive: true });
      await writeFile(join(skillsDir, "agents", "summarizer", "SKILL.md"), "# Summarizer");

      const result = await listSkillDirInfos(skillsDir);
      expect(result).toHaveLength(1);
      expect(result[0]!.dashName).toBe("agents-summarizer");
      expect(result[0]!.skillDirName).toBe("agents/summarizer");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns multiple skills sorted by dashName", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-list-"));
    try {
      const skillsDir = join(tmp, "skills");
      await mkdir(join(skillsDir, "zzz-last"), { recursive: true });
      await writeFile(join(skillsDir, "zzz-last", "SKILL.md"), "# Z");
      await mkdir(join(skillsDir, "aaa-first"), { recursive: true });
      await writeFile(join(skillsDir, "aaa-first", "SKILL.md"), "# A");

      const result = await listSkillDirInfos(skillsDir);
      expect(result).toHaveLength(2);
      expect(result[0]!.dashName).toBe("aaa-first");
      expect(result[1].dashName).toBe("zzz-last");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — missing metadata directory ───────────────────────────

describe("getActiveSkills — missing metadata directory", () => {
  it("returns empty result when metadata dir does not exist", async () => {
    const result = await getActiveSkills("/nonexistent/project/dir");
    expect(result.skills).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty result when projectDir has no metadata subdirectory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const result = await getActiveSkills(tmp);
      expect(result.skills).toEqual([]);
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — empty metadata directory ─────────────────────────────

describe("getActiveSkills — empty metadata directory", () => {
  it("returns empty result when no .adata files exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      const result = await getActiveSkills(projectDir);
      expect(result.skills).toEqual([]);
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — permissions.skills extraction ────────────────────────

describe("getActiveSkills — reading from permissions.skills", () => {
  it("returns one skill allowed in permissions.skills when directory exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("kb-search");
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("excludes skills with value 'deny'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await makeSkillDir(projectDir, "web-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "allow",
        "web-search": "deny",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("kb-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("excludes skills with value 'ask'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "ask",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty when .adata has no permissions field", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      // Write .adata without permissions
      await writeFile(
        join(projectDir, "metadata", "agent-1.adata"),
        JSON.stringify({ agentId: "agent-1", agentName: "agent-1" }),
      );

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty when permissions has no skills group", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeFile(
        join(projectDir, "metadata", "agent-1.adata"),
        JSON.stringify({
          agentId: "agent-1",
          agentName: "agent-1",
          permissions: { "read": "allow" }, // no skills group
        }),
      );

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — wildcard expansion ───────────────────────────────────

describe("getActiveSkills — wildcard expansion", () => {
  it("expands 'kb*' to match all skills starting with 'kb'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await makeSkillDir(projectDir, "kb-ingest");
      await makeSkillDir(projectDir, "web-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb*": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(2);
      const names = result.skills.map((s) => s.skillDirName);
      expect(names).toContain("kb-search");
      expect(names).toContain("kb-ingest");
      expect(names).not.toContain("web-search");
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("expands '*' to match all skills on disk", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "skill-a");
      await makeSkillDir(projectDir, "skill-b");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "*": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(2);
      const names = result.skills.map((s) => s.skillDirName);
      expect(names).toContain("skill-a");
      expect(names).toContain("skill-b");
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("wildcard is case-insensitive", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "KB*": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("kb-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("exact match is case-insensitive", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "KB-SEARCH": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("kb-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("nested skill matched via dash-joined wildcard", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "agents", "summarizer");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "agents*": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("agents/summarizer");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("exact dash-joined name for nested skill resolves to slash-path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "agents", "summarizer");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "agents-summarizer": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("agents/summarizer");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — warnings for missing directories ─────────────────────

describe("getActiveSkills — warnings for allowed-but-missing skills", () => {
  it("adds a warning when an allowed exact skill has no directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      // No skills/ directory created
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!).toBe("kb-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("adds a warning when a wildcard pattern matches nothing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "web-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb*": "allow", // kb* won't match web-search
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!).toBe("kb*");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("no warning for denied-only skills even when directory is missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "missing-skill": "deny",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0); // no warning for denied skills
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("mixed: some skills exist, some don't — only non-matching generate warnings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "allow",   // exists → no warning
        "web-search": "allow",  // missing → warning
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("kb-search");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!).toBe("web-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — deduplication across agents ──────────────────────────

describe("getActiveSkills — deduplication across agents", () => {
  it("deduplicates skills allowed in multiple agents", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await makeSkillDir(projectDir, "web-search");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb-search": "allow",
      });
      await writeAdataWithPermissions(projectDir, "agent-2", {
        "kb-search": "allow",
        "web-search": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(2);
      const names = result.skills.map((s) => s.skillDirName);
      expect(names).toContain("kb-search");
      expect(names).toContain("web-search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns skills sorted alphabetically by skillDirName", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "zzz-last");
      await makeSkillDir(projectDir, "aaa-first");
      await makeSkillDir(projectDir, "mmm-middle");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "zzz-last": "allow",
        "aaa-first": "allow",
        "mmm-middle": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills.map((s) => s.skillDirName)).toEqual([
        "aaa-first",
        "mmm-middle",
        "zzz-last",
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── getActiveSkills — malformed / invalid entries ──────────────────────────

describe("getActiveSkills — malformed / invalid entries", () => {
  it("skips .adata files with invalid JSON gracefully", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "good-skill");
      await writeFile(
        join(projectDir, "metadata", "bad-agent.adata"),
        "NOT JSON {{{",
      );
      await writeAdataWithPermissions(projectDir, "good-agent", {
        "good-skill": "allow",
      });

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.skillDirName).toBe("good-skill");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("ignores non-string permission values in permissions.skills", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-export-"));
    try {
      const projectDir = await makeProject(tmp);
      await makeSkillDir(projectDir, "kb-search");
      await writeFile(
        join(projectDir, "metadata", "agent-1.adata"),
        JSON.stringify({
          agentId: "agent-1",
          agentName: "agent-1",
          permissions: {
            skills: {
              "kb-search": 42,       // invalid: number
              "web-search": true,    // invalid: boolean
              "valid-skill": "allow", // but no directory
            },
          },
        }),
      );

      const result = await getActiveSkills(projectDir);
      expect(result.skills).toHaveLength(0);    // no valid dir
      expect(result.warnings).toHaveLength(1);  // "valid-skill" is allowed but missing
      expect(result.warnings[0]!).toBe("valid-skill");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── copySkillDirWithConflict ───────────────────────────────────────────────

describe("copySkillDirWithConflict — no conflicts", () => {
  it("copies a skill directory to destination without invoking conflict callback", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-copy-"));
    try {
      const srcSkillsDir = join(tmp, "src", "skills");
      const destSkillsDir = join(tmp, "dest", "skills");

      await mkdir(join(srcSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(srcSkillsDir, "kb-search", "SKILL.md"), "# KB Search");
      await writeFile(join(srcSkillsDir, "kb-search", "extra.md"), "extra");

      let conflictCalled = false;
      const result = await copySkillDirWithConflict(
        srcSkillsDir,
        destSkillsDir,
        "kb-search",
        async () => {
          conflictCalled = true;
          return "replace";
        },
      );

      expect(result.aborted).toBe(false);
      expect(conflictCalled).toBe(false);
      expect(existsSync(join(destSkillsDir, "kb-search", "SKILL.md"))).toBe(true);
      expect(existsSync(join(destSkillsDir, "kb-search", "extra.md"))).toBe(true);

      const content = await readFile(join(destSkillsDir, "kb-search", "SKILL.md"), "utf-8");
      expect(content).toBe("# KB Search");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("copySkillDirWithConflict — conflict handling", () => {
  it("invokes conflict callback when destination file exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-copy-"));
    try {
      const srcSkillsDir = join(tmp, "src", "skills");
      const destSkillsDir = join(tmp, "dest", "skills");

      await mkdir(join(srcSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(srcSkillsDir, "kb-search", "SKILL.md"), "# New content");

      // Pre-create destination file (conflict)
      await mkdir(join(destSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(destSkillsDir, "kb-search", "SKILL.md"), "# Old content");

      const calls: Array<{ skillName: string; fileName: string }> = [];
      const result = await copySkillDirWithConflict(
        srcSkillsDir,
        destSkillsDir,
        "kb-search",
        async (skillName, fileName) => {
          calls.push({ skillName, fileName });
          return "replace";
        },
      );

      expect(result.aborted).toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0].skillName).toBe("kb-search");
      expect(calls[0].fileName).toBe("SKILL.md");

      // File should be overwritten
      const content = await readFile(join(destSkillsDir, "kb-search", "SKILL.md"), "utf-8");
      expect(content).toBe("# New content");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("replaces-all: does not ask again after replace-all response", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-copy-"));
    try {
      const srcSkillsDir = join(tmp, "src", "skills");
      const destSkillsDir = join(tmp, "dest", "skills");

      await mkdir(join(srcSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(srcSkillsDir, "kb-search", "SKILL.md"), "# New");
      await writeFile(join(srcSkillsDir, "kb-search", "extra.md"), "# Extra");

      // Pre-create BOTH destination files (two conflicts)
      await mkdir(join(destSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(destSkillsDir, "kb-search", "SKILL.md"), "# Old SKILL");
      await writeFile(join(destSkillsDir, "kb-search", "extra.md"), "# Old extra");

      let callCount = 0;
      const result = await copySkillDirWithConflict(
        srcSkillsDir,
        destSkillsDir,
        "kb-search",
        async () => {
          callCount++;
          return "replace-all";
        },
      );

      expect(result.aborted).toBe(false);
      // Callback should only be called once (for the first file); replace-all
      // suppresses the second call
      expect(callCount).toBe(1);

      // Both files should be overwritten
      const skill = await readFile(join(destSkillsDir, "kb-search", "SKILL.md"), "utf-8");
      const extra = await readFile(join(destSkillsDir, "kb-search", "extra.md"), "utf-8");
      expect(skill).toBe("# New");
      expect(extra).toBe("# Extra");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("aborts when user responds with cancel", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-copy-"));
    try {
      const srcSkillsDir = join(tmp, "src", "skills");
      const destSkillsDir = join(tmp, "dest", "skills");

      await mkdir(join(srcSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(srcSkillsDir, "kb-search", "SKILL.md"), "# New");

      await mkdir(join(destSkillsDir, "kb-search"), { recursive: true });
      await writeFile(join(destSkillsDir, "kb-search", "SKILL.md"), "# Old");

      const result = await copySkillDirWithConflict(
        srcSkillsDir,
        destSkillsDir,
        "kb-search",
        async () => "cancel",
      );

      expect(result.aborted).toBe(true);
      // Original file should not have been overwritten
      const content = await readFile(join(destSkillsDir, "kb-search", "SKILL.md"), "utf-8");
      expect(content).toBe("# Old");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("copySkillDirWithConflict — missing source", () => {
  it("returns aborted=false silently when source directory does not exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-skill-copy-"));
    try {
      const srcSkillsDir = join(tmp, "src", "skills");
      const destSkillsDir = join(tmp, "dest", "skills");

      // srcSkillsDir/nonexistent does NOT exist
      const result = await copySkillDirWithConflict(
        srcSkillsDir,
        destSkillsDir,
        "nonexistent",
        async () => "replace",
      );

      expect(result.aborted).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── exportActiveSkills ────────────────────────────────────────────────────

describe("exportActiveSkills — end-to-end", () => {
  it("copies all allowed skills to destDir/skills/", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-export-skills-"));
    try {
      const projectDir = join(tmp, "project");
      const destDir = join(tmp, "dest");

      // Create skill dirs
      await makeSkillDir(projectDir, "skill-a");
      await makeSkillDir(projectDir, "skill-b");

      // Write adata with allowed skills via permissions.skills
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "skill-a": "allow",
        "skill-b": "allow",
      });

      const result = await exportActiveSkills(projectDir, destDir, async () => "replace");

      expect(result.aborted).toBe(false);
      expect(result.copiedSkills).toContain("skill-a");
      expect(result.copiedSkills).toContain("skill-b");
      expect(result.skippedSkills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(existsSync(join(destDir, "skills", "skill-a", "SKILL.md"))).toBe(true);
      expect(existsSync(join(destDir, "skills", "skill-b", "SKILL.md"))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("includes warnings in result for allowed-but-missing skills", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-export-skills-"));
    try {
      const projectDir = join(tmp, "project");
      const destDir = join(tmp, "dest");

      await makeSkillDir(projectDir, "existing-skill");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "existing-skill": "allow",
        "missing-skill": "allow",
      });

      const result = await exportActiveSkills(projectDir, destDir, async () => "replace");

      expect(result.aborted).toBe(false);
      expect(result.copiedSkills).toContain("existing-skill");
      expect(result.warnings).toContain("missing-skill");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("aborts mid-export when user cancels a conflict", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-export-skills-"));
    try {
      const projectDir = join(tmp, "project");
      const destDir = join(tmp, "dest");

      await makeSkillDir(projectDir, "skill-a");
      await makeSkillDir(projectDir, "skill-b");
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "skill-a": "allow",
        "skill-b": "allow",
      });

      // Pre-create a conflicting file for skill-a in the dest
      const destSkillsDir = join(destDir, "skills");
      await mkdir(join(destSkillsDir, "skill-a"), { recursive: true });
      await writeFile(join(destSkillsDir, "skill-a", "SKILL.md"), "# Old A");

      const result = await exportActiveSkills(projectDir, destDir, async () => "cancel");

      expect(result.aborted).toBe(true);
      // skill-b should not have been touched
      expect(result.copiedSkills).not.toContain("skill-b");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty copiedSkills and skippedSkills when no allowed skills", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-export-skills-"));
    try {
      const projectDir = join(tmp, "project");
      const destDir = join(tmp, "dest");

      await makeSkillDir(projectDir, "some-skill");
      // All skills denied
      await writeAdataWithPermissions(projectDir, "agent-1", {
        "some-skill": "deny",
      });

      const result = await exportActiveSkills(projectDir, destDir, async () => "replace");

      expect(result.aborted).toBe(false);
      expect(result.copiedSkills).toHaveLength(0);
      expect(result.skippedSkills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("expands wildcard in permissions.skills during export", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "af-export-skills-"));
    try {
      const projectDir = join(tmp, "project");
      const destDir = join(tmp, "dest");

      await makeSkillDir(projectDir, "kb-search");
      await makeSkillDir(projectDir, "kb-ingest");
      await makeSkillDir(projectDir, "web-search");

      await writeAdataWithPermissions(projectDir, "agent-1", {
        "kb*": "allow",
      });

      const result = await exportActiveSkills(projectDir, destDir, async () => "replace");

      expect(result.aborted).toBe(false);
      expect(result.copiedSkills).toContain("kb-search");
      expect(result.copiedSkills).toContain("kb-ingest");
      expect(result.copiedSkills).not.toContain("web-search");
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
