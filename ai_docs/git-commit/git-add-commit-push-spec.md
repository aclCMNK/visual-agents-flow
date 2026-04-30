# Spec: Auto-Push tras Add & Commit

**ID:** SPEC-GIT-001  
**Fecha:** 2026-04-29  
**Estado:** Borrador  
**Autor:** Weight-Planner  

---

## 🎯 Objetivo

Extender el flujo actual de "Add and Commit" para que, cuando exista un remote configurado en el repositorio, el sistema ejecute automáticamente un `git push` a ese remote en la rama activa, inmediatamente después de un commit exitoso.

El commit local **nunca debe bloquearse** por un fallo de push. El push es un paso adicional, no un requisito del commit.

---

## 🧩 Contexto

### Estado actual del sistema

El flujo actual de "Add and Commit" está implementado en tres capas:

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| Main Process (Electron) | `src/electron/git-changes.ts` | Ejecuta `git add -A` + `git commit` vía `execFile` |
| IPC Bridge | `src/electron/bridge.types.ts` | Define tipos `GitAddAndCommitRequest`, `GitAddAndCommitResponse`, `GitOperationErrorCode` |
| React Hook | `src/ui/hooks/useGitChanges.ts` | Orquesta el flujo, maneja estado y errores |
| UI Component | `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | Renderiza el botón "Add and Commit" y el feedback |

### Detección de remote existente

El sistema ya tiene capacidad de detectar el remote origin:
- `src/electron/git-config.ts` → función `getConfig()` → retorna `{ ok: true, hasGit: true, remoteUrl: string | null }`
- Canal IPC: `GIT_GET_CONFIG` → `"git:get-config"`
- El bridge ya expone `gitGetConfig` en `window.agentsFlow`

### Detección de rama activa

La rama activa ya se obtiene en `getStatus()` dentro de `git-changes.ts` mediante:
```
git rev-parse --abbrev-ref HEAD
```
Y se expone en el estado del hook como `state.currentBranch`.

---

## 🔍 Análisis de Impacto

### Qué NO cambia
- La lógica de `git add -A` y `git commit` permanece intacta
- El tipo `GitAddAndCommitRequest` no necesita cambios (el push es transparente)
- El botón "Add and Commit" en la UI no cambia de nombre ni de comportamiento visible (salvo feedback adicional)
- La protección de rama protegida sigue bloqueando antes del add+commit

### Qué SÍ cambia
1. **`git-changes.ts`** → función `addAndCommit()`: añadir paso de push condicional post-commit
2. **`bridge.types.ts`** → `GitAddAndCommitResult`: añadir campos de resultado de push
3. **`bridge.types.ts`** → `GitOperationErrorCode`: añadir código `"E_PUSH_FAILED"`
4. **`useGitChanges.ts`** → hook: manejar resultado de push en el estado
5. **`GitChangesPanel.tsx`** → UI: mostrar feedback diferenciado para push exitoso vs. push fallido

---

## 🚀 Pasos Detallados de Implementación

### Paso 1 — Extender tipos en `bridge.types.ts`

**1.1 — Nuevo error code para push:**
```typescript
export type GitOperationErrorCode =
  | ... (existentes)
  | "E_PUSH_FAILED";   // ← NUEVO
```

**1.2 — Extender `GitAddAndCommitResult` con info de push:**
```typescript
export interface GitAddAndCommitResult {
  ok: true;
  commitHash: string;
  output: string;
  // NUEVOS campos opcionales:
  pushAttempted: boolean;       // true si se intentó push (había remote)
  pushOk: boolean;              // true si el push fue exitoso
  pushError?: string;           // mensaje de error del push (si pushOk === false)
  pushRemote?: string;          // URL del remote al que se hizo push
  pushBranch?: string;          // rama a la que se hizo push
}
```

> **Invariante crítica:** `ok: true` siempre significa que el commit local fue exitoso, independientemente del resultado del push.

---

### Paso 2 — Implementar push en `git-changes.ts`

**2.1 — Función auxiliar `detectRemote()`:**
```typescript
async function detectRemote(projectDir: string): Promise<string | null> {
  const res = await runGit(projectDir, ["remote", "get-url", "origin"], 5_000);
  if (res.exitCode === 0 && res.stdout) return res.stdout.trim();
  return null;
}
```

**2.2 — Función auxiliar `pushToRemote()`:**
```typescript
async function pushToRemote(
  projectDir: string,
  branch: string,
): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  const res = await runGit(
    projectDir,
    ["push", "origin", branch],
    60_000,   // timeout generoso para push (red puede ser lenta)
  );
  return {
    ok: res.exitCode === 0,
    stderr: res.stderr,
    stdout: res.stdout,
  };
}
```

**2.3 — Modificar `addAndCommit()` para incluir push post-commit:**

Después del bloque de commit exitoso (línea ~284 actual), añadir:

```typescript
// --- POST-COMMIT: push automático si hay remote ---
const remoteUrl = await detectRemote(projectDir);

if (!remoteUrl) {
  // Sin remote → retornar commit exitoso sin push
  return {
    ok: true,
    commitHash,
    output,
    pushAttempted: false,
    pushOk: false,
  };
}

// Obtener rama activa para el push
const branchRes = await runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"], 5_000);
const activeBranch = branchRes.exitCode === 0 ? branchRes.stdout : "";

if (!activeBranch || activeBranch === "HEAD") {
  // HEAD detached → no se puede hacer push automático
  return {
    ok: true,
    commitHash,
    output,
    pushAttempted: false,
    pushOk: false,
    pushError: "Cannot push: repository is in detached HEAD state.",
  };
}

const pushResult = await pushToRemote(projectDir, activeBranch);

return {
  ok: true,
  commitHash,
  output,
  pushAttempted: true,
  pushOk: pushResult.ok,
  pushRemote: remoteUrl,
  pushBranch: activeBranch,
  pushError: pushResult.ok
    ? undefined
    : (pushResult.stderr || "Push failed with no error message."),
};
```

---

### Paso 3 — Actualizar el hook `useGitChanges.ts`

**3.1 — Extender el estado:**
```typescript
interface GitChangesState {
  // ... campos existentes ...
  lastPushSuccess: boolean | null;   // null = no se intentó, true/false = resultado
  pushError: UiGitError | null;      // error de push (si aplica)
}
```

**3.2 — Nuevas acciones del reducer:**
```typescript
type GitChangesAction =
  | ... (existentes)
  | { type: "PUSH_SUCCESS"; branch: string; remote: string }
  | { type: "PUSH_SKIPPED" }   // no había remote
  | { type: "PUSH_ERROR"; error: UiGitError };
```

**3.3 — Lógica post-commit en `addAndCommit()`:**

Después del dispatch de `COMMIT_SUCCESS`, evaluar el resultado de push:

```typescript
if (result.pushAttempted) {
  if (result.pushOk) {
    dispatch({ type: "PUSH_SUCCESS", branch: result.pushBranch!, remote: result.pushRemote! });
  } else {
    dispatch({
      type: "PUSH_ERROR",
      error: toUiGitError(result.pushError ?? "Push failed."),
    });
  }
} else {
  dispatch({ type: "PUSH_SKIPPED" });
}
```

**3.4 — El `CLEAR_COMMIT_FEEDBACK` también limpia el estado de push:**
```typescript
case "CLEAR_COMMIT_FEEDBACK":
  return {
    ...state,
    commitError: null,
    lastCommitSuccess: null,
    lastPushSuccess: null,
    pushError: null,
  };
```

---

### Paso 4 — Actualizar la UI en `GitChangesPanel.tsx`

**4.1 — Feedback de push exitoso:**

En `CommitActionSection`, después del banner de commit exitoso:
```tsx
{props.lastPushSuccess === true && (
  <div className="git-branches__success-banner" role="status">
    ↑ Pushed to {props.pushBranch} on {props.pushRemote}
  </div>
)}
```

**4.2 — Feedback de push fallido (no bloquea, es advertencia):**
```tsx
{props.pushError && (
  <div
    className="git-branches__error-banner git-branches__error-banner--multiline git-branches__error-banner--warning"
    role="alert"
    title={props.pushError.fullMessage}
  >
    ⚠ Commit saved locally, but push failed: {props.pushError.displayMessage}
  </div>
)}
```

> **Nota de diseño:** El banner de push fallido debe ser visualmente diferente al de error de commit. Se sugiere usar un color ámbar/warning en lugar de rojo, para comunicar que el commit fue exitoso pero el push no.

**4.3 — Estado del botón durante push:**

El botón debe mostrar estado de "pushing" mientras el push está en curso:
```tsx
{props.isCommitting ? (
  props.isPushing ? "Pushing…" : "Committing…"
) : (
  <><span aria-hidden="true">✔</span> Add and Commit</>
)}
```

Para esto, el estado `isCommitting` puede mantenerse `true` durante el push, o se puede añadir un campo `isPushing` separado. **Recomendado:** mantener `isCommitting: true` durante todo el ciclo (add + commit + push) para simplicidad.

---

## ✅ Criterios de Aceptación

### CA-1: Push automático cuando hay remote
- **Dado** que el repositorio tiene un remote `origin` configurado
- **Y** el usuario pulsa "Add and Commit" con un mensaje válido
- **Y** hay cambios en el working tree
- **Cuando** el commit se crea exitosamente
- **Entonces** el sistema ejecuta `git push origin <rama-activa>` automáticamente
- **Y** muestra un banner de éxito que incluye la rama y el remote

### CA-2: Sin push cuando no hay remote
- **Dado** que el repositorio NO tiene remote configurado
- **Cuando** el usuario pulsa "Add and Commit"
- **Entonces** el sistema ejecuta solo `git add -A` + `git commit`
- **Y** NO muestra ningún error relacionado con push
- **Y** el commit se reporta como exitoso normalmente

### CA-3: Push falla — commit local preservado
- **Dado** que el repositorio tiene remote configurado
- **Y** el push falla (red caída, credenciales inválidas, rama protegida en remoto, etc.)
- **Cuando** el commit se crea exitosamente
- **Entonces** el sistema retorna `ok: true` con `pushOk: false`
- **Y** el commit local NO se revierte
- **Y** la UI muestra un banner de advertencia (no error bloqueante) con el mensaje del fallo
- **Y** el banner de commit exitoso también se muestra

### CA-4: HEAD detached — sin push automático
- **Dado** que el repositorio está en estado "detached HEAD"
- **Cuando** el commit se crea exitosamente
- **Entonces** el push NO se intenta
- **Y** `pushAttempted: false` en el resultado
- **Y** la UI no muestra error de push

### CA-5: Timeout de push — commit preservado
- **Dado** que el push tarda más de 60 segundos
- **Cuando** el timeout expira
- **Entonces** el commit local permanece intacto
- **Y** la UI muestra advertencia de timeout en el push

### CA-6: Rama protegida — bloqueo previo al push
- **Dado** que la rama activa es la rama protegida configurada
- **Cuando** el usuario pulsa "Add and Commit"
- **Entonces** el sistema bloquea ANTES del add+commit (comportamiento existente)
- **Y** el push nunca se intenta

### CA-7: Botón deshabilitado durante push
- **Dado** que el push está en curso
- **Cuando** el usuario intenta pulsar "Add and Commit" de nuevo
- **Entonces** el botón permanece deshabilitado (`isCommitting: true` durante todo el ciclo)

---

## ⚠️ Edge Cases

| Caso | Comportamiento esperado |
|------|------------------------|
| Remote existe pero no hay upstream tracking para la rama | `git push origin <branch>` funciona igual; si la rama no existe en remoto, git la crea |
| Push rechazado por "non-fast-forward" (remoto tiene commits nuevos) | `pushOk: false`, mensaje claro en UI: "Push rejected: remote has new commits. Pull first." |
| Credenciales inválidas / expiradas | `pushOk: false`, stderr de git expuesto en UI |
| Remote URL es SSH y no hay clave configurada | `pushOk: false`, stderr de git expuesto en UI |
| Repositorio sin commits previos (primer commit) | Push funciona normalmente si hay remote; si falla por "no upstream", mostrar advertencia |
| `git push` tarda mucho (red lenta) | Timeout de 60s; commit preservado; advertencia en UI |
| Múltiples remotes (no solo `origin`) | Solo se usa `origin` para el push automático |
| Remote URL es `null` en `getConfig` pero `.git/config` tiene remote | `detectRemote()` hace su propia consulta directa; no depende del estado cacheado |

---

## 📁 Archivos a Modificar

| Archivo | Tipo de cambio | Descripción |
|---------|---------------|-------------|
| `src/electron/bridge.types.ts` | Modificación | Añadir `"E_PUSH_FAILED"` a `GitOperationErrorCode`; extender `GitAddAndCommitResult` con campos de push |
| `src/electron/git-changes.ts` | Modificación | Añadir `detectRemote()`, `pushToRemote()`, lógica post-commit en `addAndCommit()` |
| `src/ui/hooks/useGitChanges.ts` | Modificación | Extender `GitChangesState`, añadir acciones de push al reducer, manejar resultado de push en `addAndCommit()` |
| `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | Modificación | Añadir props de push a `CommitActionSectionProps`, renderizar banners de push exitoso/fallido |

### Archivos que NO se modifican
- `src/electron/git-config.ts` — La detección de remote se reimplementa localmente en `git-changes.ts` para evitar dependencia cruzada entre módulos del main process
- `src/electron/preload.ts` — El canal `GIT_ADD_AND_COMMIT` ya existe; solo cambia el shape del resultado
- `src/electron/ipc-handlers.ts` — No requiere cambios; el handler delega a `addAndCommit()`

---

## 🔗 Consideraciones de Integración

### IPC / Preload
El canal `GIT_ADD_AND_COMMIT` ya está registrado en `preload.ts` y expuesto como `bridge.gitAddAndCommit()`. El cambio en el shape de `GitAddAndCommitResult` es **retrocompatible** porque solo añade campos opcionales. El renderer que no los consuma simplemente los ignora.

### Timeout strategy
- `git add -A`: 30s (sin cambios)
- `git commit`: 30s (sin cambios)  
- `git push`: **60s** (nuevo; la red puede ser lenta)
- `git remote get-url origin`: 5s (nuevo; operación local, rápida)
- `git rev-parse --abbrev-ref HEAD`: 5s (ya existe en `getStatus`, se reutiliza el patrón)

### Orden de operaciones (secuencial, no paralelo)
```
1. ensureGitRepo()
2. validar mensaje
3. verificar rama protegida
4. git add -A
5. git commit
6. detectRemote()          ← NUEVO
7. (si remote) git push    ← NUEVO
8. retornar resultado
```

### No hay rollback de commit si push falla
Esta es una decisión de diseño deliberada. El commit local es un artefacto valioso que no debe perderse por un fallo de red. El usuario puede hacer push manualmente desde la pestaña de Branches o desde terminal.

### Compatibilidad con `protectedBranch`
La protección de rama se evalúa en el paso 3 (antes del add+commit). Si la rama está protegida, el flujo termina ahí. El push nunca se alcanza. No hay conflicto.

### Estado de UI durante el ciclo completo
El campo `isCommitting: true` se mantiene durante todo el ciclo (add + commit + push). Esto simplifica la UI y evita que el usuario intente hacer otro commit mientras el push está en curso. El botón muestra "Committing…" durante add+commit y "Pushing…" durante el push.

---

## 📝 Notas Adicionales

- **No se añade opción de "deshabilitar push automático"** en esta spec. Si en el futuro se requiere, se puede añadir un checkbox en la UI y un campo `autoPush?: boolean` en `GitAddAndCommitRequest`.
- **El push siempre es a `origin`**. No se soporta push a otros remotes en esta versión.
- **No se hace `--set-upstream`** automáticamente. Si la rama no tiene upstream, `git push origin <branch>` la crea en el remoto sin configurar tracking. Esto es intencional para no modificar la configuración del repo silenciosamente.
- **Los tests existentes** de `addAndCommit` deben actualizarse para mockear `detectRemote()` y verificar los nuevos campos en el resultado.
