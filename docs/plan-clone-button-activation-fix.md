# 🧠 Plan de Solución: Activación Correcta del Botón Clone

## 🎯 Objetivo

Garantizar que el botón **Clone** en `CloneFromGitModal` se active **únicamente** cuando se cumplen las tres condiciones requeridas:

1. La URL del repo fue validada y es de GitHub
2. El directorio destino está seleccionado
3. Las credenciales fueron ingresadas **y validadas exitosamente** (solo para repos privados)

---

## 🧩 Contexto

El módulo de clonado de repos privados de GitHub está compuesto por los siguientes archivos clave:

| Archivo | Rol |
|---|---|
| `src/ui/components/CloneFromGitModal.tsx` | Componente principal — orquesta estado, lógica y render |
| `src/ui/components/CredentialsBlock.tsx` | Bloque de credenciales (username + token) — componente controlado puro |
| `src/ui/utils/clonePermission.ts` | Mapea `(provider, visibility)` → `ClonePermission` → `CloneUIState` |
| `src/ui/utils/repoVisibility.ts` | Detecta visibilidad del repo vía IPC proxy a GitHub API |
| `src/ui/utils/gitUrlUtils.ts` | Valida sintaxis de URLs Git (sin red) |

---

## 🔍 Flujo Actual (Estado Real)

### Paso 1 — Validación de URL
- El usuario escribe la URL en el campo.
- `validateGitUrl(repoUrl)` valida sintaxis (sin red) → `urlValidation.valid`.
- Al hacer **blur** del campo, se dispara `handleUrlBlur` → `runVisibilityCheck(repoUrl)`.
- `runVisibilityCheck` llama a `detectRepoVisibility` vía IPC proxy → actualiza `visibility` y `repoVisibility`.
- Si el repo es `private` y el provider es `github`, se muestra el `CredentialsBlock`.

### Paso 2 — Selección de directorio
- El usuario hace clic en "Choose Folder" → `handleChooseDir` → `setSelectedDir(dir)`.

### Paso 3 — Credenciales
- El usuario ingresa username y token en `CredentialsBlock`.
- Puede hacer clic en **"Validate Token"** → `handleValidateToken` → llama a `bridge.validateCloneToken`.
- El resultado actualiza `validateStatus` (`"idle" | "validating" | "ok" | "error"`).

### Cálculo de `canClone` (líneas 237–247)
```ts
const credentialsOk =
  !credentialsVisible ||
  (credentials.username.trim() !== "" && credentials.token.trim() !== "");

const canClone =
  urlValidation.valid &&
  selectedDir !== null &&
  !isCloning &&
  !isCheckingVisibility &&
  !visibilityPending &&
  !buttonDisabled &&
  credentialsOk;
```

---

## 🐛 Bugs Identificados

### Bug #1 — `credentialsOk` NO verifica validación exitosa del token

**Ubicación:** `CloneFromGitModal.tsx`, líneas 237–239

**Código actual:**
```ts
const credentialsOk =
  !credentialsVisible ||
  (credentials.username.trim() !== "" && credentials.token.trim() !== "");
```

**Problema:**  
`credentialsOk` solo verifica que los campos no estén vacíos. **No verifica que `validateStatus === "ok"`**.  
El usuario puede escribir cualquier texto en el token (incluso inválido) y el botón Clone se habilitará.  
La condición 3 del requerimiento ("credenciales validadas exitosamente") **no está implementada**.

---

### Bug #2 — `visibilityPending` no bloquea correctamente cuando la URL es válida pero no se ha hecho blur

**Ubicación:** `CloneFromGitModal.tsx`, línea 236

```ts
const visibilityPending = urlValidation.valid && visibility === "idle";
```

**Problema:**  
Si el usuario pega una URL válida y hace clic directamente en "Clone" sin hacer blur, `visibility` sigue en `"idle"`. El flag `visibilityPending` se activa y bloquea el botón, lo cual es correcto. Sin embargo, el `handleClone` tiene lógica para disparar `runVisibilityCheck` en ese caso (líneas 484–491), pero **no re-evalúa `credentialsOk` con el nuevo estado de visibilidad antes de habilitar el botón**.

Esto es un problema secundario de UX: el usuario no recibe feedback claro de por qué el botón está deshabilitado cuando la URL es válida pero la visibilidad no se ha chequeado.

---

### Bug #3 — La condición de "URL es de GitHub" no está explícitamente verificada en `canClone`

**Ubicación:** `CloneFromGitModal.tsx`, líneas 240–247

**Problema:**  
`canClone` usa `urlValidation.valid` (validación sintáctica) y `!buttonDisabled` (derivado de `clonePermission`). Pero `clonePermission` es `"PENDING"` cuando `repoVisibility === null`, y `getCloneUIState("PENDING")` retorna `{ buttonDisabled: false }`.

Esto significa que si `visibility === "idle"` y `repoVisibility === null`, `buttonDisabled` es `false`, y el botón podría habilitarse para URLs válidas que no son de GitHub (ej: `https://gitlab.com/org/repo.git`) antes de que se complete el chequeo de visibilidad.

El flag `visibilityPending` mitiga esto parcialmente, pero la lógica es frágil porque depende de que `visibility === "idle"` sea el único estado "no chequeado".

---

### Bug #4 — `validateStatus` se resetea a `"idle"` al cambiar credenciales, pero `credentialsOk` no lo refleja

**Ubicación:** `CloneFromGitModal.tsx`, línea 312

```ts
const handleCredentialsChange = useCallback((next: Credentials) => {
  setCredentials(next);
  setCredentialsTouched(true);
  // Reset validate status when credentials change
  setValidateStatus("idle");
  setValidateMessage(null);
}, []);
```

**Problema:**  
Si el usuario valida el token exitosamente (`validateStatus === "ok"`) y luego modifica cualquier campo, `validateStatus` vuelve a `"idle"`. Esto es correcto en términos de seguridad. Pero `credentialsOk` no considera `validateStatus`, por lo que el botón **permanece habilitado** aunque el token ya no esté validado.

---

## 🧭 Estrategia de Solución

Modificar únicamente `CloneFromGitModal.tsx` para corregir el cálculo de `canClone` y `credentialsOk`, sin cambiar la arquitectura ni los componentes auxiliares.

La solución es **mínima, quirúrgica y no rompe el flujo existente**.

---

## 🚀 Fases

### 🔹 Phase 1: Corregir `credentialsOk` para exigir validación exitosa

**Descripción:**  
Actualizar la expresión `credentialsOk` para que, cuando las credenciales son visibles, exija `validateStatus === "ok"` además de que los campos no estén vacíos.

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

**Cambio (líneas 237–239):**

```ts
// ANTES
const credentialsOk =
  !credentialsVisible ||
  (credentials.username.trim() !== "" && credentials.token.trim() !== "");

// DESPUÉS
const credentialsOk =
  !credentialsVisible ||
  (
    credentials.username.trim() !== "" &&
    credentials.token.trim() !== "" &&
    validateStatus === "ok"
  );
```

**Impacto:**  
- El botón Clone solo se habilita cuando el token fue validado exitosamente.
- Si el usuario modifica las credenciales después de validar, `validateStatus` vuelve a `"idle"` (ya implementado en `handleCredentialsChange`) y el botón se deshabilita automáticamente.

**Tasks:**
- **Task:** Actualizar expresión `credentialsOk` en `CloneFromGitModal.tsx`
  - **Assigned to:** Developer
  - **Dependencies:** Ninguna

---

### 🔹 Phase 2: Agregar feedback visual cuando el token no ha sido validado

**Descripción:**  
Cuando `credentialsVisible === true` y `validateStatus !== "ok"`, mostrar un hint debajo del botón "Validate Token" que indique al usuario que debe validar el token antes de clonar.

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

**Cambio (sección del botón "Validate Token", ~línea 753):**

```tsx
{/* Hint cuando el token no ha sido validado */}
{credentialsVisible && validateStatus !== "ok" && validateStatus !== "validating" && (
  <span className="form-field__hint" role="status" style={{ color: "var(--color-warning, #f59e0b)" }}>
    ⚠ Validate your token before cloning.
  </span>
)}
```

**Impacto:**  
- El usuario entiende por qué el botón Clone está deshabilitado.
- UX clara y no bloqueante.

**Tasks:**
- **Task:** Agregar hint de validación pendiente en el bloque de credenciales
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1

---

### 🔹 Phase 3: Reforzar la condición de "URL es de GitHub" en `canClone`

**Descripción:**  
Agregar una verificación explícita de que `provider === "github"` cuando el repo es privado, para que `canClone` no dependa únicamente de `buttonDisabled` (que es `false` en estado `PENDING`).

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

**Cambio (líneas 240–247):**

```ts
// ANTES
const canClone =
  urlValidation.valid &&
  selectedDir !== null &&
  !isCloning &&
  !isCheckingVisibility &&
  !visibilityPending &&
  !buttonDisabled &&
  credentialsOk;

// DESPUÉS
const visibilityResolved = visibility !== "idle" && visibility !== "checking";

const canClone =
  urlValidation.valid &&
  selectedDir !== null &&
  !isCloning &&
  !isCheckingVisibility &&
  visibilityResolved &&          // reemplaza !visibilityPending con condición más robusta
  !buttonDisabled &&
  credentialsOk;
```

**Nota:** `visibilityResolved` es `true` solo cuando `visibility` tiene un valor definitivo (no `"idle"` ni `"checking"`). Esto es más explícito que `!visibilityPending` y cubre el caso donde `visibility` podría estar en un estado transitorio no contemplado.

**Tasks:**
- **Task:** Reemplazar `!visibilityPending` por `visibilityResolved` en `canClone`
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1

---

## 📊 Tabla de Condiciones — Estado Esperado Post-Fix

| Condición | Variable de control | Estado requerido para `canClone = true` |
|---|---|---|
| URL válida y es de GitHub | `urlValidation.valid` + `provider === "github"` (vía `!buttonDisabled`) | `true` |
| Visibilidad resuelta | `visibilityResolved` | `true` (no `"idle"` ni `"checking"`) |
| Directorio seleccionado | `selectedDir !== null` | `true` |
| No clonando | `!isCloning` | `true` |
| Credenciales validadas (solo privados) | `credentialsOk` con `validateStatus === "ok"` | `true` (o `credentialsVisible === false`) |

---

## ⚠️ Riesgos

- **Riesgo 1:** Si `bridge.validateCloneToken` no está disponible en el entorno (tests, Storybook), el botón nunca se habilitará para repos privados. Mitigación: el botón "Validate Token" ya está deshabilitado si el bridge no está disponible; agregar un fallback que permita `credentialsOk = true` si el bridge no existe.
- **Riesgo 2:** El usuario puede sentir fricción extra al tener que validar el token. Mitigación: el hint de Phase 2 guía al usuario claramente.
- **Riesgo 3:** Si `validateStatus` se resetea al cambiar credenciales (comportamiento actual correcto), el usuario debe re-validar. Esto es intencional por seguridad.

---

## 📝 Notas

- Los cambios son **exclusivamente en `CloneFromGitModal.tsx`** — no se modifica `CredentialsBlock`, `clonePermission.ts`, `repoVisibility.ts` ni `gitUrlUtils.ts`.
- El estado `validateStatus` ya existe y está correctamente gestionado; solo falta usarlo en `credentialsOk`.
- La lógica de `handleClone` (submit) ya tiene su propia validación defensiva (líneas 500–508) que verifica credenciales antes de ejecutar el clone. El fix de `canClone` es la capa de UX preventiva que complementa esa validación.
- El comentario en la línea 13 del archivo (`Clone → enabled only when URL is valid AND a directory is selected`) está **desactualizado** — no menciona las credenciales. Debe actualizarse para reflejar las tres condiciones.

---

## 📁 Archivos Relevantes

| Archivo | Cambio requerido |
|---|---|
| `src/ui/components/CloneFromGitModal.tsx` | ✅ Modificar `credentialsOk`, `canClone`, agregar hint de validación pendiente, actualizar comentario del header |
| `src/ui/components/CredentialsBlock.tsx` | ❌ Sin cambios |
| `src/ui/utils/clonePermission.ts` | ❌ Sin cambios |
| `src/ui/utils/repoVisibility.ts` | ❌ Sin cambios |
| `src/ui/utils/gitUrlUtils.ts` | ❌ Sin cambios |
