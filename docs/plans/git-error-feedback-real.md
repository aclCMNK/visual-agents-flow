# 🧠 Plan de Solución: Git Real Error Feedback en UI

## 🎯 Objective

Mostrar el mensaje de error real de git (`stderr`) en el banner de error de la UI cuando cualquier operación git falla (commit, pull, fetch, checkout, etc.), en lugar de un mensaje genérico. El mensaje genérico solo se muestra como fallback si no hay stderr disponible.

---

## 🧩 Context

### Estado actual del sistema

El sistema ya tiene una arquitectura sólida para manejo de errores git:

- **Backend (`git-changes.ts`, `git-branches.ts`)**: Captura `stderr` y `stdout` de cada operación git via `execFile`. La función `toGitError()` ya construye un `GitOperationError` con `rawOutput` (concatenación de stderr + stdout). Sin embargo, para el caso `E_UNKNOWN` (el más frecuente en fallos reales de commit/push/pull), el `message` se establece como un string genérico hardcodeado (ej: `"Failed to create commit."`), y el `rawOutput` queda solo como campo de debugging.

- **Tipos (`bridge.types.ts`)**: `GitOperationError` ya tiene el campo `rawOutput?: string`. El problema es que este campo no se usa en el frontend para mostrar al usuario.

- **Frontend (`useGitChanges.ts`, `useGitBranches.ts`)**: La función `mapGitErrorToMessage()` mapea `error.code` a strings hardcodeados. Para `E_UNKNOWN` usa `error.message || "An unexpected Git error occurred."`. Nunca usa `error.rawOutput`.

- **Componentes (`GitChangesPanel.tsx`, `GitBranchesPanel.tsx`)**: Muestran el string de error tal como viene del hook, sin acceso a `rawOutput`.

### Problema raíz

El campo `rawOutput` ya viaja por IPC pero **nunca se expone al usuario**. La solución es mínimamente invasiva: usar `rawOutput` (o el `stderr` real) como fuente primaria del mensaje de error en el frontend, con truncado inteligente.

### Archivos clave

| Archivo | Rol |
|---|---|
| `src/electron/git-changes.ts` | Backend: operaciones commit/status |
| `src/electron/git-branches.ts` | Backend: operaciones pull/fetch/checkout/branch |
| `src/electron/bridge.types.ts` | Tipos compartidos IPC |
| `src/ui/hooks/useGitChanges.ts` | Hook: estado y lógica de commit |
| `src/ui/hooks/useGitBranches.ts` | Hook: estado y lógica de branches |
| `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | UI: panel de commit |
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | UI: panel de branches |

---

## 🧭 Strategy

**Enfoque: Propagación mínima del stderr real hacia el frontend.**

1. En el backend, asegurar que `rawOutput` siempre contenga el `stderr` real cuando hay un error (ya está implementado en `toGitError`, pero hay casos donde se usa `gitError()` directo sin `rawOutput`).
2. En el frontend, modificar `mapGitErrorToMessage()` para usar `rawOutput` como fuente primaria cuando el código es `E_UNKNOWN`, con truncado inteligente.
3. Para errores con código conocido (ej: `E_MERGE_CONFLICT`, `E_DIRTY_WORKING_DIR`), opcionalmente mostrar el `rawOutput` como detalle adicional en el banner.
4. No cambiar la estructura de tipos IPC — `rawOutput` ya existe y viaja correctamente.

---

## 🚀 Phases

### 🔹 Phase 1: Auditoría y hardening del backend

**Description:**
Garantizar que **todos** los paths de error en `git-changes.ts` y `git-branches.ts` incluyan `rawOutput` con el stderr real. Actualmente hay llamadas a `gitError()` sin `rawOutput` (ej: `ensureGitRepo`, `E_EMPTY_COMMIT_MSG`, `E_BRANCH_NOT_FOUND` con mensaje hardcodeado).

**Tasks:**

- **Task:** Auditar todas las llamadas a `gitError()` en `git-changes.ts` y `git-branches.ts`
  - **Assigned to:** Developer (backend Node/Electron)
  - **Dependencies:** ninguna

- **Task:** En `git-changes.ts` — `addAndCommit()`: cuando `commitRes.exitCode !== 0` y no es `E_NOTHING_TO_COMMIT`, pasar `commitRes.stderr` como tercer argumento a `gitError()` en el path `E_UNKNOWN` dentro de `toGitError()`
  - **Assigned to:** Developer (backend)
  - **Dependencies:** auditoría previa
  - **Detalle técnico:**
    ```typescript
    // ANTES (en toGitError):
    return gitError("E_UNKNOWN", fallbackMessage, rawOutput || undefined);
    
    // Ya está correcto — rawOutput = stderr + stdout concatenados.
    // El problema es que fallbackMessage es genérico.
    // SOLUCIÓN: pasar stderr como parte del message cuando es E_UNKNOWN:
    return gitError(
      "E_UNKNOWN",
      result.stderr || fallbackMessage,  // stderr real como message primario
      rawOutput || undefined,
    );
    ```

- **Task:** En `git-branches.ts` — mismo cambio en `toGitError()`: usar `result.stderr` como `message` cuando el código es `E_UNKNOWN`
  - **Assigned to:** Developer (backend)
  - **Dependencies:** auditoría previa

- **Task:** Verificar que `ensureGitRepo()` (que llama `gitError` sin rawOutput) no necesita rawOutput — es correcto porque no hay stderr en ese punto
  - **Assigned to:** Developer (backend)
  - **Dependencies:** auditoría

---

### 🔹 Phase 2: Cambios en tipos IPC (mínimos)

**Description:**
No se requieren cambios de tipos. `GitOperationError.rawOutput` ya existe. Sin embargo, se debe documentar que `message` en `E_UNKNOWN` ahora puede contener el stderr real (no solo un string genérico).

**Tasks:**

- **Task:** Actualizar el comentario JSDoc de `GitOperationError.message` en `bridge.types.ts` para indicar que para `E_UNKNOWN`, `message` puede contener el stderr real de git
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1

- **Task:** (Opcional) Agregar campo `gitStderr?: string` a `GitOperationError` como campo explícito y semánticamente claro, separado de `rawOutput`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1
  - **Nota:** Solo si el equipo prefiere separar "stderr limpio" de "rawOutput completo". Si se elige esta opción, actualizar `gitError()` y `toGitError()` en ambos archivos backend.
  - **Recomendación:** Preferir esta opción para mayor claridad semántica. Ver especificación en sección de tipos más abajo.

---

### 🔹 Phase 3: Frontend — `mapGitErrorToMessage()` con stderr real

**Description:**
Modificar la función `mapGitErrorToMessage()` en `useGitChanges.ts` y `useGitBranches.ts` para usar el stderr real cuando está disponible.

**Tasks:**

- **Task:** Crear función utilitaria compartida `formatGitError(error: GitOperationError, maxLength?: number): string` en un archivo nuevo `src/ui/utils/gitErrorUtils.ts`
  - **Assigned to:** Developer (frontend)
  - **Dependencies:** Phase 2
  - **Especificación:**
    ```typescript
    const GIT_ERROR_MAX_LENGTH = 300;
    
    /**
     * Extrae el mensaje de error más útil de un GitOperationError.
     * Prioridad:
     *   1. Para E_UNKNOWN: usar gitStderr (o rawOutput) si disponible — es el mensaje real de git
     *   2. Para códigos conocidos: usar el mensaje localizado hardcodeado
     *   3. Fallback: error.message genérico
     *
     * El resultado se trunca a maxLength caracteres para evitar banners enormes.
     * Se preserva la primera línea útil del stderr (la más informativa).
     */
    export function formatGitError(
      error: GitOperationError,
      maxLength = GIT_ERROR_MAX_LENGTH,
    ): string {
      switch (error.code) {
        case "E_NOT_A_GIT_REPO":
          return "This directory is not a Git repository.";
        case "E_NOTHING_TO_COMMIT":
          return "Nothing to commit. Working tree is clean.";
        case "E_EMPTY_COMMIT_MSG":
          return "Commit message cannot be empty.";
        case "E_GIT_NOT_FOUND":
          return "Git is not installed or not found in PATH.";
        case "E_TIMEOUT":
          return "Git operation timed out. Try again.";
        case "E_MERGE_CONFLICT":
          return appendGitDetail(
            "Pull failed due to merge conflicts.",
            error.gitStderr ?? error.rawOutput,
            maxLength,
          );
        case "E_DIRTY_WORKING_DIR":
          return appendGitDetail(
            "Uncommitted changes block this operation.",
            error.gitStderr ?? error.rawOutput,
            maxLength,
          );
        case "E_NO_REMOTE":
          return "No remote configured or remote unreachable.";
        case "E_BRANCH_NOT_FOUND":
          return error.message || "Branch not found.";
        case "E_BRANCH_ALREADY_EXISTS":
          return error.message || "Branch already exists.";
        case "E_INVALID_BRANCH_NAME":
          return error.message || "Invalid branch name.";
        default: {
          // E_UNKNOWN: mostrar stderr real si disponible
          const raw = error.gitStderr ?? error.rawOutput ?? error.message;
          return truncateGitOutput(raw, maxLength) || "An unexpected Git error occurred.";
        }
      }
    }
    
    /**
     * Trunca el output de git a maxLength caracteres.
     * Preserva líneas completas cuando es posible.
     * Agrega "…" al final si se truncó.
     */
    function truncateGitOutput(text: string, maxLength: number): string {
      if (!text) return "";
      const cleaned = text.trim();
      if (cleaned.length <= maxLength) return cleaned;
      // Truncar en límite de palabra/línea
      const truncated = cleaned.slice(0, maxLength);
      const lastNewline = truncated.lastIndexOf("\n");
      const lastSpace = truncated.lastIndexOf(" ");
      const cutAt = lastNewline > maxLength * 0.6 ? lastNewline : lastSpace > 0 ? lastSpace : maxLength;
      return cleaned.slice(0, cutAt).trim() + "…";
    }
    
    /**
     * Para errores con código conocido, opcionalmente agrega el detalle de git
     * si aporta información adicional (ej: qué archivos tienen conflicto).
     */
    function appendGitDetail(
      baseMessage: string,
      detail: string | undefined,
      maxLength: number,
    ): string {
      if (!detail) return baseMessage;
      const firstUsefulLine = extractFirstUsefulLine(detail);
      if (!firstUsefulLine || firstUsefulLine === baseMessage) return baseMessage;
      const combined = `${baseMessage}\n${firstUsefulLine}`;
      return truncateGitOutput(combined, maxLength);
    }
    
    /**
     * Extrae la primera línea no vacía y no trivial del output de git.
     * Filtra líneas que son solo "error:" o "fatal:" sin contenido adicional.
     */
    function extractFirstUsefulLine(text: string): string {
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Saltar líneas de prefijo puro
        if (/^(error|fatal|warning|hint):?\s*$/i.test(line)) continue;
        return line;
      }
      return lines[0] ?? "";
    }
    ```

- **Task:** Reemplazar `mapGitErrorToMessage()` en `useGitChanges.ts` por `formatGitError()` importado de `gitErrorUtils.ts`
  - **Assigned to:** Developer (frontend)
  - **Dependencies:** tarea anterior

- **Task:** Reemplazar `mapGitErrorToMessage()` en `useGitBranches.ts` por `formatGitError()` importado de `gitErrorUtils.ts`
  - **Assigned to:** Developer (frontend)
  - **Dependencies:** tarea anterior

---

### 🔹 Phase 4: UX — Componentes de error en UI

**Description:**
Asegurar que el banner de error en `GitChangesPanel.tsx` y `GitBranchesPanel.tsx` muestre el mensaje correctamente, con soporte para texto multilínea y truncado visual.

**Tasks:**

- **Task:** En `GitChangesPanel.tsx` — sección `CommitActionSection`: verificar que el banner de `commitError` renderiza `\n` como saltos de línea (usar `white-space: pre-wrap` en CSS o `<pre>`)
  - **Assigned to:** Developer (frontend/UI)
  - **Dependencies:** Phase 3
  - **Detalle:** El mensaje puede contener saltos de línea del stderr de git. El banner debe mostrarlos correctamente.

- **Task:** En `GitBranchesPanel.tsx` — banners de error de pull/fetch/checkout: mismo tratamiento de `\n`
  - **Assigned to:** Developer (frontend/UI)
  - **Dependencies:** Phase 3

- **Task:** Agregar `title` attribute al elemento del banner con el mensaje completo (sin truncar), para que el usuario pueda ver el error completo en tooltip al hacer hover
  - **Assigned to:** Developer (frontend/UI)
  - **Dependencies:** Phase 3
  - **Detalle:**
    ```tsx
    <div
      className="git-changes__commit-error"
      role="alert"
      title={fullErrorMessage}  // mensaje sin truncar para tooltip
    >
      {displayErrorMessage}  {/* mensaje truncado para display */}
    </div>
    ```

- **Task:** (Opcional) Agregar botón "Copy error" en el banner para copiar el `rawOutput` completo al clipboard — útil para debugging
  - **Assigned to:** Developer (frontend/UI)
  - **Dependencies:** Phase 3

---

### 🔹 Phase 5: Cobertura de operaciones git relevantes

**Description:**
Verificar que el flujo de error real funciona para TODAS las operaciones git expuestas, no solo commit.

**Tasks:**

- **Task:** Verificar y testear: `gitFetchAndPull` → error de red/auth → stderr real en UI
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phases 1-4

- **Task:** Verificar y testear: `gitPullBranch` → conflicto de merge → stderr real en UI
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phases 1-4

- **Task:** Verificar y testear: `gitCheckoutBranch` → working dir sucio → stderr real en UI
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phases 1-4

- **Task:** Verificar y testear: `gitAddAndCommit` → hook pre-commit falla → stderr real en UI (caso crítico: el hook puede imprimir mensajes útiles en stderr)
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phases 1-4

- **Task:** Verificar y testear: `gitCreateBranch` → nombre inválido / ya existe → mensaje correcto en UI
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phases 1-4

---

## 📐 Especificación Técnica Detallada

### Cambio en `GitOperationError` (bridge.types.ts)

**Opción A (recomendada): Agregar campo `gitStderr`**

```typescript
export interface GitOperationError {
  ok: false;
  code: GitOperationErrorCode;
  /**
   * Mensaje localizado/legible. Para E_UNKNOWN, puede contener el stderr real de git.
   * Para otros códigos, es un mensaje descriptivo en inglés.
   */
  message: string;
  /**
   * El stderr real del proceso git, sin procesar.
   * Siempre presente cuando el error proviene de un proceso git que falló.
   * Ausente en errores de validación pre-ejecución (ej: E_EMPTY_COMMIT_MSG).
   * Usar este campo para mostrar al usuario el error real de git.
   */
  gitStderr?: string;
  /**
   * Output raw completo (stderr + stdout concatenados). Para debugging.
   * @deprecated Preferir gitStderr para mostrar al usuario.
   */
  rawOutput?: string;
}
```

**Cambio en `toGitError()` (ambos archivos backend):**

```typescript
function toGitError(
  result: RunGitResult,
  fallbackMessage: string,
): GitOperationError {
  const rawOutput = [result.stderr, result.stdout].filter(Boolean).join("\n");
  const gitStderr = result.stderr || undefined;  // ← NUEVO

  if (result.errorCode === "ENOENT") {
    return { ok: false, code: "E_GIT_NOT_FOUND", message: "Git is not installed or not found in PATH.", gitStderr, rawOutput };
  }
  if (result.timedOut) {
    return { ok: false, code: "E_TIMEOUT", message: "Git operation timed out.", gitStderr, rawOutput };
  }
  if (isNotGitRepo(result.stderr)) {
    return { ok: false, code: "E_NOT_A_GIT_REPO", message: "The selected folder is not a Git repository.", gitStderr, rawOutput };
  }
  // ... resto de checks ...

  return { ok: false, code: "E_UNKNOWN", message: fallbackMessage, gitStderr, rawOutput };
}
```

**Opción B (sin cambio de tipos):** Usar `rawOutput` directamente en el frontend. Más simple pero semánticamente menos claro.

---

### Lógica de truncado

| Situación | Comportamiento |
|---|---|
| stderr ≤ 300 chars | Mostrar completo |
| stderr > 300 chars | Truncar en límite de línea/palabra + "…" |
| stderr vacío | Usar `error.message` genérico |
| `error.message` vacío | Usar `"An unexpected Git error occurred."` |
| Mensaje con `\n` | Renderizar con `white-space: pre-wrap` |
| Hover sobre banner | `title` attribute con texto completo sin truncar |

### Prioridad de fuentes del mensaje de error

```
Para E_UNKNOWN:
  1. error.gitStderr (stderr limpio del proceso git)
  2. error.rawOutput (stderr + stdout)
  3. error.message (fallback genérico)
  4. "An unexpected Git error occurred." (último recurso)

Para códigos conocidos (E_MERGE_CONFLICT, E_DIRTY_WORKING_DIR, etc.):
  1. Mensaje localizado hardcodeado (claro y conciso)
  2. + primera línea útil de gitStderr como detalle adicional (opcional)
```

---

## ⚠️ Risks

- **Mensajes de git muy largos**: El stderr de git puede ser extenso (ej: diff de conflictos). El truncado a 300 chars mitiga esto, pero el tooltip con el mensaje completo es importante.
- **Mensajes en idioma del sistema**: Git puede emitir stderr en el idioma del OS del usuario (español, francés, etc.). No es un problema — se muestra tal cual, que es lo más útil.
- **Información sensible en stderr**: En casos raros, el stderr puede incluir tokens o URLs con credenciales. Mitigación: el campo `gitStderr` solo se usa para display, no se loguea. Considerar sanitizar URLs con tokens antes de mostrar.
- **Regresión en mensajes conocidos**: Al cambiar `mapGitErrorToMessage` por `formatGitError`, verificar que los mensajes para códigos conocidos no cambien de forma inesperada.
- **IPC structured clone**: `gitStderr` es un string plano — no hay riesgo de pérdida por structured clone.

---

## ✅ Checklist QA

### Backend

- [ ] `git commit` con pre-commit hook que falla → `gitStderr` contiene el output del hook
- [ ] `git commit` sin cambios staged → código `E_NOTHING_TO_COMMIT`, mensaje correcto
- [ ] `git commit` con mensaje vacío → código `E_EMPTY_COMMIT_MSG`, sin `gitStderr`
- [ ] `git pull` con conflicto de merge → código `E_MERGE_CONFLICT`, `gitStderr` contiene archivos en conflicto
- [ ] `git pull` sin remote configurado → código `E_NO_REMOTE`, `gitStderr` presente
- [ ] `git checkout` con working dir sucio → código `E_DIRTY_WORKING_DIR`, `gitStderr` lista archivos bloqueantes
- [ ] `git fetch` con error de red → código `E_UNKNOWN` o `E_NO_REMOTE`, `gitStderr` con mensaje de red
- [ ] `git` no instalado → código `E_GIT_NOT_FOUND`, sin `gitStderr`
- [ ] Operación que excede timeout → código `E_TIMEOUT`, sin `gitStderr` (proceso fue killed)

### Frontend — `formatGitError()`

- [ ] `E_UNKNOWN` con `gitStderr` de 50 chars → muestra completo
- [ ] `E_UNKNOWN` con `gitStderr` de 500 chars → trunca a ~300 chars con "…"
- [ ] `E_UNKNOWN` sin `gitStderr` → muestra `error.message` o fallback genérico
- [ ] `E_NOTHING_TO_COMMIT` → muestra "Nothing to commit. Working tree is clean."
- [ ] `E_MERGE_CONFLICT` → muestra mensaje base + primera línea útil de stderr
- [ ] stderr con `\n` → se renderiza como multilínea en el banner

### UI — Banners de error

- [ ] `GitChangesPanel` — commit error: muestra stderr real cuando commit falla por pre-commit hook
- [ ] `GitChangesPanel` — commit error: banner tiene `title` con mensaje completo
- [ ] `GitBranchesPanel` — pull error: muestra stderr real cuando pull falla
- [ ] `GitBranchesPanel` — checkout error: muestra stderr real cuando checkout falla
- [ ] Banner con texto largo: no desborda el layout (overflow hidden + truncado)
- [ ] Banner con `\n`: renderiza saltos de línea correctamente (`white-space: pre-wrap`)
- [ ] Hover sobre banner truncado: tooltip muestra mensaje completo

### Regresión

- [ ] Commit exitoso: no muestra ningún error
- [ ] Pull exitoso: no muestra ningún error
- [ ] Mensajes de error para códigos conocidos no cambiaron respecto al comportamiento anterior
- [ ] `rawOutput` sigue presente en el payload IPC (no se eliminó)

---

## 📝 Notes

- **No se requieren cambios en `ipc-handlers.ts` ni en `preload.ts`**: el campo `gitStderr` viaja automáticamente por IPC al ser parte del objeto `GitOperationError` retornado por los handlers.
- **Archivo utilitario compartido**: `src/ui/utils/gitErrorUtils.ts` centraliza la lógica de formateo para que ambos hooks (`useGitChanges`, `useGitBranches`) usen la misma implementación. Evita duplicación.
- **Backward compatibility**: Si por alguna razón `gitStderr` no está presente (ej: versión antigua del backend en desarrollo), el código cae al fallback `rawOutput` → `message` → string genérico. No hay breaking change.
- **Sanitización de credenciales**: Si el proyecto usa autenticación HTTP con token en la URL (ej: `https://token@github.com/...`), el stderr de git puede exponer el token. Considerar agregar una función `sanitizeGitOutput(text: string): string` que reemplace patrones `https://[^@]+@` con `https://***@` antes de mostrar en UI.
- **Longitud máxima configurable**: La constante `GIT_ERROR_MAX_LENGTH = 300` puede ajustarse según feedback de UX. 300 chars es suficiente para la mayoría de mensajes de error de git sin desbordar el banner.
