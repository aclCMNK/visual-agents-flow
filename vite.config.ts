/**
 * vite.config.ts
 *
 * Vite configuration for AgentsFlow — Electron + React.
 *
 * Build targets:
 *   1. Renderer process  → src/ui/main.tsx      → dist/ui/
 *   2. Main process      → src/electron/main.ts → dist/electron/
 *   3. Preload script    → src/electron/preload.ts → dist/electron/
 *
 * The vite-plugin-electron/simple integration handles the coordination
 * between Vite's dev server (renderer) and Electron (main + preload).
 *
 * In development:
 *   - Vite serves the renderer at http://localhost:5173
 *   - vite-plugin-electron starts Electron and sets VITE_DEV_SERVER_URL
 *   - The main process loads the renderer via the dev server URL
 *
 * In production:
 *   - Renderer is built to dist/ui/
 *   - Main and preload are compiled to dist/electron/
 *   - Electron loads dist/ui/index.html directly
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { resolve } from "node:path";

export default defineConfig({
  // ── Renderer (React) ──────────────────────────────────────────────────────
  root: ".",
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },

  plugins: [
    // React HMR + JSX transform
    react(),

    // Electron main + preload integration
    electron({
      main: {
        // Main process entry point
        entry: "src/electron/main.ts",
        vite: {
          build: {
            outDir: "dist/electron",
            // Main process bundles as CommonJS for Electron compatibility
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      preload: {
        // Preload script entry point
        input: resolve(__dirname, "src/electron/preload.ts"),
        vite: {
          build: {
            outDir: "dist/electron",
            rollupOptions: {
              external: ["electron"],
              output: {
                // Force CJS format for the preload — Electron requires CommonJS
                // in the preload context. When package.json has "type":"module",
                // Vite/Rollup defaults to .mjs (ESM), but the preload uses
                // require("electron") which is invalid in ESM scope.
                // Using .cjs extension explicitly opts out of ESM regardless of
                // the package type field.
                format: "cjs",
                entryFileNames: "[name].cjs",
              },
            },
          },
        },
      },
    }),
  ],

  // ── Path aliases ──────────────────────────────────────────────────────────
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  // ── Dev server ────────────────────────────────────────────────────────────
  server: {
    port: 5173,
    strictPort: true,
  },
});
