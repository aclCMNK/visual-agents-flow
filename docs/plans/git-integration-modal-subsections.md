# 🧠 Plan de Solución — Git Integration Modal: Panel Lateral + Subsecciones

## 🎯 Objective

Agregar dentro del modal `GitIntegrationModal` ya existente:
1. Un **panel lateral izquierdo** con dos botones de navegación: `Branches` y `Changes`.
2. Un **área de contenido derecha** que muestra un placeholder según la subsección activa.
3. La estructura visual debe ser coherente con los modales existentes del proyecto (tokens CSS, tipografía, colores).

---

## 🧩 Context

### Estado actual

El modal `GitIntegrationModal` ya existe y funciona:

- **Ruta:** `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx`
- **Estructura actual:**
  ```
  .modal-backdrop
    └── .modal.modal--git
          ├── header.modal__header
          ├── div.modal__body.git-modal__body   ← solo tiene un <p> placeholder
          └── footer.modal__footer
  ```
- **CSS relevante** (`src/ui/styles/app.css`):
  - `.modal--git`: `min-width: min(50vw, 90vw)`, `min-height: 80vh`, `display: flex; flex-direction: column; overflow: hidden`
  - `.git-modal__body`: `flex: 1; overflow-y: auto; min-height: 0`
  - Tokens disponibles: `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`, `--radius-sm/md/lg`, `--transition`

### Patrón de referencia para navegación lateral

El `ExportModal` usa un **tab bar horizontal** (`.export-modal__tab-bar` / `.export-modal__tab`). Para el Git modal se usará un **panel lateral vertical** — patrón diferente pero con los mismos tokens visuales.

### Restricciones de diseño

- No crear nuevos archivos CSS globales. Los estilos van en `app.css` bajo el bloque existente de `.git-modal__*`.
- No usar CSS Modules (el proyecto usa clases globales BEM-like).
- El estado de subsección activa es **local al componente** (`useState`) — no va al store global (es UI efímera).
- Los componentes de subsección (`GitBranchesPanel`, `GitChangesPanel`) se crean como archivos separados dentro del mismo directorio del modal, pero por ahora solo retornan placeholders.
- Mantener la accesibilidad: el panel lateral actúa como `role="navigation"` y los botones como `role="tab"` con `aria-selected`.

---

## 🧭 Strategy

1. Refactorizar el interior de `.git-modal__body` para usar un layout de **dos columnas** (`flex-direction: row`): panel lateral izquierdo fijo + área de contenido derecha flexible.
2. Agregar estado local `activeSection: 'branches' | 'changes'` en `GitIntegrationModal`.
3. Crear dos componentes placeholder: `GitBranchesPanel` y `GitChangesPanel`.
4. Renderizar condicionalmente el panel activo en el área de contenido.
5. Agregar los estilos CSS necesarios bajo el bloque `.git-modal__*` existente.

---

## 🚀 Phases

---

### 🔹 Phase 1: Tipos y estado local en `GitIntegrationModal`

**Description:**  
Definir el tipo `GitSection` y agregar el estado `activeSection` con `useState` dentro del componente. No requiere cambios en el store global.

**Archivo:** `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx`

**Tasks:**

- **Task 1.1:** Definir el tipo de unión para las subsecciones:
  ```ts
  type GitSection = 'branches' | 'changes';
  ```
  Ubicación: justo antes de la interfaz `GitIntegrationModalProps` (línea 4 del archivo actual).
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task 1.2:** Agregar el estado local dentro del componente:
  ```ts
  const [activeSection, setActiveSection] = useState<GitSection>('branches');
  ```
  Ubicación: después de los callbacks `handleBackdropClick` y el `useEffect` de Escape (línea ~27 del archivo actual).
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

---

### 🔹 Phase 2: Componentes placeholder de subsección

**Description:**  
Crear dos componentes funcionales simples que retornan un placeholder visual. Estos componentes son el punto de extensión donde el developer implementará el contenido real de cada subsección en el futuro.

**Archivos a crear:**
- `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx`
- `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx`

**Tasks:**

- **Task 2.1:** Crear `GitBranchesPanel.tsx`:
  ```tsx
  // src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx

  export function GitBranchesPanel() {
    return (
      <div className="git-modal__section-content">
        <p className="git-modal__section-placeholder">
          Branches — coming soon.
        </p>
      </div>
    );
  }
  ```
  - **Assigned to:** Developer
  - **Dependencies:** ninguna (los estilos se definen en Phase 4)

- **Task 2.2:** Crear `GitChangesPanel.tsx`:
  ```tsx
  // src/ui/components/GitIntegrationModal/GitChangesPanel.tsx

  export function GitChangesPanel() {
    return (
      <div className="git-modal__section-content">
        <p className="git-modal__section-placeholder">
          Changes — coming soon.
        </p>
      </div>
    );
  }
  ```
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task 2.3:** Actualizar `index.ts` para re-exportar los nuevos componentes:
  ```ts
  export { GitIntegrationModal } from "./GitIntegrationModal.tsx";
  export { GitBranchesPanel }    from "./GitBranchesPanel.tsx";
  export { GitChangesPanel }     from "./GitChangesPanel.tsx";
  ```
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.1, 2.2

---

### 🔹 Phase 3: Refactorizar el JSX de `GitIntegrationModal`

**Description:**  
Reemplazar el contenido actual de `.modal__body.git-modal__body` (que solo tiene un `<p>` placeholder) por el nuevo layout de dos columnas: panel lateral + área de contenido.

**Archivo:** `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx`

**Estructura JSX objetivo del body:**

```tsx
{/* Imports a agregar al inicio del archivo */}
import { GitBranchesPanel } from "./GitBranchesPanel.tsx";
import { GitChangesPanel }  from "./GitChangesPanel.tsx";

{/* Reemplazar el contenido de .modal__body.git-modal__body */}
<div className="modal__body git-modal__body">

  {/* ── Layout: sidebar + content ──────────────────────────── */}
  <div className="git-modal__layout">

    {/* ── Panel lateral izquierdo ──────────────────────────── */}
    <nav
      className="git-modal__sidebar"
      role="navigation"
      aria-label="Git sections"
    >
      <button
        className={`git-modal__sidebar-btn${activeSection === 'branches' ? ' git-modal__sidebar-btn--active' : ''}`}
        onClick={() => setActiveSection('branches')}
        role="tab"
        aria-selected={activeSection === 'branches'}
        aria-controls="git-modal__content"
      >
        Branches
      </button>
      <button
        className={`git-modal__sidebar-btn${activeSection === 'changes' ? ' git-modal__sidebar-btn--active' : ''}`}
        onClick={() => setActiveSection('changes')}
        role="tab"
        aria-selected={activeSection === 'changes'}
        aria-controls="git-modal__content"
      >
        Changes
      </button>
    </nav>

    {/* ── Área de contenido derecha ─────────────────────────── */}
    <div
      id="git-modal__content"
      className="git-modal__content"
      role="tabpanel"
    >
      {activeSection === 'branches' && <GitBranchesPanel />}
      {activeSection === 'changes'  && <GitChangesPanel />}
    </div>

  </div>
</div>
```

**Tasks:**

- **Task 3.1:** Agregar los imports de `GitBranchesPanel` y `GitChangesPanel` al inicio del archivo.
  - **Assigned to:** Developer
  - **Dependencies:** Phase 2 completa

- **Task 3.2:** Reemplazar el contenido del `<div className="modal__body git-modal__body">` con el nuevo layout descrito arriba.
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.2, Task 3.1

---

### 🔹 Phase 4: CSS — Estilos del layout lateral

**Description:**  
Agregar los estilos CSS para el nuevo layout de dos columnas y los botones del panel lateral. Todos los estilos se insertan en `app.css` inmediatamente después del bloque `.git-modal__placeholder` existente (línea ~1688).

**Archivo:** `src/ui/styles/app.css`

**Bloque CSS a insertar:**

```css
/* ── Git Integration Modal — two-column layout ──────────────────────────── */

/* Contenedor principal del layout: sidebar izquierdo + contenido derecho.  */
/* Ocupa todo el espacio disponible dentro de .git-modal__body.              */
.git-modal__layout {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 0; /* necesario para que flex + overflow funcione en el hijo */
}

/* ── Panel lateral izquierdo ─────────────────────────────────────────────── */
/* Ancho fijo, borde derecho separador, fondo ligeramente diferenciado.      */
.git-modal__sidebar {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 8px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

/* Botón de navegación del sidebar */
.git-modal__sidebar-btn {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  transition:
    background var(--transition),
    color var(--transition);
}

.git-modal__sidebar-btn:hover:not(.git-modal__sidebar-btn--active) {
  background: var(--color-surface-2);
  color: var(--color-text);
}

/* Estado activo: resaltado con fondo surface-2 y texto completo */
.git-modal__sidebar-btn--active {
  background: var(--color-surface-2);
  color: var(--color-text);
  font-weight: 600;
}

/* ── Área de contenido derecha ───────────────────────────────────────────── */
/* Ocupa todo el espacio restante, con scroll propio si el contenido crece.  */
.git-modal__content {
  flex: 1;
  min-width: 0;  /* evita overflow en flex */
  overflow-y: auto;
  padding: 16px 20px;
}

/* ── Placeholder de subsección ───────────────────────────────────────────── */
/* Usado por GitBranchesPanel y GitChangesPanel mientras no hay contenido.   */
.git-modal__section-content {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.git-modal__section-placeholder {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  text-align: center;
}
```

**Notas de diseño:**

| Decisión | Razón |
|----------|-------|
| `width: 160px` fijo en sidebar | Suficiente para los labels "Branches" / "Changes"; evita que el sidebar se expanda con contenido futuro |
| `border-right: 1px solid var(--color-border)` | Separador visual consistente con el resto del sistema (mismo token que `.modal__header`) |
| `background: var(--color-surface)` en sidebar | Mismo fondo que el modal base — no introduce un tercer nivel de superficie |
| `--active` usa `var(--color-surface-2)` | Mismo token que el hover de botones en toda la app (`.modal__close-btn:hover`, `editor-view__topbar-btn:hover`) |
| `font-weight: 600` en activo | Diferencia visual sutil sin cambiar color — coherente con `.modal__title` |
| `padding: 16px 20px` en `.git-modal__content` | Mismo padding que `.modal__body` base (`20px 24px`) — ligeramente reducido para el área interna |

**Tasks:**

- **Task 4.1:** Insertar el bloque CSS completo en `app.css` inmediatamente después de `.git-modal__placeholder { ... }` (línea ~1688).
  - **Assigned to:** Developer
  - **Dependencies:** ninguna (puede hacerse en paralelo con Phases 1–3)

---

## 📁 Resumen de Archivos

| Acción | Ruta | Descripción |
|--------|------|-------------|
| **MODIFICAR** | `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx` | Agregar tipo `GitSection`, estado `activeSection`, imports de paneles, refactorizar JSX del body |
| **CREAR** | `src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx` | Componente placeholder para subsección Branches |
| **CREAR** | `src/ui/components/GitIntegrationModal/GitChangesPanel.tsx` | Componente placeholder para subsección Changes |
| **MODIFICAR** | `src/ui/components/GitIntegrationModal/index.ts` | Re-exportar los nuevos componentes |
| **MODIFICAR** | `src/ui/styles/app.css` | Agregar estilos del layout lateral (`.git-modal__layout`, `.git-modal__sidebar`, `.git-modal__sidebar-btn`, `.git-modal__content`, `.git-modal__section-content`, `.git-modal__section-placeholder`) |

---

## 🗺️ Diagrama del Layout Final

```
┌─────────────────────────────────────────────────────────────────────┐
│  Git Integration                                              [✕]    │  ← .modal__header
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┬──────────────────────────────────────────────┐   │
│  │              │                                              │   │
│  │  [Branches]  │   <GitBranchesPanel />                       │   │
│  │  [Changes ]  │   (o <GitChangesPanel /> según selección)    │   │
│  │              │                                              │   │
│  │              │                                              │   │
│  │              │                                              │   │
│  └──────────────┴──────────────────────────────────────────────┘   │
│  .git-modal__sidebar   .git-modal__content                          │
│  (160px fijo)          (flex: 1)                                    │
│                                                                     │  ← .git-modal__body (flex: 1)
├─────────────────────────────────────────────────────────────────────┤
│                                                          [Close]    │  ← .modal__footer
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Datos

```
GitIntegrationModal
  │
  ├── useState<GitSection>('branches')  ← estado local, no va al store
  │         │
  │         ▼
  ├── git-modal__sidebar
  │     ├── btn "Branches" → onClick: setActiveSection('branches')
  │     └── btn "Changes"  → onClick: setActiveSection('changes')
  │
  └── git-modal__content
        ├── activeSection === 'branches' → <GitBranchesPanel />
        └── activeSection === 'changes'  → <GitChangesPanel />
```

**Justificación de estado local vs store:**
- La subsección activa es UI efímera: se resetea al cerrar el modal (comportamiento esperado).
- No hay otros componentes que necesiten saber qué subsección está activa.
- Agregar al store global añadiría complejidad innecesaria y requeriría limpiar el estado al cerrar.

---

## ⚠️ Risks

- **`.git-modal__body` ya tiene `overflow-y: auto`:** Al agregar `.git-modal__layout` con `height: 100%` dentro, el scroll debe migrar a `.git-modal__content`. Si `.git-modal__body` mantiene `overflow-y: auto` y `.git-modal__layout` tiene `height: 100%`, puede haber conflicto. **Solución:** Cambiar `.git-modal__body` de `overflow-y: auto` a `overflow: hidden` (el scroll lo maneja `.git-modal__content`). Documentar el cambio en el CSS.
- **Altura del layout:** `.git-modal__layout` con `height: 100%` requiere que todos los ancestros tengan altura definida. La cadena es: `.modal--git` (flex column, `min-height: 80vh`) → `.git-modal__body` (flex: 1, `min-height: 0`) → `.git-modal__layout` (`height: 100%`). Si algún eslabón falla, el layout colapsa. Verificar en el browser después de implementar.
- **Accesibilidad del patrón tab:** Se usa `role="tab"` + `aria-selected` en los botones del sidebar, pero sin un `role="tablist"` explícito en el `<nav>`. Agregar `role="tablist"` al `<nav>` para completar el patrón ARIA correcto.

---

## 📝 Notes

- **Extensibilidad:** Los componentes `GitBranchesPanel` y `GitChangesPanel` son el punto de extensión natural. El developer que implemente el contenido real solo necesita modificar esos archivos — no tocar `GitIntegrationModal.tsx`.
- **Agregar más subsecciones en el futuro:** Solo requiere: (1) agregar el valor al tipo `GitSection`, (2) agregar un botón en el sidebar, (3) crear el componente panel correspondiente. El layout no necesita cambios.
- **No se necesita animación de transición** entre subsecciones por ahora. Si se desea en el futuro, se puede agregar con CSS `opacity` + `transition` en `.git-modal__content`.
- **Cambio en `.git-modal__body`:** El CSS actual tiene `overflow-y: auto`. Debe cambiarse a `overflow: hidden` para que el scroll quede en `.git-modal__content`. Este es el único cambio a CSS existente (todo lo demás es adición).
