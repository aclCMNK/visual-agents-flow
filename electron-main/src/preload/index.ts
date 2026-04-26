/**
 * electron-main/src/preload/index.ts
 *
 * Preload script — FolderExplorer contextBridge
 * ──────────────────────────────────────────────
 * Expone `window.folderExplorer` al renderer de forma segura a través de
 * contextBridge. Es el ÚNICO punto de acceso del renderer a las tres
 * operaciones de navegación de directorios sanboxeadas en HOME.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  MODELO DE SEGURIDAD                                                 │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │  contextIsolation: true  → el renderer NO puede tocar Node/Electron  │
 * │  nodeIntegration:  false → el renderer NO puede require() nada       │
 * │  contextBridge           → única pasarela; solo serializable/IPC     │
 * │                                                                       │
 * │  Este preload NUNCA expone:                                           │
 * │    · ipcRenderer directamente                                         │
 * │    · fs, path, os, ni cualquier API nativa                           │
 * │    · rutas del sistema (HOME, /, /etc…)                              │
 * │    · callbacks genéricos de send/on (fire-and-forget arbitrario)     │
 * │                                                                       │
 * │  Toda validación real ocurre en el proceso main (homeJail.ts):        │
 * │    - resolveWithinHome  → path traversal + symlink escape → bloqueado │
 * │    - classifyError      → errores tipados, nunca raw Node errors      │
 * │    - filterEntries      → nombres con control chars → bloqueados      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * CANALES IPC EXPUESTOS (solo estos tres, fuente de verdad en folder-explorer.ts)
 * ─────────────────────────────────────────────────────────────────────────────
 *   "folder-explorer:list"          → list(path, options?)
 *   "folder-explorer:stat"          → stat(path)
 *   "folder-explorer:read-children" → readChildren(paths[], options?)
 *
 * USO EN RENDERER
 * ────────────────
 * ```ts
 * // Listar directorio
 * const res = await window.folderExplorer.list("/home/user/projects");
 * if (res.ok) {
 *   for (const entry of res.entries) {
 *     console.log(entry.name, entry.isDirectory, entry.path);
 *   }
 * } else {
 *   console.error(res.code, res.message); // "E_NOT_IN_HOME" | "E_NOT_FOUND" | …
 * }
 *
 * // Stat (comprobar existencia o tipo sin lanzar error si no existe)
 * const s = await window.folderExplorer.stat("/home/user/.config");
 * if (s.ok && s.stat.exists) { … }
 *
 * // Batch pre-fetch de hijos (árbol virtualizado)
 * const batch = await window.folderExplorer.readChildren({
 *   paths: ["/home/user/docs", "/home/user/projects"],
 *   options: { showHidden: false },
 * });
 * if (batch.ok) {
 *   for (const [p, r] of Object.entries(batch.results)) {
 *     if (r.ok) console.log(p, r.entries);
 *     else      console.warn(p, r.code);
 *   }
 * }
 * ```
 */

import { contextBridge, ipcRenderer } from "electron";
import { FOLDER_EXPLORER_CHANNELS } from "../ipc/folder-explorer.ts";
import type {
  ListResponse,
  StatResponse,
  ReadChildrenResponse,
  MkdirResponse,
} from "../ipc/folder-explorer.ts";
import type { FilterOptions } from "../fs/filter.ts";

// ── Contrato del objeto expuesto ────────────────────────────────────────────

/**
 * Forma tipada de `window.folderExplorer`.
 *
 * Solo métodos que consumen los tres canales validados.
 * Ninguna propiedad expone fs, path, os, ni ipcRenderer.
 */
export interface FolderExplorerBridge {
  /**
   * Lista las entradas visibles de un directorio dentro de $HOME.
   *
   * @param path    - Ruta absoluta dentro de $HOME (el main process la valida).
   * @param options - Filtros opcionales (showHidden, directoriesOnly, etc.).
   * @returns `{ ok: true, dirPath, entries }` ó `{ ok: false, code, message }`.
   *
   * Códigos de error posibles:
   *   E_NOT_IN_HOME    — path fuera de HOME (traversal, symlink escape)
   *   E_NOT_FOUND      — path no existe en disco
   *   E_NOT_A_DIR      — path existe pero es un archivo
   *   E_ACCESS_DENIED  — EACCES / EPERM al leer
   *   E_UNKNOWN        — error inesperado
   */
  list(path: string, options?: FilterOptions): Promise<ListResponse>;

  /**
   * Devuelve metadatos ligeros para una ruta dentro de $HOME.
   * Acepta archivos Y directorios (a diferencia de `list`).
   *
   * Nota especial: si la ruta no existe pero está DENTRO de HOME, devuelve
   * `{ ok: true, stat: { exists: false } }` en lugar de E_NOT_FOUND.
   * Solo devuelve `ok: false` si la ruta está FUERA de HOME o hay EACCES.
   *
   * @param path - Ruta absoluta dentro de $HOME.
   * @returns `{ ok: true, stat: PathStat }` ó `{ ok: false, code, message }`.
   */
  stat(path: string): Promise<StatResponse>;

  /**
   * Lista múltiples directorios en paralelo (batch).
   *
   * Cada path es procesado independientemente — un path inválido NO cancela
   * el batch; su error queda en `results[path]`.
   *
   * @param paths   - Array de rutas a listar.
   * @param options - Filtros aplicados a TODOS los paths.
   * @returns `{ ok: true, results: Record<path, ListResult | FolderExplorerError> }`.
   */
  readChildren(
    paths: string[],
    options?: FilterOptions,
  ): Promise<ReadChildrenResponse>;

  /**
   * Creates a new directory named `name` inside `parentPath`.
   */
  mkdir(parentPath: string, name: string): Promise<MkdirResponse>;
}

// ── Implementación del bridge ───────────────────────────────────────────────

/**
 * El objeto que se expone como `window.folderExplorer`.
 *
 * Cada método:
 *   1. Acepta solo los argumentos mínimos necesarios (ningún canal genérico).
 *   2. Construye el payload y lo pasa a ipcRenderer.invoke().
 *   3. Devuelve la respuesta tipada directamente.
 *
 * No hay acceso a fs, path, os, ni a ipcRenderer fuera de este módulo.
 */
const folderExplorerBridge: FolderExplorerBridge = {
  list(path: string, options?: FilterOptions): Promise<ListResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.LIST,
      { path, options },
    ) as Promise<ListResponse>;
  },

  stat(path: string): Promise<StatResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.STAT,
      { path },
    ) as Promise<StatResponse>;
  },

  readChildren(
    paths: string[],
    options?: FilterOptions,
  ): Promise<ReadChildrenResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.READ_CHILDREN,
      { paths, options },
    ) as Promise<ReadChildrenResponse>;
  },

  mkdir(parentPath: string, name: string): Promise<MkdirResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.MKDIR,
      { parentPath, name },
    ) as Promise<MkdirResponse>;
  },
};

// ── Exposición segura en window.folderExplorer ─────────────────────────────

contextBridge.exposeInMainWorld("folderExplorer", folderExplorerBridge);

console.log(
  "[preload/folder-explorer] window.folderExplorer expuesto — 4 canales IPC activos",
);

// ── Augmentación global de tipos ────────────────────────────────────────────
// Extiende Window para que el renderer conozca window.folderExplorer
// con tipos completos en todos los archivos del renderer sin cast.
//
// Si el renderer ya importa bridge.types.ts (que declara window.agentsFlow),
// esta declaración coexiste sin conflicto porque declara una clave diferente.

declare global {
  interface Window {
    /**
     * API de navegación de directorios segura, sanboxeada dentro de $HOME.
     * Expuesta por electron-main/src/preload/index.ts vía contextBridge.
     *
     * @see FolderExplorerBridge para la firma completa.
     */
    folderExplorer: FolderExplorerBridge;
  }
}
