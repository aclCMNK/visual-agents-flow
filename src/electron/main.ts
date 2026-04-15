/**
 * src/electron/main.ts
 *
 * Electron main process entry point for AgentsFlow.
 *
 * Responsibilities:
 *   1. Create and configure the BrowserWindow with security best practices
 *   2. Register IPC handlers (via registerIpcHandlers)
 *   3. Load the renderer URL (Vite dev server or built dist/)
 *   4. Manage app lifecycle (ready, window-all-closed, activate)
 *
 * Security settings applied to the BrowserWindow:
 *   - contextIsolation: true    — renderer cannot access Node APIs
 *   - nodeIntegration: false    — renderer cannot require() Node modules
 *   - sandbox: false            — preload needs Node APIs for IPC
 *   - webSecurity: true         — no cross-origin relaxations
 *
 * The preload script at src/electron/preload.ts is the ONLY communication
 * path between main and renderer. It exposes both:
 *   - window.agentsFlow     — main project/asset/adata bridge
 *   - window.folderExplorer — home-sandboxed directory browser bridge
 *
 * ── Build & preload path notes ─────────────────────────────────────────────
 *
 * VITE output layout (dist/):
 *   dist/
 *     electron/
 *       main.js          ← this file, compiled as ESM (or CJS on some versions)
 *       preload.cjs      ← preload compiled as CJS (forced via vite.config.ts)
 *     ui/
 *       index.html       ← renderer entry point (prod only)
 *
 * preloadPath resolution:
 *   __dirname = fileURLToPath(new URL(".", import.meta.url))
 *             = <app>/dist/electron/   (in prod)
 *             = <app>/dist/electron/   (in dev, after vite-plugin-electron compiles it)
 *   join(__dirname, "preload.cjs") = dist/electron/preload.cjs  ✓
 *
 * electron-builder:
 *   Packs dist/electron/** into the app bundle. The preload.cjs will be at
 *   resources/app/dist/electron/preload.cjs — Electron resolves it via the
 *   absolute path stored in the compiled main.js (path.join(__dirname, "preload.cjs")).
 *   No extra copy step needed as long as dist/electron/** is in `build.files`.
 *
 * Gotchas:
 *   - If you see "preload not found" in the console, run `vite build` first
 *     (dev mode re-compiles on save, but the initial cold start needs one build).
 *   - If contextIsolation is false OR nodeIntegration is true, window.agentsFlow
 *     and window.folderExplorer will be undefined (the bridge is no-op without isolation).
 *   - sandbox:false is required because the preload uses ipcRenderer (Node API).
 *     Changing to sandbox:true would break ALL IPC.
 */

import { app, BrowserWindow, Menu, session } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { registerIpcHandlers } from "./ipc-handlers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Environment detection ──────────────────────────────────────────────────

const isDev = process.env["NODE_ENV"] === "development" || process.env["ELECTRON_DEV"] === "1";
const RENDERER_DEV_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";

// ── Window creation ────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  // vite-plugin-electron/simple detects "type": "module" in package.json and
  // would compile the preload as .mjs, but Electron's preload context requires
  // CommonJS (it uses require("electron") internally). We force CJS output with
  // the .cjs extension in vite.config.ts — that extension opts out of ESM even
  // when the package type is "module".
  const preloadPath = join(__dirname, "preload.cjs"); // compiled as CJS by Vite

  console.log("[main] createWindow: __dirname =", __dirname);
  console.log("[main] createWindow: preloadPath =", preloadPath);

  // Validate preload exists before creating the window (catches config drift early)
  if (!existsSync(preloadPath)) {
    console.error(
      `[main] FATAL: preload script not found at "${preloadPath}". ` +
      `Run 'vite build' first or check the vite.config.ts preload output dir. ` +
      `Expected: dist/electron/preload.cjs`
    );
  } else {
    console.log("[main] preload found ✓");
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "AgentsFlow",
    show: false, // Show after ready-to-show to avoid flash of unstyled content
    autoHideMenuBar: true,  // Hide the native menu bar (no standard Electron menu)
    webPreferences: {
      preload: preloadPath,          // Absolute path → dist/electron/preload.cjs
      contextIsolation: true,        // REQUIRED: renderer cannot touch Node APIs
      nodeIntegration: false,        // REQUIRED: no require() in renderer
      sandbox: false,                // Preload needs Node for IPC (ipcRenderer)
      webSecurity: true,             // No cross-origin relaxation
      allowRunningInsecureContent: false,
    },
  });

  // Log the webPreferences actually used — useful for diagnosing bridge issues.
  // If contextIsolation is false or nodeIntegration is true, window.folderExplorer
  // and window.agentsFlow will be unavailable (contextBridge is a no-op without isolation).
  console.log("[main] BrowserWindow webPreferences:", {
    preload:              preloadPath,
    contextIsolation:     true,
    nodeIntegration:      false,
    sandbox:              false,
  });

  // ── Load content ──────────────────────────────────────────────────────────

  if (isDev) {
    win.loadURL(RENDERER_DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load from the built dist/ui/index.html
    win.loadFile(join(__dirname, "../../dist/ui/index.html"));
  }

  // ── Diagnostic: scan window.folderExplorer after renderer loads ───────────
  //
  // This log runs in the RENDERER context (via executeJavaScript) and reports
  // whether window.folderExplorer was correctly injected by the preload.
  // Check the renderer DevTools console (or the Electron console) for output.
  //
  // If you see "MISSING" here, the most common causes are:
  //   1. preloadPath does not exist on disk (check "[main] FATAL" above).
  //   2. contextIsolation is false (the bridge is a no-op without isolation).
  //   3. The preload threw an error before reaching exposeInMainWorld.
  //      → Check the preload console for "[preload] module evaluated" log.
  win.webContents.on("did-finish-load", () => {
    win.webContents
      .executeJavaScript(
        `(function() {
          var fe = window.folderExplorer;
          var af = window.agentsFlow;
          return {
            folderExplorer: {
              available: typeof fe !== 'undefined',
              list:          typeof fe?.list === 'function',
              stat:          typeof fe?.stat === 'function',
              readChildren:  typeof fe?.readChildren === 'function',
            },
            agentsFlow: {
              available: typeof af !== 'undefined',
            },
          };
        })()`
      )
      .then((result: unknown) => {
        console.log("[main] renderer bridge scan (did-finish-load):", JSON.stringify(result, null, 2));
        const r = result as {
          folderExplorer: { available: boolean; list: boolean; stat: boolean; readChildren: boolean };
          agentsFlow:     { available: boolean };
        };
        if (!r.folderExplorer.available) {
          console.error(
            "[main] DIAGNOSTIC: window.folderExplorer is MISSING in renderer. " +
            "Check that the preload compiled correctly (dist/electron/preload.cjs) " +
            "and that contextIsolation:true + nodeIntegration:false are set."
          );
        } else if (!r.folderExplorer.list || !r.folderExplorer.stat || !r.folderExplorer.readChildren) {
          console.warn(
            "[main] DIAGNOSTIC: window.folderExplorer is present but some methods are missing:",
            r.folderExplorer
          );
        } else {
          console.log("[main] window.folderExplorer ✓ (list, stat, readChildren all available)");
        }
        if (!r.agentsFlow.available) {
          console.error("[main] DIAGNOSTIC: window.agentsFlow is MISSING in renderer.");
        } else {
          console.log("[main] window.agentsFlow ✓");
        }
      })
      .catch((err: unknown) => {
        console.warn("[main] bridge scan executeJavaScript failed:", err);
      });
  });

  // ── Window lifecycle ───────────────────────────────────────────────────────

  win.once("ready-to-show", () => {
    console.log("[main] window ready-to-show → maximizing and showing");
    win.maximize(); // Always open maximized (fills the full desktop/screen area)
    win.show();
  });

  win.on("closed", () => {
    // Cleanup if needed
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  console.log("[main] app ready. isDev =", isDev, "| renderer URL =", isDev ? RENDERER_DEV_URL : "dist/ui/index.html");

  // Remove the default application menu entirely (all platforms)
  Menu.setApplicationMenu(null);

  // Register a strict Content Security Policy for the renderer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            // Dev: allow Vite HMR websocket + inline scripts for React DevTools + Monaco eval + blob workers
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; worker-src 'self' blob:"
            // Prod: allow self + unsafe-eval for Monaco's AMD loader (vs/loader.js uses eval internally)
            : "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
        ],
      },
    });
  });

  // Register all IPC handlers before creating the window
  registerIpcHandlers();
  console.log("[main] IPC handlers registered");

  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ── Security: block navigation to external URLs ────────────────────────────

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    // Allow only the renderer URL (Vite dev server or file://)
    const allowedOrigins = ["http://localhost:5173", "file://"];
    const isAllowed = allowedOrigins.some(
      (origin) => url.startsWith(origin)
    );
    if (!isAllowed) {
      console.warn(`[security] Blocked navigation to: ${url}`);
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    console.warn(`[security] Blocked window.open to: ${url}`);
    return { action: "deny" };
  });
});
