# QA Validations — Git Branches Panel (GitIntegrationModal)

## Scope

Validar la implementación de la sección **Branches** del modal Git en AgentsFlow, según `docs/plans/git-branches-panel-implementation.md`.

---

## 1) Estado base y carga inicial

- [ ] Con proyecto abierto y repo git válido, abrir modal Git → tab **Branches**.
- [ ] Se muestran 3 subsecciones en orden:
  1. Remote Changes
  2. Branch
  3. Commits in "<selectedBranch>"
- [ ] Se ejecuta carga inicial de branches y remote diff sin interacción manual.
- [ ] Si no hay proyecto abierto: mostrar `No project open.`.

---

## 2) Remote Changes (estados requeridos)

### loading
- [ ] Al refrescar remote diff, mostrar estado de carga (`Loading remote changes…`).

### error
- [ ] Forzar error de red/remoto y verificar banner de error visible.

### success
- [ ] Ejecutar `Fetch & Pull` exitoso y validar banner de éxito.
- [ ] Confirmar auto-dismiss del banner en ~3s.

### no-remote
- [ ] En rama sin upstream/tracking remoto, mostrar `No remote tracking branch configured.`.
- [ ] Botón `Fetch & Pull` deshabilitado en este estado.

### upToDate
- [ ] Si `incomingCommits.length === 0` y hay upstream, mostrar `✓ Up to date with remote.`.

### conteos + lista
- [ ] Mostrar línea de estado: `↓ X commits behind · ↑ Y commits ahead`.
- [ ] Si hay commits entrantes, listar hash corto, mensaje, autor y fecha relativa.
- [ ] Botón `Refresh` deshabilitado durante operaciones en curso.

---

## 3) Selector de ramas

- [ ] Mostrar `Current: <branch>` como texto informativo.
- [ ] `<select>` lista solo ramas **locales** y excluye `main/master`.
- [ ] Si no hay ramas seleccionables: `No other branches available. (main/master excluded)`.
- [ ] Botón `Pull`:
  - [ ] deshabilitado si está haciendo pull
  - [ ] deshabilitado sin rama seleccionada
  - [ ] deshabilitado si checkout está en curso
- [ ] Botón `Checkout`:
  - [ ] deshabilitado si checkout está en curso
  - [ ] deshabilitado sin rama seleccionada
  - [ ] deshabilitado si pull está en curso
  - [ ] si `selectedBranch === currentBranch`: texto `✓ Current` y deshabilitado
- [ ] Error de pull/checkout se muestra inline.
- [ ] Checkout exitoso muestra `Switched to branch '<name>'`.

---

## 4) Commits de rama seleccionada

- [ ] Título: `Commits in "<selectedBranch>"`.
- [ ] Al cambiar selección, refresca commits de esa rama.
- [ ] Estado loading: `Loading commits…`.
- [ ] Estado vacío: `No commits found in this branch.`.
- [ ] Estado error: banner de error.
- [ ] Sin rama seleccionada: `Select a branch to see its commits.`.
- [ ] Máximo 20 commits cargados por request.
- [ ] Lista de commits con scroll independiente de la subsección.

---

## 5) IPC y edge cases técnicos

- [ ] Validar que existen y responden los canales:
  - `git:list-branches`
  - `git:get-remote-diff`
  - `git:fetch-and-pull`
  - `git:pull-branch`
  - `git:checkout-branch`
  - `git:get-branch-commits`
- [ ] Repo sin `.git` → error amigable (no crashea UI).
- [ ] Git no instalado (`ENOENT`) → error amigable.
- [ ] Checkout bloqueado por working tree sucio → error amigable.
- [ ] Pull con conflicto → error amigable.
- [ ] Branch inexistente → error amigable.
- [ ] Checkout fallback a rama remota (`-b <branch> origin/<branch>`) funciona.

---

## 6) UX/accesibilidad/coherencia visual

- [ ] Mantiene estilos `.git-branches__*` y componentes de botones existentes (`.btn`).
- [ ] Focus visible en `<select>`.
- [ ] Secciones legibles con separadores visuales.
- [ ] Estados no bloquean el resto del panel innecesariamente.

---

## 7) BranchCreatorSection (Create Branch)

### 7.1 Presencia e integración en panel

- [ ] `BranchCreatorSection` aparece entre `BranchSelectorSection` y `BranchCommitsSection`.
- [ ] Existe un `.git-branches__divider` antes de la sección.
- [ ] Título visible: `Create Branch`.

### 7.2 Validación de nombre de rama (tiempo real)

- [ ] Campo vacío → botón deshabilitado, sin mensaje de error visible.
- [ ] Nombre con espacio (ej. `"my branch"`) → error inline inmediato.
- [ ] Nombre con punto (ej. `"my.branch"`) → error inline inmediato.
- [ ] Nombre con carácter especial (ej. `"my@branch"`) → error inline inmediato.
- [ ] Nombre que empieza con guión (ej. `"-branch"`) → error inline inmediato.
- [ ] Nombre que termina con guión (ej. `"branch-"`) → error inline inmediato.
- [ ] Nombre con doble guión (ej. `"my--branch"`) → error inline inmediato.
- [ ] Nombre `"main"` → error inline inmediato.
- [ ] Nombre `"MASTER"` (case-insensitive) → error inline inmediato.
- [ ] Nombre igual a una rama local existente → error inline inmediato.
- [ ] Nombre válido (ej. `"feature-123"`) → sin error, botón habilitado.
- [ ] Nombre de un solo carácter alfanumérico (ej. `"x"`) → válido, botón habilitado.

### 7.3 Selector `From`

- [ ] La rama actual aparece primera con etiqueta `(current)`.
- [ ] El resto de ramas locales aparecen ordenadas alfabéticamente.
- [ ] `main` y `master` aparecen como opciones válidas de base.
- [ ] El selector está deshabilitado mientras `isCreatingBranch === true`.
- [ ] Al cambiar la rama activa externamente, el selector se actualiza.

### 7.4 Creación exitosa

- [ ] Al crear exitosamente: el input se limpia.
- [ ] Al crear exitosamente: el error de validación desaparece.
- [ ] Al crear exitosamente: aparece banner de éxito con nombre de la rama.
- [ ] El banner de éxito desaparece automáticamente tras ~3 segundos.
- [ ] La lista de ramas se recarga y muestra la nueva rama.
- [ ] La nueva rama aparece como rama activa (checked out).

### 7.5 Manejo de errores de operación

- [ ] Error `E_BRANCH_ALREADY_EXISTS` → banner con mensaje legible.
- [ ] Error `E_BRANCH_NOT_FOUND` (rama base eliminada) → banner con mensaje legible.
- [ ] Error `E_DIRTY_WORKING_DIR` → banner con mensaje legible.
- [ ] Error `E_GIT_NOT_FOUND` → banner con mensaje legible.
- [ ] Error `E_NOT_A_GIT_REPO` → banner con mensaje legible.
- [ ] Bridge no disponible → banner `Electron bridge unavailable.`.
- [ ] Al escribir en el input después de un error de operación, el error de operación se limpia.

### 7.6 Estado de carga

- [ ] Durante creación: input deshabilitado.
- [ ] Durante creación: selector `From` deshabilitado.
- [ ] Durante creación: botón deshabilitado y texto `Creating…`.
- [ ] Durante creación: `aria-busy="true"` en el botón.
- [ ] No se permiten múltiples creaciones simultáneas.

### 7.7 Accesibilidad específica

- [ ] Error de validación inline usa `role="alert"` + `aria-live="assertive"`.
- [ ] Banner de éxito usa `role="status"`.
- [ ] Banner de error de operación usa `role="alert"`.
- [ ] Input usa `aria-invalid="true"` cuando hay error.
- [ ] Input usa `aria-describedby` apuntando al error cuando existe.
- [ ] Navegación por Tab en orden: selector `From` → input → botón.
- [ ] `Enter` en input válido dispara creación.
- [ ] `Enter` en input inválido no dispara creación.

### 7.8 Verificación de IPC/archivos modificados

- [ ] `src/electron/bridge.types.ts` actualizado con:
  - [ ] canal `GIT_CREATE_BRANCH`
  - [ ] tipos `GitCreateBranchRequest`, `GitCreateBranchSuccess`, `GitCreateBranchResponse`
  - [ ] errores `E_BRANCH_ALREADY_EXISTS` y `E_INVALID_BRANCH_NAME`
  - [ ] método `gitCreateBranch` en `AgentsFlowBridge`
- [ ] `src/electron/git-branches.ts`:
  - [ ] función `createBranch()` implementada
  - [ ] handler IPC `IPC_CHANNELS.GIT_CREATE_BRANCH` registrado
- [ ] `src/electron/preload.ts` expone `gitCreateBranch`.
- [ ] `src/ui/hooks/useGitBranches.ts` cubre estado/acciones/reducer/callback `createBranch`.
- [ ] `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` integra `BranchCreatorSection`.
- [ ] `src/ui/styles/app.css` contiene clases:
  - [ ] `.git-branches__creator-row`
  - [ ] `.git-branches__creator-label`
  - [ ] `.git-branches__creator-actions`
  - [ ] `.git-branches__input`
  - [ ] `.git-branches__input--error`
  - [ ] `.git-branches__validation-error`

---

## 8) Changes Panel (GitIntegrationModal)

### 8.1 Funcionalidad core

- [ ] Al abrir la sección `Changes`, se carga automáticamente el estado del repositorio.
- [ ] La rama actual se muestra correctamente en `Current Branch`.
- [ ] La lista muestra archivos staged, unstaged y untracked.
- [ ] Botón `Add and Commit` ejecuta `git add -A && git commit`.
- [ ] Tras commit exitoso: recarga de lista + limpieza de mensaje y descripción.
- [ ] Tras commit exitoso: se muestra hash corto y desaparece en ~3s.
- [ ] Botón `↻ Refresh` recarga estado manualmente.

### 8.2 Validaciones

- [ ] `Add and Commit` deshabilitado con mensaje vacío.
- [ ] `Add and Commit` deshabilitado sin cambios.
- [ ] `Add and Commit` deshabilitado durante commit en curso.
- [ ] Mensaje solo espacios muestra: `Commit message cannot be only whitespace.`
- [ ] Mensaje >72 chars muestra warning visual (sin bloquear).
- [ ] Campo mensaje limitado a 200 chars.
- [ ] Campo descripción no tiene validaciones de contenido.

### 8.3 Carga y estados

- [ ] Spinner en `Current Branch` durante carga inicial.
- [ ] Spinner en `Changes` durante carga/refresco.
- [ ] Durante commit: botón muestra `Committing…` con `aria-busy`.
- [ ] Durante commit: campos de formulario deshabilitados.
- [ ] Durante carga: `Refresh` deshabilitado.

### 8.4 Errores y edge cases

- [ ] Sin proyecto abierto: `No project open.` sin llamadas IPC.
- [ ] Repo sin commits: rama como `(detached HEAD)` y lista vacía.
- [ ] Working tree limpio: empty state y botón deshabilitado.
- [ ] Archivos con espacios se muestran correctamente.
- [ ] Renames muestran ruta original con `←`.
- [ ] Ignorados (`!!`) no aparecen.
- [ ] Estado mixto staged+unstaged muestra badges `S` y `U`.
- [ ] Lista >20 archivos tiene scroll interno.
- [ ] Error `E_NOTHING_TO_COMMIT` muestra mensaje entendible.
- [ ] Error `E_EMPTY_COMMIT_MSG` muestra mensaje entendible.

### 8.5 Accesibilidad

- [ ] Inputs/textarea con `<label htmlFor>` asociado.
- [ ] Errores de validación con `role="alert"` y `aria-live="assertive"`.
- [ ] Banner éxito con `role="status"`.
- [ ] Botón commit con `aria-busy="true"` durante operación.
- [ ] Lista de archivos con `role="list"` y filas con `role="listitem"`.
- [ ] Íconos decorativos con `aria-hidden="true"`.
- [ ] Badge contador con `aria-label="{n} files changed"`.
- [ ] Elementos deshabilitados usan atributo `disabled`.

### 8.6 Integración IPC y archivos

- [ ] `src/electron/bridge.types.ts` incluye:
  - [ ] canales `GIT_GET_STATUS` y `GIT_ADD_AND_COMMIT`
  - [ ] tipos `GitChangedFile`, `GitGetStatus*`, `GitAddAndCommit*`
  - [ ] errores `E_NOTHING_TO_COMMIT` y `E_EMPTY_COMMIT_MSG`
  - [ ] métodos `gitGetStatus` y `gitAddAndCommit` en `AgentsFlowBridge`
- [ ] `src/electron/git-changes.ts` implementa:
  - [ ] `getStatus()`
  - [ ] `addAndCommit()`
  - [ ] `registerGitChangesHandlers()`
- [ ] `src/electron/ipc-handlers.ts` registra `registerGitChangesHandlers`.
- [ ] `src/electron/preload.ts` expone `gitGetStatus` y `gitAddAndCommit`.
- [ ] `src/ui/hooks/useGitChanges.ts` implementa reducer + callbacks + flujo de recarga.
- [ ] `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` implementa 4 subsecciones.
- [ ] `src/ui/styles/app.css` contiene clases `git-changes__*` requeridas.

---

## 9) Real Git error feedback (stderr/rawOutput)

### Backend payload

- [ ] Cuando falla `git add && commit` por hook/pre-commit: `GitOperationError` incluye `gitStderr` con salida real.
- [ ] Cuando falla `git pull` (conflicto/red): `GitOperationError` incluye `gitStderr` y mantiene `rawOutput`.
- [ ] Cuando falla `git fetch` por red/auth: payload incluye mensaje real en `gitStderr` o `rawOutput`.
- [ ] En errores `E_UNKNOWN`, `message` viene con stderr real si existe; si no, usa fallback.

### Frontend formatting (`formatGitError`)

- [ ] `E_UNKNOWN` con stderr corto (<=300) se muestra completo en banner.
- [ ] `E_UNKNOWN` con stderr largo (>300) se trunca en ~300 con `…`.
- [ ] Si no hay `gitStderr/rawOutput`, se usa mensaje genérico (fallback) sin romper UI.
- [ ] Para códigos conocidos (`E_MERGE_CONFLICT`, `E_DIRTY_WORKING_DIR`) se mantiene mensaje base y detalle útil.

### UI banners (todos los paneles Git del modal)

- [ ] Todos los banners de error de `GitBranchesPanel` muestran texto truncado y `title` con mensaje completo.
- [ ] Banners de `GitChangesPanel` (status + commit) muestran texto truncado y `title` con mensaje completo.
- [ ] Los banners renderizan saltos de línea (`white-space: pre-wrap`).
- [ ] Texto largo no desborda layout del modal (word-break correcto).
