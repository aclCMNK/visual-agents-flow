# Plan estratégico: Modal "Clone from Git" (adaptado al stack real)

## Resumen ejecutivo

Este documento describe el plan final, adaptado al stack real del editor AgentsFlow (React 19 + Zustand + Electron IPC vía window.agentsFlow). El objetivo es implementar un modal "Clone from Git" que permita clonar un repositorio Git como nuevo proyecto de AgentsFlow, integrarlo con la pantalla ProjectBrowser y mantener consistencia con las convenciones existentes (componentes en src/ui/components, estilos en src/ui/styles/app.css, stores en src/ui/store).

Puntos clave del stack real y convenciones a respetar:
- UI: React 19. El editor está en src/ui/ (no src/renderer/).
- State: Zustand stores en src/ui/store/projectStore.ts y agentFlowStore.ts.
- IPC / bridge: comunicación con Electron a través de window.agentsFlow (tipos definidos en src/electron/bridge.types.ts).
- Modales: componentes simples en src/ui/components/ (p. ej. NewProjectModal.tsx, AgentEditModal.tsx). No se usan portales complejos.
- CSS: reutilizar variables y utilidades en src/ui/styles/app.css (.btn, .form-field, .modal, variables de color y radios).

Este plan es la fuente de verdad para comenzar la implementación.

## Bloques estratégicos

1) Diseño del bridge / IPC
- Añadir al bridge (src/electron/bridge.types.ts + preload/main handlers) las APIs necesarias para clonar repositorios Git. Propuesta de métodos (nombres a confirmar en revisión técnica):
  - cloneRepository(req: { url: string; targetDir: string; options?: { depth?: number } }): Promise<{ success: boolean; projectDir?: string; error?: string }>;
  - validateCloneTargetDir(dir: string): Promise<{ valid: boolean; message: string; severity?: 'ok'|'warn'|'error' }>;

Nota: si se prefiere reutilizar selectNewProjectDir / validateNewProjectDir existente, documentar esa decisión en "Puntos de decisión técnica" y mantener compatibilidad.

2) Modificaciones al projectStore (src/ui/store/projectStore.ts)
- Añadir estado y acciones relevantes:
  - Estado: isCloning: boolean;
  - Acción: async cloneProjectFromGit(payload: { url: string; targetDir: string; name?: string }): Promise<{ success: boolean; error?: string }>;

- Comportamiento esperado de cloneProjectFromGit:
  1. set({ isCloning: true, lastError: null })
  2. Invocar bridge.cloneRepository({ url, targetDir })
  3. Si clone falla → set({ isCloning: false, lastError }) y devolver error
  4. Si clone succeed y devuelve projectDir → invocar bridge.loadProject({ projectDir }) para cargar el proyecto y navegar a editor (igual que createProject flow)

- Reutilizar selectNewProjectDir y validateNewProjectDir para elección y validación del directorio padre (el modal debe crear o usar una subcarpeta basada en el repo name). Esto mantiene consistencia con NewProjectModal.

3) Integración en ProjectBrowser.tsx
- Añadir botón "From Git" en la sección de acciones junto a New Project y Open Project Folder (referencia: src/ui/components/ProjectBrowser.tsx, línea ~72–103). Este botón abrirá el nuevo modal CloneFromGitModal.

4) Nuevo componente modal: CloneFromGitModal
- Ubicación: src/ui/components/CloneFromGitModal.tsx
- Comportamiento y diseño coherente con NewProjectModal.tsx (estructura de modal-backdrop → .modal; cierre en Escape; backdrop click; mostrar errores en banner interno). Reutilizar clases de app.css: .modal, .modal__header, .modal__title, .modal__error-banner, .form-field, .btn, .form-field__hint, etc.

5) Lógica de autocompletado (nombre repo desde URL)
- Al introducir la URL Git, derivar automáticamente el nombre del repo para prellenar el campo "Project Name" y la subcarpeta destino.
- Función de ejemplo (TypeScript): extraer la última parte del path de la URL y remover sufijo `.git` y caracteres inválidos. Ver sección de ejemplos de código.

6) Flujo end-to-end
- Paso 1: Usuario abre ProjectBrowser → hace clic en "From Git" → abre CloneFromGitModal.
- Paso 2: Usuario pega URL del repo. La UI autocompleta "Project Name" (editable).
- Paso 3: Usuario hace clic en "Choose Folder" (usa selectNewProjectDir) o acepta default (por ejemplo, HOME/Projects). Se ejecuta validateNewProjectDir o validateCloneTargetDir.
- Paso 4: Usuario confirma "Clone". store.cloneProjectFromGit llama a window.agentsFlow.cloneRepository({ url, targetDir })
- Paso 5: Si clone falla → mostrar error. Si clone succeed → window.agentsFlow devuelve projectDir donde se creó repo; el store invoca loadProject({ projectDir }) y, si success, navega a editor (currentView: 'editor') igual que createProject.

7) Visual y CSS
- Reutilizar .modal, .modal__header, .modal__title, .modal__footer, .form-field, .btn, .form-field__input, .form-field__hint y utilidades existentes en src/ui/styles/app.css.
- Paleta: usar variables --color-primary / --color-error / --color-success para botones y mensajes.
- Tamaño y posicionamiento: mantener mismo ancho y formato que NewProjectModal para coherencia.

8) Integración con componentes existentes
- El modal seguirá la misma API de props que NewProjectModal: isOpen: boolean; onClose: () => void.
- ProjectBrowser.tsx añadirá estado local showCloneFromGitModal: boolean y renderizará <CloneFromGitModal isOpen={...} onClose={...} /> junto a <NewProjectModal /> (ver referencia en ProjectBrowser.tsx líneas 171–175).

## Ejemplos de código (React + TypeScript)

1) Inserción del botón en ProjectBrowser.tsx (extracto de cómo integrarlo):

```ts
// En src/ui/components/ProjectBrowser.tsx — dentro del bloque de acciones
const [showCloneFromGitModal, setShowCloneFromGitModal] = useState(false);

// En el JSX, junto a los botones actuales:
<button
  className="project-browser__btn project-browser__btn--secondary"
  onClick={() => setShowCloneFromGitModal(true)}
  disabled={isBusy}
>
  <span aria-hidden="true">🌐</span>
  From Git
</button>

{/* Render modal */}
<CloneFromGitModal
  isOpen={showCloneFromGitModal}
  onClose={() => setShowCloneFromGitModal(false)}
/>
```

2) Esqueleto de CloneFromGitModal.tsx (coherente con NewProjectModal)

```tsx
// src/ui/components/CloneFromGitModal.tsx
import React, { useState, useEffect, useRef } from "react";
import { useProjectStore } from "../store/projectStore";

interface Props { isOpen: boolean; onClose: () => void }

export function CloneFromGitModal({ isOpen, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const { isCloning, selectNewProjectDir, validateNewProjectDir, cloneProjectFromGit } = useProjectStore();

  useEffect(() => {
    if (isOpen) { setUrl(""); setName(""); setSelectedDir(null); setLocalError(null); }
  }, [isOpen]);

  // Autocomplete name from URL
  useEffect(() => {
    if (!url) return;
    try {
      const parsed = new URL(url.includes("://") ? url : `https://${url}`);
      const repoName = (parsed.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "").replace(/\.git$/i, "");
      if (repoName && !name) setName(repoName);
    } catch {
      // ignore invalid URL while typing
    }
  }, [url]);

  const handleChooseDir = async () => {
    const dir = await selectNewProjectDir();
    if (dir) setSelectedDir(dir);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !selectedDir) return setLocalError("URL and target folder are required");
    setLocalError(null);
    const result = await cloneProjectFromGit({ url, targetDir: selectedDir, name: name || undefined });
    if (!result.success) setLocalError(result.error ?? "Clone failed");
    else onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" onClick={(e)=>{ if (e.target===e.currentTarget && !isCloning) onClose(); }}>
      <div className="modal clone-from-git-modal">
        <header className="modal__header"><h2 className="modal__title">Clone from Git</h2></header>
        {localError && <div className="modal__error-banner">{localError}</div>}
        <form className="modal__body" onSubmit={handleSubmit}>
          <div className="form-field">
            <label>Repository URL</label>
            <input className="form-field__input" value={url} onChange={(e)=>setUrl(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Project Name</label>
            <input className="form-field__input" value={name} onChange={(e)=>setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Location</label>
            <div className="form-field__dir-row">
              <span className="form-field__dir-path">{selectedDir ?? <em>No folder selected</em>}</span>
              <button type="button" className="btn btn--secondary" onClick={handleChooseDir}>Choose Folder</button>
            </div>
          </div>
          <footer className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={isCloning}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={isCloning}> {isCloning ? 'Cloning…' : 'Clone'} </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
```

3) Cambio propuesto en projectStore: agregar estado y acción (extracto)

```ts
// En src/ui/store/projectStore.ts — añadir al estado inicial
isCloning: false,

// En las acciones:
async cloneProjectFromGit({ url, targetDir, name }) {
  set({ isCloning: true, lastError: null });
  try {
    const bridge = getBridge();
    const res = await bridge.cloneRepository({ url, targetDir });
    if (!res.success || !res.projectDir) {
      set({ isCloning: false, lastError: res.error ?? 'Clone failed' });
      return { success: false, error: res.error };
    }
    // Load cloned project
    const loadRes = await bridge.loadProject({ projectDir: res.projectDir });
    set({ isCloning: false, lastLoadResult: loadRes });
    if (loadRes.success && loadRes.project) {
      set({ project: loadRes.project, currentView: loadRes.issues.length > 0 ? 'validation' : 'editor' });
    } else {
      set({ project: null, currentView: 'validation', lastError: 'Project cloned but could not be loaded.' });
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({ isCloning: false, lastError: message });
    return { success: false, error: message };
  }
}
```

4) Función utilitaria: derivar nombre desde URL

```ts
export function repoNameFromUrl(input: string): string | null {
  if (!input) return null;
  try {
    const u = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (!seg) return null;
    return seg.replace(/\.git$/i, '');
  } catch {
    // fallback: try manual parse
    const parts = input.split('/').filter(Boolean);
    const last = parts.pop();
    return last ? last.replace(/\.git$/i, '') : null;
  }
}
```

## Estructura de archivos (REAL del editor — rutas existentes relevantes)

- src/ui/
  - components/
    - ProjectBrowser.tsx (referencia: línea 178)
    - NewProjectModal.tsx (referencia: línea 348)
    - AgentEditModal.tsx
    - ...
  - store/
    - projectStore.ts (referencia: línea 537)
    - agentFlowStore.ts
  - styles/
    - app.css (variables, .btn, .form-field, .modal)
  - assets/
    - logos/logo editor.svg
- src/electron/
  - bridge.types.ts (window.agentsFlow contract)

Nota: el editor no tiene FolderExplorer ni src/renderer/services/ipc.ts. La comunicación es vía window.agentsFlow conforme a bridge.types.ts.

## Puntos de decisión técnica (para revisar antes de implementar)

1) Reutilizar vs. crear nuevos canales IPC
- Opción A (recomendada para claridad): Añadir canales específicos para Git: IPC_CHANNELS.CLONE_REPOSITORY (renderer→main invoke) y VALIDATE_CLONE_TARGET_DIR (si se necesitan validaciones específicas post-clone).
- Opción B: Reutilizar SELECT_NEW_PROJECT_DIR + validateNewProjectDir + createProject pattern y ejecutar git clone desde main en createProject si payload.url presente. Menos cambios en bridge.types.ts pero mezcla de responsabilidades.

2) Directorio destino y subdirectorio
- Decidir si cloneRepository debe crear la subcarpeta con el repo name o clonar exactamente en targetDir. Recomendación: clonación en targetDir/<repo-name> (coherente con NewProjectModal que siempre crea subdir).

3) Autenticación/credenciales para repos privados
- El bridge/main deberá exponer opciones para credenciales (env vars, prompt, SSH agent). Decidir mecanismo: abrir prompt nativo o usar existing keychain. Requiere coordinación con main process.

4) Validaciones pre-clone
- Reutilizar validateNewProjectDir para comprobar permisos y espacio, o añadir validateCloneTargetDir con chequeos adicionales (p. ej. existencia de carpeta con mismo nombre) y mensajes de severidad (ok/warn/error).

5) Manejo de errores y UX
- Definir catálogo de errores traducibles en UI: NETWORK, AUTH_REQUIRED, TARGET_EXISTS, IO_ERROR, UNKNOWN. Esto ayuda a mostrar CTA apropiadas (Retry, Enter credentials, Choose another folder).

## Hoja de ruta post-implementación (sprints / tareas)

Fase 1 — Infraestructura (1–2 días)
- Añadir IPC channel(s) y pruebas unitarias en bridge.types.ts + main handlers: cloneRepository, (opcional) validateCloneTargetDir.
- Revisar preload + window.agentsFlow exposición (preload ya define bridge.types contract).

Fase 2 — Store + Modal (2–3 días)
- Implementar cloneProjectFromGit en projectStore.ts, añadir isCloning flag y selectors.
- Crear CloneFromGitModal.tsx reutilizando patrón de NewProjectModal.
- Añadir botón en ProjectBrowser.tsx.

Fase 3 — UX polish y pruebas (1–2 días)
- Validaciones de URL, extracción de repo name, mensajes claros en errores.
- Asegurar estilos con app.css variables y ajustes responsivos.

Fase 4 — Edge cases y CI (1–2 días)
- Tests E2E (optionales) para flujos felices y errores (clon público, clon privado con cred failure, target exists).

## Riesgos conocidos y mitigaciones

- Credenciales/Repos privados: si no se define el flujo de autenticación, clonación de repos privados fallará. Mitigación: inicio con soporte a repos públicos; planear prompt de credenciales en fase posterior.
- Consistencia de paths: decidir de forma explícita la política de crear subdir con repo name para evitar sobrescribir contenido del usuario.
- Uso de API existente: si se reutiliza createProject para mezclar git behavior pueden surgir requisitos de migración; preferir un canal dedicado para claridad.

## Criterios de aceptación (QA)

- El botón "From Git" aparece en ProjectBrowser y abre el modal.
- Autocompletado: al pegar https://github.com/user/repo.git, el campo Project Name se rellena con "repo".
- Elegir carpeta funciona (selectNewProjectDir) y muestra validación.
- Clone inicia y muestra estado "Cloning…" en el botón, bloqueando cierra accidental.
- Tras clone exitoso, el proyecto se carga y la UI navega al editor (currentView === 'editor') o a validation si hay issues.
- Errores claros en modal y banner superior (lastError) cuando falla IPC.

## Pregunta #5 de memoria (clara y marcada)

PREGUNTA #5 DE MEMORIA:
¿Desea que esta decisión (introducir canal IPC cloneRepository y la acción projectStore.cloneProjectFromGit) se registre en la memoria persistente bajo topic_key `feature/clone-from-git`? Responda Sí para que proceda a guardar la observación.

---

Archivo para comenzar la implementación: crear `src/ui/components/CloneFromGitModal.tsx` y aplicar cambios propuestos en `src/ui/store/projectStore.ts`. Actualizar `src/electron/bridge.types.ts` para declarar el/los nuevo(s) canal(es) IPC y coordinar con main/preload.
