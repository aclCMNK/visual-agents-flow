/**
 * tests/electron/select-export-dir-handler.test.ts
 *
 * Unit tests for the SELECT_EXPORT_DIR handler logic.
 *
 * These tests verify the pure result-processing logic extracted from the
 * SELECT_EXPORT_DIR handler in ipc-handlers.ts.
 *
 * Covered scenarios:
 *   - Returns { dirPath: null } when dialog is cancelled
 *   - Returns { dirPath: null } when filePaths is empty
 *   - Returns { dirPath: string } when a directory is selected
 *   - Window resolution: handler uses BrowserWindow.fromWebContents (not getFocusedWindow)
 *   - Promise.race timeout: returns { dirPath: null } when dialog hangs > 5s
 *   - try/catch: returns { dirPath: null } when dialog rejects with an error
 */

import { describe, it, expect } from "bun:test";

// ── Pure logic extracted from the SELECT_EXPORT_DIR handler ──────────────────
//
// The handler in ipc-handlers.ts does:
//
//   const win = BrowserWindow.fromWebContents(event.sender);
//   const dialogPromise = win
//     ? dialog.showOpenDialog(win, opts)
//     : dialog.showOpenDialog(opts);
//   const DIALOG_TIMEOUT_MS = 5_000;
//   const timeoutPromise = new Promise<never>((_resolve, reject) =>
//     setTimeout(() => reject(new Error(`...timed out...`)), DIALOG_TIMEOUT_MS)
//   );
//   try {
//     const result = await Promise.race([dialogPromise, timeoutPromise]);
//     const dirPath = result.canceled || result.filePaths.length === 0
//       ? null
//       : result.filePaths[0]!;
//     return { dirPath };
//   } catch (err) {
//     console.error("[ipc] SELECT_EXPORT_DIR: dialog failed or timed out —", ...);
//     return { dirPath: null };
//   }
//
// We test the pure result-processing step, the timeout race logic, and the
// error-catch path here.

/** Mirrors the Electron OpenDialogReturnValue shape relevant to our handler */
interface DialogResult {
  canceled: boolean;
  filePaths: string[];
}

/** Pure result processor — mirrors exactly what the handler does */
function resolveExportDir(result: DialogResult): { dirPath: string | null } {
  const dirPath = result.canceled || result.filePaths.length === 0
    ? null
    : result.filePaths[0]!;
  return { dirPath };
}

/**
 * Simulates the Promise.race + try/catch logic of the handler.
 *
 * @param dialogPromise  The dialog promise (may resolve normally, reject, or hang)
 * @param timeoutMs      How long before the timeout fires (default: 5000)
 */
async function runWithTimeout(
  dialogPromise: Promise<DialogResult>,
  timeoutMs: number = 5_000
): Promise<{ dirPath: string | null }> {
  const timeoutPromise = new Promise<never>((_resolve, reject) =>
    setTimeout(
      () => reject(new Error(`SELECT_EXPORT_DIR timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  );
  try {
    const result = await Promise.race([dialogPromise, timeoutPromise]);
    return resolveExportDir(result);
  } catch (_err) {
    return { dirPath: null };
  }
}

// ── resolveExportDir — cancelled dialog ───────────────────────────────────────

describe("SELECT_EXPORT_DIR handler logic — cancelled dialog", () => {
  it("returns dirPath: null when canceled is true with filePaths", () => {
    const result = resolveExportDir({ canceled: true, filePaths: ["/some/dir"] });
    expect(result.dirPath).toBeNull();
  });

  it("returns dirPath: null when canceled is true and filePaths is empty", () => {
    const result = resolveExportDir({ canceled: true, filePaths: [] });
    expect(result.dirPath).toBeNull();
  });
});

// ── resolveExportDir — no paths selected ─────────────────────────────────────

describe("SELECT_EXPORT_DIR handler logic — empty filePaths", () => {
  it("returns dirPath: null when canceled is false but filePaths is empty", () => {
    const result = resolveExportDir({ canceled: false, filePaths: [] });
    expect(result.dirPath).toBeNull();
  });
});

// ── resolveExportDir — directory selected ────────────────────────────────────

describe("SELECT_EXPORT_DIR handler logic — directory selected", () => {
  it("returns the selected directory path", () => {
    const result = resolveExportDir({
      canceled: false,
      filePaths: ["/home/user/exports"],
    });
    expect(result.dirPath).toBe("/home/user/exports");
  });

  it("returns the first path when multiple are returned", () => {
    const result = resolveExportDir({
      canceled: false,
      filePaths: ["/first/dir", "/second/dir"],
    });
    expect(result.dirPath).toBe("/first/dir");
  });

  it("returns an absolute path unchanged", () => {
    const path = "/Users/kamiloid/projects/export-dest";
    const result = resolveExportDir({ canceled: false, filePaths: [path] });
    expect(result.dirPath).toBe(path);
  });

  it("returns a path with spaces", () => {
    const path = "/Users/kamiloid/my projects/export dest";
    const result = resolveExportDir({ canceled: false, filePaths: [path] });
    expect(result.dirPath).toBe(path);
  });
});

// ── Return shape ──────────────────────────────────────────────────────────────

describe("SELECT_EXPORT_DIR handler logic — return shape", () => {
  it("always returns an object with a dirPath key", () => {
    const selected = resolveExportDir({ canceled: false, filePaths: ["/foo"] });
    expect(Object.keys(selected)).toContain("dirPath");
  });

  it("result is serializable (no undefined — null is used for cancellation)", () => {
    const cancelled = resolveExportDir({ canceled: true, filePaths: [] });
    // JSON.stringify converts undefined to nothing; null is explicit
    const json = JSON.parse(JSON.stringify(cancelled));
    expect(json.dirPath).toBeNull();
  });
});

// ── Window resolution audit ───────────────────────────────────────────────────
//
// The critical fix: SELECT_EXPORT_DIR must use BrowserWindow.fromWebContents(event.sender)
// instead of BrowserWindow.getFocusedWindow().
//
// We verify this at the source level by reading the handler implementation.
// This is a static analysis assertion — it guards against regressions.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IPC_HANDLERS_PATH = join(__dirname, "../../src/electron/ipc-handlers.ts");

describe("SELECT_EXPORT_DIR handler — window resolution guard", () => {
  it("uses BrowserWindow.fromWebContents(event.sender) instead of getFocusedWindow()", async () => {
    const source = await readFile(IPC_HANDLERS_PATH, "utf-8");

    // Locate the SELECT_EXPORT_DIR handler block
    const handlerStart = source.indexOf("IPC_CHANNELS.SELECT_EXPORT_DIR");
    expect(handlerStart).toBeGreaterThan(-1);

    // Grab a window of source code after the channel registration (the handler body)
    const handlerBlock = source.slice(handlerStart, handlerStart + 600);

    // Must use fromWebContents
    expect(handlerBlock).toContain("BrowserWindow.fromWebContents(event.sender)");

    // Must NOT use getFocusedWindow() inside the handler body
    // (it may appear in a comment — we check executable code patterns)
    expect(handlerBlock).not.toContain("getFocusedWindow()");
  });

  it("handler signature receives the event parameter (not _event)", async () => {
    const source = await readFile(IPC_HANDLERS_PATH, "utf-8");
    const handlerStart = source.indexOf("IPC_CHANNELS.SELECT_EXPORT_DIR");
    const handlerBlock = source.slice(handlerStart, handlerStart + 300);

    // async (event) — not async (_event)
    expect(handlerBlock).toContain("async (event)");
    expect(handlerBlock).not.toContain("async (_event)");
  });

  it("handler uses Promise.race with a timeout guard", async () => {
    const source = await readFile(IPC_HANDLERS_PATH, "utf-8");
    const handlerStart = source.indexOf("IPC_CHANNELS.SELECT_EXPORT_DIR");
    // Wider window to cover the full handler body including try/catch
    const handlerBlock = source.slice(handlerStart, handlerStart + 1200);

    expect(handlerBlock).toContain("Promise.race");
    expect(handlerBlock).toContain("DIALOG_TIMEOUT_MS");
    expect(handlerBlock).toContain("try {");
    expect(handlerBlock).toContain("} catch");
  });
});

// ── Timeout and error-recovery logic ─────────────────────────────────────────
//
// These tests exercise the Promise.race + try/catch logic using the
// runWithTimeout helper extracted above (mirrors the handler implementation).

describe("SELECT_EXPORT_DIR — timeout workaround: dialog resolves normally", () => {
  it("returns selected dirPath when dialog resolves before timeout", async () => {
    const dialogPromise = Promise.resolve({
      canceled: false,
      filePaths: ["/chosen/export/path"],
    });
    const result = await runWithTimeout(dialogPromise, 5_000);
    expect(result.dirPath).toBe("/chosen/export/path");
  });

  it("returns { dirPath: null } when dialog is cancelled before timeout", async () => {
    const dialogPromise = Promise.resolve({ canceled: true, filePaths: [] });
    const result = await runWithTimeout(dialogPromise, 5_000);
    expect(result.dirPath).toBeNull();
  });
});

describe("SELECT_EXPORT_DIR — timeout workaround: dialog times out", () => {
  it("returns { dirPath: null } when dialog hangs longer than the timeout", async () => {
    // Dialog that never resolves (simulates a frozen native dialog)
    const hangingDialog = new Promise<DialogResult>(() => { /* never resolves */ });
    // Use a 20ms timeout to keep tests fast
    const result = await runWithTimeout(hangingDialog, 20);
    expect(result.dirPath).toBeNull();
  });

  it("does not throw — app remains usable after a timeout", async () => {
    const hangingDialog = new Promise<DialogResult>(() => { /* never resolves */ });
    let threw = false;
    try {
      await runWithTimeout(hangingDialog, 20);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("SELECT_EXPORT_DIR — timeout workaround: dialog rejects with error", () => {
  it("returns { dirPath: null } when dialog.showOpenDialog rejects", async () => {
    const failingDialog = Promise.reject(new Error("dialog destroyed unexpectedly"));
    const result = await runWithTimeout(failingDialog, 5_000);
    expect(result.dirPath).toBeNull();
  });

  it("does not throw when the dialog promise rejects", async () => {
    const failingDialog = Promise.reject(new Error("OS compositor error"));
    let threw = false;
    try {
      await runWithTimeout(failingDialog, 5_000);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("SELECT_EXPORT_DIR — timeout workaround: return shape is always serializable", () => {
  it("timeout path returns an object with dirPath key (not undefined)", async () => {
    const hangingDialog = new Promise<DialogResult>(() => { /* never resolves */ });
    const result = await runWithTimeout(hangingDialog, 20);
    expect(Object.keys(result)).toContain("dirPath");
    expect(result.dirPath).toBeNull();
    // Must be JSON-serializable (no undefined values)
    const json = JSON.parse(JSON.stringify(result));
    expect(json.dirPath).toBeNull();
  });

  it("error path returns an object with dirPath key (not undefined)", async () => {
    const failingDialog = Promise.reject(new Error("fail"));
    const result = await runWithTimeout(failingDialog, 5_000);
    expect(Object.keys(result)).toContain("dirPath");
    const json = JSON.parse(JSON.stringify(result));
    expect(json.dirPath).toBeNull();
  });
});
