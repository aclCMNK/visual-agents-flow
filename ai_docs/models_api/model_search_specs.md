# Specs — Model Search Component

## Contexto

El plan de implementación base se encuentra en:
`ai_docs/models_api/model_search_plan.md`

Estas specs definen los contratos exactos de cada módulo: tipos, firmas, comportamientos y restricciones de implementación.

---

## Phase 1 — `electron-main/src/ipc/opencode-models.ts`

### Tipos exportados

```ts
export const OPENCODE_MODELS_CHANNELS = {
  LIST_MODELS: "opencode-models:list",
} as const;

export interface OpencodeModelsResult {
  ok: boolean;
  /** Mapa proveedor → lista de modelos. Vacío si ok=false. */
  models: Record<string, string[]>;
  /** Mensaje de error si ok=false. */
  error?: string;
}

export interface OpencodeModelsDeps {
  spawnProcess: (cmd: string, args: string[]) => ChildProcess;
  platform: NodeJS.Platform;
}
```

### Función principal

```ts
export async function runOpencodeModels(
  deps?: Partial<OpencodeModelsDeps>
): Promise<OpencodeModelsResult>
```

**Comportamiento:**
1. Determinar el comando: `process.platform === "win32"` → intentar `opencode.exe`, fallback a `opencode`. En Linux/macOS → `opencode`.
2. Ejecutar `spawn(cmd, ["models"], { shell: false, env: process.env })`.
3. Acumular stdout en buffer de string.
4. Timeout de **15 segundos**: si el proceso no termina, llamar `child.kill()` y retornar `{ ok: false, models: {}, error: "opencode models timed out after 15s" }`.
5. Si el proceso emite `error` con `code === "ENOENT"` → retornar `{ ok: false, models: {}, error: "opencode CLI not found in PATH" }`.
6. Si el proceso termina con `exitCode !== 0` → retornar `{ ok: false, models: {}, error: "opencode models exited with code N: <stderr>" }`.
7. Parsear stdout con `parseOpencodeModelsOutput(stdout)`.
8. Retornar `{ ok: true, models: parsed }`.

### Función de parsing

```ts
export function parseOpencodeModelsOutput(
  stdout: string
): Record<string, string[]>
```

**Reglas de parsing:**
- Split por `\n` (y `\r\n` en Windows).
- Para cada línea: trim. Ignorar si está vacía o no contiene `/`.
- Split por `/` (solo el primer `/`): `[provider, ...rest]` → `model = rest.join("/")`.
- Ignorar si `provider` o `model` están vacíos tras trim.
- Acumular: `result[provider] = result[provider] ?? []; result[provider].push(model)`.
- Retornar el mapa resultante.

**Ejemplo de input:**
```
anthropic/claude-opus-4-5
anthropic/claude-sonnet-4-5
openai/gpt-4o
openai/gpt-4o-mini
```

**Output esperado:**
```json
{
  "anthropic": ["claude-opus-4-5", "claude-sonnet-4-5"],
  "openai": ["gpt-4o", "gpt-4o-mini"]
}
```

### Handler IPC

```ts
export function registerOpencodeModelsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    OPENCODE_MODELS_CHANNELS.LIST_MODELS,
    async (_event): Promise<OpencodeModelsResult> => {
      return runOpencodeModels();
    }
  );
}
```

---

## Phase 1.2 — `electron-main/src/ipc/index.ts`

Agregar al barrel:

```ts
export {
  registerOpencodeModelsHandlers,
  OPENCODE_MODELS_CHANNELS,
} from "./opencode-models.ts";
```

---

## Phase 1.3 — `src/electron/ipc-handlers.ts`

### Importación (agregar a la importación existente del barrel)

```ts
import {
  registerFolderExplorerHandlers,
  FOLDER_EXPLORER_CHANNELS,
  registerModelsApiHandlers,
  MODELS_API_CHANNELS,
  registerOpencodeModelsHandlers,   // ← nuevo
  OPENCODE_MODELS_CHANNELS,         // ← nuevo
} from "../../electron-main/src/ipc/index.ts";
```

### En `registerIpcHandlers()` — idempotency guard

```ts
// ── Also remove opencode-models channels ─────────────────────────────────────
for (const channel of Object.values(OPENCODE_MODELS_CHANNELS)) {
  ipcMain.removeHandler(channel);
}
```

### Al final de `registerIpcHandlers()`

```ts
// ── Register opencode-models handlers ────────────────────────────────────────
registerOpencodeModelsHandlers(ipcMain);
```

---

## Phase 2.1 — `src/electron/bridge.types.ts`

Agregar (NO modificar `IPC_CHANNELS` — seguir el patrón de `MODELS_API_CHANNELS`):

```ts
/** Result of the opencode-models:list IPC call. */
export interface OpencodeModelsResult {
  ok: boolean;
  models: Record<string, string[]>;
  error?: string;
}
```

---

## Phase 2.2 — `src/electron/preload.ts`

Agregar nueva exposición via `contextBridge`:

```ts
contextBridge.exposeInMainWorld("opencodeModels", {
  listModels: (): Promise<OpencodeModelsResult> =>
    ipcRenderer.invoke(OPENCODE_MODELS_CHANNELS.LIST_MODELS),
});
```

**Nota:** Importar `OPENCODE_MODELS_CHANNELS` desde `"../../electron-main/src/ipc/index.ts"` (igual que `MODELS_API_CHANNELS`).

---

## Phase 2.3 — `src/vite-env.d.ts`

Agregar a la interfaz `Window`:

```ts
opencodeModels?: {
  listModels(): Promise<import("./electron/bridge.types.ts").OpencodeModelsResult>;
};
```

---

## Phase 3.1 — `src/renderer/services/opencode-models.ts`

```ts
/**
 * src/renderer/services/opencode-models.ts
 *
 * IPC Service — opencode CLI models wrapper for the React renderer.
 * Typed, Promise-based wrapper around `window.opencodeModels`.
 */

export interface OpencodeModelsServiceResult {
  ok: boolean;
  models: Record<string, string[]>;
  error?: string;
}

const TIMEOUT_MS = 20_000;
const TIMEOUT_SENTINEL = Symbol("opencode_models_timeout");

function getBridge(): { listModels(): Promise<OpencodeModelsServiceResult> } | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & {
    opencodeModels?: { listModels(): Promise<OpencodeModelsServiceResult> }
  }).opencodeModels;
}

async function callWithTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMEOUT_SENTINEL), TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function listModels(): Promise<OpencodeModelsServiceResult> {
  const bridge = getBridge();
  if (!bridge) {
    return { ok: false, models: {}, error: "window.opencodeModels is not available." };
  }
  try {
    return await callWithTimeout(bridge.listModels());
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, models: {}, error: `opencode models timed out after ${TIMEOUT_MS}ms.` };
    }
    return { ok: false, models: {}, error: err instanceof Error ? err.message : String(err) };
  }
}
```

---

## Phase 3.2 — `src/renderer/hooks/useOpencodeModels.ts`

```ts
/**
 * src/renderer/hooks/useOpencodeModels.ts
 *
 * Custom hook — opencode CLI models lifecycle manager.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listModels } from "../services/opencode-models.ts";

export interface UseOpencodeModelsResult {
  models: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOpencodeModels(): UseOpencodeModelsResult {
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState<number>(0);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void listModels().then((result) => {
      if (cancelled || !mountedRef.current) return;
      if (result.ok) {
        setModels(result.models);
        setError(null);
      } else {
        setModels({});
        setError(result.error ?? "Unknown error");
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [fetchCount]);

  const refetch = useCallback(() => setFetchCount((c) => c + 1), []);

  return { models, loading, error, refetch };
}
```

---

## Phase 4.1 — `src/renderer/services/model-search-utils.ts`

### Tipos

```ts
export interface ModelSearchEntry {
  provider: string;
  model: string;
  fullId: string;                    // "provider/model"
  inputCostPer1M: number | null;     // USD por 1M tokens input
  outputCostPer1M: number | null;    // USD por 1M tokens output
  hasReasoning: boolean | null;      // null = no info
  contextWindow: number | null;      // tokens
  maxOutput: number | null;          // tokens
  hasExtendedInfo: boolean;          // false si no hay datos en models.dev
}
```

### `buildModelSearchEntries`

```ts
export function buildModelSearchEntries(
  cliModels: Record<string, string[]>,
  modelsDevData: unknown | null,
): ModelSearchEntry[]
```

**Lógica de cruce con models.dev:**

El JSON de `models.dev/api.json` tiene la siguiente estructura (basada en la API pública):
```json
{
  "models": [
    {
      "id": "anthropic/claude-opus-4-5",
      "name": "Claude Opus 4.5",
      "provider": "anthropic",
      "cost": {
        "input": 15,       // USD por 1M tokens
        "output": 75
      },
      "reasoning": true,
      "limit": {
        "context": 200000,
        "output": 32000
      }
    }
  ]
}
```

**Algoritmo:**
1. Extraer `modelsDevData?.models` como array (defensivo con `Array.isArray`).
2. Construir un mapa de lookup: `Map<string, ModelsDevEntry>` donde la key es `entry.id` (ej: `"anthropic/claude-opus-4-5"`).
3. Para cada `[provider, modelList]` en `cliModels`:
   - Para cada `model` en `modelList`:
     - `fullId = "${provider}/${model}"`
     - Buscar en el mapa por `fullId`
     - Si hay match: extraer campos con optional chaining + fallback a `null`
     - Si no hay match: todos los campos extendidos = `null`, `hasExtendedInfo = false`
4. Ordenar resultado: primero por `provider` (localeCompare), luego por `model` (localeCompare).

**Extracción defensiva de campos:**
```ts
const entry = lookupMap.get(fullId);
const inputCostPer1M = typeof entry?.cost?.input === "number" ? entry.cost.input : null;
const outputCostPer1M = typeof entry?.cost?.output === "number" ? entry.cost.output : null;
const hasReasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : null;
const contextWindow = typeof entry?.limit?.context === "number" ? entry.limit.context : null;
const maxOutput = typeof entry?.limit?.output === "number" ? entry.limit.output : null;
const hasExtendedInfo = entry !== undefined;
```

### `filterModelEntries`

```ts
export function filterModelEntries(
  entries: ModelSearchEntry[],
  query: string,
): ModelSearchEntry[]
```

**Lógica:**
- `query.trim()` vacío → retornar `entries` sin filtrar.
- Normalizar query: `query.trim().toLowerCase()`.
- Para cada entry, construir un string de búsqueda concatenando todos los campos visibles:
  ```ts
  const searchable = [
    entry.provider,
    entry.model,
    entry.fullId,
    entry.inputCostPer1M !== null ? `${entry.inputCostPer1M}` : "no info",
    entry.outputCostPer1M !== null ? `${entry.outputCostPer1M}` : "no info",
    entry.hasReasoning === true ? "yes reasoning" : entry.hasReasoning === false ? "no reasoning" : "",
    entry.contextWindow !== null ? `${entry.contextWindow}` : "",
    entry.maxOutput !== null ? `${entry.maxOutput}` : "",
  ].join(" ").toLowerCase();
  ```
- Retornar entries donde `searchable.includes(normalizedQuery)`.

---

## Phase 5.1 — `src/ui/components/ModelSearchPanel.tsx`

### Props

```ts
interface ModelSearchPanelProps {
  /** Callback cuando el usuario selecciona un modelo. Recibe "provider/model". */
  onSelectModel: (modelId: string) => void;
  /** Query inicial para el input de búsqueda. */
  initialQuery?: string;
}
```

### Estructura interna

```tsx
export function ModelSearchPanel({ onSelectModel, initialQuery = "" }: ModelSearchPanelProps) {
  const { models: cliModels, loading: cliLoading, error: cliError, refetch } = useOpencodeModels();
  const { data: modelsDevData, loading: devLoading } = useModelsApi();

  const [query, setQuery] = useState(initialQuery);

  const isLoading = cliLoading || devLoading;

  const allEntries = useMemo(
    () => buildModelSearchEntries(cliModels, modelsDevData),
    [cliModels, modelsDevData]
  );

  const filteredEntries = useMemo(
    () => filterModelEntries(allEntries, query),
    [allEntries, query]
  );

  // ... render según estado
}
```

### Estados de UI y su renderizado

| Condición | Render |
|---|---|
| `isLoading` | Spinner + texto "Loading models..." |
| `!isLoading && cliError && cliError.includes("not found in PATH")` | Banner error: "opencode CLI not found. Make sure opencode is installed and in your PATH." + botón Retry |
| `!isLoading && cliError` | Banner error genérico con `cliError` + botón Retry |
| `!isLoading && allEntries.length === 0` | Mensaje: "No models available. Make sure opencode is configured." |
| `!isLoading && filteredEntries.length === 0 && query` | Mensaje: `No models found for "${query}"` |
| `!isLoading && filteredEntries.length > 0` | Input de búsqueda + tabla de resultados |

### Estructura del render principal

```tsx
return (
  <div className="model-search-panel">
    {/* ── Search input ─────────────────────────────────────────────── */}
    <div className="model-search-panel__search">
      <input
        type="text"
        className="model-search-panel__input"
        placeholder="Search by provider, model, cost, reasoning..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        aria-label="Search models"
      />
    </div>

    {/* ── Results area ─────────────────────────────────────────────── */}
    <div className="model-search-panel__results">
      {/* Estado: loading */}
      {isLoading && (
        <div className="model-search-panel__loading" role="status">
          <span className="model-search-panel__spinner" aria-hidden="true" />
          Loading models...
        </div>
      )}

      {/* Estado: error CLI */}
      {!isLoading && cliError && (
        <div className="model-search-panel__error" role="alert">
          <p>{cliError.includes("not found in PATH")
            ? "opencode CLI not found. Make sure opencode is installed and in your PATH."
            : cliError}
          </p>
          <button type="button" onClick={refetch}>Retry</button>
        </div>
      )}

      {/* Estado: sin resultados para query */}
      {!isLoading && !cliError && filteredEntries.length === 0 && query && (
        <p className="model-search-panel__empty">
          No models found for "{query}"
        </p>
      )}

      {/* Estado: sin modelos disponibles */}
      {!isLoading && !cliError && allEntries.length === 0 && (
        <p className="model-search-panel__empty">
          No models available. Make sure opencode is configured.
        </p>
      )}

      {/* Estado: tabla de resultados */}
      {!isLoading && !cliError && filteredEntries.length > 0 && (
        <table className="model-search-panel__table" role="grid">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Model</th>
              <th scope="col">Input ($/1M)</th>
              <th scope="col">Output ($/1M)</th>
              <th scope="col">Reasoning</th>
              <th scope="col">Context</th>
              <th scope="col">Max Output</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map((entry) => (
              <tr
                key={entry.fullId}
                className="model-search-panel__row"
                onClick={() => onSelectModel(entry.fullId)}
                role="row"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelectModel(entry.fullId)}
                aria-label={`Select ${entry.fullId}`}
              >
                <td>{entry.provider}</td>
                <td>{entry.model}</td>
                <td>{entry.inputCostPer1M !== null ? `$${entry.inputCostPer1M}` : "—"}</td>
                <td>{entry.outputCostPer1M !== null ? `$${entry.outputCostPer1M}` : "—"}</td>
                <td>{entry.hasReasoning === true ? "✓" : entry.hasReasoning === false ? "✗" : "—"}</td>
                <td>{entry.contextWindow !== null ? formatTokens(entry.contextWindow) : "—"}</td>
                <td>{entry.maxOutput !== null ? formatTokens(entry.maxOutput) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);
```

### Helper de formato

```ts
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
```

---

## Phase 5.2 — CSS (`model-search-panel.css` o integrado)

### Clases requeridas

```
.model-search-panel                    — contenedor principal, flex column, height: 100%
.model-search-panel__search            — área del input, padding, border-bottom
.model-search-panel__input             — input de texto, width: 100%, sin border propio
.model-search-panel__results           — área scrollable, flex: 1, overflow-y: auto
.model-search-panel__loading           — centrado, gap entre spinner y texto
.model-search-panel__spinner           — spinner CSS (border-radius: 50%, animation: spin)
.model-search-panel__error             — banner rojo/naranja, padding, border-radius
.model-search-panel__empty             — texto centrado, color muted
.model-search-panel__table             — width: 100%, border-collapse: collapse
.model-search-panel__table th          — text-align: left, padding, border-bottom, sticky top
.model-search-panel__row               — cursor: pointer, hover: background highlight
.model-search-panel__row:focus         — outline visible (accesibilidad)
.model-search-panel__row td            — padding, border-bottom sutil
```

**Restricciones de diseño:**
- El panel ocupa el 100% del `modal__body` (que ya tiene `height: 100%` o similar).
- La tabla tiene `thead` sticky para que el header no se pierda al hacer scroll.
- El input tiene `autoFocus` — el usuario puede escribir inmediatamente al abrir el modal.
- Consistente con el design system existente (variables CSS del proyecto si existen).

---

## Phase 6.1 — `src/ui/components/SelectModelModal.tsx`

### Cambios

```tsx
import { ModelSearchPanel } from "./ModelSearchPanel.tsx";

// Agregar prop para el agentId activo
interface SelectModelModalProps {
  open: boolean;
  onClose: () => void;
  agentId?: string;  // ID del agente al que se asignará el modelo
  children?: React.ReactNode;  // override opcional para tests
}

export function SelectModelModal({ open, onClose, agentId, children }: SelectModelModalProps) {
  // ... código existente ...

  function handleSelectModel(modelId: string) {
    // TODO en Task 6.1: actualizar el agente en el store
    // agentFlowStore.setAgentModel(agentId, modelId);
    onClose();
  }

  return createPortal(
    // ... header existente sin cambios ...
    <div className="modal__body select-model-modal__body">
      {children ?? (
        <ModelSearchPanel onSelectModel={handleSelectModel} />
      )}
    </div>
    // ...
  );
}
```

**Nota sobre persistencia del modelo:** Antes de implementar `handleSelectModel`, verificar en `src/ui/store/agentFlowStore.ts` cómo se actualiza el modelo de un agente. El campo en `.adata` puede ser `metadata.model` o similar. Coordinar con el schema existente.

---

## Estructura de Archivos Completa (nuevos y modificados)

```
[raíz del proyecto]/
│
├── electron-main/src/
│   └── ipc/
│       ├── opencode-models.ts          ← NUEVO (Phase 1.1)
│       └── index.ts                    ← MODIFICADO (Phase 1.2)
│
├── src/
│   ├── electron/
│   │   ├── bridge.types.ts             ← MODIFICADO (Phase 2.1)
│   │   ├── preload.ts                  ← MODIFICADO (Phase 2.2)
│   │   └── ipc-handlers.ts             ← MODIFICADO (Phase 1.3)
│   ├── renderer/
│   │   ├── services/
│   │   │   ├── opencode-models.ts      ← NUEVO (Phase 3.1)
│   │   │   └── model-search-utils.ts   ← NUEVO (Phase 4.1)
│   │   └── hooks/
│   │       └── useOpencodeModels.ts    ← NUEVO (Phase 3.2)
│   ├── ui/
│   │   └── components/
│   │       ├── ModelSearchPanel.tsx    ← NUEVO (Phase 5.1)
│   │       └── SelectModelModal.tsx    ← MODIFICADO (Phase 6.1)
│   └── vite-env.d.ts                   ← MODIFICADO (Phase 2.3)
│
└── tests/
    ├── electron/
    │   └── ipc/
    │       └── opencode-models.test.ts ← NUEVO (Phase 7.1)
    └── renderer/
        ├── services/
        │   └── model-search-utils.test.ts ← NUEVO (Phase 7.2)
        └── components/
            └── ModelSearchPanel.test.tsx  ← NUEVO (Phase 7.3)
```

---

## Flujo de Datos Completo

```
Usuario abre SelectModelModal
        │
        ▼
ModelSearchPanel monta
        │
        ├──► useOpencodeModels()
        │         │
        │         ▼
        │    IPC: opencode-models:list
        │         │
        │         ▼
        │    main process: spawn("opencode", ["models"])
        │         │
        │         ▼
        │    parseOpencodeModelsOutput(stdout)
        │         │
        │         ▼
        │    { ok, models: { anthropic: [...], openai: [...] } }
        │
        └──► useModelsApi()  (ya puede tener datos cacheados)
                  │
                  ▼
             IPC: models-api:get-models
                  │
                  ▼
             { ok, data: modelsDevJSON }

        Ambos hooks resueltos
                  │
                  ▼
        buildModelSearchEntries(cliModels, modelsDevData)
                  │
                  ▼
        ModelSearchEntry[] (cruzado, ordenado)
                  │
                  ▼
        filterModelEntries(entries, query)  ← reactivo al input
                  │
                  ▼
        Tabla renderizada

        Usuario hace click en fila
                  │
                  ▼
        onSelectModel("anthropic/claude-opus-4-5")
                  │
                  ▼
        SelectModelModal: actualizar agente + cerrar modal
```

---

## Restricciones de Implementación

1. **Sin acceso directo a `ipcMain` en los módulos de handler** — siempre inyectar como parámetro.
2. **Sin imports del main process en el renderer** — los tipos se duplican localmente (ver patrón de `ModelsApiStatus`).
3. **El cruce de datos es una función pura** — sin side effects, sin estado, testeable en aislamiento.
4. **El componente `ModelSearchPanel` no conoce el store** — recibe `onSelectModel` como callback.
5. **Ambos hooks cargan en paralelo** — el componente muestra loading hasta que AMBOS terminen (`isLoading = cliLoading || devLoading`).
6. **El input tiene `autoFocus`** — el usuario puede buscar inmediatamente al abrir el modal.
7. **Accesibilidad de la tabla** — `role="grid"`, filas con `tabIndex={0}` y `onKeyDown` para Enter.
8. **Tolerancia a schema changes** — todo acceso a `modelsDevData` con optional chaining y fallback a `null`.
9. **No bloquear el modal** — si el CLI falla, mostrar error con Retry, no bloquear el cierre del modal.
10. **`SelectModelModal` mantiene `children` como override** — para tests y extensibilidad futura.
