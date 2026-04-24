/**
 * tests/ui/clone-progress-parser.test.ts
 *
 * Unit tests for Git clone progress parsing logic.
 * Tests the regex patterns and stage mapping used in ipc-handlers.ts.
 *
 * These are pure-logic tests — no DOM, no React, no Electron.
 */

import { describe, it, expect } from "bun:test";

/**
 * Simulates the progress parsing logic from ipc-handlers.ts.
 * This is a test helper that mirrors the actual implementation.
 */
function parseProgressLine(line: string): {
  stage: string;
  percent: number | undefined;
  raw: string;
} {
  const trimmed = line.trim();
  if (!trimmed) {
    return { stage: "UNKNOWN_STAGE", percent: undefined, raw: trimmed };
  }

  // Git progress lines look like:
  //   "Receiving objects:  45% (450/1000), 1.23 MiB | 500 KiB/s"
  //   "Resolving deltas:  12% (12/100)"
  //   "Counting objects: 100% (100/100), done."
  const progressMatch = trimmed.match(/^([A-Za-z][A-Za-z ]+?):\s+(\d{1,3})%/);

  let stage: string = "UNKNOWN_STAGE";
  let percent: number | undefined = undefined;

  if (progressMatch) {
    const stageRaw = progressMatch[1]?.trim().toLowerCase() ?? "";
    percent = Math.min(100, Math.max(0, parseInt(progressMatch[2] ?? "0", 10)));

    if (stageRaw.includes("counting")) {
      stage = "COUNTING_OBJECTS";
    } else if (stageRaw.includes("compress")) {
      stage = "COMPRESSING";
    } else if (stageRaw.includes("receiving")) {
      stage = "RECEIVING_OBJECTS";
    } else if (stageRaw.includes("resolving")) {
      stage = "RESOLVING_DELTAS";
    } else if (stageRaw.includes("checking out")) {
      stage = "CHECKING_OUT";
    } else {
      stage = "UNKNOWN_STAGE";
    }
  }

  return { stage, percent, raw: trimmed };
}

/**
 * Simulates the sanitization logic from ipc-handlers.ts.
 */
function sanitizeCredentials(text: string): string {
  return text.replace(/https?:\/\/[^:@\s]+:[^@\s]+@/g, "https://[REDACTED]@");
}

// ── parseProgressLine ───────────────────────────────────────────────────────

describe("parseProgressLine — Receiving objects", () => {
  it("parses Receiving objects with percentage", () => {
    const line = "Receiving objects:  45% (450/1000), 1.23 MiB | 500 KiB/s";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RECEIVING_OBJECTS");
    expect(result.percent).toBe(45);
    expect(result.raw).toBe(line);
  });

  it("parses Receiving objects with 100%", () => {
    const line = "Receiving objects: 100% (1000/1000), 10.5 MiB | 1.2 MiB/s";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RECEIVING_OBJECTS");
    expect(result.percent).toBe(100);
  });

  it("parses Receiving objects with single digit percentage", () => {
    const line = "Receiving objects:   5% (50/1000)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RECEIVING_OBJECTS");
    expect(result.percent).toBe(5);
  });
});

describe("parseProgressLine — Resolving deltas", () => {
  it("parses Resolving deltas with percentage", () => {
    const line = "Resolving deltas:  12% (12/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RESOLVING_DELTAS");
    expect(result.percent).toBe(12);
  });

  it("parses Resolving deltas with 0%", () => {
    const line = "Resolving deltas:   0% (0/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RESOLVING_DELTAS");
    expect(result.percent).toBe(0);
  });
});

describe("parseProgressLine — Counting objects", () => {
  it("parses Counting objects with 100%", () => {
    const line = "Counting objects: 100% (100/100), done.";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("COUNTING_OBJECTS");
    expect(result.percent).toBe(100);
  });

  it("parses Counting objects with percentage", () => {
    const line = "Counting objects:  75% (75/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("COUNTING_OBJECTS");
    expect(result.percent).toBe(75);
  });
});

describe("parseProgressLine — Compressing objects", () => {
  it("parses Compressing objects with percentage", () => {
    const line = "Compressing objects:  30% (30/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("COMPRESSING");
    expect(result.percent).toBe(30);
  });
});

describe("parseProgressLine — Checking out", () => {
  it("parses Checking out files with percentage", () => {
    const line = "Checking out files:  80% (80/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("CHECKING_OUT");
    expect(result.percent).toBe(80);
  });
});

describe("parseProgressLine — Unknown stages", () => {
  it("returns UNKNOWN_STAGE for unrecognized stage", () => {
    const line = "Unknown stage:  50% (50/100)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("UNKNOWN_STAGE");
    expect(result.percent).toBe(50);
  });

  it("returns UNKNOWN_STAGE for lines without percentage", () => {
    const line = "Cloning into 'repo-name'...";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("UNKNOWN_STAGE");
    expect(result.percent).toBeUndefined();
  });

  it("returns UNKNOWN_STAGE for empty line", () => {
    const line = "";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("UNKNOWN_STAGE");
    expect(result.percent).toBeUndefined();
  });

  it("returns UNKNOWN_STAGE for whitespace-only line", () => {
    const line = "   ";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("UNKNOWN_STAGE");
    expect(result.percent).toBeUndefined();
  });
});

describe("parseProgressLine — Edge cases", () => {
  it("clamps percentage to 0-100 range (below 0)", () => {
    // Note: regex won't match negative percentages, but testing the clamp logic
    const line = "Receiving objects:  -5% (-50/1000)";
    const result = parseProgressLine(line);
    
    // Regex won't match negative, so percent will be undefined
    expect(result.percent).toBeUndefined();
  });

  it("clamps percentage to 0-100 range (above 100)", () => {
    const line = "Receiving objects:  150% (1500/1000)";
    const result = parseProgressLine(line);
    
    expect(result.percent).toBe(100); // Clamped by Math.min(100, ...)
  });

  it("handles stage with extra spaces", () => {
    const line = "Receiving  objects:    45%   (450/1000)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RECEIVING_OBJECTS");
    expect(result.percent).toBe(45);
  });

  it("handles stage with mixed case", () => {
    const line = "RECEIVING OBJECTS:  45% (450/1000)";
    const result = parseProgressLine(line);
    
    expect(result.stage).toBe("RECEIVING_OBJECTS");
    expect(result.percent).toBe(45);
  });
});

// ── sanitizeCredentials ─────────────────────────────────────────────────────

describe("sanitizeCredentials", () => {
  it("redacts HTTP basic auth credentials", () => {
    const input = "https://username:token123@github.com/org/repo.git";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe("https://[REDACTED]@github.com/org/repo.git");
  });

  it("redacts HTTP basic auth credentials with special characters", () => {
    const input = "https://user%40example.com:token%2Fwith%2Fslashes@github.com/org/repo";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe("https://[REDACTED]@github.com/org/repo");
  });

  it("redacts multiple occurrences", () => {
    const input = `
      Cloning from https://user:pass@github.com/org/repo.git
      Error: https://admin:secret@gitlab.com/project.git not found
    `;
    const result = sanitizeCredentials(input);
    
    expect(result).toContain("https://[REDACTED]@github.com/org/repo.git");
    expect(result).toContain("https://[REDACTED]@gitlab.com/project.git");
  });

  it("does not modify URLs without credentials", () => {
    const input = "https://github.com/org/repo.git";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe(input);
  });

  it("does not modify SSH URLs", () => {
    const input = "git@github.com:org/repo.git";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe(input);
  });

  it("handles empty string", () => {
    const input = "";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe("");
  });

  it("handles text without URLs", () => {
    const input = "Some random text without any URLs";
    const result = sanitizeCredentials(input);
    
    expect(result).toBe(input);
  });
});

// ── Integration: Full progress parsing simulation ───────────────────────────

describe("Progress parsing integration", () => {
  it("simulates complete git clone output", () => {
    const gitOutput = `
Cloning into 'my-repo'...
remote: Enumerating objects: 100, done.
remote: Counting objects: 100% (100/100), done.
remote: Compressing objects: 100% (80/80), done.
Receiving objects:   0% (0/100)
Receiving objects:  10% (10/100), 100 KiB | 200 KiB/s
Receiving objects:  50% (50/100), 500 KiB | 400 KiB/s
Receiving objects: 100% (100/100), 1.0 MiB | 500 KiB/s, done.
Resolving deltas:   0% (0/50)
Resolving deltas:  20% (10/50)
Resolving deltas: 100% (50/50), done.
    `.trim().split("\n");

    const expectedStages = [
      "UNKNOWN_STAGE", // "Cloning into 'my-repo'..."
      "UNKNOWN_STAGE", // "remote: Enumerating objects: 100, done." (no percentage)
      "UNKNOWN_STAGE", // "remote: Counting objects: 100% (100/100), done." (has "remote:" prefix)
      "UNKNOWN_STAGE", // "remote: Compressing objects: 100% (80/80), done." (has "remote:" prefix)
      "RECEIVING_OBJECTS", // "Receiving objects:   0% (0/100)"
      "RECEIVING_OBJECTS", // "Receiving objects:  10% (10/100), 100 KiB | 200 KiB/s"
      "RECEIVING_OBJECTS", // "Receiving objects:  50% (50/100), 500 KiB | 400 KiB/s"
      "RECEIVING_OBJECTS", // "Receiving objects: 100% (100/100), 1.0 MiB | 500 KiB/s, done."
      "RESOLVING_DELTAS", // "Resolving deltas:   0% (0/50)"
      "RESOLVING_DELTAS", // "Resolving deltas:  20% (10/50)"
      "RESOLVING_DELTAS", // "Resolving deltas: 100% (50/50), done."
    ];

    gitOutput.forEach((line, index) => {
      const result = parseProgressLine(line);
      expect(result.stage).toBe(expectedStages[index]);
    });
  });

  it("simulates git clone with credentials in output (should be sanitized)", () => {
    const gitOutputWithCredentials = `
fatal: unable to access 'https://user:token123@github.com/org/private.git/': The requested URL returned error: 403
    `.trim();

    const sanitized = sanitizeCredentials(gitOutputWithCredentials);
    const parsed = parseProgressLine(sanitized);

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("token123");
    expect(parsed.stage).toBe("UNKNOWN_STAGE");
  });
});