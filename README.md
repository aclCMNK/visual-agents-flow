# AgentsFlow

> Editor visual de Agentes y Subagentes para DrassMemorIA.  
> Stack: **Bun · TypeScript · React · Vite · Zod · Zustand**

---

## Índice

- [¿Qué es esto?](#qué-es-esto)
- [Requisitos](#requisitos)
- [Guía de arranque rápido](#guía-de-arranque-rápido)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Scripts disponibles](#scripts-disponibles)
- [Convenciones](#convenciones)
- [Documentación](#documentación)
- [Stack y decisiones técnicas](#stack-y-decisiones-técnicas)

---

## ¿Qué es esto?

**AgentsFlow** es el editor MVP para crear, editar y gestionar Agentes y Subagentes del sistema DrassMemorIA. Permite:

- Definir agentes con nombre, descripción, behaviors (prompts y tools) y metadatos.
- Anidar subagentes dentro de un agente padre.
- Importar y exportar la configuración de agentes como JSON validado.
- Persistir el estado localmente (localStorage) mientras el backend no está disponible.

---

## Requisitos

| Herramienta | Versión mínima | Instalación |
|-------------|----------------|-------------|
| [Bun](https://bun.sh) | `>= 1.3.4` | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js | `>= 20` (opcional, solo para tooling externo) | [nodejs.org](https://nodejs.org) |
| TypeScript | `>= 5.0` (incluido vía `devDependencies`) | — |

> ℹ️ Este proyecto usa **Bun** como runtime, package manager y test runner. No uses `npm` ni `yarn`.

---

## Guía de arranque rápido

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd drassMemorIA/editors/agentsFlow
```

### 2. Instalar dependencias

```bash
bun install
```

### 3. Arrancar el servidor de desarrollo

```bash
bun run dev
```

Abre [http://localhost:5173](http://localhost:5173) en el navegador.

### 4. Verificar que todo funciona

```bash
# Typecheck
bun run typecheck

# Tests
bun test

# Lint
bun run lint
```

Si todos los comandos pasan sin errores, el entorno está listo.

### 5. Variables de entorno (opcional)

Crea un archivo `.env.local` en la raíz para sobrescribir configuración local:

```env
# Puerto del servidor de desarrollo (default: 5173)
VITE_PORT=5173

# Prefijo del namespace en localStorage
VITE_STORAGE_KEY=agentsflow
```

> `.env.local` está en `.gitignore` — nunca lo comitees.

---

## Estructura del proyecto

```
agentsFlow/
├── docs/                     # Documentación del proyecto
│   ├── ISSUES_MVP.md         # Checklist de tareas del MVP
│   ├── SCHEMA_AGENT.md       # Referencia del schema Zod
│   └── ESTIMACIONES_MVP.md   # Estimaciones y análisis de riesgos
├── src/
│   ├── schema/               # Schemas Zod — fuente de verdad de tipos
│   │   └── agent.ts          # AgentSchema, SubagentSchema, BehaviorSchema
│   ├── store/                # Stores Zustand (state management)
│   │   └── agentsStore.ts    # CRUD de agentes y subagentes
│   ├── components/           # Componentes React
│   │   ├── AgentEditor.tsx   # Formulario de creación/edición de agente
│   │   ├── AgentList.tsx     # Lista navegable de agentes
│   │   ├── SubagentList.tsx  # Lista inline de subagentes
│   │   └── ImportExportBar.tsx # Botones de import/export JSON
│   ├── hooks/                # Hooks personalizados de React
│   ├── utils/                # Utilidades puras (sin side effects)
│   │   └── importExport.ts   # Lógica de import/export JSON
│   └── persistence/          # Capa de abstracción de persistencia
│       ├── index.ts          # Interfaz PersistenceAdapter<T>
│       └── localStorage.ts   # Implementación con localStorage
├── index.ts                  # Entrypoint (Bun dev)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `bun run dev` | Inicia el servidor de desarrollo con HMR |
| `bun run build` | Genera el bundle de producción en `dist/` |
| `bun run preview` | Sirve el build de producción localmente |
| `bun test` | Corre todos los tests con el runner de Bun |
| `bun run typecheck` | Corre `tsc --noEmit` para verificar tipos sin emitir |
| `bun run lint` | Corre el linter (Biome o ESLint) |
| `bun run lint:fix` | Corre el linter y aplica auto-fixes |

---

## Convenciones

### Código

#### Nomenclatura

| Artefacto | Convención | Ejemplo |
|-----------|-----------|---------|
| Componentes React | `PascalCase` | `AgentEditor.tsx` |
| Hooks | `camelCase` con prefijo `use` | `useAgentStore.ts` |
| Stores Zustand | `camelCase` con sufijo `Store` | `agentsStore.ts` |
| Schemas Zod | `PascalCase` con sufijo `Schema` | `AgentSchema` |
| Tipos inferidos | `PascalCase` sin sufijo | `Agent`, `Subagent` |
| Utilidades | `camelCase` | `importExport.ts` |
| Constantes | `UPPER_SNAKE_CASE` | `STORAGE_KEY` |

#### Tipos TypeScript

- **No declarar tipos manualmente** si pueden inferirse de un schema Zod. Usar `z.infer<typeof Schema>`.
- Preferir `type` sobre `interface` para tipos de datos. Usar `interface` solo para contratos de extensión (e.g., `PersistenceAdapter`).
- Siempre anotar el tipo de retorno en funciones públicas exportadas.

```typescript
// ✅ Correcto
export type Agent = z.infer<typeof AgentSchema>;

// ❌ Incorrecto — puede divergir del schema
export type Agent = {
  id: string;
  name: string;
};
```

#### Imports

Orden de imports (enforced por el linter):

```typescript
// 1. Módulos de Node / Bun
import { readFileSync } from "fs";

// 2. Dependencias externas
import { z } from "zod";
import { create } from "zustand";

// 3. Módulos internos del proyecto (alias @/)
import { AgentSchema } from "@/schema/agent";
import { useAgentsStore } from "@/store/agentsStore";

// 4. Tipos (import type)
import type { Agent } from "@/schema/agent";
```

#### Validación

- Todo dato que entre al sistema desde afuera (formulario, archivo, API) debe pasar por `safeParse` o `parse` del schema Zod correspondiente.
- Nunca usar `as Agent` para bypassear la validación.
- Los errores de validación deben ser capturados y mostrados al usuario — no silenciados con `catch(() => {})`.

```typescript
// ✅ Correcto
const result = AgentSchema.safeParse(rawData);
if (!result.success) {
  showError(result.error.format());
  return;
}
const agent = result.data;

// ❌ Incorrecto
const agent = rawData as Agent;
```

### Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance>): <descripción corta en imperativo>

[cuerpo opcional]

[footer opcional]
```

| Tipo | Cuándo usarlo |
|------|--------------|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `refactor` | Refactoring sin cambio de comportamiento |
| `test` | Agregar o corregir tests |
| `docs` | Cambios en documentación |
| `chore` | Tareas de mantenimiento (deps, config, CI) |
| `style` | Cambios de formato/lint sin lógica |

**Ejemplos:**

```bash
git commit -m "feat(schema): add BehaviorWebhook type to AgentSchema"
git commit -m "fix(store): prevent duplicate subagent ids on addSubagent"
git commit -m "test(importExport): add invalid JSON rejection test"
git commit -m "docs(readme): add startup guide and conventions"
```

**Reglas:**
- El mensaje va en inglés.
- La descripción corta usa imperativo: "add", no "added" ni "adds".
- Máximo 72 caracteres en la primera línea.
- No comitear `console.log` de debug, `TODO` sin ticket, ni archivos `.env`.

### Tests

- Los tests viven junto al código en archivos `*.test.ts` (e.g., `agent.test.ts` al lado de `agent.ts`).
- Cada función o módulo público debe tener al menos un test de caso feliz y uno de caso de error.
- Correr `bun test` antes de cada push. El CI lo verificará, pero es más rápido hacerlo local.

```typescript
// src/schema/agent.test.ts
import { describe, expect, test } from "bun:test";
import { AgentSchema } from "./agent";

describe("AgentSchema", () => {
  test("parsea un agente válido", () => {
    const result = AgentSchema.safeParse({ /* ... datos válidos ... */ });
    expect(result.success).toBe(true);
  });

  test("rechaza un agente sin nombre", () => {
    const result = AgentSchema.safeParse({ id: "...", createdAt: "...", updatedAt: "..." });
    expect(result.success).toBe(false);
  });
});
```

### Pull Requests

- Cada PR debe estar vinculado a un issue del ISSUES_MVP.md.
- El título del PR sigue el mismo formato que los commits: `feat(scope): descripción`.
- El PR debe pasar todos los checks de CI antes de hacer merge.
- Squash merge al mergear a `main` — mantener historial limpio.

---

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [`docs/ISSUES_MVP.md`](docs/ISSUES_MVP.md) | Checklist completo de tareas del MVP con criterios de aceptación y dependencias |
| [`docs/SCHEMA_AGENT.md`](docs/SCHEMA_AGENT.md) | Referencia completa del schema Zod: campos, tipos, reglas de validación, ejemplos y guía de extensibilidad |
| [`docs/ESTIMACIONES_MVP.md`](docs/ESTIMACIONES_MVP.md) | Tabla de estimaciones por issue y persona, análisis de riesgos, calendario de sprints |

---

## Stack y decisiones técnicas

| Tecnología | Rol | Por qué |
|-----------|-----|---------|
| [Bun](https://bun.sh) | Runtime, package manager, test runner | Velocidad de instalación y ejecución; test runner integrado sin configuración |
| [TypeScript 5](https://www.typescriptlang.org) | Lenguaje | Seguridad de tipos, mejor DX, prerequisito del equipo |
| [React 18](https://react.dev) | UI | Ecosistema maduro, componentes reutilizables, hooks |
| [Vite](https://vitejs.dev) | Bundler / Dev server | HMR rápido, configuración mínima, compatible con Bun |
| [Zod](https://zod.dev) | Schema validation | TypeScript-first, runtime validation + inferencia de tipos en un solo lugar |
| [Zustand](https://zustand-demo.pmnd.rs) | State management | Mínimo boilerplate, API simple, middleware `persist` para localStorage |
| [React Hook Form](https://react-hook-form.com) | Formularios | Performance (uncontrolled inputs), integración nativa con resolvers Zod |
| [Biome](https://biomejs.dev) | Linter + Formatter | Reemplaza ESLint + Prettier en un solo binario, más rápido, menos configuración |

> Para el detalle completo de decisiones arquitectónicas, ver [`docs/SCHEMA_AGENT.md`](docs/SCHEMA_AGENT.md) y [`docs/ESTIMACIONES_MVP.md`](docs/ESTIMACIONES_MVP.md).
