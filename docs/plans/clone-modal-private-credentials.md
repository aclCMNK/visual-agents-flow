# Plan: Credenciales para Repos Privados en CloneFromGitModal

## Objetivo

Agregar soporte en la UI para introducir credenciales (Username y Personal Access Token) cuando el repositorio detectado sea privado en GitHub, manteniendo el componente desacoplado, seguro y preparado para futuros proveedores.

## Contexto

- Stack: React 19, TypeScript 5, Electron 41, Vite 8, Zustand 5, Zod 4.
- Archivo principal a modificar: `src/ui/components/CloneFromGitModal.tsx`.
- Utilidades existentes: `src/ui/utils/gitUrlUtils.ts`, `src/ui/utils/repoVisibility.ts`, `src/ui/utils/clonePermission.ts`.
- Convención CSS: BEM estricto. Clases de modal, form, buttons ya definidas.
- Nuevo componente a crear: `src/ui/components/CredentialsBlock.tsx`.

## Estrategia

1. Implementar un componente puro y desacoplado `CredentialsBlock` que reciba props controladas para username y token, validación y callbacks de cambio/limpieza.
2. Integrar el componente en `CloneFromGitModal.tsx` y exponer nuevos estados locales para almacenar las credenciales de manera efímera.
3. Mostrar el bloque SOLO cuando `provider === 'github' && visibility === 'private'`.
4. Asegurar que los campos se limpien y no se registren en logs: limpieza en `onClose`, en cambio de URL, y cuando la visibilidad pase a `public` o `unknown`.
5. Habilitar el botón de clonar solo cuando, para repos privados en GitHub, ambos campos estén completos y validados.

## Fases

### Fase 1: Componente CredentialsBlock

- Crear archivo: `src/ui/components/CredentialsBlock.tsx`.
- Objetivo: componente controlado, sin side-effects, con tipos exportados.
- Props (exported types):
  - credentials: { username: string; token: string }
  - onChange: (next: { username: string; token: string }) => void
  - onClear?: () => void
  - disabled?: boolean
  - show?: boolean // para controlar animación (opcional)
  - validation?: { usernameOk?: boolean; tokenOk?: boolean }
  - ariaLabels?: { username?: string; token?: string }

- Responsabilidades:
  - Renderizar dos campos de formulario: Username y Personal Access Token.
  - Emitir onChange con objeto completo cada vez que cambia cualquiera de los campos.
  - No almacenar ni persistir datos fuera de props/state del componente padre.
  - Proveer método `onClear` para limpieza desde el padre.

### Fase 2: Integración en CloneFromGitModal

- Nuevos estados locales a añadir en `CloneFromGitModal.tsx`:
  - `credentials` (React.useState<{ username: string; token: string }>) — inicial { username: '', token: '' }
  - `credentialsTouched` (React.useState<boolean>) — para UX/validación
  - `credentialsVisible` (derivado) — condición: `provider === 'github' && visibility === 'private'`

- Handlers a implementar:
  - `handleCredentialsChange(next)` => setCredentials(next); setCredentialsTouched(true)
  - `clearCredentials()` => setCredentials({ username: '', token: '' }); setCredentialsTouched(false)
  - `handleUrlChange(...)` (ya existente) debe invocar `clearCredentials()` cuando la URL cambie
  - `handleVisibilityChange(...)` (lugar donde se actualiza `visibility`) debe invocar `clearCredentials()` si `visibility !== 'private' || provider !== 'github'`
  - `handleOnClose()` (ya existente) debe invocar `clearCredentials()` antes de llamar al `onClose` prop

- Flujo de datos:
  - `CloneFromGitModal` mantiene `credentials` y pasa `credentials` + `handleCredentialsChange` a `CredentialsBlock`.
  - Antes de invocar `window.agentsFlow.cloneRepository()` (o el handler de clone existente), si `credentialsVisible` es true, incluir credenciales en el objeto de opciones del clone (ej: `auth: { username, token }`). Si las utilidades existentes no aceptan auth, pasar en la llamada IPC y documentar que el receptor no debe persistir.

### Fase 3: Seguridad y limpieza de estado

- Reglas estrictas:
  - Nunca hacer console.log de username, token o del objeto `credentials`.
  - No persistir credenciales en stores (Zustand) ni en localStorage/sessionStorage.
  - Limpiar `credentials` en:
    - `onClose` del modal
    - cuando la URL cambia
    - cuando `provider` cambia a distinto de 'github'
    - cuando `visibility` cambia a distinto de 'private'
  - En la llamada a clone, enviar credenciales solo en memoria (objeto en la invocación). El receptor debe manejar y luego borrar (documentar en notas).

### Fase 4: UX/UI y animaciones

- Clases CSS (BEM) a usar para el bloque y sus elementos:
  - `.credentials-block` (block)
  - `.credentials-block__field` (elemento contenedor del field)
  - `.credentials-block__label`
  - `.credentials-block__input` (usar `.form-field__input` por convención compartida)
  - `.credentials-block__hint` (usar `.form-field__hint` con modificadores)
  - `.credentials-block--enter` / `--leave` (modificadores para estados de animación)

- Animación: usar keyframes CSS en archivo de estilos del modal (o CSS global de modales).
  - Keyframes propuestos:
    - `@keyframes credentialsFadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }`
    - `@keyframes credentialsFadeOut { from { opacity:1; transform: translateY(0);} to { opacity:0; transform: translateY(-6px);} }`
  - Reglas:
    - `.credentials-block--enter { animation: credentialsFadeIn 180ms ease-out forwards; }`
    - `.credentials-block--leave { animation: credentialsFadeOut 160ms ease-in forwards; }`

- Textos (UX):
  - Username label: "Username"
  - Token label: "Personal Access Token"
  - Token placeholder: "ghp_xxx... (no guardar)"
  - Hints:
    - `.form-field__hint--info`: "Usa un token con scope repo (o scope mínimo requerido). No guardamos este token."
    - `.form-field__hint--warn`: "Credenciales necesarias para clonar repos privados."

### Fase 5: Validación y habilitación del botón

- Validación mínima requerida:
  - Username: no vacío (trim). Token: no vacío (trim).
  - Validación opcional adicional: longitud mínima 20 (documentar como pendiente si no se quiere forzar).

- Estado del botón de clonar (`.btn--primary` existente):
  - Condición original de habilitación (si la hay) debe combinarse con la siguiente condición adicional cuando `credentialsVisible` es true:
    - `canClone = originalCanClone && (!credentialsVisible || (credentials.username.trim() !== '' && credentials.token.trim() !== ''))`

- Feedback visual:
  - Si campo vacío y `credentialsTouched` true => añadir clase `.form-field__input--error` al input correspondiente y mostrar `.form-field__hint--error` con texto "Requerido".

## Especificaciones técnicas detalladas

- Nuevo componente: `src/ui/components/CredentialsBlock.tsx`

```ts
// Exports
export type Credentials = { username: string; token: string }
export type CredentialsValidation = { usernameOk?: boolean; tokenOk?: boolean }

export type CredentialsBlockProps = {
  credentials: Credentials
  onChange: (next: Credentials) => void
  onClear?: () => void
  disabled?: boolean
  show?: boolean
  validation?: CredentialsValidation
  ariaLabels?: { username?: string; token?: string }
}
```

- Render:
  - Contenedor: <div className={`credentials-block ${show ? 'credentials-block--enter' : 'credentials-block--leave'}`}>
  - Cada field:
    - wrapper: `.credentials-block__field form-field`
    - label: `.credentials-block__label form-field__label`
    - input: `input.form-field__input credentials-block__input` (type text for username, type password for token)
    - hint: `div.form-field__hint form-field__hint--info` o `--error`

- Lógica interna:
  - onUsernameChange = (e) => onChange({ ...credentials, username: e.target.value })
  - onTokenChange = (e) => onChange({ ...credentials, token: e.target.value })
  - onClearClick = () => { onChange({ username: '', token: '' }); if (onClear) onClear() }

- Integración en `CloneFromGitModal.tsx` (fragmento de diseño):

```ts
const [credentials, setCredentials] = React.useState<Credentials>({ username: '', token: '' })
const [credentialsTouched, setCredentialsTouched] = React.useState(false)

const credentialsVisible = provider === 'github' && visibility === 'private'

const handleCredentialsChange = (next: Credentials) => {
  setCredentials(next)
  setCredentialsTouched(true)
}

const clearCredentials = React.useCallback(() => {
  setCredentials({ username: '', token: '' })
  setCredentialsTouched(false)
}, [])

// llamarlo en: onClose, en URL change handler, en visibility change handler

// al invocar clone:
const handleClone = async () => {
  setPhase('cloning')
  try {
    const cloneOpts: any = { url: repoUrl, targetDir: selectedDir }
    if (credentialsVisible) {
      cloneOpts.auth = { username: credentials.username.trim(), token: credentials.token.trim() }
    }
    await window.agentsFlow.cloneRepository(cloneOpts)
    setPhase('success')
    if (onCloned) onCloned()
  } catch (err) {
    setCloneError(err instanceof Error ? err.message : String(err))
    setPhase('error')
  }
}
```

- Botón de clonar (`canClone`):

```ts
const baseCanClone = /* lógica existente que verifica URL válida, dir seleccionado, permisos, etc. */
const credentialsOk = !credentialsVisible || (credentials.username.trim() !== '' && credentials.token.trim() !== '')
const canClone = baseCanClone && credentialsOk
```

- Limpieza de estado (lugares donde llamar `clearCredentials()`):
  - En el efecto que detecta cambios de URL (`repoUrl`) — limpiar cuando `urlTouched` cambia a true o cuando `repoUrl` cambia de valor.
  - En el efecto que procesa `provider` o `visibility` cambios.
  - En el handler `handleOnClose` antes de cerrar.

- Seguridad en el código:
  - Añadir comentario en el código: `// SECURITY: Do NOT log credentials` en las funciones relevantes.
  - Revisar que no se extienda el `credentials` object al estado global ni a persist.

## Riesgos

- Si la parte que maneja `window.agentsFlow.cloneRepository()` no está preparada para recibir `auth`, habrá que coordinar una pequeña extensión en el receptor (IPC) — esto es fuera del alcance del cambio UI; documentar y coordinar con el equipo de backend/Electron.
- Si se añaden más proveedores con esquemas de credenciales distintas, será necesario extender `Credentials` y la UI para soportarlos — diseño del componente ya contempla esto mediante props y shape controlado.
- Posible UX: usuarios pueden esperar que el token se guarde; dejar claro en hint que no se guarda.

## Notas

- No cambiar las utilidades existentes (`gitUrlUtils`, `repoVisibility`, `clonePermission`) excepto para pasar las credenciales a la operación de clone si fuese necesario.
- Nombre del archivo del nuevo componente: `src/ui/components/CredentialsBlock.tsx` (PascalCase, export named).
- CSS sugerido: agregar reglas en el CSS del modal o un archivo `src/ui/components/CredentialsBlock.css` que se importe desde el componente.

---

### Checklist de implementación

- [ ] Crear `CredentialsBlock.tsx` con los tipos y props indicados.
- [ ] Añadir CSS con clases BEM y keyframes propuestos.
- [ ] Añadir estados `credentials`, `credentialsTouched` y `credentialsVisible` en `CloneFromGitModal.tsx`.
- [ ] Añadir handlers `handleCredentialsChange`, `clearCredentials` y llamadas a `clearCredentials` en los lugares indicados.
- [ ] Ajustar la condición de habilitación del botón de clonar (`canClone`).
- [ ] Probar flujos: URL pública → ocultar/limpiar; URL privada GitHub → mostrar; cerrar modal → limpiar.
