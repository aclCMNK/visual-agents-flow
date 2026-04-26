# 🔍 Reporte: Módulo de Clonado/Importación desde Git

> **Propósito:** Documentar exhaustivamente cómo funciona el módulo de Clone from Git en AgentsFlow, para que cualquier miembro del equipo pueda trabajar sobre él sin exploración previa.

---

## 📁 Archivos del Módulo

| Archivo | Capa | Responsabilidad |
|---|---|---|
| `src/ui/components/CloneFromGitModal.tsx` | UI / Renderer | Modal principal: formulario, estados, orquestación de flujo |
| `src/ui/components/CredentialsBlock.tsx` | UI / Renderer | Bloque de credenciales (username + token) para repos privados |
| `src/ui/components/RepoVisibilityBadge.tsx` | UI / Renderer | Badge visual que muestra el estado de visibilidad del repo |
| `src/ui/utils/gitUrlUtils.ts` | UI / Utils | Validación sintáctica de URLs Git (sin red) |
| `src/ui/utils/repoVisibility.ts` | UI / Utils | Detección de visibilidad del repo vía GitHub API (IPC proxy) |
| `src/ui/utils/clonePermission.ts` | UI / Utils | Mapeo (provider, visibility) → permiso de clonar → estado UI |
| `src/ui/store/projectStore.ts` | UI / Store | `openProjectAfterClone()`, `gitRemoteOrigin` state |
| `src/electron/ipc-handlers.ts` | Main Process | Handlers IPC: `GIT_CLONE`, `GIT_CLONE_CANCEL`, `GIT_CLONE_VALIDATE`, `GITHUB_FETCH`, `GET_GIT_REMOTE_ORIGIN` |
| `src/electron/git-detector.ts` | Main Process | Detecta si un directorio es repo Git y retorna URL del remote `origin` |
| `src/electron/bridge.types.ts` | Shared | Contratos IPC: `CloneRepositoryRequest/Result`, `CloneProgressEvent`, `CloneCancelRequest/Result`, `CloneValidateRequest/Result` |
| `src/electron/preload.ts` | Preload | Expone `window.agentsFlow.cloneRepository`, `cancelClone`, `validateCloneToken`, `onCloneProgress`, `offCloneProgress` |

---

## 🏗️ Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                         │
│                                                                 │
│  CloneFromGitModal.tsx                                          │
│    ├── gitUrlUtils.ts        (validación sintáctica URL)        │
│    ├── repoVisibility.ts     (detecta public/private via IPC)   │
│    ├── clonePermission.ts    (decide si se puede clonar)        │
│    ├── RepoVisibilityBadge   (badge visual)                     │
│    └── CredentialsBlock      (username + token, solo GitHub)    │
│                                                                 │
│  projectStore.ts                                                │
│    └── openProjectAfterClone() → openProject()                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ IPC (contextBridge)
                           │ window.agentsFlow.*
┌──────────────────────────▼──────────────────────────────────────┐
│                        MAIN PROCESS                             │
│                                                                 │
│  ipc-handlers.ts                                                │
│    ├── git:clone           → spawn("git clone --progress")      │
│    ├── git:clone:cancel    → SIGTERM → SIGKILL (5s timeout)     │
│    ├── git:clone:validate  → HTTPS GET api.github.com/user      │
│    ├── github:fetch        → HTTPS GET api.github.com/repos/*   │
│    └── git:get-remote-origin → git-detector.ts                  │
│                                                                 │
│  git-detector.ts                                                │
│    └── detectGitRemoteOrigin() → execFile("git remote get-url") │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo Completo de Clonado

### Fase 1: Entrada de URL y Validación Sintáctica

1. Usuario escribe URL en el campo `Repository URL`
2. En cada keystroke: `validateGitUrl(url)` (sin red, solo regex)
3. Se invalida cualquier check de visibilidad en vuelo (`visibilityRequestIdRef++`)
4. Se limpian credenciales si la URL cambia

**Esquemas soportados por `validateGitUrl`:**
- `https://host/org/repo.git` → scheme: `"https"`
- `http://host/org/repo.git` → scheme: `"http"`
- `git@host:org/repo.git` → scheme: `"ssh"`
- `git://host/org/repo.git` → scheme: `"git"`
- `ssh://git@host/org/repo.git` → scheme: `"ssh+git"`

---

### Fase 2: Detección de Visibilidad (al perder foco del campo URL)

```
handleUrlBlur()
  └── runVisibilityCheck(url)
        ├── parseRepoUrl(url)          → extrae provider, owner, repo
        ├── setVisibility("checking")
        ├── detectRepoVisibility(url)  → IPC proxy → api.github.com
        │     ├── SSH URL → retorna "ssh_url" (no queryable)
        │     ├── Non-GitHub → retorna "unknown_provider"
        │     └── GitHub → githubFetch({ url: apiUrl, token? })
        │           ├── 200 → "public"
        │           ├── 401/403 → "private"
        │           ├── 404 → "not_found"
        │           ├── 429 → "network_error"
        │           └── error → "network_error"
        └── setRepoVisibility(result)
              └── getClonePermission(provider, visibility)
```

**Importante:** La detección de visibilidad usa el IPC proxy `window.agentsFlow.githubFetch` porque el renderer está bloqueado por CSP para hacer `fetch()` directo a dominios externos. El main process hace la llamada HTTPS real.

---

### Fase 3: Evaluación de Permisos

`getClonePermission(provider, visibility)` → `ClonePermission`:

| Visibility | Provider | Resultado |
|---|---|---|
| `"public"` | cualquiera | `ALLOWED` |
| `"private"` | `"github"` | `ALLOWED` (muestra bloque de credenciales) |
| `"private"` | otro | `BLOCKED_PRIVATE_NON_GITHUB` |
| `"not_found"` | cualquiera | `BLOCKED_NOT_FOUND` |
| `"invalid_url"` | — | `BLOCKED_INVALID` |
| `"unknown_provider"` | no-github | `BLOCKED_UNKNOWN_NON_GITHUB` |
| `"ssh_url"` | — | `INDETERMINATE` (no bloquea) |
| `"network_error"` | — | `INDETERMINATE` (no bloquea) |
| `null` | — | `PENDING` |

`getCloneUIState(permission)` → `{ buttonDisabled, errorMessage }` para el modal.

---

### Fase 4: Credenciales (solo repos privados de GitHub)

- El bloque `CredentialsBlock` aparece **solo** cuando `provider === "github" && visibility === "private"`
- Campos: `username` (GitHub username) + `token` (Personal Access Token)
- Botón **"Validate Token"**: llama `bridge.validateCloneToken({ token, username? })` → IPC `git:clone:validate` → `GET https://api.github.com/user` con el token
- Las credenciales son **efímeras**: nunca se persisten, se limpian al cerrar el modal, al cambiar la URL, y después del clone

---

### Fase 5: Ejecución del Clone

```
handleClone()
  ├── Si visibility === "idle": runVisibilityCheck() primero
  ├── Valida credenciales si repo privado GitHub
  ├── Genera UUID: cloneId = crypto.randomUUID()
  ├── bridge.cloneRepository({ url, destDir, repoName, cloneId, auth? })
  │     └── IPC: git:clone
  │           ├── Valida cloneId, url, destDir
  │           ├── Verifica concurrencia (max 3 simultáneos)
  │           ├── Verifica que destDir/<repoName> no exista (o esté vacío)
  │           ├── Construye URL autenticada: https://user:token@host/...
  │           ├── spawn("git", ["clone", "--progress", "--", cloneUrl, clonedPath])
  │           │     env: GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=""
  │           ├── cloneUrl = "" (limpieza inmediata post-spawn)
  │           ├── Registra en activeClones Map<cloneId, ChildProcess>
  │           ├── Parsea stderr → emite git:clone:progress (throttle 500ms)
  │           └── Al cerrar proceso:
  │                 ├── code=0 → { success: true, clonedPath }
  │                 ├── cancelledCloneIds → { errorCode: "CANCELLED" }
  │                 └── code≠0 → mapGitStderrToErrorCode() → errorCode
  └── onCloned(clonedPath) → projectStore.openProjectAfterClone()
```

---

### Fase 6: Progreso en Tiempo Real

El main process parsea stderr de git y emite eventos `git:clone:progress`:

```
"Receiving objects:  45% (450/1000), 1.23 MiB | 500 KiB/s"
  → CloneProgressEvent { cloneId, stage: "RECEIVING_OBJECTS", percent: 45, raw: "..." }
```

Stages mapeados:
| Texto en stderr | Stage |
|---|---|
| `Counting objects` | `COUNTING_OBJECTS` |
| `Compressing objects` | `COMPRESSING` |
| `Receiving objects` | `RECEIVING_OBJECTS` |
| `Resolving deltas` | `RESOLVING_DELTAS` |
| `Checking out files` | `CHECKING_OUT` |

El renderer muestra: barra de progreso `<progress>` + label con stage y porcentaje.

---

### Fase 7: Cancelación

```
handleCancelClone()
  └── bridge.cancelClone({ cloneId })
        └── IPC: git:clone:cancel
              ├── Busca child en activeClones
              ├── Marca cloneId en cancelledCloneIds Set
              ├── child.kill("SIGTERM")
              └── Si no muere en 5s → child.kill("SIGKILL")
```

El handler del clone detecta la cancelación por `cancelledCloneIds` (necesario en Windows donde `signal` puede ser `null`).

---

### Fase 8: Post-Clone

```
onCloned(clonedPath)
  └── projectStore.openProjectAfterClone(clonedPath)
        ├── Si hay proyecto abierto: confirm dialog
        └── openProject(clonedPath)
```

---

## 🔐 Seguridad

| Medida | Descripción |
|---|---|
| **No logging de credenciales** | Comentarios `// SECURITY: Do NOT log credentials` en todo el código |
| **URL autenticada efímera** | `cloneUrl = ""` inmediatamente después de `spawn()` |
| **No persistencia** | `auth` nunca se guarda en `activeClones` ni en ningún store |
| **GIT_TERMINAL_PROMPT=0** | Previene prompts interactivos de git |
| **GIT_ASKPASS=""** | Previene que git abra un helper de credenciales |
| **sanitizeCredentials()** | Reemplaza `https://user:pass@` con `https://[REDACTED]@` en todos los logs |
| **CSP proxy** | El renderer no puede hacer `fetch()` directo; todo pasa por IPC |
| **Limpieza en cierre** | Credenciales se limpian al cerrar modal, cambiar URL, y post-clone |

---

## ⚠️ Casos de Error y Códigos

| `errorCode` | Causa | Mensaje UI |
|---|---|---|
| `AUTH_ERROR` | Token inválido, expirado, sin permisos, 401/403 | "Authentication failed. Check your username and token..." |
| `DEST_EXISTS` | El directorio destino ya existe y no está vacío | "A folder with that name already exists..." |
| `NETWORK_ERROR` | Sin conexión, host no resuelve, timeout | "Could not reach the repository..." |
| `GIT_NOT_FOUND` | `git` no está en PATH | "Git is not installed or not found on PATH..." |
| `INVALID_URL` | URL no parseable | "The repository URL is invalid..." |
| `CANCELLED` | Usuario canceló | "Clone was cancelled." |
| `CONCURRENT_LIMIT` | Ya hay 3 clones activos | "Too many clones running at once..." |
| `IO_ERROR` | Error de filesystem, permisos | "A filesystem error occurred..." |
| `UNKNOWN` | Cualquier otro error de git | Fallback al mensaje raw de git |

Los errores también incluyen `technicalDetails` (stderr sanitizado) que el usuario puede expandir en el modal.

---

## 🌐 Casos de Uso Soportados

| Caso | Soporte |
|---|---|
| Repo público GitHub (HTTPS) | ✅ Completo |
| Repo privado GitHub (HTTPS + token) | ✅ Completo |
| Repo público GitLab/Bitbucket (HTTPS) | ⚠️ Parcial — se puede clonar pero visibilidad no se detecta (`unknown_provider`) |
| Repo privado GitLab/Bitbucket | ❌ Bloqueado — `BLOCKED_PRIVATE_NON_GITHUB` |
| URL SSH (`git@host:org/repo`) | ⚠️ Parcial — se puede clonar pero visibilidad es `INDETERMINATE` (no queryable) |
| URL `git://` | ⚠️ Parcial — igual que SSH |
| Cancelación en vuelo | ✅ Completo (SIGTERM → SIGKILL) |
| Progreso en tiempo real | ✅ Completo (stderr parsing + throttle 500ms) |
| Validación de token antes de clonar | ✅ Completo (GitHub API /user) |
| Múltiples clones simultáneos | ✅ Hasta 3 (MAX_CONCURRENT_CLONES) |

---

## 🔍 Detección de Remote Origin (Feature Secundaria)

Cuando se abre un proyecto, `projectStore.ts` llama `GET_GIT_REMOTE_ORIGIN` para mostrar el badge de remote en la UI.

```
detectGitRemoteOrigin(projectDir)
  ├── existsSync(projectDir/.git)  → si no existe: null
  └── execFile("git", ["remote", "get-url", "origin"], { timeout: 3000 })
        ├── éxito → URL del remote
        └── error/timeout → null
```

- Timeout: 3 segundos (hard cap)
- `windowsHide: true` (evita flash de CMD en Windows)
- Nunca lanza excepciones — siempre resuelve con `string | null`

---

## 🐛 Limitaciones Conocidas

1. **Solo GitHub para repos privados**: GitLab y Bitbucket privados están bloqueados. El código tiene un comentario explícito indicando el punto de extensión (`supportedPrivateProviders` en `clonePermission.ts`).

2. **SSH no queryable**: URLs SSH no pueden verificar visibilidad vía API REST. El sistema las trata como `INDETERMINATE` (no bloquea, pero tampoco confirma).

3. **GitLab/Bitbucket públicos**: Técnicamente se pueden clonar, pero el sistema no puede confirmar que son públicos (retorna `unknown_provider`). El botón no se deshabilita pero tampoco muestra confirmación de visibilidad.

4. **Repo name no editable**: El nombre del directorio destino se deriva automáticamente de la URL y no es editable por el usuario. Si ya existe un directorio con ese nombre, el clone falla con `DEST_EXISTS`.

5. **No shallow clone**: No hay opción para `--depth 1` u otras flags de git. Siempre es un clone completo.

6. **No branch selection**: No se puede especificar una rama o tag específico. Siempre clona el branch por defecto.

7. **Concurrencia limitada a 3**: `MAX_CONCURRENT_CLONES = 3`. Si se intenta un 4to clone simultáneo, falla con `CONCURRENT_LIMIT`.

8. **Windows SIGTERM**: En Windows, `child.kill("SIGTERM")` puede no funcionar correctamente. El sistema usa `cancelledCloneIds` Set como workaround para detectar cancelaciones cuando `signal === null`.

---

## 📦 Dependencias

| Dependencia | Uso |
|---|---|
| `node:child_process` → `spawn` | Ejecutar `git clone --progress` |
| `node:child_process` → `execFile` | Ejecutar `git remote get-url origin` |
| `node:https` | Llamadas a `api.github.com` (githubFetch, validateToken) |
| `node:fs/promises` | Verificar destDir, leer directorio |
| `node:fs` → `existsSync` | Verificar existencia de `.git` y destino |
| `node:path` | Construir rutas |
| `electron` → `ipcMain`, `BrowserWindow` | Registro de handlers y envío de eventos de progreso |
| `crypto.randomUUID()` | Generar cloneId en el renderer |
| `react` → `useState`, `useEffect`, `useCallback`, `useRef` | Estado del modal |

**No hay dependencias de terceros** para el módulo de clone. Todo usa Node.js built-ins.

---

## 🗺️ Diagrama de Estados del Modal

```
idle
  │ URL válida + dir seleccionado
  ▼
[checking visibility]
  │ resultado
  ├──→ ALLOWED → botón habilitado
  ├──→ BLOCKED_* → botón deshabilitado + mensaje error
  └──→ INDETERMINATE → botón habilitado (sin confirmación)

[usuario hace click en Clone]
  │
  ▼
cloning
  │ progreso via git:clone:progress events
  ├──→ success → fase "success" → botón "Done"
  └──→ error → fase "error" → mensaje + detalles técnicos

[usuario hace click en Done]
  │
  ▼
onCloned(path) → projectStore.openProjectAfterClone()
```

---

## 🔌 Puntos de Extensión

Para agregar soporte de repos privados en GitLab/Bitbucket:

1. **`repoVisibility.ts`**: Agregar proxy IPC para `api.gitlab.com` / `api.bitbucket.org` (actualmente solo `api.github.com` está proxied)
2. **`clonePermission.ts`**: Agregar `"gitlab"` y/o `"bitbucket"` al array `supportedPrivateProviders`
3. **`ipc-handlers.ts`**: Extender el handler `GITHUB_FETCH` (o crear uno nuevo) para aceptar URLs de otros providers

Para agregar opciones de clone (shallow, branch):
1. Agregar campos al formulario en `CloneFromGitModal.tsx`
2. Agregar campos a `CloneRepositoryRequest` en `bridge.types.ts`
3. Modificar el array de args en `spawn("git", [...])` en `ipc-handlers.ts`

---

*Generado por Weight-Planner — AgentsFlow · Fecha: 2026-04-25*
