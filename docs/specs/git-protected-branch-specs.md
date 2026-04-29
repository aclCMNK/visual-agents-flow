# 📋 Especificaciones Técnicas — Protected Branch (Rama Principal Protegida)

> **Feature:** Protección de la rama principal en el modal Git  
> **Módulo:** `GitIntegrationModal` — GitConfigPanel, GitBranchesPanel, GitChangesPanel  
> **Fecha:** 2026-04-28  
> **Autor:** Weight-Planner  

---

## 📑 Índice

1. [Objetivo y Alcance](#1-objetivo-y-alcance)
2. [Arquitectura General del Cambio](#2-arquitectura-general-del-cambio)
3. [Detección Automática de la Rama Principal](#3-detección-automática-de-la-rama-principal)
4. [Persistencia del Nombre de Rama Protegida](#4-persistencia-del-nombre-de-rama-protegida)
5. [Cambios en el Backend (Electron / IPC)](#5-cambios-en-el-backend-electron--ipc)
6. [Cambios en Hooks (Renderer)](#6-cambios-en-hooks-renderer)
7. [Cambios en Componentes UI](#7-cambios-en-componentes-ui)
8. [Lógica de Validación y Bloqueo](#8-lógica-de-validación-y-bloqueo)
9. [UX — Flujos Completos](#9-ux--flujos-completos)
10. [Edge Cases](#10-edge-cases)
11. [Accesibilidad](#11-accesibilidad)
12. [QA Checklist](#12-qa-checklist)

---

## 1. Objetivo y Alcance

### 1.1 Objetivo

Implementar protección absoluta de la rama principal del repositorio en el modal Git de AgentsFlow, garantizando que:

- La rama principal se detecte automáticamente al conectar un remoto.
- Si no puede detectarse, el usuario la ingresa manualmente y se hace checkout inmediato.
- La rama principal aparece en el selector de `GitBranchesPanel` para permitir pull desde ella.
- Commit y push desde la rama principal están **absolutamente bloqueados** — nunca se ejecuta el comando git.
- El mensaje de error es claro, en inglés, y solo aparece en el contexto de commit/push.

### 1.2 Alcance

| Área | Cambio |
|---|---|
| `src/electron/git-config.ts` | Nueva función `detectMainBranch` + nuevo IPC handler |
| `src/electron/git-changes.ts` | Guardia de rama protegida en `addAndCommit` |
| `src/electron/bridge.types.ts` | Nuevos tipos IPC: `GitDetectMainBranchResponse`, `GitSetMainBranchRequest` |
| `src/ui/hooks/useGitConfig.ts` | Detección + persistencia de `protectedBranch` en estado |
| `src/ui/hooks/useGitChanges.ts` | Guardia de rama protegida antes de commit |
| `src/ui/hooks/useGitBranches.ts` | Incluir rama principal en `selectableBranches` para pull |
| `src/ui/components/GitIntegrationModal/GitConfigPanel.tsx` | Campo manual de rama principal post-conexión |
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Mostrar rama principal en selector con badge |
| `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | Banner de error de rama protegida |

---

## 2. Arquitectura General del Cambio

### 2.1 Flujo de datos

```
[GitConfigPanel]
    │
    ├─ Al conectar remoto → detectMainBranch (IPC)
    │       ├─ Éxito: protectedBranch = "main" | "master" | <detectado>
    │       └─ Fallo: mostrar campo manual → usuario ingresa → checkout inmediato
    │
    └─ protectedBranch se almacena en useGitConfig.state
           │
           ├─ [GitBranchesPanel] recibe protectedBranch como prop
           │       └─ Incluye rama principal en selector (solo pull, no checkout)
           │
           └─ [GitChangesPanel] recibe protectedBranch como prop
                   └─ Antes de commit: si currentBranch === protectedBranch → BLOQUEO
```

### 2.2 Fuente de verdad

`protectedBranch` vive en el estado de `useGitConfig`. Se propaga hacia abajo como prop a los paneles que lo necesitan. **No se persiste en disco** — se re-detecta cada vez que se carga la configuración del repo (al abrir el modal).

### 2.3 Doble guardia (defense in depth)

El bloqueo de commit/push opera en **dos capas independientes**:

1. **Capa UI** (`GitChangesPanel`): el botón "Add and Commit" se deshabilita y se muestra el banner de error.
2. **Capa hook** (`useGitChanges.addAndCommit`): antes de llamar al bridge, se verifica `currentBranch === protectedBranch`. Si coincide, se despacha `COMMIT_ERROR` y se retorna sin llamar al IPC.

El backend (`git-changes.ts`) **no** recibe `protectedBranch` — la guardia es exclusivamente del lado renderer. Esto es intencional: el backend no tiene contexto de qué rama es "principal" para este proyecto.

> **Nota de seguridad:** Si en el futuro se requiere protección a nivel de proceso (e.g. multi-usuario), se puede agregar una guardia en `addAndCommit` del backend recibiendo `protectedBranch` como parámetro. Esta spec no lo requiere.

---

## 3. Detección Automática de la Rama Principal

### 3.1 Estrategia de detección (backend)

Nueva función `detectMainBranch(projectDir: string): Promise<string | null>` en `git-config.ts`.

**Algoritmo (en orden de prioridad):**

```
1. git symbolic-ref refs/remotes/origin/HEAD --short
   → Extrae "origin/main" → normaliza a "main"
   → Si exitCode === 0 y stdout no vacío → retornar nombre normalizado

2. git remote show origin | grep "HEAD branch"
   → Parsea "HEAD branch: main"
   → Si exitCode === 0 y línea encontrada → retornar nombre

3. Verificar existencia de ramas conocidas en orden:
   for branch in ["main", "master", "trunk", "develop"]:
     git rev-parse --verify origin/<branch>
     → Si exitCode === 0 → retornar branch

4. Si todo falla → retornar null
```

**Timeout:** 15 segundos para `git remote show origin` (requiere red). Los demás: 5 segundos.

**Manejo de errores:** Si git no está instalado (`ENOENT`) o el repo no tiene remoto, retornar `null` sin lanzar.

### 3.2 Nuevo IPC channel

```typescript
// En bridge.types.ts
GIT_DETECT_MAIN_BRANCH: "git:detect-main-branch"
```

**Request:**
```typescript
interface GitDetectMainBranchRequest {
  projectDir: string;
}
```

**Response:**
```typescript
type GitDetectMainBranchResponse =
  | { ok: true; branch: string }   // rama detectada
  | { ok: true; branch: null }     // no detectada, pedir al usuario
  | GitOperationError;             // error de git (ENOENT, timeout, etc.)
```

### 3.3 Cuándo se llama

- **Automáticamente** al completar `connect()` en `useGitConfig` (después de `gitSetRemote` + `gitSaveCredentials` + `gitSetIdentity`).
- **Automáticamente** al cargar la config (`loadConfig`) si el repo ya tiene remoto configurado.
- **No** se llama si `hasGit === false` o si `remoteUrl === null`.

---

## 4. Persistencia del Nombre de Rama Protegida

### 4.1 Almacenamiento en estado

`protectedBranch` se agrega al estado de `useGitConfig`:

```typescript
interface GitConfigState {
  // ... campos existentes ...
  protectedBranch: string | null;  // null = no detectada / no configurada
  isDetectingMainBranch: boolean;
  mainBranchDetectError: string | null;
}
```

### 4.2 Acciones del reducer

```typescript
type GitConfigAction =
  | // ... acciones existentes ...
  | { type: "DETECT_MAIN_BRANCH_START" }
  | { type: "DETECT_MAIN_BRANCH_SUCCESS"; branch: string }
  | { type: "DETECT_MAIN_BRANCH_NEEDS_INPUT" }   // branch === null
  | { type: "DETECT_MAIN_BRANCH_ERROR"; error: string }
  | { type: "SET_PROTECTED_BRANCH"; branch: string }  // ingreso manual
```

### 4.3 Re-detección

Al abrir el modal Git (montaje de `GitConfigPanel`), si `remoteUrl !== null`, se llama `detectMainBranch` automáticamente. Si ya hay un `protectedBranch` en estado y la detección falla, se conserva el valor previo (no se borra).

---

## 5. Cambios en el Backend (Electron / IPC)

### 5.1 `src/electron/git-config.ts`

**Agregar función:**

```typescript
async function detectMainBranch(projectDir: string): Promise<string | null> {
  // Paso 1: symbolic-ref
  const symRef = await runGit(
    projectDir,
    ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    5_000
  );
  if (symRef.exitCode === 0 && symRef.stdout) {
    const parts = symRef.stdout.trim().split("/");
    const branch = parts.slice(1).join("/");
    if (branch) return branch;
  }

  // Paso 2: remote show origin
  const remoteShow = await runGit(
    projectDir,
    ["remote", "show", "origin"],
    15_000
  );
  if (remoteShow.exitCode === 0 && remoteShow.stdout) {
    const match = remoteShow.stdout.match(/HEAD branch:\s*(\S+)/);
    if (match?.[1] && match[1] !== "(unknown)") return match[1];
  }

  // Paso 3: verificar ramas conocidas
  for (const candidate of ["main", "master", "trunk", "develop"]) {
    const verifyRes = await runGit(
      projectDir,
      ["rev-parse", "--verify", `origin/${candidate}`],
      5_000
    );
    if (verifyRes.exitCode === 0) return candidate;
  }

  return null;
}
```

**Agregar handler en `registerGitConfigHandlers`:**

```typescript
ipcMain.handle(
  IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH,
  async (_event, req: { projectDir: string }) => {
    try {
      const branch = await detectMainBranch(req.projectDir);
      return { ok: true, branch };
    } catch {
      return { ok: true, branch: null };
    }
  }
);
```

### 5.2 `src/electron/bridge.types.ts`

**Agregar en `IPC_CHANNELS`:**

```typescript
// Detecta la rama principal del repositorio remoto.
// Retorna { ok: true, branch: string | null }.
// branch === null significa que no pudo detectarse automáticamente.
GIT_DETECT_MAIN_BRANCH: "git:detect-main-branch",
```

**Agregar tipos:**

```typescript
/** Response for GIT_DETECT_MAIN_BRANCH */
export type GitDetectMainBranchResponse =
  | { ok: true; branch: string | null }
  | GitOperationError;
```

**Agregar en `GitGetStatusResponse` (ya existente):**

No se modifica — `currentBranch` ya está presente en la respuesta de `gitGetStatus`.

### 5.3 `src/electron/preload.ts`

Agregar exposición del nuevo canal:

```typescript
gitDetectMainBranch: (req: { projectDir: string }) =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH, req),
```

---

## 6. Cambios en Hooks (Renderer)

### 6.1 `src/ui/hooks/useGitConfig.ts`

**Cambios en estado:**

```typescript
interface GitConfigState {
  // ... existentes ...
  protectedBranch: string | null;
  isDetectingMainBranch: boolean;
  mainBranchDetectError: string | null;
  needsMainBranchInput: boolean;  // true cuando detección retorna null
}
```

**Valor inicial:**

```typescript
const initialState: GitConfigState = {
  // ... existentes ...
  protectedBranch: null,
  isDetectingMainBranch: false,
  mainBranchDetectError: null,
  needsMainBranchInput: false,
};
```

**Nuevas acciones en reducer:**

```typescript
case "DETECT_MAIN_BRANCH_START":
  return { ...state, isDetectingMainBranch: true, mainBranchDetectError: null };

case "DETECT_MAIN_BRANCH_SUCCESS":
  return {
    ...state,
    isDetectingMainBranch: false,
    protectedBranch: action.branch,
    needsMainBranchInput: false,
    mainBranchDetectError: null,
  };

case "DETECT_MAIN_BRANCH_NEEDS_INPUT":
  return {
    ...state,
    isDetectingMainBranch: false,
    needsMainBranchInput: true,
    mainBranchDetectError: null,
  };

case "DETECT_MAIN_BRANCH_ERROR":
  return {
    ...state,
    isDetectingMainBranch: false,
    mainBranchDetectError: action.error,
    needsMainBranchInput: true,  // fallback: pedir al usuario
  };

case "SET_PROTECTED_BRANCH":
  return {
    ...state,
    protectedBranch: action.branch,
    needsMainBranchInput: false,
  };
```

**Nueva función `detectMainBranch`:**

```typescript
const detectMainBranch = useCallback(async () => {
  if (!projectDir) return;
  const bridge = getBridge();
  if (!bridge) return;

  dispatch({ type: "DETECT_MAIN_BRANCH_START" });
  try {
    const result = await bridge.gitDetectMainBranch({ projectDir });
    if (!result.ok) {
      dispatch({ type: "DETECT_MAIN_BRANCH_ERROR", error: result.message });
      return;
    }
    if (result.branch === null) {
      dispatch({ type: "DETECT_MAIN_BRANCH_NEEDS_INPUT" });
    } else {
      dispatch({ type: "DETECT_MAIN_BRANCH_SUCCESS", branch: result.branch });
    }
  } catch {
    dispatch({
      type: "DETECT_MAIN_BRANCH_ERROR",
      error: "Could not detect main branch.",
    });
  }
}, [projectDir]);
```

**Nueva función `setProtectedBranch`:**

```typescript
const setProtectedBranch = useCallback(
  async (branch: string, projectDir: string) => {
    const trimmed = branch.trim();
    if (!trimmed) return;
    dispatch({ type: "SET_PROTECTED_BRANCH", branch: trimmed });
    // Hacer checkout inmediato a la rama principal
    const bridge = getBridge();
    if (bridge && projectDir) {
      await bridge.gitCheckoutBranch({ projectDir, branch: trimmed });
    }
  },
  []
);
```

**Integración en `connect()`:**

Al final de `connect()`, después del dispatch de `CONNECT_SUCCESS`, llamar:

```typescript
await detectMainBranch();
```

**Integración en `loadConfig()`:**

Al final de `loadConfig()`, si `result.remoteUrl !== null`, llamar:

```typescript
await detectMainBranch();
```

**Retorno del hook:**

```typescript
return {
  state,
  connectToGit,
  connect,
  checkVisibility,
  clearFeedback,
  detectMainBranch,      // nuevo
  setProtectedBranch,    // nuevo
};
```

### 6.2 `src/ui/hooks/useGitChanges.ts`

**Cambios en la firma del hook:**

```typescript
export function useGitChanges(
  projectDir: string | null,
  protectedBranch: string | null   // nuevo parámetro
)
```

**Guardia en `addAndCommit`:**

Insertar al inicio de `addAndCommit`, antes de cualquier dispatch:

```typescript
// Protected branch guard — absolute block, no git command is ever executed
if (
  protectedBranch &&
  state.currentBranch &&
  state.currentBranch === protectedBranch
) {
  dispatch({
    type: "COMMIT_ERROR",
    error: toUiGitError(
      "You cannot commit or push directly to the main branch."
    ),
  });
  return;
}
```

**Nota:** Este bloqueo es **previo** a cualquier validación de mensaje o llamada al bridge. El error se muestra en el banner de `commitError` existente.

### 6.3 `src/ui/hooks/useGitBranches.ts`

**Cambios en la firma del hook:**

```typescript
export function useGitBranches(
  projectDir: string | null,
  protectedBranch: string | null   // nuevo parámetro
)
```

**Cambios en `LOAD_BRANCHES_SUCCESS`:**

La lógica actual excluye `main` y `master` de `selectableBranches`. Debe reemplazarse para:

1. Incluir la rama protegida en el selector (para permitir pull).
2. Marcarla visualmente como protegida.
3. Excluir otras ramas con nombres `main`/`master` solo si no son la rama protegida configurada.

```typescript
case "LOAD_BRANCHES_SUCCESS": {
  // Incluir la rama protegida en el selector, excluir el resto de main/master
  const selectableBranches = action.branches.filter((b) => {
    if (b.isRemote) return false;
    // Si es la rama protegida configurada, incluirla
    if (action.protectedBranch && b.name === action.protectedBranch) return true;
    // Excluir main/master hardcoded solo si no son la protegida
    if (["main", "master"].includes(b.name)) return false;
    return true;
  });
  // ...resto igual
}
```

**Nota:** La acción `LOAD_BRANCHES_SUCCESS` necesita recibir `protectedBranch` como campo adicional. Alternativamente, `selectableBranches` se puede calcular como `useMemo` en el componente usando `state.branches` y `protectedBranch` como dependencias.

> **Decisión de implementación recomendada:** Calcular `selectableBranches` como `useMemo` en `GitBranchesPanel` en lugar de en el reducer, para evitar pasar `protectedBranch` al reducer. Esto simplifica el hook y mantiene la lógica de filtrado en el componente que tiene acceso a ambos valores.

---

## 7. Cambios en Componentes UI

### 7.1 `GitIntegrationModal.tsx` (orquestador)

El modal orquestador debe:

1. Obtener `protectedBranch`, `needsMainBranchInput`, `isDetectingMainBranch`, `setProtectedBranch` de `useGitConfig`.
2. Pasar `protectedBranch` como prop a `GitBranchesPanel` y `GitChangesPanel`.

```typescript
// En GitIntegrationModal.tsx
const {
  state: gitConfigState,
  // ...
  setProtectedBranch,
} = useGitConfig(projectDir);

// Pasar a paneles:
<GitChangesPanel protectedBranch={gitConfigState.protectedBranch} />
<GitBranchesPanel protectedBranch={gitConfigState.protectedBranch} />
```

> **Nota:** Si los paneles actualmente obtienen `projectDir` del store directamente y no reciben props del modal, se debe evaluar si `protectedBranch` se pasa como prop o se obtiene de un contexto/store compartido. La opción más limpia dado el patrón actual es **prop drilling** desde el modal, ya que el árbol es poco profundo.

### 7.2 `GitConfigPanel.tsx`

**Nuevo sub-componente: `MainBranchInputSection`**

Se muestra cuando `needsMainBranchInput === true` (detección automática falló).

```tsx
interface MainBranchInputSectionProps {
  isDetecting: boolean;
  onConfirm: (branch: string) => void;
}

function MainBranchInputSection(props: MainBranchInputSectionProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validate = (v: string): string | null => {
    if (!v.trim()) return "Branch name is required.";
    if (/\s/.test(v)) return "Branch name cannot contain spaces.";
    return null;
  };

  const handleConfirm = () => {
    const err = validate(value);
    if (err) { setError(err); return; }
    props.onConfirm(value.trim());
  };

  return (
    <section
      className="git-config__section"
      aria-labelledby="git-config-main-branch-title"
    >
      <header className="git-config__section-header">
        <h3 id="git-config-main-branch-title" className="git-config__section-title">
          Main Branch
        </h3>
      </header>

      <p className="git-config__hint">
        Could not detect the main branch automatically. Enter its name to protect it.
      </p>

      <div className="git-config__field">
        <label htmlFor="git-config-main-branch-input" className="git-config__label">
          Branch name <span aria-hidden="true">*</span>
        </label>
        <input
          id="git-config-main-branch-input"
          type="text"
          className={`git-config__input${error ? " git-config__input--error" : ""}`}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          placeholder="e.g. main, master, trunk"
          disabled={props.isDetecting}
          aria-required="true"
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? "git-config-main-branch-error" : undefined}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
        />
        {error && (
          <p
            id="git-config-main-branch-error"
            className="git-config__validation-error"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={handleConfirm}
        disabled={!value.trim() || props.isDetecting}
      >
        Confirm & Checkout
      </button>
    </section>
  );
}
```

**Integración en `GitConfigPanel`:**

Después de la sección Remote (cuando `hasGit === true`), agregar:

```tsx
{/* Detección de rama principal */}
{state.isDetectingMainBranch && (
  <div className="git-config__detecting-branch" role="status" aria-live="polite">
    Detecting main branch…
  </div>
)}

{state.protectedBranch && !state.isDetectingMainBranch && (
  <section className="git-config__section" aria-labelledby="git-config-protected-title">
    <header className="git-config__section-header">
      <h3 id="git-config-protected-title" className="git-config__section-title">
        Protected Branch
      </h3>
    </header>
    <p className="git-config__protected-branch">
      <span className="git-config__protected-icon" aria-hidden="true">🔒</span>
      <span className="git-config__branch-name">{state.protectedBranch}</span>
    </p>
    <p className="git-config__hint">
      Direct commits and pushes to this branch are blocked.
    </p>
  </section>
)}

{state.needsMainBranchInput && !state.isDetectingMainBranch && (
  <MainBranchInputSection
    isDetecting={state.isDetectingMainBranch}
    onConfirm={(branch) => void setProtectedBranch(branch, projectDir!)}
  />
)}
```

### 7.3 `GitBranchesPanel.tsx`

**Cambios en `BranchSelectorSection`:**

Agregar prop `protectedBranch: string | null` a la interfaz.

La rama protegida debe aparecer en el selector con un badge visual y solo permitir **pull** (no checkout):

```tsx
interface BranchSelectorSectionProps {
  // ... existentes ...
  protectedBranch: string | null;  // nuevo
}
```

**Lógica de `selectableBranches` (en `GitBranchesPanel`):**

```typescript
const selectableBranches = useMemo(() => {
  return state.branches.filter((b) => {
    if (b.isRemote) return false;
    if (protectedBranch && b.name === protectedBranch) return true;
    if (["main", "master"].includes(b.name) && b.name !== protectedBranch) return false;
    return true;
  });
}, [state.branches, protectedBranch]);
```

**Renderizado del selector:**

```tsx
<select
  id="git-branches-select"
  className="git-branches__select"
  aria-label="Select branch"
  value={props.selectedBranch}
  onChange={(e) => props.onSelectBranch(e.target.value)}
  disabled={props.isCheckingOut || props.isPullingBranch}
>
  {selectableBranches.map((branch) => (
    <option key={branch.name} value={branch.name}>
      {branch.name === props.protectedBranch
        ? `🔒 ${branch.name} (protected)`
        : branch.name}
    </option>
  ))}
</select>
```

**Botón Checkout deshabilitado para rama protegida:**

```tsx
<button
  type="button"
  className="btn btn--secondary"
  disabled={
    props.isCheckingOut ||
    !props.selectedBranch ||
    props.isPullingBranch ||
    isCurrentSelected ||
    props.selectedBranch === props.protectedBranch  // ← nuevo
  }
  title={
    props.selectedBranch === props.protectedBranch
      ? "Cannot checkout the protected branch directly"
      : undefined
  }
  onClick={props.onCheckoutBranch}
>
  {isCurrentSelected
    ? "✓ Current"
    : props.isCheckingOut
      ? "Loading…"
      : "⎇ Checkout"}
</button>
```

> **Nota:** El pull desde la rama protegida **sí está permitido** (es el caso de uso legítimo: traer cambios del main a la rama de trabajo actual). Solo el checkout directo a la rama protegida está bloqueado en la UI.

### 7.4 `GitChangesPanel.tsx`

**Cambios en `CommitActionSection`:**

Agregar prop `isProtectedBranch: boolean`:

```tsx
interface CommitActionSectionProps {
  // ... existentes ...
  isProtectedBranch: boolean;  // nuevo
}
```

**Lógica de `canCommit`:**

```typescript
const canCommit =
  props.commitMessage.trim().length > 0 &&
  props.hasChanges &&
  !props.isCommitting &&
  !props.isProtectedBranch;  // ← nuevo
```

**Banner de error de rama protegida:**

Mostrar **antes** del banner de `commitError` genérico, con estilo diferenciado:

```tsx
{props.isProtectedBranch && (
  <div
    className="git-changes__protected-branch-error"
    role="alert"
    aria-live="assertive"
  >
    <span aria-hidden="true">🔒</span>{" "}
    You cannot commit or push directly to the main branch.
  </div>
)}
```

**Cambios en `GitChangesPanel` (componente raíz):**

```typescript
// Recibir protectedBranch como prop
interface GitChangesPanelProps {
  protectedBranch: string | null;
}

export function GitChangesPanel({ protectedBranch }: GitChangesPanelProps) {
  // ...
  const isProtectedBranch =
    Boolean(protectedBranch) &&
    Boolean(state.currentBranch) &&
    state.currentBranch === protectedBranch;

  // Pasar a CommitActionSection:
  // isProtectedBranch={isProtectedBranch}
}
```

**Cambios en `CurrentBranchSection`:**

Mostrar badge de protección junto al nombre de la rama:

```tsx
function CurrentBranchSection({
  currentBranch,
  isLoading,
  isProtected,  // nuevo prop
}: CurrentBranchSectionProps & { isProtected: boolean }) {
  return (
    <section ...>
      {/* ... */}
      <p className="git-changes__current-branch">
        <span aria-hidden="true">⎇</span>
        <span className="git-changes__branch-name">
          {currentBranch || "(detached HEAD)"}
        </span>
        {isProtected && (
          <span
            className="git-changes__protected-badge"
            aria-label="Protected branch"
            title="This is the protected main branch. Commits are blocked."
          >
            🔒
          </span>
        )}
      </p>
    </section>
  );
}
```

---

## 8. Lógica de Validación y Bloqueo

### 8.1 Reglas de bloqueo

| Acción | Condición de bloqueo | Comportamiento |
|---|---|---|
| Commit | `currentBranch === protectedBranch` | Botón deshabilitado + banner de error |
| Push (implícito en commit) | `currentBranch === protectedBranch` | Nunca se ejecuta (bloqueado antes) |
| Checkout a rama protegida | `selectedBranch === protectedBranch` | Botón Checkout deshabilitado |
| Pull desde rama protegida | Nunca bloqueado | Permitido (caso de uso legítimo) |
| Crear rama con nombre protegido | `newBranchName === protectedBranch` | Error de validación en BranchCreatorSection |

### 8.2 Mensaje de error exacto

```
"You cannot commit or push directly to the main branch."
```

- Solo en inglés.
- Solo aparece en el contexto de commit/push (`CommitActionSection`).
- No aparece en otras secciones del modal.

### 8.3 Comparación de nombres de rama

La comparación es **case-sensitive** y **exacta**:

```typescript
state.currentBranch === protectedBranch
```

Rationale: los nombres de ramas en git son case-sensitive. No se normaliza a lowercase para evitar falsos positivos (e.g. `Main` ≠ `main`).

### 8.4 Estado `protectedBranch === null`

Si `protectedBranch` es `null` (no detectada, usuario no la ingresó), **no hay bloqueo**. El sistema opera en modo permisivo. Esto es intencional: no bloquear si no hay información suficiente.

---

## 9. UX — Flujos Completos

### 9.1 Flujo A: Detección automática exitosa

```
1. Usuario abre modal Git → pestaña Config
2. loadConfig() detecta remoteUrl existente
3. detectMainBranch() se ejecuta automáticamente
4. Spinner "Detecting main branch…" visible brevemente
5. Resultado: protectedBranch = "main"
6. Se muestra sección "Protected Branch" con 🔒 main
7. Usuario va a pestaña Changes → ve 🔒 badge en "Current Branch" si está en main
8. Intenta commit → botón deshabilitado + banner de error
9. Usuario va a pestaña Branches → ve "🔒 main (protected)" en selector
10. Puede hacer Pull desde main → permitido
11. Botón Checkout deshabilitado para main
```

### 9.2 Flujo B: Detección automática falla

```
1. Usuario conecta remoto nuevo (sin symbolic-ref configurado)
2. detectMainBranch() retorna null
3. Se muestra sección "Main Branch" con campo de texto
4. Usuario escribe "main" → presiona "Confirm & Checkout"
5. setProtectedBranch("main") → dispatch SET_PROTECTED_BRANCH
6. gitCheckoutBranch({ branch: "main" }) se ejecuta inmediatamente
7. protectedBranch = "main" en estado
8. Flujo continúa igual que Flujo A desde paso 6
```

### 9.3 Flujo C: Repo sin remoto

```
1. Usuario abre modal Git → repo sin remoto configurado
2. loadConfig() → remoteUrl = null
3. detectMainBranch() NO se llama
4. protectedBranch = null
5. No hay bloqueo de commit (modo permisivo)
6. Usuario conecta remoto → detectMainBranch() se llama automáticamente
```

### 9.4 Flujo D: Usuario en rama de trabajo (caso normal)

```
1. currentBranch = "feature/my-feature"
2. protectedBranch = "main"
3. currentBranch !== protectedBranch → sin bloqueo
4. Commit y push funcionan normalmente
```

---

## 10. Edge Cases

### 10.1 Repo sin commits

- `detectMainBranch()` puede fallar en el paso 1 (symbolic-ref) si no hay commits.
- El paso 3 (rev-parse) también fallará.
- Resultado: `branch = null` → se muestra campo manual.
- **Comportamiento esperado:** correcto, el usuario ingresa el nombre.

### 10.2 Rama protegida eliminada del remoto

- `protectedBranch` sigue en estado (no se re-detecta automáticamente).
- El bloqueo sigue activo si el usuario está en esa rama localmente.
- **Comportamiento esperado:** conservador, no se pierde la protección.

### 10.3 Múltiples ramas "principales" (e.g. main y master ambas existen)

- El algoritmo retorna la primera que encuentra (en orden de prioridad).
- Solo una rama es protegida a la vez.
- **Comportamiento esperado:** aceptable para el caso de uso.

### 10.4 `protectedBranch` con caracteres especiales

- La validación del campo manual rechaza espacios.
- No se valida exhaustivamente (se confía en que git rechazará nombres inválidos en el checkout).
- **Comportamiento esperado:** si el checkout falla, se muestra el error de git.

### 10.5 Detached HEAD

- `currentBranch` = `""` cuando HEAD está detached.
- `"" === protectedBranch` → `false` (nunca bloquea en detached HEAD).
- **Comportamiento esperado:** correcto.

### 10.6 `protectedBranch` cambia entre sesiones

- No se persiste en disco → se re-detecta al abrir el modal.
- Si el remoto cambió su rama principal, la detección lo reflejará.
- **Comportamiento esperado:** correcto.

### 10.7 Timeout en `git remote show origin`

- Timeout de 15 segundos.
- Si falla, se continúa con el paso 3 (verificar ramas conocidas).
- Si todo falla, `branch = null` → campo manual.
- **Comportamiento esperado:** degradación elegante.

### 10.8 Bridge no disponible (fuera de Electron)

- `getBridge()` retorna `null`.
- `detectMainBranch()` retorna sin hacer nada.
- `protectedBranch` queda `null` → modo permisivo.
- **Comportamiento esperado:** correcto para entorno de desarrollo web.

---

## 11. Accesibilidad

### 11.1 Roles y atributos ARIA

| Elemento | Atributo | Valor |
|---|---|---|
| Banner de error rama protegida | `role="alert"` | — |
| Banner de error rama protegida | `aria-live="assertive"` | — |
| Badge 🔒 en CurrentBranchSection | `aria-label="Protected branch"` | — |
| Badge 🔒 en CurrentBranchSection | `title="This is the protected main branch. Commits are blocked."` | — |
| Botón Checkout deshabilitado | `title="Cannot checkout the protected branch directly"` | — |
| Campo manual de rama | `aria-required="true"` | — |
| Campo manual de rama | `aria-invalid` | `"true"` cuando hay error |
| Campo manual de rama | `aria-describedby` | ID del párrafo de error |
| Spinner de detección | `role="status"` | — |
| Spinner de detección | `aria-live="polite"` | — |

### 11.2 Navegación por teclado

- El campo manual de rama responde a `Enter` para confirmar.
- El botón "Confirm & Checkout" es alcanzable con Tab.
- El botón Checkout deshabilitado para rama protegida tiene `title` descriptivo.
- El banner de error de rama protegida es anunciado inmediatamente por lectores de pantalla (`aria-live="assertive"`).

### 11.3 Contraste y visibilidad

- El banner de error de rama protegida debe usar la clase CSS de error existente (`git-branches__error-banner`) o una variante específica (`git-changes__protected-branch-error`) con contraste mínimo WCAG AA.
- El badge 🔒 es decorativo pero tiene `aria-label` para lectores de pantalla.
- El emoji 🔒 en el `<option>` del selector puede no renderizarse en todos los OS — es aceptable como mejora visual, no como única señal.

### 11.4 Estados de carga

- "Detecting main branch…" usa `role="status"` + `aria-live="polite"` para no interrumpir.
- El spinner no bloquea la interacción con otras secciones del modal.

---

## 12. QA Checklist

### 12.1 Detección automática

- [ ] Al conectar un remoto con `main` como rama principal, `protectedBranch` se establece en `"main"` automáticamente.
- [ ] Al conectar un remoto con `master` como rama principal, `protectedBranch` se establece en `"master"` automáticamente.
- [ ] Al abrir el modal con un remoto ya configurado, la detección se ejecuta automáticamente.
- [ ] Si la detección falla (sin symbolic-ref, sin red), se muestra el campo manual.
- [ ] El spinner "Detecting main branch…" aparece durante la detección y desaparece al terminar.
- [ ] Si la detección tarda más de 15 segundos (timeout), se muestra el campo manual.

### 12.2 Campo manual

- [ ] El campo manual aparece solo cuando la detección automática falla o retorna null.
- [ ] El campo manual no aparece si `protectedBranch` ya está establecido.
- [ ] Ingresar un nombre vacío muestra error "Branch name is required."
- [ ] Ingresar un nombre con espacios muestra error "Branch name cannot contain spaces."
- [ ] Al confirmar, se hace checkout inmediato a la rama ingresada.
- [ ] Si el checkout falla (rama no existe), se muestra el error de git.
- [ ] Presionar Enter en el campo confirma la acción.

### 12.3 Sección Protected Branch en GitConfigPanel

- [ ] Se muestra el nombre de la rama protegida con el ícono 🔒.
- [ ] No se muestra si `protectedBranch === null`.
- [ ] El texto "Direct commits and pushes to this branch are blocked." es visible.

### 12.4 GitBranchesPanel — Selector

- [ ] La rama protegida aparece en el selector con el label "🔒 [nombre] (protected)".
- [ ] El botón Pull está habilitado cuando la rama protegida está seleccionada.
- [ ] El botón Checkout está deshabilitado cuando la rama protegida está seleccionada.
- [ ] El botón Checkout tiene `title` descriptivo cuando está deshabilitado por protección.
- [ ] Las ramas `main`/`master` que NO son la rama protegida siguen excluidas del selector.
- [ ] Si `protectedBranch === null`, el selector funciona igual que antes (sin cambios).

### 12.5 GitChangesPanel — Bloqueo de commit

- [ ] Si `currentBranch === protectedBranch`, el botón "Add and Commit" está deshabilitado.
- [ ] El banner "You cannot commit or push directly to the main branch." aparece cuando `currentBranch === protectedBranch`.
- [ ] El banner NO aparece cuando `currentBranch !== protectedBranch`.
- [ ] El banner NO aparece cuando `protectedBranch === null`.
- [ ] El badge 🔒 aparece junto al nombre de la rama en "Current Branch" cuando es la protegida.
- [ ] El hook `useGitChanges.addAndCommit` retorna sin llamar al bridge cuando la rama es protegida.
- [ ] El error se despacha como `COMMIT_ERROR` con el mensaje exacto.
- [ ] El mensaje de error es exactamente: `"You cannot commit or push directly to the main branch."`

### 12.6 Casos límite

- [ ] En detached HEAD (`currentBranch === ""`), no hay bloqueo de commit.
- [ ] Con `protectedBranch === null`, no hay bloqueo de commit.
- [ ] Cambiar de rama (checkout a feature branch) elimina el bloqueo.
- [ ] Volver a la rama protegida (checkout manual desde terminal) reactiva el bloqueo al refrescar el status.
- [ ] El bloqueo funciona aunque el usuario haya ingresado un mensaje de commit válido.

### 12.7 Accesibilidad

- [ ] El banner de error de rama protegida es anunciado por lectores de pantalla (VoiceOver / NVDA).
- [ ] El badge 🔒 tiene `aria-label="Protected branch"`.
- [ ] El campo manual tiene `aria-required`, `aria-invalid`, `aria-describedby` correctos.
- [ ] El botón Checkout deshabilitado tiene `title` descriptivo.
- [ ] La navegación por teclado funciona en el campo manual (Tab, Enter).

### 12.8 Regresión

- [ ] El flujo de commit en rama de trabajo (no protegida) funciona sin cambios.
- [ ] El pull desde cualquier rama funciona sin cambios.
- [ ] El checkout entre ramas no protegidas funciona sin cambios.
- [ ] La creación de ramas funciona sin cambios.
- [ ] La detección de visibilidad del remoto funciona sin cambios.
- [ ] El flujo de conexión a remoto privado (con credenciales) funciona sin cambios.

---

## Apéndice A: Resumen de Archivos Afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/electron/git-config.ts` | Nueva función `detectMainBranch` + nuevo IPC handler |
| `src/electron/bridge.types.ts` | Nuevo channel `GIT_DETECT_MAIN_BRANCH` + tipo `GitDetectMainBranchResponse` |
| `src/electron/preload.ts` | Exposición de `gitDetectMainBranch` en `window.agentsFlow` |
| `src/ui/hooks/useGitConfig.ts` | Nuevo estado `protectedBranch`, acciones, función `detectMainBranch`, `setProtectedBranch` |
| `src/ui/hooks/useGitChanges.ts` | Nuevo parámetro `protectedBranch`, guardia en `addAndCommit` |
| `src/ui/hooks/useGitBranches.ts` | Nuevo parámetro `protectedBranch` (opcional, para filtrado) |
| `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx` | Prop drilling de `protectedBranch` a paneles hijos |
| `src/ui/components/GitIntegrationModal/GitConfigPanel.tsx` | Nuevo sub-componente `MainBranchInputSection`, sección "Protected Branch" |
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Prop `protectedBranch`, lógica de selector, bloqueo de checkout |
| `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | Prop `protectedBranch`, banner de error, badge en CurrentBranchSection |

## Apéndice B: Nuevas Clases CSS Requeridas

| Clase | Uso |
|---|---|
| `.git-config__detecting-branch` | Spinner de detección de rama principal |
| `.git-config__protected-branch` | Contenedor del nombre de rama protegida |
| `.git-config__protected-icon` | Ícono 🔒 en sección Protected Branch |
| `.git-config__field` | Campo de formulario (si no existe ya) |
| `.git-config__input` | Input de texto (si no existe ya) |
| `.git-config__input--error` | Variante de error del input |
| `.git-config__validation-error` | Texto de error de validación inline |
| `.git-changes__protected-branch-error` | Banner de error de rama protegida en ChangesPanel |
| `.git-changes__protected-badge` | Badge 🔒 junto al nombre de rama en CurrentBranchSection |
