# 🧠 Plan de Solución — Error SQLite en `opencode models` (primer intento)

---

## 🎯 Objetivo

Eliminar el error `Failed to run the query 'PRAGMA journal_mode = WAL'` que ocurre **únicamente en el primer intento** de abrir el modal de selección de modelo (`opencode models`), y que desaparece al hacer Retry inmediatamente después.

---

## 🧩 Contexto

### Flujo actual

```
Usuario abre modal de modelos
  → useOpencodeModels (hook React)
    → listModels() [renderer service]
      → window.opencodeModels.listModels() [IPC bridge]
        → IPC channel: opencode-models:list [main process]
          → runOpencodeModels() [electron-main/src/ipc/opencode-models.ts]
            → spawn("opencode", ["models"]) [child process]
              → opencode CLI ejecuta internamente SQLite
```

### El error

```
Failed to run the query 'PRAGMA journal_mode = WAL'
```

Este error **no viene de AgentsFlow**. Viene del **proceso hijo `opencode` CLI**, que internamente usa una base de datos SQLite para almacenar configuración, sesiones o caché de modelos.

---

## 🔬 Diagnóstico — Causas Probables

### Causa #1 (más probable): Race condition en inicialización de SQLite por opencode

**Descripción:**  
`opencode` CLI, al ejecutarse por primera vez en una sesión, necesita inicializar su base de datos SQLite. Esto incluye:
1. Crear el archivo `.db` si no existe.
2. Ejecutar migraciones de esquema.
3. Configurar el modo WAL (`PRAGMA journal_mode = WAL`).

Si el proceso de inicialización no ha terminado cuando se ejecuta la primera query real, SQLite lanza el error porque el archivo está en un estado intermedio (creándose, bloqueado por otro proceso, o sin permisos de escritura aún).

**Por qué funciona en Retry:**  
En el segundo intento, el archivo `.db` ya existe y está correctamente inicializado. SQLite puede abrirlo sin problemas.

---

### Causa #2: Lock de archivo SQLite (WAL mode)

**Descripción:**  
En modo WAL (Write-Ahead Logging), SQLite crea archivos auxiliares:
- `database.db-wal`
- `database.db-shm`

Si una instancia anterior de `opencode` terminó abruptamente (crash, kill, etc.), estos archivos pueden quedar en un estado inconsistente. El primer intento de abrir la DB falla porque SQLite detecta el lock o el WAL corrupto. El segundo intento puede tener éxito si SQLite logra recuperarse automáticamente.

---

### Causa #3: Permisos de escritura en el directorio de datos de opencode

**Descripción:**  
En Linux/Windows, el directorio donde opencode guarda su SQLite puede no tener permisos de escritura en el momento exacto del primer spawn. Esto es especialmente probable si:
- La app Electron se inicia muy rápido después del login del sistema.
- El directorio de datos del usuario aún no está completamente montado (ej. home en red, WSL, etc.).

---

### Causa #4: Inicialización tardía del proceso opencode (cold start)

**Descripción:**  
`opencode` puede tener un tiempo de arranque no trivial (carga de plugins, configuración, etc.). Si el proceso hijo es spawneado antes de que el entorno esté listo (variables de entorno, PATH, directorio home), la inicialización de SQLite puede fallar.

---

### Causa #5: Conflicto de instancias concurrentes (menos probable)

**Descripción:**  
Si el usuario abre el modal dos veces muy rápido, o si hay otro proceso `opencode` corriendo en background, SQLite puede rechazar la segunda conexión en modo WAL porque el archivo ya está bloqueado por la primera instancia.

---

## 🧭 Estrategia de Solución

La solución tiene **dos capas**:

1. **Capa de resiliencia en AgentsFlow** (lo que podemos controlar): implementar retry automático con backoff en el handler IPC, de forma transparente para el usuario.
2. **Capa de diagnóstico** (para entender la causa raíz): loggear el stderr de opencode para identificar exactamente qué falla.

---

## 🚀 Fases y Tareas

---

### 🔹 Phase 1: Diagnóstico — Capturar stderr completo de opencode

**Description:**  
Actualmente el handler en `runOpencodeModels()` captura stderr pero solo lo incluye en el mensaje de error si el exit code es distinto de 0. Necesitamos loggear siempre el stderr para entender qué está pasando.

**Archivo:** `electron-main/src/ipc/opencode-models.ts`

**Task: Agregar logging de stderr siempre**

```typescript
// En el handler child.on("close", ...)
child.on("close", (exitCode: number | null) => {
  // NUEVO: loggear stderr siempre para diagnóstico
  if (stderr.trim()) {
    console.warn("[opencode-models] stderr:", stderr.trim());
  }

  if (exitCode !== 0 && exitCode !== null) {
    settle({
      ok: false,
      models: {},
      error: `opencode models exited with code ${exitCode}: ${stderr.trim()}`,
    });
    return;
  }

  const models = parseOpencodeModelsOutput(stdout);
  settle({ ok: true, models });
});
```

**Assigned to:** Developer  
**Dependencies:** Ninguna

---

### 🔹 Phase 2: Implementar Retry Automático con Backoff en el Handler IPC

**Description:**  
Agregar lógica de retry directamente en `runOpencodeModels()` o en el handler IPC. Si el primer intento falla con un error que contiene `PRAGMA`, `WAL`, `database`, `locked` o `sqlite`, esperar un breve delay y reintentar automáticamente (máximo 2 reintentos).

**Archivo:** `electron-main/src/ipc/opencode-models.ts`

**Task: Implementar retry con backoff**

```typescript
// Constantes de retry
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800; // 800ms entre intentos

// Función helper de delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Palabras clave que indican error de SQLite/DB (retry tiene sentido)
const DB_ERROR_KEYWORDS = ["pragma", "wal", "database", "locked", "sqlite", "db"];

function isRetryableError(error: string): boolean {
  const lower = error.toLowerCase();
  return DB_ERROR_KEYWORDS.some((kw) => lower.includes(kw));
}

// En registerOpencodeModelsHandlers:
ipcMain.handle(
  OPENCODE_MODELS_CHANNELS.LIST_MODELS,
  async (_event): Promise<OpencodeModelsResult> => {
    let lastResult = await runOpencodeModels();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (lastResult.ok) break;
      if (!isRetryableError(lastResult.error ?? "")) break;

      console.warn(
        `[opencode-models] Attempt ${attempt} failed with DB error, retrying in ${RETRY_DELAY_MS}ms...`,
        lastResult.error,
      );
      await delay(RETRY_DELAY_MS);
      lastResult = await runOpencodeModels();
    }

    return lastResult;
  },
);
```

**Assigned to:** Developer  
**Dependencies:** Phase 1 (para tener logs antes de implementar)

---

### 🔹 Phase 3: Mejorar el Spawn con Variables de Entorno Explícitas

**Description:**  
Asegurar que el proceso hijo `opencode` recibe las variables de entorno necesarias para encontrar su directorio de datos. En algunos sistemas, el PATH o HOME pueden no estar disponibles en el contexto del proceso Electron.

**Archivo:** `electron-main/src/ipc/opencode-models.ts`

**Task: Pasar env explícito al spawn**

```typescript
import { homedir } from "node:os";

// En runOpencodeModels(), al hacer spawn:
child = spawnProcess(cmd, ["models"], {
  env: {
    ...process.env,
    HOME: process.env["HOME"] ?? homedir(),
    USERPROFILE: process.env["USERPROFILE"] ?? homedir(), // Windows
  },
  // Evitar que el proceso herede una terminal que pueda interferir
  stdio: ["ignore", "pipe", "pipe"],
});
```

> **Nota:** Si `spawnProcess` es el `_spawn` de Node, acepta un tercer argumento `SpawnOptions`. Si se usa la interfaz inyectable `OpencodeModelsDeps`, hay que actualizar el tipo para aceptar opciones.

**Assigned to:** Developer  
**Dependencies:** Phase 1

---

### 🔹 Phase 4: Robustez Cross-Platform — Detección de opencode en PATH

**Description:**  
En Windows, el ejecutable puede llamarse `opencode.exe` o estar en un directorio no estándar. Agregar detección proactiva antes del spawn para dar un error claro si no se encuentra.

**Archivo:** `electron-main/src/ipc/opencode-models.ts`

**Task: Verificar existencia de opencode antes de spawn**

```typescript
import { which } from "node:child_process"; // No existe, usar alternativa

// Alternativa: intentar spawn con shell:true en Windows como fallback
const spawnOptions = platform === "win32"
  ? { shell: true, stdio: ["ignore", "pipe", "pipe"] as const }
  : { stdio: ["ignore", "pipe", "pipe"] as const };

child = spawnProcess(cmd, ["models"], spawnOptions);
```

**Por qué `shell: true` en Windows:**  
En Windows, algunos ejecutables instalados vía `npm install -g` o `winget` no están directamente en PATH para procesos no-shell. Usar `shell: true` permite que Windows resuelva el ejecutable a través de `cmd.exe`, igual que lo haría el usuario en una terminal.

**⚠️ Advertencia de seguridad:** `shell: true` solo es seguro aquí porque el comando (`opencode`) y los argumentos (`models`) son constantes hardcodeadas, no input del usuario.

**Assigned to:** Developer  
**Dependencies:** Phase 1

---

### 🔹 Phase 5: Feedback Visual Mejorado en el Modal (UX)

**Description:**  
Mientras el retry automático ocurre en background (Phase 2), el usuario no debería ver un error inmediato. Si después de todos los reintentos sigue fallando, mostrar un mensaje más descriptivo que incluya sugerencias de acción.

**Archivo:** `src/renderer/hooks/useOpencodeModels.ts`

**Task: Mejorar mensaje de error en el hook**

El hook ya expone `error: string | null`. El componente que renderiza el modal debe:
1. Distinguir entre "cargando" y "error".
2. Si el error contiene "WAL" o "database", mostrar un mensaje específico:
   > "No se pudo conectar con opencode. Intenta cerrar otras instancias de opencode y vuelve a intentarlo."
3. Mantener el botón "Retry" visible y funcional (ya existe vía `refetch()`).

**Assigned to:** Developer  
**Dependencies:** Phase 2

---

## ⚠️ Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| El retry automático enmascara un error real (ej. opencode no instalado) | Media | `isRetryableError()` filtra solo errores de DB; ENOENT no hace retry |
| `shell: true` en Windows introduce overhead de arranque | Baja | Solo se usa en Windows; el timeout de 15s es suficiente |
| El delay de 800ms × 2 reintentos suma 1.6s extra en el peor caso | Baja | El usuario ya esperaba; es mejor que ver un error |
| La causa raíz es un bug en opencode que solo ellos pueden corregir | Alta | El retry es la única solución desde AgentsFlow; reportar upstream |

---

## 📝 Notas Adicionales

### ¿Por qué WAL mode falla en el primer intento?

SQLite en modo WAL requiere que el proceso que abre la DB tenga permisos de escritura en el **directorio** que contiene el archivo `.db` (no solo en el archivo), porque necesita crear los archivos `-wal` y `-shm`. Si el directorio no existe aún o está siendo creado concurrentemente, el `PRAGMA journal_mode = WAL` falla.

### Dónde guarda opencode su SQLite

Típicamente en:
- **Linux:** `~/.local/share/opencode/` o `~/.config/opencode/`
- **macOS:** `~/Library/Application Support/opencode/`
- **Windows:** `%APPDATA%\opencode\`

Si este directorio no existe en el primer arranque, opencode lo crea durante la inicialización. Si AgentsFlow lanza `opencode models` antes de que esa inicialización termine (race condition), el error ocurre.

### Recomendación a largo plazo

Reportar el bug upstream al repositorio de `opencode` CLI. El CLI debería manejar internamente la inicialización de su DB antes de responder a comandos como `models`, sin exponer errores de SQLite al caller.

### Verificación del fix

Después de implementar Phase 2, verificar:
1. Abrir el modal de modelos por primera vez → debe cargar sin error.
2. Revisar los logs del main process → debe aparecer el warning de retry si ocurrió.
3. Probar en Windows con `shell: true` → debe resolver el ejecutable correctamente.
4. Probar con opencode no instalado → debe mostrar "opencode CLI not found in PATH" sin retry.

---

## 📁 Archivos Relevantes

| Archivo | Rol |
|---------|-----|
| `electron-main/src/ipc/opencode-models.ts` | Handler IPC principal — aquí va el retry y el env fix |
| `src/renderer/services/opencode-models.ts` | Wrapper del renderer — no requiere cambios |
| `src/renderer/hooks/useOpencodeModels.ts` | Hook React — mejora de UX en Phase 5 |
| `src/electron/ipc-handlers.ts` | Registro de handlers — no requiere cambios |

---

*Documento generado por Weight-Planner — AgentsFlow AI Docs*  
*Sesión: `/home/kamiloid/projs/drassMemorIA/editors/agentsFlow`*  
*Fecha: 2026-05-01*
