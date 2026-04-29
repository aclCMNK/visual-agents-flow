# 📋 Especificaciones Técnicas — GitConfigPanel

> **Feature:** Sección "Config" del modal de integración Git  
> **Módulo:** `GitConfigPanel` — nueva sección del `GitIntegrationModal`, ubicada **antes** de "Branches" y "Changes"  
> **Fecha:** 2026-04-27 (actualizado)  
> **Autor:** Weight-Planner  
> **Referencia de arquitectura:** `docs/specs/git-changes-panel-specs.md`, `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx`

---

## 📑 Índice

1. [Estructura de Componentes y Props](#1-estructura-de-componentes-y-props)
2. [Flujos de Validación y UX](#2-flujos-de-validación-y-ux)
3. [Lógica de Integración con Git (IPC/Backend)](#3-lógica-de-integración-con-git-ipcbackend)
4. [Edge Cases y Manejo de Errores](#4-edge-cases-y-manejo-de-errores)
5. [Accesibilidad](#5-accesibilidad)
6. [Reglas de Estilos / CSS](#6-reglas-de-estilos--css)
7. [Checklist QA](#7-checklist-qa)

---

## 1. Estructura de Componentes y Props

### 1.1 Árbol de componentes

```
GitIntegrationModal
└── GitConfigPanel                          ← componente raíz de la sección "Config"
    ├── NoGitSection                        ← estado A: directorio sin .git
    │   └── <section aria-labelledby>
    │       ├── <header> / <h3>             — título "Repository"
    │       ├── <p> descripción             — "No Git repository detected."
    │       └── <button> "Connect to Git"   — btn--primary, inicia git init
    │
    └── HasGitSection                       ← estado B: directorio con .git
        ├── RepoStatusSubsection            ← subsección 1: estado del repo
        │   └── <section aria-labelledby>
        │       ├── <header> / <h3>         — título "Repository"
        │       └── <div> .git-config__repo-row
        │           ├── <span> ícono ✓      — aria-hidden
        │           └── <span> "Git repository detected"
        │
        ├── <div className="git-branches__divider" />
        │
        ├── RemoteUrlSubsection             ← subsección 2: URL del remoto
        │   └── <section aria-labelledby>
        │       ├── <header> / <h3>         — título "Remote"
        │       │
        │       ├── [sin remote] RemoteConnectForm   ← NUEVO: formulario completo de conexión
        │       │   ├── <label> "Remote URL"
        │       │   ├── <input type="url">            — campo de texto para la URL
        │       │   ├── <p> hint | error              — validación de URL
        │       │   ├── RepoVisibilityBadge           — muestra estado de visibilidad
        │       │   │
        │       │   ├── [solo si URL es privada] CredentialsSubform
        │       │   │   ├── <h4> "Authentication"
        │       │   │   ├── <label> + <input> "Username"
        │       │   │   ├── <label> + <input type="password"> "Password or Token"
        │       │   │   └── <p> hint — "Required for private repositories"
        │       │   │
        │       │   ├── GitIdentitySubform            ← SIEMPRE visible
        │       │   │   ├── <h4> "Git Identity"
        │       │   │   ├── <label> + <input> "Name" (git user.name)
        │       │   │   ├── <label> + <input type="email"> "Email" (git user.email)
        │       │   │   └── <p> hint — "Used for commits in this repository"
        │       │   │
        │       │   └── <button> "Connect"            — btn--primary, habilitado solo si válido
        │       │
        │       └── [con remote] RemoteDisplay
        │           ├── <p> .git-config__remote-url   — URL como texto
        │           ├── RepoVisibilityBadge            — badge público/privado (siempre visible)
        │           └── <button> "Change Remote"       — btn--ghost, abre edición
        │               └── [modo edición] RemoteConnectForm (inline, con valores actuales)
```

---

### 1.2 Modificación en `GitIntegrationModal`

El tipo `GitSection` y el sidebar deben actualizarse para incluir `"config"` como primera opción:

```typescript
// ANTES
type GitSection = "branches" | "changes";

// DESPUÉS
type GitSection = "config" | "branches" | "changes";
```

El estado inicial del modal cambia a `"config"`:

```typescript
// ANTES
const [activeSection, setActiveSection] = useState<GitSection>("branches");

// DESPUÉS
const [activeSection, setActiveSection] = useState<GitSection>("config");
```

El sidebar agrega el botón "Config" como primer elemento del `tablist`:

```tsx
<button
  className={`git-modal__sidebar-btn${activeSection === "config" ? " git-modal__sidebar-btn--active" : ""}`}
  onClick={() => setActiveSection("config")}
  role="tab"
  aria-selected={activeSection === "config"}
  aria-controls="git-modal__content"
>
  Config
</button>
```

El panel de contenido agrega el render condicional:

```tsx
{activeSection === "config" && <GitConfigPanel />}
{activeSection === "branches" && <GitBranchesPanel />}
{activeSection === "changes" && <GitChangesPanel />}
```

---

### 1.3 Props de cada componente

#### `GitConfigPanel` (componente raíz)

No recibe props externas. Obtiene `projectDir` desde `useProjectStore`.

```typescript
// Sin props — usa hooks internamente
export function GitConfigPanel(): JSX.Element
```

**Dependencias internas:**
- `useProjectStore((s) => s.project?.projectDir ?? null)` — ruta del proyecto
- `useGitConfig(projectDir)` — hook de estado y acciones

---

#### `NoGitSection`

```typescript
interface NoGitSectionProps {
  /** True mientras se ejecuta git init. Deshabilita el botón. */
  isInitializing: boolean;
  /** Error del último intento de git init, o null. */
  initError: string | null;
  /** Callback para ejecutar git init en el directorio actual. */
  onConnectToGit: () => void;
}
```

**Comportamiento:**
- Muestra descripción: `"No Git repository detected in this directory."`
- Botón `"Connect to Git"` ejecuta `git init`.
- Durante la operación: botón muestra `"Initializing…"` con `aria-busy="true"`.
- Si hay error: banner rojo con el mensaje de error.

---

#### `HasGitSection`

```typescript
interface HasGitSectionProps {
  /** URL del remoto actual, o null si no hay remote configurado. */
  remoteUrl: string | null;
  /** Estado de visibilidad del repo (reutiliza VisibilityStatus existente). */
  visibilityStatus: VisibilityStatus;
  /** True mientras se ejecuta la conexión (remote + credenciales + identidad). */
  isConnecting: boolean;
  /** Error del último intento de conexión, o null. */
  connectError: string | null;
  /** True si la conexión fue exitosa (para feedback temporal). */
  connectSuccess: boolean;
  /** Callback para conectar: configura remote, credenciales e identidad. */
  onConnect: (params: ConnectParams) => void;
}
```

---

#### `RemoteConnectForm` ← NUEVO (reemplaza `RemoteInputForm`)

Este formulario unifica la URL del remoto, las credenciales opcionales (solo si privado) y la identidad Git (siempre obligatoria).

```typescript
interface RemoteConnectFormProps {
  /** Valor inicial del campo URL (vacío si es nuevo, URL actual si es edición). */
  initialUrl?: string;
  /** Valor inicial de user.name (vacío si es nuevo). */
  initialUserName?: string;
  /** Valor inicial de user.email (vacío si es nuevo). */
  initialUserEmail?: string;
  /** True mientras se conecta. Deshabilita todos los campos y el botón. */
  isConnecting: boolean;
  /** Error de la última operación de conexión, o null. */
  connectError: string | null;
  /** Estado de visibilidad calculado para la URL ingresada. */
  visibilityStatus: VisibilityStatus;
  /** Callback al cambiar la URL (para disparar chequeo de visibilidad). */
  onUrlChange: (url: string) => void;
  /** Callback al confirmar la conexión. */
  onConnect: (params: ConnectParams) => void;
  /** Callback para cancelar la edición (solo en modo edición inline). */
  onCancel?: () => void;
}

interface ConnectParams {
  url: string;
  /** Solo presente si la URL es de repo privado. */
  credentials?: {
    username: string;
    password: string; // puede ser token
  };
  /** Siempre obligatorio. */
  userName: string;
  /** Siempre obligatorio. */
  userEmail: string;
}
```

**Lógica de habilitación del botón "Connect":**

El botón `"Connect"` se habilita **solo si** se cumplen **todas** las condiciones:

| Condición | Requerimiento |
|---|---|
| URL | Válida (pasa `isValidGitUrl`) |
| Credenciales (username) | Obligatorio **solo si** `visibilityStatus === "private"` |
| Credenciales (password/token) | Obligatorio **solo si** `visibilityStatus === "private"` |
| `userName` (git user.name) | **Siempre obligatorio**, no vacío |
| `userEmail` (git user.email) | **Siempre obligatorio**, formato email válido |

```typescript
// Lógica de validación del formulario (calculada en render)
function isFormValid(
  url: string,
  visibilityStatus: VisibilityStatus,
  credentials: { username: string; password: string },
  userName: string,
  userEmail: string
): boolean {
  if (!isValidGitUrl(url)) return false;
  if (visibilityStatus === "private") {
    if (!credentials.username.trim()) return false;
    if (!credentials.password.trim()) return false;
  }
  if (!userName.trim()) return false;
  if (!isValidEmail(userEmail)) return false;
  return true;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
```

**Visibilidad del subformulario de credenciales:**

```typescript
// Las credenciales se muestran SOLO si la URL es de repo privado
const showCredentials = visibilityStatus === "private";
```

> **Nota UX:** El subformulario de credenciales aparece y desaparece dinámicamente mientras el usuario escribe la URL. La transición debe ser suave (CSS `opacity` + `max-height` o similar). No se muestra si `visibilityStatus` es `"idle"`, `"checking"`, `"public"`, `"ssh_url"`, `"unknown_provider"` o `"network_error"`.

**Validación interna de URL (sin cambios respecto a versión anterior):**

| Condición | Resultado |
|---|---|
| `url.trim() === ""` | Sin error (campo vacío, botón deshabilitado) |
| No comienza con `https://`, `http://`, `git@`, `ssh://` | Error: `"Invalid URL format. Use HTTPS or SSH."` |
| URL válida | Sin error |

**Validación de identidad Git:**

| Campo | Condición de error | Mensaje |
|---|---|---|
| `userName` | Vacío | `"Name is required."` |
| `userEmail` | Vacío | `"Email is required."` |
| `userEmail` | Formato inválido | `"Enter a valid email address."` |

Los errores de identidad se muestran debajo de cada campo con `role="alert"`.

---

#### `CredentialsSubform`

```typescript
interface CredentialsSubformProps {
  username: string;
  password: string;
  isDisabled: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}
```

**Comportamiento:**
- Aparece animado cuando `showCredentials === true`.
- Desaparece (y sus valores se limpian) cuando `showCredentials === false`.
- El campo de password usa `type="password"` con opción de toggle de visibilidad (`type="text"` al hacer clic en el ícono de ojo).
- Hint: `"Required for private repositories. Use a personal access token for better security."`

---

#### `GitIdentitySubform`

```typescript
interface GitIdentitySubformProps {
  userName: string;
  userEmail: string;
  isDisabled: boolean;
  onUserNameChange: (value: string) => void;
  onUserEmailChange: (value: string) => void;
  userNameError: string | null;
  userEmailError: string | null;
}
```

**Comportamiento:**
- **Siempre visible** en `RemoteConnectForm`, independientemente del estado de la URL.
- Hint: `"Used for commits in this repository (local config)."`
- Los errores se muestran debajo de cada campo con `role="alert"` + `aria-live="assertive"`.

---

#### `RemoteDisplay`

```typescript
interface RemoteDisplayProps {
  /** URL del remoto actual. */
  remoteUrl: string;
  /** Estado de visibilidad del repo. */
  visibilityStatus: VisibilityStatus;
  /** True si el modo edición inline está activo. */
  isEditing: boolean;
  /** Callback para activar el modo edición. */
  onEdit: () => void;
}
```

**Comportamiento:**
- Muestra la URL como texto plano (no como enlace, por seguridad en Electron).
- Muestra `RepoVisibilityBadge` **siempre visible** debajo de la URL (badge público/privado).
- Botón `"Change Remote"` activa el modo edición inline.
- En modo edición: renderiza `RemoteConnectForm` con `initialUrl={remoteUrl}` y `onCancel` para volver al modo display.

---

### 1.4 Hook: `useGitConfig`

**Firma:**

```typescript
function useGitConfig(projectDir: string | null): {
  state: GitConfigState;
  connectToGit: () => Promise<void>;
  connect: (params: ConnectParams) => Promise<void>;
  checkVisibility: (url: string) => void;
  clearFeedback: () => void;
}
```

**Estado (`GitConfigState`):**

```typescript
interface GitConfigState {
  // Estado del repositorio
  hasGit: boolean | null;       // null = cargando, true/false = resultado
  remoteUrl: string | null;     // null = sin remote configurado

  // Visibilidad del repo
  visibilityStatus: VisibilityStatus;  // reutiliza tipo existente

  // Operaciones
  isLoadingConfig: boolean;     // cargando estado inicial
  isInitializing: boolean;      // ejecutando git init
  isConnecting: boolean;        // ejecutando la secuencia de conexión completa

  // Feedback
  initError: string | null;
  connectError: string | null;
  connectSuccess: boolean;
}
```

**Estado inicial:**

```typescript
const initialState: GitConfigState = {
  hasGit: null,
  remoteUrl: null,
  visibilityStatus: "idle",
  isLoadingConfig: false,
  isInitializing: false,
  isConnecting: false,
  initError: null,
  connectError: null,
  connectSuccess: false,
};
```

**Acciones del reducer (`GitConfigAction`):**

```typescript
type GitConfigAction =
  | { type: "LOAD_CONFIG_START" }
  | { type: "LOAD_CONFIG_SUCCESS"; hasGit: boolean; remoteUrl: string | null }
  | { type: "LOAD_CONFIG_ERROR"; error: string }
  | { type: "INIT_START" }
  | { type: "INIT_SUCCESS" }
  | { type: "INIT_ERROR"; error: string }
  | { type: "CONNECT_START" }
  | { type: "CONNECT_SUCCESS"; remoteUrl: string }
  | { type: "CONNECT_ERROR"; error: string }
  | { type: "SET_VISIBILITY_STATUS"; status: VisibilityStatus }
  | { type: "CLEAR_FEEDBACK" };
```

**Efectos secundarios del hook:**

| Evento | Efecto |
|---|---|
| `projectDir` cambia (no null) | Llamar `loadConfig()` automáticamente |
| `projectDir === null` | No llamar nada, estado permanece inicial |
| `INIT_SUCCESS` | Llamar `loadConfig()` para refrescar estado |
| `CONNECT_SUCCESS` | Disparar chequeo de visibilidad con la nueva URL |
| `connectSuccess === true` | Auto-clear después de 3 segundos |
| URL cambia en `RemoteConnectForm` | Llamar `checkVisibility(url)` con debounce de 600ms |

**Lógica de `checkVisibility`:**

Reutiliza la utilidad existente `src/ui/utils/repoVisibility.ts` y el IPC proxy ya implementado. No requiere nueva lógica de visibilidad — solo conectar el campo de URL del Config panel al mismo flujo que usa `CloneFromGitModal`.

---

## 2. Flujos de Validación y UX

### 2.1 Flujo de carga inicial

```
GitConfigPanel monta
  └─► useEffect detecta projectDir
        └─► dispatch LOAD_CONFIG_START  →  isLoadingConfig = true
              └─► window.agentsFlow.gitGetConfig({ projectDir })
                    ├─► OK: dispatch LOAD_CONFIG_SUCCESS
                    │         hasGit = true/false
                    │         remoteUrl = "https://..." | null
                    │         isLoadingConfig = false
                    └─► Error: dispatch LOAD_CONFIG_ERROR
                              isLoadingConfig = false
                              (mostrar error en panel)
```

**UX durante carga:**
- Panel muestra spinner centrado con texto `"Loading repository config…"`.
- `role="status"` + `aria-live="polite"`.

---

### 2.2 Flujo A: Directorio sin `.git` → "Connect to Git"

```
hasGit === false
  └─► Render: NoGitSection
        └─► Usuario hace clic en "Connect to Git"
              └─► dispatch INIT_START  →  isInitializing = true
                    └─► window.agentsFlow.gitInit({ projectDir })
                          ├─► OK: dispatch INIT_SUCCESS
                          │         isInitializing = false
                          │         → loadConfig() automático
                          │         → hasGit pasa a true
                          │         → render cambia a HasGitSection
                          └─► Error: dispatch INIT_ERROR { error }
                                    isInitializing = false
                                    initError = mensaje de error
```

**UX durante init:**
- Botón muestra `"Initializing…"` con `aria-busy="true"`.
- Botón deshabilitado durante la operación.

**UX tras init exitoso:**
- El panel transiciona automáticamente a `HasGitSection`.
- No se muestra banner de éxito explícito (el cambio de estado es suficiente feedback).

**UX tras init fallido:**
- Banner rojo con el mensaje de error debajo del botón.
- Botón se rehabilita para reintentar.

---

### 2.3 Flujo B1: Repo con `.git` sin remote → formulario de conexión completo

```
hasGit === true && remoteUrl === null
  └─► Render: HasGitSection → RemoteConnectForm (modo nuevo)
        │
        ├─► Usuario escribe URL en el campo
        │     └─► onUrlChange(url)
        │           └─► checkVisibility(url) con debounce 600ms
        │                 └─► dispatch SET_VISIBILITY_STATUS { status: "checking" }
        │                       └─► IPC: gitCheckRepoVisibility({ url })
        │                             ├─► OK: dispatch SET_VISIBILITY_STATUS { status: "public" | "private" | ... }
        │                             └─► Error: dispatch SET_VISIBILITY_STATUS { status: "network_error" }
        │
        ├─► [si visibilityStatus === "private"] CredentialsSubform aparece animado
        │     └─► Usuario completa username y password/token
        │
        ├─► GitIdentitySubform siempre visible
        │     └─► Usuario completa user.name y user.email
        │
        └─► Usuario hace clic en "Connect" (habilitado solo si formulario válido)
              └─► dispatch CONNECT_START  →  isConnecting = true
                    └─► Secuencia de operaciones:
                          1. window.agentsFlow.gitSetRemote({ projectDir, url })
                          2. [si privado] window.agentsFlow.gitSaveCredentials({ projectDir, url, username, password })
                          3. window.agentsFlow.gitSetIdentity({ projectDir, userName, userEmail })
                          │
                          ├─► Todas OK: dispatch CONNECT_SUCCESS { remoteUrl: url }
                          │             isConnecting = false
                          │             remoteUrl = url
                          │             → render cambia a RemoteDisplay
                          │             → banner de éxito temporal (3 segundos)
                          └─► Alguna falla: dispatch CONNECT_ERROR { error }
                                            isConnecting = false
                                            connectError = mensaje de error
```

**Orden de operaciones en `connect()`:**

```typescript
async function connect(params: ConnectParams): Promise<void> {
  dispatch({ type: "CONNECT_START" });
  try {
    // 1. Configurar el remote
    const remoteResult = await getBridge().gitSetRemote({ projectDir, url: params.url });
    if (!remoteResult.ok) {
      dispatch({ type: "CONNECT_ERROR", error: remoteResult.message });
      return;
    }

    // 2. Guardar credenciales (solo si repo privado)
    if (params.credentials) {
      const credResult = await getBridge().gitSaveCredentials({
        projectDir,
        url: params.url,
        username: params.credentials.username,
        password: params.credentials.password,
      });
      if (!credResult.ok) {
        dispatch({ type: "CONNECT_ERROR", error: credResult.message });
        return;
      }
    }

    // 3. Configurar identidad Git local
    const identityResult = await getBridge().gitSetIdentity({
      projectDir,
      userName: params.userName,
      userEmail: params.userEmail,
    });
    if (!identityResult.ok) {
      dispatch({ type: "CONNECT_ERROR", error: identityResult.message });
      return;
    }

    dispatch({ type: "CONNECT_SUCCESS", remoteUrl: params.url });
    checkVisibility(params.url);
  } catch (err) {
    dispatch({ type: "CONNECT_ERROR", error: "Unexpected error during connection." });
  }
}
```

---

### 2.4 Flujo B2: Repo con `.git` y remote → mostrar URL + badge de visibilidad

```
hasGit === true && remoteUrl !== null
  └─► Render: HasGitSection → RemoteDisplay
        └─► Al montar: checkVisibility(remoteUrl) automático
              └─► Muestra RepoVisibilityBadge con estado calculado (siempre visible)

        └─► Usuario hace clic en "Change Remote"
              └─► isEditing = true
                    └─► Render: RemoteConnectForm (modo edición, initialUrl = remoteUrl)
                          └─► Mismo flujo que B1
                          └─► onCancel → isEditing = false (vuelve a RemoteDisplay)
```

**Badge de visibilidad en `RemoteDisplay`:**
- El `RepoVisibilityBadge` se muestra **siempre** debajo de la URL del remoto.
- Al montar `RemoteDisplay`, se dispara automáticamente `checkVisibility(remoteUrl)`.
- El badge refleja el estado actual: `"public"` (verde), `"private"` (rojo), `"ssh_url"` (amber), `"unknown_provider"` (amber), `"network_error"` (naranja), `"checking"` (spinner).

---

### 2.5 Flujo de validación de URL

```
Usuario escribe en el campo URL
  └─► onChange → onUrlChange(value)
        └─► Validación en render de RemoteConnectForm:
              ├─► value.trim() === ""
              │     → sin error, botón deshabilitado
              ├─► !isValidGitUrl(value)
              │     → error: "Invalid URL format. Use HTTPS or SSH."
              │     → aria-invalid="true"
              │     → botón deshabilitado
              └─► isValidGitUrl(value)
                    → sin error
                    → checkVisibility(value) con debounce 600ms
                    → botón habilitado solo si resto del formulario también válido
```

**Función `isValidGitUrl` (pura, no exportada):**

```typescript
function isValidGitUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("git@") ||
    trimmed.startsWith("ssh://")
  );
}
```

> **Nota:** La validación es intencional y permisiva. No se valida el formato completo de la URL (host, path, extensión `.git`) para no bloquear casos legítimos de servidores self-hosted o URLs no convencionales.

---

### 2.6 Flujo de aparición/desaparición de credenciales

```
visibilityStatus cambia
  ├─► "private"
  │     → showCredentials = true
  │     → CredentialsSubform aparece con animación (opacity + max-height)
  │     → campos username y password se vuelven obligatorios para habilitar "Connect"
  │
  └─► cualquier otro valor ("public", "ssh_url", "unknown_provider", "network_error", "idle", "checking")
        → showCredentials = false
        → CredentialsSubform desaparece con animación
        → valores de username y password se limpian (reset a "")
        → campos de credenciales ya no son requeridos para habilitar "Connect"
```

> **Nota UX:** Cuando las credenciales desaparecen (URL cambia de privada a pública), los valores se limpian para no enviar credenciales innecesarias. El usuario debe volver a ingresarlas si la URL vuelve a ser privada.

---

### 2.7 Estado sin proyecto abierto

```
projectDir === null
  └─► GitConfigPanel retorna early:
        <div className="git-config__no-project">No project open.</div>
```

No se monta ninguna subsección. No se realizan llamadas IPC.

---

## 3. Lógica de Integración con Git (IPC/Backend)

### 3.1 Arquitectura del bridge

```
Renderer (React)
  useGitConfig hook
    └─► window.agentsFlow.gitGetConfig(req)
    └─► window.agentsFlow.gitInit(req)
    └─► window.agentsFlow.gitSetRemote(req)
    └─► window.agentsFlow.gitSaveCredentials(req)    ← NUEVO
    └─► window.agentsFlow.gitSetIdentity(req)        ← NUEVO
    └─► window.agentsFlow.gitCheckRepoVisibility(req)  ← ya existe
          │
          │  (IPC via contextBridge)
          ▼
Preload (preload.ts)
  ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_CONFIG, req)
  ipcRenderer.invoke(IPC_CHANNELS.GIT_INIT, req)
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_REMOTE, req)
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SAVE_CREDENTIALS, req)
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_IDENTITY, req)
          │
          │  (Electron IPC)
          ▼
Main Process (ipc-handlers.ts)
  registerGitConfigHandlers(ipcMain)
          │
          ▼
git-config.ts
  getConfig(projectDir)
  initRepo(projectDir)
  setRemote(projectDir, url)
  saveCredentials(projectDir, url, username, password)
  setIdentity(projectDir, userName, userEmail)
          │
          ▼
runGit() → execFile("git", [...args], { cwd: projectDir })
```

---

### 3.2 Canales IPC nuevos

| Canal | Constante | Dirección | Descripción |
|---|---|---|---|
| `"git:get-config"` | `IPC_CHANNELS.GIT_GET_CONFIG` | renderer → main | Detecta `.git` y obtiene URL del remoto |
| `"git:init"` | `IPC_CHANNELS.GIT_INIT` | renderer → main | Ejecuta `git init` en el directorio |
| `"git:set-remote"` | `IPC_CHANNELS.GIT_SET_REMOTE` | renderer → main | Agrega o actualiza el remote `origin` |
| `"git:save-credentials"` | `IPC_CHANNELS.GIT_SAVE_CREDENTIALS` | renderer → main | Guarda credenciales para repo privado |
| `"git:set-identity"` | `IPC_CHANNELS.GIT_SET_IDENTITY` | renderer → main | Configura `user.name` y `user.email` localmente |

> **Canal reutilizado:** `"git:check-repo-visibility"` ya existe para el chequeo de visibilidad. No se crea uno nuevo.

---

### 3.3 Tipos IPC nuevos

#### `GitGetConfigRequest` / `GitGetConfigResponse`

```typescript
export interface GitGetConfigRequest {
  projectDir: string;
}

export interface GitGetConfigResult {
  ok: true;
  /** True si el directorio contiene un repositorio Git (.git existe). */
  hasGit: boolean;
  /**
   * URL del remote "origin", o null si no hay remote configurado.
   * Solo presente cuando hasGit === true.
   */
  remoteUrl: string | null;
}

export type GitGetConfigResponse = GitGetConfigResult | GitOperationError;
```

---

#### `GitInitRequest` / `GitInitResponse`

```typescript
export interface GitInitRequest {
  projectDir: string;
}

export interface GitInitResult {
  ok: true;
  /** Output del comando git init. */
  output: string;
}

export type GitInitResponse = GitInitResult | GitOperationError;
```

---

#### `GitSetRemoteRequest` / `GitSetRemoteResponse`

```typescript
export interface GitSetRemoteRequest {
  projectDir: string;
  /** URL del repositorio remoto a configurar como "origin". */
  url: string;
}

export interface GitSetRemoteResult {
  ok: true;
  /** URL que quedó configurada. */
  remoteUrl: string;
}

export type GitSetRemoteResponse = GitSetRemoteResult | GitOperationError;
```

---

#### `GitSaveCredentialsRequest` / `GitSaveCredentialsResponse` ← NUEVO

```typescript
export interface GitSaveCredentialsRequest {
  projectDir: string;
  /** URL del repositorio (para asociar las credenciales). */
  url: string;
  /** Nombre de usuario de Git. */
  username: string;
  /** Contraseña o token de acceso personal. */
  password: string;
}

export interface GitSaveCredentialsResult {
  ok: true;
}

export type GitSaveCredentialsResponse = GitSaveCredentialsResult | GitOperationError;
```

> **Implementación sugerida:** Usar `git credential approve` o configurar `credential.helper` con un helper de almacenamiento seguro (keychain del SO). Alternativamente, guardar en el archivo `.git/credentials` con permisos restringidos. La estrategia exacta depende del entorno (macOS Keychain, libsecret en Linux, Windows Credential Manager).

---

#### `GitSetIdentityRequest` / `GitSetIdentityResponse` ← NUEVO

```typescript
export interface GitSetIdentityRequest {
  projectDir: string;
  /** Nombre del autor para commits (git config user.name). */
  userName: string;
  /** Email del autor para commits (git config user.email). */
  userEmail: string;
}

export interface GitSetIdentityResult {
  ok: true;
}

export type GitSetIdentityResponse = GitSetIdentityResult | GitOperationError;
```

**Implementación backend:**

```bash
git config --local user.name "<userName>"
git config --local user.email "<userEmail>"
```

> **Nota:** Se usa `--local` para configurar la identidad solo en el repositorio actual, sin afectar la configuración global del usuario.

---

### 3.4 Nuevos códigos de error en `GitOperationErrorCode`

```typescript
// Agregar a la unión existente:
| "E_INIT_FAILED"              // git init falló (permisos, disco lleno, etc.)
| "E_REMOTE_ALREADY_EXISTS"    // git remote add origin falló porque ya existe (se maneja internamente con set-url)
| "E_INVALID_REMOTE_URL"       // URL rechazada por git (formato inválido)
| "E_CREDENTIALS_SAVE_FAILED"  // No se pudieron guardar las credenciales
| "E_IDENTITY_SET_FAILED"      // No se pudo configurar user.name o user.email
```

> **Nota:** `E_REMOTE_ALREADY_EXISTS` es un error interno que el backend debe manejar transparentemente: si `git remote add origin <url>` falla porque `origin` ya existe, el backend debe ejecutar `git remote set-url origin <url>` automáticamente. El renderer nunca debe ver este error.

---

### 3.5 Implementación backend: `git-config.ts`

**Archivo nuevo:** `src/electron/git-config.ts`

#### Función `getConfig(projectDir: string)`

**Algoritmo:**

```
1. Verificar si existe el directorio `<projectDir>/.git`
   → Si no existe: retornar { ok: true, hasGit: false, remoteUrl: null }

2. Si existe .git:
   → Ejecutar: git remote get-url origin
   → Si exitoso: retornar { ok: true, hasGit: true, remoteUrl: <url> }
   → Si falla con "No such remote 'origin'": retornar { ok: true, hasGit: true, remoteUrl: null }
   → Si falla por otro motivo: retornar GitOperationError con E_UNKNOWN
```

**Comando:**
```bash
git remote get-url origin
```

> **Nota:** Se usa `fs.existsSync(path.join(projectDir, ".git"))` para la detección de `.git`, **no** `git rev-parse`. Esto es más rápido y no requiere que git esté instalado para el caso negativo.

---

#### Función `initRepo(projectDir: string)`

**Comando:**
```bash
git init
```

**Manejo de errores:**
- Si git no está instalado: `E_GIT_NOT_FOUND`
- Si el directorio no existe o no hay permisos: `E_INIT_FAILED`
- Cualquier otro error de stderr: `E_UNKNOWN`

---

#### Función `setRemote(projectDir: string, url: string)`

**Algoritmo:**

```
1. Intentar: git remote add origin <url>
   → Si exitoso: retornar { ok: true, remoteUrl: url }
   → Si falla con "already exists":
       → Ejecutar: git remote set-url origin <url>
       → Si exitoso: retornar { ok: true, remoteUrl: url }
       → Si falla: retornar GitOperationError
   → Si falla con otro error: retornar GitOperationError con E_INVALID_REMOTE_URL o E_UNKNOWN
```

**Comandos:**
```bash
git remote add origin <url>
# o si ya existe:
git remote set-url origin <url>
```

> **Seguridad:** La URL se pasa como argumento separado a `execFile`, nunca concatenada en un string de shell. Esto previene inyección de comandos.

---

#### Función `saveCredentials(projectDir: string, url: string, username: string, password: string)` ← NUEVA

**Algoritmo:**

```
1. Construir el objeto de credenciales en formato git-credential:
   protocol=https
   host=<host extraído de url>
   username=<username>
   password=<password>

2. Ejecutar: git credential approve
   → Pasar el objeto por stdin
   → Si exitoso: retornar { ok: true }
   → Si falla: retornar GitOperationError con E_CREDENTIALS_SAVE_FAILED
```

**Alternativa (si `git credential approve` no está disponible):**
- Configurar `credential.helper=store` y escribir en `~/.git-credentials` con permisos `600`.
- O usar el keychain del SO mediante la librería `keytar` (ya disponible en Electron).

> **Seguridad:** Las credenciales nunca se loguean. Se pasan por stdin a `execFile`, no como argumentos de línea de comandos.

---

#### Función `setIdentity(projectDir: string, userName: string, userEmail: string)` ← NUEVA

**Comandos:**
```bash
git config --local user.name "<userName>"
git config --local user.email "<userEmail>"
```

**Manejo de errores:**
- Si git no está instalado: `E_GIT_NOT_FOUND`
- Si el directorio no es un repo git: `E_NOT_A_GIT_REPO`
- Cualquier otro error: `E_IDENTITY_SET_FAILED`

---

### 3.6 Registro en `ipc-handlers.ts`

```typescript
import { registerGitConfigHandlers } from "./git-config";

// Dentro de la función de registro principal:
registerGitConfigHandlers(ipcMain);
```

---

### 3.7 Exposición en `preload.ts`

```typescript
gitGetConfig: (req: GitGetConfigRequest): Promise<GitGetConfigResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_CONFIG, req),

gitInit: (req: GitInitRequest): Promise<GitInitResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_INIT, req),

gitSetRemote: (req: GitSetRemoteRequest): Promise<GitSetRemoteResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_REMOTE, req),

gitSaveCredentials: (req: GitSaveCredentialsRequest): Promise<GitSaveCredentialsResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SAVE_CREDENTIALS, req),

gitSetIdentity: (req: GitSetIdentityRequest): Promise<GitSetIdentityResponse> =>
  ipcRenderer.invoke(IPC_CHANNELS.GIT_SET_IDENTITY, req),
```

---

### 3.8 Interfaz `AgentsFlowBridge` (en `bridge.types.ts`)

```typescript
gitGetConfig(req: GitGetConfigRequest): Promise<GitGetConfigResponse>;
gitInit(req: GitInitRequest): Promise<GitInitResponse>;
gitSetRemote(req: GitSetRemoteRequest): Promise<GitSetRemoteResponse>;
gitSaveCredentials(req: GitSaveCredentialsRequest): Promise<GitSaveCredentialsResponse>;
gitSetIdentity(req: GitSetIdentityRequest): Promise<GitSetIdentityResponse>;
```

---

### 3.9 Detección de visibilidad del repositorio

La detección de visibilidad (público/privado) **reutiliza la infraestructura existente**:

- Utilidad: `src/ui/utils/repoVisibility.ts` — función `checkRepoVisibility(url)`
- Componente: `src/ui/components/RepoVisibilityBadge.tsx` — ya implementado
- IPC: canal `"git:check-repo-visibility"` — ya registrado

**Lógica de detección por URL (sin llamada de red):**

| Patrón de URL | Resultado inferido |
|---|---|
| Comienza con `git@` o `ssh://` | `"ssh_url"` — no se puede verificar |
| Host no es `github.com` | `"unknown_provider"` — no soportado |
| Host es `github.com` | Llamar IPC para verificar vía API de GitHub |

**Cuándo disparar el chequeo:**
- Al montar `HasGitSection` si `remoteUrl !== null` (chequeo automático).
- Al cambiar la URL en `RemoteConnectForm` (debounce 600ms).
- Al conectar exitosamente (`CONNECT_SUCCESS`).

---

## 4. Edge Cases y Manejo de Errores

### 4.1 Tabla de edge cases

| Caso | Comportamiento esperado |
|---|---|
| `projectDir === null` | Render early con `"No project open."`. Sin llamadas IPC. |
| Directorio no existe en disco | `gitGetConfig` retorna error. Panel muestra error banner. |
| `.git` existe pero está corrupto | `git remote get-url` falla. Panel muestra `hasGit: true` y `remoteUrl: null` con error en banner. |
| Git no instalado | `gitInit` / `gitSetRemote` / `gitSetIdentity` retornan `E_GIT_NOT_FOUND`. Mensaje claro en UI. |
| Remote `origin` ya existe al guardar | Backend maneja internamente con `set-url`. El renderer recibe éxito. |
| URL con espacios o caracteres inválidos | Validación frontend bloquea el botón. Backend como segunda línea de defensa. |
| URL SSH (`git@github.com:...`) | Permitida. `RepoVisibilityBadge` muestra `"ssh_url"` (amber). Credenciales NO se muestran (SSH no usa user/pass). |
| URL de GitLab o Bitbucket | Permitida. `RepoVisibilityBadge` muestra `"unknown_provider"` (amber). Credenciales NO se muestran. |
| URL de repo privado de GitHub | `RepoVisibilityBadge` muestra `"private"` (rojo). Credenciales SÍ se muestran y son obligatorias. |
| Sin conexión a internet al chequear visibilidad | `RepoVisibilityBadge` muestra `"network_error"` (naranja). Credenciales NO se muestran. No bloquea el guardado. |
| Usuario cambia de proyecto mientras carga | El hook detecta el cambio de `projectDir` y cancela/ignora la respuesta anterior. |
| `git init` en directorio que ya tiene `.git` | Git lo maneja sin error (`Reinitialized existing Git repository`). Backend retorna éxito. |
| Remote URL muy larga (>2000 chars) | Validación frontend: `maxLength={2000}` en el input. |
| Cambio de sección y vuelta a Config | El hook recarga el estado al montar (efecto en `projectDir`). |
| Modo edición de remote cancelado | `isEditing = false`. El campo vuelve a `RemoteDisplay` sin cambios. |
| URL cambia de privada a pública mientras se editan credenciales | `CredentialsSubform` desaparece, valores de credenciales se limpian. |
| Fallo en paso 1 (setRemote) de la secuencia Connect | Se muestra error, no se ejecutan pasos 2 ni 3. |
| Fallo en paso 2 (saveCredentials) de la secuencia Connect | Se muestra error. El remote ya fue configurado (paso 1 exitoso). Se informa al usuario. |
| Fallo en paso 3 (setIdentity) de la secuencia Connect | Se muestra error. Remote y credenciales ya configurados. Se informa al usuario. |
| user.email con formato inválido | Validación frontend bloquea el botón con mensaje de error. |
| user.name vacío | Validación frontend bloquea el botón con mensaje de error. |

---

### 4.2 Manejo de errores en el hook

```typescript
// En loadConfig():
try {
  dispatch({ type: "LOAD_CONFIG_START" });
  const result = await getBridge().gitGetConfig({ projectDir });
  if (!result.ok) {
    dispatch({ type: "LOAD_CONFIG_ERROR", error: result.message });
    return;
  }
  dispatch({ type: "LOAD_CONFIG_SUCCESS", hasGit: result.hasGit, remoteUrl: result.remoteUrl });
} catch (err) {
  dispatch({ type: "LOAD_CONFIG_ERROR", error: "Unexpected error loading config." });
}

// En connectToGit():
try {
  dispatch({ type: "INIT_START" });
  const result = await getBridge().gitInit({ projectDir });
  if (!result.ok) {
    dispatch({ type: "INIT_ERROR", error: result.message });
    return;
  }
  dispatch({ type: "INIT_SUCCESS" });
  await loadConfig();  // refrescar estado
} catch (err) {
  dispatch({ type: "INIT_ERROR", error: "Unexpected error initializing repository." });
}

// En connect() — ver sección 2.3 para el código completo
```

---

### 4.3 Mensajes de error por código

| `GitOperationErrorCode` | Mensaje sugerido para UI |
|---|---|
| `E_NOT_A_GIT_REPO` | "This directory is not a Git repository." |
| `E_GIT_NOT_FOUND` | "Git is not installed or not found in PATH." |
| `E_INIT_FAILED` | "Failed to initialize repository. Check directory permissions." |
| `E_INVALID_REMOTE_URL` | "The URL provided was rejected by Git. Check the format." |
| `E_NO_REMOTE` | "No remote configured." (estado informativo, no error de UI) |
| `E_CREDENTIALS_SAVE_FAILED` | "Failed to save credentials. You may need to enter them again on next push." |
| `E_IDENTITY_SET_FAILED` | "Failed to configure Git identity. Check that the repository is valid." |
| `E_UNKNOWN` | "An unexpected error occurred. Check the console for details." |

---

## 5. Accesibilidad

### 5.1 Estructura semántica

- El componente raíz `GitConfigPanel` usa `<div className="git-config">` como contenedor.
- Cada subsección usa `<section>` con `aria-labelledby` apuntando al `id` de su `<h3>`.
- Los `<h3>` tienen IDs únicos: `git-config-repo-title`, `git-config-remote-title`.
- El spinner de carga inicial tiene `role="status"` + `aria-live="polite"`.
- Los subformularios (`CredentialsSubform`, `GitIdentitySubform`) usan `<fieldset>` + `<legend>` para agrupar campos relacionados.

### 5.2 Formulario de URL

| Elemento | Requisito de accesibilidad |
|---|---|
| `<input type="url">` | `<label htmlFor="git-config-remote-url">` + `aria-required="true"` |
| Error de validación | `role="alert"` + `aria-live="assertive"` + `id="git-config-url-error"` referenciado por `aria-describedby` |
| Hint (sin error) | `id="git-config-url-hint"` referenciado por `aria-describedby` |
| `aria-invalid` | `"true"` cuando hay error de validación, `"false"` en caso contrario |

### 5.3 Subformulario de credenciales

| Elemento | Requisito de accesibilidad |
|---|---|
| Contenedor | `<fieldset>` + `<legend>Authentication</legend>` |
| Campo username | `<label htmlFor="git-config-cred-username">` + `aria-required="true"` |
| Campo password | `<label htmlFor="git-config-cred-password">` + `aria-required="true"` + `type="password"` |
| Toggle visibilidad password | `aria-label="Show password"` / `"Hide password"` según estado |
| Aparición/desaparición | `aria-hidden="true/false"` según `showCredentials` + animación CSS |

### 5.4 Subformulario de identidad Git

| Elemento | Requisito de accesibilidad |
|---|---|
| Contenedor | `<fieldset>` + `<legend>Git Identity</legend>` |
| Campo user.name | `<label htmlFor="git-config-identity-name">` + `aria-required="true"` |
| Campo user.email | `<label htmlFor="git-config-identity-email">` + `aria-required="true"` + `type="email"` |
| Error user.name | `role="alert"` + `aria-live="assertive"` |
| Error user.email | `role="alert"` + `aria-live="assertive"` |

### 5.5 Botones e interactivos

| Elemento | Requisito de accesibilidad |
|---|---|
| Botón "Connect to Git" | `aria-busy="true"` durante init, `disabled` durante operación |
| Botón "Connect" | `aria-busy="true"` durante conexión, `disabled` cuando formulario inválido |
| Botón "Change Remote" | `aria-label="Change remote URL"` |
| Botón "Cancel" (edición) | `aria-label="Cancel remote URL change"` |
| Íconos decorativos (`✓`, `⚠`) | `aria-hidden="true"` |

### 5.6 Feedback dinámico

| Elemento | Atributo ARIA |
|---|---|
| Spinner de carga inicial | `role="status"` + `aria-live="polite"` |
| Spinner de operación (init/connect) | `aria-busy="true"` en el botón correspondiente |
| Error banner | `role="alert"` (implica `aria-live="assertive"`) |
| Banner de éxito | `role="status"` + `aria-live="polite"` |
| `RepoVisibilityBadge` | Ya implementado con `role="status"` + `aria-live="polite"` |

### 5.7 Navegación por teclado

- `Tab` navega entre: campo URL → [campos credenciales si visibles] → campo user.name → campo user.email → botón Connect.
- `Enter` en cualquier campo del formulario activa el botón Connect si el formulario es válido.
- `Escape` en modo edición inline cancela la edición (equivalente a "Cancel").
- Cuando un botón está `disabled`, no recibe foco (comportamiento nativo).
- El toggle de visibilidad del password es accesible por teclado (`Space` / `Enter`).

### 5.8 Contraste y visibilidad

- La URL del remoto mostrada como texto debe cumplir WCAG AA (ratio 4.5:1).
- El indicador de visibilidad reutiliza los colores de `RepoVisibilityBadge` — ya validados.
- El estado `disabled` de los botones debe ser visualmente distinguible (no solo por color).
- El campo de URL en estado de error muestra borde rojo (`--color-error`) — consistente con el resto del sistema.
- Los campos de credenciales y de identidad siguen el mismo patrón visual que el campo de URL.

---

## 6. Reglas de Estilos / CSS

### 6.1 Archivo de destino

Agregar las clases en el mismo archivo CSS que contiene los estilos de `git-branches__*` y `git-changes__*`. Verificar si es `src/ui/styles/app.css` o `app2.css` antes de editar.

### 6.2 Variables CSS requeridas

Las siguientes variables CSS ya existen en el sistema de diseño y deben reutilizarse:

| Variable | Uso en GitConfigPanel |
|---|---|
| `--color-text-primary` | URL del remoto, texto principal |
| `--color-text-muted` | Títulos de sección, labels, hints, descripciones |
| `--color-accent` | Ícono ✓ de repo detectado, focus de inputs |
| `--color-border` | Borde del input de URL |
| `--color-input-bg` | Fondo del input de URL |
| `--color-success` | Ícono ✓ de repo detectado |
| `--color-error` | Borde de error en input, banner de error |

### 6.3 Clases CSS nuevas

#### Contenedor raíz

```css
.git-config {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  overflow-y: auto;
}
```

#### Secciones (reutiliza patrón de git-branches)

```css
.git-config__section {
  padding: 1rem 1.25rem;
}

.git-config__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.git-config__section-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
```

#### Estado sin git

```css
.git-config__no-git-description {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: 1rem;
  line-height: 1.5;
}
```

#### Estado con git — repo detectado

```css
.git-config__repo-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.git-config__repo-icon {
  color: var(--color-success);
  font-size: 1rem;
  flex-shrink: 0;
}
```

#### URL del remoto (modo display)

```css
.git-config__remote-url {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--color-text-primary);
  word-break: break-all;
  margin-bottom: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.git-config__remote-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
```

#### Formulario de URL y campos generales

```css
.git-config__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.git-config__label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.git-config__input {
  width: 100%;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-input-bg);
  color: var(--color-text-primary);
  font-size: 0.875rem;
  font-family: monospace;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.git-config__input:focus {
  border-color: var(--color-accent);
}

.git-config__input--error {
  border-color: var(--color-error);
}

.git-config__hint {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.git-config__validation-error {
  font-size: 0.75rem;
  color: var(--color-error);
}

.git-config__form-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  justify-content: flex-end;
}
```

#### Subformulario de credenciales (aparición animada)

```css
.git-config__credentials {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition:
    max-height 0.25s ease,
    opacity 0.2s ease;
  margin-bottom: 0;
}

.git-config__credentials--visible {
  max-height: 200px; /* suficiente para los dos campos */
  opacity: 1;
  margin-bottom: 0.75rem;
}

.git-config__credentials fieldset {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.75rem;
  margin: 0;
}

.git-config__credentials legend {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  padding: 0 0.25rem;
}

/* Campo de password con toggle de visibilidad */
.git-config__password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.git-config__password-wrapper .git-config__input {
  padding-right: 2.5rem;
}

.git-config__password-toggle {
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.25rem;
  display: flex;
  align-items: center;
}

.git-config__password-toggle:hover {
  color: var(--color-text-primary);
}
```

#### Subformulario de identidad Git

```css
.git-config__identity fieldset {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.75rem;
  margin: 0 0 0.75rem 0;
}

.git-config__identity legend {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  padding: 0 0.25rem;
}
```

#### Estado sin proyecto

```css
.git-config__no-project {
  padding: 1rem;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
```

#### Spinner de carga inicial

```css
.git-config__loading {
  padding: 1rem 1.25rem;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
```

### 6.4 Clases reutilizadas de `git-branches__*`

Las siguientes clases ya existen y deben reutilizarse sin duplicar:

| Clase | Uso en GitConfigPanel |
|---|---|
| `git-branches__divider` | Separador entre subsecciones |
| `git-branches__error-banner` | Banner de error (init, connect) |
| `git-branches__success-banner` | Banner de éxito (connect exitoso) |
| `btn` | Base de todos los botones |
| `btn--primary` | Botón "Connect to Git", botón "Connect" |
| `btn--ghost` | Botón "Change Remote", botón "Cancel" |

### 6.5 Convenciones de nomenclatura CSS

- Prefijo: `git-config__` para todos los elementos nuevos.
- Modificadores: `git-config__elemento--modificador` (BEM-like).
- No usar `!important`.
- No usar estilos inline en JSX (excepto valores dinámicos imposibles de expresar en CSS).
- Usar variables CSS del sistema de diseño, nunca valores hardcodeados de color.

---

## 7. Checklist QA

### 7.1 Detección de repositorio

- [ ] Al abrir la sección "Config", se detecta automáticamente si el directorio tiene `.git`.
- [ ] Si no tiene `.git`, se muestra `NoGitSection` con el botón "Connect to Git".
- [ ] Si tiene `.git`, se muestra `HasGitSection` con la información del repositorio.
- [ ] El spinner de carga aparece mientras se detecta el estado del repositorio.
- [ ] Si `projectDir === null`, se muestra `"No project open."` sin llamadas IPC.

### 7.2 Flujo "Connect to Git" (sin `.git`)

- [ ] El botón "Connect to Git" ejecuta `git init` en el directorio del proyecto.
- [ ] Durante la operación, el botón muestra `"Initializing…"` y está deshabilitado.
- [ ] Tras un init exitoso, el panel transiciona automáticamente a `HasGitSection`.
- [ ] Tras un init fallido, se muestra un banner de error con el mensaje.
- [ ] El botón se rehabilita tras un error para permitir reintentar.
- [ ] Si git no está instalado, el error es claro y comprensible.

### 7.3 Flujo sin remote configurado — formulario de conexión

- [ ] Si el repo no tiene remote, se muestra el formulario completo de conexión.
- [ ] El campo de URL tiene `type="url"` y `placeholder` descriptivo.
- [ ] El botón "Connect" está deshabilitado cuando el campo URL está vacío.
- [ ] El botón "Connect" está deshabilitado cuando la URL tiene formato inválido.
- [ ] El error de validación de URL aparece debajo del campo con el mensaje correcto.
- [ ] `RepoVisibilityBadge` aparece y se actualiza mientras el usuario escribe (debounce 600ms).
- [ ] Los campos de `GitIdentitySubform` (user.name, user.email) son **siempre visibles**.
- [ ] El botón "Connect" está deshabilitado si user.name está vacío.
- [ ] El botón "Connect" está deshabilitado si user.email está vacío o tiene formato inválido.
- [ ] Los errores de user.name y user.email aparecen debajo de cada campo.

### 7.4 Credenciales condicionales

- [ ] `CredentialsSubform` **NO** aparece cuando `visibilityStatus` es `"public"`.
- [ ] `CredentialsSubform` **NO** aparece cuando `visibilityStatus` es `"ssh_url"`.
- [ ] `CredentialsSubform` **NO** aparece cuando `visibilityStatus` es `"unknown_provider"`.
- [ ] `CredentialsSubform` **NO** aparece cuando `visibilityStatus` es `"network_error"`.
- [ ] `CredentialsSubform` **NO** aparece cuando `visibilityStatus` es `"idle"` o `"checking"`.
- [ ] `CredentialsSubform` **SÍ** aparece cuando `visibilityStatus` es `"private"`.
- [ ] La aparición de `CredentialsSubform` tiene animación suave (opacity + max-height).
- [ ] Al desaparecer `CredentialsSubform`, los valores de username y password se limpian.
- [ ] El botón "Connect" está deshabilitado si `visibilityStatus === "private"` y username está vacío.
- [ ] El botón "Connect" está deshabilitado si `visibilityStatus === "private"` y password está vacío.
- [ ] El campo de password tiene toggle de visibilidad funcional.

### 7.5 Secuencia de conexión (botón "Connect")

- [ ] Al hacer clic en "Connect", se ejecuta la secuencia: setRemote → [saveCredentials si privado] → setIdentity.
- [ ] Durante la operación, el botón muestra `"Connecting…"` y está deshabilitado.
- [ ] Todos los campos del formulario se deshabilitan durante la operación.
- [ ] Si `setRemote` falla, se muestra error y no se ejecutan los pasos siguientes.
- [ ] Si `saveCredentials` falla, se muestra error indicando que el remote fue configurado pero las credenciales no.
- [ ] Si `setIdentity` falla, se muestra error indicando qué pasos anteriores sí se completaron.
- [ ] Tras conexión exitosa, el panel transiciona a `RemoteDisplay`.
- [ ] Tras conexión exitosa, se muestra un banner de éxito temporal (3 segundos).
- [ ] El botón se rehabilita tras un error para permitir reintentar.

### 7.6 Flujo con remote configurado

- [ ] La URL del remoto se muestra como texto (no como enlace clickeable).
- [ ] `RepoVisibilityBadge` se muestra **siempre** debajo de la URL del remoto.
- [ ] `RepoVisibilityBadge` muestra el estado correcto al montar la sección.
- [ ] El botón "Change Remote" activa el modo edición inline.
- [ ] En modo edición, el campo URL se pre-rellena con la URL actual.
- [ ] El botón "Cancel" en modo edición vuelve a `RemoteDisplay` sin cambios.
- [ ] Al guardar en modo edición, el panel vuelve a `RemoteDisplay` con la nueva URL.
- [ ] `RepoVisibilityBadge` se actualiza tras guardar la nueva URL.

### 7.7 Validación de URL

- [ ] URL vacía: botón deshabilitado, sin error visible.
- [ ] URL con formato inválido (sin prefijo reconocido): error visible, botón deshabilitado.
- [ ] URL HTTPS válida (`https://github.com/...`): sin error, botón habilitado (si resto del formulario válido).
- [ ] URL SSH válida (`git@github.com:...`): sin error, botón habilitado (si resto del formulario válido).
- [ ] URL SSH muestra `RepoVisibilityBadge` con estado `"ssh_url"` (amber). Sin credenciales.
- [ ] URL de GitLab/Bitbucket muestra `RepoVisibilityBadge` con estado `"unknown_provider"` (amber). Sin credenciales.
- [ ] URL de repo público de GitHub muestra `RepoVisibilityBadge` con estado `"public"` (verde). Sin credenciales.
- [ ] URL de repo privado de GitHub muestra `RepoVisibilityBadge` con estado `"private"` (rojo). Con credenciales.
- [ ] El campo no acepta más de 2000 caracteres (`maxLength`).

### 7.8 Indicador de visibilidad

- [ ] `RepoVisibilityBadge` muestra spinner mientras verifica.
- [ ] `RepoVisibilityBadge` muestra el estado correcto tras la verificación.
- [ ] Sin conexión a internet: muestra `"network_error"` (naranja), no bloquea el guardado.
- [ ] El badge no aparece cuando la URL está vacía o tiene formato inválido.
- [ ] En `RemoteDisplay`, el badge siempre es visible (no depende de edición).

### 7.9 Manejo de errores

- [ ] Error de `gitGetConfig`: banner de error en el panel, sin crash.
- [ ] Error de `gitInit`: banner de error en `NoGitSection`, botón rehabilitado.
- [ ] Error de `gitSetRemote`: banner de error en el formulario, campos rehabilitados.
- [ ] Error de `gitSaveCredentials`: banner de error con contexto (remote ya configurado).
- [ ] Error de `gitSetIdentity`: banner de error con contexto (pasos anteriores completados).
- [ ] Error `E_GIT_NOT_FOUND`: mensaje claro sobre git no instalado.
- [ ] Error `E_INIT_FAILED`: mensaje claro sobre permisos o disco.
- [ ] Error `E_INVALID_REMOTE_URL`: mensaje claro sobre formato de URL.
- [ ] Error `E_CREDENTIALS_SAVE_FAILED`: mensaje claro sobre fallo en credenciales.
- [ ] Error `E_IDENTITY_SET_FAILED`: mensaje claro sobre fallo en identidad.
- [ ] Todos los errores son recuperables (el usuario puede reintentar).

### 7.10 Edge cases

- [ ] Directorio con `.git` corrupto: panel muestra repo detectado pero sin remote, con error informativo.
- [ ] Remote `origin` ya existe al guardar: backend maneja con `set-url`, renderer recibe éxito.
- [ ] `git init` en directorio que ya tiene `.git`: operación exitosa (git lo permite).
- [ ] URL con caracteres especiales (comillas, espacios): validación frontend bloquea, backend seguro con `execFile`.
- [ ] Cambio de proyecto mientras carga: el hook recarga con el nuevo `projectDir`.
- [ ] Cambio de sección y vuelta a Config: el estado se recarga correctamente.
- [ ] URL cambia de privada a pública: credenciales desaparecen y se limpian.
- [ ] URL cambia de pública a privada: credenciales aparecen vacías.

### 7.11 Accesibilidad

- [ ] El campo de URL tiene `<label>` asociado con `htmlFor`.
- [ ] Los campos de credenciales están agrupados en `<fieldset>` + `<legend>`.
- [ ] Los campos de identidad están agrupados en `<fieldset>` + `<legend>`.
- [ ] Los errores de validación tienen `role="alert"` y `aria-live="assertive"`.
- [ ] Los banners de éxito tienen `role="status"`.
- [ ] Los botones tienen `aria-busy="true"` durante operaciones.
- [ ] Los íconos decorativos tienen `aria-hidden="true"`.
- [ ] Los elementos deshabilitados usan el atributo `disabled` (no solo estilos).
- [ ] `CredentialsSubform` tiene `aria-hidden="true"` cuando no es visible.
- [ ] La navegación por teclado (Tab) recorre todos los elementos interactivos en orden lógico.
- [ ] `Enter` en cualquier campo activa el botón Connect si el formulario es válido.
- [ ] `Escape` en modo edición inline cancela la edición.
- [ ] El toggle de visibilidad del password es accesible por teclado.

### 7.12 Estilos y visual

- [ ] La sección "Config" aparece como primera opción en el sidebar del modal Git.
- [ ] El modal abre en la sección "Config" por defecto (estado inicial).
- [ ] El botón "Config" en el sidebar tiene el estilo activo correcto al seleccionarse.
- [ ] La URL del remoto usa fuente monospace y es legible.
- [ ] El campo de URL en error muestra borde rojo.
- [ ] El campo de URL en foco muestra borde de acento.
- [ ] Los separadores `git-branches__divider` aparecen entre subsecciones.
- [ ] El panel no desborda el modal en ningún estado.
- [ ] El estado `disabled` de los botones es visualmente distinguible.
- [ ] La animación de aparición/desaparición de credenciales es suave.
- [ ] Los `<fieldset>` de credenciales e identidad tienen borde y padding consistentes.
- [ ] El badge de visibilidad en `RemoteDisplay` es siempre visible y legible.

### 7.13 Integración IPC

- [ ] `gitGetConfig` se llama correctamente con `{ projectDir }`.
- [ ] `gitInit` se llama correctamente con `{ projectDir }`.
- [ ] `gitSetRemote` se llama correctamente con `{ projectDir, url }`.
- [ ] `gitSaveCredentials` se llama correctamente con `{ projectDir, url, username, password }`.
- [ ] `gitSetIdentity` se llama correctamente con `{ projectDir, userName, userEmail }`.
- [ ] Las respuestas de error (`ok: false`) se manejan sin excepciones no capturadas.
- [ ] Los handlers IPC están registrados en `ipc-handlers.ts`.
- [ ] Los métodos están expuestos en `preload.ts` y accesibles via `window.agentsFlow`.
- [ ] Las credenciales nunca se loguean en consola ni en archivos de log.

### 7.14 Regresión

- [ ] La sección "Branches" del modal Git sigue funcionando correctamente.
- [ ] La sección "Changes" del modal Git sigue funcionando correctamente.
- [ ] El modal Git abre y cierra correctamente.
- [ ] El cambio de sección entre "Config", "Branches" y "Changes" no causa errores.
- [ ] No hay memory leaks (timeouts limpiados en cleanup de useEffect).
- [ ] No hay llamadas IPC duplicadas al montar/desmontar el componente.
- [ ] El orden del sidebar es: Config → Branches → Changes.

---

## 📁 Archivos involucrados

| Acción | Archivo | Descripción |
|---|---|---|
| **Crear** | `src/electron/git-config.ts` | Backend: `getConfig()`, `initRepo()`, `setRemote()`, `saveCredentials()`, `setIdentity()`, `registerGitConfigHandlers()` |
| **Crear** | `src/ui/hooks/useGitConfig.ts` | Hook React con reducer, estado y callbacks |
| **Crear** | `src/ui/components/GitIntegrationModal/GitConfigPanel.tsx` | Componente principal con subsecciones |
| **Crear** | `src/ui/components/GitIntegrationModal/RemoteConnectForm.tsx` | Formulario unificado: URL + credenciales condicionales + identidad Git |
| **Crear** | `src/ui/components/GitIntegrationModal/CredentialsSubform.tsx` | Subformulario de credenciales (aparición condicional) |
| **Crear** | `src/ui/components/GitIntegrationModal/GitIdentitySubform.tsx` | Subformulario de identidad Git (siempre visible) |
| **Modificar** | `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx` | Agregar `"config"` a `GitSection`, sidebar y render condicional |
| **Modificar** | `src/ui/components/GitIntegrationModal/index.ts` | Exportar `GitConfigPanel` y subcomponentes |
| **Modificar** | `src/electron/bridge.types.ts` | Tipos IPC nuevos + códigos de error nuevos |
| **Modificar** | `src/electron/preload.ts` | Exposición de `gitGetConfig`, `gitInit`, `gitSetRemote`, `gitSaveCredentials`, `gitSetIdentity` |
| **Modificar** | `src/electron/ipc-handlers.ts` | Registro de `registerGitConfigHandlers` |
| **Modificar** | `src/ui/styles/app.css` (o `app2.css`) | Clases CSS `git-config__*` incluyendo animación de credenciales |

---

*Documento generado por Weight-Planner — AgentsFlow Git Config Panel Specs*  
*Fecha: 2026-04-27 (actualizado con credenciales condicionales, identidad Git obligatoria, botón "Connect" y badge de visibilidad en RemoteDisplay)*
