# 🧠 Plan de Solución — Model Search Component

## 🎯 Objective
Implementar un componente buscador de modelos que combine el listado real del CLI `opencode models` con los datos extendidos del JSON local de `models.dev/api.json`, embebible en el `SelectModelModal` existente, con filtrado en vivo y selección de modelo para asignarlo al agente activo.

---

## 🧩 Context

### Estado actual del sistema
- `SelectModelModal` ya existe en `src/ui/components/SelectModelModal.tsx` con un slot `children` vacío ("Model search coming soon...").
- El sistema de caché de `models.dev/api.json` ya está implementado y funcional:
  - `electron-main/src/ipc/models-api.ts` → handler IPC `models-api:get-models`
  - `src/renderer/services/models-api.ts` → servicio renderer
  - `src/renderer/hooks/useModelsApi.ts` → hook React con `{ data, loading, status, error }`
- El preload ya expone `window.modelsApi.getModels()` al renderer.
- El patrón de IPC handlers está bien establecido en `src/electron/ipc-handlers.ts`.
- El patrón de registro de handlers externos está en `electron-main/src/ipc/index.ts`.

### Lo que falta
1. **Backend**: Handler IPC que ejecute `opencode models` como proceso hijo y retorne el listado parseado.
2. **Bridge**: Exponer el nuevo canal en preload y bridge.types.ts.
3. **Frontend**: Servicio + hook para el listado CLI.
4. **Lógica de cruce**: Combinar listado CLI con datos de `models.dev/api.json`.
5. **Componente UI**: `ModelSearchPanel` con input de búsqueda, tabla de resultados y selección.
6. **Integración**: Conectar `ModelSearchPanel` dentro de `SelectModelModal`.

---

## 🧭 Strategy

**Enfoque elegido:** Separación de responsabilidades en capas bien definidas:
- El main process es el único que ejecuta procesos hijos (CLI).
- El renderer recibe datos ya parseados y listos para cruzar.
- El cruce de datos (CLI + models.dev) ocurre en el renderer (es lógica de presentación).
- El filtrado es puramente en memoria en el renderer (sin IPC adicional).

**Patrón de extensión:** Seguir exactamente el mismo patrón que `registerModelsApiHandlers` / `registerFolderExplorerHandlers` para el nuevo handler del CLI.

---

## 🚀 Phases

### 🔹 Phase 1: Backend — IPC Handler para `opencode models`

**Description:**
Crear el módulo que ejecuta `opencode models` como proceso hijo cross-platform, parsea el output a JSON estructurado y lo expone vía IPC.

**Tasks:**

- **Task 1.1:** Crear `electron-main/src/ipc/opencode-models.ts`
  - Implementar `runOpencodeModels(deps?)` que ejecuta el CLI con `spawn`
  - Soporte cross-platform: `opencode` en Linux/macOS, `opencode.exe` en Windows (con fallback a `opencode`)
  - Timeout de 15 segundos para el proceso hijo
  - Parsear stdout línea a línea: cada línea con formato `proveedor/modelo` → `{ [provider]: string[] }`
  - Ignorar líneas vacías, headers, líneas sin `/`
  - Retornar `{ ok: boolean, models: Record<string, string[]>, error?: string }`
  - Exportar `OPENCODE_MODELS_CHANNELS = { LIST_MODELS: "opencode-models:list" }`
  - Exportar `registerOpencodeModelsHandlers(ipcMain)`
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task 1.2:** Registrar el handler en `electron-main/src/ipc/index.ts`
  - Exportar `registerOpencodeModelsHandlers` y `OPENCODE_MODELS_CHANNELS` desde el barrel
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

- **Task 1.3:** Registrar en `src/electron/ipc-handlers.ts`
  - Importar `registerOpencodeModelsHandlers` y `OPENCODE_MODELS_CHANNELS` desde el barrel
  - Agregar `OPENCODE_MODELS_CHANNELS` al loop de `removeHandler` (idempotency guard)
  - Llamar `registerOpencodeModelsHandlers(ipcMain)` al final de `registerIpcHandlers()`
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.2

---

### 🔹 Phase 2: Bridge — Preload y tipos

**Description:**
Exponer el nuevo canal IPC en el preload y definir los tipos en bridge.types.ts.

**Tasks:**

- **Task 2.1:** Agregar tipos en `src/electron/bridge.types.ts`
  - Agregar `OpencodeModelsResult` interface: `{ ok: boolean, models: Record<string, string[]>, error?: string }`
  - Agregar canal `OPENCODE_MODELS_LIST: "opencode-models:list"` a `IPC_CHANNELS` (o mantenerlo separado como `OPENCODE_MODELS_CHANNELS` — seguir el patrón de `MODELS_API_CHANNELS`)
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

- **Task 2.2:** Exponer en `src/electron/preload.ts`
  - Agregar `window.opencodeModels` con `contextBridge.exposeInMainWorld`
  - Exponer: `listModels(): Promise<OpencodeModelsResult>`
  - Seguir el mismo patrón que `window.modelsApi`
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.1

- **Task 2.3:** Actualizar `src/vite-env.d.ts`
  - Declarar `opencodeModels` en la interfaz `Window`
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.2

---

### 🔹 Phase 3: Renderer — Servicio y Hook

**Description:**
Crear la capa de servicio y el hook React para consumir el listado CLI desde el renderer.

**Tasks:**

- **Task 3.1:** Crear `src/renderer/services/opencode-models.ts`
  - Wrapper tipado sobre `window.opencodeModels.listModels()`
  - Timeout de 20 segundos (el CLI puede tardar en arrancar)
  - Retornar `{ ok: false, models: {}, error }` si el bridge no está disponible
  - Seguir el mismo patrón que `src/renderer/services/models-api.ts`
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.2

- **Task 3.2:** Crear `src/renderer/hooks/useOpencodeModels.ts`
  - Hook React: `{ models, loading, error, refetch }`
  - `models`: `Record<string, string[]>` — mapa proveedor → lista de modelos
  - Llamar al servicio on-mount
  - Seguir el mismo patrón que `src/renderer/hooks/useModelsApi.ts`
  - **Assigned to:** Developer
  - **Dependencies:** Task 3.1

---

### 🔹 Phase 4: Lógica de Cruce y Tipos de Dominio

**Description:**
Definir los tipos del dominio del buscador y la función pura que cruza los datos del CLI con los datos de models.dev.

**Tasks:**

- **Task 4.1:** Crear `src/renderer/services/model-search-utils.ts`
  - Definir tipo `ModelSearchEntry`:
    ```ts
    interface ModelSearchEntry {
      provider: string;
      model: string;
      fullId: string;           // "provider/model"
      inputCostPer1M: number | null;   // USD por 1M tokens input
      outputCostPer1M: number | null;  // USD por 1M tokens output
      hasReasoning: boolean | null;
      contextWindow: number | null;    // tokens
      maxOutput: number | null;        // tokens
      hasExtendedInfo: boolean;        // false si no hay datos en models.dev
    }
    ```
  - Implementar `buildModelSearchEntries(cliModels, modelsDevData)`:
    - Para cada `provider/model` del CLI, buscar en `modelsDevData` por `id` o por `provider+model`
    - Extraer campos de costo, razonamiento y límites del JSON de models.dev
    - Si no hay match → `hasExtendedInfo: false`, todos los campos extendidos `null`
    - Retornar `ModelSearchEntry[]` ordenado por `provider` luego `model`
  - Implementar `filterModelEntries(entries, query)`:
    - Filtrar por cualquier campo visible: provider, model, costo (como string), razonamiento ("yes"/"no"), contexto
    - Case-insensitive, trim del query
    - Query vacío → retornar todos
  - **Assigned to:** Developer
  - **Dependencies:** ninguna (función pura)

---

### 🔹 Phase 5: Componente UI — ModelSearchPanel

**Description:**
Crear el componente principal del buscador, diseñado para ser embebido en `SelectModelModal`.

**Tasks:**

- **Task 5.1:** Crear `src/ui/components/ModelSearchPanel.tsx`
  - Props:
    ```ts
    interface ModelSearchPanelProps {
      onSelectModel: (modelId: string) => void;  // "provider/model"
      initialQuery?: string;
    }
    ```
  - Internamente usa `useOpencodeModels()` y `useModelsApi()`
  - Cruza los datos con `buildModelSearchEntries()`
  - Filtra con `filterModelEntries()` reactivo al input
  - **Estados de UI:**
    - `loading` (cualquiera de los dos hooks cargando): spinner + "Loading models..."
    - `error` (CLI falló): banner de error con mensaje + botón "Retry"
    - `empty` (sin resultados para el query): "No models found for '{query}'"
    - `no-cli` (CLI no disponible / opencode no instalado): mensaje específico
    - `ready`: tabla de resultados
  - **Columnas de la tabla:**
    - Provider
    - Model
    - Input cost (USD/1M tokens, o "—" si null)
    - Output cost (USD/1M tokens, o "—" si null)
    - Reasoning (✓ / ✗ / "—" si null)
    - Context (tokens formateados, o "—" si null)
    - Max output (tokens formateados, o "—" si null)
  - Click en fila → llama `onSelectModel(entry.fullId)`
  - **Assigned to:** Developer
  - **Dependencies:** Tasks 3.2, 4.1

- **Task 5.2:** Crear `src/ui/styles/model-search-panel.css` (o agregar al CSS existente)
  - Estilos para el panel, input de búsqueda, tabla, estados de UI
  - Consistente con el design system existente (modal, colores, tipografía)
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.1

---

### 🔹 Phase 6: Integración en SelectModelModal

**Description:**
Conectar `ModelSearchPanel` dentro del `SelectModelModal` existente y manejar la selección del modelo en el store/agente activo.

**Tasks:**

- **Task 6.1:** Modificar `src/ui/components/SelectModelModal.tsx`
  - Importar `ModelSearchPanel`
  - Reemplazar el placeholder `children` por `<ModelSearchPanel onSelectModel={handleSelectModel} />`
  - Implementar `handleSelectModel(modelId)`:
    - Actualizar el agente activo en el store con el modelo seleccionado
    - Cerrar el modal (`onClose()`)
  - Mantener la prop `children` como override opcional (para tests/extensibilidad)
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.1

- **Task 6.2:** Verificar integración con `PropertiesPanel.tsx`
  - Confirmar que el botón "Select Model" ya abre `SelectModelModal` correctamente
  - Si no, agregar el estado `open` y el handler en `PropertiesPanel`
  - **Assigned to:** Developer
  - **Dependencies:** Task 6.1

---

### 🔹 Phase 7: Tests

**Description:**
Cubrir las piezas críticas con tests unitarios.

**Tasks:**

- **Task 7.1:** Tests para `electron-main/src/ipc/opencode-models.ts`
  - Mock de `spawn` para simular output del CLI
  - Casos: output válido, output vacío, proceso falla, timeout
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

- **Task 7.2:** Tests para `src/renderer/services/model-search-utils.ts`
  - `buildModelSearchEntries`: con datos completos, sin datos de models.dev, parciales
  - `filterModelEntries`: por provider, por model, por costo, por razonamiento, query vacío
  - **Assigned to:** Developer
  - **Dependencies:** Task 4.1

- **Task 7.3:** Tests para `ModelSearchPanel`
  - Estados de UI: loading, error, empty, ready
  - Filtrado reactivo
  - Callback `onSelectModel` al hacer click
  - **Assigned to:** Developer
  - **Dependencies:** Task 5.1

---

## ⚠️ Risks

- **CLI no instalado:** `opencode` puede no estar en PATH. El handler debe capturar `ENOENT` y retornar `{ ok: false, error: "opencode CLI not found" }`. El UI debe mostrar un mensaje específico y accionable.
- **Output del CLI cambia:** El parser debe ser tolerante a líneas inesperadas (ignorar lo que no matchee `proveedor/modelo`).
- **Estructura de models.dev JSON:** El JSON de models.dev puede cambiar su schema. El cruce debe ser defensivo (acceso con optional chaining, fallback a null).
- **Doble carga asíncrona:** Los dos hooks (`useOpencodeModels` + `useModelsApi`) cargan en paralelo. El componente debe mostrar loading hasta que AMBOS terminen.
- **Windows PATH:** En Windows, el CLI puede llamarse `opencode.exe` o estar en un PATH diferente. Usar `process.platform === "win32"` para ajustar el comando.

---

## 📝 Notes

- El cruce de datos ocurre en el **renderer** (no en el main process) porque es lógica de presentación y no requiere acceso a filesystem.
- El campo `model` en models.dev puede estar bajo diferentes keys según el proveedor. Revisar la estructura real del JSON antes de implementar el cruce (ver `models/api/models.dev.json` si ya fue descargado).
- El componente `ModelSearchPanel` es **stateless respecto al agente** — recibe `onSelectModel` como callback, no sabe nada del store. Esto lo hace reutilizable y testeable.
- La selección del modelo debe persistirse en el `.adata` del agente (campo `model` o similar). Verificar el schema de `.adata` antes de implementar Task 6.1.
- Seguir el patrón de `registerModelsApiHandlers` para el nuevo handler: inyección de deps para testabilidad, nunca importar `ipcMain` directamente en el módulo del handler.
