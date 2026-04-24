# Plan: Clone de Repos Privados de GitHub con Credenciales

## Estado actual
- Aplicación: Electron + React 19 + TypeScript + Zustand.
- Handler existente: `src/electron/ipc-handlers.ts` expone `git:clone` que construye una URL autenticada efímera, limpia la URL después del spawn, sanitiza stderr antes de loguear y mapea errores a códigos (`AUTH_ERROR`, `NETWORK_ERROR`, `DEST_EXISTS`, `GIT_NOT_FOUND`, `IO_ERROR`, `UNKNOWN`). Usa `GIT_TERMINAL_PROMPT=0` y `GIT_ASKPASS=""`. Nunca rechaza la promesa; siempre resuelve con `CloneRepositoryResult`.
- Tipos puente: `src/electron/bridge.types.ts` contiene `CloneRepositoryRequest` y `CloneRepositoryResult` con `errorCode` posible (`INVALID_URL | GIT_NOT_FOUND | AUTH_ERROR | DEST_EXISTS | NETWORK_ERROR | IO_ERROR | UNKNOWN`).
- UI: `src/ui/components/CloneFromGitModal.tsx` detecta visibilidad del repo y muestra `CredentialsBlock` cuando `provider === "github" && visibility === "private"`. Limpia credenciales en cambios de URL y controla cuándo pasar `auth` al bridge.
- Componente de credenciales: `src/ui/components/CredentialsBlock.tsx` con `username` y `token` (password), validación visual y botón de limpiar. Comentarios en código advierten: "Do NOT log credentials".
- Lógica de permisos: `src/ui/utils/clonePermission.ts` restringe repos privados a GitHub.

## Objetivo
Proveer un flujo completo, seguro y observable para clonar repositorios privados de GitHub usando credenciales (username + token). El flujo debe incluir: reporte de progreso en tiempo real al renderer, capacidad de cancelar clones en curso, validación previa de credenciales, mensajes de error UX diferenciados y un checklist de QA exhaustivo.

## Gaps a resolver
1. Progreso de clonado en tiempo real: parseo de stderr de git (--progress) y envío de eventos IPC `git:clone:progress` al renderer.
2. Cancelación: exponer mecanismo para abortar procesos de clonado en el main process.
3. Validación de credenciales antes de clonar: verificación del token contra la API de GitHub para detectar token inválido o sin permisos.
4. Mensajes de error UX: mapear `errorCode` a mensajes accionables y diferenciados (ej. token inválido vs token sin permisos vs 2FA, destino existente, etc.).
5. Tipo/contrato: incluir `cloneId` (UUID) en el flujo para correlación y cancelación; actualizar contratos/bridge si aplica.
6. Tests/QA: crear checklist mínimo de 20 ítems cubriendo casos felices y fallos.

## Arquitectura del flujo completo
Descripción end-to-end (renderer ↔ main process ↔ git):

- Renderer (CloneFromGitModal)
  - Genera `cloneId` UUID para la operación.
  - Si repo privado GitHub: recoge `username` + `token` en `CredentialsBlock` (no persistir en storage).
  - (Opcional/preferido) Llama al bridge `git:clone:validate` o manda `git:clone` con `validateOnly=true` para que el main valide el token contra la API de GitHub.
  - Al iniciar clone envía `CloneRepositoryRequest { cloneId, url, destDir, repoName?, auth?: { username, token } }` al handler `git:clone`.
  - Suscribe a `git:clone:progress` y `git:clone:result` por `cloneId`.
  - Permite cancelar: envía `git:clone:cancel { cloneId }`.

- Main process (ipc-handlers.ts)
  - Mantiene `activeClones: Map<string, ChildProcess>`.
  - `git:clone` handler:
    - Valida inputs básicos (URL válida, dest dir disponible).
    - Genera `cloneUrl` autenticada efímera: `new URL(url)` + `authUrl.username/password = encodeURIComponent(...)` solo si `auth` provisto.
    - Lanza `git clone --progress -- <cloneUrl> <destDir>` usando `child_process.spawn` con env `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=""`.
    - Inserta child en `activeClones.set(cloneId, child)` antes de spawn retornando control.
    - Escucha `child.stderr.on('data')`, parsea líneas de progreso y envía IPC: `event.sender.send('git:clone:progress', { cloneId, stage, percent?, details? })`.
    - Limpia `cloneUrl = ''` inmediatamente después de `spawn`.
    - Sanitiza cualquier texto que se vaya a loguear reemplazando `https://user:pass@` por `https://[REDACTED]@`.
    - En `child.on('close'| 'exit' | 'error')` remueve el child de `activeClones` y envía `git:clone:result` con `CloneRepositoryResult`.
  - `git:clone:cancel` handler:
    - Busca `child = activeClones.get(cloneId)` y, si existe, llama `child.kill('SIGTERM')` y responde con estado de cancelación; si no existe devuelve resultado con `errorCode: UNKNOWN` o `DEST_NOT_FOUND` según corresponda.

- GitHub token validation (main process)
  - Endpoint: `GET https://api.github.com/user` con header `Authorization: token <token>` y `User-Agent`.
  - Resultado esperado: 200 -> token válido; 401 -> token inválido; 403 -> token sin permisos (o rate limited); 2FA no aplicable a token pero puede devolver 401.
  - Handler IPC opcional `git:clone:validate` o integrado en `git:clone` con `validateOnly` flag.
  - No persistir token; usarlo solo en memoria para la petición.

## Fases de implementación

### Fase 1: Progreso de clonado en tiempo real
- Cambios principales:
  - Añadir parsing de stderr en `src/electron/ipc-handlers.ts` para líneas de progreso.
  - Emitir eventos IPC `git:clone:progress` con payload { cloneId, stage, percent?, raw }.

Detalles técnicos:
- Invocar git con: `git clone --progress -- <cloneUrl> <destDir>`.
- Observación: Git escribe progreso a stderr. Ejemplo de líneas relevantes:
  - "Receiving objects:  45% (450/1000)"
  - "Resolving deltas:  12% (12/100)"
  - "Counting objects: 100% (100/100), done."
- Parsing:
  - Escuchar `child.stderr.on('data', buf => { buffer += buf.toString(); split lines by /\r?\n/; for each line attempt regex match })`.
  - Regex sugerido para porcentaje: `/([A-Za-z ]+):\s*([0-9]{1,3})%/` (captura stage y percent).
  - Normalizar `stage` a keys como: RECEIVING_OBJECTS, RESOLVING_DELTAS, COUNTING_OBJECTS, COMPRESSING, etc.
  - Enviar por IPC: `event.sender.send('git:clone:progress', { cloneId, stage: 'RECEIVING_OBJECTS', percent: 45, raw: line })`.
- Throttling/Dedup: emitir sólo cuando percent cambia o cada 500ms máximo para evitar inundar el renderer.
- Renderer: mostrar barra de progreso y texto de stage + percent; fallback a spinner si no hay percent verificable.

### Fase 2: Cancelación del proceso
- Cambios principales:
  - Introducir `activeClones: Map<string, ChildProcess>` en el main process.
  - Exponer handler `git:clone:cancel` que acepta `{ cloneId }`, hace `child.kill('SIGTERM')` y espera un timeout (ej. 5s) para forzar `SIGKILL` si no termina.

Detalles técnicos:
- Al recibir `git:clone` con `cloneId`:
  - before spawn: `activeClones.set(cloneId, child)`.
  - after child termination: `activeClones.delete(cloneId)`.
- Cancel flow:
  - `git:clone:cancel` -> if child exists: `child.kill('SIGTERM')` -> respond immediate `cancelling` -> on `close` send final `git:clone:result` with `success: false, error: 'CANCELLED', errorCode: UNKNOWN` (o crear código `CANCELLED` si se decide) ; if not terminated after 5s -> `child.kill('SIGKILL')` and mark as cancelled.
  - UI debe disable/enable botones según estado.

### Fase 3: Mejoras UX de errores
- Cambios principales:
  - Mapeo ampliado de `errorCode` a mensajes específicos y sugerencias.
  - Detectar casos comunes desde stderr / exit code y desde validación GitHub API.

Mensajes sugeridos por `errorCode`:
- AUTH_ERROR:
  - Mensaje: "Autenticación fallida: token o usuario inválido o sin permisos." 
  - Sugerencia: "Verifique usuario y token; asegúrese que el token tenga permiso "repo" o acceso necesario. Pruebe validar token desde la UI." 
  - Si validación API devolvió 401 → añadir "Token inválido". Si 403 → "Token sin permisos o rate-limited".
- DEST_EXISTS:
  - Mensaje: "Directorio destino ya existe y no está vacío." 
  - Sugerencia: "Elija otro directorio o mueva/borre el existente. Si desea sobreescribir, haga backup manualmente." 
- NETWORK_ERROR:
  - Mensaje: "Error de red al intentar clonar." 
  - Sugerencia: "Verifique conexión y proxy. Intente nuevamente." 
- GIT_NOT_FOUND:
  - Mensaje: "Git no está instalado (o no encontrado en PATH)." 
  - Sugerencia: "Instale Git y reinicie la aplicación." 
- IO_ERROR:
  - Mensaje: "Error de disco/permiso al escribir en el destino." 
  - Sugerencia: "Verifique permisos del directorio de destino y espacio en disco." 
- UNKNOWN:
  - Mensaje: "Error desconocido al clonar." 
  - Sugerencia: "Revise detalles técnicos en los logs (sanitizados) y contacte soporte si persiste." 

UX adicional:
- Mostrar detalles técnicos sanitizados en un área colapsable "Detalles técnicos".
- Para AUTH_ERROR ofrecer botón "Validar token" que ejecuta la verificación contra la API de GitHub.

### Fase 4: Hardening de seguridad
- Reglas concretas a aplicar en el código:
  1. Nunca loguear credenciales en texto claro. Todos los logs deben pasar por sanitización que reemplace `https://user:pass@` por `https://[REDACTED]@`.
  2. Limpiar `cloneUrl` inmediatamente después de `spawn`: `cloneUrl = ''`.
  3. No persistir auth en storage (localStorage, files, DB). Token solo en memoria y eliminado tras operación (éxito, fallo o cancelación).
  4. `CredentialsBlock` debe usar `autoComplete="new-password"` y evitar sugerencias del OS.
  5. Reducir superficie: aceptar credenciales sólo para `provider === 'github'` y `visibility === 'private'`.
  6. Restringir duración del child y máximo número de clones simultáneos (p. ej. N=3) para evitar DoS local.
  7. Solicitudes a la API de GitHub deben incluir `User-Agent` y manejar rate-limiting (429/403) con mensajes adecuados.

### Fase 5: QA y checklist
- Preparar pruebas automatizadas (si aplica) e instrucciones manuales de verificación (ver checklist abajo).

## Checklist QA
1. Happy path: clonar repo público sin credenciales muestra progreso y termina con success=true y `clonedPath` correcto.
2. Happy path privado GitHub: proporcionar username+token válidos, clonar, recibir progreso y success=true.
3. Credenciales inválidas: token inválido -> validación API devuelve 401 y UI muestra mensaje "Token inválido".
4. Token sin permisos: token que no tiene scope `repo` -> API devuelve 403 -> mensaje "Token sin permisos".
5. Repo no encontrado (404): intentar clonar repo que no existe -> errorCode `UNKNOWN` o `NETWORK_ERROR` según mapping, UI muestra "Repositorio no encontrado" con acción sugerida.
6. Red caída durante clone: simular corte de red a mitad de clone -> recibir `NETWORK_ERROR` y mensaje apropiado.
7. Cancelación por usuario: iniciar clone, pulsar cancelar, confirmar que child recibe SIGTERM y proceso termina, UI recibe resultado cancelado y no persiste partial files or leaves incomplete directory (document expected behavior: puede quedar carpeta parcial — verificar y documentar).
8. Cancelación forzada: si child no termina en 5s tras SIGTERM, enviar SIGKILL y confirmar terminación.
9. Destino existente no vacío: iniciar clone hacia directorio existente -> recibir `DEST_EXISTS` y UI muestra mensaje con sugerencia.
10. Git no instalado: renombrar binario git (o PATH) -> intentar clone -> recibir `GIT_NOT_FOUND` y mensaje instructivo.
11. URL malformada: introducir URL inválida -> `INVALID_URL` y UI bloquea intento.
12. Race condition en visibilidad detect: rapid changes of URL -> `CredentialsBlock` se limpia y `canClone` se reajusta; verificar sin fugas de credenciales.
13. Sanitización de logs: introducir credenciales y provocar error que emita stderr -> revisar logs y confirmar que no hay `user:pass` visibles (reemplazados por `[REDACTED]`).
14. Throttling de progreso: verificar que el renderer no es inundado (máx 2 updates/seg o cada 500ms) y que la barra se actualiza suavemente.
15. Multi-stage reporting: verificar que se muestran stages distintos (Receiving objects, Resolving deltas, etc.) con porcentajes cuando disponibles.
16. Validación previa: probar `Validar token` desde UI y confirmar resultados 200/401/403 mostrados correctamente.
17. No persistencia de token: después de cualquier operación (éxito/fallo/cancel) verificar que no queda token en memoria accesible desde UI stores (Zustand) ni en disco.
18. Concurrency limit: iniciar >N clones simultáneos y verificar que se rechazan nuevas peticiones con mensaje claro o se encola según la política decidida.
19. Logs de errores técnicos: verificar que `git:clone:result` incluye `error` y `errorCode` adecuados y que la UI muestra la sección "Detalles técnicos" sanitizada.
20. Edge: token expirado / rate limit: simular 403/429 desde GitHub API y verificar mensajes y rate-limit handling.
21. Seguridad UI: comprobar `CredentialsBlock` input `autoComplete` y que el botón "Limpiar credenciales" borra todos los campos y que no quedan en el clipboard.

## Consideraciones de seguridad
- Nunca loguear credenciales en texto plano. Sanitizar cualquier URL o stderr que contenga `user:pass`.
- Limpiar `cloneUrl` inmediatamente después de `spawn`.
- No persistir `token` ni `username` en storage persistente.
- Mantener token solo en memoria durante la validación y el spawn; eliminar tras finalización o cancelación.
- Usar `GIT_TERMINAL_PROMPT=0` y `GIT_ASKPASS=""` para evitar prompts interactivos que puedan exfiltrar credenciales.
- Limitar número de clones simultáneos y duración máxima de un clone.
- Tratar respuestas de la API de GitHub con cuidado: no mostrar headers sensibles al usuario.

## Archivos afectados
- src/electron/ipc-handlers.ts
  - Añadir parsing de stderr para progreso y emisión de `git:clone:progress`.
  - Mantener `cloneUrl` efímero y limpiarlo inmediatamente tras spawn.
  - Añadir/usar `activeClones: Map<string, ChildProcess>` para manejo y cancelación.
  - Añadir handler `git:clone:cancel`.
  - Añadir validación opcional `git:clone:validate` para verificar token contra API de GitHub.

- src/electron/bridge.types.ts
  - Actualizar `CloneRepositoryRequest` para aceptar `cloneId: string` (UUID) y propagar `auth?: { username: string; token: string }` si no existe ya.
  - (Opcional) Añadir tipos para `CloneProgressEvent` y `CloneCancelRequest`.

- src/ui/components/CloneFromGitModal.tsx
  - Generar `cloneId` en inicio de operación y pasarla al bridge.
  - Suscribirse a `git:clone:progress` y `git:clone:result` para mostrar progreso y resultado.
  - Añadir botón "Cancelar" activo durante clonado.
  - Añadir opción "Validar token" cuando aplique.

- src/ui/components/CredentialsBlock.tsx
  - Asegurar `autoComplete="new-password"` y mantener lógica de limpieza de valores.
  - Limpiar credenciales al cerrar modal o cambiar URL.

- src/ui/utils/clonePermission.ts
  - Ningún cambio funcional requerido pero documentar que solo GitHub privado es soportado.

- Tests / QA
  - tests/ (nuevos archivos de integración/manual testing instructions) para cubrir checklist.

---

Ruta del archivo creado: docs/plans/clone-private-github-flow.md
