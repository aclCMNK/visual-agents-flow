# Bug: Checkout involuntario fuera de rama temporal tras divergencia exitosa

**Fecha:** 2026-04-29  
**Severidad:** Crítica  
**Estado:** ✅ Corregido

---

## Descripción del problema

Después de un flujo de divergencia exitoso (donde el usuario queda en una rama `local-changes-*`), ciertos flujos posteriores realizaban un `checkout` a la rama principal (`main`/`master`), sacando al usuario de su rama temporal sin advertencia ni consentimiento.

---

## Flujo de divergencia (correcto)

1. Usuario conecta un remote → `useGitConfig.connect()` se ejecuta
2. Se detecta la rama principal → `gitDetectMainBranch`
3. Se detecta divergencia → `gitHandleDivergence`
4. Se crea rama `local-changes-YYYYMMDD-HHMMSS` con los cambios locales
5. Usuario queda en `local-changes-*` ✅
6. Se despacha `DIVERGENCE_SUCCESS` con `savedBranch = "local-changes-..."` ✅

---

## Puntos de bug identificados

### Bug 1 — CRÍTICO: `ensureLocalBranch` en `git-branches.ts` (línea ~862)

**Archivo:** `src/electron/git-branches.ts`  
**Función:** `ensureLocalBranch()`

Cuando la rama protegida ya existe localmente, la función hacía `checkout branchName` **incondicionalmente**, sin verificar si el usuario estaba en una rama `local-changes-*`.

```ts
// ANTES (bug):
const checkoutRes = await runGit(projectDir, ["checkout", branchName]);
// ↑ Siempre hacía checkout a la rama protegida, incluso si el usuario
//   estaba en local-changes-*
```

**Escenario de activación:**
- Divergencia exitosa → usuario en `local-changes-*`
- Cualquier llamada posterior a `gitEnsureLocalBranch` con la rama protegida
- → checkout silencioso a `main`/`master`

---

### Bug 2 — CRÍTICO: `loadBranches` en `useGitBranches.ts` (línea ~353)

**Archivo:** `src/ui/hooks/useGitBranches.ts`  
**Función:** `loadBranches()`

Cuando la rama protegida no existía localmente, `loadBranches` llamaba `gitEnsureLocalBranch` **sin verificar si el usuario estaba en una rama de divergencia**. Este código se ejecuta automáticamente al montar `GitBranchesPanel`.

```ts
// ANTES (bug):
if (desiredProtectedBranch.length > 0 && !hasLocalProtectedBranch) {
    await bridge.gitEnsureLocalBranch({ projectDir, branch: desiredProtectedBranch });
    // ↑ Si el usuario estaba en local-changes-*, esto hacía checkout a main
}
```

**Escenario de activación:**
- Divergencia exitosa → usuario en `local-changes-*`
- Usuario abre la pestaña "Branches" del modal → `GitBranchesPanel` se monta
- `useGitBranches` inicializa → `loadBranches()` se ejecuta automáticamente
- La rama protegida no existe localmente aún
- → `gitEnsureLocalBranch` → checkout a `main` → usuario sale de `local-changes-*` 💥

Este era el **escenario más común** de activación del bug.

---

### Bug 3 — SECUNDARIO: path de error de divergencia en `useGitConfig.ts` (línea ~484)

**Archivo:** `src/ui/hooks/useGitConfig.ts`  
**Función:** `connect()`

En el path de error de `gitHandleDivergence`, el código llamaba `gitEnsureLocalBranch` incondicionalmente, sin verificar si el usuario ya estaba en una rama `local-changes-*` (posible en divergencia parcial).

```ts
// ANTES (bug):
if (!divergenceResult.ok) {
    dispatch({ type: "DIVERGENCE_ERROR", ... });
    const ensureResult = await bridge.gitEnsureLocalBranch({
        projectDir,
        branch: detectResult.branch,  // ← checkout a main
    });
}
```

---

## Solución aplicada

### Fix 1 — `git-branches.ts`: Guard en `ensureLocalBranch`

Se añade verificación de la rama activa antes de hacer checkout. Si el usuario está en `local-changes-*`, se retorna éxito sin cambiar de rama.

```ts
// DESPUÉS (fix):
const activeBranch = await getCurrentBranch(projectDir);
const isOnDivergenceBranch = activeBranch.startsWith("local-changes-");

if (isOnDivergenceBranch) {
    // Skip checkout — preserve the user's divergence branch
    const output = [fetchRes.stdout, fetchRes.stderr].filter(Boolean).join("\n").trim();
    return { ok: true, branch: branchName, created: false, output };
}

const checkoutRes = await runGit(projectDir, ["checkout", branchName]);
// ...
```

### Fix 2 — `useGitBranches.ts`: Guard en `loadBranches`

Se añade verificación de la rama actual antes de llamar `gitEnsureLocalBranch`.

```ts
// DESPUÉS (fix):
const isOnDivergenceBranch = res.currentBranch.startsWith("local-changes-");

if (desiredProtectedBranch.length > 0 && !hasLocalProtectedBranch && !isOnDivergenceBranch) {
    await bridge.gitEnsureLocalBranch({ projectDir, branch: desiredProtectedBranch });
    // ...
}
```

### Fix 3 — `useGitConfig.ts`: Guard en path de error de divergencia

Se verifica la rama actual antes de llamar `gitEnsureLocalBranch` en el path de error.

```ts
// DESPUÉS (fix):
if (!divergenceResult.ok) {
    dispatch({ type: "DIVERGENCE_ERROR", ... });

    const bridge2 = getBridge();
    if (bridge2) {
        const currentBranchRes = await bridge2.gitListBranches({ projectDir });
        const currentBranch = currentBranchRes.ok ? currentBranchRes.currentBranch : "";
        const isOnDivergenceBranch = currentBranch.startsWith("local-changes-");

        if (!isOnDivergenceBranch) {
            const ensureResult = await bridge2.gitEnsureLocalBranch({ ... });
            // ...
        }
    }
}
```

---

## Tests de integración

Los siguientes tests de integración validan el comportamiento post-fix en `tests/electron/git-protected-branch-bugs.test.ts`:

| ID de test | Qué valida |
|---|---|
| `[FIX-DIV-GUARD-1]` ensureLocalBranch does NOT checkout... | `ensureLocalBranch` no hace checkout cuando el usuario está en `local-changes-*` (rama ya existe localmente) |
| `[FIX-DIV-GUARD-1]` preserves any local-changes-YYYYMMDD-HHMMSS variant | El guard funciona para cualquier variante de timestamp |
| `[FIX-DIV-GUARD-1]` preserves local-changes-* with random suffix | El guard funciona para ramas con sufijo aleatorio (anti-colisión) |
| `[FIX-DIV-GUARD-REGRESSION]` still checks out when NOT on local-changes-* | El flujo normal de checkout sigue funcionando para ramas que no son de divergencia |
| `[FIX-DIV-GUARD-E2E]` after handleDivergence, ensureLocalBranch does not move user | Test end-to-end: divergencia → `ensureLocalBranch` → usuario permanece en `local-changes-*` |

Los tests de `tests/electron/git-divergence.test.ts` ya cubrían que `handleDivergence` deja al usuario en `local-changes-*` (invariante CA-01/CA-06).

---

## Archivos modificados

| Archivo | Tipo de cambio |
|---|---|
| `src/electron/git-branches.ts` | Fix en `ensureLocalBranch` — guard contra checkout en divergence branch |
| `src/ui/hooks/useGitBranches.ts` | Fix en `loadBranches` — guard contra `ensureLocalBranch` en divergence branch |
| `src/ui/hooks/useGitConfig.ts` | Fix en `connect` — guard en path de error de divergencia |

---

## Invariante garantizada post-fix

> **Ningún flujo del sistema realizará un `checkout` o `ensureLocalBranch` que saque al usuario de una rama `local-changes-*` de forma automática o implícita.**

El único checkout permitido desde una rama `local-changes-*` es el explícito iniciado por el usuario desde la UI (botón "⎇ Checkout" en `GitBranchesPanel`).

---

## Notas adicionales

- El prefijo `local-changes-` es el identificador canónico de las ramas de divergencia, generado en `formatDivergenceBranchName()` en `git-branches.ts`.
- La detección `startsWith("local-changes-")` es suficientemente específica y no colisiona con nombres de ramas de usuario normales (que no pueden empezar con ese prefijo por convención del sistema).
- Los flujos de `checkoutBranch` (acción explícita del usuario) **no están afectados** por estos guards — el usuario puede hacer checkout manual a cualquier rama.
