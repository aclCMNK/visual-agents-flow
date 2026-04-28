# 🧠 Plan de Solución — Git Integration Modal

## 🎯 Objective

Agregar un botón **"Git"** en el header del editor (entre `AgentGraphSaveButton` y `Export JSON`), que al pulsarse abre un modal **"Git Integration"** centrado, con mínimo 50% de ancho y 80% de alto, con los mismos estilos visuales que los demás modales del proyecto.

---

## 🧩 Context

### Estado actual del proyecto

- **Header** (`EditorView` en `src/ui/App.tsx`, líneas 235–257): contiene los botones `📂 Assets`, `Validation`, `<AgentGraphSaveButton />` y `Export JSON`.
- **Modales existentes** siguen el patrón: estado booleano en `agentFlowStore` → `createPortal` en `App.tsx` → componente modal con clases `.modal-backdrop` / `.modal` / `.modal__header` / `.modal__body` / `.modal__footer`.
- **CSS modal base** en `src/ui/styles/app.css` líneas 1536–1661:
  - `.modal-backdrop`: `position: fixed; inset: 0; z-index: 10002; backdrop-filter: blur(2px); animation: fadeIn 120ms`
  - `.modal`: `background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); max-width: 520px; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: slideUp 150ms`
- **Store** (`src/ui/store/agentFlowStore.ts`): patrón establecido con `exportModalOpen: boolean`, `openExportModal()`, `closeExportModal()`.
- **Botón topbar**: clase `editor-view__topbar-btn` (padding 6px 12px, font-size 0.875rem, color muted, hover surface-2).

### Restricciones de diseño

- El modal debe ser **más ancho** que el `.modal` base (max-width: 520px). Necesita `min-width: 50vw` y `min-height: 80vh`.
- Debe usar **exactamente las mismas clases CSS base** (`.modal-backdrop`, `.modal__header`, `.modal__title`, `.modal__close-btn`, `.modal__body`, `.modal__footer`) para coherencia visual.
- Solo se agrega una clase modificadora `.modal--git` para sobreescribir dimensiones.
- El modal se monta vía `createPortal` en `document.body` (mismo patrón que `ExportModal` y `PermissionsModal`).

---

## 🧭 Strategy

Seguir **exactamente el patrón establecido** por `ExportModal`:

1. Agregar estado `gitModalOpen: boolean` + acciones `openGitModal()` / `closeGitModal()` al store.
2. Crear componente `GitIntegrationModal` con estructura HTML/CSS idéntica a los demás modales.
3. Agregar clase CSS `.modal--git` para dimensiones específicas (50vw / 80vh).
4. Agregar botón `⎇ Git` en el header de `EditorView`.
5. Montar el portal en `App.tsx`.

---

## 🚀 Phases

---

### 🔹 Phase 1: Store — Agregar estado y acciones para el modal Git

**Description:**  
Extender `agentFlowStore` con el estado booleano `gitModalOpen` y las acciones `openGitModal` / `closeGitModal`, siguiendo el patrón de `exportModalOpen`.

**Archivo:** `src/ui/store/agentFlowStore.ts`

**Tasks:**

- **Task 1.1:** Agregar campo `gitModalOpen: boolean` a la interfaz `AgentFlowState` (junto a `exportModalOpen`, línea ~253).
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task 1.2:** Agregar acciones `openGitModal(): void` y `closeGitModal(): void` a la interfaz `AgentFlowActions` (junto a `openExportModal` / `closeExportModal`, línea ~300).
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

- **Task 1.3:** Inicializar `gitModalOpen: false` en el estado inicial del store (línea ~402, junto a `exportModalOpen: false`).
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.1

- **Task 1.4:** Implementar las acciones en el objeto `create(...)`:
  ```ts
  openGitModal: () => set({ gitModalOpen: true }),
  closeGitModal: () => set({ gitModalOpen: false }),
  ```
  (junto a `openExportModal` / `closeExportModal`, líneas ~531–535)
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.2, 1.3

- **Task 1.5:** Agregar `gitModalOpen: false` en los bloques de reset del store (líneas ~641–643 y ~714–716, dentro de `resetFlow` y cualquier otro reset existente).
  - **Assigned to:** Developer
  - **Dependencies:** Task 1.3

---

### 🔹 Phase 2: Componente — Crear `GitIntegrationModal`

**Description:**  
Crear el componente modal con la estructura visual estándar del proyecto. El contenido interno es un placeholder estructurado (secciones vacías con títulos) listo para que el developer agregue funcionalidad Git real en el futuro.

**Archivo a crear:** `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx`  
**Archivo a crear:** `src/ui/components/GitIntegrationModal/index.ts`

**Tasks:**

- **Task 2.1:** Crear directorio `src/ui/components/GitIntegrationModal/`.
  - **Assigned to:** Developer
  - **Dependencies:** ninguna

- **Task 2.2:** Crear `GitIntegrationModal.tsx` con la siguiente especificación exacta:

  **Props:**
  ```ts
  interface GitIntegrationModalProps {
    onClose: () => void;
  }
  ```

  **Estructura JSX:**
  ```tsx
  <div
    className="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="git-integration-modal-title"
    onClick={handleBackdropClick}   // cierra al click fuera del modal
  >
    <div className="modal modal--git" tabIndex={-1}>
      {/* Header */}
      <header className="modal__header">
        <h2 className="modal__title" id="git-integration-modal-title">
          Git Integration
        </h2>
        <button
          className="modal__close-btn"
          onClick={onClose}
          aria-label="Close Git Integration"
        >
          ✕
        </button>
      </header>

      {/* Body */}
      <div className="modal__body git-modal__body">
        {/* Contenido placeholder — el developer implementará aquí */}
        <p className="git-modal__placeholder">
          Git integration coming soon.
        </p>
      </div>

      {/* Footer */}
      <footer className="modal__footer">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClose}
        >
          Close
        </button>
      </footer>
    </div>
  </div>
  ```

  **Lógica de cierre:**
  - `handleBackdropClick`: cierra solo si `e.target === e.currentTarget` (click en el backdrop, no en el modal).
  - Tecla `Escape`: `useEffect` que escucha `keydown` y llama `onClose` cuando `key === "Escape"`.
  - Botón `✕` del header: llama `onClose` directamente.
  - Botón `Close` del footer: llama `onClose` directamente.

  **Imports necesarios:**
  ```ts
  import { useEffect, useCallback } from "react";
  ```

  - **Assigned to:** Developer
  - **Dependencies:** Task 2.1

- **Task 2.3:** Crear `index.ts` con re-export:
  ```ts
  export { GitIntegrationModal } from "./GitIntegrationModal.tsx";
  ```
  - **Assigned to:** Developer
  - **Dependencies:** Task 2.2

---

### 🔹 Phase 3: CSS — Clase modificadora `.modal--git`

**Description:**  
Agregar la clase CSS `.modal--git` que sobreescribe las dimensiones del `.modal` base para cumplir el requisito de mínimo 50% de ancho y 80% de alto. También agregar `.git-modal__body` para que el body ocupe el espacio disponible.

**Archivo:** `src/ui/styles/app.css`

**Ubicación de inserción:** Inmediatamente después del bloque `.modal__footer` (línea ~1661), antes del comentario `/* ── Shared button primitives */`.

**Tasks:**

- **Task 3.1:** Insertar el siguiente bloque CSS:

  ```css
  /* ── Git Integration Modal — size overrides ────────────────────────────── */
  /* Overrides .modal base dimensions to meet the 50vw / 80vh requirement.   */
  /* All other visual styles (.modal__header, .modal__body, etc.) are shared. */

  .modal--git {
    min-width: min(50vw, 90vw);   /* 50% viewport width, capped at 90vw on small screens */
    max-width: min(80vw, 1200px); /* generous max for large screens */
    min-height: 80vh;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;             /* el scroll lo maneja .git-modal__body */
  }

  .git-modal__body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;                /* necesario para que flex + overflow funcione */
  }

  .git-modal__placeholder {
    color: var(--color-text-muted);
    font-size: 0.9rem;
    text-align: center;
    padding: 2rem 0;
  }
  ```

  **Notas de diseño:**
  - `min-width: min(50vw, 90vw)` garantiza 50% en pantallas grandes y no desborda en pantallas pequeñas.
  - `min-height: 80vh` cumple el requisito de 80% de alto.
  - `display: flex; flex-direction: column` + `flex: 1` en `.git-modal__body` hace que el body ocupe todo el espacio vertical disponible entre header y footer.
  - `overflow: hidden` en `.modal--git` + `overflow-y: auto` en `.git-modal__body` asegura scroll interno correcto.
  - El `.modal` base tiene `overflow-y: auto` — al agregar `overflow: hidden` en `.modal--git` se sobreescribe correctamente.

  - **Assigned to:** Developer
  - **Dependencies:** ninguna

---

### 🔹 Phase 4: Header — Agregar botón "Git" en `EditorView`

**Description:**  
Agregar el botón `⎇ Git` en el `div.editor-view__topbar-actions` de `EditorView`, posicionado **después de `<AgentGraphSaveButton />`** y **antes del botón `Export JSON`**.

**Archivo:** `src/ui/App.tsx`

**Tasks:**

- **Task 4.1:** Importar las acciones del store en `EditorView`:
  ```ts
  const openGitModal = useAgentFlowStore((s) => s.openGitModal);
  ```
  (junto a `openExportModal`, línea ~127)
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1 completa

- **Task 4.2:** Insertar el botón en el JSX del header, entre `<AgentGraphSaveButton />` y el botón `Export JSON` (líneas ~249–256):

  ```tsx
  <AgentGraphSaveButton />
  <button
    className="editor-view__topbar-btn"
    onClick={openGitModal}
    title="Open Git Integration panel"
  >
    ⎇ Git
  </button>
  <button
    className="editor-view__topbar-btn"
    onClick={openExportModal}
    title="Export project as OpenCode configuration"
  >
    Export JSON
  </button>
  ```

  **Notas UX:**
  - El emoji `⎇` (U+2387, símbolo de rama/alternativa) es el mismo que se usa en el `git-remote-badge` existente (línea 216 de App.tsx), manteniendo coherencia visual.
  - `title="Open Git Integration panel"` provee tooltip accesible.
  - La clase `editor-view__topbar-btn` es idéntica a los demás botones del header.

  - **Assigned to:** Developer
  - **Dependencies:** Task 4.1

---

### 🔹 Phase 5: Portal — Montar `GitIntegrationModal` en `App.tsx`

**Description:**  
Registrar el portal del modal Git en el componente `App`, siguiendo el patrón exacto de `ExportModal`.

**Archivo:** `src/ui/App.tsx`

**Tasks:**

- **Task 5.1:** Agregar import del componente:
  ```ts
  import { GitIntegrationModal } from "./components/GitIntegrationModal/index.ts";
  ```
  (junto a los demás imports de modales, líneas ~48–50)
  - **Assigned to:** Developer
  - **Dependencies:** Phase 2 completa

- **Task 5.2:** Leer estado y acción del store en el componente `App`:
  ```ts
  const gitModalOpen = useAgentFlowStore((s) => s.gitModalOpen);
  const closeGitModal = useAgentFlowStore((s) => s.closeGitModal);
  ```
  (junto a `exportModalOpen` / `closeExportModal`, líneas ~578–579)
  - **Assigned to:** Developer
  - **Dependencies:** Phase 1 completa

- **Task 5.3:** Agregar el portal en el JSX de `App`, inmediatamente después del portal de `ExportModal` (línea ~694):

  ```tsx
  {/* ── Git Integration modal — global portal, above ALL overlays ──────── */}
  {/* Same portal pattern as ExportModal.                                   */}
  {gitModalOpen &&
    createPortal(
      <GitIntegrationModal onClose={closeGitModal} />,
      document.body,
    )}
  ```

  - **Assigned to:** Developer
  - **Dependencies:** Task 5.1, 5.2

---

## 📁 Resumen de Archivos

| Acción | Ruta | Descripción |
|--------|------|-------------|
| **MODIFICAR** | `src/ui/store/agentFlowStore.ts` | Agregar `gitModalOpen`, `openGitModal`, `closeGitModal` |
| **CREAR** | `src/ui/components/GitIntegrationModal/GitIntegrationModal.tsx` | Componente modal |
| **CREAR** | `src/ui/components/GitIntegrationModal/index.ts` | Re-export |
| **MODIFICAR** | `src/ui/styles/app.css` | Agregar `.modal--git`, `.git-modal__body`, `.git-modal__placeholder` |
| **MODIFICAR** | `src/ui/App.tsx` | Botón en header + portal del modal |

---

## ⚠️ Risks

- **Conflicto de z-index:** El modal usa `z-index: 10002` (heredado de `.modal-backdrop`). Si en el futuro se agregan overlays con z-index mayor, revisar la jerarquía. Por ahora es consistente con todos los demás modales.
- **Scroll en `.modal--git`:** Al sobreescribir `overflow: hidden` del `.modal` base, el scroll se delega a `.git-modal__body`. Si el developer agrega contenido sin usar `.git-modal__body`, el scroll puede romperse. Documentado en el componente.
- **`min-width: 50vw` en pantallas pequeñas:** En viewports < 600px, `50vw` puede ser demasiado estrecho. El `min(50vw, 90vw)` no ayuda aquí — considerar un media query si se necesita soporte móvil en el futuro.

---

## 📝 Notes

- **Patrón de portal:** Todos los modales globales del proyecto se montan en `document.body` vía `createPortal` para escapar cualquier stacking context. Este modal sigue el mismo patrón.
- **Contenido del modal:** El plan solo especifica la estructura y el placeholder. El contenido funcional de Git (status, commit, push, pull, etc.) es responsabilidad de una fase futura.
- **Emoji del botón:** `⎇` (U+2387) ya se usa en el `git-remote-badge` del mismo header (línea 216 de App.tsx), lo que crea coherencia visual sin introducir nuevos iconos.
- **No se necesita hook personalizado:** La lógica de apertura/cierre es trivial (booleano en store). No justifica un hook separado.
- **TypeScript:** No se necesitan nuevos tipos. `GitIntegrationModalProps` es un objeto simple con `onClose: () => void`.
