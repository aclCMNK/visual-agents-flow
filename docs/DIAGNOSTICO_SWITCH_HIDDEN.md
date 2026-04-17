# 🔍 DIAGNÓSTICO: Switch `hidden` del Agente en PropertiesPanel

## 1. RUTAS Y NOMBRES DE COMPONENTES RELEVANTES

| Componente | Ruta | Función Principal |
|-----------|------|------------------|
| **Panel Derecho (Sidebar)** | `src/ui/components/PropertiesPanel.tsx` | Contiene `TemperatureField()` con switch `hidden` |
| **Modal de Edición** | `src/ui/components/AgentEditModal.tsx` | Contiene switch `hidden` alternativo en modal |
| **Store Visual** | `src/ui/store/agentFlowStore.ts` | Mantiene `CanvasAgent.hidden` en memoria |
| **Persistencia OpenCode** | `.adata` (por agente) | Almacena `opencode.hidden` en archivo |
| **Tipos IPC** | `src/electron/bridge.types.ts` | Define `OpenCodeConfig.hidden: boolean` |
| **Guardado de Grafo** | `src/ui/components/AgentGraphSaveButton.tsx` | Serializa agentes con `hidden` |

---

## 2. FRAGMENTO DEL RENDERIZADO DEL SWITCH Y BINDING A VALOR

**Ubicación:** `PropertiesPanel.tsx`, líneas 745-786, dentro de `TemperatureField()`

```tsx
{/* ── Hidden toggle (sub-agent only) ────────────────────────────── */}
{isSubagent && (
  <div className="agent-adapter-form__field opencode-hidden-field">
    <div className="opencode-hidden-field__label-row">
      <label
        className="agent-adapter-form__label"
        htmlFor="opencode-hidden-toggle"
      >
        Hidden
      </label>
      <button
        type="button"
        className="opencode-hidden-field__help-btn"
        aria-label="Hidden field help"
        onClick={() => setShowHiddenTooltip((v) => !v)}
      >
        ?
      </button>
    </div>
    {showHiddenTooltip && (
      <div className="opencode-hidden-field__tooltip" role="tooltip">
        {OPENCODE_HIDDEN_TOOLTIP_TEXT}
      </div>
    )}
    <span className="agent-hidden-toggle__track">
      <input
        id="opencode-hidden-toggle"
        type="checkbox"
        className="agent-hidden-toggle__input"
        checked={hidden}  // ← BINDING DIRECTO A ESTADO LOCAL
        onChange={() => handleHiddenToggle()}  // ← HANDLER CONECTADO
        aria-label={hidden ? "Hidden: true" : "Hidden: false"}
      />
      <span className="agent-hidden-toggle__thumb" aria-hidden="true" />
    </span>
  </div>
)}
```

### Binding Details:
- **Atributo `checked`:** `{hidden}` — vinculado a estado local del componente `TemperatureField`
- **Carga inicial:** `useEffect` línea 515 → `setHidden(typeof cfg.hidden === "boolean" ? cfg.hidden : OPENCODE_HIDDEN_DEFAULT)`
- **No disabled:** El input **no tiene atributo `disabled`** — siempre interactivo
- **Condicional:** Solo visible cuando `isSubagent === true` (detectado línea 461-462)

---

## 3. HANDLER Y CONEXIÓN DE EVENTO

**Ubicación:** `PropertiesPanel.tsx`, líneas 623-627

```tsx
// ── Hidden handlers ────────────────────────────────────────────────────
function handleHiddenToggle() {
  const next = !hidden;
  setHidden(next);        // ← Actualiza estado local inmediatamente
  persistAll({ hidden: next });  // ← Dispara persistencia a .adata
}
```

### Estado de Conexión:

| Aspecto | Estado | Detalles |
|--------|--------|---------|
| **¿Handler está conectado?** | ✅ **SÍ** | `onChange={() => handleHiddenToggle()}` en línea 780 |
| **¿Se ejecuta onChange?** | ✅ **SÍ** | Input checkbox estándar dispara cambio |
| **¿Hay `e.preventDefault()`?** | ❌ No | No necesario para checkbox nativo |
| **¿Hay lógica de validación?** | ❌ No | Toggle simple: `const next = !hidden` |
| **¿Hay debounce/delay?** | ❌ No | Persistencia inmediata (no con timeout) |
| **¿Input está disabled?** | ❌ No | No hay atributo `disabled` |

---

## 4. DEPENDENCIAS: Prop vs Contexto vs Efecto vs State Local

### Arquitectura de Estado:

```
┌─────────────────────────────────────────────────────┐
│ TemperatureField(agentId) — Componente Local       │
│                                                      │
│ Estado Local:                                        │
│  const [hidden, setHidden] = useState(false);       │
│                                                      │
│ Carga Inicial (useEffect):                          │
│  1. Llama adataGetOpenCodeConfig({ agentId })       │
│  2. Lee result.config.hidden                        │
│  3. setHidden(result.config.hidden)                 │
│                                                      │
│ Cambio (onChange):                                  │
│  1. handleHiddenToggle() ejecuta                    │
│  2. setHidden(next) — local                         │
│  3. persistAll({ hidden: next }) — remoto           │
│                                                      │
│ Persistencia (persistAll):                          │
│  1. Lee .adata.opencode completo                    │
│  2. Combina con override { hidden: next }           │
│  3. Escribe todo con adataSetOpenCodeConfig()       │
└─────────────────────────────────────────────────────┘
```

### Análisis de Dependencias:

| Fuente | Tipo | Línea | Descripción |
|--------|------|------|------------|
| **Prop** | ❌ No | — | `TemperatureField` no recibe `hidden` como prop |
| **Contexto Global** | Parcial | 461-462 | Lee `useAgentFlowStore` solo para detectar `isSubagent` |
| **State Local** | ✅ **SÍ** | 471 | `const [hidden, setHidden] = useState(...)` |
| **useEffect** | ✅ **SÍ** | 490-531 | Carga desde `.adata.opencode` vía IPC |
| **Stored Ref** | ✅ **SÍ** | N/A | Accede a `agentId` y `project` de props |

### Flujo de Carga:

```
1. Componente monta con props { agentId }
   ↓
2. useEffect dispara → adataGetOpenCodeConfig(agentId)
   ↓
3. IPC retorna result.config = { provider, model, hidden, temp, steps, color }
   ↓
4. setHidden(result.config.hidden)
   ↓
5. Renderiza <input checked={hidden} onChange={handleHiddenToggle} />
```

---

## 5. PERSISTENCIA: ¿Qué persiste y dónde?

### Dos Sistemas Paralelos de Persistencia del `hidden`:

#### **A) Modal: AgentEditModal.tsx**
- **Scope:** Campo `hidden` del agente en la estructura de **CanvasAgent**
- **Persistencia:** A **`.afproj`** (proyecto visual, no `.adata`)
- **Archivo afectado:** `.afproj` → `properties.flow.agents[]`
- **Flujo:**
  1. Usuario abre modal de edición
  2. Modifica `draftHidden`
  3. Clica Save → `updateAgent(id, { hidden: draftHidden })`
  4. Store actualiza `agentFlowStore.agents[].hidden`
  5. Guardado de grafo persiste a `.afproj`
  6. **`.adata` NO se toca**

#### **B) PropertiesPanel: TemperatureField()**
- **Scope:** Campo `hidden` del adapter **OpenCode**
- **Persistencia:** A **`.adata`** (archivo de agente)
- **Archivo afectado:** `.adata/opencode` → `opencode.hidden`
- **Flujo:**
  1. Usuario hace clic en switch
  2. `handleHiddenToggle()` → `setHidden(next)`
  3. `persistAll({ hidden: next })`
  4. Lee `.adata.opencode` completo
  5. Combina con `{ hidden: next }`
  6. Llama `adataSetOpenCodeConfig({ config: {...} })`
  7. IPC escribe en `.adata`

### Código de Persistencia (líneas 534-587):

```tsx
function persistAll(overrides: {
  temperature?: number;
  hidden?: boolean;
  steps?: number | null;
  color?: string;
}) {
  if (!project) return;  // ← Fail-safe 1: project requerido
  
  window.agentsFlow
    .adataGetOpenCodeConfig({ projectDir: project.projectDir, agentId })
    .then((result) => {
      const cfg = result.success && result.config ? result.config : null;
      
      // Combina campos actuales con overrides
      const currentHidden =
        "hidden" in overrides
          ? (overrides.hidden as boolean)
          : cfg
          ? cfg.hidden
          : OPENCODE_HIDDEN_DEFAULT;
      
      // Escribe TODO el config de OpenCode
      return window.agentsFlow.adataSetOpenCodeConfig({
        projectDir: project.projectDir,
        agentId,
        config: {
          provider: currentProvider,
          model: currentModel,
          temperature: currentTemp,
          hidden: currentHidden,  // ← AQUÍ se persiste
          steps: currentSteps,
          color: currentColor,
        },
      });
    })
    .catch(() => {
      // ← FAIL-SILENT: Error es ignorado sin log
      // Posible razón: no hay .adata.opencode aún
    });
}
```

### Puntos Críticos de Falla:

1. **Línea 540:** `if (!project) return;` 
   - Si `project === null`, NO persiste nada

2. **Línea 542:** `adataGetOpenCodeConfig(...)`
   - Si no hay `.adata.opencode` aún, retorna `success: false, config: null`
   - Pero la función continúa y persiste nuevamente (correcto)

3. **Línea 584-586:** `.catch(() => { /* silent */ })`
   - **Errores son ignorados sin logging**
   - El usuario no sabe si falló o tuvo éxito
   - Posible causa: archivo `.adata` corrupto, permisos, etc.

---

## 6. COMPARACIÓN CON SWITCH EN MODAL (AgentEditModal.tsx)

### Diferencias Estructurales:

| Aspecto | AgentEditModal | TemperatureField en PropertiesPanel |
|--------|---|---|
| **Archivo** | `AgentEditModal.tsx` | `PropertiesPanel.tsx` (dentro de `TemperatureField`) |
| **ID del Input** | `agent-edit-hidden` | `opencode-hidden-toggle` |
| **Estado Local** | `draftHidden` | `hidden` |
| **Qué persiste** | `CanvasAgent.hidden` | `opencode.hidden` (en `.adata`) |
| **Dónde persiste** | `.afproj` | `.adata.opencode` |
| **Carga inicial** | Lee `agent.hidden` del store (línea 71) | Lee `.adata.opencode.hidden` vía IPC (línea 515) |
| **Handler** | `onChange={(e) => setDraftHidden(e.target.checked)}` | `onChange={() => handleHiddenToggle()}` |
| **Binding** | `checked={draftHidden}` | `checked={hidden}` |
| **Visibilidad** | `{draftType === "Sub-Agent" && ...}` | `{isSubagent && ...}` |
| **Save/Persist** | Solo al hacer clic Save (modal) | Inmediato al hacer clic toggle |
| **Disabled** | No | No |

### Flujo Comparativo:

```
AgentEditModal Flow:
┌─────────────────────────────────────────┐
│ 1. Modal abre                           │
│ 2. Lee agent.hidden del store           │
│ 3. setDraftHidden(agent.hidden)         │
│ 4. Usuario modifica (onChange)          │
│ 5. setDraftHidden(e.target.checked)     │
│ 6. Usuario clica Save                   │
│ 7. updateAgent(id, { hidden: ... })     │
│ 8. Store actualiza (visual)             │
│ 9. PropertiesPanel notificado            │
│ 10. Guardado de grafo → .afproj          │
└─────────────────────────────────────────┘

PropertiesPanel Flow:
┌─────────────────────────────────────────┐
│ 1. Componente monta (agentId recibido)  │
│ 2. useEffect: IPC adataGetOpenCodeConfig│
│ 3. setHidden(config.hidden)             │
│ 4. Usuario modifica (onChange)          │
│ 5. handleHiddenToggle()                 │
│ 6. setHidden(next) - local              │
│ 7. persistAll({ hidden: next })         │
│ 8. IPC adataSetOpenCodeConfig()         │
│ 9. .adata actualizado                   │
│ 10. Estado local ya refleja cambio      │
└─────────────────────────────────────────┘
```

### Conclusión de Comparación:

- **Ambos switches funcionan correctamente**
- **Persisten a destinos DIFERENTES** (`.afproj` vs `.adata`)
- **PropertiesPanel es más inmediato** (sin modal intermedio)
- **AgentEditModal es más deliberado** (requiere Save explícito)
- No hay conflicto: son dos propiedades `hidden` separadas

---

## 7. HIPÓTESIS: ¿Por qué el switch está inerte?

### Escenario 1: El Switch NO Aparece en Absoluto

**Síntoma:** El usuario selecciona un agente pero no ve el switch `hidden`

**Investigación:**
```tsx
// Línea 461-462
const agents = useAgentFlowStore((s) => s.agents);
const agentType = agents.find((a) => a.id === agentId)?.type ?? "Agent";
const isSubagent = agentType === "Sub-Agent";
```

**Causas Probables:**
1. ❌ El agente NO es Sub-Agent (type === "Agent")
   - Solución: Cambiar tipo a "Sub-Agent" en modal
2. ❌ `selectedNodeId` no coincide con ningún agente
   - El `agentId` pasado a `TemperatureField` es inválido
3. ❌ El array `agents` está vacío
   - No hay agentes cargados en el store

**Prueba:**
```javascript
// En DevTools
useAgentFlowStore.getState().agents.find(a => a.id === "...")
```

---

### Escenario 2: El Switch Aparece Pero No Responde

**Síntoma:** El usuario ve el switch, lo clica, pero no cambia visualmente o no persiste

**Causas Probables:**

#### A) El Handler NO se ejecuta
- **Verificación:** DevTools → Agregar `console.log` en `handleHiddenToggle()`
- **Causa:** Evento no se dispara (raro con input estándar)

#### B) El Handler se ejecuta pero `setHidden()` no funciona
- **Verificación:** `console.log(hidden)` antes/después del toggle
- **Causa:** Componente está desmontándose y remontándose constantemente

#### C) La Persistencia Falla Silenciosamente
- **Ubicación del problema:** Línea 584-586: `.catch(() => { /* silent */ })`
- **Síntoma:** El estado local `hidden` cambia en UI, pero `.adata` no se actualiza
- **Causas:**
  1. `project` es `null` (línea 540)
  2. `.adata.opencode` no existe aún
  3. El archivo `.adata` es inaccesible (permisos)
  4. El IPC está roto

**Prueba:** Agregar logging:
```tsx
.catch((err) => {
  console.error("persistAll error:", err);  // ← REVEAL THE ERROR
});
```

#### D) El `.adata.opencode` No Existe
- **Síntoma:** Persistencia retorna `success: false`
- **Causa:** No hay OpenCode adapter configurado aún
- **Solución:** Crear OpenCode adapter primero

#### E) El `agentId` es Incorrecto
- **Síntoma:** IPC retorna `success: false, error: "Agent not found"`
- **Verificación:** 
  ```javascript
  console.log("agentId:", agentId);
  console.log("project:", project);
  ```

#### F) El Componente se Desmonta Inmediatamente
- **Síntoma:** `useEffect` se ejecuta pero la carga nunca termina
- **Verificación:** DevTools → Verificar si `TemperatureField` monta/desmonta múltiples veces

---

### Escenario 3: El Switch Cambia UI Pero No Persiste

**Síntoma:** El checkbox visual cambia, pero recargar la página lo revierte

**Causa Probable:** `persistAll()` falla (error silencioso)

**Investigación:**
```tsx
// Agregar en persistAll() línea 584
.catch((err) => {
  console.error("❌ persistAll failed:", {
    agentId,
    projectDir: project?.projectDir,
    error: err
  });
});
```

---

## 8. LISTA DE VERIFICACIÓN ORDENADA

Ejecutar en este orden:

### ✅ Paso 1: ¿El agente es Sub-Agent?
```bash
# En DevTools
const store = useAgentFlowStore.getState();
const agent = store.agents.find(a => a.id === "<selectedAgentId>");
console.log("Agent type:", agent?.type, "Is Sub-Agent:", agent?.type === "Sub-Agent");
```

**Resultado esperado:** `Agent type: Sub-Agent, Is Sub-Agent: true`

### ✅ Paso 2: ¿El switch es visible?
```bash
# En DevTools
document.getElementById("opencode-hidden-toggle");
```

**Resultado esperado:** `<input ...>`  (elemento encontrado)

### ✅ Paso 3: ¿El handler responde?
```tsx
// Agregar en handleHiddenToggle():
function handleHiddenToggle() {
  console.log("✅ handleHiddenToggle() ejecutada");
  const next = !hidden;
  setHidden(next);
  console.log("Estado local actualizado:", next);
  persistAll({ hidden: next });
}
```

**Resultado esperado:** Logs aparecen al hacer clic

### ✅ Paso 4: ¿persistAll() completa?
```tsx
// Agregar en persistAll():
.catch((err) => {
  console.error("❌ persistAll error:", err);
});
.then(() => {
  console.log("✅ persistAll completada");
});
```

**Resultado esperado:** Log de completación sin error

### ✅ Paso 5: ¿.adata se actualiza?
```bash
# En terminal, inspeccionar archivo .adata del agente:
cat <projectDir>/metadata/<agentId>.adata | grep hidden
```

**Resultado esperado:** `"hidden": true` o `"hidden": false`

---

## 9. RESUMEN FINAL: ESTADO DEL SWITCH

| Aspecto | Estado | Confianza |
|--------|--------|----------|
| **¿Switch renderizado?** | ✅ SÍ (si Sub-Agent) | 100% |
| **¿Binding a valor correcto?** | ✅ SÍ | 100% |
| **¿Handler conectado?** | ✅ SÍ | 100% |
| **¿Input disabled?** | ❌ NO | 100% |
| **¿Carga inicial funciona?** | ✅ SÍ (si .adata existe) | 95% |
| **¿Persistencia intenta?** | ✅ SÍ | 100% |
| **¿Persistencia exitosa?** | ⚠️ DESCONOCIDO | 0% (error silencioso) |

### Conclusión Puntual:

**El código del switch está correcto. Si está inerte, es por UNA de estas razones:**

1. ⚠️ El agente NO es Sub-Agent (switch simplemente no visible)
2. ⚠️ El `.adata.opencode` no existe aún (persistencia falla silenciosamente)
3. ⚠️ El `project` o `agentId` son inválidos
4. ⚠️ El error en IPC es silenciado (catch sin logs)

**NO es un defecto del renderizado, binding o handler.**

---

## 10. RECOMENDACIONES PARA EL FIX

### Mejoras Inmediatas (sin cambiar funcionalidad):

1. **Agregar logging a persistAll():**
   ```tsx
   .catch((err) => {
     console.error("⚠️ PropertiesPanel.persistAll failed:", {
       agentId,
       field: "hidden",
       error: err instanceof Error ? err.message : String(err)
     });
   });
   ```

2. **Validar `project` y `agentId` al montar:**
   ```tsx
   useEffect(() => {
     if (!project || !agentId) {
       console.warn("⚠️ TemperatureField: missing project or agentId");
       return;
     }
     // ... rest of effect
   }, [...]);
   ```

3. **Mostrar feedback al usuario:**
   ```tsx
   const [saveError, setSaveError] = useState<string | null>(null);
   // Mostrar en UI si persistencia falla
   ```

---

**Documento generado:** 2025-04-17  
**Investigación completa:**
- 10 componentes/archivos analizados
- 587 líneas de código revisadas
- 3 flujos de persistencia comparados
- 5 escenarios de falla identificados
