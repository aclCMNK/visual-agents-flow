# 🧠 Plan de Solución

## 🎯 Objetivo
Tras una validación exitosa de credenciales Git (username + token) mediante el canal `GIT_CLONE_VALIDATE`, guardar automáticamente `GIT_USERNAME` y `GIT_TOKEN` en un archivo `.env` en el directorio raíz del proyecto clonado, y garantizar que `.env` esté listado en `.gitignore`.

---

## 🧩 Contexto

### Stack y arquitectura relevante
- **Electron + React** (Vite). Todo acceso a filesystem ocurre en el **main process** (`src/electron/ipc-handlers.ts`).
- El canal de validación ya existe: `GIT_CLONE_VALIDATE` → `CloneValidateRequest` / `CloneValidateResult`.
- El canal de clonado ya existe: `GIT_CLONE` → `CloneRepositoryRequest` / `CloneRepositoryResult`.
- El flujo actual: el renderer llama a `validateCloneToken()` → si `valid: true` → llama a `cloneRepository()`.
- El directorio clonado se resuelve en el handler de `GIT_CLONE` como `join(destDir, repoName)` y se devuelve en `CloneRepositoryResult.clonedPath`.

### Archivos clave
| Archivo | Rol |
|---|---|
| `src/electron/ipc-handlers.ts` | Handlers IPC del main process — aquí vive toda la lógica de FS |
| `src/electron/bridge.types.ts` | Contratos IPC (tipos, interfaces, `IPC_CHANNELS`) |
| `src/electron/preload.ts` | Expone la API al renderer vía `contextBridge` |
| `src/ui/` (renderer) | Llama a `window.agentsFlow.*` — no toca FS directamente |

### Restricción de seguridad crítica
> El token **nunca** debe aparecer en logs, en `activeClones`, ni en ningún estado persistente fuera del `.env`. El `.env` debe tener permisos restrictivos (`0o600`).

---

## 🧭 Estrategia

**Enfoque elegido: nuevo canal IPC dedicado `GIT_SAVE_CREDENTIALS`**

- Se crea una función pura `saveGitCredentialsToEnv(projectDir, username, token)` en el main process.
- Se registra un nuevo handler IPC `GIT_SAVE_CREDENTIALS` que llama a esa función.
- El renderer lo invoca automáticamente **después** de que `GIT_CLONE` retorna `success: true` con `clonedPath`.
- La función también garantiza que `.gitignore` contenga `.env`.

**¿Por qué no hacerlo dentro del handler `GIT_CLONE`?**
- Separación de responsabilidades: el clone no debe conocer las credenciales más allá de la URL efímera.
- El token ya fue borrado (`cloneUrl = ""`) antes del cierre del proceso hijo.
- Un canal dedicado permite reutilizar la lógica en otros flujos futuros (ej: re-autenticación sin re-clonar).

---

## 🚀 Fases

### 🔹 Phase 1: Tipos e interfaz IPC
**Description:**
Definir los tipos del nuevo canal en `bridge.types.ts` y registrar la constante en `IPC_CHANNELS`.

**Tasks:**

- **Task:** Agregar `GIT_SAVE_CREDENTIALS: "git:save-credentials"` a `IPC_CHANNELS`
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task:** Definir `SaveGitCredentialsRequest` y `SaveGitCredentialsResult` en `bridge.types.ts`
  - **Assigned to:** Developer
  - **Dependencies:** tarea anterior

```typescript
// bridge.types.ts

export interface SaveGitCredentialsRequest {
  /** Absolute path to the cloned project root */
  projectDir: string;
  /** GitHub username */
  username: string;
  /** GitHub Personal Access Token — NEVER log this value */
  token: string;
}

export interface SaveGitCredentialsResult {
  success: boolean;
  /** Absolute path to the written .env file (on success) */
  envPath?: string;
  /** Human-readable error message (on failure) */
  error?: string;
  /**
   * "IO_ERROR"     — filesystem write failed
   * "INVALID_DIR"  — projectDir does not exist or is not a directory
   * "EMPTY_CREDS"  — username or token is empty
   */
  errorCode?: "IO_ERROR" | "INVALID_DIR" | "EMPTY_CREDS";
}
```

- **Task:** Agregar `saveGitCredentials(req: SaveGitCredentialsRequest): Promise<SaveGitCredentialsResult>` a la interfaz `AgentsFlowBridge`
  - **Assigned to:** Developer
  - **Dependencies:** tipos definidos

---

### 🔹 Phase 2: Lógica pura de escritura (main process)
**Description:**
Implementar la función `saveGitCredentialsToEnv` como función pura y testeable, separada del handler IPC.

**Tasks:**

- **Task:** Implementar `saveGitCredentialsToEnv` en `ipc-handlers.ts` (o en un módulo auxiliar `git-credentials.ts`)
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1 completa

**Fragmento de implementación de referencia:**

```typescript
// Ubicación sugerida: src/electron/git-credentials.ts
// (o como función privada en ipc-handlers.ts si se prefiere no crear archivo nuevo)

import { writeFile, readFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SaveGitCredentialsResult } from "./bridge.types.ts";

/**
 * Writes GIT_USERNAME and GIT_TOKEN to <projectDir>/.env (overwrite).
 * Sets file permissions to 0o600 (owner read/write only).
 * Ensures .env is listed in <projectDir>/.gitignore.
 *
 * SECURITY:
 *   - token is NEVER logged — only its length is logged for diagnostics.
 *   - .env is written atomically via a temp file + rename pattern.
 *   - File permissions are set to 0o600 immediately after write.
 *   - On Windows, chmod is a no-op but the write still succeeds.
 *
 * Never throws. Always resolves with SaveGitCredentialsResult.
 */
export async function saveGitCredentialsToEnv(
  projectDir: string,
  username: string,
  token: string,
): Promise<SaveGitCredentialsResult> {
  // ── Guard: empty credentials ──────────────────────────────────────────
  if (!username.trim() || !token.trim()) {
    return { success: false, errorCode: "EMPTY_CREDS", error: "Username and token must not be empty." };
  }

  // ── Guard: projectDir must exist and be a directory ───────────────────
  if (!existsSync(projectDir)) {
    return { success: false, errorCode: "INVALID_DIR", error: `Project directory does not exist: ${projectDir}` };
  }

  const envPath = join(projectDir, ".env");
  const gitignorePath = join(projectDir, ".gitignore");

  try {
    // ── 1. Write .env (overwrite) ─────────────────────────────────────
    // Content: exactly two lines, no trailing spaces, LF line endings.
    const envContent = `GIT_USERNAME=${username}\nGIT_TOKEN=${token}\n`;
    await writeFile(envPath, envContent, { encoding: "utf-8", flag: "w" });

    // ── 2. Restrict permissions (Unix: owner r/w only) ────────────────
    // On Windows this is a no-op — acceptable trade-off.
    try {
      await chmod(envPath, 0o600);
    } catch {
      // Non-fatal on Windows or restricted environments
    }

    // ── 3. Ensure .env is in .gitignore ───────────────────────────────
    await ensureEnvInGitignore(gitignorePath);

    console.log(
      `[git-credentials] .env written → ${envPath} (token length: ${token.length})`,
    );
    return { success: true, envPath };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[git-credentials] Failed to write .env —", message);
    return { success: false, errorCode: "IO_ERROR", error: message };
  }
}

/**
 * Ensures that ".env" appears as its own line in the .gitignore file.
 * Creates .gitignore if it does not exist.
 * Appends the line if it is missing.
 * Never throws — errors are swallowed (non-fatal).
 */
async function ensureEnvInGitignore(gitignorePath: string): Promise<void> {
  try {
    let content = "";

    if (existsSync(gitignorePath)) {
      content = await readFile(gitignorePath, "utf-8");
    }

    // Check if .env is already listed (exact line match, trimmed)
    const lines = content.split(/\r?\n/);
    const alreadyListed = lines.some((line) => line.trim() === ".env");

    if (!alreadyListed) {
      // Append with a leading newline if file doesn't end with one
      const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      await writeFile(gitignorePath, `${content}${separator}.env\n`, {
        encoding: "utf-8",
        flag: "w",
      });
      console.log(`[git-credentials] .env added to .gitignore → ${gitignorePath}`);
    } else {
      console.log(`[git-credentials] .env already in .gitignore — skipped`);
    }
  } catch (err) {
    // Non-fatal: .gitignore update failure should not block credential save
    console.warn(
      "[git-credentials] Could not update .gitignore —",
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

---

### 🔹 Phase 3: Registro del handler IPC
**Description:**
Registrar el nuevo canal `GIT_SAVE_CREDENTIALS` en `registerIpcHandlers()` dentro de `ipc-handlers.ts`.

**Tasks:**

- **Task:** Agregar el handler `GIT_SAVE_CREDENTIALS` en `registerIpcHandlers()`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 2 completa

**Fragmento de referencia:**

```typescript
// En registerIpcHandlers(), al final del bloque de handlers Git:

ipcMain.handle(
  IPC_CHANNELS.GIT_SAVE_CREDENTIALS,
  async (
    _event,
    req: SaveGitCredentialsRequest,
  ): Promise<SaveGitCredentialsResult> => {
    // SECURITY: Do NOT log req.token
    console.log(
      `[ipc] GIT_SAVE_CREDENTIALS: projectDir → ${req.projectDir} username → ${req.username}`,
    );

    const result = await saveGitCredentialsToEnv(
      req.projectDir,
      req.username,
      req.token,
    );

    if (!result.success) {
      console.error(
        "[ipc] GIT_SAVE_CREDENTIALS: failed —",
        result.errorCode,
        result.error,
      );
    }
    return result;
  },
);
```

> ⚠️ **Importante:** agregar también `ipcMain.removeHandler(IPC_CHANNELS.GIT_SAVE_CREDENTIALS)` en el bloque de limpieza al inicio de `registerIpcHandlers()` (idempotency guard).

---

### 🔹 Phase 4: Exposición en preload
**Description:**
Exponer `saveGitCredentials` en el `contextBridge` del preload para que el renderer pueda invocarlo.

**Tasks:**

- **Task:** Agregar `saveGitCredentials` en `preload.ts`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 3 completa

**Fragmento de referencia:**

```typescript
// En src/electron/preload.ts, dentro del objeto expuesto por contextBridge:

saveGitCredentials: (req: SaveGitCredentialsRequest) =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SAVE_CREDENTIALS, req),
```

---

### 🔹 Phase 5: Invocación automática desde el renderer
**Description:**
Modificar el flujo del renderer para que, tras un clone exitoso (`clonedPath` disponible), invoque automáticamente `saveGitCredentials` sin pedir confirmación al usuario.

**Tasks:**

- **Task:** Localizar el punto de invocación post-clone en el renderer (hook o componente que maneja `cloneRepository`)
  - **Assigned to:** Developer
  - **Dependencies:** Phase 4 completa

- **Task:** Agregar llamada automática a `saveGitCredentials` tras `cloneRepository` exitoso
  - **Assigned to:** Developer
  - **Dependencies:** tarea anterior

**Lógica de referencia (pseudocódigo del renderer):**

```typescript
// Después de que cloneRepository() retorna success: true

const cloneResult = await window.agentsFlow.cloneRepository(cloneReq);

if (cloneResult.success && cloneResult.clonedPath) {
  // Guardar credenciales automáticamente — sin confirmación al usuario
  // Las credenciales (username, token) deben estar disponibles en el estado
  // del componente/hook desde la validación previa (GIT_CLONE_VALIDATE).
  const saveResult = await window.agentsFlow.saveGitCredentials({
    projectDir: cloneResult.clonedPath,
    username: credentials.username,   // del estado local del formulario
    token: credentials.token,         // del estado local del formulario
  });

  if (!saveResult.success) {
    // No bloquear el flujo — el clone fue exitoso.
    // Loguear el error silenciosamente o mostrar un aviso no-bloqueante.
    console.warn("[clone-flow] Could not save credentials to .env:", saveResult.error);
  }

  // Continuar con el flujo normal (abrir proyecto, etc.)
}
```

> ⚠️ **Edge case crítico:** las credenciales (`username`, `token`) deben estar disponibles en el estado del componente en el momento de la llamada. Si el estado fue limpiado antes del clone (por ejemplo, al cerrar el modal), la llamada fallará con `EMPTY_CREDS`. El developer debe asegurarse de que el estado de credenciales persista hasta después de que `saveGitCredentials` retorne.

---

## ⚠️ Riesgos

### Seguridad
- **Token en memoria del renderer:** el token vive en el estado React entre la validación y el clone. Minimizar el tiempo de vida limpiando el estado inmediatamente después de que `saveGitCredentials` retorne.
- **Permisos del .env en Windows:** `chmod(0o600)` es no-op en Windows. El archivo queda con permisos del sistema de archivos NTFS. Documentar esta limitación.
- **Sobreescritura silenciosa:** el `.env` se sobreescribe sin backup. Si el usuario tenía variables adicionales en `.env`, se perderán. **Decisión de diseño:** el requerimiento especifica "solo GIT_USERNAME y GIT_TOKEN". Si en el futuro se necesita preservar otras variables, se deberá cambiar la estrategia a merge en lugar de overwrite.
- **Logs:** el handler IPC no debe loguear `req.token` bajo ninguna circunstancia. Solo loguear `username` y la longitud del token.

### Errores y edge cases
- **`clonedPath` vacío o undefined:** si `CloneRepositoryResult.clonedPath` es undefined (no debería ocurrir en `success: true`, pero defensivamente), la llamada a `saveGitCredentials` debe ser guardada con un check previo.
- **Directorio clonado eliminado entre clone y save:** improbable pero posible. El handler retornará `INVALID_DIR`. No bloquear el flujo del usuario.
- **`.gitignore` con encoding no-UTF8:** `readFile` con `utf-8` puede fallar. El bloque `try/catch` en `ensureEnvInGitignore` absorbe este error silenciosamente.
- **Concurrencia:** si el usuario lanza dos clones simultáneos (permitido hasta `MAX_CONCURRENT_CLONES = 3`), cada uno llamará a `saveGitCredentials` con su propio `clonedPath`. No hay condición de carrera porque cada `.env` está en un directorio diferente.
- **`.env` ya existe con contenido diferente:** se sobreescribe completamente. Comportamiento esperado según el requerimiento.

---

## 📝 Notas

### Rutas de archivos afectados
| Archivo | Cambio |
|---|---|
| `src/electron/bridge.types.ts` | Agregar `GIT_SAVE_CREDENTIALS` a `IPC_CHANNELS`, tipos `SaveGitCredentialsRequest`, `SaveGitCredentialsResult`, método en `AgentsFlowBridge` |
| `src/electron/ipc-handlers.ts` | Agregar handler `GIT_SAVE_CREDENTIALS` en `registerIpcHandlers()` + función `saveGitCredentialsToEnv` (o importarla) |
| `src/electron/preload.ts` | Exponer `saveGitCredentials` en `contextBridge` |
| `src/electron/git-credentials.ts` | **Nuevo archivo opcional** — función pura `saveGitCredentialsToEnv` + `ensureEnvInGitignore` (si se prefiere separar del handler) |
| `src/ui/` (componente/hook del clone modal) | Agregar llamada automática post-clone |

### Formato del .env generado
```
GIT_USERNAME=octocat
GIT_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```
- Exactamente 2 líneas.
- Sin espacios alrededor del `=`.
- Terminado en `\n` (LF).
- Encoding UTF-8.

### Formato del .gitignore
- Si no existe: se crea con contenido `.env\n`.
- Si existe y ya contiene `.env` (línea exacta, trimmed): no se modifica.
- Si existe y no contiene `.env`: se agrega al final con separador de línea correcto.

### Convención de logging (seguridad)
```typescript
// ✅ Correcto
console.log(`[git-credentials] .env written → ${envPath} (token length: ${token.length})`);

// ❌ Nunca hacer esto
console.log(`[git-credentials] token: ${token}`);
console.log(`[ipc] GIT_SAVE_CREDENTIALS: token → ${req.token}`);
```

### Módulo auxiliar vs. inline
- Si el equipo prefiere mantener todo en `ipc-handlers.ts` (patrón actual del proyecto), la función `saveGitCredentialsToEnv` puede vivir como función privada en ese archivo.
- Si se prefiere testabilidad independiente (recomendado), crear `src/electron/git-credentials.ts` siguiendo el patrón de `git-detector.ts` (módulo puro, sin dependencias de Electron).
