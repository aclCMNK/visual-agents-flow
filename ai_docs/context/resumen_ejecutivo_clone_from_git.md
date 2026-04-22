# RESUMEN EJECUTIVO — AgentsFlow (Clone from repo)

Documento entregable para stakeholders técnicos. Resumen accionable y referenciado al código existente.

1) Objetivo del proyecto
-------------------------
- Construir una aplicación de escritorio (Electron) para diseñar, editar y exportar flujos agénticos (AgentsFlow). La UI es React; el manejo de estado principal usa Zustand; la carga/validación de proyectos se ejecuta en el proceso principal (ProjectLoader).

2) Stack técnico confirmado
---------------------------
- Frontend: React (paquete `react` en package.json)
- State management: Zustand (`zustand` en package.json)
- Shell / Desktop: Electron (dependencia `electron`)
- Validación de esquemas: Zod (`zod` en package.json)

Referencias directas en repo: `package.json`, `docs/ELECTRON_INTEGRATION.md`.

3) Bloques estratégicos ordenados (secuencia mínima de implementación)
-----------------------------------------------------------------
1. Entorno y scaffold
   - Ver `package.json` scripts; asegurar `electron:dev` y `electron:build` funcionan localmente.
2. Schemas y modelado de datos
   - Definir y congelar Zod schemas (base para store y loader).
   - Archivos relevantes: `src/schemas/afproj.schema.ts`, `src/schemas/adata.schema.ts` (documentados en `docs/`).
3. Capa de carga/validación (main process)
   - Mantener ProjectLoader en main process.
   - Archivos clave: `src/loader/project-loader.ts`, `src/electron/ipc-handlers.ts`.
4. Bridge IPC y preload
   - Exponer API tipada vía `contextBridge` (preload) y mantener `contextIsolation: true`.
   - Archivos: `src/electron/preload.ts`, `src/electron/bridge.types.ts`, `src/electron/ipc-handlers.ts`.
5. Zustand store y persistencia
   - Implementar store con hooks que consuman `window.agentsFlow` (preload bridge).
   - Refs: `src/renderer/services/ipc.ts`, `src/renderer/hooks/useFolderExplorer.ts`.
6. UI core: Project Browser + Editor + Validation
   - Componentes iniciales: `src/renderer/components/FolderExplorer/FolderExplorer.tsx`, `src/renderer/components/*`.
7. Import/Export, migraciones y persistencia local
   - Import/export JSON con validación Zod; migraciones en carga de persistencia.
   - Refs en docs: `docs/ESTIMACIONES_MVP.md` y `src/loader`.
8. QA, CI y empaquetado
   - `bun test`, typecheck y empaquetado con `electron-builder` (scripts en `package.json`).

4) Integración con arquitectura existente (archivos reales)
-----------------------------------------------------------
- Entrada Electron / Main: `src/electron/main.ts` (crea BrowserWindow, lifecycle).
- Preload / Bridge: `src/electron/preload.ts` y contratos en `src/electron/bridge.types.ts`.
- IPC handlers: `src/electron/ipc-handlers.ts` — conecta a `ProjectLoader`.
- Project loader y utilidades: `src/loader/project-loader.ts`, `src/loader/project-factory.ts`, `src/loader/file-reader.ts`.
- Renderer (UI): `src/renderer/` (components, hooks, services). Ej.: `src/renderer/services/ipc.ts` y `src/renderer/hooks/useFolderExplorer.ts`.
- Documentación de integración: `docs/ELECTRON_INTEGRATION.md` (diagrama y ejemplos de flujo: abrir proyecto → validar → renderizar).

Snippet (ejemplo de uso desde el store):
```ts
// store call (renderer)
const result = await window.agentsFlow.loadProject({ projectDir });
```

5) Decisiones técnicas principales (3–4 puntos clave)
---------------------------------------------------
1. Mantener ProjectLoader en el proceso principal (main)
   - Motivo: operaciones I/O y validación intensiva deben ejecutarse fuera del renderer por seguridad y rendimiento. (Ver `src/loader/*` y `src/electron/ipc-handlers.ts`).
2. Exponer una API tipada y limitada desde preload (`contextBridge`) con `contextIsolation: true`
   - Motivo: seguridad (evita exponer `ipcRenderer` completo). Contratos en `src/electron/bridge.types.ts` y `src/electron/preload.ts`.
3. Zustand para estado local y persistencia ligera (localStorage) con migraciones explícitas
   - Motivo: API simple, baja fricción para UI; definir migraciones para evitar roturas con datos legacy (ver `docs/ESTIMACIONES_MVP.md` — riesgo R3).
4. Validación centralizada con Zod
   - Motivo: evitar discrepancias entre loader, store y UI; los schemas son la fuente de verdad. Archivos de schemas y referencias en `docs/`.

6) Timeline estimado (fases y duración)
-------------------------------------
- Sprint 0 — Preparación (1–2 días)
  - Clonar, instalar deps, verificar scripts `electron:dev` y `typecheck`.
- Sprint 1 — Fundamentos (5 días)
  - Schema Zod (congelar), scaffold, iniciar Zustand store. (Ver `docs/ESTIMACIONES_MVP.md` — Semana 1)
- Sprint 2 — Core funcional (5 días)
  - CRUD en store, integración IPC (preload/ipc-handlers), ProjectBrowser mínimo.
- Sprint 3 — UI y features (5–7 días)
  - AgentEditor, SubagentList, Import/Export JSON, persistencia con migraciones.
- Sprint 4 — QA y empaquetado (3–5 días)
  - Tests, CI, correcciones, build & packaging (`electron-builder`).

Estimación total MVP: 3–4 semanas con 2 devs (ver `docs/ESTIMACIONES_MVP.md`).

7) Criterios de éxito (aceptación)
---------------------------------
- Funcionales
  1. Abrir carpeta de proyecto en UI y mostrar resultado sin bloquear la UI (IPC → ProjectLoader en main).
  2. Validar proyecto (dry-run) y mostrar errores/warnings en panel de validación (UI).
  3. CRUD básico de agentes en la UI con persistencia local y export JSON válido que pasa Zod.
  4. Empaquetado cross-platform (Windows AppImage/NSIS y Linux AppImage) funciona con los scripts provistos.
- No funcionales
  1. `contextIsolation: true` y bridge tipado utilizado (no exposición directa de `ipcRenderer`).
  2. Tests de integración básicos corren en CI (`bun test` y typecheck pasan).

Medición: checklist automatizable (tests + smoke flows) para cada ítem.

8) Pregunta #5 de memoria — ESTADO
---------------------------------
- Petición del usuario: "Pregunta #5 de memoria claramente señalada".
- Estado actual: No existe en el repositorio ni en la documentación una referencia explícita llamada "Pregunta #5". No puedo inventar su contenido.
- Acción requerida (inmediata): Por favor proveer el texto exacto de la "Pregunta #5 de memoria" o el key de memoria al que se refiere para que sea incluida y respondida en este documento.

Anexos / Referencias rápidas (archivos relevantes en repo)
- package.json — confirmación de dependencias (React, Zustand, Zod, Electron)
- docs/ELECTRON_INTEGRATION.md — diagrama y flujo IPC
- docs/ESTIMACIONES_MVP.md — estimaciones y riesgos
- src/electron/preload.ts, src/electron/bridge.types.ts, src/electron/ipc-handlers.ts
- src/loader/project-loader.ts, src/loader/*
- src/renderer/services/ipc.ts, src/renderer/hooks/useFolderExplorer.ts, src/renderer/components/FolderExplorer/FolderExplorer.tsx

Contacto / siguiente paso inmediato
- Asignar 1 dev para Sprint 0 (setup) y 1 dev para Sprint 1 (schema + store). Start: clonar y correr `bun run electron:dev`.
- Proveer la "Pregunta #5 de memoria" para completarla en la próxima versión del resumen.
