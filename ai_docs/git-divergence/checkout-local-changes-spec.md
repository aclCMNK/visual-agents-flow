# Spec: Checkout Automático a Rama Temporal en Flujo de Divergencia

**ID:** GIT-DIV-001  
**Fecha:** 2026-04-29  
**Estado:** Aprobada  
**Alcance:** Ajuste puntual en `handleDivergence` — función `git-branches.ts`

---

## 🎯 Objetivo

Garantizar que, cuando el sistema detecte divergencia local durante la integración de un repositorio remoto y cree una rama temporal `local-changes-YYYYMMDD-HHmmss`, el usuario quede posicionado automáticamente en esa rama sin ningún paso manual adicional.

---

## 🧩 Contexto

### Flujo existente de divergencia

Durante la integración de un repositorio remoto (`GIT_HANDLE_DIVERGENCE`), el sistema ejecuta los siguientes pasos:

1. Hace `fetch` del remoto.
2. Detecta si existe divergencia: árbol sucio (`hasDirtyTree`), commits adelantados (`aheadCount > 0`) o HEAD no ancestro del remoto (`!headIsAncestor`).
3. Si hay divergencia, genera un nombre de rama temporal con el patrón `local-changes-YYYYMMDD-HHmmss`.
4. Si el árbol está sucio, hace `stash push --include-untracked` para preservar cambios no commiteados.
5. Crea la rama temporal con `git checkout -b <tempBranch>`.
6. Restaura el stash con `git stash pop` (si aplica).
7. Hace `git add -A` y `git commit` para consolidar los cambios en la rama temporal.
8. Retorna `{ ok: true, divergenceDetected: true, savedBranch: tempBranch }`.

### Problema identificado

El comando `git checkout -b <tempBranch>` (paso 5) crea la rama **y** hace checkout en ella en una sola operación. Sin embargo, existe una verificación posterior (líneas 470–483 de `git-branches.ts`) que comprueba si `getCurrentBranch()` coincide con `tempBranch` y, de no ser así, ejecuta un `git checkout <tempBranch>` adicional.

Esta verificación es el mecanismo de seguridad que garantiza el checkout automático. La spec formaliza su comportamiento esperado, sus invariantes y sus criterios de aceptación.

### Archivo afectado

```
src/electron/git-branches.ts
  └── function handleDivergence(projectDir, remoteBranch)
      └── bloque final: verificación y checkout a tempBranch (líneas ~470–483)
```

---

## 🚀 Pasos Detallados del Flujo

### Paso 1 — Detección de divergencia

**Condición de entrada:** `isDiverged === true`  
Se cumple si al menos una de las siguientes es verdadera:
- `divergence.hasDirtyTree` → hay archivos modificados/no trackeados.
- `divergence.aheadCount > 0` → hay commits locales no presentes en el remoto.
- `!divergence.headIsAncestor` → HEAD local no es ancestro del remoto (historias divergentes).

### Paso 2 — Generación del nombre de rama temporal

```
local-changes-YYYYMMDD-HHmmss
```

- `YYYYMMDD`: año, mes y día con padding de 2 dígitos.
- `HHmmss`: hora, minutos y segundos con padding de 2 dígitos.
- Si el nombre ya existe en el repositorio, se agrega un sufijo aleatorio de 4 caracteres alfanuméricos: `local-changes-YYYYMMDD-HHmmss-<xxxx>`.

### Paso 3 — Preservación del árbol sucio (condicional)

**Condición:** `divergence.hasDirtyTree && !divergence.emptyRepo`

```bash
git stash push --include-untracked -m "agentsflow-divergence-YYYYMMDD-HHmmss"
```

- Si falla: retorna error `E_DIVERGENCE_SAVE_FAILED` y **no continúa**.

### Paso 4 — Creación de la rama temporal con checkout

```bash
git checkout -b <tempBranch>
```

- Si falla por nombre duplicado (`already exists`): genera sufijo aleatorio y reintenta una vez.
- Si falla definitivamente: restaura el stash (si fue creado) y retorna error `E_DIVERGENCE_SAVE_FAILED`.

> **Nota:** `git checkout -b` crea la rama **y** posiciona HEAD en ella en una sola operación atómica.

### Paso 5 — Restauración del stash (condicional)

**Condición:** `stashCreated === true`

```bash
git stash pop
```

- Si falla (conflictos): `stashPopHadConflicts = true`. El flujo **continúa** y el mensaje final advierte al usuario.

### Paso 6 — Commit de consolidación (condicional)

**Condición:** el árbol tiene cambios después del stash pop.

```bash
git add -A
git commit -m "chore: save local changes before remote sync [agentsflow-auto]"
```

- Si `git add` falla: retorna error `E_DIVERGENCE_SAVE_FAILED`.
- Si `git commit` falla: retorna error `E_DIVERGENCE_SAVE_FAILED`.

### Paso 7 — Verificación y checkout de seguridad ✅ *(núcleo de esta spec)*

```typescript
const finalBranch = await getCurrentBranch(projectDir);
if (finalBranch !== tempBranch) {
  const checkoutTempRes = await runGit(projectDir, ["checkout", tempBranch]);
  if (checkoutTempRes.exitCode !== 0) {
    return gitError(
      "E_DIVERGENCE_SAVE_FAILED",
      `Local changes saved to '${tempBranch}', but could not switch to it automatically.`,
      ...
    );
  }
}
```

**Invariante:** Al finalizar `handleDivergence` con éxito, `getCurrentBranch()` **debe** retornar exactamente `tempBranch`.

### Paso 8 — Respuesta exitosa

```typescript
return {
  ok: true,
  divergenceDetected: true,
  savedBranch: tempBranch,
  message: buildDivergenceMessage(tempBranch, stashPopHadConflicts),
};
```

El mensaje informa al usuario: *"Your local changes have been saved in the branch '<tempBranch>'. You are now working on '<tempBranch>'."*

---

## ⚠️ Edge Cases

| # | Escenario | Comportamiento esperado |
|---|-----------|------------------------|
| EC-01 | El nombre `local-changes-YYYYMMDD-HHmmss` ya existe | Se agrega sufijo aleatorio de 4 chars y se reintenta. Si falla de nuevo, error `E_DIVERGENCE_SAVE_FAILED`. |
| EC-02 | HEAD está en estado detached | El flujo de divergencia se omite completamente. Retorna `divergenceDetected: false`. No se crea rama temporal. |
| EC-03 | Repositorio vacío (sin commits) | Se omite el stash. Se intenta crear la rama temporal. Si no hay commits, `git checkout -b` puede fallar; el error se propaga como `E_DIVERGENCE_SAVE_FAILED`. |
| EC-04 | `git stash pop` genera conflictos | El flujo continúa. `stashPopHadConflicts = true`. El mensaje final advierte al usuario que revise `git stash list`. |
| EC-05 | `getCurrentBranch()` retorna rama distinta a `tempBranch` tras el commit | Se ejecuta `git checkout <tempBranch>` de seguridad. Si falla, error `E_DIVERGENCE_SAVE_FAILED` con mensaje específico. |
| EC-06 | No hay divergencia real | Retorna `divergenceDetected: false`, `savedBranch: null`. No se crea ninguna rama. |
| EC-07 | Solo hay commits adelantados (árbol limpio) | No se hace stash. Se crea la rama temporal y se hace checkout. No hay commit de consolidación (árbol limpio). |
| EC-08 | `git fetch` falla (sin conexión) | Retorna error inmediatamente. No se ejecuta ningún paso posterior. |
| EC-09 | Dos ejecuciones simultáneas en el mismo segundo | El sufijo aleatorio de 4 chars resuelve la colisión de nombres. |

---

## ✅ Criterios de Aceptación

### CA-01 — Checkout automático garantizado
**Dado** que se detecta divergencia y se crea la rama `local-changes-YYYYMMDD-HHmmss`,  
**cuando** `handleDivergence` retorna `{ ok: true }`,  
**entonces** `git rev-parse --abbrev-ref HEAD` debe retornar exactamente el valor de `savedBranch`.

### CA-02 — Sin intervención manual del usuario
**Dado** el flujo completo de divergencia,  
**cuando** el proceso finaliza exitosamente,  
**entonces** el usuario no debe ejecutar ningún comando adicional para estar en la rama temporal.

### CA-03 — Mensaje informativo correcto
**Dado** que el checkout fue exitoso,  
**cuando** se retorna la respuesta,  
**entonces** `message` debe contener el nombre exacto de `savedBranch` y la frase *"You are now working on"*.

### CA-04 — Error explícito si el checkout falla
**Dado** que `git checkout -b <tempBranch>` o el checkout de seguridad fallan,  
**cuando** se retorna la respuesta,  
**entonces** `ok` debe ser `false`, el código de error debe ser `E_DIVERGENCE_SAVE_FAILED` y el mensaje debe identificar la rama que no pudo activarse.

### CA-05 — Stash restaurado antes del checkout final
**Dado** que se creó un stash,  
**cuando** se hace el checkout a la rama temporal,  
**entonces** los cambios del stash deben estar presentes en el working tree de esa rama (commiteados o con conflictos advertidos).

### CA-06 — Colisión de nombres resuelta automáticamente
**Dado** que `local-changes-YYYYMMDD-HHmmss` ya existe,  
**cuando** se detecta el error `already exists`,  
**entonces** el sistema genera `local-changes-YYYYMMDD-HHmmss-<xxxx>` y completa el flujo sin error.

### CA-07 — HEAD detached no dispara el flujo
**Dado** que HEAD está en estado detached,  
**cuando** se invoca `handleDivergence`,  
**entonces** retorna `{ ok: true, divergenceDetected: false, savedBranch: null }` sin crear ninguna rama.

---

## 📐 Invariantes del Sistema

1. **Al retornar `ok: true` con `divergenceDetected: true`**, `getCurrentBranch()` === `savedBranch`. Siempre.
2. **Nunca se deja el repositorio en estado de stash colgante**: si el stash fue creado y el flujo falla antes del `stash pop`, se ejecuta `stash pop` como rollback.
3. **El nombre de rama temporal es único por ejecución**: el timestamp + sufijo aleatorio garantiza unicidad práctica.

---

## 🔗 Referencias

- **Función principal:** `handleDivergence` en `src/electron/git-branches.ts` (líneas 341–491)
- **Formato de nombre:** `formatDivergenceBranchName` (líneas 230–243)
- **Mensaje al usuario:** `buildDivergenceMessage` (líneas 255–262)
- **Bridge IPC:** `GIT_HANDLE_DIVERGENCE` en `src/electron/bridge.types.ts` (línea 522)
- **Hook UI:** `useGitConfig.ts` — manejo de `divergenceHandled`, `divergenceMessage`, `divergenceError`
- **Tests:** `tests/electron/git-divergence.test.ts`
