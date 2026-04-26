# 🐛 Bug Report + Plan de Solución
## `.env` y `.gitignore` no se crean tras clonar un repositorio privado

**Fecha:** 2026-04-26  
**Severidad:** Alta — las credenciales Git no se persisten, el usuario debe reingresarlas manualmente en cada sesión  
**Componentes afectados:**
- `src/ui/components/CloneFromGitModal.tsx`
- `src/electron/ipc-handlers.ts`
- `src/electron/preload.ts`
- `src/electron/bridge.types.ts`

---

## 🔍 Flujo Real Documentado

### 1. Renderer — `CloneFromGitModal.tsx`

El modal gestiona el ciclo completo de clonado. El flujo relevante es:

```
handleClone() [línea ~510]
  │
  ├─ Calcula freshCredentialsVisible (línea 558-560)
  │     = effectiveProvider === "github"
  │       && (effectiveVisibilityResult === "private" || "not_found")
  │
  ├─ Si freshCredentialsVisible → agrega cloneRequest.auth (línea 634-639)
  │
  ├─ await bridge.cloneRepository(cloneRequest)  ← IPC: git:clone
  │
  └─ Si result.success && result.clonedPath:
        Si cloneRequest.auth && bridge.saveGitCredentials:  ← CONDICIÓN CRÍTICA
            await bridge.saveGitCredentials({...})          ← IPC: git:save-credentials
```

### 2. Preload — `preload.ts` (línea 456-458)

```ts
saveGitCredentials(req: SaveGitCredentialsRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.GIT_SAVE_CREDENTIALS, req);
}
```
✅ El método **existe y está correctamente expuesto** en `window.agentsFlow`.

### 3. Main Process — `ipc-handlers.ts` (línea 3129-3156)

```ts
ipcMain.handle(
    IPC_CHANNELS.GIT_SAVE_CREDENTIALS,
    async (_event, req) => {
        const result = await saveGitCredentialsToEnv(
            req.projectDir, req.username, req.token
        );
        return result;
    }
);
```
✅ El handler **existe y está registrado** en `registerIpcHandlers()`.

### 4. Función de escritura — `saveGitCredentialsToEnv()` (línea 229-298)

```ts
async function saveGitCredentialsToEnv(projectDir, username, token) {
    // Valida credenciales no vacías
    // Valida que projectDir exista y sea directorio
    // Escribe <projectDir>/.env con GIT_USERNAME y GIT_TOKEN
    // Llama ensureEnvInGitignore() para agregar .env al .gitignore
    // Retorna { success: true, envPath }
}
```
✅ La función **está correctamente implementada**.

---

## 🐛 Bug Identificado

### Root Cause: `freshCredentialsVisible` vs `credentialsVisible` — Desincronización de estado React

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

#### El problema en detalle:

`freshCredentialsVisible` se calcula **dentro de `handleClone()`** (línea 558) usando variables locales del closure (`effectiveProvider`, `effectiveVisibilityResult`) que son el resultado de una re-verificación de visibilidad asíncrona ejecutada **dentro del mismo handler**.

```ts
// Línea 558-560 — dentro de handleClone()
const freshCredentialsVisible =
    effectiveProvider === "github" &&
    (effectiveVisibilityResult === "private" || effectiveVisibilityResult === "not_found");
```

Sin embargo, la condición que decide si se adjunta `auth` al request de clone es:

```ts
// Línea 634-639
if (freshCredentialsVisible) {
    cloneRequest.auth = {
        username: credentials.username.trim(),
        token: credentials.token.trim(),
    };
}
```

Y la condición que decide si se llama `saveGitCredentials` es:

```ts
// Línea 644
if (cloneRequest.auth && bridge.saveGitCredentials) {
```

**El bug ocurre cuando:**

La re-verificación de visibilidad dentro de `handleClone()` (líneas ~520-553) puede retornar `null` o `"invalid"` y hacer `return` temprano (líneas 550-551). Pero si el flujo llega hasta el clone, `freshCredentialsVisible` depende de `effectiveVisibilityResult`.

**Escenario crítico — el bug real:**

Cuando el repositorio es privado y el usuario ya validó sus credenciales (`validateStatus === "ok"`), el estado React `visibility` puede ser `"private"` pero la re-verificación dentro del handler puede fallar silenciosamente o retornar un resultado diferente. En ese caso:

1. `freshCredentialsVisible` puede ser `false` aunque `credentialsVisible` (el estado React) sea `true`
2. `cloneRequest.auth` **no se adjunta** al request
3. El clone puede proceder igualmente si el token fue embebido en la URL por el handler de git:clone
4. `cloneRequest.auth` es `undefined` → la condición `if (cloneRequest.auth && ...)` es `false`
5. **`saveGitCredentials` nunca se invoca** → `.env` y `.gitignore` nunca se crean

#### Evidencia adicional — segundo escenario:

Si `runVisibilityCheck` (línea ~520) lanza una excepción o retorna antes de asignar `effectiveVisibilityResult`, el valor por defecto es el estado React `repoVisibility` (línea ~530). Si `repoVisibility` es `null` (estado inicial), entonces `freshCredentialsVisible` será `false` aunque el usuario haya visto el formulario de credenciales y las haya ingresado.

#### Tercer escenario — el más probable en producción:

```ts
// Línea 558-560
const freshCredentialsVisible =
    effectiveProvider === "github" &&
    (effectiveVisibilityResult === "private" || effectiveVisibilityResult === "not_found");
```

Si `effectiveVisibilityResult` es `"public"` (porque la re-verificación retornó público, aunque el repo sea privado con credenciales válidas), `freshCredentialsVisible = false` → `cloneRequest.auth` no se adjunta → `.env` no se crea.

---

## 📍 Fragmentos Clave

### Fragmento 1 — Condición que bloquea el guardado (CloneFromGitModal.tsx:634-656)

```tsx
// ❌ BUG: cloneRequest.auth solo se adjunta si freshCredentialsVisible es true
// freshCredentialsVisible depende de una re-verificación asíncrona que puede
// diferir del estado React visible al usuario
if (freshCredentialsVisible) {
    cloneRequest.auth = {
        username: credentials.username.trim(),
        token: credentials.token.trim(),
    };
}

const result = await bridge.cloneRepository(cloneRequest);

if (result.success && result.clonedPath) {
    // ❌ Si cloneRequest.auth es undefined, esta condición es false
    // y saveGitCredentials NUNCA se llama
    if (cloneRequest.auth && bridge.saveGitCredentials) {
        const saveResult = await bridge.saveGitCredentials({
            projectDir: result.clonedPath,
            username: cloneRequest.auth.username,
            token: cloneRequest.auth.token,
        });
        // ...
    }
}
```

### Fragmento 2 — Fuente de verdad correcta (CloneFromGitModal.tsx:235)

```tsx
// ✅ Este es el estado React que el usuario VE — es la fuente de verdad real
const credentialsVisible = provider === "github" && visibility === "private";
```

### Fragmento 3 — Handler IPC correcto (ipc-handlers.ts:3129-3156)

```ts
// ✅ El handler existe y funciona correctamente
ipcMain.handle(
    IPC_CHANNELS.GIT_SAVE_CREDENTIALS,
    async (_event, req: SaveGitCredentialsRequest) => {
        const result = await saveGitCredentialsToEnv(
            req.projectDir, req.username, req.token
        );
        return result;
    }
);
```

---

## 🗺️ Rutas de Archivos Relevantes

| Archivo | Rol |
|---|---|
| `src/ui/components/CloneFromGitModal.tsx` | Renderer — modal de clonado, contiene el bug |
| `src/electron/ipc-handlers.ts` | Main process — handler `GIT_SAVE_CREDENTIALS` + `saveGitCredentialsToEnv()` |
| `src/electron/preload.ts` | Bridge — expone `saveGitCredentials` en `window.agentsFlow` |
| `src/electron/bridge.types.ts` | Tipos — `IPC_CHANNELS.GIT_SAVE_CREDENTIALS = "git:save-credentials"` |

---

## ✅ Verificación de Cada Punto Investigado

| Punto | Estado | Detalle |
|---|---|---|
| ¿El canal `git:save-credentials` se invoca desde el renderer? | ❌ **NO siempre** | Solo si `cloneRequest.auth` es truthy, que depende de `freshCredentialsVisible` |
| ¿La petición llega al main process? | ✅ Cuando se invoca, sí | El handler está registrado correctamente |
| ¿Hay errores de ruta o permisos? | ✅ No | `saveGitCredentialsToEnv` valida y escribe correctamente |
| ¿Ejecución silenciosa? | ⚠️ Parcialmente | El `console.warn` en línea 652 solo aparece si `saveResult.success === false`, pero si nunca se llama, no hay log alguno |
| ¿Flujo desconectado del ciclo de vida? | ❌ **SÍ — este es el bug** | `freshCredentialsVisible` puede diferir de `credentialsVisible` (estado React) |

---

# 🧠 Plan de Solución

## 🎯 Objetivo
Garantizar que `.env` y `.gitignore` se creen siempre que el usuario haya ingresado credenciales válidas y el clone haya sido exitoso.

## 🧩 Contexto
El bug está **exclusivamente en el renderer** (`CloneFromGitModal.tsx`). El main process, el handler IPC y la función de escritura están correctos. Solo hay que corregir la lógica de decisión en el renderer.

## 🧭 Estrategia
Usar `credentials` (estado React) como fuente de verdad para decidir si guardar credenciales, en lugar de `freshCredentialsVisible` (variable local del closure que puede desincronizarse).

---

## 🚀 Fases

### 🔹 Phase 1: Fix del bug principal

**Description:**  
Cambiar la condición de guardado de credenciales para que use el estado React `credentials` directamente, independientemente de `freshCredentialsVisible`.

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

**Cambio en línea ~643-656:**

```tsx
// ANTES (buggy):
if (cloneRequest.auth && bridge.saveGitCredentials) {
    const saveResult = await bridge.saveGitCredentials({
        projectDir: result.clonedPath,
        username: cloneRequest.auth.username,
        token: cloneRequest.auth.token,
    });
    // ...
}

// DESPUÉS (correcto):
// Usar credentials del estado React como fuente de verdad
// Si el usuario ingresó credenciales válidas (validadas), guardarlas
const hasValidCredentials =
    credentials.username.trim() !== "" &&
    credentials.token.trim() !== "" &&
    validateStatus === "ok";

if (hasValidCredentials && bridge.saveGitCredentials) {
    const saveResult = await bridge.saveGitCredentials({
        projectDir: result.clonedPath,
        username: credentials.username.trim(),
        token: credentials.token.trim(),
    });
    if (!saveResult.success) {
        console.warn(
            "[clone-flow] Could not save credentials to .env:",
            saveResult.error,
        );
    }
}
```

**Tasks:**

- **Task:** Reemplazar la condición `if (cloneRequest.auth && bridge.saveGitCredentials)` por `if (hasValidCredentials && bridge.saveGitCredentials)`
  - **Assigned to:** Developer
  - **Dependencies:** Ninguna

- **Task:** Actualizar `cloneRequest.auth` para que también use `hasValidCredentials` en lugar de `freshCredentialsVisible`
  - **Assigned to:** Developer
  - **Dependencies:** Task anterior

---

### 🔹 Phase 2: Logging defensivo

**Description:**  
Agregar un log explícito cuando `saveGitCredentials` no se invoca, para facilitar debugging futuro.

**Cambio sugerido:**

```tsx
if (hasValidCredentials && bridge.saveGitCredentials) {
    // ... guardar
} else if (hasValidCredentials && !bridge.saveGitCredentials) {
    console.warn("[clone-flow] saveGitCredentials not available on bridge — .env not written");
} else {
    console.log("[clone-flow] No credentials to save (public repo or credentials not validated)");
}
```

**Tasks:**

- **Task:** Agregar logs defensivos en el bloque de guardado
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1

---

### 🔹 Phase 3: Test de regresión

**Description:**  
Verificar manualmente el flujo completo:
1. Clonar repo privado con credenciales válidas
2. Verificar que `.env` existe en `<clonedPath>/.env`
3. Verificar que `.gitignore` contiene `.env`
4. Verificar que el token en `.env` tiene permisos `0o600`

**Tasks:**

- **Task:** Test manual del flujo completo de clonado privado
  - **Assigned to:** QA / Developer
  - **Dependencies:** Phase 1 + Phase 2

---

## ⚠️ Riesgos

- **Riesgo 1:** Si `validateStatus` es `"ok"` pero las credenciales fueron limpiadas por `clearCredentials()` antes del guardado → el trim() retornará `""` y `hasValidCredentials` será `false`. Verificar el orden de operaciones: `saveGitCredentials` debe llamarse **antes** de `clearCredentials()`.
  - **Mitigación:** El código actual ya llama `clearCredentials()` después del bloque de guardado (línea 660). Mantener ese orden.

- **Riesgo 2:** Repos públicos donde el usuario no ingresó credenciales → `hasValidCredentials` será `false` → no se intenta guardar. Comportamiento correcto.

---

## 📝 Notas

- El handler IPC `GIT_SAVE_CREDENTIALS` y la función `saveGitCredentialsToEnv` están **correctamente implementados** y no requieren cambios.
- El preload expone `saveGitCredentials` correctamente en `window.agentsFlow`.
- El bug es **exclusivamente de lógica en el renderer** — una variable local del closure (`freshCredentialsVisible`) reemplaza incorrectamente al estado React (`credentialsVisible`) como fuente de verdad.
- La solución es mínima y quirúrgica: ~5 líneas cambiadas en `CloneFromGitModal.tsx`.
