/**
 * src/ui/main.tsx
 *
 * React renderer entry point for AgentsFlow.
 *
 * This file is the bundler entry point for the renderer process.
 * It mounts the React app into the #root element in index.html.
 *
 * Vite processes this file as the renderer entry when building with
 * vite-plugin-electron.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/app.css";

// ── Monaco Editor: resolve workers from local /vs/ copy (not CDN) ─────────
// @monaco-editor/loader uses the AMD require system (vs/loader.js).
// By default it points to jsdelivr CDN, which fails in Electron (no internet
// required, CSP restrictions). We redirect it to the local copy we ship at
// public/vs/ → served as /vs/ by Vite dev server and dist/ui/vs/ in production.
import { loader } from "@monaco-editor/react";

loader.config({
  paths: {
    vs: "/vs",
  },
});
// ─────────────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error(
    '[AgentsFlow] Cannot find #root element. ' +
    'Make sure index.html has <div id="root"></div>.'
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
