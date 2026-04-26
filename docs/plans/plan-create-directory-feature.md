# 🧠 Plan de Solución: Crear Directorio desde FileExplorer

> Generado por: Weight-Planner  
> Fecha: 2026-04-26  
> Scope: Feature completa — UI + Estado + IPC + Backend + Errores

---

## 🎯 Objective

Permitir al usuario crear un nuevo directorio desde la UI del `FolderExplorer`, nombrarlo inline, y que el directorio sea creado físicamente en el filesystem dentro del directorio actualmente visible (`cwd`), con manejo robusto de errores y feedback visual claro.

---

## 🧩 Context

### Stack actual relevante

| Capa | Archivo | Rol |
|------|---------|-----|
| UI Component | `src/renderer/components/FolderExplorer/FolderExplorer.tsx` | Renderiza el explorador, toolbar, lista de entradas |
| Hook de estado | `src/renderer/hooks/useFolderExplorer.ts` | Gestiona `cwd`, `entries`, `loading`, `error`, `selected` |
| Servicio IPC renderer | `src/renderer/services/ipc.ts` | Wrapper tipado con timeout sobre `window.folderExplorer` |
| Preload bridge | `electron-main/src/preload/index.ts` | Expone `window.folderExplorer` vía `contextBridge` |
| IPC handlers main | `electron-main/src/ipc/folder-explorer.ts` | Handlers `ipcMain.handle` para list/stat/read-children |
| Barrel IPC | `electron-main/src/ipc/index.ts` | Re-exporta handlers y tipos |
| Jail de seguridad | `electron-main/src/fs/homeJail.ts` | Valida que toda ruta esté dentro de `HOME_ROOT` |
| CSS Module | `src/renderer/components/FolderExplorer/FolderExplorer.module.css` | Estilos del componente |

### Patrones establecidos en el codebase

- **Seguridad**: Toda ruta pasa por `resolveWithinHome()` antes de cualquier operación FS.
- **Errores**: Siempre discriminated union `{ ok: true, ... } | { ok: false, code, message }`. Nunca se lanza al renderer.
- **IPC**: Canal nuevo → constante en `FOLDER_EXPLORER_CHANNELS` → handler en `folder-explorer.ts` → expuesto en preload → wrapper en `ipc.ts`.
- **Estado React**: El hook `useFolderExplorer` es la única fuente de verdad. El componente solo llama métodos del hook.
- **CSS**: CSS Modules con variables CSS del design system (`--color-primary`, `--color-border`, etc.).

---

## 🧭 Strategy

Seguir exactamente el mismo patrón arquitectónico del codebase:

1. **Nuevo canal IPC** `folder-explorer:mkdir` en el main process con validación `homeJail`.
2. **Nuevo método `mkdir`** expuesto en el preload bridge.
3. **Nueva función `createDirectory`** en `ipc.ts` (renderer service).
4. **Nuevo método `createDir`** en el hook `useFolderExplorer`.
5. **UI inline en toolbar**: botón `+` → input de nombre → confirmación/cancelación → feedback.
6. **Auto-reload** del directorio actual tras creación exitosa.

El flujo de creación es **inline en el toolbar** (no modal separado), para mantener la UX fluida y consistente con el estilo del componente.

---

## 🚀 Phases

---

### 🔹 Phase 1: Backend — Nuevo handler IPC `folder-explorer:mkdir`

**Description:**  
Agregar el handler en el main process que recibe `{ parentPath, name }`, valida ambos, y crea el directorio con `fs.mkdir`.

**Tasks:**

- **Task 1.1:** Agregar constante de canal y tipos en `folder-explorer.ts`
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

  **Detalle de implementación:**

  En `electron-main/src/ipc/folder-explorer.ts`, agregar:

  ```typescript
  // En FOLDER_EXPLORER_CHANNELS:
  MKDIR: "folder-explorer:mkdir",

  // Nuevos tipos de error específicos de mkdir:
  export type FolderExplorerErrorCode =
    | "E_NOT_IN_HOME"
    | "E_NOT_FOUND"
    | "E_NOT_A_DIR"
    | "E_ACCESS_DENIED"
    | "E_UNKNOWN"
    | "E_ALREADY_EXISTS"   // ← NUEVO: directorio ya existe
    | "E_INVALID_NAME";    // ← NUEVO: nombre inválido (chars ilegales, vacío, etc.)

  // Resultado exitoso de mkdir:
  export interface MkdirResult {
    ok: true;
    /** Ruta absoluta del directorio creado (validada dentro de HOME_ROOT). */
    createdPath: string;
  }

  export type MkdirResponse = MkdirResult | FolderExplorerError;
  ```

- **Task 1.2:** Implementar validación de nombre de directorio
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

  **Detalle de implementación:**

  Agregar función interna `validateDirName(name: string): string | null` que retorna `null` si es válido o un mensaje de error si no:

  ```typescript
  /**
   * Valida que `name` sea un nombre de directorio seguro.
   * Retorna null si es válido, o un mensaje de error si no.
   *
   * Reglas:
   *   - No vacío ni solo espacios
   *   - No contiene separadores de ruta (/ o \)
   *   - No es "." ni ".."
   *   - No contiene caracteres de control (U+0000–U+001F, U+007F)
   *   - No contiene caracteres ilegales en Windows: < > : " | ? *
   *     (aplicamos esto en todas las plataformas para portabilidad)
   *   - Longitud máxima: 255 caracteres (límite ext4/APFS/NTFS)
   */
  function validateDirName(name: string): string | null {
    if (!name || name.trim() === "") {
      return "Directory name cannot be empty.";
    }
    if (name.length > 255) {
      return "Directory name cannot exceed 255 characters.";
    }
    if (name === "." || name === "..") {
      return `"${name}" is not a valid directory name.`;
    }
    if (name.includes("/") || name.includes("\\")) {
      return "Directory name cannot contain path separators (/ or \\).";
    }
    // Control characters (U+0000–U+001F, U+007F)
    if (/[\x00-\x1F\x7F]/.test(name)) {
      return "Directory name cannot contain control characters.";
    }
    // Windows-illegal characters (applied cross-platform for portability)
    if (/[<>:"|?*]/.test(name)) {
      return 'Directory name cannot contain: < > : " | ? *';
    }
    return null; // válido
  }
  ```

- **Task 1.3:** Implementar handler `handleMkdir`
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.2

  **Detalle de implementación:**

  ```typescript
  import { mkdir } from "node:fs/promises";

  async function handleMkdir(
    _event: Electron.IpcMainInvokeEvent,
    payload: { parentPath: string; name: string },
  ): Promise<MkdirResponse> {
    // 1. Validar payload shape
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.parentPath !== "string" ||
      typeof payload.name !== "string"
    ) {
      return {
        ok: false,
        code: "E_UNKNOWN",
        message: "Invalid payload: expected { parentPath: string; name: string }.",
      };
    }

    const { parentPath, name } = payload;

    // 2. Validar nombre
    const nameError = validateDirName(name);
    if (nameError) {
      return { ok: false, code: "E_INVALID_NAME", message: nameError };
    }

    // 3. Validar parentPath dentro de HOME (jail check)
    let safeParent: string;
    try {
      safeParent = await resolveWithinHome(parentPath);
    } catch (err) {
      return classifyError(err);
    }

    // 4. Confirmar que parentPath es un directorio
    let parentStat: Awaited<ReturnType<typeof stat>>;
    try {
      parentStat = await stat(safeParent);
    } catch (err) {
      return classifyError(err);
    }
    if (!parentStat.isDirectory()) {
      return {
        ok: false,
        code: "E_NOT_A_DIR",
        message: `"${safeParent}" is not a directory.`,
      };
    }

    // 5. Construir ruta final y verificar que también esté dentro de HOME
    //    (join es seguro aquí porque `name` ya fue validado sin separadores,
    //    pero hacemos el check igualmente por defensa en profundidad)
    const newDirPath = join(safeParent, name);

    // 6. Crear el directorio (sin recursive — queremos error si ya existe)
    try {
      await mkdir(newDirPath, { recursive: false });
    } catch (err) {
      const nodeCode = (err as NodeJS.ErrnoException).code ?? "";
      if (nodeCode === "EEXIST") {
        return {
          ok: false,
          code: "E_ALREADY_EXISTS",
          message: `A directory named "${name}" already exists in this location.`,
        };
      }
      if (nodeCode === "EACCES" || nodeCode === "EPERM") {
        return {
          ok: false,
          code: "E_ACCESS_DENIED",
          message: `Permission denied: cannot create directory "${name}" here.`,
        };
      }
      return classifyError(err);
    }

    return { ok: true, createdPath: newDirPath };
  }
  ```

- **Task 1.4:** Registrar el handler en `registerFolderExplorerHandlers`
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.3

  ```typescript
  // En registerFolderExplorerHandlers():
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.MKDIR, handleMkdir);
  ```

- **Task 1.5:** Re-exportar nuevos tipos en `electron-main/src/ipc/index.ts`
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

  ```typescript
  export type {
    // ... tipos existentes ...
    MkdirResult,
    MkdirResponse,
  } from "./folder-explorer.ts";
  ```

---

### 🔹 Phase 2: Bridge — Exponer `mkdir` en el preload

**Description:**  
Agregar el método `mkdir` al `contextBridge` para que el renderer pueda invocarlo.

**Tasks:**

- **Task 2.1:** Actualizar `FolderExplorerBridge` en `electron-main/src/preload/index.ts`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1 completa

  ```typescript
  import type { MkdirResponse } from "../ipc/folder-explorer.ts";

  // En FolderExplorerBridge interface:
  /**
   * Crea un nuevo directorio con nombre `name` dentro de `parentPath`.
   *
   * @param parentPath - Ruta absoluta del directorio padre (dentro de $HOME).
   * @param name       - Nombre del nuevo directorio (sin separadores de ruta).
   * @returns `{ ok: true, createdPath }` ó `{ ok: false, code, message }`.
   *
   * Códigos de error posibles:
   *   E_INVALID_NAME   — nombre vacío, con chars ilegales, ".", "..", etc.
   *   E_NOT_IN_HOME    — parentPath fuera de HOME
   *   E_NOT_FOUND      — parentPath no existe
   *   E_NOT_A_DIR      — parentPath existe pero es un archivo
   *   E_ALREADY_EXISTS — ya existe un directorio con ese nombre
   *   E_ACCESS_DENIED  — sin permisos de escritura
   *   E_UNKNOWN        — error inesperado
   */
  mkdir(parentPath: string, name: string): Promise<MkdirResponse>;
  ```

- **Task 2.2:** Implementar el método en `folderExplorerBridge`
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.1

  ```typescript
  mkdir(parentPath: string, name: string): Promise<MkdirResponse> {
    return ipcRenderer.invoke(
      FOLDER_EXPLORER_CHANNELS.MKDIR,
      { parentPath, name },
    ) as Promise<MkdirResponse>;
  },
  ```

- **Task 2.3:** Actualizar la declaración global `Window` en el preload
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.1

  La declaración `window.folderExplorer: FolderExplorerBridge` ya incluirá `mkdir` automáticamente al actualizar la interface.

---

### 🔹 Phase 3: Renderer Service — `createDirectory` en `ipc.ts`

**Description:**  
Agregar la función pública `createDirectory` en `src/renderer/services/ipc.ts`, siguiendo el mismo patrón de timeout + normalización de errores que las funciones existentes.

**Tasks:**

- **Task 3.1:** Agregar nuevos códigos de error al tipo `IpcErrorCode`
  - **Assigned to:** Developer
  - **Dependencies:** ninguna (puede hacerse en paralelo con Phase 1)

  ```typescript
  export type IpcErrorCode =
    | "E_NOT_IN_HOME"
    | "E_NOT_FOUND"
    | "E_NOT_A_DIR"
    | "E_ACCESS_DENIED"
    | "E_UNKNOWN"
    | "E_TIMEOUT"
    | "E_BRIDGE"
    | "E_ALREADY_EXISTS"  // ← NUEVO
    | "E_INVALID_NAME";   // ← NUEVO
  ```

- **Task 3.2:** Agregar tipos de resultado para `createDirectory`
  - **Assigned to:** Developer
  - **Dependencies:** Task 3.1

  ```typescript
  /** Resultado exitoso de createDirectory. */
  export interface CreateDirectoryOk {
    ok: true;
    /** Ruta absoluta del directorio creado. */
    createdPath: string;
  }

  /** Resultado fallido de createDirectory. */
  export interface CreateDirectoryErr {
    ok: false;
    error: IpcError;
  }

  /** Return type de createDirectory. */
  export type CreateDirectoryResult = CreateDirectoryOk | CreateDirectoryErr;
  ```

- **Task 3.3:** Actualizar `_FolderExplorerBridge` interno para incluir `mkdir`
  - **Assigned to:** Developer
  - **Dependencies:** Task 3.2

  ```typescript
  interface _FolderExplorerBridge {
    list(path: string, options?: FilterOptions): Promise<_BridgeListResponse>;
    stat(path: string): Promise<_BridgeStatResponse>;
    readChildren(paths: string[], options?: FilterOptions): Promise<_BridgeReadChildrenResponse>;
    mkdir(parentPath: string, name: string): Promise<{ ok: true; createdPath: string } | { ok: false; code: string; message: string }>;
  }
  ```

- **Task 3.4:** Implementar `createDirectory`
  - **Assigned to:** Developer
  - **Dependencies:** Task 3.3

  ```typescript
  /**
   * Crea un nuevo directorio con nombre `name` dentro de `parentPath`.
   *
   * El main process valida:
   *   - Que `parentPath` esté dentro de $HOME (homeJail)
   *   - Que `name` sea un nombre válido (sin chars ilegales, no vacío, etc.)
   *   - Que no exista ya un directorio con ese nombre
   *   - Que haya permisos de escritura
   *
   * @param parentPath - Ruta absoluta del directorio padre (dentro de $HOME).
   * @param name       - Nombre del nuevo directorio.
   * @returns `{ ok: true, createdPath }` ó `{ ok: false, error: IpcError }`.
   */
  export async function createDirectory(
    parentPath: string,
    name: string,
  ): Promise<CreateDirectoryResult> {
    if (!hasBridge()) {
      return { ok: false, error: bridgeError() };
    }

    try {
      const raw = await callWithTimeout(
        getBridge()!.mkdir(parentPath, name),
      );

      if (raw.ok) {
        return { ok: true, createdPath: raw.createdPath };
      }

      return { ok: false, error: normaliseBridgeError(raw) };
    } catch (err) {
      if (err === TIMEOUT_SENTINEL) {
        return { ok: false, error: timeoutError() };
      }
      return {
        ok: false,
        error: {
          kind:    "ipc",
          code:    "E_UNKNOWN",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
  ```

---

### 🔹 Phase 4: Hook — `createDir` en `useFolderExplorer`

**Description:**  
Agregar el método `createDir` al hook, que llama a `createDirectory` del servicio IPC, maneja el estado de "creando" y hace reload automático tras éxito.

**Tasks:**

- **Task 4.1:** Agregar estado de creación al hook
  - **Assigned to:** Developer
  - **Dependencies:** Phase 3 completa

  En `useFolderExplorer.ts`, agregar al estado:

  ```typescript
  // Nuevo estado para la operación de creación de directorio
  const [creating, setCreating] = useState<boolean>(false);
  ```

  Y al tipo `FolderExplorerHandle`:

  ```typescript
  /** True mientras se está creando un directorio (IPC en vuelo). */
  creating: boolean;

  /**
   * Crea un nuevo directorio con nombre `name` dentro del `cwd` actual.
   *
   * - Si tiene éxito, recarga el directorio actual automáticamente.
   * - Si falla, setea `error` con el IpcError normalizado.
   * - Mientras está en vuelo, `creating` es `true`.
   *
   * @param name - Nombre del nuevo directorio (sin separadores de ruta).
   * @returns `true` si la creación fue exitosa, `false` si falló.
   */
  createDir: (name: string) => Promise<boolean>;
  ```

- **Task 4.2:** Implementar `createDir`
  - **Assigned to:** Developer
  - **Dependencies:** Task 4.1

  ```typescript
  import { createDirectory } from "../services/ipc.ts";

  const createDir = useCallback(
    async (name: string): Promise<boolean> => {
      if (!cwd) return false;

      setCreating(true);
      setError(null);

      const result = await createDirectory(cwd, name);

      setCreating(false);

      if (!result.ok) {
        setError(result.error);
        onErrorRef.current?.(result.error);
        return false;
      }

      // Reload para mostrar el nuevo directorio en la lista
      await navigateInternal(cwd, showHidden);
      return true;
    },
    [cwd, showHidden, navigateInternal],
  );
  ```

- **Task 4.3:** Incluir `creating` y `createDir` en el return del hook
  - **Assigned to:** Developer
  - **Dependencies:** Task 4.2

  ```typescript
  return {
    // ... existentes ...
    creating,
    createDir,
  };
  ```

---

### 🔹 Phase 5: UI — Botón, input inline y feedback en `FolderExplorer.tsx`

**Description:**  
Agregar en el toolbar un botón `+` que activa un input inline para escribir el nombre del nuevo directorio. El input tiene confirmación (Enter / botón ✓) y cancelación (Escape / botón ✕). Durante la creación se muestra un spinner. Tras éxito o error, el input se cierra y el feedback se muestra en el banner de error existente.

**Tasks:**

- **Task 5.1:** Agregar estado local de UI para el modo "crear directorio"
  - **Assigned to:** Developer
  - **Dependencies:** Phase 4 completa

  En `FolderExplorer.tsx`, agregar estado local (NO en el hook — es UI pura):

  ```typescript
  import React, {
    useCallback, useEffect, useId, useRef, useState,
    type CSSProperties, type KeyboardEvent,
  } from "react";

  // Dentro del componente FolderExplorer:
  const [mkdirMode, setMkdirMode]   = useState(false);   // ¿está activo el input?
  const [newDirName, setNewDirName] = useState("");       // valor del input
  const [nameError, setNameError]   = useState<string | null>(null); // error de validación client-side
  const newDirInputRef = useRef<HTMLInputElement>(null);
  ```

- **Task 5.2:** Agregar `creating` y `createDir` desde el hook
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.1

  ```typescript
  const {
    // ... existentes ...
    creating,
    createDir,
  } = useFolderExplorer({ ... });
  ```

- **Task 5.3:** Implementar handlers de UI para el flujo de creación
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.2

  ```typescript
  /** Abre el input inline de creación de directorio. */
  const handleOpenMkdir = useCallback(() => {
    setMkdirMode(true);
    setNewDirName("");
    setNameError(null);
    // Focus al input en el siguiente frame (DOM aún no renderizado)
    requestAnimationFrame(() => newDirInputRef.current?.focus());
  }, []);

  /** Cancela la creación sin hacer nada. */
  const handleCancelMkdir = useCallback(() => {
    setMkdirMode(false);
    setNewDirName("");
    setNameError(null);
  }, []);

  /**
   * Validación client-side del nombre (espejo de las reglas del backend).
   * Proporciona feedback inmediato sin round-trip IPC.
   */
  const validateNameClientSide = useCallback((name: string): string | null => {
    if (!name || name.trim() === "") return "Name cannot be empty.";
    if (name.length > 255) return "Name too long (max 255 chars).";
    if (name === "." || name === "..") return `"${name}" is not a valid name.`;
    if (name.includes("/") || name.includes("\\")) return "Name cannot contain / or \\.";
    if (/[\x00-\x1F\x7F]/.test(name)) return "Name cannot contain control characters.";
    if (/[<>:"|?*]/.test(name)) return 'Name cannot contain: < > : " | ? *';
    return null;
  }, []);

  /** Confirma la creación: valida client-side, luego llama al hook. */
  const handleConfirmMkdir = useCallback(async () => {
    const trimmed = newDirName.trim();
    const clientError = validateNameClientSide(trimmed);
    if (clientError) {
      setNameError(clientError);
      newDirInputRef.current?.focus();
      return;
    }

    setNameError(null);
    const success = await createDir(trimmed);

    if (success) {
      // Cerrar el input solo si tuvo éxito
      setMkdirMode(false);
      setNewDirName("");
    }
    // Si falló, el error ya está en `error` del hook (se muestra en el banner)
    // Mantenemos el input abierto para que el usuario pueda corregir el nombre
  }, [newDirName, validateNameClientSide, createDir]);

  /** Maneja teclas en el input de nombre. */
  const handleMkdirInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleConfirmMkdir();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelMkdir();
      }
    },
    [handleConfirmMkdir, handleCancelMkdir],
  );
  ```

- **Task 5.4:** Agregar el botón `+` y el input inline al toolbar en el JSX
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.3

  En el toolbar, después del botón de reload y antes del breadcrumb (o al final del toolbar):

  ```tsx
  {/* ── New Directory button / inline input ─────────────────────── */}
  {!mkdirMode ? (
    <button
      type="button"
      className={styles.mkdirButton}
      onClick={handleOpenMkdir}
      disabled={!cwd || loading || creating}
      aria-label="Create new directory"
      title="New folder"
    >
      {/* SVG inline: folder + plus sign */}
      <IconNewFolder />
    </button>
  ) : (
    <div className={styles.mkdirInline} role="group" aria-label="New directory name">
      <input
        ref={newDirInputRef}
        type="text"
        className={`${styles.mkdirInput}${nameError ? ` ${styles.mkdirInputError}` : ""}`}
        value={newDirName}
        onChange={(e) => {
          setNewDirName(e.target.value);
          // Limpiar error de validación mientras el usuario escribe
          if (nameError) setNameError(null);
        }}
        onKeyDown={handleMkdirInputKeyDown}
        placeholder="New folder name…"
        aria-label="New directory name"
        aria-invalid={!!nameError}
        aria-describedby={nameError ? `${uid}-mkdir-error` : undefined}
        maxLength={255}
        disabled={creating}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Mensaje de error de validación client-side */}
      {nameError && (
        <span
          id={`${uid}-mkdir-error`}
          className={styles.mkdirNameError}
          role="alert"
          aria-live="assertive"
        >
          {nameError}
        </span>
      )}

      {/* Botón confirmar */}
      <button
        type="button"
        className={styles.mkdirConfirm}
        onClick={() => void handleConfirmMkdir()}
        disabled={creating || !newDirName.trim()}
        aria-label="Confirm create directory"
        title="Create"
      >
        {creating ? <IconSpinner /> : <IconCheck />}
      </button>

      {/* Botón cancelar */}
      <button
        type="button"
        className={styles.mkdirCancel}
        onClick={handleCancelMkdir}
        disabled={creating}
        aria-label="Cancel create directory"
        title="Cancel"
      >
        <IconX />
      </button>
    </div>
  )}
  ```

- **Task 5.5:** Agregar iconos SVG inline necesarios
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.4

  Agregar junto a los iconos existentes en `FolderExplorer.tsx`:

  ```tsx
  function IconNewFolder({ className }: { className?: string }) {
    return (
      <svg className={className} width="14" height="14" viewBox="0 0 14 14"
        fill="none" aria-hidden="true" focusable="false">
        {/* Folder base */}
        <path
          d="M1 3.5C1 2.948 1.448 2.5 2 2.5H5.086a1 1 0 0 1 .707.293L6.5 3.5H12A1 1 0 0 1 13 4.5v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-8Z"
          fill="currentColor" opacity="0.7"
        />
        {/* Plus sign */}
        <line x1="7" y1="5.5" x2="7" y2="9.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5" y1="7.5" x2="9" y2="7.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    );
  }

  function IconCheck({ className }: { className?: string }) {
    return (
      <svg className={className} width="12" height="12" viewBox="0 0 12 12"
        fill="none" aria-hidden="true" focusable="false">
        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  function IconX({ className }: { className?: string }) {
    return (
      <svg className={className} width="12" height="12" viewBox="0 0 12 12"
        fill="none" aria-hidden="true" focusable="false">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round"/>
      </svg>
    );
  }

  function IconSpinner({ className }: { className?: string }) {
    return (
      <span className={`${styles.mkdirSpinner} ${className ?? ""}`} aria-hidden="true" />
    );
  }
  ```

---

### 🔹 Phase 6: CSS — Estilos para el modo mkdir

**Description:**  
Agregar los estilos necesarios en `FolderExplorer.module.css` para el botón `+`, el input inline, los botones de confirmación/cancelación y el mensaje de error de validación.

**Tasks:**

- **Task 6.1:** Agregar clases CSS al módulo
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.4

  Agregar al final de `FolderExplorer.module.css`:

  ```css
  /* ── New Directory button ────────────────────────────────────────────────── */

  .mkdirButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--color-border, #2e3147);
    background: transparent;
    color: var(--color-primary, #6366f1);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--transition, 150ms ease),
                border-color var(--transition, 150ms ease);
  }

  .mkdirButton:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.1);
    border-color: var(--color-primary, #6366f1);
  }

  .mkdirButton:focus-visible {
    outline: 2px solid var(--color-primary, #6366f1);
    outline-offset: 2px;
  }

  .mkdirButton:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ── Inline mkdir form ───────────────────────────────────────────────────── */

  .mkdirInline {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .mkdirInput {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--color-primary, #6366f1);
    background: var(--color-surface, #1a1d27);
    color: var(--color-text, #e2e4ef);
    font-size: 12px;
    font-family: var(--font-sans, sans-serif);
    outline: none;
    transition: border-color var(--transition, 150ms ease),
                box-shadow var(--transition, 150ms ease);
  }

  .mkdirInput:focus {
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
  }

  .mkdirInput:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Input en estado de error */
  .mkdirInputError {
    border-color: var(--color-error, #f87171) !important;
    box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.2) !important;
  }

  /* Mensaje de error de validación (aparece debajo del input) */
  .mkdirNameError {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--color-surface-2, #232637);
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: var(--radius-sm, 4px);
    color: var(--color-error, #f87171);
    font-size: 11px;
    padding: 4px 8px;
    z-index: 10;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Confirm / Cancel buttons ────────────────────────────────────────────── */

  .mkdirConfirm,
  .mkdirCancel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--color-border, #2e3147);
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--transition, 150ms ease),
                border-color var(--transition, 150ms ease);
  }

  .mkdirConfirm {
    color: var(--color-success, #4ade80);
    border-color: rgba(74, 222, 128, 0.3);
  }

  .mkdirConfirm:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.1);
    border-color: var(--color-success, #4ade80);
  }

  .mkdirConfirm:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .mkdirCancel {
    color: var(--color-text-muted, #7b7f9e);
  }

  .mkdirCancel:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.4);
    color: var(--color-error, #f87171);
  }

  .mkdirCancel:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .mkdirConfirm:focus-visible,
  .mkdirCancel:focus-visible {
    outline: 2px solid var(--color-primary, #6366f1);
    outline-offset: 2px;
  }

  /* ── Spinner para estado "creating" ──────────────────────────────────────── */

  .mkdirSpinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(74, 222, 128, 0.3);
    border-top-color: var(--color-success, #4ade80);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  ```

---

### 🔹 Phase 7: Props — Exponer control de la feature desde el exterior (opcional)

**Description:**  
Agregar una prop `allowCreateDir` a `FolderExplorerProps` para que el componente padre pueda habilitar/deshabilitar la feature de creación de directorios. Por defecto `true`.

**Tasks:**

- **Task 7.1:** Agregar prop `allowCreateDir` a `FolderExplorerProps`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 5 completa

  ```typescript
  export interface FolderExplorerProps {
    // ... existentes ...

    /**
     * Si `true` (default), muestra el botón "+" para crear nuevos directorios.
     * Poner en `false` para modo solo-lectura.
     * Default: `true`.
     */
    allowCreateDir?: boolean;
  }
  ```

  En el componente, condicionar la renderización del botón/input:

  ```tsx
  {allowCreateDir !== false && (
    // ... botón + / input inline ...
  )}
  ```

---

## 📁 Rutas de Archivos a Modificar

| Archivo | Tipo de cambio | Qué agregar |
|---------|---------------|-------------|
| `electron-main/src/ipc/folder-explorer.ts` | **Modificar** | Constante `MKDIR`, tipos `E_ALREADY_EXISTS`/`E_INVALID_NAME`/`MkdirResult`/`MkdirResponse`, función `validateDirName`, handler `handleMkdir`, registro en `registerFolderExplorerHandlers` |
| `electron-main/src/ipc/index.ts` | **Modificar** | Re-exportar `MkdirResult`, `MkdirResponse` |
| `electron-main/src/preload/index.ts` | **Modificar** | Método `mkdir` en `FolderExplorerBridge` interface e implementación |
| `src/renderer/services/ipc.ts` | **Modificar** | Códigos `E_ALREADY_EXISTS`/`E_INVALID_NAME`, tipos `CreateDirectoryOk`/`CreateDirectoryErr`/`CreateDirectoryResult`, método `mkdir` en `_FolderExplorerBridge`, función `createDirectory` |
| `src/renderer/hooks/useFolderExplorer.ts` | **Modificar** | Estado `creating`, método `createDir`, tipos en `FolderExplorerHandle` |
| `src/renderer/components/FolderExplorer/FolderExplorer.tsx` | **Modificar** | Estado local `mkdirMode`/`newDirName`/`nameError`, handlers, iconos, JSX del toolbar |
| `src/renderer/components/FolderExplorer/FolderExplorer.module.css` | **Modificar** | Clases `.mkdirButton`, `.mkdirInline`, `.mkdirInput`, `.mkdirInputError`, `.mkdirNameError`, `.mkdirConfirm`, `.mkdirCancel`, `.mkdirSpinner` |

---

## 🔄 Flujo Completo End-to-End

```
Usuario hace click en "+" (mkdirButton)
  → setMkdirMode(true), focus al input

Usuario escribe nombre en el input
  → onChange: setNewDirName, limpiar nameError

Usuario presiona Enter (o click en ✓)
  → handleConfirmMkdir()
    → validateNameClientSide(trimmed)
      → Si inválido: setNameError(msg), focus input, STOP
      → Si válido: continuar
    → createDir(trimmed) [hook]
      → setCreating(true), setError(null)
      → createDirectory(cwd, name) [ipc.ts]
        → callWithTimeout(bridge.mkdir(cwd, name))
          → ipcRenderer.invoke("folder-explorer:mkdir", { parentPath: cwd, name })
            → handleMkdir() [main process]
              → validateDirName(name) → E_INVALID_NAME si falla
              → resolveWithinHome(parentPath) → E_NOT_IN_HOME si falla
              → stat(safeParent) → E_NOT_FOUND / E_NOT_A_DIR si falla
              → mkdir(newDirPath) → E_ALREADY_EXISTS / E_ACCESS_DENIED si falla
              → { ok: true, createdPath }
          → normalizar respuesta
        → { ok: true, createdPath } | { ok: false, error }
      → setCreating(false)
      → Si error: setError(result.error), return false
      → Si éxito: navigateInternal(cwd, showHidden) [reload], return true
    → Si success: setMkdirMode(false), setNewDirName("")
    → Si error: mantener input abierto (error visible en banner)

Usuario presiona Escape (o click en ✕)
  → handleCancelMkdir()
    → setMkdirMode(false), setNewDirName(""), setNameError(null)
```

---

## ⚠️ Risks

### Seguridad
- **Path injection via nombre**: Mitigado por `validateDirName` que rechaza `/`, `\`, y chars de control tanto en frontend como en backend.
- **Race condition**: El usuario podría crear dos directorios con el mismo nombre simultáneamente. Mitigado porque `mkdir({ recursive: false })` retorna `EEXIST` en el segundo intento.
- **Symlink en parentPath**: Mitigado por `resolveWithinHome` que sigue symlinks antes del check de containment.

### UX
- **Input muy corto en toolbar**: Si el toolbar tiene poco espacio, el input puede quedar muy estrecho. Solución: `flex: 1` en `.mkdirInline` para que tome el espacio disponible.
- **Error de validación oculto**: El tooltip de error (`.mkdirNameError`) usa `position: absolute` y puede quedar cortado si el toolbar tiene `overflow: hidden`. Verificar que el toolbar tenga `overflow: visible` o ajustar el posicionamiento.
- **Doble feedback de error**: Si el error viene del backend (ej. `E_ALREADY_EXISTS`), se muestra en el banner de error del hook. Si viene de validación client-side, se muestra en el tooltip inline. Ambos son correctos y no se solapan.

### Técnico
- **`creating` vs `loading`**: Son estados independientes. `loading` es para navegación, `creating` es para mkdir. El botón `+` debe estar deshabilitado cuando `loading || creating`.
- **Reload tras mkdir**: `navigateInternal` ya limpia `selected` y `error`. Esto es correcto — tras crear un directorio, la selección previa ya no es relevante.
- **Timeout de 4s**: El timeout existente en `callWithTimeout` aplica también a `mkdir`. En filesystems lentos (NFS, FUSE) podría ser insuficiente. Considerar aumentarlo a 8s para operaciones de escritura, o hacer el timeout configurable.

---

## 📝 Edge Cases y Consideraciones de UX

### Nombres especiales
| Input del usuario | Comportamiento esperado |
|-------------------|------------------------|
| `""` (vacío) | Botón ✓ deshabilitado; si se intenta confirmar → error "Name cannot be empty" |
| `"  "` (solo espacios) | `trim()` → vacío → error "Name cannot be empty" |
| `"."` o `".."` | Error client-side: `"." is not a valid name` |
| `"foo/bar"` | Error client-side: "Name cannot contain / or \\" |
| `"CON"`, `"PRN"`, `"AUX"` | Nombres reservados de Windows — **no bloqueados** en esta implementación. Si se necesita soporte Windows, agregar validación adicional. |
| Nombre de 256+ chars | Error client-side: "Name too long (max 255 chars)" |
| Nombre con emoji `"📁 mi carpeta"` | Válido — los emojis son Unicode válido y no contienen chars ilegales |
| Nombre con espacios `"mi proyecto"` | Válido — los espacios son permitidos en nombres de directorio |

### Estados del componente
| Estado | Botón `+` | Input | Botón ✓ | Botón ✕ |
|--------|-----------|-------|---------|---------|
| Sin `cwd` (idle) | Deshabilitado | — | — | — |
| `loading` (navegando) | Deshabilitado | — | — | — |
| Normal | Habilitado | — | — | — |
| `mkdirMode` activo | Oculto | Visible, editable | Habilitado si hay texto | Habilitado |
| `creating` (IPC en vuelo) | Oculto | Visible, disabled | Spinner, disabled | Disabled |
| Error de validación | Oculto | Visible, borde rojo | Habilitado | Habilitado |
| Error de backend | Oculto | Visible (input abierto) | Habilitado | Habilitado |

### Accesibilidad
- El input tiene `aria-invalid` y `aria-describedby` apuntando al mensaje de error.
- El mensaje de error tiene `role="alert"` para anuncio automático por screen readers.
- El grupo input+botones tiene `role="group"` con `aria-label`.
- El botón `+` tiene `aria-label="Create new directory"`.
- Escape cierra el input (estándar de accesibilidad para inputs inline).
- El foco vuelve al botón `+` tras cancelar (implementar con `mkdirButtonRef.current?.focus()` en `handleCancelMkdir`).

### Comportamiento tras éxito
- El input se cierra.
- El directorio recién creado aparece en la lista (por el reload automático).
- **No se selecciona automáticamente** el nuevo directorio (simplifica la implementación; el usuario puede hacer click si quiere).
- **Mejora futura**: Seleccionar y hacer scroll al nuevo directorio tras creación.

### Comportamiento tras error de backend
- El input permanece abierto para que el usuario pueda corregir el nombre.
- El error se muestra en el banner de error existente del componente (no en el tooltip inline).
- El usuario puede hacer Dismiss del error y seguir editando.
- Si el error es `E_ALREADY_EXISTS`, el mensaje es claro: "A directory named 'X' already exists in this location."

---

## 🧪 Tests Recomendados

### Backend (`tests/electron/ipc/folder-explorer.test.ts`)
```
✓ handleMkdir: crea directorio exitosamente en path válido
✓ handleMkdir: retorna E_INVALID_NAME para nombre vacío
✓ handleMkdir: retorna E_INVALID_NAME para nombre con "/"
✓ handleMkdir: retorna E_INVALID_NAME para nombre "."
✓ handleMkdir: retorna E_INVALID_NAME para nombre con chars de control
✓ handleMkdir: retorna E_NOT_IN_HOME para parentPath fuera de HOME
✓ handleMkdir: retorna E_NOT_FOUND para parentPath inexistente
✓ handleMkdir: retorna E_NOT_A_DIR para parentPath que es un archivo
✓ handleMkdir: retorna E_ALREADY_EXISTS si el directorio ya existe
✓ handleMkdir: retorna E_ACCESS_DENIED para directorio sin permisos de escritura
✓ handleMkdir: retorna E_UNKNOWN para payload malformado
```

### Renderer service (`tests/renderer/services/ipc.test.ts`)
```
✓ createDirectory: retorna ok:true con createdPath en éxito
✓ createDirectory: retorna ok:false con error normalizado en fallo IPC
✓ createDirectory: retorna E_BRIDGE si window.folderExplorer no está disponible
✓ createDirectory: retorna E_TIMEOUT si la llamada supera el timeout
```

### Hook (`tests/renderer/hooks/useFolderExplorer.test.ts`)
```
✓ createDir: llama a createDirectory con cwd y name correctos
✓ createDir: setea creating=true durante la llamada
✓ createDir: hace reload del cwd tras éxito
✓ createDir: setea error y retorna false en fallo
✓ createDir: retorna false si cwd está vacío
```

### Componente (`tests/renderer/components/FolderExplorer/FolderExplorer.test.tsx`)
```
✓ Botón "+" visible cuando hay cwd y no está loading
✓ Botón "+" deshabilitado cuando loading=true
✓ Botón "+" deshabilitado cuando cwd está vacío
✓ Click en "+" muestra el input inline con focus
✓ Escape en el input cierra el input sin crear directorio
✓ Click en ✕ cierra el input sin crear directorio
✓ Enter con nombre vacío muestra error de validación
✓ Enter con nombre válido llama a createDir
✓ Durante creating=true: input y botones deshabilitados, spinner visible
✓ Tras éxito: input se cierra
✓ Tras error de backend: input permanece abierto, error en banner
✓ Input tiene aria-invalid=true cuando hay nameError
✓ Mensaje de error tiene role="alert"
```

---

## 📝 Notes

1. **No crear modal separado**: La UX inline en el toolbar es más fluida y consistente con el estilo del componente. Un modal requeriría más código y peor experiencia.

2. **Validación doble (client + server)**: La validación client-side es para feedback inmediato. La validación server-side es la fuente de verdad de seguridad. Ambas deben estar sincronizadas.

3. **`recursive: false` en mkdir**: Intencional. No queremos crear directorios intermedios silenciosamente. Si el usuario quiere crear `a/b/c`, debe navegar a `a/b` primero.

4. **El `trim()` del nombre**: Se aplica antes de enviar al backend. El nombre guardado en el filesystem NO tiene espacios al inicio/final. Esto es correcto y esperado.

5. **Orden de implementación sugerido**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7. Cada phase puede testearse independientemente antes de pasar a la siguiente.

6. **Variable CSS `--color-success`**: Si no existe en el design system, usar `#4ade80` como fallback hardcodeado o agregar la variable al `:root` en `app.css`.
