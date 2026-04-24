# Plan de Corrección: Bugs Críticos en Flujo de Clonación Git

**Fecha:** 2026-04-23  
**Proyecto:** agentsFlow (Electron + React + TypeScript)  
**Severidad:** Crítica  
**Estado:** Pendiente de implementación

---

## 🎯 Objetivo General

Corregir dos bugs críticos que afectan la estabilidad y funcionalidad del flujo de clonación de repositorios Git:

1. **Bug 1 — ReferenceError:** `handleClose` se usa en un `useEffect` antes de ser definido, causando comportamiento indefinido o crash en runtime.
2. **Bug 2 — Auth ignorada:** Las credenciales construidas en el frontend nunca llegan al comando `git clone`, haciendo imposible clonar repositorios privados.

---

## 🧩 Contexto del Problema

### Bug 1 — Orden de declaración en React hooks

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`

El `useEffect` de Escape key (~línea 239) lista `handleClose` en su dependency array y lo invoca dentro del callback. Sin embargo, `handleClose` se define con `useCallback` en la línea ~261, **después** del `useEffect` que lo consume.

En JavaScript, `const` con `useCallback` no tiene hoisting de valor (Temporal Dead Zone). En React Strict Mode o durante hot-reload, esto puede producir `ReferenceError` o comportamiento indefinido.

### Bug 2 — Ruptura del contrato IPC

**Flujo de datos actual (roto):**

```
CloneFromGitModal (UI)
  → window.agentsFlow.cloneRepository(req con auth)   [preload.ts]
    → ipcRenderer.invoke('GIT_CLONE', req)             [IPC channel]
      → ipcMain handler                                [ipc-handlers.ts]
        → spawn('git', ['clone', url, path])           ← auth NUNCA llega aquí
```

El tipo `CloneRepositoryRequest` en `bridge.types.ts` no declara el campo `auth`, por lo que TypeScript lo descarta y el handler nunca lo recibe ni lo usa.

---

## 🧭 Estrategia

| Bug | Estrategia | Archivos afectados |
|-----|-----------|-------------------|
| 1 | Reordenar declaraciones (zero logic change) | `CloneFromGitModal.tsx` |
| 2 | Extender tipo → verificar preload → actualizar handler | `bridge.types.ts`, `preload.ts`, `ipc-handlers.ts` |

---

## 🚀 Fases de Implementación

---

### FASE 1 — Bug 1: Reordenar `handleClose` en `CloneFromGitModal.tsx`

**Archivo:** `src/ui/components/CloneFromGitModal.tsx`  
**Acción:** Mover el bloque `handleClose` (líneas ~261–266) para que aparezca **inmediatamente antes** del `useEffect` de Escape key (línea ~239).

#### ❌ ANTES (orden incorrecto)

```tsx
// ~línea 239 — useEffect usa handleClose que aún no existe
useEffect(() => {
  if (!isOpen) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !isCloning) handleClose(); // ← TDZ / undefined
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isOpen, isCloning, handleClose]);

// ... hooks intermedios ...

// ~línea 261 — handleClose definido DESPUÉS
const handleClose = useCallback(() => {
  if (isCloning) return;
  clearCredentials();
  onClose();
}, [isCloning, onClose, clearCredentials]);
```

#### ✅ DESPUÉS (orden correcto)

```tsx
// PRIMERO: definir handleClose
const handleClose = useCallback(() => {
  if (isCloning) return;
  clearCredentials();
  onClose();
}, [isCloning, onClose, clearCredentials]);

// DESPUÉS: useEffect que lo consume
useEffect(() => {
  if (!isOpen) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !isCloning) handleClose();
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isOpen, isCloning, handleClose]);
```

**⚠️ Verificación previa:** Auditar manualmente los hooks entre líneas 239–261 para detectar dependencias cruzadas antes de mover.

---

### FASE 2 — Bug 2, Paso 1: Extender el tipo `CloneRepositoryRequest`

**Archivo:** `src/electron/bridge.types.ts`  
**Líneas:** ~1592–1602

#### ❌ ANTES

```ts
export interface CloneRepositoryRequest {
  url: string;
  destDir: string;
  repoName?: string;
}
```

#### ✅ DESPUÉS

```ts
export interface CloneRepositoryAuth {
  /** Username asociado al token */
  username: string;
  /** GitHub/GitLab Personal Access Token o password */
  token: string;
}

export interface CloneRepositoryRequest {
  url: string;
  destDir: string;
  repoName?: string;
  /** Credenciales efímeras para repos privados — el receiver NO debe persistirlas */
  auth?: CloneRepositoryAuth;
}
```

**Notas:**
- `auth` es opcional para mantener compatibilidad con repos públicos
- Exportar `CloneRepositoryAuth` como tipo separado para reutilización y testing

---

### FASE 3 — Bug 2, Paso 2: Verificar `preload.ts`

**Archivo:** `src/electron/preload.ts`

Localizar la exposición de `cloneRepository` y verificar que el objeto `req` se reenvía **completo** sin destructuring que omita `auth`.

#### ❌ Patrón problemático (si existe)

```ts
// Destructuring parcial que descarta auth:
cloneRepository: ({ url, destDir, repoName }: CloneRepositoryRequest) =>
  ipcRenderer.invoke('GIT_CLONE', { url, destDir, repoName }), // ← auth perdido
```

#### ✅ Patrón correcto

```ts
// Reenviar req completo
cloneRepository: (req: CloneRepositoryRequest) =>
  ipcRenderer.invoke('GIT_CLONE', req),
```

**Verificación adicional:** Confirmar que `contextBridge.exposeInMainWorld` no aplica filtros que descarten campos no conocidos.

---

### FASE 4 — Bug 2, Paso 3: Actualizar el handler `GIT_CLONE` en `ipc-handlers.ts`

**Archivo:** `src/electron/ipc-handlers.ts`  
**Líneas:** ~2344–2461

#### ❌ ANTES

```ts
// ~línea 2380 — sin auth
const child = spawn("git", ["clone", url, clonedPath], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});
```

#### ✅ DESPUÉS

```ts
// Importar al inicio si no existe:
import { URL } from "url";

// En el handler GIT_CLONE:

// 1. Construir URL autenticada de forma efímera
let cloneUrl: string = url;
let authUrl: URL | null = null;

if (req.auth?.username && req.auth?.token) {
  try {
    authUrl = new URL(url);
    authUrl.username = encodeURIComponent(req.auth.username);
    authUrl.password = encodeURIComponent(req.auth.token);
    cloneUrl = authUrl.toString();
  } catch {
    // URL inválida — continuar sin auth, git fallará con error claro
    cloneUrl = url;
  }
}

// 2. Log SIEMPRE con URL limpia (sin credenciales)
console.log(`[GIT_CLONE] Cloning from: ${url} → ${clonedPath}`);

// 3. Spawn con URL autenticada
const child = spawn("git", ["clone", cloneUrl, clonedPath], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  },
});

// 4. Limpiar referencia inmediatamente después del spawn
cloneUrl = "";
authUrl = null;
```

**Sanitizar stderr de git (crítico para seguridad):**

```ts
// En el handler de stderr del proceso hijo:
child.stderr.on("data", (data: Buffer) => {
  let errorOutput = data.toString();
  
  // Sanitizar: reemplazar URLs con credenciales embebidas
  errorOutput = errorOutput.replace(
    /https?:\/\/[^:]+:[^@]+@/g,
    "https://[REDACTED]@"
  );
  
  console.error(`[GIT_CLONE] stderr: ${errorOutput}`);
});
```

---

### FASE 5 — Verificación end-to-end

#### Checklist de validación

```
[ ] Bug 1: Abrir modal → presionar Escape → no crash, modal cierra correctamente
[ ] Bug 1: Hot reload en dev mode → no ReferenceError en consola
[ ] Bug 2: Clonar repo público (sin auth) → funciona igual que antes
[ ] Bug 2: Clonar repo privado con token válido → clona exitosamente
[ ] Bug 2: Verificar logs → URL con credenciales NO aparece en ningún log
[ ] Bug 2: Clonar con URL malformada → error claro, no crash
[ ] Bug 2: Token con caracteres especiales (@, :) → encodeURIComponent lo maneja
[ ] TypeScript: tsc --noEmit sin errores nuevos
```

---

## ⚠️ Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| Hooks intermedios entre líneas 239–261 con dependencias cruzadas | Media | Auditar manualmente el bloque antes de mover |
| `preload.ts` usa serialización IPC custom que filtra campos | Baja | Verificar con log en dev antes de deploy |
| Token con `@` o `:` rompe la URL autenticada | Media | `encodeURIComponent` resuelve esto — ya incluido en el plan |
| Logs de error de git imprimen la URL con credenciales (stderr) | Alta | Sanitizar stderr con regex antes de loggear — incluido en Fase 4 |
| `req.auth` llega como `undefined` si el frontend no lo envía | Baja | Guard `req.auth?.username && req.auth?.token` cubre esto |

---

## 🔒 Notas de Seguridad

- **No persistir credenciales:** `req.auth` vive únicamente en el scope del handler durante la ejecución del clone. No guardar en variables de módulo, caché ni disco.
- **Sanitizar stderr:** Git puede imprimir la URL autenticada en mensajes de error. El regex `/https?:\/\/[^:]+:[^@]+@/g` debe aplicarse a todo output antes de loggear o reenviar al frontend.
- **`encodeURIComponent`:** Obligatorio para username y token — caracteres como `@`, `:`, `/` en tokens rompen el parsing de URL si no se encodean.
- **`GIT_ASKPASS: ""`:** Previene que git intente abrir un prompt de credenciales externo en el proceso principal.

---

## 📁 Resumen de Archivos a Modificar

| Archivo | Cambio | Líneas aprox. |
|---------|--------|--------------|
| `src/ui/components/CloneFromGitModal.tsx` | Mover `handleClose` antes del `useEffect` de Escape | 239–266 |
| `src/electron/bridge.types.ts` | Agregar `CloneRepositoryAuth` + campo `auth?` en `CloneRepositoryRequest` | 1592–1602 |
| `src/electron/preload.ts` | Verificar que `req` se reenvía completo sin destructuring parcial | — |
| `src/electron/ipc-handlers.ts` | Construir URL autenticada efímera + sanitizar stderr | ~2380 |

---

*Plan generado por Weight-Planner — agentsFlow project*

