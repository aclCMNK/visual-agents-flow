/// <reference types="vite/client" />

import type { ModelsApiResult } from "../electron-main/src/ipc/models-api.ts";

declare global {
  interface Window {
    /**
     * Models API bridge — exposes getModels() for the renderer.
     * Populated by the preload script via contextBridge.
     */
    modelsApi?: {
      getModels(): Promise<ModelsApiResult>;
    };
  }
}
