# 🧠 AgentsFlow — Resumen de Contexto del Proyecto

> Documento de onboarding para el equipo. Generado por Weight-Planner.  
> Fecha: Abril 2026

---

## 🎯 ¿Qué es AgentsFlow?

**AgentsFlow** es un editor de escritorio (Electron + React) diseñado para **diseñar y orquestar flujos de trabajo agénticos** para proyectos basados en **OpenCode**. Permite crear, visualizar y conectar agentes de forma visual — sin necesidad de editar archivos de configuración manualmente.

Es parte del ecosistema **DrassMemorIA**, actuando como la herramienta de diseño visual que complementa el runtime de agentes.

---

## 🏗️ Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Desktop shell | Electron 41 |
| UI | React 19 + Zustand + Vite |
| Validación | Zod (fuente única de tipos) |
| Editor de código | Monaco Editor |
| Tests | Bun test (532 tests passing) |
| Linter | Biome (⚠️ no instalado actualmente) |
| Plataformas | Windows, Linux (macOS próximamente) |

---

## ✅ Funcionalidades Implementadas

### Editor Visual de Flujos
- **FlowCanvas** — Canvas interactivo con zoom, pan, drag & drop de agentes y conexiones entre ellos (SVG links)
- **AgentCard** — Representación visual de cada agente en el canvas
- **PropertiesPanel** — Panel lateral para editar propiedades del agente seleccionado

### Gestión de Proyectos
- **ProjectBrowser** — Explorador para abrir/crear proyectos `.afproj`
- **NewProjectModal** — Wizard de creación de proyectos
- **ProjectSaveBar** — Barra de guardado con estado de cambios pendientes
- **ValidationPanel** — Panel que muestra errores y advertencias del proyecto

### Sistema de Agentes (`.adata`)
- Cada agente tiene un archivo `.adata` (JSON) con: `id`, `name`, `description`, `behaviors`, `subagents`, `metadata`, `profile`, `permissions`
- **AgentEditModal** — Modal para editar propiedades del agente
- **AgentProfiling** — Sistema de perfiles: asocia documentos `.md` a un agente por selector (`System Prompt`, `Memory`, `Tools`, `Rules`, `Persona`, etc.)
- **Permissions** — Modal para gestionar permisos y delegaciones entre agentes

### Sincronización Automática
- Al guardar el grafo, el campo `permissions.task` en cada `.adata` se actualiza automáticamente con los agentes a los que delega — sin acción manual
- Botón "Sincronizar delegaciones" disponible para sync bajo demanda

### Assets y Archivos
- **AssetPanel** — Explorador de archivos del proyecto con editor Monaco integrado
- **CloneFromGitModal** — Clonar repositorios (públicos y privados via credenciales)
- **ExportModal** — Exportar flujos

### Internacionalización
- Sistema i18n implementado en `src/ui/i18n/`

---

## 🗂️ Arquitectura en Capas

```
src/
├── ui/              → React components + Zustand stores (presentación + estado)
├── electron/        → IPC bridge (comunicación main ↔ renderer)
├── loader/          → Carga y validación de proyectos (lógica de negocio)
├── storage/         → Persistencia de perfiles y .adata (capa de datos)
├── schemas/         → Zod schemas: adata.schema.ts, afproj.schema.ts
└── types/           → Tipos de dominio (AgentProfile, etc.)
```

---

## ⚠️ Estado Actual del Proyecto (Abril 2026)

| Área | Estado |
|------|--------|
| Tests | ✅ 532 passing, 0 fallos |
| TypeScript typecheck | ❌ Stack overflow (BLOCKER) |
| Biome linter | ❌ No instalado (BLOCKER) |
| Componentes React | 🟡 Monolíticos (FlowCanvas: 1450 LOC) |
| Stores Zustand | 🟡 Sobrecargados (agentFlowStore: 607 LOC) |
| Documentación | ✅ Excelente cobertura en `/docs` |

**Antes de proponer o implementar nuevas features**, se deben resolver los dos blockers críticos:
1. Instalar Biome: `bun add -D @biomejs/biome`
2. Resolver el TypeScript stack overflow (raíz probable: tipos circulares en `bridge.types.ts`)

---

## 📁 Documentos Clave en `/docs`

| Archivo | Contenido |
|---------|-----------|
| `SCHEMA_AGENT.md` | Referencia completa del schema Zod de agentes |
| `ELECTRON_INTEGRATION.md` | Arquitectura del IPC bridge |
| `INTEGRATION.md` | Capa de abstracción de persistencia |
| `ISSUES_MVP.md` | Checklist de tareas con criterios de aceptación |
| `ESTIMACIONES_MVP.md` | Story points y análisis de riesgos |
| `EXPLORATION_READINESS_REPORT.md` | Diagnóstico técnico completo (Abril 2026) |

---

## 🔑 Conceptos Clave para el Equipo

- **`.afproj`** — Archivo de proyecto (JSON), define la estructura del flujo
- **`.adata`** — Archivo de datos de un agente (JSON), contiene toda su configuración
- **`behaviors/`** — Directorio donde viven los archivos `.md` de perfiles de agentes
- **`permissions.task`** — Lista de agentes a los que un agente puede delegar (se sincroniza automáticamente al guardar)
- **`AgentProfile`** — Referencia a un `.md` asociado a un agente con un selector funcional (System Prompt, Memory, etc.)

---

> **Conclusión:** AgentsFlow es una herramienta sólida con buena arquitectura y cobertura de tests, pero temporalmente bloqueada por deuda técnica en TypeScript y tooling. El equipo debe priorizar resolver esos blockers antes de cualquier desarrollo nuevo.
