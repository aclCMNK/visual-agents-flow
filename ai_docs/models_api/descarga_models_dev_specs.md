# Specs — Descarga y Caché de `models.dev/api.json` con Feedback en Pantalla Inicial

## Contexto

El plan de implementación base se encuentra en:
`ai_docs/models_api/descarga_models_dev_plan.md`

Estas specs **refinan y extienden** ese plan con los siguientes cambios respecto a la Phase 6 original:

- **Se elimina** el spinner localizado por sección (`ModelsSectionSpinner`).
- **Se reemplaza** por un mensaje de texto visible en la **pantalla inicial** (`ProjectBrowser`), que informa al usuario del estado de la descarga antes de que pueda interactuar con el editor.
- El mensaje desaparece cuando la operación termina (éxito o fallback), permitiendo el uso normal de la app.

---

## Objetivo

Mostrar en la pantalla inicial (`ProjectBrowser`) un mensaje de estado mientras se descarga o verifica el archivo `models.dev/api.json`. El mensaje refleja el resultado final de la operación y desaparece automáticamente al completarse.

---

## Fases 1–5: Sin cambios

Las Phases 1 a 5 del plan base (`descarga_models_dev_plan.md`) se implementan **exactamente como están definidas**:

- **Phase 1**: Módulo de caché `electron-main/src/fs/models-api-cache.ts`
- **Phase 2**: IPC Handler `electron-main/src/ipc/models-api.ts` + registro en barrel
- **Phase 3**: Preload bridge — exponer `modelsApi.getModels()` en `contextBridge`
- **Phase 4**: Servicio renderer `src/renderer/services/models-api.ts`
- **Phase 5**: Hook `src/renderer/hooks/useModelsApi.ts`

---

## Phase 6 (Redefinida): Integración UI — Mensaje en Pantalla Inicial

### Descripción

Integrar `useModelsApi` en el componente `ProjectBrowser` para mostrar un mensaje de texto informativo durante y después de la descarga. No se usa spinner, no se bloquea la UI, no hay overlay.

---

### Estados y Mensajes

| Estado del hook (`status`) | Mensaje visible | Cuándo desaparece |
|---|---|---|
| `loading: true` (pendiente) | `"Updating models data..."` | Al resolver la promesa |
| `status: "fresh"` | *(sin mensaje — operación silenciosa)* | Inmediato |
| `status: "downloaded"` | `"Models data updated!"` | Tras 3 segundos (auto-dismiss) |
| `status: "fallback"` | `"Failed to update models data, using previous version"` | Tras 5 segundos (auto-dismiss) |
| `status: "unavailable"` | `"Failed to download models data. Some features may be limited."` | Permanente hasta que el usuario lo descarte (botón ✕) o recargue |

> **Nota:** El estado `"fresh"` no muestra ningún mensaje porque la operación fue silenciosa (no hubo descarga). El usuario no necesita feedback en este caso.

---

### Lógica de Antigüedad y Descarga (resumen para referencia)

La lógica reside íntegramente en el **main process** (`models-api-cache.ts`):

1. Al montar `ProjectBrowser`, el hook `useModelsApi` invoca `getModels()` vía IPC.
2. El main process evalúa si el archivo `models/api/models.dev.json` existe y si su `mtime` tiene más de **5 días** (`5 * 24 * 60 * 60 * 1000` ms).
3. Si no está stale → retorna `{ status: "fresh", data }` sin descargar.
4. Si está stale → intenta `fetch("https://models.dev/api.json")`:
   - Éxito → guarda el JSON, retorna `{ status: "downloaded", data }`.
   - Fallo + caché anterior existe → retorna `{ status: "fallback", data, error }`.
   - Fallo + sin caché → retorna `{ status: "unavailable", data: null, error }`.

---

### Punto de Integración UI: `ProjectBrowser`

**Archivo:** `src/ui/components/ProjectBrowser.tsx`

**Dónde insertar el mensaje:** Inmediatamente después del `<header>` que contiene el logo, antes del bloque de error `lastError`. Esto lo coloca en la zona superior visible de la pantalla inicial.

**Patrón de implementación:**

```tsx
// En ProjectBrowser.tsx

import { useModelsApi } from "../../renderer/hooks/useModelsApi.ts";

export function ProjectBrowser() {
  // ... código existente ...

  const { loading: modelsLoading, status: modelsStatus } = useModelsApi();

  // Derivar mensaje a mostrar
  const modelsMessage = deriveModelsMessage(modelsLoading, modelsStatus);

  return (
    <div className="project-browser">
      {/* ── Header (logo) — sin cambios ─────────────────────────────── */}
      <header className="project-browser__header">
        {/* ... logo existente ... */}
      </header>

      {/* ── Models data status message ──────────────────────────────── */}
      {modelsMessage && (
        <ModelsStatusMessage
          message={modelsMessage.text}
          kind={modelsMessage.kind}
          dismissible={modelsMessage.dismissible}
        />
      )}

      {/* ── Error banner — sin cambios ──────────────────────────────── */}
      {lastError && ( /* ... */ )}

      {/* ... resto del componente sin cambios ... */}
    </div>
  );
}
```

---

### Función auxiliar `deriveModelsMessage`

```ts
type MessageKind = "info" | "success" | "warning" | "error";

interface ModelsMessage {
  text: string;
  kind: MessageKind;
  dismissible: boolean;  // true solo para "unavailable"
}

function deriveModelsMessage(
  loading: boolean,
  status: ModelsApiStatus | null
): ModelsMessage | null {
  if (loading) {
    return {
      text: "Updating models data...",
      kind: "info",
      dismissible: false,
    };
  }

  switch (status) {
    case "fresh":
      return null; // silencioso

    case "downloaded":
      return {
        text: "Models data updated!",
        kind: "success",
        dismissible: false, // auto-dismiss en 3s
      };

    case "fallback":
      return {
        text: "Failed to update models data, using previous version",
        kind: "warning",
        dismissible: false, // auto-dismiss en 5s
      };

    case "unavailable":
      return {
        text: "Failed to download models data. Some features may be limited.",
        kind: "error",
        dismissible: true, // permanente, el usuario lo cierra
      };

    default:
      return null;
  }
}
```

---

### Componente `ModelsStatusMessage`

**Archivo:** `src/ui/components/ModelsStatusMessage.tsx` *(nuevo)*

**Responsabilidades:**
- Renderizar el mensaje con el estilo visual apropiado según `kind`.
- Auto-dismiss: si `dismissible === false` y `kind` es `"success"` o `"warning"`, desaparecer automáticamente tras el delay correspondiente (3s / 5s) usando `useEffect` + `setTimeout`.
- Si `dismissible === true`, mostrar un botón ✕ para que el usuario lo cierre manualmente.
- No bloquear ninguna interacción del resto de la UI.

**Props:**

```ts
interface ModelsStatusMessageProps {
  message: string;
  kind: "info" | "success" | "warning" | "error";
  dismissible: boolean;
  onDismiss?: () => void; // callback cuando el usuario hace clic en ✕
}
```

**Comportamiento de auto-dismiss:**
- `kind: "success"` → desaparece a los **3 segundos**.
- `kind: "warning"` → desaparece a los **5 segundos**.
- `kind: "info"` → no desaparece (mientras `loading: true`).
- `kind: "error"` (unavailable) → no desaparece automáticamente.

**Accesibilidad:**
- `role="status"` para `"info"`, `"success"`, `"warning"`.
- `role="alert"` para `"error"`.
- `aria-live="polite"` para todos excepto `"error"` (`aria-live="assertive"`).
- Botón ✕ con `aria-label="Dismiss models data notification"`.

**Clases CSS sugeridas:**
```
.models-status-message
.models-status-message--info
.models-status-message--success
.models-status-message--warning
.models-status-message--error
.models-status-message__text
.models-status-message__close
```

**Estilos:** Consistentes con `.project-load-toast` ya existente en `App.tsx` — barra horizontal compacta, sin overlay, sin spinner.

---

### Gestión del estado de dismiss en `ProjectBrowser`

El componente padre (`ProjectBrowser`) debe gestionar si el mensaje está visible o fue descartado por el usuario:

```tsx
const [modelsMessageDismissed, setModelsMessageDismissed] = useState(false);

const modelsMessage = modelsMessageDismissed
  ? null
  : deriveModelsMessage(modelsLoading, modelsStatus);
```

Cuando el hook cambia de `loading: true` a un nuevo `status`, el mensaje anterior se reemplaza automáticamente (el estado `dismissed` se resetea porque el mensaje cambia).

> **Simplificación:** El reset del `dismissed` ocurre naturalmente porque `deriveModelsMessage` retorna `null` para `"fresh"` y el mensaje de `"info"` (loading) es reemplazado por el mensaje final. No se necesita lógica adicional de reset.

---

## Estructura de Archivos Afectados (actualizada)

```
[raíz del proyecto]/
├── models/
│   └── api/
│       ├── .gitkeep                              ← nuevo
│       └── models.dev.json                       ← nuevo (ignorado por git)
│
├── electron-main/src/
│   ├── fs/
│   │   └── models-api-cache.ts                   ← nuevo (Phase 1)
│   └── ipc/
│       ├── models-api.ts                         ← nuevo (Phase 2)
│       └── index.ts                              ← modificado (Phase 2)
│
├── src/
│   ├── electron/
│   │   └── ipc-handlers.ts                       ← modificado (Phase 2)
│   ├── renderer/
│   │   ├── services/
│   │   │   └── models-api.ts                     ← nuevo (Phase 4)
│   │   └── hooks/
│   │       └── useModelsApi.ts                   ← nuevo (Phase 5)
│   ├── ui/
│   │   └── components/
│   │       ├── ProjectBrowser.tsx                ← modificado (Phase 6)
│   │       └── ModelsStatusMessage.tsx           ← nuevo (Phase 6)
│   └── vite-env.d.ts                             ← modificado (Phase 3)
│
└── tests/
    ├── electron/
    │   ├── fs/
    │   │   └── models-api-cache.test.ts          ← nuevo (Phase 7)
    │   └── ipc/
    │       └── models-api.test.ts                ← nuevo (Phase 7)
    └── renderer/
        ├── hooks/
        │   └── useModelsApi.test.ts              ← nuevo (Phase 7)
        └── components/
            └── ModelsStatusMessage.test.tsx      ← nuevo (Phase 7)
```

> **Eliminado respecto al plan base:** `src/renderer/components/ui/ModelsSectionSpinner.tsx` — no se implementa.

---

## Phase 7 (Actualizada): Pruebas y Validaciones

Las Tasks 7.1, 7.2 y 7.3 del plan base se mantienen **sin cambios**.

Se agrega:

### Task 7.4 — Tests del componente `ModelsStatusMessage`

**Ruta:** `tests/renderer/components/ModelsStatusMessage.test.tsx`

**Casos:**
- Renderiza el mensaje de texto correcto para cada `kind`.
- Aplica la clase CSS correcta según `kind`.
- Auto-dismiss a los 3s para `kind: "success"` (mock de `setTimeout`).
- Auto-dismiss a los 5s para `kind: "warning"` (mock de `setTimeout`).
- No auto-dismiss para `kind: "info"` ni `kind: "error"`.
- Muestra botón ✕ solo cuando `dismissible: true`.
- Llama `onDismiss` al hacer clic en ✕.
- `role="alert"` para `kind: "error"`, `role="status"` para el resto.

### Task 7.5 — Tests de integración en `ProjectBrowser`

**Ruta:** `tests/renderer/components/ProjectBrowser.test.tsx` *(nuevo o modificado)*

**Casos:**
- Muestra `"Updating models data..."` mientras `loading: true`.
- No muestra ningún mensaje cuando `status: "fresh"`.
- Muestra `"Models data updated!"` cuando `status: "downloaded"`, desaparece a los 3s.
- Muestra mensaje de warning cuando `status: "fallback"`, desaparece a los 5s.
- Muestra mensaje de error cuando `status: "unavailable"`, no desaparece automáticamente.
- El botón ✕ descarta el mensaje de `"unavailable"`.
- El mensaje de modelos no interfiere con el banner de error `lastError` existente.

---

## Flujo Visual Completo

```
App inicia → ProjectBrowser monta
        │
        ▼
useModelsApi() → IPC getModels()
        │
  [loading: true]
        │
        ▼
ModelsStatusMessage: "Updating models data..."  ← visible en pantalla inicial
        │
        ▼ (IPC resuelve)
        │
  ┌─────┴──────────────────────────────────────────────┐
  │                                                    │
status: "fresh"              status: "downloaded"      │
  │                                  │                 │
  ▼                                  ▼                 │
(sin mensaje)           "Models data updated!"         │
                          [auto-dismiss 3s]            │
                                                       │
                    status: "fallback"    status: "unavailable"
                          │                     │
                          ▼                     ▼
              "Failed to update models   "Failed to download
               data, using previous      models data. Some
               version"                  features may be
               [auto-dismiss 5s]         limited."
                                         [botón ✕ manual]
```

---

## Restricciones de Implementación

1. **Sin spinner**: No implementar ningún spinner, loading overlay ni animación de carga.
2. **Sin bloqueo de UI**: El mensaje es puramente informativo. El usuario puede interactuar con `ProjectBrowser` (abrir proyectos, etc.) mientras la descarga está en curso.
3. **Sin mensaje para `"fresh"`**: Si el archivo es reciente y no se descargó, no mostrar nada.
4. **Consistencia visual**: El componente `ModelsStatusMessage` debe seguir el mismo estilo que `.project-load-toast` ya existente en `App.tsx`.
5. **Sin cambios en `EditorView`**: La funcionalidad de modelos no afecta la vista del editor en esta implementación.
6. **Ubicación del mensaje**: Siempre en `ProjectBrowser`, nunca en `EditorView` ni en otros componentes.
