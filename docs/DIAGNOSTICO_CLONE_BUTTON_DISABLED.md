# 🧠 Diagnóstico: Botón "Clone" inhabilitado tras validación exitosa del token

**Archivo analizado:** `src/ui/components/CloneFromGitModal.tsx`  
**Utilidades involucradas:**  
- `src/ui/utils/clonePermission.ts`  
- `src/ui/utils/repoVisibility.ts`

---

## 🎯 Síntoma Reportado

A pesar de que:
- La URL del repositorio es correcta
- El folder destino está seleccionado
- El token fue validado exitosamente (mensaje verde ✓)

El botón **"Clone"** permanece **inhabilitado** y la UI sigue mostrando:
- `"Private repository — credentials required"`
- `"Repository not found. Check the URL and try again."`

---

## 🔍 Diagnóstico: Causa Raíz

### El flujo de detección de visibilidad

Cuando el usuario ingresa una URL de repositorio **privado** en GitHub, el sistema llama a `detectRepoVisibility()` (en `repoVisibility.ts`). Esta función hace una petición sin autenticación a la API de GitHub.

Para un repositorio **privado**, GitHub responde con **HTTP 404** (no 401/403, porque GitHub oculta la existencia del repo a usuarios no autenticados).

```typescript
// repoVisibility.ts — línea 201
if (status === 404) return "not_found"; // Treat as private in UI
```

Entonces `repoVisibility` queda en `"not_found"`.

### El mapeo de permisos

En `clonePermission.ts`, el estado `"not_found"` se mapea a `BLOCKED_NOT_FOUND`:

```typescript
// clonePermission.ts — líneas 85-86
case "not_found":
    return "BLOCKED_NOT_FOUND";
```

Y `BLOCKED_NOT_FOUND` produce:

```typescript
// clonePermission.ts — líneas 135-139
case "BLOCKED_NOT_FOUND":
    return {
        buttonDisabled: true,
        errorMessage: "Repository not found. Check the URL and try again.",
    };
```

### El estado de visibilidad en el modal

En `CloneFromGitModal.tsx`, la función `runVisibilityCheck` hace esto:

```typescript
// CloneFromGitModal.tsx — líneas 473-475
setRepoVisibility(result);                                    // → "not_found"
const resolvedVisibility = result === "not_found" ? "private" : result;
setVisibility(resolvedVisibility);                            // → "private"
```

Entonces:
- `repoVisibility` (estado raw) = `"not_found"` ← **usado por `getClonePermission`**
- `visibility` (estado UI) = `"private"` ← **usado para mostrar el badge y el bloque de credenciales**

### El cálculo de `canClone`

```typescript
// CloneFromGitModal.tsx — líneas 237-258
const clonePermission = getClonePermission(provider, repoVisibility);
// → getClonePermission("github", "not_found") → "BLOCKED_NOT_FOUND"

const { buttonDisabled, errorMessage } = getCloneUIState(clonePermission);
// → { buttonDisabled: true, errorMessage: "Repository not found..." }

const canClone =
    urlValidation.valid &&
    isGithubUrl &&
    visibilityResolved &&
    selectedDir !== null &&
    !isDirExplorerOpen &&
    !isCloning &&
    !isCheckingVisibility &&
    !buttonDisabled &&       // ← SIEMPRE false porque buttonDisabled = true
    credentialsOk;
```

### ¿Por qué el token validado no cambia nada?

**El token se valida, pero `repoVisibility` nunca se re-evalúa con el token.**

El flujo es:
1. Usuario ingresa URL → `runVisibilityCheck(url)` sin token → GitHub devuelve 404 → `repoVisibility = "not_found"`
2. Usuario ingresa credenciales y valida el token → `validateStatus = "ok"` ✓
3. **Nadie vuelve a llamar `detectRepoVisibility(url, token)`** para confirmar que el repo existe con autenticación
4. `repoVisibility` sigue siendo `"not_found"` → `clonePermission = "BLOCKED_NOT_FOUND"` → `buttonDisabled = true`

El token validado solo afecta `credentialsOk`, pero `buttonDisabled` sigue siendo `true` por `repoVisibility = "not_found"`, y `canClone` requiere `!buttonDisabled`.

---

## 🧩 Flujo Visual del Bug

```
URL ingresada (repo privado)
        ↓
detectRepoVisibility(url) → GitHub 404
        ↓
repoVisibility = "not_found"
visibility = "private"  (UI badge)
        ↓
getClonePermission("github", "not_found") → BLOCKED_NOT_FOUND
getCloneUIState(BLOCKED_NOT_FOUND) → { buttonDisabled: true, errorMessage: "Repository not found..." }
        ↓
Usuario valida token → validateStatus = "ok"
        ↓
canClone = ... && !buttonDisabled && credentialsOk
                      ↑ true (bloqueado)    ↑ true (ok)
        ↓
canClone = FALSE  ← botón inhabilitado permanentemente
```

---

## ✅ Fix Propuesto

### Estrategia

Cuando `validateStatus` cambia a `"ok"`, se debe **re-ejecutar la detección de visibilidad con el token** para confirmar que el repositorio existe y es accesible. Si la re-detección devuelve `"public"` o `"private"`, `repoVisibility` se actualiza y `clonePermission` pasa a `ALLOWED`.

### Opción A — Re-run visibility con token tras validación exitosa (Recomendada)

En `handleValidateToken`, después de `setValidateStatus("ok")`, llamar a `runVisibilityCheck` con el token:

```typescript
// CloneFromGitModal.tsx — handleValidateToken (líneas 331-361)
const handleValidateToken = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.validateCloneToken) return;
    if (!credentials.token.trim()) {
        setValidateStatus("error");
        setValidateMessage("Enter a token before validating.");
        return;
    }

    setValidateStatus("validating");
    setValidateMessage(null);

    try {
        const result = await bridge.validateCloneToken({
            token: credentials.token.trim(),
            username: credentials.username.trim() || undefined,
        });

        if (result.valid) {
            setValidateStatus("ok");
            setValidateMessage(result.message);

            // ✅ FIX: Re-run visibility check with the validated token
            // so that "not_found" (private repo) is resolved to "private" or "public"
            // and clonePermission transitions from BLOCKED_NOT_FOUND → ALLOWED
            await runVisibilityCheckWithToken(repoUrl, credentials.token.trim());
        } else {
            setValidateStatus("error");
            setValidateMessage(result.message);
        }
    } catch {
        setValidateStatus("error");
        setValidateMessage("Validation request failed. Check your connection.");
    }
}, [credentials, repoUrl, runVisibilityCheckWithToken]);
```

### Nueva función `runVisibilityCheckWithToken`

Agregar una variante de `runVisibilityCheck` que acepta un token y actualiza `repoVisibility` sin limpiar credenciales:

```typescript
// CloneFromGitModal.tsx — agregar después de runVisibilityCheck (línea 482)

/**
 * Re-runs visibility detection with an authenticated token.
 * Used after token validation to resolve "not_found" → "private" for private repos.
 * Does NOT clear credentials (unlike runVisibilityCheck).
 */
const runVisibilityCheckWithToken = useCallback(async (urlToCheck: string, token: string): Promise<void> => {
    if (!urlToCheck.trim() || !isValidGitUrl(urlToCheck)) return;

    visibilityRequestIdRef.current += 1;
    const thisRequestId = visibilityRequestIdRef.current;

    setVisibility("checking");

    const result = await detectRepoVisibility(urlToCheck, token);

    if (!mountedRef.current) return;
    if (visibilityRequestIdRef.current !== thisRequestId) return;

    // Update raw visibility — this is what getClonePermission reads
    setRepoVisibility(result);
    const resolvedVisibility = result === "not_found" ? "private" : result;
    setVisibility(resolvedVisibility);
    // Note: do NOT call clearCredentials here — token is valid
}, []);
```

### Cambio en `repoVisibility.ts` — ya soporta token

`detectRepoVisibility` ya acepta un `token` opcional (línea 154):

```typescript
export async function detectRepoVisibility(
    url: string,
    token?: string,   // ← ya existe, solo hay que usarlo
): Promise<RepoVisibility>
```

Y lo pasa al proxy (línea 181):

```typescript
result = await githubFetch({ url: apiUrl, token });
```

Con el token, GitHub responderá **200** para repos privados accesibles → `repoVisibility = "public"` → `clonePermission = ALLOWED` → `buttonDisabled = false`.

> **Nota:** El resultado será `"public"` (HTTP 200) aunque el repo sea privado, porque la API de GitHub devuelve 200 cuando el token tiene acceso. Esto es correcto para el propósito de habilitar el botón. El campo `private: true` en el body de la respuesta no es relevante aquí porque solo necesitamos saber si el token tiene acceso.

---

## 📋 Resumen de Cambios

| Archivo | Cambio |
|---|---|
| `src/ui/components/CloneFromGitModal.tsx` | Agregar `runVisibilityCheckWithToken` y llamarla desde `handleValidateToken` tras `result.valid` |
| `src/ui/utils/repoVisibility.ts` | Sin cambios — ya soporta `token` |
| `src/ui/utils/clonePermission.ts` | Sin cambios — el mapeo es correcto |

---

## ⚠️ Riesgos y Consideraciones

1. **Race condition:** `runVisibilityCheckWithToken` usa el mismo `visibilityRequestIdRef` que `runVisibilityCheck`, por lo que las respuestas stale se descartan correctamente.

2. **Seguridad:** El token se pasa en memoria a `detectRepoVisibility` → `githubFetch` (IPC proxy). No se persiste ni se loguea. El comentario `// SECURITY: Do NOT log credentials` debe mantenerse.

3. **UX:** Durante la re-verificación, `visibility = "checking"` mostrará el badge de "checking" brevemente. Esto es correcto y esperado.

4. **Credenciales no se limpian:** `runVisibilityCheckWithToken` no llama a `clearCredentials()`, a diferencia de `runVisibilityCheck`. Esto es intencional — el token acaba de ser validado.

5. **Dependencias del useCallback:** `runVisibilityCheckWithToken` debe incluirse en el array de dependencias de `handleValidateToken`.

---

## 🔄 Flujo Corregido

```
URL ingresada (repo privado)
        ↓
detectRepoVisibility(url) → GitHub 404
        ↓
repoVisibility = "not_found"
visibility = "private"  → muestra CredentialsBlock
        ↓
Usuario ingresa credenciales y valida token
        ↓
validateStatus = "ok"
        ↓
✅ runVisibilityCheckWithToken(url, token)
        ↓
detectRepoVisibility(url, token) → GitHub 200
        ↓
repoVisibility = "public"
        ↓
getClonePermission("github", "public") → ALLOWED
getCloneUIState(ALLOWED) → { buttonDisabled: false, errorMessage: null }
        ↓
canClone = true  ← botón habilitado ✓
```

---

*Documento generado por Weight-Planner — 2026-04-25*
