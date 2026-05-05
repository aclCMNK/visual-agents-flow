# 📋 MANIFEST — AgentsFlow

> Referencia central del propósito, alcance y estado actual del proyecto.

---

## 🏷️ Identificación

| Campo            | Valor                                      |
|------------------|--------------------------------------------|
| **Nombre**       | AgentsFlow                                 |
| **Package ID**   | `com.drassmemoria.agentsflow`              |
| **Versión**      | `0.1.2`                                    |
| **Fase**         | MVP (Minimum Viable Product)               |
| **Ecosistema**   | DrassMemorIA                               |
| **Repositorio**  | `editors/agentsFlow`                       |

---

## 🎯 Objetivo General

AgentsFlow es una **aplicación de escritorio** para diseñar y orquestar **flujos de trabajo agénticos de manera visual**, eliminando la necesidad de editar archivos de configuración manualmente.

Forma parte del ecosistema **DrassMemorIA** y actúa como la interfaz gráfica principal para la gestión de agentes, proyectos y comportamientos del sistema multi-agente.

---

## 🧱 Stack Tecnológico

### Core

| Tecnología        | Versión   | Rol                                      |
|-------------------|-----------|------------------------------------------|
| **Electron**      | 41        | Shell de escritorio multiplataforma      |
| **React**         | 19        | UI declarativa y reactiva                |
| **TypeScript**    | 5         | Tipado estático                          |
| **Vite**          | 8         | Bundler y dev server                     |
| **Zustand**       | —         | Gestión de estado global                 |
| **Zod**           | —         | Validación de esquemas y datos           |
| **Monaco Editor** | —         | Editor de código embebido (VS Code core) |
| **Bun test**      | —         | Framework de testing                     |

### Plataformas Objetivo

| Plataforma  | Estado         |
|-------------|----------------|
| Windows     | ✅ Soportado    |
| Linux       | ✅ Soportado    |
| macOS       | 🔜 Próximamente |

---

## ⚙️ Funcionalidades Principales

### 🗺️ Editor Visual de Flujos
Diseño drag-and-drop de flujos agénticos. Los nodos representan agentes y las conexiones definen el orden y las dependencias de ejecución.

### 📁 Gestión de Proyectos `.afproj`
Creación, apertura y administración de proyectos AgentsFlow. Cada proyecto encapsula agentes, flujos y configuración en un formato portable.

### 🤖 Sistema de Agentes `.adata`
Definición y edición de perfiles de agente (`AgentProfile`) con soporte para comportamientos (`behaviors/`), permisos (`permissions.task`) y metadatos estructurados.

### 🔐 Sincronización de Permisos
Gestión centralizada de permisos por tarea y por agente. Permite controlar qué acciones puede ejecutar cada agente dentro de un flujo.

### 🗂️ Explorador y Editor de Archivos
Navegación del sistema de archivos del proyecto con editor integrado (Monaco Editor) para modificar configuraciones, esquemas y comportamientos directamente desde la app.

### 🔗 Clonación de Repositorios
Integración con Git para clonar repositorios (públicos y privados) directamente desde la interfaz, sin salir de la aplicación.

### 📤 Exportación de Flujos
Exportación de flujos diseñados a formatos compatibles con el ecosistema DrassMemorIA para su ejecución o distribución.

---

## 📊 Estado Actual

| Aspecto              | Estado                                                  |
|----------------------|---------------------------------------------------------|
| **Versión**          | `0.1.2` — MVP en progreso                              |
| **Tests**            | ✅ Pasando (`bun test`)                                 |
| **Linter (Biome)**   | ⚠️ Pendiente de instalación/configuración              |
| **Tipos TypeScript** | ⚠️ Stack overflow de tipos pendiente de resolución     |
| **Build Windows**    | ✅ Funcional (`electron-builder --win`)                 |
| **Build Linux**      | ✅ Funcional (`electron-builder --linux`)               |

---

## 📚 Documentación Clave

| Documento                        | Descripción                                              |
|----------------------------------|----------------------------------------------------------|
| `docs/CONTEXT_SUMMARY.md`        | Resumen de contexto general del proyecto                 |
| `docs/SCHEMA_AGENT.md`           | Esquema y estructura de los archivos `.adata`            |
| `docs/ELECTRON_INTEGRATION.md`   | Integración Electron: IPC, main/renderer, seguridad      |
| `docs/ESTIMACIONES_MVP.md`       | Estimaciones de tiempo y alcance del MVP                 |
| `docs/EXPLORATION_READINESS_REPORT.md` | Reporte de madurez y preparación del sistema       |

---

## 🧩 Conceptos Clave

| Concepto              | Descripción                                                                 |
|-----------------------|-----------------------------------------------------------------------------|
| **`.afproj`**         | Formato de proyecto AgentsFlow. Contiene la definición completa de un flujo agéntico. |
| **`.adata`**          | Archivo de definición de agente. Contiene perfil, comportamientos y permisos. |
| **`behaviors/`**      | Directorio con los comportamientos (scripts/configs) asociados a un agente. |
| **`AgentProfile`**    | Estructura de datos principal que describe un agente: nombre, rol, capacidades, permisos. |
| **`permissions.task`**| Objeto que define qué tareas puede ejecutar un agente dentro de un flujo.   |

---

## 🗂️ Estructura del Proyecto

```
agentsFlow/
├── electron-main/       # Proceso principal de Electron (IPC, ventanas, sistema de archivos)
├── src/                 # Código fuente React (renderer)
│   ├── components/      # Componentes UI
│   ├── store/           # Estado global (Zustand)
│   └── schemas/         # Validaciones (Zod)
├── docs/                # Documentación técnica del proyecto
├── ai_docs/             # Documentación generada por agentes IA
├── tests/               # Tests (Bun test)
├── public/              # Assets estáticos (Monaco Editor, íconos)
├── MANIFEST.md          # Este archivo — referencia central del proyecto
└── package.json         # Configuración del proyecto y scripts
```

---

## 🔗 Ecosistema DrassMemorIA

AgentsFlow es la **interfaz visual** del ecosistema. Se integra con:

- **MemorIA MCP Server** — sistema de memoria persistente para agentes
- **Agentes especializados** — definidos y orquestados desde AgentsFlow
- **Flujos de trabajo** — exportados y ejecutados por el runtime del ecosistema

---

*Última actualización: 2026-05-04 — Versión 0.1.2*
