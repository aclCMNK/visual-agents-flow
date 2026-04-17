# Exploration: Drag & Drop Interno de Archivos y Carpetas en AssetPanel

## Estado Actual

### Arquitectura Existente

**Stack:**
- React 19 + Zustand (state management)
- Electron con IPC bridge
- TypeScript sin librerías de UI (componentes custom)
- Sin soporte actual de drag-drop

**Componentes clave:**
1. **AssetPanel.tsx** — Layout principal (topbar, sidebar, right panel)
2. **DirTree.tsx** — Árbol de directorios en sidebar con expand/collapse, create/rename/delete
3. **FileList.tsx** — Listado de archivos .md y subdirs con acciones
4. **assetStore.ts** — Store Zustand con todas las operaciones (select, create, rename, delete, refresh)

**IPC Bridge (bridge.types.ts):**
- `ASSET_RENAME` — Renombra archivo o directorio
- `ASSET_CREATE_DIR` — Crea directorio
- `ASSET_DELETE` — Borra archivo/directorio
- `ASSET_LIST_DIRS` — Lista subdirectorios
- `ASSET_LIST_DIR_CONTENTS` — Lista archivos .md + subdirs
- **NO existe handler de "move"** — Solo rename (mismo nivel) y delete

**Modelo de datos:**
```ts
interface AssetDirEntry {
  name: string;
  path: string;           // Ruta absoluta
  relativePath: string;
  children?: AssetDirEntry[];
}

interface AssetFileEntry {
  name: string;
  path: string;           // Ruta absoluta
  relativePath: string;
  ext: "md";
}

interface AssetDirContents {
  dirPath: string;
  files: AssetFileEntry[];
  subdirs: AssetDirEntry[];
}
```

**Store state:**
- `projectRoot` — Raíz del proyecto
- `selectedDir` — Directorio actualmente seleccionado
- `topDirs` — Dirs de nivel superior
- `childrenMap` — Cache de dirs expandidos
- `expandedDirs` — Set de paths expandidos
- `dirContents` — Contenido del selectedDir (para el panel derecho)
- Tabs, toasts, loading state...

### Convenciones del Proyecto

1. **Restricciones de contenido:**
   - Solo archivos `.md` en el root
   - Directorios especiales: `skills/`, `behaviors/`, `metadata/`
   - `metadata/` contiene archivos `.adata` (agentId-specificos)

2. **Operaciones actuales:**
   - Todos los cambios pasan por store → bridge IPC → handler Electron
   - Toast notifications para feedback
   - Inline confirmations para operaciones destructivas

3. **Patrones:**
   - Inline inputs (rename, create)
   - Confirmations con "Cancel/Confirm"
   - Hover-reveal actions
   - Breadcrumb navigation

---

## Áreas Afectadas

- **src/ui/components/AssetPanel/AssetPanel.tsx** — Layout principal
- **src/ui/components/AssetPanel/DirTree.tsx** — Arbol con drag support (origen)
- **src/ui/components/AssetPanel/FileList.tsx** — Listado con drop targets
- **src/ui/store/assetStore.ts** — Nueva acción `moveItem(fromPath, toPath)`
- **src/electron/bridge.types.ts** — Nuevo canal `ASSET_MOVE` (¿o extender RENAME?)
- **src/electron/ipc-handlers.ts** — Handler para move atomico
- **src/ui/styles/app.css** — Clases para drag-over states
- **src/electron/preload.ts** — Exponer nuevo handler si es necesario

---

## Alternativas Técnicas

### Opción 1: Usar librería `react-dnd`

**Descripción:**
Librería especializada para drag-drop en React con soporte para:
- Tipos de drag (files, folders, etc.)
- Validación de drop targets
- Reordenamiento
- Backends abstractos (HTML5 drag-drop, touch, mouse)

**Pros:**
- Separación clara de concerns (source vs target)
- Type safety built-in
- Abstracciones robustas para edge cases
- Bien documentado, amplio uso

**Cons:**
- Dependencia externa (28KB gzipped)
- Learning curve moderado
- Requiere envolver componentes con HOCs o hooks
- Setup inicial: collectores, tipos, etc.

**Effort:** Medium

**Viabilidad:** ⭐⭐⭐⭐⭐ (Recomendado para proyectos complejos)

---

### Opción 2: HTML5 Native Drag-Drop API + Custom Hook

**Descripción:**
Usar `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd` nativo del browser.
Wrapper en hook custom `useDragDrop` para simplificar.

**Pros:**
- Cero dependencias externas
- Control total sobre el flujo
- Integración natural con Zustand
- Eventos estándar del browser
- Liviano

**Cons:**
- Más código boilerplate
- DataTransfer API es verbosa
- Edge cases requieren cuidado (cross-origin, files reales vs virtuales)
- Estado disperso en múltiples handlers
- Testing más manual

**Effort:** Low-Medium

**Viabilidad:** ⭐⭐⭐⭐ (Viable para este proyecto, menos complejo)

---

### Opción 3: Solución Hibrida (Custom Hook + Zustand)

**Descripción:**
Hook custom que maneja el drag-drop nativo, pero delega lógica al store Zustand.
- Hook expone: `isDragging`, `draggedItem`, `dragOver`, `onDragStart`, `onDrop`, etc.
- Store maneja: validación, move, refresh
- Componentes consumen ambos

**Pros:**
- Balanceado: simple pero robusto
- Reutilizable en múltiples componentes
- Testing más fácil (separar hook de UI)
- Totalmente flexible

**Cons:**
- Mezcla de responsabilidades
- Requiere coordinación hook ↔ store

**Effort:** Low-Medium

**Viabilidad:** ⭐⭐⭐⭐⭐ (Óptimo para este proyecto)

---

## Recomendación: Opción 3 (Custom Hook + Zustand)

**Rationale:**
1. **Costo:** El proyecto es Electron + React simple sin dependencias de UI pesadas. No hay justificación para agregar react-dnd.
2. **Control:** HTML5 Drag-Drop API es suficiente y nativa.
3. **Mantenibilidad:** Un hook custom en `src/ui/hooks/useDragDrop.ts` es claro y fácil de auditar.
4. **Integración:** Zustand ya maneja toda la lógica de archivos; el hook es solo el "transporte".
5. **Performance:** Cero overhead de librería, solo eventos nativos.

---

## Arquitectura Propuesta

### 1. Estructura de Directorios

```
src/ui/hooks/
  ├── useDragDrop.ts          # Hook para drag-drop state management
  └── (existentes...)

src/ui/components/AssetPanel/
  ├── AssetPanel.tsx           # Sin cambios principales
  ├── DirTree.tsx              # Agregar drag source handlers
  ├── FileList.tsx             # Agregar drop target handlers
  ├── DragDropContext.tsx       # (opcional) Context para compartir estado de drag
  └── ...

src/ui/store/
  └── assetStore.ts            # Nueva acción: moveItem()

src/electron/
  ├── bridge.types.ts          # Nuevo canal: ASSET_MOVE
  ├── ipc-handlers.ts          # Handler: moveItem (con validaciones)
  └── preload.ts               # Exponer: bridge.assetMoveItem()

src/ui/styles/
  └── app.css                  # Nuevas clases: --dragging, --drop-valid, --drop-invalid, etc.
```

### 2. Hook: useDragDrop.ts

```typescript
interface DragItem {
  type: "file" | "folder";
  path: string;
  name: string;
}

interface UseDragDropReturn {
  draggedItem: DragItem | null;
  isDragging: boolean;
  dragOverTarget: string | null;    // Path del target sobre el que se arrastra
  canDrop: boolean;                 // ¿Es válido dropar aquí?
  
  onDragStart: (item: DragItem) => (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (targetPath: string) => (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (targetPath: string) => (e: React.DragEvent) => Promise<void>;
  clearDrag: () => void;
}

export function useDragDrop(store: AssetStore): UseDragDropReturn {
  // Estado local
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Validar si un drop es permitido
  const validateDropTarget = (source: DragItem, targetPath: string): boolean => {
    // ✗ No metadata
    // ✗ skills/behaviors no son movibles (pero SÍ reciben)
    // ✗ No mover carpeta dentro de sí misma
    // ✗ Verificar conflictos de nombres
  };
  
  const onDragStart = (item: DragItem) => (e: React.DragEvent) => {
    setDraggedItem(item);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify(item));
  };
  
  const onDragOver = (targetPath: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(targetPath);
  };
  
  const onDrop = async (targetPath: string) => {
    if (!draggedItem) return;
    
    if (validateDropTarget(draggedItem, targetPath)) {
      // Llamar store.moveItem() → IPC move
      await store.moveItem(draggedItem.path, targetPath);
    } else {
      // Toast de error
      store.pushToast("error", "Cannot move here");
    }
    
    clearDrag();
  };
  
  const clearDrag = () => {
    setDraggedItem(null);
    setDragOverTarget(null);
    setIsDragging(false);
  };
  
  return {
    draggedItem,
    isDragging,
    dragOverTarget,
    canDrop: validateDropTarget(draggedItem, dragOverTarget),
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
    clearDrag,
  };
}
```

### 3. Store: Nueva Acción moveItem()

```typescript
// En assetStore.ts

export interface AssetActions {
  // ... existentes ...
  
  /** Mueve un archivo o carpeta a un nuevo directorio padre */
  moveItem(fromPath: string, toPath: string): Promise<boolean>;
}

// Implementación:
async moveItem(fromPath, toPath) {
  // toPath es el directorio destino, NO el path final
  const fileName = basename(fromPath);
  const newPath = `${toPath}/${fileName}`;
  
  // Detectar conflicto
  const contents = await bridge.assetListDirContents(toPath);
  const exists = contents.files.some(f => f.path === newPath) ||
                 contents.subdirs.some(d => d.path === newPath);
  
  if (exists) {
    // Mostrar confirmación
    const confirmed = await showConfirmDialog("File already exists. Overwrite?");
    if (!confirmed) return false;
  }
  
  // Usar ASSET_RENAME para mover (path a path diferente)
  const result = await bridge.assetRename(fromPath, newPath);
  
  if (result.success) {
    store.pushToast("success", `Moved successfully`);
    // Refresh afectados
    await store.refreshChildren(toPath);
    await store.refreshChildren(dirname(fromPath));
  } else {
    store.pushToast("error", result.error);
  }
  
  return result.success;
}
```

### 4. Backend: Handler assetMove

En **ipc-handlers.ts**, podríamos:

**Opción A:** Extender `ASSET_RENAME` para detectar si es mover:
```ts
// Detectar si es un "move" vs "rename en mismo dir"
const oldDir = dirname(oldPath);
const newDir = dirname(newPath);
if (oldDir !== newDir) {
  // Es un move: validar restricciones
  validateMoveRestrictions(oldPath, newPath);
}
await rename(oldPath, newPath);
```

**Opción B:** Crear canal específico `ASSET_MOVE`:
```ts
ipcMain.handle(
  IPC_CHANNELS.ASSET_MOVE,
  async (_event, fromPath: string, toPath: string): Promise<AssetOpResult> => {
    // toPath es el directorio destino
    const fileName = basename(fromPath);
    const newPath = `${toPath}/${fileName}`;
    
    // Validaciones
    if (isMetadata(fromPath)) 
      return { success: false, error: "Cannot move metadata" };
    if (isSelfOrDescendant(fromPath, newPath))
      return { success: false, error: "Cannot move folder into itself" };
    if (await pathExists(newPath))
      return { success: false, error: "Target already exists" };
    
    try {
      await rename(fromPath, newPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
);
```

**Recomendación:** Opción B (canal específico) es más claro.

### 5. Validaciones en Hook y Backend

**Validaciones comunes:**
1. ✗ Source no puede ser `metadata` (dir o file en él)
2. ✗ Source no puede ser exactamente `skills` o `behaviors` en raíz
3. ✗ Target no puede estar dentro de Source (prevenir ciclos)
4. ✗ Target no puede tener ítem con mismo nombre (detectar conflicto)
5. ✓ Target puede ser `skills` o `behaviors` (como receptores)
6. ✓ Target puede ser cualquier otro dir

**Implementación:**

```typescript
// En el hook:
function validateDropTarget(source: DragItem, targetPath: string, store: AssetStore): boolean {
  // 1. No metadata
  if (isWithinMetadata(source.path)) return false;
  if (source.name === "metadata") return false;
  if (isWithinMetadata(targetPath)) return false;
  
  // 2. No mover skills/behaviors de raíz
  if (store.projectRoot === dirname(source.path)) {
    if (source.name === "skills" || source.name === "behaviors") {
      return false;  // Elemento raíz especial no movible
    }
  }
  
  // 3. No mover dentro de sí mismo
  if (source.type === "folder" && targetPath.startsWith(source.path + "/")) {
    return false;
  }
  
  // 4. Verificar conflicto de nombres (requiere datos en cache o IPC)
  // Esto es más complejo; considerar dejar para backend
  
  return true;
}

function isWithinMetadata(path: string): boolean {
  return path.includes("/metadata/") || path.includes("\\metadata\\");
}
```

### 6. Feedback Visual (CSS)

En **app.css**:

```css
/* Elemento siendo arrastrado */
.dirtree__node.dragging,
.filelist__file-row.dragging {
  opacity: 0.5;
  background-color: rgba(0, 0, 0, 0.05);
}

/* Zona válida de drop */
.dirtree__node.drop-valid,
.filelist__file-row.drop-valid {
  background-color: rgba(76, 175, 80, 0.15);  /* Green tint */
  border-left: 3px solid #4caf50;
  outline: 1px dashed #4caf50;
}

/* Zona inválida de drop */
.dirtree__node.drop-invalid,
.filelist__file-row.drop-invalid {
  background-color: rgba(244, 67, 54, 0.1);   /* Red tint */
  border-left: 3px solid #f44336;
  cursor: not-allowed;
}

/* Cursor durante drag */
.asset-panel.dragging-active {
  cursor: grabbing;
}

/* Tooltip para drop inválido */
.dirtree__node.drop-invalid::after,
.filelist__file-row.drop-invalid::after {
  content: "Cannot drop here";
  position: absolute;
  background: #f44336;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}
```

### 7. Integración en Componentes

**DirTree.tsx - Cambios:**
```tsx
function DirNode({ entry, depth, parentPath }: DirNodeProps) {
  const store = useAssetStore();
  const { onDragStart, onDragOver, onDrop, dragOverTarget, canDrop } = useDragDrop(store);
  
  const isDragOver = dragOverTarget === entry.path;
  const isDropValid = isDragOver && canDrop;
  
  return (
    <li
      className={`dirtree__node-li ${isDragOver ? (isDropValid ? "drop-valid" : "drop-invalid") : ""}`}
      draggable
      onDragStart={onDragStart({ type: "folder", path: entry.path, name: entry.name })}
      onDragOver={onDragOver(entry.path)}
      onDrop={onDrop(entry.path)}
      onDragLeave={() => ...}
    >
      {/* contenido */}
    </li>
  );
}
```

**FileList.tsx - Cambios similares:**
```tsx
function SubdirRow({ dir }: SubdirRowProps) {
  const store = useAssetStore();
  const { onDragStart, onDragOver, onDrop, dragOverTarget, canDrop } = useDragDrop(store);
  
  return (
    <li
      draggable
      onDragStart={onDragStart({ type: "folder", path: dir.path, name: dir.name })}
      onDragOver={onDragOver(dir.path)}
      onDrop={onDrop(dir.path)}
    >
      {/* ... */}
    </li>
  );
}
```

---

## Consideraciones de Edge Cases

### 1. Conflicto de Nombres
**Escenario:** El usuario arrastra `docs/intro.md` a `specs/` pero ya existe `specs/intro.md`.

**Solución:**
- Backend valida conflicto antes de rename
- Si existe: mostrar dialog "File exists. Overwrite?"
- Usuario confirma → rename (clobber)
- Si cancela → toast "Cancelled"

### 2. Ciclo de Carpetas
**Escenario:** Arrastra `project/agents/` dentro de sí mismo.

**Solución:**
- Validar: `targetPath.startsWith(sourcePath + "/")`
- Si true: bloquear drop, visual feedback rojo
- Toast: "Cannot move folder into itself"

### 3. Metadata/Skills/Behaviors
**Escenario:** Usuario intenta mover `metadata/` o `skills/`.

**Solución:**
- `metadata/` nunca visible ni drageable (filtrado en listing)
- `skills/` y `behaviors/` en raíz: NO drageable (disabled en frontend)
  - Pero SÍ son drop targets válidos
  - Marcar visualmente como "receive-only"

### 4. Archivos vs Carpetas
**Escenario:** Usuario arrastra archivo `.md` sobre otro archivo.

**Solución:**
- Solo carpetas son drop targets (archivos no)
- Archivos pueden ser dragged pero drop inválido en otros archivos
- Drop válido solo en directorios

### 5. Árbol Colapsado
**Escenario:** Usuario arrastra sobre carpeta colapsada que tiene subcarpetas.

**Solución:**
- Show drop valid indicator en la carpeta colapsada
- No auto-expand (evitar UX confusa)
- Drop target es la carpeta colapsada, no sus children

### 6. Operación Fallida
**Escenario:** Rename falla (permisos, etc.) durante move.

**Solución:**
- IPC handler retorna `{ success: false, error: "..." }`
- Store pushToast error
- UI regresa a estado normal (no drag-over)
- Componentes no refrescados (quedaron igual)

### 7. Drag Over Sidebar vs Panel Derecho
**Escenario:** Usuario arrastra carpeta del sidebar y suelta sobre FileList derecha.

**Solución:**
- Ambos son drop targets
- El drop target es simplemente el directorio receptivo
- No hay conflicto porque cada uno maneja sus propios eventos

---

## Impacto en Componentes Existentes

### AssetPanel.tsx
**Cambios:** Mínimos
- Quizá agregar Provider si usamos Context (opcional)
- Si usamos hooks directos: sin cambios

### DirTree.tsx
**Cambios:** Moderados
- Agregar `draggable` en nodes
- Agregar `onDragStart`, `onDragOver`, `onDrop`
- Clases dinámicas para visual feedback
- Aislar root `skills`, `behaviors` como no-draggable

### FileList.tsx
**Cambios:** Moderados
- Agregar `draggable` en `SubdirRow`
- Agregar `onDragStart`, `onDragOver`, `onDrop`
- Clases dinámicas
- Drop target también en sí mismo (el dir actual)

### assetStore.ts
**Cambios:** Pequeños pero importantes
- Nueva acción `moveItem(from, to): Promise<bool>`
- Reutiliza existentes `refreshChildren()`, `pushToast()`
- No requiere cambiar otras acciones

### bridge.types.ts
**Cambios:** 1 línea
```ts
ASSET_MOVE: "asset:move",  // Nuevo canal
```

### ipc-handlers.ts
**Cambios:** ~50 líneas
- Nuevo handler para `ASSET_MOVE`
- Validaciones (metadata, ciclos, conflictos)
- Uso de `rename()` del fs

### Estilos (app.css)
**Cambios:** ~30 líneas
- Clases para drag/drop states
- Colores, bordes, opacidad
- Cursor feedback

---

## Flujo Completo de Interacción

```
Usuario START drag en DirTree/FileList
  │
  ├─ onDragStart()
  │  └─ setDraggedItem(item)
  │     └─ e.dataTransfer.setData("application/json", item)
  │
  ├─ Mouse over target (otro dir)
  │  └─ onDragOver(targetPath)
  │     ├─ e.preventDefault()
  │     ├─ setDragOverTarget(targetPath)
  │     └─ validateDropTarget() → addClass (drop-valid | drop-invalid)
  │
  ├─ Mouse LEAVES target
  │  └─ onDragLeave()
  │     └─ setDragOverTarget(null) → removeClass
  │
  └─ Mouse DROP on target
     └─ onDrop(targetPath)
        ├─ validateDropTarget()
        │  │
        │  ├─ ✓ Valid
        │  │  └─ store.moveItem(from, to)
        │  │     ├─ IPC: bridge.assetMove()
        │  │     ├─ Handler: validar + rename fs
        │  │     ├─ pushToast("success", "Moved")
        │  │     └─ refreshChildren() + refreshTopDirs()
        │  │
        │  └─ ✗ Invalid
        │     └─ pushToast("error", "Cannot move here")
        │
        └─ clearDrag() → setDraggedItem(null), etc.
```

---

## Decisiones SDD Requeridas

1. **¿Usar nuevo canal ASSET_MOVE o extender ASSET_RENAME?**
   - **Recomendación:** Nuevo canal (más claro, facilita logs/audits)

2. **¿Confirmación para conflictos de nombres?**
   - **Recomendación:** Sí, inline dialog tipo "Overwrite?"

3. **¿Auto-expand de directorios al drag-over?**
   - **Recomendación:** NO (evitar sorpresas UX)

4. **¿Soporte para multi-select drag?**
   - **Recomendación:** NO (v1 simple item único; v2 puede agregar)

5. **¿Filtrar metadata en listing?**
   - **Recomendación:** Sí, ya existe lógica de "hidden dirs"

6. **¿Bloquear visual skills/behaviors en raíz?**
   - **Recomendación:** Sí, agregar atributo `draggable={false}`

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|--------|-----------|
| Ciclo de carpetas (mover A dentro de A) | Alta | Alto | Validar en hook + backend |
| Conflictos de nombres silenciosos | Media | Medio | Detectar, confirmar |
| Corrupción de metadata | Baja | Crítico | Nunca permitir mover metadata/ |
| Performance drag-over | Baja | Bajo | No validar en cada drag-over (lazy) |
| Estado inconsistente entre tabs | Media | Medio | Refresh después de cada move |
| Permisos fs (EACCES) | Baja | Medio | Capturar error IPC, toast |
| DataTransfer issues cross-browser | Muy Baja | Bajo | Usar JSON standard, no files reales |

---

## Pruebas Sugeridas

### Unitarias
- `useDragDrop.validateDropTarget()` con todos los casos
- `assetStore.moveItem()` con/sin conflicto
- Backend move handler con ciclos, metadata, conflictos

### Integración
- Drag carpeta A → carpeta B: lista se actualiza
- Drag archivo sobre no-droppable: visual feedback rojo
- Drag skills: no se mueve (pero sí recibe)
- Drag metadata: nunca aparece

### E2E (Electron)
- Drag en DirTree, drop en FileList
- Collapse/expand durante drag
- Breadcrumb actualizado después de move
- Tabs abiertos: ¿se actualizan paths?

---

## Resumen de Recomendaciones

| Aspecto | Decisión |
|--------|----------|
| **Librería** | HTML5 Drag-Drop API nativa (sin dependencias) |
| **Hook** | `useDragDrop.ts` custom |
| **Store** | Nueva acción `moveItem()` |
| **Backend** | Nuevo canal `ASSET_MOVE` |
| **Validaciones** | Hook (UX) + Backend (seguridad) |
| **Feedback** | CSS classes dinámicas + toast |
| **Multi-select** | NO en v1 (futura mejora) |
| **Metadata** | Nunca visible, nunca draggable |
| **Skills/Behaviors** | No movibles en raíz, pero receptores |
| **Conflictos** | Detección + dialog de confirmación |

---

## Ficheros a Crear/Modificar

**Crear:**
- `src/ui/hooks/useDragDrop.ts` — Hook principal
- `src/ui/components/AssetPanel/DragDropContext.tsx` (opcional, si se necesita Context)

**Modificar:**
- `src/ui/components/AssetPanel/DirTree.tsx` — Agregar handlers
- `src/ui/components/AssetPanel/FileList.tsx` — Agregar handlers
- `src/ui/store/assetStore.ts` — Agregar `moveItem()`
- `src/electron/bridge.types.ts` — Agregar canal `ASSET_MOVE`
- `src/electron/ipc-handlers.ts` — Agregar handler
- `src/ui/styles/app.css` — Agregar clases de feedback

---

## Próximos Pasos (Fase de Implementación)

1. **Diseño técnico:** Aceptar/refinar propuesta de arquitectura
2. **Tareas:** Desglose en subtareas ordenadas
   - T1: Hook useDragDrop.ts
   - T2: Backend ASSET_MOVE handler + bridge
   - T3: Store moveItem() action
   - T4: DirTree.tsx drag handlers
   - T5: FileList.tsx drop handlers
   - T6: Estilos CSS + feedback visual
   - T7: Validaciones edge cases
   - T8: Testing (unitaria + integración)
3. **Especificación:** Requerimientos detallados
4. **Implementación:** Por tarea
5. **Verificación:** Pruebas + code review

