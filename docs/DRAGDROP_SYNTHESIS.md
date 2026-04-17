# Drag & Drop Interno de Assets — Síntesis Ejecutiva

## Análisis de Alternativas Técnicas

### Opción 1: `react-dnd` (Librería especializada)
- ✅ Robusto, usado en producción por grandes equipos
- ✅ Documentación excelente, abstracciones claras
- ❌ Dependencia +28KB gzipped
- ❌ Learning curve moderado
- **Effort:** Medium | **Recomendación:** ❌ Innecesario para este proyecto

### Opción 2: HTML5 Drag-Drop API Nativo + Hook Custom ⭐ RECOMENDADO
- ✅ Cero dependencias externas
- ✅ Control total, integración natural con Zustand
- ✅ Liviano y performante
- ✅ Eventos estándar del browser
- ⚠️ Más boilerplate, requiere cuidado con edge cases
- **Effort:** Low-Medium | **Recomendación:** ✅ ELEGIDA

### Opción 3: `react-sortable-hoc` (Reordenamiento)
- ❌ Orientada a listas reordenables, no mover entre carpetas
- ❌ Overkill para este use case

---

## Recomendación Final: Opción 2

**Hook custom `useDragDrop.ts`** que:
1. Maneja eventos nativos (`onDragStart`, `onDragOver`, `onDrop`, etc.)
2. Valida drop targets (metadata, ciclos, conflictos)
3. Delega lógica de move al store Zustand
4. Proporciona estado de UI (dragging, dragOverTarget, canDrop)

**Rationale:**
- Alineado con arquitectura existente (Zustand + IPC)
- Máxima flexibilidad y control
- No agrega deuda técnica
- Testing simplificado

---

## Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────┐
│                    React Components                      │
│  DirTree.tsx          FileList.tsx       AssetPanel.tsx  │
│  (drag source)        (drop target)                      │
└──────────────────┬────────────────────────────────────────┘
                   │ useDragDrop()
┌──────────────────▼────────────────────────────────────────┐
│              Custom Hook: useDragDrop.ts                  │
│  • Events: onDragStart, onDragOver, onDrop, onDragEnd   │
│  • State: draggedItem, dragOverTarget, isDragging       │
│  • Validation: validateDropTarget()                      │
│  • UI feedback: CSS classes (drop-valid, drop-invalid)   │
└──────────────────┬────────────────────────────────────────┘
                   │ store.moveItem()
┌──────────────────▼────────────────────────────────────────┐
│           Zustand Store: assetStore.ts                    │
│  • moveItem(fromPath, toPath): Promise<bool>             │
│  • Detecta conflictos, llama IPC                         │
│  • Refresca cache local + toast feedback                 │
└──────────────────┬────────────────────────────────────────┘
                   │ bridge.assetMove()
┌──────────────────▼────────────────────────────────────────┐
│     Electron IPC Bridge (bridge.types.ts)                │
│  • Nuevo canal: ASSET_MOVE                               │
└──────────────────┬────────────────────────────────────────┘
                   │
┌──────────────────▼────────────────────────────────────────┐
│   Backend Handler: ipc-handlers.ts                        │
│  • Valida metadata, ciclos, conflictos                   │
│  • Usa fs.rename() para mover                            │
│  • Error handling y respuesta                            │
└──────────────────┬────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    Rename OK            Rename FAIL
        │                     │
        │                ✗ Toast error
        │
    ✓ Toast success
    ✓ Refresh cache
    ✓ Update UI
```

---

## Restricciones Implementadas

| Restricción | Dónde | Cómo |
|-------------|-------|------|
| **Metadata oculto** | FileList/DirTree | Filtrado en listado (no visible) |
| **Skills/behaviors no movibles** | Hook validate | `draggable={false}` en raíz |
| **Skills/behaviors receptores** | Hook validate | Permitir drop target |
| **Ciclos prevenidos** | Hook + Backend | `targetPath.startsWith(sourcePath/)` |
| **Conflictos detectados** | Backend | Listar destino, buscar nombre |
| **Conflictos confirmados** | Hook/UI | Dialog "Overwrite?" antes de mover |

---

## Flujo de Interacción Completo

```
Usuario arrasta carpeta "docs" sobre "specs"
│
├─ onDragStart("docs")
│  └─ setDraggedItem({ type: "folder", path: "/proj/docs", name: "docs" })
│
├─ onDragOver("/proj/specs")
│  ├─ validateDropTarget(docs, specs) → ✓ true
│  ├─ setDragOverTarget("/proj/specs")
│  └─ addClass "drop-valid" (fondo verde)
│
├─ onDrop("/proj/specs")
│  ├─ store.moveItem("/proj/docs", "/proj/specs")
│  │  ├─ newPath = "/proj/specs/docs"
│  │  ├─ Detectar conflicto → no existe
│  │  ├─ IPC: bridge.assetMove("/proj/docs", "/proj/specs")
│  │  ├─ Backend:
│  │  │  ├─ Validar no metadata
│  │  │  ├─ Validar no ciclo
│  │  │  ├─ fs.rename("/proj/docs" → "/proj/specs/docs")
│  │  │  └─ { success: true }
│  │  ├─ pushToast("success", "Moved 'docs' to 'specs'")
│  │  ├─ refreshChildren("/proj/specs")
│  │  └─ refreshChildren("/proj")
│  │
│  └─ clearDrag() → resetea UI
│
└─ Resultado:
   ├─ UI actualizado (docs ahora bajo specs)
   ├─ Breadcrumb funcional
   ├─ Tabs abiertos refrescados si es necesario
   └─ Store sincronizado
```

---

## Feedback Visual (CSS)

```css
/* Elemento siendo arrastrado */
.dragging {
  opacity: 0.5;
  background-color: rgba(0, 0, 0, 0.05);
}

/* Drop válido */
.drop-valid {
  background-color: rgba(76, 175, 80, 0.15);  /* Green */
  border-left: 3px solid #4caf50;
  outline: 1px dashed #4caf50;
}

/* Drop inválido */
.drop-invalid {
  background-color: rgba(244, 67, 54, 0.1);   /* Red */
  border-left: 3px solid #f44336;
  cursor: not-allowed;
}

/* Cursor durante drag */
.dragging-active {
  cursor: grabbing;
}
```

---

## Impacto en Componentes

| Componente | Cambios | Complejidad |
|------------|---------|-------------|
| **useDragDrop.ts** | ✨ Nuevo | Medium |
| **DirTree.tsx** | Agregar handlers, clases | Medium |
| **FileList.tsx** | Agregar handlers, clases | Medium |
| **assetStore.ts** | Nueva acción moveItem() | Small |
| **bridge.types.ts** | Nuevo canal ASSET_MOVE | Trivial |
| **ipc-handlers.ts** | Nuevo handler | Small |
| **app.css** | Nuevas clases CSS | Small |

---

## Edge Cases Cubiertos

### 1. Conflicto de Nombres
```
docs/intro.md → specs/ donde specs/intro.md ya existe
└─ Solución: Dialog de confirmación "Overwrite?" antes de mover
```

### 2. Ciclo de Carpetas
```
agents/ → agents/sub/ (dentro de sí mismo)
└─ Solución: Validación `targetPath.startsWith(sourcePath/)` + visual red
```

### 3. Metadata Oculto
```
metadata/ → (nunca visible ni drageable)
└─ Solución: Filtrado en DirTree/FileList listing
```

### 4. Skills/Behaviors Especiales
```
skills/ → (NO movible de raíz, pero SÍ recibe contenido)
└─ Solución: draggable={false} pero drop target habilitado
```

### 5. Árbol Colapsado
```
collapse carpeta → drag item sobre → drop
└─ Solución: Drop target sigue siendo válido (no auto-expand)
```

### 6. Operación Fallida
```
move falla (permisos, etc.)
└─ Solución: IPC retorna error → pushToast → estado sin cambios
```

### 7. Tabs Abiertos
```
archivo_movido.md estaba abierto en tab
└─ Solución: refreshDirContents() actualiza paths en tabs
```

---

## Validaciones

### Frontend (Hook)
- ✗ Metadata
- ✗ Skills/behaviors en raíz (no movibles)
- ✗ Ciclos (mover carpeta dentro de sí)
- ⚠️ Conflictos (detecta pero no rechaza; backend decide)

### Backend (Handler)
- ✗ Metadata (2da línea de defensa)
- ✗ Ciclos (2da línea de defensa)
- ✗ Conflictos (puede sobrescribir si user confirmó)
- ✗ Permisos FS (EACCES, etc.)
- ✗ Archivos del proyecto (.afproj, .adata)

---

## Testing Plan

### Unitarias
```ts
✓ validateDropTarget(metadata, anywhere) → false
✓ validateDropTarget(skills, anywhere) → false (raíz)
✓ validateDropTarget(A, A/sub) → false (ciclo)
✓ moveItem(file, dir) → { success: true }
✓ moveItem(file, dir) sin permisos → { success: false }
```

### Integración
```ts
✓ Drag file, drop en carpeta → lista actualizada
✓ Drag sobre no-droppable → visual feedback rojo
✓ Drag skills de raíz → no drageable
✓ Drag metadata → nunca visible
✓ Breadcrumb actualizado post-move
```

### E2E (Electron)
```
✓ Drag en sidebar, drop en file list
✓ Collapse/expand durante drag
✓ Tab abierto refrescado con nuevo path
✓ Permisos denegados → toast error
✓ Conflicto → dialog → overwrite → success
```

---

## Decisiones SDD Requeridas

1. ✅ **Nuevo canal ASSET_MOVE o extender ASSET_RENAME?**
   - Recomendación: **Nuevo canal** (claridad, logs, auditoría)

2. ✅ **Confirmación para conflictos?**
   - Recomendación: **Sí, dialog inline** (no sobrescribir por defecto)

3. ✅ **Auto-expand directorios al drag-over?**
   - Recomendación: **NO** (evitar UX confusa)

4. ✅ **Multi-select drag?**
   - Recomendación: **NO en v1** (futura mejora en v2)

5. ✅ **Filtrar metadata en UI?**
   - Recomendación: **Sí** (ya existe lógica)

6. ✅ **Bloquear visual skills/behaviors en raíz?**
   - Recomendación: **Sí** (`draggable={false}`)

---

## Próximas Fases

### Fase 2: Diseño Técnico
- Aceptar/refinar arquitectura propuesta
- Definir interfaces exactas (tipos, contracts)
- Especificar errores y códigos

### Fase 3: Tareas de Implementación
- **T1:** Hook useDragDrop.ts (validaciones, eventos)
- **T2:** Backend ASSET_MOVE handler + bridge
- **T3:** Store moveItem() action
- **T4:** DirTree.tsx integración
- **T5:** FileList.tsx integración
- **T6:** Estilos CSS + feedback
- **T7:** Validaciones edge cases
- **T8:** Testing + code review

### Fase 4: Especificación Detallada
- Requerimientos por tarea
- Ejemplos de inputs/outputs
- Casos de error

### Fase 5: Implementación
- Desarrollo por tarea (parallelizable)
- Code review iterativo

### Fase 6: Verificación
- Pruebas unitarias + integración
- E2E testing en Electron
- UX review

---

## Riesgos y Mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|--------|-----------|
| Ciclo de carpetas | Alta | Alto | Validar en hook + backend |
| Silenciosos conflictos | Media | Medio | Detectar + confirmar |
| Corrupción metadata | Baja | Crítico | Nunca permitir mover |
| Performance drag | Baja | Bajo | No validar en cada evento |
| Estado inconsistente tabs | Media | Medio | Refresh post-move |
| Permisos FS | Baja | Medio | Capturar error, toast |
| Cross-browser drag | Muy Baja | Bajo | Usar API estándar |

---

## Resumen

✅ **Viabilidad:** ALTA (arquitectura clara, bajo riesgo)

✅ **Complejidad:** MEDIA (validaciones múltiples, feedback visual)

✅ **Timeline estimado:** 3-4 sprints (con testing)

✅ **Impacto UX:** ALTO (mejora significativa de usabilidad)

✅ **Impacto técnico:** BAJO (integración limpia, sin deuda)

**Recomendación:** Proceder a fase de Diseño Técnico y Tareas de Implementación.

