# ESTIMACIONES MVP — AgentsFlow Editor

> Tabla de estimaciones de esfuerzo por issue, responsable asignado y análisis de riesgos.
> Las estimaciones usan **puntos de historia (SP)** con la escala Fibonacci: 1, 2, 3, 5, 8, 13.
> El tiempo de referencia: **1 SP ≈ 2–3 horas de trabajo efectivo** de un dev mid-senior.

---

## Escala de puntos de historia

| SP | Complejidad | Tiempo estimado | Descripción |
|----|-------------|-----------------|-------------|
| 1 | Trivial | 2–3 h | Configuración, boilerplate, cambio de una sola pieza |
| 2 | Simple | 4–6 h | Feature pequeña con tests, sin dependencias complejas |
| 3 | Moderada | 6–9 h | Feature con lógica no trivial o múltiples archivos |
| 5 | Compleja | 10–15 h | Feature con UI, validación, store y tests integrados |
| 8 | Alta | 16–24 h | Módulo completo con casos edge, integración y documentación |
| 13 | Muy alta | 25–40 h | Refactoring mayor, sistema nuevo, múltiples integraciones |

---

## Tabla de estimaciones por issue

| # | Título | Área | SP | Responsable | ETA real (h) | Prioridad |
|---|--------|------|----|-------------|--------------|-----------|
| 1 | Definir schema Zod para Agent y Subagent | Schema / Backend | 3 | Dev 1 | 6–9 h | 🔴 Crítica |
| 2 | Scaffold del proyecto (carpetas + config base) | DevOps / Config | 2 | Dev 1 | 4–6 h | 🔴 Crítica |
| 3 | Zustand store para gestión de agentes (CRUD) | State Management | 5 | Dev 1 | 10–15 h | 🔴 Crítica |
| 4 | Componente `AgentEditor` (formulario principal) | UI / Frontend | 8 | Dev 2 | 16–24 h | 🔴 Crítica |
| 5 | Componente `SubagentList` + inline editor | UI / Frontend | 5 | Dev 2 | 10–15 h | 🟠 Alta |
| 6 | Import/Export JSON con validación Zod | Utils / UI | 5 | Dev 1 | 10–15 h | 🟠 Alta |
| 7 | Vista `AgentList` con búsqueda y selección | UI / Frontend | 3 | Dev 2 | 6–9 h | 🟠 Alta |
| 8 | Capa de abstracción de persistencia (localStorage) | Persistence | 3 | Dev 1 | 6–9 h | 🟡 Media |
| 9 | Configurar CI con `bun test` + linting | DevOps / QA | 2 | Dev 1 | 4–6 h | 🟡 Media |

**Total estimado: 36 SP → 72–108 horas de trabajo efectivo**

---

## Estimación por persona

### Dev 1 — Backend / Schema / Infraestructura

| Issue | Título | SP | ETA (h) |
|-------|--------|----|---------|
| #1 | Schema Zod | 3 | 6–9 |
| #2 | Scaffold | 2 | 4–6 |
| #3 | Zustand Store CRUD | 5 | 10–15 |
| #6 | Import/Export JSON | 5 | 10–15 |
| #8 | Capa de persistencia | 3 | 6–9 |
| #9 | CI + testing | 2 | 4–6 |
| **TOTAL** | | **20 SP** | **40–60 h** |

### Dev 2 — Frontend / UI / UX

| Issue | Título | SP | ETA (h) |
|-------|--------|----|---------|
| #4 | AgentEditor (formulario) | 8 | 16–24 |
| #5 | SubagentList + inline editor | 5 | 10–15 |
| #7 | AgentList + búsqueda | 3 | 6–9 |
| **TOTAL** | | **16 SP** | **32–48 h** |

> **Nota:** Si el equipo es de 1 persona, secuenciar en el orden de dependencias del ISSUES_MVP.md (#1 → #2 → #3 → #4 → ...). ETA total ≈ 10–13 días hábiles a 8 h/día.

---

## Estimación de calendario (equipo de 2 devs)

```
Semana 1 (Sprint 1 — Fundamentos)
├── Dev 1: #1 Schema (3 SP) + #2 Scaffold (2 SP) + inicio #3 Store
└── Dev 2: Setup dev environment + revisión de arquitectura + inicio #4 AgentEditor

Semana 2 (Sprint 2 — Core)
├── Dev 1: #3 Store CRUD (5 SP) ← desbloquea Dev 2
└── Dev 2: #4 AgentEditor (8 SP) — depende de que #1 y #3 estén listos

Semana 3 (Sprint 3 — Features)
├── Dev 1: #6 Import/Export (5 SP) + #8 Persistencia (3 SP)
└── Dev 2: #5 SubagentList (5 SP) + #7 AgentList (3 SP)

Semana 4 (Sprint 4 — QA y cierre)
├── Dev 1: #9 CI (2 SP) + integración final + bug fixes
└── Dev 2: Testing e2e + refinamiento UI + accesibilidad
```

**ETA MVP completo con 2 devs: 3–4 semanas**

---

## Análisis de riesgos

### Tabla de riesgos

| ID | Riesgo | Probabilidad | Impacto | Severidad | Issue(s) afectados | Mitigación |
|----|--------|-------------|---------|-----------|-------------------|------------|
| R1 | Schema Zod cambia mid-sprint por nuevos requisitos | Media | Alto | 🔴 Alta | #1, #3, #4, #6 | Congelar schema en Sprint 1 antes de que Dev 2 arranque con UI. Cambios post-congelamiento pasan por revisión explícita. |
| R2 | Formularios complejos en React (behaviors dinámicos) subestimados | Alta | Medio | 🟠 Media | #4, #5 | Prototipar el array de behaviors con `useFieldArray` de React Hook Form antes de comprometerse a la estimación final de #4. |
| R3 | Conflictos entre Zustand persist y migraciones de schema | Media | Medio | 🟠 Media | #3, #8 | Definir la función de migración como parte de #8, no como afterthought. Testear con datos legacy en localStorage. |
| R4 | CI tarda más de 3 min por dependencias pesadas | Baja | Bajo | 🟢 Baja | #9 | Usar caché de dependencias de Bun en GitHub Actions. Separar job de lint del de test. |
| R5 | Performance de `AgentList` con >500 agentes | Baja | Bajo | 🟢 Baja | #7 | Filtrado en memoria es suficiente para el MVP. Agregar virtualización solo si los tests de performance lo justifican. |
| R6 | UUID no disponible en el entorno (sin `crypto.randomUUID`) | Baja | Medio | 🟡 Baja-Media | #1, #3 | Usar el package `uuid` como fallback. Verificar soporte en Bun + browser target. |
| R7 | Ambigüedad en requisitos de metadata (estructura libre vs. typed) | Media | Medio | 🟠 Media | #1, #4 | Aclarar en Sprint 1: `Record<string, string>` es suficiente para el MVP; estructura más rígida se define en v2. |

---

### Riesgos críticos — detalle

#### R1 — Cambios de schema mid-sprint

**Por qué importa:** Todos los módulos dependen del schema de #1. Un cambio en `Agent` después de que #3 y #4 arranquen puede invalidar horas de trabajo.

**Plan de mitigación:**
1. El schema se "congela" al final de Sprint 1 (día 5).
2. Cualquier cambio post-congelamiento requiere una ADR (Architecture Decision Record) en `docs/`.
3. Se versiona con el campo `version` — cambios breaking incrementan el número.

#### R2 — Subestimación de formularios dinámicos

**Por qué importa:** Los `behaviors` son un array dinámico donde cada item tiene forma distinta (`prompt` vs `tool`). Esto requiere `useFieldArray` anidado y lógica de renderizado condicional por `type`.

**Plan de mitigación:**
1. Dev 2 hace un spike de 4 h en Sprint 1 para validar el patrón de `useFieldArray` + Zod discriminated union con React Hook Form.
2. Si el spike revela complejidad adicional, re-estimar #4 a 13 SP antes de comprometer la fecha de entrega.

#### R3 — Hydration de Zustand persist con schema desactualizado

**Por qué importa:** Si un usuario tiene datos en `localStorage` de una versión anterior del schema, Zustand puede cargar datos que no pasan la validación Zod — causando errores en runtime.

**Plan de mitigación:**
1. La capa de persistencia (#8) debe correr las funciones de migración antes de pasar los datos al store.
2. Agregar tests que simulan datos v1 siendo cargados por código v2.

---

## Deuda técnica identificada (no es MVP)

Estos items se dejaron fuera del MVP intencionalmente. Se registran para no perderlos:

| Item | Descripción | Issue futuro |
|------|-------------|-------------|
| Backend API | Reemplazar localStorage por REST API o DB | Post-MVP |
| Autenticación | Multi-usuario con auth | Post-MVP |
| Virtualización de listas | Para catálogos de >500 agentes | Post-MVP si necesario |
| Exportar a YAML/TOML | Alternativas al JSON export | Post-MVP |
| Historial de versiones de un agente | Git-like diff de cambios | Post-MVP |
| Validación async de `toolId` | Verificar que el tool existe en el sistema | Post-MVP |
| Drag & drop de behaviors | Reordenar behaviors en el editor | Post-MVP |

---

## Velocidad esperada del equipo

| Sprint | Dev 1 (SP) | Dev 2 (SP) | Total (SP) |
|--------|-----------|-----------|-----------|
| Sprint 1 | 7 | 3 | 10 |
| Sprint 2 | 5 | 8 | 13 |
| Sprint 3 | 8 | 8 | 16 |
| Sprint 4 | 2 | — | 2 (buffer) |
| **Total** | **22** | **19** | **41** |

> Buffer de 5 SP (~10–15 h) para bug fixes, revisiones y refinamiento de UI.
