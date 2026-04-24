> Fecha: 2026-04-23 | Versión: 1.0

# Flujo Completo de Clonado de Repos Privados GitHub

## Sección 1 — Visión General

- Diagrama de flujo completo en Mermaid:

```mermaid
flowchart TD
    A[Usuario ingresa URL] --> B{validateGitUrl}
    B -->|inválida| C[Badge: invalid_url\nBotón: disabled]
    B -->|válida| D[detectRepoVisibility via IPC githubFetch]
    D -->|public| E[Badge: public\nBotón: enabled si destDir]
    D -->|private + GitHub| F[Badge: private\nMostrar CredentialsBlock]
    D -->|not_found| G[Badge: not_found\nBotón: disabled]
    D -->|network_error| H[Badge: network_error\nBotón: disabled]
    D -->|unknown_provider| I[Badge: unknown_provider\nBotón: enabled sin auth]
    D -->|ssh_url| J[Badge: ssh_url\nBotón: disabled]
    
    F --> K[Usuario ingresa username + token]
    K --> L[Click Validate Token]
    L --> M{IPC validateCloneToken}
    M -->|valid: true| N[tokenValidated = true\nBotón Clone: enabled]
    M -->|valid: false| O[Error inline\nBotón Clone: disabled]
    
    E --> P[Click Clone]
    I --> P
    N --> P
    
    P --> Q{Construir CloneRepositoryRequest}
    Q -->|sin auth| R[Request público]
    Q -->|con auth| S[Request privado]
    
    R --> T[IPC cloneRepository]
    S --> T
    
    T --> U{Concurrency check}
    U -->|> 3 activos| V[Error: límite alcanzado]
    U -->|OK| W[spawn git clone --progress]
    
    W --> X[Limpiar auth del request]
    X --> Y[Parsear stderr → onCloneProgress]
    Y --> Z{Exit code}
    Z -->|0| AA[Fase: success\nAgregar a projectStore]
    Z -->|!= 0| BB[Fase: error\nMensaje específico]
```

- Componentes involucrados:
  - `CloneFromGitModal.tsx` — Orquestador principal del flujo
  - `CredentialsBlock.tsx` — Inputs de username + token (solo repos privados GitHub)
  - `RepoVisibilityBadge.tsx` — Badge visual de estado del repositorio
  - `gitUrlUtils.ts` — Validación de formato de URL Git
  - `repoVisibility.ts` — Detección de visibilidad pública/privada
  - `clonePermission.ts` — Lógica de permisos y estado del botón Clone
  - `projectStore.ts` — Zustand store (actualización post-clone)
  - `ipc-handlers.ts` — Handlers del main process (Electron)
  - `bridge.types.ts` — Contratos de tipos IPC

## Sección 2 — Detección de Visibilidad

**Cómo funciona `detectRepoVisibility()`:**
1. Parsea la URL con `parseRepoUrl()` → extrae provider, owner, repo
2. Solo GitHub es soportado (GitLab/Bitbucket retornan `"unknown_provider"`)
3. Llama al proxy IPC `window.agentsFlow.githubFetch()` (restricción CSP: el renderer no puede hacer fetch directo)
4. Realiza GET a `https://api.github.com/repos/{owner}/{repo}`
5. Mapea status HTTP a visibilidad:
   - 200–299 → `"public"`
   - 401/403/404 → `"private"` (o `"not_found"`)
   - 429 → `"network_error"` (rate-limited)

**Tabla de estados y badges:**

| Estado | Badge | Color | Mensaje |
|---|---|---|---|
| `public` | 🟢 | verde | "Public repository" |
| `private` | 🔒 | amarillo/naranja | "Private repository" |
| `not_found` | ❌ | rojo | "Repository not found" |
| `unknown_provider` | ℹ️ | gris | "Non-GitHub URL" |
| `ssh_url` | ⚠️ | naranja | "SSH URL not supported" |
| `network_error` | 🔴 | rojo | "Network error" |
| `invalid_url` | — | — | (no se muestra badge) |

**Casos especiales:**
- `unknown_provider`: Para URLs de GitLab, Bitbucket o servidores self-hosted. No se puede determinar visibilidad. El botón Clone se habilita sin credenciales. Si el repo es privado, git fallará con exit 128 (comportamiento esperado, no bug).
- `ssh_url`: URLs SSH no son consultables vía API. El botón Clone se deshabilita con mensaje explicativo.

## Sección 3 — Validación de Token

**Cuándo se muestra `CredentialsBlock`:**
```
showCredentials = (
  visibility === "private"
  AND isGitHubUrl(url)
)
```
Nota: `unknown_provider` NO muestra credenciales aunque el repo sea privado.

**Flujo de `validateCloneToken` IPC:**
```
Usuario click "Validate Token"
  → CloneFromGitModal: setValidating(true)
  → IPC: validateCloneToken({ username, token })
  → ipc-handlers: GET api.github.com/user (Bearer token)
  → [200 OK] → { valid: true, message: "Token válido" }
      → Modal: setTokenValidated(true)
      → UI: botón Clone se habilita
      → CredentialsBlock: muestra checkmark ✅
  → [401] → { valid: false, errorCode: "TOKEN_INVALID" }
      → Modal: setTokenValidated(false)
      → UI: mensaje de error inline
  → [403 + rate limit header] → { valid: false, errorCode: "RATE_LIMITED" }
  → [network fail] → { valid: false, errorCode: "NETWORK_ERROR" }
```

**Tabla de errorCodes y mensajes:**

| `errorCode` | Mensaje mostrado | Acción sugerida al usuario |
|---|---|---|
| `TOKEN_INVALID` | "Token inválido o sin acceso al repo" | Verificar token en GitHub Settings |
| `TOKEN_NO_SCOPE` | "Token sin permisos de repo" | Regenerar con scope `repo` |
| `RATE_LIMITED` | "Rate limit de GitHub alcanzado" | Esperar o usar token autenticado |
| `NETWORK_ERROR` | "Error de red al validar token" | Verificar conexión |
| `null` + `valid: false` | "Token inválido" | Genérico fallback |

**Nota importante sobre scope mínimo:** El scope mínimo requerido del token es `repo` (acceso completo a repos privados). Tokens con solo `public_repo` fallarán con `TOKEN_NO_SCOPE`.

**Invalidación automática del token validado:**
El estado `tokenValidated` se resetea a `false` cuando:
- El usuario modifica el campo `token`
- El usuario modifica el campo `username`
- La URL cambia (implica repo diferente)
- El modal se cierra/resetea

Esto es crítico: evita que un token válido para repo A habilite el clone de repo B.

**Persistencia:** `tokenValidated` es estado React local. No persiste en Zustand store ni en disco.

## Sección 4 — Habilitación del Botón Clone

**Condición compuesta:**
```
buttonEnabled = (
  urlValid
  AND visibilityResolved (no "unknown" / no "invalid_url")
  AND (
    repoPublic
    OR (repoPrivate AND tokenValidated === true)
  )
  AND clonePhase === "idle"
  AND destDirSelected
)
```

**Matriz completa de condiciones:**

| Visibilidad | Token Validado | Fase | Destino | Botón Clone |
|---|---|---|---|---|
| `public` | N/A | `idle` | ✅ | ✅ Habilitado |
| `public` | N/A | `cloning` | ✅ | ❌ Deshabilitado |
| `private` | `false` | `idle` | ✅ | ❌ Deshabilitado |
| `private` | `true` | `idle` | ✅ | ✅ Habilitado |
| `private` | `true` | `cloning` | ✅ | ❌ Deshabilitado |
| `not_found` | N/A | `idle` | ✅ | ❌ Deshabilitado |
| `network_error` | N/A | `idle` | ✅ | ❌ Deshabilitado |
| `ssh_url` | N/A | `idle` | ✅ | ❌ Deshabilitado |
| `unknown_provider` | N/A | `idle` | ✅ | ✅ Habilitado (sin auth) |
| cualquiera | N/A | `idle` | ❌ | ❌ Deshabilitado |

## Sección 5 — Ejecución del Clone

**Construcción del `CloneRepositoryRequest`:**

Path A — Repo Público:
```typescript
const request: CloneRepositoryRequest = {
  cloneId: uuidv4(),
  url: repoUrl,
  destDir: selectedDestDir,
  repoName: inferredRepoName,
  // auth: undefined — ausente intencionalmente
}
```

Path B — Repo Privado GitHub:
```typescript
const request: CloneRepositoryRequest = {
  cloneId: uuidv4(),
  url: repoUrl,
  destDir: selectedDestDir,
  repoName: inferredRepoName,
  auth: {
    username: credentialsState.username,
    token: credentialsState.token,
  }
}
```

Nota: `auth` es `optional` en el tipo. Su ausencia es el mecanismo de diferenciación, no un flag booleano.

**Spawn de `git clone` en el main process:**
```
recibe CloneRepositoryRequest
  → verifica concurrency (máx 3 activos)
  → si auth presente:
      construye URL autenticada: https://{username}:{token}@github.com/{owner}/{repo}.git
      setea env: GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=""
  → spawn: git clone --progress {url} {destDir}
  → inmediatamente post-spawn: limpia auth del objeto request
  → parsea stderr para progress events
  → emite onCloneProgress() al renderer
```

**Ciclo de vida del `cloneId`:**
- Generado en renderer (UUID v4) antes de enviar IPC
- Permite registrar el listener de progreso antes de iniciar el clone
- Correlaciona eventos de progreso con el clone correcto
- Permite múltiples clones simultáneos sin colisión de eventos
- Orden de operaciones: registrar `onCloneProgress(cloneId, callback)` ANTES de llamar `cloneRepository()`

**Transiciones de fase en el Modal:**
```
"idle"
  → [click Clone] → "cloning"
      → [git clone exit 0] → "success"
      → [git clone exit != 0] → "error"
  → [click Cancel durante cloning] → kill spawn → "idle"
```

**Actualización del Zustand store post-clone:**
Tras clone exitoso:
- Se agrega el nuevo proyecto a la lista de proyectos
- Se setea como proyecto activo
- El modal se cierra automáticamente

## Sección 6 — Seguridad

**Ciclo de vida de credenciales (timeline):**

```
T0: Usuario ingresa username + token en CredentialsBlock
T1: Click "Validate Token" → credenciales viajan por IPC (en memoria, no disco)
T2: Validación completa → credenciales NO almacenadas en ningún store
T3: Click "Clone" → credenciales viajan por IPC como parte de CloneRepositoryRequest
T4: Main process recibe request → construye URL autenticada en memoria
T5: spawn() ejecutado → credenciales limpiadas del objeto request INMEDIATAMENTE
T6: git clone corre → URL con credenciales solo existe en el proceso hijo
T7: Clone completa/falla → proceso hijo termina → URL destruida
T8: Modal cierra → estado React limpiado → credenciales eliminadas de memoria renderer
```

**Sanitización en logs:**
```typescript
// Patrón: reemplaza https://user:token@ con https://[REDACTED]@
const sanitized = logLine.replace(
  /https?:\/\/[^:]+:[^@]+@/g,
  'https://[REDACTED]@'
)
```
Aplica a TODOS los logs que contengan la URL, incluyendo stderr de git.

**Variables de entorno de seguridad:**

| Variable | Valor | Propósito |
|---|---|---|
| `GIT_TERMINAL_PROMPT` | `"0"` | Previene que git pida credenciales interactivamente |
| `GIT_ASKPASS` | `""` | Deshabilita helper de credenciales |

Sin estas variables, git podría abrir un prompt bloqueante o intentar usar el keychain del sistema.

**Límite de concurrencia:**
- Máximo 3 clones simultáneos
- Si se intenta un 4to: IPC retorna error inmediato con mensaje específico
- Razón: prevenir saturación de red y abuso de rate limits de GitHub

## Sección 7 — Edge Cases

**Tabla maestra de edge cases:**

| Escenario | Dónde ocurre | Comportamiento esperado | Mensaje UI |
|---|---|---|---|
| Token válido pero sin acceso al repo específico | Post-clone, exit code 128 | Fase → "error" | "Acceso denegado al repositorio" |
| Token expirado entre validación y clone | Post-clone, exit code 128 | Fase → "error" | "Credenciales rechazadas por GitHub" |
| Directorio destino ya existe | Pre-spawn, validación | Bloqueo pre-clone | "El directorio ya existe" |
| Directorio destino sin permisos de escritura | Pre-spawn o post-spawn | Error con path | "Sin permisos en el directorio destino" |
| Red cae durante el clone | stderr de git | Fase → "error" | "Conexión interrumpida durante el clone" |
| Repo eliminado entre detección y clone | Post-clone, exit code 128 | Fase → "error" | "Repositorio no encontrado" |
| URL cambia después de validar token | Invalidación automática | `tokenValidated` → false | Badge se resetea |
| Clone cancelado por usuario | Kill spawn | Fase → "idle", cleanup destDir parcial | — |
| Repo vacío (sin commits) | git clone exit 0 pero warning | Fase → "success" con advertencia | "Repositorio clonado (vacío)" |
| Nombre de repo con caracteres especiales | Pre-spawn | Sanitización del path | — |
| Rate limit durante detección de visibilidad | `detectRepoVisibility()` | Visibilidad → "network_error" | "Rate limit de GitHub" |
| GitHub API caída | `detectRepoVisibility()` | Visibilidad → "network_error" | "No se pudo contactar GitHub" |
| Token con scope `repo` pero repo de organización con SSO | Post-validación o post-clone | Error específico | "Token requiere autorización SSO" |

**Nota sobre cleanup post-cancel:**
Cuando el usuario cancela un clone en progreso, el directorio parcialmente clonado en `destDir` puede quedar en disco. Verificar si el cleanup automático está implementado; si no, es una **known limitation**.

**Nota sobre `unknown_provider`:**
Para URLs no-GitHub (GitLab, Bitbucket, self-hosted): no se muestra `CredentialsBlock`, el botón Clone se habilita sin validación de token, y el clone se ejecuta sin `auth`. Si el repo es privado, git fallará con exit 128. Esto es una decisión de diseño deliberada: sin la API de GitHub no es posible determinar la visibilidad.

## Sección 8 — QA / Checklist de Verificación

**Checklist: Repos Públicos (no regresión)**
```
□ URL pública válida → badge verde, botón Clone habilitado (sin credenciales)
□ CredentialsBlock NO se muestra para repos públicos
□ Clone de repo público completa sin auth en el request
□ Progress events llegan correctamente durante clone público
□ Post-clone: proyecto aparece en projectStore
□ Post-clone: modal se cierra automáticamente
```

**Checklist: Repos Privados GitHub**
```
□ URL privada → badge naranja/lock, CredentialsBlock visible
□ Botón Clone DESHABILITADO antes de validar token
□ Botón "Validate Token" habilitado al ingresar username + token
□ Token válido → botón Clone se habilita
□ Token inválido → mensaje de error, botón Clone sigue deshabilitado
□ Token con scope insuficiente → errorCode TOKEN_NO_SCOPE mostrado
□ Clone con token válido completa exitosamente
□ Credenciales NO aparecen en logs (verificar con token real)
□ Credenciales NO persisten en Zustand store post-clone
□ Modificar token post-validación → tokenValidated se resetea
□ Modificar URL post-validación → tokenValidated se resetea
```

**Checklist: Edge Cases**
```
□ Directorio destino ya existente → error pre-clone, mensaje claro
□ Cancel durante clone → fase vuelve a "idle"
□ 4to clone simultáneo → error de concurrencia, mensaje claro
□ Red cae durante clone → fase "error", mensaje de red
□ Token expirado entre validación y clone → fase "error", mensaje de acceso
□ Repo eliminado entre detección y clone → fase "error"
□ URL SSH → badge ssh_url, botón deshabilitado, mensaje explicativo
□ URL non-GitHub → badge unknown_provider, clone sin auth, sin CredentialsBlock
□ GitHub API caída → badge network_error, botón deshabilitado
□ Rate limit → badge network_error con mensaje específico
```

**Checklist: Seguridad**
```
□ Logs no contienen tokens (buscar patrón https://user:token@)
□ DevTools de Electron no muestran token en IPC messages
□ projectStore no contiene campo auth post-clone
□ Cerrar modal limpia campos de username y token
□ GIT_TERMINAL_PROMPT=0 presente en env del spawn
□ GIT_ASKPASS="" presente en env del spawn
```

## Sección 9 — Referencias

Documentos relacionados:
- `ai_docs/specs/clone-from-git-plan.md` — Plan general de clonado
- `ai_docs/specs/open-after-clone-plan.md` — Apertura post-clonado
- `docs/plans/clone-private-github-flow.md` — Flujo privado (antecedente)
- `docs/plans/clone-modal-private-credentials.md` — Modal credenciales (antecedente)
- `docs/plans/repo-visibility-detection.md` — Detección de visibilidad (antecedente)

Archivos de código fuente:
- `src/ui/components/CloneFromGitModal.tsx`
- `src/ui/components/CredentialsBlock.tsx`
- `src/ui/components/RepoVisibilityBadge.tsx`
- `src/ui/utils/gitUrlUtils.ts`
- `src/ui/utils/repoVisibility.ts`
- `src/ui/utils/clonePermission.ts`
- `src/ui/store/projectStore.ts`
- `src/electron/ipc-handlers.ts`
- `src/electron/bridge.types.ts`
