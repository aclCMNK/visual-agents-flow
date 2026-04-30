# Spec: El Usuario Queda en la Rama Temporal — Sin Checkout Posterior

**ID:** GIT-DIV-002  
**Fecha:** 2026-04-29  
**Estado:** Pendiente de implementación  
**Alcance:** Ajuste puntual — eliminar cualquier checkout posterior a la rama principal dentro de `handleDivergence`  
**Relacionada con:** GIT-DIV-001 (`checkout-local-changes-spec.md`)

---

## 🎯 Objetivo

Garantizar que, una vez creada la rama temporal `local-changes-YYYYMMDD-HHmmss` y hecho checkout en ella, el sistema **no ejecute ningún checkout adicional** que mueva al usuario a otra rama. El usuario debe quedar trabajando en la rama temporal al finalizar el flujo, con una notificación clara de su posición actual.

---

## 🧩 Contexto

### Problema concreto

La spec GIT-DIV-001 documenta el flujo de divergencia y establece que el usuario debe quedar en `tempBranch`. Sin embargo, existe o puede existir código posterior a la creación de la rama temporal que ejecuta un `git checkout <mainBranch>` o equivalente, ya sea:

- Como parte de un flujo de "limpieza" o "sincronización" posterior.
- Como paso de integración del remoto (merge/rebase sobre la rama principal).
- Como efecto secundario de alguna función auxiliar invocada después de `handleDivergence`.

Este comportamiento es **incorrecto**: el usuario pierde su posición en la rama temporal sin saberlo, y sus cambios quedan en una rama a la que no tiene acceso inmediato.

### Comportamiento actual (incorrecto)

```
1. Se detecta divergencia
2. Se crea rama temporal: local-changes-20260429-143022
3. git checkout -b local-changes-20260429-143022   ← usuario queda aquí
4. [stash pop, commit de consolidación]
5. git checkout main   ← ❌ el usuario es movido fuera de la rama temporal
6. [operaciones sobre main]
7. Retorna ok: true — pero el usuario está en main, no en la rama temporal
```

### Comportamiento esperado (correcto)

```
1. Se detecta divergencia
2. Se crea rama temporal: local-changes-20260429-143022
3. git checkout -b local-changes-20260429-143022   ← usuario queda aquí
4. [stash pop, commit de consolidación]
5. ✅ FIN — el usuario permanece en local-changes-20260429-143022
6. Retorna ok: true con mensaje: "Estás en la rama local-changes-20260429-143022"
```

### Archivos en alcance

```
src/electron/git-branches.ts
  └── function handleDivergence(projectDir, remoteBranch)
      └── cualquier llamada a git checkout / runGit(["checkout", ...]) posterior al paso de creación de tempBranch
```

> **Fuera de alcance:** lógica de stash, generación del nombre de rama, detección de divergencia, flujo de integración del remoto en otras funciones no relacionadas con `handleDivergence`.

---

## 🚀 Pasos Detallados del Ajuste

### Paso 1 — Auditoría del código actual

Revisar `handleDivergence` en `src/electron/git-branches.ts` e identificar **todas** las llamadas a:

```typescript
runGit(projectDir, ["checkout", ...])
runGit(projectDir, ["switch", ...])
```

que ocurran **después** de la línea donde se ejecuta `git checkout -b <tempBranch>`.

**Criterio de eliminación:** cualquier checkout cuyo destino sea distinto de `tempBranch` debe ser eliminado o reubicado fuera de `handleDivergence`.

### Paso 2 — Eliminar el checkout posterior a la rama principal

Si existe una llamada del tipo:

```typescript
await runGit(projectDir, ["checkout", remoteBranch]);
// o
await runGit(projectDir, ["checkout", mainBranch]);
// o
await runGit(projectDir, ["switch", originalBranch]);
```

después de la creación de `tempBranch`, **debe eliminarse** de `handleDivergence`.

Si esa operación es necesaria para otro propósito (ej. integrar el remoto), debe delegarse a una función separada que se invoque **después** de que el usuario haya sido notificado y haya dado su consentimiento explícito.

### Paso 3 — Verificar que el checkout de seguridad apunta a `tempBranch`

El único checkout permitido al final de `handleDivergence` es el de seguridad documentado en GIT-DIV-001:

```typescript
const finalBranch = await getCurrentBranch(projectDir);
if (finalBranch !== tempBranch) {
  await runGit(projectDir, ["checkout", tempBranch]);
}
```

Este checkout **sí debe permanecer** — es el mecanismo de garantía de posición.

### Paso 4 — Actualizar el mensaje de retorno

El mensaje retornado al usuario debe ser explícito sobre su posición actual:

```typescript
return {
  ok: true,
  divergenceDetected: true,
  savedBranch: tempBranch,
  message: `Tus cambios locales han sido guardados en la rama '${tempBranch}'. Ahora estás trabajando en '${tempBranch}'. No se realizaron cambios en tu rama principal.`,
};
```

El mensaje debe cumplir:
- Nombrar la rama temporal exacta.
- Confirmar que el usuario **está ahí ahora**.
- Aclarar que la rama principal **no fue modificada**.

### Paso 5 — Verificación post-ajuste

Después del ajuste, ejecutar manualmente o mediante test:

```bash
git rev-parse --abbrev-ref HEAD
# Debe retornar: local-changes-YYYYMMDD-HHmmss
```

---

## ⚠️ Edge Cases

| # | Escenario | Comportamiento esperado |
|---|-----------|------------------------|
| EC-01 | El checkout posterior a `main` estaba integrado en el flujo de merge/rebase | Ese paso se extrae de `handleDivergence` y se mueve a una función separada. `handleDivergence` no lo invoca. |
| EC-02 | Existe un `finally` block que hace checkout a la rama original | El `finally` block debe ser eliminado o condicionado para no ejecutarse cuando `divergenceDetected === true`. |
| EC-03 | La UI llama a otra función después de `handleDivergence` que hace checkout | Esa función debe ser auditada por separado. Esta spec solo cubre `handleDivergence`. |
| EC-04 | El usuario cierra la app mientras está en la rama temporal | El estado persiste en git. Al reabrir, el usuario sigue en la rama temporal. No es responsabilidad de esta spec. |
| EC-05 | `handleDivergence` es invocado en un contexto donde se espera que el repo quede en `main` | El contrato de la función cambia: quien llame a `handleDivergence` debe asumir que el repo quedará en `tempBranch`, no en `main`. |
| EC-06 | Hay un `git merge` o `git rebase` sobre `main` dentro de `handleDivergence` | Esas operaciones implican un checkout previo a `main`. Deben eliminarse de `handleDivergence` y delegarse. |

---

## ✅ Criterios de Aceptación

### CA-01 — El usuario queda en la rama temporal al finalizar
**Dado** que se detecta divergencia y `handleDivergence` retorna `{ ok: true }`,  
**cuando** se consulta `git rev-parse --abbrev-ref HEAD`,  
**entonces** el resultado es exactamente el valor de `savedBranch` (`local-changes-YYYYMMDD-HHmmss`).

### CA-02 — No existe checkout a rama principal dentro de `handleDivergence`
**Dado** el código fuente de `handleDivergence` tras el ajuste,  
**cuando** se audita el código,  
**entonces** no existe ninguna llamada a `runGit(["checkout", X])` donde `X !== tempBranch` después de la creación de `tempBranch`.

### CA-03 — El mensaje confirma la posición del usuario
**Dado** que `handleDivergence` retorna `{ ok: true }`,  
**cuando** se lee el campo `message`,  
**entonces** contiene el nombre exacto de `savedBranch` y la confirmación de que el usuario está en esa rama.

### CA-04 — La rama principal no es modificada por `handleDivergence`
**Dado** que se ejecuta `handleDivergence` con divergencia detectada,  
**cuando** el flujo finaliza,  
**entonces** la rama principal (`main` / `master` / `remoteBranch`) no tiene commits nuevos ni cambios en su HEAD respecto al estado previo a la ejecución.

### CA-05 — El checkout de seguridad a `tempBranch` permanece funcional
**Dado** que `git checkout -b <tempBranch>` falla silenciosamente o HEAD queda en otra rama por algún motivo,  
**cuando** se ejecuta la verificación de seguridad,  
**entonces** se ejecuta `git checkout <tempBranch>` y el usuario queda en la rama temporal.

### CA-06 — El test de integración valida la posición final
**Dado** un test en `tests/electron/git-divergence.test.ts`,  
**cuando** se simula divergencia y se invoca `handleDivergence`,  
**entonces** el test verifica que `getCurrentBranch()` === `savedBranch` al finalizar.

---

## 📐 Invariante Central

> **Al retornar `{ ok: true, divergenceDetected: true }`, `getCurrentBranch()` debe ser igual a `savedBranch`. Sin excepciones. Sin checkouts posteriores.**

---

## 🔗 Referencias

- **Spec base:** `ai_docs/git-divergence/checkout-local-changes-spec.md` (GIT-DIV-001)
- **Función afectada:** `handleDivergence` en `src/electron/git-branches.ts`
- **Test relacionado:** `tests/electron/git-divergence.test.ts`
- **Bridge IPC:** `GIT_HANDLE_DIVERGENCE` en `src/electron/bridge.types.ts`
- **Hook UI:** `useGitConfig.ts` — campo `divergenceMessage` debe reflejar la rama temporal activa
