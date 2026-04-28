# 🧠 Plan de Solución — GitBranchesPanel: Implementación Completa

## 🎯 Objective

Implementar la sección **Branches** dentro del modal `GitIntegrationModal` del editor AgentsFlow, cubriendo:

1. **Cambios remotos pendientes** — muestra commits del remoto que no están en local, con botón Fetch + Pull.
2. **Selector de ramas** — muestra la rama actual, lista todas las ramas excluyendo `main`/`master`, con botón Pull y botón Checkout.
3. **Historial de commits de la rama seleccionada** — subsección separada que muestra los commits de la rama preseleccionada en el selector.

---

## 🧩 Context

### Estado actual del codebase

| Archivo | Estado |
|---------|--------|
| `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Placeholder vacío — solo retorna `"Branches — coming soon."` |
| `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx` | Funcional — layout sidebar + content ya implementado |
| `src/electron/git-detector.ts` | Solo detecta `origin` URL — no tiene operaciones git |
| `src/electron/bridge.types.ts` | Tiene `IPC_CHANNELS` y `AgentsFlowBridge` — sin canales git de branches |
| `src/electron/preload.ts` | Expone `window.agentsFlow` — sin métodos git de branches |
| `src/electron/ipc-handlers.ts` | Registra handlers IPC — sin handlers git de branches |
| `src/ui/store/projectStore.ts` | Tiene `gitRemoteOrigin: string | null` — sin estado de branches |

### Patrón IPC del proyecto

El proyecto usa el patrón **invoke/handle** de Electron:

```
Renderer → ipcRenderer.invoke(CHANNEL, payload) → Main → ipcMain.handle(CHANNEL, handler)
```

Todos los canales están declarados en `IPC_CHANNELS` (`bridge.types.ts`).  
El bridge se expone en `preload.ts` como `window.agentsFlow`.  
Los handlers se registran en `ipc-handlers.ts`.

### Patrón de ejecución git

`git-detector.ts` usa `execFile` con `cwd: projectDir` y `timeout: 3000ms`. El mismo patrón se usará para todos los comandos git nuevos.

### Restricciones del proyecto

- No usar librerías git de terceros (solo `execFile` + comandos `git` nativos).
- No CSS Modules — clases globales BEM-like en `app.css`.
- No agregar estado git al store global de Zustand (estado local en el componente con `useState`/`useReducer`).
- Todos los errores IPC deben resolverse (nunca rechazar) — retornar `{ ok: false, error: string }`.
- El `projectDir` se obtiene de `useProjectStore(s => s.project?.projectDir)`.

---

## 🧭 Strategy

### Enfoque general

1. **Capa IPC (Main Process):** Crear un módulo `git-branches.ts` con todas las operaciones git necesarias, registrar sus handlers en `ipc-handlers.ts`, declarar los canales en `IPC_CHANNELS`, y exponerlos en `preload.ts`.
2. **Capa de tipos:** Declarar todos los request/response types en `bridge.types.ts`.
3. **Hook React:** Crear `useGitBranches.ts` que encapsula toda la lógica de estado y llamadas IPC.
4. **Componente UI:** Implementar `GitBranchesPanel.tsx` usando el hook, con tres subsecciones visuales claramente separadas.
5. **CSS:** Agregar estilos en `app.css` bajo el bloque `.git-modal__*` existente.

### Decisiones de diseño clave

| Decisión | Razón |
|----------|-------|
| Estado local (no Zustand) | El estado de branches es efímero y específico del modal — no necesita persistir ni ser compartido |
| `useReducer` en el hook | Múltiples estados relacionados (loading, branches, commits, errors) — más manejable que múltiples `useState` |
| Módulo `git-branches.ts` separado | Mantiene `ipc-handlers.ts` limpio; sigue el patrón de `git-detector.ts` |
| Polling manual (no auto-refresh) | El usuario controla cuándo hacer fetch — evita operaciones de red no solicitadas |
| Rama seleccionada en selector ≠ rama activa del repo | El selector es para "previsualizar" commits — el checkout es una acción explícita |

---

## 🚀 Phases

---

### 🔹 Phase 1: Tipos IPC en `bridge.types.ts`

**Description:**  
Declarar todos los tipos de request/response para las operaciones git de branches. Estos tipos son el contrato entre el main process y el renderer.

**Archivo:** `src/electron/bridge.types.ts`

**Tasks:**

- **Task 1.1:** Agregar canales IPC en `IPC_CHANNELS`:

  ```ts
  // ── Git Branches channels ──────────────────────────────────────────────────
  
  // Lista todas las ramas locales y remotas del repositorio.
  // Retorna la rama activa actual y el listado completo.
  GIT_LIST_BRANCHES: "git:list-branches",
  
  // Obtiene los commits del remoto que no están en local (ahead/behind).
  // Equivale a: git fetch --dry-run + git log HEAD..origin/<branch>
  GIT_GET_REMOTE_DIFF: "git:get-remote-diff",
  
  // Ejecuta git fetch + git pull en la rama actual.
  GIT_FETCH_AND_PULL: "git:fetch-and-pull",
  
  // Ejecuta git pull en la rama especificada.
  GIT_PULL_BRANCH: "git:pull-branch",
  
  // Ejecuta git checkout para cambiar a la rama especificada.
  GIT_CHECKOUT_BRANCH: "git:checkout-branch",
  
  // Obtiene el historial de commits de una rama específica.
  GIT_GET_BRANCH_COMMITS: "git:get-branch-commits",
  ```

- **Task 1.2:** Declarar tipos de datos compartidos:

  ```ts
  // ── Git Branches IPC types ─────────────────────────────────────────────────
  
  /** Un commit de git serializable */
  export interface GitCommit {
    /** Hash corto del commit (7 chars) */
    hash: string;
    /** Hash completo */
    fullHash: string;
    /** Mensaje del commit (primera línea) */
    message: string;
    /** Autor del commit */
    author: string;
    /** Fecha ISO 8601 del commit */
    date: string;
    /** Fecha relativa legible (e.g. "2 days ago") */
    relativeDate: string;
  }
  
  /** Una rama de git */
  export interface GitBranch {
    /** Nombre de la rama (sin prefijo remoto) */
    name: string;
    /** True si es la rama actualmente activa (HEAD) */
    isCurrent: boolean;
    /** True si es una rama remota */
    isRemote: boolean;
    /** Nombre del remoto (e.g. "origin"), solo para ramas remotas */
    remote?: string;
    /** True si la rama tiene un tracking remoto configurado */
    hasUpstream: boolean;
    /** Número de commits locales no pusheados al remoto */
    aheadCount?: number;
    /** Número de commits remotos no pulleados al local */
    behindCount?: number;
  }
  ```

- **Task 1.3:** Declarar request/response types por operación:

  ```ts
  // ── GIT_LIST_BRANCHES ──────────────────────────────────────────────────────
  
  export interface GitListBranchesRequest {
    projectDir: string;
  }
  
  export interface GitListBranchesResult {
    ok: true;
    /** Nombre de la rama activa actual */
    currentBranch: string;
    /** Todas las ramas locales (excluyendo main/master en el selector, pero incluidas aquí para info) */
    branches: GitBranch[];
  }
  
  export type GitListBranchesResponse = GitListBranchesResult | GitOperationError;
  
  // ── GIT_GET_REMOTE_DIFF ────────────────────────────────────────────────────
  
  export interface GitGetRemoteDiffRequest {
    projectDir: string;
    /** Rama a comparar (por defecto la rama actual) */
    branch?: string;
  }
  
  export interface GitGetRemoteDiffResult {
    ok: true;
    /** Commits en el remoto que no están en local */
    incomingCommits: GitCommit[];
    /** Número de commits locales no pusheados */
    aheadCount: number;
    /** Número de commits remotos no pulleados */
    behindCount: number;
    /** True si no hay remoto configurado para esta rama */
    noUpstream: boolean;
  }
  
  export type GitGetRemoteDiffResponse = GitGetRemoteDiffResult | GitOperationError;
  
  // ── GIT_FETCH_AND_PULL ─────────────────────────────────────────────────────
  
  export interface GitFetchAndPullRequest {
    projectDir: string;
  }
  
  export interface GitFetchAndPullResult {
    ok: true;
    /** Output del comando git pull */
    output: string;
    /** True si ya estaba up-to-date */
    alreadyUpToDate: boolean;
  }
  
  export type GitFetchAndPullResponse = GitFetchAndPullResult | GitOperationError;
  
  // ── GIT_PULL_BRANCH ────────────────────────────────────────────────────────
  
  export interface GitPullBranchRequest {
    projectDir: string;
    /** Nombre de la rama a pullear */
    branch: string;
  }
  
  export interface GitPullBranchResult {
    ok: true;
    output: string;
    alreadyUpToDate: boolean;
  }
  
  export type GitPullBranchResponse = GitPullBranchResult | GitOperationError;
  
  // ── GIT_CHECKOUT_BRANCH ────────────────────────────────────────────────────
  
  export interface GitCheckoutBranchRequest {
    projectDir: string;
    /** Nombre de la rama a la que cambiar */
    branch: string;
  }
  
  export interface GitCheckoutBranchResult {
    ok: true;
    /** Nombre de la rama a la que se cambió */
    branch: string;
    output: string;
  }
  
  export type GitCheckoutBranchResponse = GitCheckoutBranchResult | GitOperationError;
  
  // ── GIT_GET_BRANCH_COMMITS ─────────────────────────────────────────────────
  
  export interface GitGetBranchCommitsRequest {
    projectDir: string;
    /** Nombre de la rama */
    branch: string;
    /** Número máximo de commits a retornar (default: 20) */
    limit?: number;
  }
  
  export interface GitGetBranchCommitsResult {
    ok: true;
    branch: string;
    commits: GitCommit[];
  }
  
  export type GitGetBranchCommitsResponse = GitGetBranchCommitsResult | GitOperationError;
  
  // ── Error envelope compartido ──────────────────────────────────────────────
  
  export type GitOperationErrorCode =
    | "E_NOT_A_GIT_REPO"    // El directorio no es un repositorio git
    | "E_NO_REMOTE"         // No hay remoto configurado
    | "E_GIT_NOT_FOUND"     // git no está instalado o no está en PATH
    | "E_MERGE_CONFLICT"    // El pull resultó en conflictos
    | "E_DIRTY_WORKING_DIR" // Hay cambios sin commitear que bloquean el checkout
    | "E_BRANCH_NOT_FOUND"  // La rama especificada no existe
    | "E_TIMEOUT"           // El comando git tardó más de 10s
    | "E_UNKNOWN";          // Error inesperado
  
  export interface GitOperationError {
    ok: false;
    code: GitOperationErrorCode;
    message: string;
    /** Output raw del comando git (para debugging) */
    rawOutput?: string;
  }
  ```

- **Task 1.4:** Agregar los métodos al tipo `AgentsFlowBridge`:

  ```ts
  // En la interfaz AgentsFlowBridge, agregar:
  gitListBranches(req: GitListBranchesRequest): Promise<GitListBranchesResponse>;
  gitGetRemoteDiff(req: GitGetRemoteDiffRequest): Promise<GitGetRemoteDiffResponse>;
  gitFetchAndPull(req: GitFetchAndPullRequest): Promise<GitFetchAndPullResponse>;
  gitPullBranch(req: GitPullBranchRequest): Promise<GitPullBranchResponse>;
  gitCheckoutBranch(req: GitCheckoutBranchRequest): Promise<GitCheckoutBranchResponse>;
  gitGetBranchCommits(req: GitGetBranchCommitsRequest): Promise<GitGetBranchCommitsResponse>;
  ```

- **Task 1.5:** Agregar stubs en `_stub` de `projectStore.ts`:

  ```ts
  gitListBranches: () => notAvailable("gitListBranches"),
  gitGetRemoteDiff: () => notAvailable("gitGetRemoteDiff"),
  gitFetchAndPull: () => notAvailable("gitFetchAndPull"),
  gitPullBranch: () => notAvailable("gitPullBranch"),
  gitCheckoutBranch: () => notAvailable("gitCheckoutBranch"),
  gitGetBranchCommits: () => notAvailable("gitGetBranchCommits"),
  ```

---

### 🔹 Phase 2: Módulo Main Process `git-branches.ts`

**Description:**  
Crear el módulo que implementa todas las operaciones git usando `execFile`. Sigue el mismo patrón de `git-detector.ts`: sin imports de Electron, sin throws al caller, timeout explícito.

**Archivo a crear:** `src/electron/git-branches.ts`

**Tasks:**

- **Task 2.1:** Implementar helper `runGit(projectDir, args, timeoutMs)`:

  ```ts
  /**
   * Ejecuta un comando git en el directorio dado.
   * Nunca lanza — siempre resuelve con { stdout, stderr, exitCode }.
   */
  async function runGit(
    projectDir: string,
    args: string[],
    timeoutMs = 10_000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      execFile(
        "git",
        args,
        { cwd: projectDir, timeout: timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          const exitCode = (error as NodeJS.ErrnoException & { code?: number })?.code ?? 0;
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: typeof exitCode === "number" ? exitCode : (error ? 1 : 0),
          });
        },
      );
    });
  }
  ```

- **Task 2.2:** Implementar `listBranches(projectDir)`:

  Comandos git usados:
  ```bash
  git branch --format="%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)"
  git fetch --dry-run 2>&1  # para detectar si hay remoto
  ```

  Lógica:
  1. Verificar que `.git` existe en `projectDir`.
  2. Ejecutar `git branch --format=...` para obtener ramas locales.
  3. Parsear cada línea: `name|isCurrent|upstream|track`.
  4. Parsear `track` para extraer `ahead N` y `behind N`.
  5. Retornar `GitListBranchesResult` con `currentBranch` y `branches[]`.

  Edge cases:
  - Repo sin commits (HEAD no existe): retornar `branches: []`, `currentBranch: ""`.
  - Rama sin upstream: `hasUpstream: false`, `aheadCount: 0`, `behindCount: 0`.
  - `git` no en PATH: `exitCode !== 0` con `ENOENT` → retornar `E_GIT_NOT_FOUND`.

- **Task 2.3:** Implementar `getRemoteDiff(projectDir, branch?)`:

  Comandos git usados:
  ```bash
  git fetch origin                          # actualiza refs remotas
  git log HEAD..origin/<branch> --oneline --format="%H|%h|%s|%an|%aI|%ar"
  git rev-list --count HEAD..origin/<branch>   # behindCount
  git rev-list --count origin/<branch>..HEAD   # aheadCount
  ```

  Lógica:
  1. Ejecutar `git fetch origin` (con timeout 15s).
  2. Obtener la rama actual si `branch` no se especifica.
  3. Ejecutar `git log HEAD..origin/<branch>` para commits entrantes.
  4. Parsear cada línea del log en `GitCommit`.
  5. Obtener `aheadCount` y `behindCount`.
  6. Si no hay upstream: `noUpstream: true`, listas vacías.

  Edge cases:
  - Sin conexión a internet: `git fetch` falla → retornar `E_NO_REMOTE` con el stderr.
  - Rama sin upstream: detectar con `git rev-parse --abbrev-ref @{u}` → si falla, `noUpstream: true`.
  - Timeout en fetch: retornar `E_TIMEOUT`.

- **Task 2.4:** Implementar `fetchAndPull(projectDir)`:

  Comandos git usados:
  ```bash
  git pull --ff-only
  ```

  Lógica:
  1. Ejecutar `git pull --ff-only` (timeout 30s).
  2. Si stdout contiene `"Already up to date"`: `alreadyUpToDate: true`.
  3. Si stderr contiene `"CONFLICT"`: retornar `E_MERGE_CONFLICT`.
  4. Si stderr contiene `"Your local changes"`: retornar `E_DIRTY_WORKING_DIR`.

  Edge cases:
  - Sin upstream: retornar `E_NO_REMOTE`.
  - Conflictos de merge: retornar `E_MERGE_CONFLICT` con `rawOutput`.
  - Working directory sucio: retornar `E_DIRTY_WORKING_DIR`.

- **Task 2.5:** Implementar `pullBranch(projectDir, branch)`:

  Comandos git usados:
  ```bash
  git pull origin <branch>
  ```

  Misma lógica de error que `fetchAndPull`.

- **Task 2.6:** Implementar `checkoutBranch(projectDir, branch)`:

  Comandos git usados:
  ```bash
  git checkout <branch>
  ```

  Lógica:
  1. Ejecutar `git checkout <branch>`.
  2. Si exitCode 0: retornar `GitCheckoutBranchResult`.
  3. Si stderr contiene `"did not match any"`: retornar `E_BRANCH_NOT_FOUND`.
  4. Si stderr contiene `"Your local changes"`: retornar `E_DIRTY_WORKING_DIR`.

  Edge cases:
  - Checkout a rama remota sin tracking local: `git checkout -b <branch> origin/<branch>` como fallback.
  - Rama ya activa: exitCode 0, output `"Already on '<branch>'"`.

- **Task 2.7:** Implementar `getBranchCommits(projectDir, branch, limit = 20)`:

  Comandos git usados:
  ```bash
  git log <branch> --format="%H|%h|%s|%an|%aI|%ar" -n <limit>
  ```

  Lógica:
  1. Ejecutar `git log <branch> --format=... -n <limit>`.
  2. Parsear cada línea en `GitCommit`.
  3. Si la rama no existe: retornar `E_BRANCH_NOT_FOUND`.

- **Task 2.8:** Exportar función `registerGitBranchesHandlers(ipcMain)`:

  ```ts
  export function registerGitBranchesHandlers(ipcMain: IpcMain): void {
    ipcMain.handle(IPC_CHANNELS.GIT_LIST_BRANCHES,    handleListBranches);
    ipcMain.handle(IPC_CHANNELS.GIT_GET_REMOTE_DIFF,  handleGetRemoteDiff);
    ipcMain.handle(IPC_CHANNELS.GIT_FETCH_AND_PULL,   handleFetchAndPull);
    ipcMain.handle(IPC_CHANNELS.GIT_PULL_BRANCH,      handlePullBranch);
    ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT_BRANCH,  handleCheckoutBranch);
    ipcMain.handle(IPC_CHANNELS.GIT_GET_BRANCH_COMMITS, handleGetBranchCommits);
  }
  ```

---

### 🔹 Phase 3: Registro de handlers en `ipc-handlers.ts`

**Description:**  
Importar y llamar `registerGitBranchesHandlers` desde el archivo de registro central de handlers.

**Archivo:** `src/electron/ipc-handlers.ts`

**Tasks:**

- **Task 3.1:** Agregar import:
  ```ts
  import { registerGitBranchesHandlers } from "./git-branches.ts";
  ```

- **Task 3.2:** Llamar la función de registro dentro de la función principal de registro de handlers:
  ```ts
  registerGitBranchesHandlers(ipcMain);
  ```

---

### 🔹 Phase 4: Exposición en `preload.ts`

**Description:**  
Exponer los nuevos métodos git en `window.agentsFlow` a través del `contextBridge`.

**Archivo:** `src/electron/preload.ts`

**Tasks:**

- **Task 4.1:** Agregar imports de tipos:
  ```ts
  import type {
    GitListBranchesRequest,
    GitListBranchesResponse,
    GitGetRemoteDiffRequest,
    GitGetRemoteDiffResponse,
    GitFetchAndPullRequest,
    GitFetchAndPullResponse,
    GitPullBranchRequest,
    GitPullBranchResponse,
    GitCheckoutBranchRequest,
    GitCheckoutBranchResponse,
    GitGetBranchCommitsRequest,
    GitGetBranchCommitsResponse,
  } from "./bridge.types.ts";
  ```

- **Task 4.2:** Agregar métodos en el objeto expuesto por `contextBridge.exposeInMainWorld("agentsFlow", {...})`:
  ```ts
  gitListBranches: (req: GitListBranchesRequest): Promise<GitListBranchesResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_LIST_BRANCHES, req),
  
  gitGetRemoteDiff: (req: GitGetRemoteDiffRequest): Promise<GitGetRemoteDiffResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_REMOTE_DIFF, req),
  
  gitFetchAndPull: (req: GitFetchAndPullRequest): Promise<GitFetchAndPullResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_FETCH_AND_PULL, req),
  
  gitPullBranch: (req: GitPullBranchRequest): Promise<GitPullBranchResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL_BRANCH, req),
  
  gitCheckoutBranch: (req: GitCheckoutBranchRequest): Promise<GitCheckoutBranchResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT_BRANCH, req),
  
  gitGetBranchCommits: (req: GitGetBranchCommitsRequest): Promise<GitGetBranchCommitsResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCH_COMMITS, req),
  ```

---

### 🔹 Phase 5: Hook `useGitBranches.ts`

**Description:**  
Crear el hook React que encapsula todo el estado y las llamadas IPC para el panel de branches. Usa `useReducer` para manejar el estado complejo de forma predecible.

**Archivo a crear:** `src/ui/hooks/useGitBranches.ts`

**Tasks:**

- **Task 5.1:** Definir el estado del hook:

  ```ts
  interface GitBranchesState {
    // ── Datos ──────────────────────────────────────────────────────────────
    currentBranch: string;
    branches: GitBranch[];                  // todas las ramas locales
    selectableBranches: GitBranch[];        // branches sin main/master
    selectedBranch: string;                 // rama seleccionada en el selector
    incomingCommits: GitCommit[];           // commits remotos pendientes
    aheadCount: number;
    behindCount: number;
    noUpstream: boolean;
    branchCommits: GitCommit[];             // commits de la rama seleccionada
    
    // ── Loading states ─────────────────────────────────────────────────────
    isLoadingBranches: boolean;
    isLoadingRemoteDiff: boolean;
    isFetchingAndPulling: boolean;
    isPullingBranch: boolean;
    isCheckingOut: boolean;
    isLoadingCommits: boolean;
    
    // ── Errores ────────────────────────────────────────────────────────────
    branchesError: string | null;
    remoteDiffError: string | null;
    fetchPullError: string | null;
    pullBranchError: string | null;
    checkoutError: string | null;
    commitsError: string | null;
    
    // ── Feedback de éxito ──────────────────────────────────────────────────
    lastFetchPullSuccess: string | null;    // mensaje de éxito del último pull
    lastCheckoutSuccess: string | null;     // nombre de rama tras checkout exitoso
  }
  ```

- **Task 5.2:** Definir acciones del reducer:

  ```ts
  type GitBranchesAction =
    | { type: "LOAD_BRANCHES_START" }
    | { type: "LOAD_BRANCHES_SUCCESS"; branches: GitBranch[]; currentBranch: string }
    | { type: "LOAD_BRANCHES_ERROR"; error: string }
    | { type: "SELECT_BRANCH"; branch: string }
    | { type: "LOAD_REMOTE_DIFF_START" }
    | { type: "LOAD_REMOTE_DIFF_SUCCESS"; incomingCommits: GitCommit[]; aheadCount: number; behindCount: number; noUpstream: boolean }
    | { type: "LOAD_REMOTE_DIFF_ERROR"; error: string }
    | { type: "FETCH_PULL_START" }
    | { type: "FETCH_PULL_SUCCESS"; output: string; alreadyUpToDate: boolean }
    | { type: "FETCH_PULL_ERROR"; error: string }
    | { type: "PULL_BRANCH_START" }
    | { type: "PULL_BRANCH_SUCCESS"; output: string }
    | { type: "PULL_BRANCH_ERROR"; error: string }
    | { type: "CHECKOUT_START" }
    | { type: "CHECKOUT_SUCCESS"; branch: string }
    | { type: "CHECKOUT_ERROR"; error: string }
    | { type: "LOAD_COMMITS_START" }
    | { type: "LOAD_COMMITS_SUCCESS"; commits: GitCommit[]; branch: string }
    | { type: "LOAD_COMMITS_ERROR"; error: string }
    | { type: "CLEAR_ERRORS" };
  ```

- **Task 5.3:** Implementar el reducer con lógica de transición de estados.

- **Task 5.4:** Implementar el hook `useGitBranches(projectDir: string | null)`:

  ```ts
  export function useGitBranches(projectDir: string | null) {
    const [state, dispatch] = useReducer(reducer, initialState);
    const bridge = getBridge(); // mismo patrón que projectStore.ts
    
    // Cargar branches al montar o cuando cambia projectDir
    useEffect(() => {
      if (!projectDir) return;
      loadBranches();
    }, [projectDir]);
    
    // Cargar commits cuando cambia la rama seleccionada
    useEffect(() => {
      if (!projectDir || !state.selectedBranch) return;
      loadBranchCommits(state.selectedBranch);
    }, [state.selectedBranch, projectDir]);
    
    // Cargar remote diff al montar
    useEffect(() => {
      if (!projectDir) return;
      loadRemoteDiff();
    }, [projectDir]);
    
    const loadBranches = useCallback(async () => { ... }, [projectDir]);
    const loadRemoteDiff = useCallback(async () => { ... }, [projectDir]);
    const fetchAndPull = useCallback(async () => { ... }, [projectDir]);
    const pullBranch = useCallback(async (branch: string) => { ... }, [projectDir]);
    const checkoutBranch = useCallback(async (branch: string) => { ... }, [projectDir]);
    const loadBranchCommits = useCallback(async (branch: string) => { ... }, [projectDir]);
    const selectBranch = useCallback((branch: string) => {
      dispatch({ type: "SELECT_BRANCH", branch });
    }, []);
    
    return { state, loadBranches, loadRemoteDiff, fetchAndPull, pullBranch, checkoutBranch, selectBranch };
  }
  ```

  **Nota sobre `getBridge()`:** Importar y reutilizar el mismo helper de `projectStore.ts` o duplicarlo localmente en el hook. Preferir importarlo si se exporta, o duplicar el patrón si no.

- **Task 5.5:** Lógica de `selectableBranches`:

  ```ts
  // En LOAD_BRANCHES_SUCCESS:
  const PROTECTED_BRANCHES = ["main", "master"];
  const selectableBranches = branches.filter(
    b => !PROTECTED_BRANCHES.includes(b.name) && !b.isRemote
  );
  // Si la rama actual no está en selectableBranches, seleccionar la primera disponible
  const selectedBranch = selectableBranches.find(b => b.isCurrent)?.name
    ?? selectableBranches[0]?.name
    ?? "";
  ```

---

### 🔹 Phase 6: Componente `GitBranchesPanel.tsx`

**Description:**  
Implementar el componente visual completo con tres subsecciones claramente diferenciadas.

**Archivo:** `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx`

**Tasks:**

- **Task 6.1:** Estructura general del componente:

  ```tsx
  export function GitBranchesPanel() {
    const projectDir = useProjectStore(s => s.project?.projectDir ?? null);
    const { state, loadBranches, loadRemoteDiff, fetchAndPull, pullBranch, checkoutBranch, selectBranch } = useGitBranches(projectDir);
    
    if (!projectDir) {
      return <div className="git-branches__no-project">No project open.</div>;
    }
    
    return (
      <div className="git-branches">
        {/* Subsección 1: Cambios remotos pendientes */}
        <RemoteChangesSection ... />
        
        {/* Divisor */}
        <div className="git-branches__divider" />
        
        {/* Subsección 2: Selector de ramas + acciones */}
        <BranchSelectorSection ... />
        
        {/* Divisor */}
        <div className="git-branches__divider" />
        
        {/* Subsección 3: Commits de la rama seleccionada */}
        <BranchCommitsSection ... />
      </div>
    );
  }
  ```

- **Task 6.2:** Implementar `RemoteChangesSection`:

  **Props:**
  ```ts
  interface RemoteChangesSectionProps {
    incomingCommits: GitCommit[];
    aheadCount: number;
    behindCount: number;
    noUpstream: boolean;
    isLoadingRemoteDiff: boolean;
    isFetchingAndPulling: boolean;
    error: string | null;
    successMessage: string | null;
    onFetchAndPull: () => void;
    onRefresh: () => void;
  }
  ```

  **Layout visual:**
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  Remote Changes                          [↻ Refresh]        │
  │  ─────────────────────────────────────────────────────────  │
  │  ↓ 3 commits behind · ↑ 1 commit ahead                     │
  │                                                             │
  │  • abc1234  "Fix login bug"  — John  2 days ago            │
  │  • def5678  "Add tests"      — Jane  3 days ago            │
  │  • ghi9012  "Update deps"    — John  5 days ago            │
  │                                                             │
  │                              [⬇ Fetch & Pull]              │
  └─────────────────────────────────────────────────────────────┘
  ```

  **Estados especiales:**
  - `noUpstream: true` → mostrar mensaje "No remote tracking branch configured."
  - `isLoadingRemoteDiff: true` → mostrar spinner en lugar de la lista.
  - `incomingCommits.length === 0 && !noUpstream` → mostrar "✓ Up to date with remote."
  - `isFetchingAndPulling: true` → deshabilitar botón y mostrar spinner en él.
  - `error !== null` → mostrar banner de error con el mensaje.
  - `successMessage !== null` → mostrar banner de éxito (auto-dismiss en 3s).

- **Task 6.3:** Implementar `BranchSelectorSection`:

  **Props:**
  ```ts
  interface BranchSelectorSectionProps {
    currentBranch: string;
    selectableBranches: GitBranch[];
    selectedBranch: string;
    isLoadingBranches: boolean;
    isPullingBranch: boolean;
    isCheckingOut: boolean;
    pullError: string | null;
    checkoutError: string | null;
    checkoutSuccess: string | null;
    onSelectBranch: (branch: string) => void;
    onPullBranch: () => void;
    onCheckoutBranch: () => void;
  }
  ```

  **Layout visual:**
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  Branch                                                     │
  │  Current: main                                              │
  │  ─────────────────────────────────────────────────────────  │
  │                                                             │
  │  [▼ feature/login-fix          ]  [⬇ Pull]  [⎇ Checkout]  │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
  ```

  **Reglas del selector:**
  - Usar `<select>` nativo con las clases CSS del proyecto.
  - Mostrar `currentBranch` como texto informativo (no en el selector).
  - El selector lista solo `selectableBranches` (sin main/master).
  - Si `selectableBranches` está vacío: mostrar mensaje "No other branches available."
  - Botón **Pull**: `disabled` si `isPullingBranch || !selectedBranch || isCheckingOut`.
  - Botón **Checkout**: `disabled` si `isCheckingOut || !selectedBranch || isPullingBranch`.
  - Si `selectedBranch === currentBranch`: el botón Checkout muestra "✓ Current" y está deshabilitado.
  - Errores de pull/checkout: mostrar inline debajo del selector.
  - Éxito de checkout: mostrar mensaje "Switched to branch '<name>'" y recargar branches.

- **Task 6.4:** Implementar `BranchCommitsSection`:

  **Props:**
  ```ts
  interface BranchCommitsSectionProps {
    selectedBranch: string;
    commits: GitCommit[];
    isLoading: boolean;
    error: string | null;
  }
  ```

  **Layout visual:**
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  Commits in "feature/login-fix"                             │
  │  ─────────────────────────────────────────────────────────  │
  │                                                             │
  │  ● abc1234  Fix login validation          John  2 days ago  │
  │  ● def5678  Add unit tests for auth       Jane  3 days ago  │
  │  ● ghi9012  Refactor auth module          John  5 days ago  │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
  ```

  **Estados especiales:**
  - `isLoading: true` → spinner.
  - `commits.length === 0` → "No commits found in this branch."
  - `error !== null` → banner de error.
  - `!selectedBranch` → "Select a branch to see its commits."
  - Máximo 20 commits visibles (configurable via `limit` en el request).

---

### 🔹 Phase 7: CSS en `app.css`

**Description:**  
Agregar todos los estilos necesarios para el panel de branches. Se insertan después del bloque `.git-modal__section-placeholder` existente.

**Archivo:** `src/ui/styles/app.css`

**Bloque CSS a agregar:**

```css
/* ── Git Branches Panel ──────────────────────────────────────────────────── */

.git-branches {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
}

/* Divisor entre subsecciones */
.git-branches__divider {
  height: 1px;
  background: var(--color-border);
  margin: 16px 0;
  flex-shrink: 0;
}

/* ── Subsección genérica ─────────────────────────────────────────────────── */

.git-branches__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.git-branches__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-branches__section-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

/* ── Subsección 1: Remote Changes ────────────────────────────────────────── */

.git-branches__remote-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.git-branches__remote-status--behind {
  color: var(--color-warning, #f59e0b);
}

.git-branches__remote-status--uptodate {
  color: var(--color-success, #10b981);
}

.git-branches__commit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}

.git-branches__commit-item {
  display: grid;
  grid-template-columns: 60px 1fr auto auto;
  gap: 8px;
  align-items: baseline;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
}

.git-branches__commit-item:hover {
  background: var(--color-surface-2);
}

.git-branches__commit-hash {
  font-family: monospace;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.git-branches__commit-message {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-branches__commit-author {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.git-branches__commit-date {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* ── Subsección 2: Branch Selector ───────────────────────────────────────── */

.git-branches__current-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.git-branches__current-name {
  font-weight: 600;
  color: var(--color-text);
}

.git-branches__selector-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-branches__select {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  color: var(--color-text);
  font-size: 0.875rem;
  cursor: pointer;
}

.git-branches__select:focus {
  outline: 2px solid var(--color-accent, #6366f1);
  outline-offset: 1px;
}

/* ── Subsección 3: Branch Commits ────────────────────────────────────────── */

.git-branches__commits-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.git-branches__commits-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ── Estados de carga y error ────────────────────────────────────────────── */

.git-branches__spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.git-branches__error-banner {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--color-error-bg, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--color-error, #ef4444);
  color: var(--color-error, #ef4444);
  font-size: 0.8rem;
}

.git-branches__success-banner {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--color-success-bg, rgba(16, 185, 129, 0.1));
  border: 1px solid var(--color-success, #10b981);
  color: var(--color-success, #10b981);
  font-size: 0.8rem;
}

.git-branches__empty-state {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  text-align: center;
  padding: 12px 0;
}

/* ── No project state ────────────────────────────────────────────────────── */

.git-branches__no-project {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
```

---

## 📁 Resumen de Archivos

| Acción | Ruta | Descripción |
|--------|------|-------------|
| **MODIFICAR** | `src/electron/bridge.types.ts` | Agregar canales IPC, tipos `GitCommit`, `GitBranch`, request/response types, métodos en `AgentsFlowBridge` |
| **CREAR** | `src/electron/git-branches.ts` | Módulo main process con todas las operaciones git |
| **MODIFICAR** | `src/electron/ipc-handlers.ts` | Registrar `registerGitBranchesHandlers` |
| **MODIFICAR** | `src/electron/preload.ts` | Exponer métodos git en `window.agentsFlow` |
| **MODIFICAR** | `src/ui/store/projectStore.ts` | Agregar stubs en `_stub` |
| **CREAR** | `src/ui/hooks/useGitBranches.ts` | Hook React con estado y lógica IPC |
| **MODIFICAR** | `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Implementación completa del panel |
| **MODIFICAR** | `src/ui/styles/app.css` | Agregar estilos `.git-branches__*` |

---

## 🗺️ Diagrama del Layout Final

```
┌─────────────────────────────────────────────────────────────────────┐
│  Git Integration                                              [✕]    │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  [Branches]  │  REMOTE CHANGES                    [↻ Refresh]      │
│  [Changes ]  │  ─────────────────────────────────────────────────  │
│              │  ↓ 3 commits behind · ↑ 1 ahead                     │
│              │  • abc1234  "Fix login bug"  John  2 days ago        │
│              │  • def5678  "Add tests"      Jane  3 days ago        │
│              │                              [⬇ Fetch & Pull]       │
│              │  ─────────────────────────────────────────────────  │
│              │  BRANCH                                              │
│              │  Current: main                                       │
│              │  [▼ feature/login-fix  ]  [⬇ Pull]  [⎇ Checkout]   │
│              │  ─────────────────────────────────────────────────  │
│              │  COMMITS IN "feature/login-fix"                      │
│              │  ● abc1234  Fix login validation    John  2d ago     │
│              │  ● def5678  Add unit tests          Jane  3d ago     │
│              │  ● ghi9012  Refactor auth module    John  5d ago     │
│              │                                                      │
├──────────────┴──────────────────────────────────────────────────────┤
│                                                          [Close]    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Datos

```
GitBranchesPanel
  │
  ├── useProjectStore → projectDir
  │
  └── useGitBranches(projectDir)
        │
        ├── [mount] → loadBranches() → IPC: git:list-branches
        │               → dispatch LOAD_BRANCHES_SUCCESS
        │               → state.selectableBranches (sin main/master)
        │               → state.selectedBranch = primera rama disponible
        │
        ├── [mount] → loadRemoteDiff() → IPC: git:get-remote-diff
        │               → dispatch LOAD_REMOTE_DIFF_SUCCESS
        │               → state.incomingCommits, aheadCount, behindCount
        │
        ├── [selectedBranch change] → loadBranchCommits(branch)
        │               → IPC: git:get-branch-commits
        │               → dispatch LOAD_COMMITS_SUCCESS
        │               → state.branchCommits
        │
        ├── fetchAndPull() → IPC: git:fetch-and-pull
        │               → on success: reload remote diff + branches
        │
        ├── pullBranch(branch) → IPC: git:pull-branch
        │               → on success: reload remote diff
        │
        └── checkoutBranch(branch) → IPC: git:checkout-branch
                        → on success: reload branches (currentBranch cambia)
                        → selectedBranch se actualiza al nuevo currentBranch
```

---

## ⚠️ Risks y Edge Cases

### Operacionales

| Risk | Descripción | Mitigación |
|------|-------------|------------|
| **git no instalado** | `execFile("git", ...)` falla con ENOENT | Detectar en `runGit` → retornar `E_GIT_NOT_FOUND` con mensaje claro |
| **Sin conexión a internet** | `git fetch` falla con timeout o error de red | Timeout de 15s en fetch; retornar `E_NO_REMOTE` con el stderr |
| **Working directory sucio** | `git checkout` o `git pull` falla por cambios sin commitear | Detectar en stderr → retornar `E_DIRTY_WORKING_DIR` con mensaje explicativo |
| **Conflictos de merge** | `git pull` resulta en conflictos | Detectar "CONFLICT" en stderr → retornar `E_MERGE_CONFLICT`; NO hacer pull automático |
| **Repo sin remoto** | No hay `origin` configurado | `noUpstream: true` en `getRemoteDiff`; deshabilitar botones de pull |
| **Rama solo remota** | El usuario selecciona una rama que no existe localmente | En `checkoutBranch`: intentar `git checkout -b <branch> origin/<branch>` como fallback |
| **Race condition** | El usuario hace click en Fetch mientras ya hay un fetch en curso | `isFetchingAndPulling: true` deshabilita el botón durante la operación |
| **Proyecto sin .git** | El directorio del proyecto no es un repo git | Verificar existencia de `.git` al inicio de cada handler → retornar `E_NOT_A_GIT_REPO` |

### UX

| Risk | Descripción | Mitigación |
|------|-------------|------------|
| **main/master en selector** | El usuario podría querer hacer checkout a main | Excluir del selector pero mostrar nota "main/master excluded" |
| **Rama activa en selector** | La rama actual aparece en el selector pero Checkout no tiene sentido | Mostrar "✓ Current" en el botón Checkout cuando `selectedBranch === currentBranch` |
| **Lista de commits muy larga** | Repos con muchos commits saturan la UI | Limitar a 20 commits con `git log -n 20`; no hay paginación en MVP |
| **Mensajes de error técnicos** | Los errores de git son crípticos para el usuario | Mapear códigos de error a mensajes amigables en el componente |
| **Feedback de operaciones lentas** | Fetch puede tardar varios segundos | Spinner en el botón durante la operación; no bloquear el resto de la UI |

### Técnicos

| Risk | Descripción | Mitigación |
|------|-------------|------------|
| **Formato de `git log`** | El separador `|` puede aparecer en mensajes de commit | Usar `%x00` (null byte) como separador en el formato de git log |
| **Encoding de nombres de rama** | Ramas con caracteres especiales o Unicode | `execFile` maneja el encoding correctamente; no usar `exec` con shell |
| **Timeout en operaciones lentas** | `git pull` en repos grandes puede tardar más de 10s | Timeout de 30s para pull; 15s para fetch; 10s para operaciones de lectura |
| **Stale data tras checkout** | Después de checkout, los commits de la rama cambian | Recargar branches y commits tras checkout exitoso |

---

## 📝 Notes

### Sobre la exclusión de main/master

El requerimiento especifica excluir `main` o `master` del **selector** de ramas. Esto NO significa que no se puedan ver sus commits — la subsección de commits muestra la rama seleccionada en el selector, que por definición nunca será main/master. Si el usuario necesita ver commits de main, puede hacerlo desde otras herramientas.

La lista completa de ramas (incluyendo main/master) sí se obtiene del IPC para mostrar el `currentBranch` correctamente.

### Sobre el estado "selectedBranch" vs "currentBranch"

- `currentBranch`: la rama activa en el repositorio git (HEAD). Se actualiza tras un checkout exitoso.
- `selectedBranch`: la rama seleccionada en el `<select>` del selector. Es independiente de `currentBranch`. Sirve para previsualizar commits y como target de Pull/Checkout.

### Sobre el botón "Fetch & Pull" vs "Pull Branch"

- **Fetch & Pull** (subsección 1): opera sobre la rama **actual** (`currentBranch`). Hace `git pull --ff-only`.
- **Pull Branch** (subsección 2): opera sobre la rama **seleccionada en el selector**. Hace `git pull origin <selectedBranch>`.

### Sobre el formato de fecha en commits

`git log --format="%aI"` retorna ISO 8601. El campo `relativeDate` usa `"%ar"` (e.g. "2 days ago"). Ambos se incluyen en `GitCommit` para que el componente pueda elegir cuál mostrar.

### Extensibilidad futura

- **Push**: agregar `gitPushBranch` siguiendo el mismo patrón.
- **Crear rama**: agregar `gitCreateBranch` con `git checkout -b <name>`.
- **Eliminar rama**: agregar `gitDeleteBranch` con `git branch -d <name>`.
- **Paginación de commits**: agregar `offset` al request de `gitGetBranchCommits`.
- **Stash**: agregar subsección de stash en el panel.

Todos estos son extensiones naturales del módulo `git-branches.ts` y el hook `useGitBranches.ts` sin necesidad de cambiar la arquitectura.

---

## 🔗 Dependencias entre Phases

```
Phase 1 (Tipos)
  └── Phase 2 (Main Process)
        └── Phase 3 (Registro handlers)
              └── Phase 4 (Preload)
                    └── Phase 5 (Hook React)
                          └── Phase 6 (Componente UI)
                                └── Phase 7 (CSS)  ← puede hacerse en paralelo con Phase 6
```

Phase 7 (CSS) puede implementarse en paralelo con cualquier otra phase ya que no tiene dependencias de código.

---

*Generado por Weight-Planner — AgentsFlow Git Branches Panel*  
*Fecha: 2026-04-27*
