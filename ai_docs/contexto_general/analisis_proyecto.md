# 🧠 Análisis Estructural y Contextual — AgentsFlow

> **Fecha de análisis:** 2026-04-30  
> **Versión del proyecto:** 0.1.1  
> **Ruta del workspace:** `/home/kamiloid/projs/drassMemorIA/editors/agentsFlow`

---

## 🎯 Propósito del Proyecto

**AgentsFlow** es una aplicación de escritorio (Electron + React) diseñada para **diseñar, visualizar y orquestar flujos de trabajo agénticos** para proyectos basados en **OpenCode**.

Su objetivo central es permitir que usuarios (técnicos y no técnicos) construyan grafos de agentes de forma visual — sin necesidad de editar archivos de configuración manualmente. Cada agente tiene un perfil Markdown, metadatos estructurados (`.adata`), aspectos de comportamiento, skills y subagentes.

El proyecto es parte del ecosistema **DrassMemorIA** y actúa como editor visual para los archivos de configuración que OpenCode consume.

---

## 📐 Alcance

| Área | Estado |
|------|--------|
| Editor visual de flujos (canvas drag & drop) | ✅ Implementado |
| Gestión de agentes (crear, editar, renombrar, eliminar) | ✅ Implementado |
| Persistencia en archivos `.afproj` y `.adata` | ✅ Implementado |
| Sincronización automática de `permissions.task` | ✅ Implementado |
| Panel de propiedades por nodo | ✅ Implementado |
| Gestión de Assets (archivos `.md`) | ✅ Implementado |
| Exportación a JSON de configuración OpenCode | ✅ Implementado |
| Integración Git (remote, branch, cambios) | ✅ Implementado |
| Perfiles de agente (editor Monaco) | ✅ Implementado |
| Panel de permisos por agente | ✅ Implementado |
| Validación de proyecto con reporte de errores/warnings | ✅ Implementado |
| Clonado de proyectos desde Git | ✅ Implementado |
| Soporte macOS | ⏳ Pendiente |
| Tests automatizados | ⚠️ Parcial (estructura presente, cobertura desconocida) |

---

## 🗂️ Estructura de Carpetas y Archivos Principales

```
agentsFlow/
├── src/
│   ├── electron/               # Proceso principal de Electron
│   │   ├── main.ts             # Entry point del proceso principal
│   │   ├── preload.ts          # Script de preload (expone API en window.agentsFlow)
│   │   ├── bridge.types.ts     # Contratos IPC entre main y renderer (tipos serializables)
│   │   ├── ipc-handlers.ts     # Registro de todos los handlers IPC (~3162 líneas)
│   │   ├── adata-builder.ts    # Constructor de archivos .adata
│   │   ├── git-*.ts            # Módulos de integración Git (branches, changes, config, detector)
│   │   ├── permissions-handlers.ts
│   │   ├── profile-handlers.ts
│   │   ├── skills-handlers.ts
│   │   ├── opencode-config-handlers.ts
│   │   ├── export-file-backup.ts
│   │   ├── rename-agent-folder.ts
│   │   └── skill-export-handlers.ts
│   │
│   ├── ui/                     # Proceso renderer (React)
│   │   ├── App.tsx             # Componente raíz — router de vistas
│   │   ├── main.tsx            # Entry point del renderer
│   │   ├── store/
│   │   │   ├── agentFlowStore.ts   # Zustand: estado del canvas visual (~785 líneas)
│   │   │   ├── projectStore.ts     # Zustand: estado del proyecto cargado
│   │   │   └── assetStore.ts       # Zustand: gestión de assets .md
│   │   ├── components/
│   │   │   ├── FlowCanvas.tsx      # Canvas principal (~1814 líneas) — corazón del editor
│   │   │   ├── AgentEditModal.tsx  # Modal de edición de agente
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentTreeItem.tsx
│   │   │   ├── AgentCanvasSaveButton.tsx
│   │   │   ├── AgentGraphSaveButton.tsx
│   │   │   ├── PropertiesPanel.tsx
│   │   │   ├── ValidationPanel.tsx
│   │   │   ├── ProjectBrowser.tsx
│   │   │   ├── ProjectSaveBar.tsx
│   │   │   ├── NewProjectModal.tsx
│   │   │   ├── CloneFromGitModal.tsx
│   │   │   ├── RepoVisibilityBadge.tsx
│   │   │   ├── CredentialsBlock.tsx
│   │   │   ├── AgentProfiling/     # Editor de perfil Markdown (Monaco)
│   │   │   ├── AssetPanel/         # Gestor de archivos .md
│   │   │   ├── ExportModal/        # Modal de exportación JSON
│   │   │   ├── GitIntegrationModal/ # Modal de integración Git
│   │   │   └── Permissions/        # Modal de permisos por agente
│   │   ├── hooks/
│   │   │   ├── useElectronBridge.ts  # Hook principal de comunicación IPC
│   │   │   ├── useAgentGraphSave.ts
│   │   │   ├── useDragDropAssets.ts
│   │   │   ├── useEditorConfig.ts
│   │   │   ├── useGitBranches.ts
│   │   │   ├── useGitChanges.ts
│   │   │   └── useGitConfig.ts
│   │   ├── i18n/
│   │   │   └── en.ts               # Strings en inglés (i18n preparado pero solo EN)
│   │   ├── styles/
│   │   │   ├── app.css
│   │   │   └── app2.css            # ⚠️ Deuda: dos archivos CSS sin separación clara
│   │   └── utils/
│   │
│   ├── loader/                 # Carga y validación de proyectos (proceso main)
│   │   ├── project-loader.ts   # Orquestador de carga
│   │   ├── project-factory.ts  # Creación de nuevos proyectos
│   │   ├── schema-validator.ts # Validación con Zod
│   │   ├── cross-validator.ts  # Validaciones cruzadas entre archivos
│   │   ├── repairer.ts         # Reparación automática de proyectos corruptos
│   │   ├── file-reader.ts      # Lectura de archivos del proyecto
│   │   ├── lock-manager.ts     # Escritura atómica de JSON
│   │   ├── types.ts            # Tipos internos del loader
│   │   ├── index.ts
│   │   └── LOADER_README.md    # Documentación interna del loader
│   │
│   ├── schemas/                # Schemas Zod compartidos
│   │   ├── adata.schema.ts     # Schema del archivo .adata (metadatos de agente)
│   │   ├── afproj.schema.ts    # Schema del archivo .afproj (descriptor de proyecto)
│   │   └── index.ts
│   │
│   ├── shared/
│   │   └── syncTaskEntries.ts  # Lógica compartida para sincronizar permissions.task
│   │
│   ├── storage/
│   │   ├── adata.ts            # Operaciones de lectura/escritura de .adata
│   │   ├── profiles.ts         # Gestión de perfiles Markdown
│   │   ├── node-file-adapter.ts
│   │   └── migrate-profiles.ts # Migración de perfiles legacy
│   │
│   ├── types/
│   │   └── agent.ts            # Tipos de dominio del agente
│   │
│   └── renderer/               # Capa de renderer (separada de ui/)
│       ├── components/FolderExplorer/
│       ├── hooks/useFolderExplorer.ts
│       └── services/ipc.ts
│
├── electron-main/              # ⚠️ Directorio adicional (posible legacy/duplicado)
│   └── src/
│
├── tests/                      # Tests (Bun test runner)
│   ├── electron/
│   ├── loader/
│   ├── shared/
│   ├── storage/
│   └── ui/
│
├── ai_docs/                    # Documentación interna para agentes IA
│   ├── context/
│   ├── specs/
│   ├── testing/
│   ├── ui/
│   └── ...
│
├── .sdd/                       # Software Design Documents (exploraciones)
├── docs/                       # Documentación pública
├── public/                     # Assets estáticos (banner, Monaco editor)
├── dist/                       # Build output
├── index.html                  # Entry HTML del renderer
├── index.ts                    # Entry alternativo (posible legacy)
├── vite.config.ts              # Configuración Vite + Electron
├── tsconfig.json
├── package.json
└── bun.lock
```

---

## 🛠️ Tecnologías y Dependencias

### Runtime & Framework
| Tecnología | Versión | Rol |
|-----------|---------|-----|
| **Electron** | ^41.1.1 | Shell de escritorio multiplataforma |
| **React** | ^19.2.4 | UI del renderer |
| **Vite** | ^8.0.5 | Bundler y dev server |
| **TypeScript** | ^5 | Tipado estático |
| **Bun** | latest | Test runner |

### Dependencias de Producción
| Librería | Versión | Uso |
|---------|---------|-----|
| **Zustand** | ^5.0.12 | Estado global (stores) |
| **Zod** | ^4.3.6 | Validación de schemas |
| **@monaco-editor/react** | ^4.7.0 | Editor de código/Markdown |
| **marked** | ^18.0.0 | Renderizado de Markdown |

### Herramientas de Desarrollo
| Herramienta | Uso |
|------------|-----|
| **Biome** | Linting (reemplaza ESLint/Prettier) |
| **vite-plugin-electron** | Integración Vite ↔ Electron |
| **electron-builder** | Empaquetado para distribución |
| **cross-env** | Variables de entorno cross-platform |

### Formatos de Archivo Propios
| Extensión | Descripción |
|-----------|-------------|
| `.afproj` | Descriptor de proyecto (JSON, schema Zod) |
| `.adata` | Metadatos de agente (JSON, schema Zod) |

---

## 🏗️ Arquitectura General

```
┌─────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                 │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ ipc-handlers │  │   loader/    │  │   storage/    │  │
│  │  (~3162 ln)  │  │  (validar,   │  │  (adata,      │  │
│  │              │  │   cargar,    │  │   profiles)   │  │
│  │  IPC_CHANNELS│  │   reparar)   │  │               │  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │ IPC (structured clone)                         │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────┐
│         │         PRELOAD (bridge)                       │
│  window.agentsFlow.* (API expuesta al renderer)          │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────┐
│         │         RENDERER (React)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ projectStore │  │agentFlowStore│  │  assetStore   │  │
│  │  (Zustand)   │  │  (Zustand)   │  │  (Zustand)    │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                    App.tsx                        │    │
│  │  browser → validation → editor → assets          │    │
│  │                                                   │    │
│  │  EditorView:                                      │    │
│  │    Sidebar (AgentTreeItem) + FlowCanvas           │    │
│  │    + PropertiesPanel                              │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Flujo de datos principal
1. Usuario abre/crea proyecto → `ProjectBrowser` → IPC `LOAD_PROJECT`
2. Main process: `ProjectLoader` lee `.afproj` + todos los `.adata` → valida con Zod → cross-valida
3. Resultado serializable llega al renderer → `projectStore` lo almacena
4. `App.tsx` detecta cambio de `project.id` → hidrata `agentFlowStore` con `loadFromProject()`
5. `FlowCanvas` renderiza nodos y links desde `agentFlowStore`
6. Cambios en canvas → `agentFlowStore` → al guardar: IPC `SAVE_AGENT_GRAPH` → main escribe `.afproj`

---

## 🔄 Flujo de Trabajo y Convenciones

### Convenciones de Código
- **Lenguaje:** TypeScript estricto, ESM (`"type": "module"`)
- **Linting:** Biome (`biome check src/`)
- **Naming:** camelCase para variables/funciones, PascalCase para componentes y tipos
- **Slugs de agentes:** solo `[a-z0-9-]`, 2–64 chars, sin guiones al inicio/fin
- **IDs de agentes:** UUID v4 (generados en cliente con función propia, sin deps externas)
- **Stores:** Zustand con selectores individuales (evitar re-renders innecesarios)
- **IPC:** todos los canales definidos en `IPC_CHANNELS` (bridge.types.ts), nunca strings sueltos
- **Escritura de archivos:** siempre vía `atomicWriteJson` (lock manager) para evitar corrupción
- **Modales globales:** montados con `createPortal` en `document.body` para escapar stacking contexts

### Estructura de un Proyecto AgentsFlow en disco
```
<project-dir>/
├── <name>.afproj           # Descriptor principal del proyecto
├── behaviors/
│   └── <agentId>/
│       ├── profile.md      # Perfil compilado del agente
│       └── <aspectId>.md   # Aspectos de comportamiento
├── metadata/
│   └── <agentId>.adata     # Metadatos del agente (JSON)
└── skills/
    └── <skillId>.md        # Skills compartidos
```

### Vistas de la aplicación
| Vista | Descripción |
|-------|-------------|
| `browser` | Explorador de proyectos (abrir, crear, clonar) |
| `validation` | Panel de errores y warnings del proyecto cargado |
| `editor` | Editor principal (canvas + sidebar + properties) |
| `assets` | Gestor de archivos Markdown del proyecto |

---

## ⚠️ Puntos Críticos y Deudas Técnicas

### 🔴 Críticos

1. **`ipc-handlers.ts` monolítico (~3162 líneas)**  
   Todos los handlers IPC están en un único archivo. Es el archivo más grande del proyecto y concentra demasiada responsabilidad. Dificulta el mantenimiento, testing y onboarding.

2. **`bridge.types.ts` también muy grande (~2869 líneas)**  
   Los contratos IPC están mezclados con lógica de tipos en un solo archivo. Debería dividirse por dominio (project, agent, git, export, etc.).

3. **`FlowCanvas.tsx` (~1814 líneas)**  
   El canvas visual es un componente monolítico. Contiene lógica de drag, zoom, pan, rendering de nodos, links, ghost nodes y más. Candidato prioritario a refactorización.

### 🟡 Deudas Técnicas Moderadas

4. **Dos archivos CSS (`app.css` y `app2.css`)**  
   Sin separación clara de responsabilidades. Indica crecimiento orgánico sin estructura CSS definida.

5. **Directorio `electron-main/` posiblemente legacy**  
   Existe un directorio `electron-main/src/` que no está referenciado en `vite.config.ts`. Podría ser un residuo de una arquitectura anterior.

6. **`index.ts` en la raíz**  
   Archivo en la raíz del proyecto cuyo propósito no es evidente (posible legacy o entry alternativo sin uso activo).

7. **Cobertura de tests desconocida**  
   La estructura de tests existe (`tests/electron/`, `tests/loader/`, etc.) pero no hay información sobre cobertura real ni si los tests están actualizados.

8. **i18n incompleto**  
   Solo existe `en.ts`. El README está en inglés y español, pero la app parece estar en inglés. La infraestructura i18n está preparada pero no expandida.

9. **UUID generado sin librería**  
   Se usa una función `uuid()` casera en `agentFlowStore.ts`. Funciona, pero no garantiza la misma calidad criptográfica que `crypto.randomUUID()` (disponible en Node y browsers modernos).

10. **`agentFlowStore.ts` (~785 líneas)**  
    El store del canvas es extenso. Mezcla lógica de placement, links, modales, sincronización de tasks y serialización. Podría dividirse en slices.

### 🟢 Puntos Positivos Destacables

- **Schemas Zod bien definidos** para `.afproj` y `.adata` con validaciones estrictas y mensajes claros.
- **Escritura atómica** de archivos JSON (lock manager) — previene corrupción en escrituras concurrentes.
- **Separación main/renderer** bien respetada: todo acceso al filesystem pasa por IPC.
- **Portales React** para modales globales — solución correcta para el problema de z-index.
- **Sincronización automática de `permissions.task`** al guardar el grafo — feature de alto valor.
- **Sistema de reparación** de proyectos corruptos (`repairer.ts`).
- **Documentación interna** en `ai_docs/` y `LOADER_README.md`.

---

## 🔍 Hallazgos Relevantes

### Modelo de datos de agente
Un agente en AgentsFlow tiene dos representaciones:
- **En `.afproj`:** referencia ligera (`AgentRef`) con id, name, profilePath, adataPath, posición en canvas
- **En `.adata`:** metadatos completos (aspectos, skills, subagentes, permisos, timestamps)

Los **subagentes** son entidades de segundo nivel: viven dentro del `.adata` de su agente padre y no tienen su propio `.adata`.

### Nodo "User"
Existe un nodo especial `user-node` que representa al usuario humano en el flujo. Es puramente visual — no genera archivos `.adata` ni aparece en la configuración de OpenCode. Su ID es la constante `"user-node"` (migrado desde `"user"` en versiones anteriores).

### Tipos de conexiones
Las conexiones entre agentes tienen semántica:
- `LinkRuleType`: `"Delegation"` | `"Response"`
- `DelegationType`: `"Optional"` | `"Mandatory"` | `"Conditional"`
- Tipo de conexión en schema: `"default"` | `"conditional"` | `"fallback"`

### Integración Git
La app tiene integración Git nativa (sin librerías externas): detecta remote origin, branch activo, cambios pendientes, y permite operaciones básicas desde la UI.

### Exportación
El proyecto puede exportarse como JSON de configuración OpenCode, con backup automático del archivo anterior si ya existe.

---

## 📦 Scripts Disponibles

```bash
npm run dev              # Dev server (web, sin Electron)
npm run electron:dev     # Dev con Electron
npm run build            # Build renderer
npm run electron:build   # Build completo + empaquetado
npm run build:win        # Instalador Windows (NSIS)
npm run build:linux      # AppImage Linux
npm run test             # Tests con Bun
npm run lint             # Biome check
npm run setup:monaco     # Copia Monaco editor a public/vs/
npm run typecheck        # TypeScript sin emit
```

---

## 🗺️ Mapa de Dependencias entre Módulos

```
src/ui/App.tsx
  └── store/projectStore.ts
  └── store/agentFlowStore.ts
        └── shared/syncTaskEntries.ts
        └── ui/utils/slugUtils.ts
  └── components/FlowCanvas.tsx
        └── store/agentFlowStore.ts
        └── store/projectStore.ts
  └── hooks/useElectronBridge.ts  ──→  window.agentsFlow (preload)

src/electron/main.ts
  └── ipc-handlers.ts
        └── loader/project-loader.ts
              └── loader/schema-validator.ts  ──→  schemas/
              └── loader/cross-validator.ts
              └── loader/file-reader.ts
              └── loader/repairer.ts
        └── storage/adata.ts
        └── storage/profiles.ts
        └── shared/syncTaskEntries.ts
        └── git-*.ts
```

---

*Documento generado por Weight-Planner — AgentsFlow v0.1.1*
