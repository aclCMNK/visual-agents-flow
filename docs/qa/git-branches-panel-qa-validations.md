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
