/**
 * tests/electron/ipc/opencode-models.test.ts
 *
 * Unit tests for electron-main/src/ipc/opencode-models.ts
 */

import { describe, it, expect } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { IpcMain } from "electron";
import {
  parseOpencodeModelsOutput,
  runOpencodeModels,
  registerOpencodeModelsHandlers,
  OPENCODE_MODELS_CHANNELS,
  type OpencodeModelsDeps,
} from "../../../electron-main/src/ipc/opencode-models.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a mock ChildProcess that emits stdout data, then closes.
 */
function makeMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorCode?: string;
}): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  (proc as unknown as Record<string, unknown>).stdout = stdoutEmitter;
  (proc as unknown as Record<string, unknown>).stderr = stderrEmitter;
  (proc as unknown as Record<string, unknown>).kill = () => {};

  // Emit events asynchronously
  setImmediate(() => {
    if (options.errorCode) {
      const err = new Error("spawn error") as NodeJS.ErrnoException;
      err.code = options.errorCode;
      proc.emit("error", err);
      return;
    }
    if (options.stdout) {
      stdoutEmitter.emit("data", Buffer.from(options.stdout));
    }
    if (options.stderr) {
      stderrEmitter.emit("data", Buffer.from(options.stderr));
    }
    proc.emit("close", options.exitCode ?? 0);
  });

  return proc;
}

function makeSpawn(options: Parameters<typeof makeMockProcess>[0]) {
  return (_cmd: string, _args: string[]) => makeMockProcess(options);
}

// ── parseOpencodeModelsOutput ─────────────────────────────────────────────────

describe("parseOpencodeModelsOutput", () => {
  it("parses standard provider/model lines", () => {
    const stdout = "anthropic/claude-opus-4-5\nanthropic/claude-sonnet-4-5\nopenai/gpt-4o\n";
    const result = parseOpencodeModelsOutput(stdout);
    expect(result).toEqual({
      anthropic: ["claude-opus-4-5", "claude-sonnet-4-5"],
      openai: ["gpt-4o"],
    });
  });

  it("handles Windows CRLF line endings", () => {
    const stdout = "openai/gpt-4o\r\nopenai/gpt-4o-mini\r\n";
    const result = parseOpencodeModelsOutput(stdout);
    expect(result).toEqual({ openai: ["gpt-4o", "gpt-4o-mini"] });
  });

  it("ignores empty lines", () => {
    const stdout = "\n\nanthropic/claude-3\n\n";
    const result = parseOpencodeModelsOutput(stdout);
    expect(result).toEqual({ anthropic: ["claude-3"] });
  });

  it("ignores lines without /", () => {
    const stdout = "Available models:\nanthropic/claude-3\nsome-header-line\n";
    const result = parseOpencodeModelsOutput(stdout);
    expect(result).toEqual({ anthropic: ["claude-3"] });
  });

  it("handles model IDs with multiple slashes", () => {
    const stdout = "google/gemini/pro\n";
    const result = parseOpencodeModelsOutput(stdout);
    expect(result).toEqual({ google: ["gemini/pro"] });
  });

  it("returns empty object for empty input", () => {
    expect(parseOpencodeModelsOutput("")).toEqual({});
    expect(parseOpencodeModelsOutput("\n\n")).toEqual({});
  });
});

// ── runOpencodeModels ─────────────────────────────────────────────────────────

describe("runOpencodeModels", () => {
  it("returns parsed models on successful exit", async () => {
    const stdout = "anthropic/claude-3\nopenai/gpt-4o\n";
    const deps: Partial<OpencodeModelsDeps> = {
      spawnProcess: makeSpawn({ stdout, exitCode: 0 }),
      platform: "linux",
    };

    const result = await runOpencodeModels(deps);

    expect(result.ok).toBe(true);
    expect(result.models).toEqual({
      anthropic: ["claude-3"],
      openai: ["gpt-4o"],
    });
    expect(result.error).toBeUndefined();
  });

  it("returns error when process exits with non-zero code", async () => {
    const deps: Partial<OpencodeModelsDeps> = {
      spawnProcess: makeSpawn({ exitCode: 1, stderr: "some error" }),
      platform: "linux",
    };

    const result = await runOpencodeModels(deps);

    expect(result.ok).toBe(false);
    expect(result.models).toEqual({});
    expect(result.error).toContain("exited with code 1");
  });

  it("returns ENOENT error when CLI is not found", async () => {
    const deps: Partial<OpencodeModelsDeps> = {
      spawnProcess: makeSpawn({ errorCode: "ENOENT" }),
      platform: "linux",
    };

    const result = await runOpencodeModels(deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found in PATH");
  });

  it("returns empty models for empty stdout", async () => {
    const deps: Partial<OpencodeModelsDeps> = {
      spawnProcess: makeSpawn({ stdout: "", exitCode: 0 }),
      platform: "linux",
    };

    const result = await runOpencodeModels(deps);

    expect(result.ok).toBe(true);
    expect(result.models).toEqual({});
  });
});

// ── registerOpencodeModelsHandlers ────────────────────────────────────────────

describe("registerOpencodeModelsHandlers", () => {
  it("registers the LIST_MODELS channel", () => {
    const registeredChannels: string[] = [];
    const mockIpcMain = {
      handle: (channel: string, _handler: unknown) => {
        registeredChannels.push(channel);
      },
    } as unknown as IpcMain;

    registerOpencodeModelsHandlers(mockIpcMain);

    expect(registeredChannels).toContain(OPENCODE_MODELS_CHANNELS.LIST_MODELS);
  });
});
