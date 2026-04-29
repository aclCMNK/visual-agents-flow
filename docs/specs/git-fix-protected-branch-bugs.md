# 🧠 Spec: Git Modal — Corrección de Bugs en Rama Protegida

**Versión:** 1.0  
**Fecha:** 2026-04-28  
**Scope:** Modal Git → secciones Branches y Changes  
**Estado:** Listo para implementación

---

## 🎯 Objetivo

Corregir dos comportamientos incorrectos relacionados con la rama protegida (`protectedBranch`) en el modal Git:

1. **Bug #1 — Branches / Create Branch:** La rama protegida (main/master/custom) está siendo excluida del selector de rama base (`From:`), impidiendo crear ramas desde ella. Esto es incorrecto: el bloqueo de rama protegida solo debe aplicar a commit y push, **no** a crear ramas desde ella.

2. **Bug #2 — Changes / Commit:** El bloqueo de commit en rama protegida existe en el hook (`useGitChanges`) y en la UI (`CommitActionSection`), pero **no existe en el backend** (`git-changes.ts → addAndCommit`). Si alguien llama al IPC directamente o el guard del hook falla, el commit se ejecutaría igualmente. El bloqueo debe ser **absoluto y multicapa**.

---

## 🧩 Contexto Técnico

### Archivos involucrados

| Archivo | Rol |
|---|---|
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | UI de Branches — selector de rama base y creación |
| `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | UI de Changes — formulario de commit y botón de acción |
| `src/ui/hooks/useGitBranches.ts` | Hook de estado para Branches |
| `src/ui/hooks/useGitChanges.ts` | Hook de estado para Changes — contiene guard de rama protegida |
| `src/electron/git-branches.ts` | Backend IPC — lógica de `createBranch` |
| `src/electron/git-changes.ts` | Backend IPC — lógica de `addAndCommit` |
| `src/electron/bridge.types.ts` | Tipos compartidos IPC |

### Flujo actual (con bugs)

```
[GitBranchesPanel]
  └─ BranchCreatorSection
       └─ orderedLocalBranches  ← filtra TODAS las ramas locales sin excluir protegida ✓
       └─ sourceBranch select   ← muestra todas las ramas locales ✓ (no hay bug aquí en el componente)
       
[GitBranchesPanel → selectableBranches]  ← BUG: excluye main/master si no son protectedBranch
  └─ filtra b.name === "main" || "master" si no son protectedBranch  ← esto afecta BranchSelectorSection
  └─ NO afecta BranchCreatorSection directamente (usa allLocalBranches)

[git-branches.ts → createBranch]
  └─ protectedNames = ["main", "master"]  ← BUG: bloquea crear ramas DESDE main/master como SOURCE
  └─ Valida que el NOMBRE de la nueva rama no sea main/master ← correcto
  └─ Pero también bloquea si sourceBranch es main/master ← INCORRECTO

[useGitChanges → addAndCommit]
  └─ Guard: if currentBranch === protectedBranch → return error ✓ (existe)
  
[git-changes.ts → addAndCommit]
  └─ NO tiene guard de rama protegida ← BUG: backend no valida rama protegida
  └─ El IPC recibe (projectDir, message, description) pero no recibe protectedBranch
```

---

## 🐛 Bug #1 — Branches: Rama protegida no disponible como base para crear ramas

### Descripción del problema

En `git-branches.ts`, la función `createBranch` tiene esta validación:

```typescript
// git-branches.ts línea 548-554
const protectedNames = ["main", "master"];
if (protectedNames.includes(trimmed.toLowerCase())) {
  return gitError(
    "E_INVALID_BRANCH_NAME",
    `Cannot create a branch named '${trimmed}'.`,
  );
}
```

Esta validación es correcta para el **nombre de la nueva rama**, pero el problema es que la variable `protectedNames` está hardcodeada con `["main", "master"]` y se aplica **solo al nombre destino**, no al source. Sin embargo, el backend **no bloquea** el source branch — el bug real está en que el backend no recibe el `protectedBranch` configurado por el usuario.

El bug principal está en que el backend hardcodea `["main", "master"]` como nombres prohibidos para la **nueva rama**, pero si el usuario tiene una rama protegida custom (ej: `develop`), el backend no lo sabe.

Adicionalmente, en `GitBranchesPanel.tsx`, el `selectableBranches` (usado en `BranchSelectorSection`) excluye `main`/`master` si no son `protectedBranch`, pero `BranchCreatorSection` recibe `allLocalBranches` directamente — por lo que el selector `From:` **sí muestra todas las ramas**. El bug en el backend es el punto crítico.

### Corrección requerida

#### `src/electron/git-branches.ts` — función `createBranch`

**Cambio:** El IPC debe recibir `protectedBranch` opcional. La validación de nombre prohibido debe usar el `protectedBranch` configurado, no una lista hardcodeada. El `sourceBranch` **nunca debe ser bloqueado** — cualquier rama local válida puede ser base.

**Antes (líneas 543-554):**
```typescript
const trimmed = newBranchName.trim();
if (!trimmed || !/^[a-zA-Z0-9][a-zA-Z0-9\-]*$/.test(trimmed)) {
  return gitError("E_INVALID_BRANCH_NAME", `Invalid branch name: '${trimmed}'.`);
}

const protectedNames = ["main", "master"];
if (protectedNames.includes(trimmed.toLowerCase())) {
  return gitError(
    "E_INVALID_BRANCH_NAME",
    `Cannot create a branch named '${trimmed}'.`,
  );
}
```

**Después:**
```typescript
const trimmed = newBranchName.trim();
if (!trimmed || !/^[a-zA-Z0-9][a-zA-Z0-9\-]*$/.test(trimmed)) {
  return gitError("E_INVALID_BRANCH_NAME", `Invalid branch name: '${trimmed}'.`);
}

// Solo bloquear si el NOMBRE de la nueva rama coincide con la rama protegida configurada.
// El sourceBranch puede ser cualquier rama local, incluyendo la protegida.
if (protectedBranch && trimmed === protectedBranch) {
  return gitError(
    "E_INVALID_BRANCH_NAME",
    `Cannot create a branch named '${trimmed}' — it is the protected branch.`,
  );
}
// Fallback: nunca permitir nombrar la nueva rama exactamente "main" o "master"
// si no hay protectedBranch configurado.
if (!protectedBranch && ["main", "master"].includes(trimmed.toLowerCase())) {
  return gitError(
    "E_INVALID_BRANCH_NAME",
    `Cannot create a branch named '${trimmed}'.`,
  );
}
```

#### `src/electron/bridge.types.ts` — `GitCreateBranchRequest`

**Cambio:** Agregar campo opcional `protectedBranch` al request.

```typescript
// Antes
export interface GitCreateBranchRequest {
  projectDir: string;
  newBranchName: string;
  sourceBranch: string;
}

// Después
export interface GitCreateBranchRequest {
  projectDir: string;
  newBranchName: string;
  sourceBranch: string;
  protectedBranch?: string; // rama protegida configurada por el usuario
}
```

#### `src/electron/git-branches.ts` — firma de `createBranch` y handler IPC

```typescript
// Firma actualizada
async function createBranch(
  projectDir: string,
  newBranchName: string,
  sourceBranch: string,
  protectedBranch?: string,  // ← nuevo parámetro
): Promise<GitCreateBranchResponse>

// Handler IPC actualizado
ipcMain.handle(
  IPC_CHANNELS.GIT_CREATE_BRANCH,
  async (_event, req: GitCreateBranchRequest) => {
    return createBranch(
      req.projectDir,
      req.newBranchName,
      req.sourceBranch,
      req.protectedBranch,  // ← pasar al backend
    );
  },
);
```

#### `src/ui/hooks/useGitBranches.ts` — función `createBranch`

**Cambio:** Pasar `protectedBranch` al llamar al bridge.

```typescript
// Antes (línea 504-508)
const res = await bridge.gitCreateBranch({
  projectDir,
  newBranchName,
  sourceBranch,
});

// Después
const res = await bridge.gitCreateBranch({
  projectDir,
  newBranchName,
  sourceBranch,
  protectedBranch: _protectedBranch ?? undefined,
});
```

> **Nota:** El parámetro `_protectedBranch` en `useGitBranches` actualmente se ignora con `void _protectedBranch` (línea 315). Debe dejar de ignorarse y usarse en esta llamada.

#### `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` — `BranchCreatorSection`

El componente ya recibe `allLocalBranches` que incluye todas las ramas locales. El selector `From:` ya muestra la rama protegida como opción. **No requiere cambios en el componente**, solo verificar que el label de la rama protegida sea claro.

**Mejora UX opcional:** Mostrar un indicador visual en el selector `From:` cuando la rama seleccionada es la protegida, para que el usuario sepa que está creando desde la rama principal (sin bloquear la acción).

```tsx
// En BranchCreatorSection, dentro del <select> de sourceBranch:
{orderedLocalBranches.map((branch) => (
  <option key={branch.name} value={branch.name}>
    {branch.name}
    {branch.name === props.currentBranch ? " (current)" : ""}
    {branch.name === props.protectedBranch ? " 🔒 protected" : ""}
  </option>
))}
```

---

## 🐛 Bug #2 — Changes: Commit en rama protegida no bloqueado en backend

### Descripción del problema

El guard actual en `useGitChanges.ts` (líneas 193-206) bloquea el commit **antes** de llamar al bridge:

```typescript
// useGitChanges.ts — guard existente (correcto pero insuficiente)
if (
  protectedBranch &&
  state.currentBranch &&
  state.currentBranch === protectedBranch
) {
  dispatch({ type: "COMMIT_ERROR", error: toUiGitError("...") });
  return; // ← nunca llega al bridge
}
```

Sin embargo, el IPC handler en `git-changes.ts` **no tiene ningún guard**:

```typescript
// git-changes.ts — addAndCommit (sin guard de rama protegida)
async function addAndCommit(
  projectDir: string,
  message: string,
  description?: string,
): Promise<GitAddAndCommitResponse> {
  // ← No valida currentBranch vs protectedBranch
  // ← Ejecuta git add -A y git commit directamente
}
```

Esto significa que si:
- El estado de React tiene un race condition y `state.currentBranch` está vacío momentáneamente
- Alguien llama al IPC directamente desde devtools o un script
- El guard del hook falla por cualquier razón

...el commit se ejecutará en la rama protegida.

### Corrección requerida — Defensa en profundidad (Defense in Depth)

La protección debe existir en **tres capas**:

```
Capa 1: UI (botón deshabilitado)          ← ya existe ✓
Capa 2: Hook (guard antes del bridge)     ← ya existe ✓  
Capa 3: Backend IPC (guard en addAndCommit) ← FALTA — agregar
```

#### `src/electron/bridge.types.ts` — `GitAddAndCommitRequest`

**Cambio:** Agregar `protectedBranch` opcional al request de commit.

```typescript
// Antes (inferido del handler IPC)
// req: { projectDir: string; message: string; description?: string }

// Después — definir interfaz explícita
export interface GitAddAndCommitRequest {
  projectDir: string;
  message: string;
  description?: string;
  protectedBranch?: string; // rama protegida — si currentBranch coincide, abortar
}
```

#### `src/electron/git-changes.ts` — función `addAndCommit`

**Cambio:** Antes de ejecutar cualquier comando git, verificar la rama actual contra `protectedBranch`.

```typescript
async function addAndCommit(
  projectDir: string,
  message: string,
  description?: string,
  protectedBranch?: string,  // ← nuevo parámetro
): Promise<GitAddAndCommitResponse> {
  const repoError = ensureGitRepo(projectDir);
  if (repoError) return repoError;

  if (message.trim().length === 0) {
    return gitError("E_EMPTY_COMMIT_MSG", "Commit message cannot be empty.");
  }

  // ── Guard de rama protegida (Capa 3 — backend) ──────────────────────────
  // Este guard es la última línea de defensa. Nunca debe ejecutarse git add
  // ni git commit si el usuario está en la rama protegida.
  if (protectedBranch) {
    const branchRes = await runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branchRes.exitCode === 0) {
      const currentBranch = branchRes.stdout === "HEAD" ? "" : branchRes.stdout;
      if (currentBranch && currentBranch === protectedBranch) {
        return gitError(
          "E_PROTECTED_BRANCH",
          `Commits to the protected branch '${protectedBranch}' are not allowed.`,
        );
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const addRes = await runGit(projectDir, ["add", "-A"], 30_000);
  // ... resto igual
}
```

#### `src/electron/bridge.types.ts` — nuevo error code

```typescript
// Agregar a GitOperationErrorCode
export type GitOperationErrorCode =
  | "E_NOT_A_GIT_REPO"
  | "E_GIT_NOT_FOUND"
  | "E_TIMEOUT"
  | "E_MERGE_CONFLICT"
  | "E_DIRTY_WORKING_DIR"
  | "E_BRANCH_NOT_FOUND"
  | "E_BRANCH_ALREADY_EXISTS"
  | "E_INVALID_BRANCH_NAME"
  | "E_NO_REMOTE"
  | "E_EMPTY_COMMIT_MSG"
  | "E_NOTHING_TO_COMMIT"
  | "E_PROTECTED_BRANCH"   // ← nuevo
  | "E_UNKNOWN";
```

#### `src/electron/git-changes.ts` — handler IPC actualizado

```typescript
ipcMain.handle(
  IPC_CHANNELS.GIT_ADD_AND_COMMIT,
  async (
    _event,
    req: GitAddAndCommitRequest,
  ) => {
    return addAndCommit(
      req.projectDir,
      req.message,
      req.description,
      req.protectedBranch,  // ← pasar al backend
    );
  },
);
```

#### `src/ui/hooks/useGitChanges.ts` — pasar `protectedBranch` al bridge

```typescript
// Antes (línea 230-234)
const result = await bridge.gitAddAndCommit({
  projectDir,
  message: trimmedMessage,
  description: description.trim().length > 0 ? description : undefined,
});

// Después
const result = await bridge.gitAddAndCommit({
  projectDir,
  message: trimmedMessage,
  description: description.trim().length > 0 ? description : undefined,
  protectedBranch: protectedBranch ?? undefined,  // ← pasar al backend
});
```

#### `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` — UX del error

El componente ya muestra el error de rama protegida en `CommitActionSection`. Sin embargo, si el backend devuelve `E_PROTECTED_BRANCH` (porque el guard del hook falló), el error debe mostrarse igual que cualquier `commitError`.

**Verificar** que `gitErrorUtils.ts` mapee `E_PROTECTED_BRANCH` con un mensaje claro:

```typescript
// En gitErrorUtils.ts — agregar case para E_PROTECTED_BRANCH
case "E_PROTECTED_BRANCH":
  return {
    displayMessage: "🔒 Commits to the protected branch are not allowed.",
    fullMessage: error.message,
  };
```

---

## 🔄 Resumen de cambios por archivo

| Archivo | Tipo de cambio | Descripción |
|---|---|---|
| `src/electron/bridge.types.ts` | Modificación | Agregar `protectedBranch?` a `GitCreateBranchRequest`; agregar `GitAddAndCommitRequest`; agregar `E_PROTECTED_BRANCH` a error codes |
| `src/electron/git-branches.ts` | Modificación | `createBranch` recibe `protectedBranch?`; validación de nombre usa `protectedBranch` en lugar de lista hardcodeada; handler IPC pasa el campo |
| `src/electron/git-changes.ts` | Modificación | `addAndCommit` recibe `protectedBranch?`; guard backend que verifica rama actual antes de ejecutar git; handler IPC pasa el campo |
| `src/ui/hooks/useGitBranches.ts` | Modificación | `_protectedBranch` deja de ignorarse; se pasa a `bridge.gitCreateBranch` |
| `src/ui/hooks/useGitChanges.ts` | Modificación | `bridge.gitAddAndCommit` recibe `protectedBranch` |
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Mejora UX | Label visual en selector `From:` cuando la rama es protegida |
| `src/ui/utils/gitErrorUtils.ts` | Modificación | Mapear `E_PROTECTED_BRANCH` con mensaje de display |

---

## ⚠️ Edge Cases y QA

### Bug #1 — Branches / Create Branch

| Caso | Comportamiento esperado |
|---|---|
| `protectedBranch = "main"`, usuario selecciona `main` como `From:` | ✅ Permitido — se crea la rama desde main |
| `protectedBranch = "main"`, usuario intenta nombrar la nueva rama `"main"` | ❌ Bloqueado — error de validación en UI y backend |
| `protectedBranch = null`, usuario selecciona `main` como `From:` | ✅ Permitido — no hay rama protegida configurada |
| `protectedBranch = "develop"`, usuario selecciona `main` como `From:` | ✅ Permitido — main no es la protegida |
| `protectedBranch = "develop"`, usuario intenta nombrar la nueva rama `"develop"` | ❌ Bloqueado — coincide con protectedBranch |
| `protectedBranch = null`, usuario intenta nombrar la nueva rama `"main"` | ❌ Bloqueado — fallback hardcodeado |
| `sourceBranch` no existe en el repo | ❌ Error `E_BRANCH_NOT_FOUND` del backend |
| Repo sin commits (vacío) | ❌ Error al verificar sourceBranch con `rev-parse` |
| Nombre de nueva rama con caracteres inválidos | ❌ Bloqueado por regex en UI y backend |
| Nombre de nueva rama ya existe | ❌ Bloqueado por `E_BRANCH_ALREADY_EXISTS` |

### Bug #2 — Changes / Commit en rama protegida

| Caso | Comportamiento esperado |
|---|---|
| Usuario en rama protegida, hace click en "Add and Commit" | ❌ Botón deshabilitado (Capa 1) — nunca llega al hook |
| `isProtectedBranch = true` en UI pero botón habilitado por bug | ❌ Hook intercepta (Capa 2) — muestra error, no llama al bridge |
| IPC llamado directamente con `protectedBranch` correcto | ❌ Backend verifica rama actual con `git rev-parse` (Capa 3) — retorna `E_PROTECTED_BRANCH` |
| IPC llamado sin `protectedBranch` (campo omitido) | ✅ Backend no bloquea — comportamiento legacy compatible |
| `state.currentBranch` vacío en el hook (race condition) | ❌ Guard del hook falla, pero backend (Capa 3) lo captura |
| Usuario cambia de rama mientras el modal está abierto | ✅ `loadStatus` actualiza `currentBranch` — guard se recalcula |
| `protectedBranch` es string vacío `""` | ✅ Tratado como `null` — no bloquea (guard usa `if (protectedBranch)`) |
| Repo en estado detached HEAD | ✅ `currentBranch` será `""` — no coincide con ninguna protectedBranch |
| Commit exitoso en rama no protegida | ✅ Flujo normal — sin cambios |
| Backend devuelve `E_PROTECTED_BRANCH` | ✅ `gitErrorUtils` mapea el error y se muestra en `CommitActionSection` |

### QA — Pruebas manuales recomendadas

1. **Crear rama desde main (protegida):**
   - Configurar `protectedBranch = "main"`
   - Abrir modal Git → Branches → Create Branch
   - Seleccionar `main` en `From:`
   - Ingresar nombre válido → click "Create & Checkout"
   - **Esperado:** Rama creada exitosamente desde main

2. **Intentar nombrar nueva rama igual que la protegida:**
   - Configurar `protectedBranch = "main"`
   - Ingresar `"main"` en el campo "New branch:"
   - **Esperado:** Error de validación en UI, botón deshabilitado

3. **Commit bloqueado en rama protegida (UI):**
   - Estar en rama `main` con `protectedBranch = "main"`
   - Abrir modal Git → Changes
   - **Esperado:** Botón "Add and Commit" deshabilitado, banner 🔒 visible

4. **Commit bloqueado en rama protegida (backend):**
   - Simular llamada directa al IPC `GIT_ADD_AND_COMMIT` con `protectedBranch = "main"` estando en `main`
   - **Esperado:** Respuesta `{ ok: false, code: "E_PROTECTED_BRANCH", ... }`

5. **Commit permitido en rama no protegida:**
   - Estar en rama `feature/test` con `protectedBranch = "main"`
   - Realizar commit normal
   - **Esperado:** Commit exitoso

---

## 📝 Notas de implementación

- El campo `protectedBranch` en los requests IPC es **opcional** para mantener compatibilidad hacia atrás. Si no se envía, el backend no aplica el guard de rama protegida.
- El guard del backend en `addAndCommit` ejecuta un `git rev-parse --abbrev-ref HEAD` adicional. Este comando es muy rápido (~5ms) y no tiene impacto perceptible en UX.
- La validación de nombre de rama en `validateBranchName` (UI, `GitBranchesPanel.tsx`) ya recibe `protectedBranch` y bloquea si el nombre coincide. Esta validación es correcta y no requiere cambios.
- El parámetro `_protectedBranch` en `useGitBranches` fue intencionalmente ignorado con `void _protectedBranch`. Al activarlo, verificar que no rompa otros comportamientos del hook.
- El error `E_PROTECTED_BRANCH` debe agregarse al tipo `GitOperationErrorCode` **antes** de usarlo en el backend para mantener type safety.
