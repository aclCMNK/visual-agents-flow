# Exploration: Metadata Loss on Save Agent Graph

## Executive Summary

**Problem**: Cuando el usuario hace clic en el botón "Save" global (arriba a la derecha del editor), los metadatos avanzados del agente (especialmente **permisos, skills, aspects**) se pierden del archivo `.adata`, particularmente del orquestador.

**Root Cause**: El flujo de guardado está fragmentado en dos operaciones IPC completamente desacopladas:
1. **`SAVE_AGENT_GRAPH`** (botón "Save" global) — serializa solo campos básicos de UI (id, name, description, type, isOrchestrator)
2. **`ADATA_SET_PERMISSIONS`** (botón "Save" dentro del modal de permisos) — es un endpoint **separado** que solo actualiza permisos

El problema: `SAVE_AGENT_GRAPH` **NO preserva** skills, aspects, permisos durante el guardado, aunque SÍ intenta preservarlos leyendo el `.adata` existente (línea 716-724 de `ipc-handlers.ts`).

---

## Current State: How Save Works Today

### 1. Global Save Button (App.tsx, línea 172)

```tsx
<AgentGraphSaveButton />
```

Ubicado en la topbar del editor, junto a Assets, Validation, Export JSON.

### 2. AgentGraphSaveButton Flow (AgentGraphSaveButton.tsx, líneas 66-123)

**Serialización del estado UI:**
```typescript
const agentNodes: AgentGraphNode[] = agents.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  type: a.type,
  isOrchestrator: a.isOrchestrator,
  hidden: a.type === "Sub-Agent" ? a.hidden : false,
  x: a.x,
  y: a.y,
}));
```

**⚠️ PROBLEMA**: Solo 8 campos. **NO incluye**:
- `aspects`
- `skills`
- `subagents`
- `permissions`
- `profile` (lista de profiles de agent)
- `metadata`

Luego llama:
```typescript
const result = await bridge.saveAgentGraph(req);
```

### 3. IPC Handler: SAVE_AGENT_GRAPH (ipc-handlers.ts, líneas 613-793)

**Paso 5 - Crear/actualizar .adata (líneas 710-766):**

```typescript
for (const node of req.agents) {
  const adataPath = join(metadataDir, `${node.id}.adata`);

  // ✅ Intenta preservar existing data
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(adataPath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist yet
  }

  const adata: Record<string, unknown> = {
    version: 1,
    agentId: node.id,
    agentName: node.name,
    description: node.description,
    aspects: (existing.aspects as unknown[]) ?? [],           // ✅ Preserva
    skills: (existing.skills as unknown[]) ?? [],             // ✅ Preserva
    subagents: (existing.subagents as unknown[]) ?? [],       // ✅ Preserva
    profilePath: ...,
    profile: (existing.profile as unknown[]) ?? [],           // ✅ Preserva
    metadata: {
      ...((existing.metadata as Record<string, unknown>) ?? {}),  // ✅ Preserva
      agentType: node.type,
      isOrchestrator: String(node.isOrchestrator),
      hidden: node.type === "Sub-Agent" ? String(node.hidden) : "false",
    },
    createdAt: (existing.createdAt as string) ?? now,
    updatedAt: now,
  };

  // ❌ PERO: NO preserva `permissions` aquí
  await atomicWriteJson(adataPath, adata);
}
```

**HALLAZGO CRÍTICO (línea 741-750)**:
```typescript
metadata: {
  ...((existing.metadata as Record<string, unknown>) ?? {}),
  agentType: node.type,
  isOrchestrator: String(node.isOrchestrator),
  hidden: node.type === "Sub-Agent" ? String(node.hidden) : "false",
},
```

No hay preservación de `permissions`. El objeto `.adata` construido **NO incluye la propiedad `permissions`** aunque exista en `existing.permissions`.

---

## Affected Areas (Paths Sospechosos)

| Archivo | Línea | Problema |
|---------|-------|----------|
| `src/ui/components/AgentGraphSaveButton.tsx` | 78-87 | Serializa solo 8 campos de UI; omite metadatos avanzados |
| `src/electron/ipc-handlers.ts` | 726-750 | Constructor de `.adata`: preserva aspects/skills/profile pero **NO permissions** |
| `src/electron/ipc-handlers.ts` | 741-747 | Metadata merge: no incluye permisos |
| `src/ui/store/agentFlowStore.ts` | 108-131 | `CanvasAgent`: tipo no incluye permisos/skills/aspects |
| `src/electron/bridge.types.ts` | (need to check) | `SaveAgentGraphRequest` / `AgentGraphNode`: solo campos visuales |

---

## Why Permissions Are Lost

### Arquitectura Actual:

```
┌─ UI STATE ─────────────────────┐
│  agentFlowStore.agents[]       │
│  (CanvasAgent[])               │
│  - id, name, description       │
│  - type, isOrchestrator, x, y  │
│  ❌ NO permisos                │
│  ❌ NO skills                  │
└────────────────────────────────┘
           │
           ├→ AgentGraphSaveButton.tsx
           │   serializa 8 campos básicos
           │
           v
┌─ IPC SAVE_AGENT_GRAPH ────────┐
│  req.agents[]                  │
│  (AgentGraphNode[])            │
│  - solo 8 campos               │
└────────────────────────────────┘
           │
           ├→ ipc-handlers.ts (línea 713-766)
           │   Lee existing .adata
           │   Crea nuevo .adata
           │   ❌ Omite existing.permissions
           │
           v
┌─ DISCO (.adata) ───────────────┐
│  {                              │
│    "version": 1,                │
│    "agentId": "...",            │
│    "agentName": "...",          │
│    "description": "...",        │
│    "aspects": [...],   ✅       │
│    "skills": [...],    ✅       │
│    "subagents": [...], ✅       │
│    "profile": [...],   ✅       │
│    "metadata": {...},  ✅       │
│    "permissions": ??? ❌        │
│  }                              │
└─────────────────────────────────┘
```

### Flujo de Permisos (separado):

```
┌─ Permissions Modal ────────────┐
│  window.agentsFlow             │
│  .adataSetPermissions(...)     │
└────────────────────────────────┘
           │
           v
┌─ IPC ADATA_SET_PERMISSIONS ───┐
│  (permissions-handlers.ts)     │
│  Lee existing .adata           │
│  Merge permissions             │
│  Escribe .adata completo       │
│  ✅ Incluye permissions        │
└────────────────────────────────┘
```

**Problema**: Si el usuario:
1. Define permisos en el modal ✅
2. Click "Save" (en el modal) ✅ → permisos guardados
3. Luego edita el agente (nombre, tipo, etc.) en la canvas
4. Click "Save" global (botón arriba a la derecha) ❌ → **permisos se pierden** porque el nuevo `.adata` creado no incluye permisos

---

## Technical Hypothesis: Why Permissions Are Lost

### Escenario de Recaída:

1. **Estado inicial**:
   ```json
   {
     "agentId": "orch-123",
     "permissions": { "Bash": { "run": "allow" } }
   }
   ```

2. Usuario define permisos en PermissionsModal → se guardan ✅

3. Usuario edita nombre del orquestador en canvas (activa `isDirty`) → click "Save"

4. `AgentGraphSaveButton` llama `saveAgentGraph`:
   ```typescript
   const req = {
     agents: [{
       id: "orch-123",
       name: "new-name",      // ← Cambió
       description: "...",
       type: "Agent",
       isOrchestrator: true,
       // ❌ NO permissions field
     }]
   };
   ```

5. **ipc-handlers.ts línea 726-750** construye nuevo `.adata`:
   ```typescript
   const adata = {
     agentId: "orch-123",
     agentName: "new-name",
     description: "...",
     aspects: (existing.aspects as unknown[]) ?? [],  // ✅ Preserva
     skills: (existing.skills as unknown[]) ?? [],    // ✅ Preserva
     // ❌ FALTA: permissions: (existing.permissions as unknown[]) ?? [],
     metadata: {...},
   };
   ```

6. Se escribe el `.adata` **sin la propiedad `permissions`** aunque `existing.permissions` existe 😱

---

## Code Audit Trail

### Archivo 1: AgentGraphSaveButton.tsx

**Línea 78-87** (serialización):
```typescript
const agentNodes: AgentGraphNode[] = agents.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  type: a.type,
  isOrchestrator: a.isOrchestrator,
  hidden: a.type === "Sub-Agent" ? a.hidden : false,
  x: a.x,
  y: a.y,
}));
```

❌ **No incluye**: permisos, skills, aspects

### Archivo 2: ipc-handlers.ts

**Línea 716-724** (lectura de existing):
```typescript
let existing: Record<string, unknown> = {};
try {
  const raw = await readFile(adataPath, "utf-8");
  existing = JSON.parse(raw) as Record<string, unknown>;
} catch {
  // File doesn't exist yet — start fresh
}
```

✅ Lee el archivo existente (que SÍ tiene permisos)

**Línea 726-750** (construcción del nuevo .adata):
```typescript
const adata: Record<string, unknown> = {
  version: 1,
  agentId: node.id,
  agentName: node.name,
  description: node.description,
  aspects: (existing.aspects as unknown[]) ?? [],
  skills: (existing.skills as unknown[]) ?? [],
  subagents: (existing.subagents as unknown[]) ?? [],
  profilePath: ...,
  profile: (existing.profile as unknown[]) ?? [],
  metadata: {
    ...((existing.metadata as Record<string, unknown>) ?? {}),
    agentType: node.type,
    isOrchestrator: String(node.isOrchestrator),
    hidden: node.type === "Sub-Agent" ? String(node.hidden) : "false",
  },
  createdAt: (existing.createdAt as string) ?? now,
  updatedAt: now,
};
```

❌ **FALTA**: `permissions: (existing.permissions as unknown[]) ?? []`

**Línea 752** (escritura):
```typescript
await atomicWriteJson(adataPath, adata);
```

Escribe el `.adata` sin permisos.

---

## Audit Points & Recommendations

### 🔴 Critical Path Weaknesses

| # | Punto | Severidad | Recomendación |
|---|-------|-----------|--------------|
| 1 | `AgentGraphSaveButton` omite metadatos avanzados en serialización | HIGH | Expandir `AgentGraphNode` type para incluir todos los campos relevantes, O mejor aún, cambiar el enfoque: guardar metadatos en etapa separada |
| 2 | `SAVE_AGENT_GRAPH` handler NO preserva `permissions` al escribir `.adata` | CRITICAL | Agregar línea: `permissions: (existing.permissions as unknown[]) ?? []` en construcción de `adata` |
| 3 | No hay sincronización entre UI state y metadatos en disco | HIGH | Considerar cargar permisos/skills en `agentFlowStore` para mantener consistencia |
| 4 | Flujo fragmentado: dos IPC calls independientes para graph vs permisos | MEDIUM | Considerar unificar o coordinar mejor |
| 5 | Test coverage: ¿Se prueban permiso+save+edit cycle? | HIGH | Faltan tests de integración |

---

## Proposed Fixes

### Fix 1: Preservar Permissions en SAVE_AGENT_GRAPH (CRÍTICO)

**Archivo**: `src/electron/ipc-handlers.ts`
**Línea**: ~750 (dentro del constructor de `adata`)

**Antes**:
```typescript
const adata: Record<string, unknown> = {
  version: 1,
  agentId: node.id,
  agentName: node.name,
  description: node.description,
  aspects: (existing.aspects as unknown[]) ?? [],
  skills: (existing.skills as unknown[]) ?? [],
  subagents: (existing.subagents as unknown[]) ?? [],
  profilePath: ...,
  profile: (existing.profile as unknown[]) ?? [],
  metadata: {...},
  createdAt: (existing.createdAt as string) ?? now,
  updatedAt: now,
};
```

**Después**:
```typescript
const adata: Record<string, unknown> = {
  version: 1,
  agentId: node.id,
  agentName: node.name,
  description: node.description,
  aspects: (existing.aspects as unknown[]) ?? [],
  skills: (existing.skills as unknown[]) ?? [],
  subagents: (existing.subagents as unknown[]) ?? [],
  permissions: (existing.permissions as Record<string, unknown>) ?? undefined, // ADD THIS
  profilePath: ...,
  profile: (existing.profile as unknown[]) ?? [],
  metadata: {...},
  createdAt: (existing.createdAt as string) ?? now,
  updatedAt: now,
};
```

**Notas**:
- `permissions` es opcional en `.adata` (no requerido por schema)
- Solo incluir si existe: `undefined ?? null` se omite en JSON
- O mejor aún, usar: `...(existing.permissions ? { permissions: existing.permissions } : {})`

### Fix 2: Auditar otros campos que podrían perderse

**Campos que ya se preservan**: aspects, skills, subagents, profile, metadata
**Campos que podrían perderse**: permissions, y otros top-level fields que no estamos serializa ndo

**Acción**: Revisitar el schema de `.adata` (adata.schema.ts) y la construcción de `adata` para asegurar todos los campos se preservan.

### Fix 3: Añadir punto de auditoría en el proceso de guardado

**Ubicación**: `ipc-handlers.ts`, después de línea 752 (post-write)

```typescript
await atomicWriteJson(adataPath, adata);

// AUDIT POINT: Log what was preserved/lost
if (existing.permissions && !adata.permissions) {
  console.warn(`[AUDIT] Agent ${node.id}: permissions were lost during save!`);
}
if (existing.skills?.length && !adata.skills?.length) {
  console.warn(`[AUDIT] Agent ${node.id}: skills were lost during save!`);
}
// ... similar checks for aspects, profile, etc.
```

---

## Test Coverage Gap

### Missing Integration Test

```typescript
// tests/electron/save-agent-graph-preserves-metadata.test.ts

describe("SAVE_AGENT_GRAPH preserves permissions", () => {
  it("should preserve permissions when editing agent name", async () => {
    // Setup: Create .adata with permissions
    const adataPath = "metadata/agent-123.adata";
    const existingData = {
      agentId: "agent-123",
      agentName: "orchestrator",
      permissions: { Bash: { run: "allow" } },
      // ... other fields
    };
    await fs.writeFile(adataPath, JSON.stringify(existingData));

    // Action: Call SAVE_AGENT_GRAPH with modified agent
    const result = await handleSaveAgentGraph({
      projectDir: testProjectDir,
      agents: [{
        id: "agent-123",
        name: "orchestrator",  // unchanged
        description: "Updated description",  // ← changed
        type: "Agent",
        isOrchestrator: true,
        hidden: false,
        x: 100,
        y: 200,
      }],
      edges: [],
    });

    // Assert: permissions still exist in .adata
    expect(result.success).toBe(true);
    const savedData = JSON.parse(await fs.readFile(adataPath, "utf-8"));
    expect(savedData.permissions).toEqual({ Bash: { run: "allow" } });
  });

  it("should preserve skills and aspects too", async () => {
    // ... similar
  });
});
```

---

## Risk Analysis

### 🔴 High Impact

- **Orchestrator permissions loss**: El orquestador es el agente más crítico
- **Cascading failures**: Si alguien edita múltiples campos, pierde todo

### 🟡 Medium Impact

- **User confusion**: Sin UI warning, el usuario no sabe por qué desaparecen
- **Data integrity**: El .adata se vuelve inconsistente entre saves

### 🟢 Low Probability (but happened)

- Solo afecta si:
  1. Usuario define permisos en el modal ✅
  2. Edita el agente en el canvas ✅
  3. Hace click en "Save" ✅

---

## Affected Agent Types

### Especialmente crítico para:
- **Orquestador** (isOrchestrator=true): Permisos son cruciales para control de delegación
- **Sub-agentes** con permisos de caja de herramientas (Bash, etc.)
- Cualquier agente con skills específicas

---

## Affected Code Files Summary

```
src/
├── ui/
│   ├── components/
│   │   └── AgentGraphSaveButton.tsx    ← Serialización incompleta
│   └── store/
│       ├── agentFlowStore.ts          ← CanvasAgent sin permisos
│       └── projectStore.ts            ← saveAgentGraph call
├── electron/
│   ├── ipc-handlers.ts                ← ❌ CRITICAL: línea 726-750
│   ├── permissions-handlers.ts        ← Separado, independiente
│   ├── skills-handlers.ts             ← Separado, independiente
│   └── bridge.types.ts                ← SaveAgentGraphRequest/AgentGraphNode
└── schemas/
    └── adata.schema.ts                ← Schema (permissions optional)
```

---

## Next Steps for Fix

### Phase 1: Immediate Patch (5 min)
1. Add `permissions` preservation to `.adata` constructor (ipc-handlers.ts:750)
2. Quick test: verify permissions survive graph save

### Phase 2: Verification (30 min)
1. Check all other fields in schema are preserved
2. Add audit warnings for lost fields
3. Test orchestrator + permissions + save cycle

### Phase 3: Robustness (1-2 hours)
1. Load permissions into UI state (agentFlowStore) for display
2. Add integration tests for metadata preservation
3. Consider unifying save operations or adding pre-save validation

### Phase 4: Documentation
1. Document why permissions are separate from graph save
2. Add comments to prevent future regressions
3. Update developer guide on metadata persistence

---

## Conclusion

**Root Cause**: El handler `SAVE_AGENT_GRAPH` construye un nuevo `.adata` JSON sin incluir la propiedad `permissions` del `.adata` existente, aunque intenta preservar otros campos como `skills`, `aspects`, y `profile`.

**Impact**: Permisos, y potencialmente otros metadatos, se pierden cuando el usuario edita un agente en el canvas y hace clic en "Save".

**Severity**: CRITICAL para el orquestador.

**Fix**: Una línea en ipc-handlers.ts (línea ~750) para preservar `permissions` como se hace con otros campos.

**Prevention**: Test de integración para el ciclo completo: define permisos → edita agente → guarda → verifica permisos.
