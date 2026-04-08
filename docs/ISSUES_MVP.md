# ISSUES MVP — AgentsFlow Editor

> Checklist de tareas para la entrega del MVP del editor de Agentes/Subagentes.
> Ordenadas para desbloquear el desarrollo de UI lo antes posible: schema → store → UI → import/export → tests/CI.

---

## Leyenda de estado

| Símbolo | Significado |
|---------|-------------|
| `[ ]` | Pendiente |
| `[x]` | Completada |
| `[~]` | En progreso |
| `[!]` | Bloqueada — ver dependencias |

---

## Issue #1 — Definir schema Zod para Agent y Subagent

- [ ] **Completada**

**Título:** Implementar `src/schema/agent.ts` con validación Zod

**Descripción:**
Crear el schema Zod canónico para los tipos `Agent` y `Subagent`. Este archivo es la fuente de verdad para la forma de los datos en toda la aplicación. Todos los demás módulos (store, UI, import/export) deben importar los tipos inferidos desde aquí.

**Criterios de aceptación:**
- [ ] Existe `src/schema/agent.ts` con los schemas `AgentSchema` y `SubagentSchema`.
- [ ] Los tipos TypeScript (`Agent`, `Subagent`) se infieren con `z.infer<>` — no se declaran a mano.
- [ ] El schema incluye los campos: `id`, `name`, `description`, `metadata`, `behaviors`, `subagents`, `version`, `createdAt`, `updatedAt`.
- [ ] El campo `behaviors` es un array con unión tipada de al menos dos variantes (e.g. `prompt`, `tool`).
- [ ] `id` se genera automáticamente (UUID) si no se provee al parsear.
- [ ] El schema parsea un objeto vacío `{}` y falla con un error descriptivo de Zod.
- [ ] Tests unitarios cubren parse válido, parse inválido, e inferencia de tipos.

**Dependencias:** Ninguna — es la base de todo.

---

## Issue #2 — Scaffold del proyecto (carpetas y configuración base)

- [ ] **Completada**

**Título:** Crear estructura de directorios `src/` y configurar Vite + Bun + TypeScript

**Descripción:**
Establecer la arquitectura de carpetas del proyecto y asegurar que el entorno de desarrollo arranca correctamente. Este scaffold debe reflejar la separación de responsabilidades: schema, store, componentes, utils, y capa de persistencia.

**Criterios de aceptación:**
- [ ] Estructura de carpetas existente:
  ```
  src/
  ├── schema/       # Zod schemas (agent.ts, ...)
  ├── store/        # Zustand stores
  ├── components/   # Componentes React
  ├── hooks/        # Hooks personalizados
  ├── utils/        # Utilidades puras
  └── persistence/  # Capa de persistencia (localStorage / JSON / API)
  ```
- [ ] `bun run dev` arranca el servidor de desarrollo sin errores.
- [ ] `bun run build` genera bundle sin errores.
- [ ] TypeScript strict mode activo y sin errores de compilación.
- [ ] `.gitignore` excluye `node_modules/`, `dist/`, `.env`.

**Dependencias:** Ninguna — puede correr en paralelo con Issue #1.

---

## Issue #3 — Zustand store para gestión de agentes

- [ ] **Pendiente**

**Título:** Implementar `src/store/agentsStore.ts` con operaciones CRUD

**Descripción:**
Crear el store Zustand que gestiona el estado global de agentes en la UI. El store debe operar sobre los tipos validados con Zod y exponer una API limpia para crear, leer, actualizar y eliminar agentes y subagentes.

**Criterios de aceptación:**
- [ ] Existe `src/store/agentsStore.ts` usando `create` de Zustand.
- [ ] El store expone las acciones: `addAgent`, `updateAgent`, `deleteAgent`, `addSubagent`, `updateSubagent`, `deleteSubagent`.
- [ ] El store expone los selectores: `agents` (array), `getAgentById(id)`.
- [ ] Todas las mutaciones validan los datos con el schema Zod antes de aplicar cambios al estado.
- [ ] El store persiste el estado en `localStorage` usando el middleware `persist` de Zustand.
- [ ] Tests unitarios cubren cada acción CRUD.

**Dependencias:** Issue #1 (schema Zod debe estar definido).

---

## Issue #4 — Componente `AgentEditor` (formulario principal)

- [ ] **Pendiente**

**Título:** Crear componente `AgentEditor` para crear y editar agentes

**Descripción:**
Desarrollar el componente React principal del editor. Debe renderizar un formulario vinculado al store de Zustand y usar React Hook Form + Zod para validación de inputs en tiempo real.

**Criterios de aceptación:**
- [ ] Existe `src/components/AgentEditor.tsx`.
- [ ] El formulario tiene campos para: `name`, `description`, `behaviors` (lista editable), `metadata` (key-value editable).
- [ ] La validación usa el schema Zod directamente como resolver de React Hook Form.
- [ ] Los errores de validación se muestran en línea, debajo del campo correspondiente.
- [ ] El formulario funciona en modo "crear" y en modo "editar" (recibe `agentId` como prop opcional).
- [ ] El submit llama a `addAgent` o `updateAgent` del store según el modo.
- [ ] El componente es accesible: labels vinculados a inputs, roles ARIA donde aplique.

**Dependencias:** Issue #1 (schema), Issue #3 (store).

---

## Issue #5 — Componente `SubagentList` y gestión de subagentes

- [ ] **Pendiente**

**Título:** Crear componente `SubagentList` con inline editor para subagentes

**Descripción:**
Los agentes pueden tener subagentes anidados. Este componente muestra la lista de subagentes de un agente y permite agregar, editar y eliminar cada uno mediante un editor inline (no modal).

**Criterios de aceptación:**
- [ ] Existe `src/components/SubagentList.tsx`.
- [ ] Recibe `agentId` como prop y lista los subagentes del agente correspondiente.
- [ ] Permite agregar un nuevo subagente mediante un formulario inline.
- [ ] Cada subagent row tiene acción de editar (abre inline form) y eliminar (con confirmación).
- [ ] Las mutaciones usan las acciones del store (`addSubagent`, `updateSubagent`, `deleteSubagent`).
- [ ] La validación de los campos del subagente usa el schema Zod.

**Dependencias:** Issue #3 (store), Issue #4 (referencia de patrón de formulario).

---

## Issue #6 — Importar/Exportar agentes como JSON

- [ ] **Pendiente**

**Título:** Implementar import/export de agentes en formato JSON

**Descripción:**
Proveer al usuario la capacidad de exportar el estado actual de agentes como un archivo `.json` y de importar un archivo JSON que sea validado contra el schema Zod antes de cargarse al store.

**Criterios de aceptación:**
- [ ] Existe `src/utils/importExport.ts` con funciones `exportAgents(agents: Agent[]): void` e `importAgents(file: File): Promise<Agent[]>`.
- [ ] `exportAgents` genera un blob JSON y dispara la descarga en el navegador.
- [ ] `importAgents` lee el archivo, parsea JSON y valida con `AgentSchema` (Zod). Rechaza con error descriptivo si el schema no se cumple.
- [ ] Existe un componente `ImportExportBar` con botones "Exportar JSON" e "Importar JSON".
- [ ] Los errores de validación en import se muestran como notificación al usuario.
- [ ] Tests unitarios cubren: export genera JSON válido, import rechaza JSON inválido, import acepta JSON válido y actualiza el store.

**Dependencias:** Issue #1 (schema), Issue #3 (store).

---

## Issue #7 — Vista de lista de agentes (`AgentList`)

- [ ] **Pendiente**

**Título:** Crear componente `AgentList` con búsqueda y selección

**Descripción:**
Panel de navegación lateral (o página principal) que muestra todos los agentes almacenados, permite buscarlos por nombre y seleccionar uno para editar en el `AgentEditor`.

**Criterios de aceptación:**
- [ ] Existe `src/components/AgentList.tsx`.
- [ ] Lista todos los agentes del store.
- [ ] Tiene un input de búsqueda que filtra por `name` en tiempo real (case-insensitive).
- [ ] Al hacer click en un agente, el `AgentEditor` cambia a modo "editar" con el agente seleccionado.
- [ ] Tiene un botón "Nuevo agente" que limpia el editor y lo pone en modo "crear".
- [ ] Muestra el número de subagentes de cada agente en la lista.

**Dependencias:** Issue #3 (store), Issue #4 (AgentEditor).

---

## Issue #8 — Persistencia: capa de abstracción y localStorage

- [ ] **Pendiente**

**Título:** Implementar `src/persistence/` con interfaz unificada de persistencia

**Descripción:**
Crear una capa de abstracción que desacopla el store de la implementación concreta de persistencia. Para el MVP, la implementación es `localStorage`. La interfaz debe permitir swap sencillo a una API REST o base de datos en el futuro.

**Criterios de aceptación:**
- [ ] Existe `src/persistence/index.ts` con la interfaz `PersistenceAdapter<T>` que define `get`, `set`, `remove`.
- [ ] Existe `src/persistence/localStorage.ts` que implementa `PersistenceAdapter` usando `localStorage`.
- [ ] El store Zustand usa el adapter en lugar de depender directamente de `localStorage`.
- [ ] La serialización/deserialización del store usa JSON + validación Zod en la lectura.
- [ ] Tests unitarios cubren: persistencia de agentes, recuperación al recargar, limpieza.

**Dependencias:** Issue #1 (schema), Issue #3 (store).

---

## Issue #9 — Configurar CI y testing (Bun test)

- [ ] **Pendiente**

**Título:** Configurar pipeline de CI con `bun test` y linting

**Descripción:**
Establecer el pipeline de integración continua para que cada push valide que todos los tests pasan y no hay errores de lint/typecheck.

**Criterios de aceptación:**
- [ ] Existe `.github/workflows/ci.yml` con jobs: `test`, `typecheck`, `lint`.
- [ ] `bun test` corre todos los tests y el job falla si alguno falla.
- [ ] `tsc --noEmit` corre sin errores en el job de typecheck.
- [ ] `biome check` (o `eslint`) corre sin errores en el job de lint.
- [ ] El pipeline corre en cada push a `main` y en cada pull request.
- [ ] Los tiempos de CI no superan los 3 minutos para el conjunto total del MVP.

**Dependencias:** Issues #1–#8 (todos deben tener tests escritos primero).

---

## Resumen de dependencias

```
#1 Schema Zod ──────┬──> #3 Store ──> #4 AgentEditor ──> #5 SubagentList
                    │              ├──> #6 Import/Export
                    │              ├──> #7 AgentList
                    │              └──> #8 Persistencia
#2 Scaffold ────────┘
                                              └──> #9 CI (todos anteriores)
```
