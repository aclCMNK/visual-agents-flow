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
 * path between main and renderer. All IPC flows through window.agentsFlow.
 */

import { app, BrowserWindow, session } from "electron";
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
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "AgentsFlow",
    show: false, // Show after ready-to-show to avoid flash of unstyled content
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,      // Security: renderer cannot touch Node APIs
      nodeIntegration: false,       // Security: no require() in renderer
      sandbox: false,               // Preload needs Node for IPC
      webSecurity: true,            // No cross-origin relaxation
      allowRunningInsecureContent: false,
    },
  });

  // ── Load content ──────────────────────────────────────────────────────────

  if (isDev) {
    win.loadURL(RENDERER_DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load from the built dist/ui/index.html
    win.loadFile(join(__dirname, "../../dist/ui/index.html"));
  }

  // ── Window lifecycle ───────────────────────────────────────────────────────

  win.once("ready-to-show", () => {
    console.log("[main] window ready-to-show → showing");
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
