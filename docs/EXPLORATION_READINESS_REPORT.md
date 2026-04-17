# AgentsFlow: Project Readiness Assessment
**Fecha:** 10 Abril 2026  
**Scope:** Análisis exhaustivo de viabilidad técnica, estructural y organizativa  
**Conclusión General:** ⚠️ **CONDICIONALMENTE APTO** — resolver limitantes críticas antes de propuestas

---

## 📊 Executive Summary

**¿Está listo para nuevas propuestas de diseño?**  
Técnicamente **sí**, pero **no debe avanzarse sin resolver antes 2 limitantes críticos**:

1. **TypeScript compilation crash** (RangeError: stack overflow) — impide typecheck, CI/CD, y quality gates
2. **Linter tool missing** (Biome no instalado) — impide lint checks en pipeline

El codebase tiene una **base arquitectónica sólida**: modular, bien documentado, con tests robustos (532 passing). Sin embargo:
- Componentes React **monolíticos** (FlowCanvas: 1450 LOC)
- Stores **sobrecargados** (projectStore: 524 LOC, agentFlowStore: 607 LOC)
- **IPC bridge complexity** puede ser raíz del problema de TypeScript

**Recomendación:** 🛑 **NO proponer features nuevas hasta resolver TypeScript + Biome**. El proyecto necesita 2-3 días de refactoring técnico.

---

## 🔍 Limitaciones Críticas Detectadas

### 1. ⛔ TypeScript Compilation Crash (BLOCKER)

**Problema:**
```
$ bun run typecheck
RangeError: Maximum call stack size exceeded
  at isMatchingReference (typescript/lib/_tsc.js:69321:31)
```

**Impacto:**
- ❌ CI/CD pipeline bloqueado (typecheck es paso previo a merge)
- ❌ Developers no pueden validar tipos localmente antes de push
- ❌ Propuestas de features causarán regresiones silenciosas
- ❌ Integración de nuevas dependencias o refactors será riesgosa

**Raíz probable:**
- **Bridge types complexity** → `AgentsFlowBridge` interface + discriminated unions en `bridge.types.ts`
- **Circular type references** → projectStore ↔ agentFlowStore ↔ bridge types
- **Large stores** → projectStore (524 LOC) y agentFlowStore (607 LOC) con tipos inferenciales complejos
- **Zod schema inference** → `z.infer<typeof X>` en store state puede crear recursive unions

**Scope del refactor:** ~3-4 horas (simplificar types, split stores)

---

### 2. ⛔ Linter Tool Missing (BLOCKER)

**Problema:**
```
$ bun run lint
/usr/bin/bash: line 1: biome: command not found
```

**Impacto:**
- ❌ Lint checks no corren en CI/CD
- ❌ Code quality no se valida en merge
- ❌ Nuevas contribuciones pueden no seguir convenciones

**Causa:** Biome no instalado como dev dependency (está en package.json pero no en node_modules)

**Scope del refactor:** ~20 minutos (reinstalar deps + verify)

---

### 3. 🟡 Component Monoliths (Medium Risk)

**Componentes grandes:**
| Componente | LOC | Responsabilidades |
|------------|-----|-------------------|
| FlowCanvas.tsx | **1450** | Canvas render + zoom + pan + node drag + link drag + ghost placement |
| PropertiesPanel.tsx | 1299 | Properties display + agent edit + profile modal trigger + permissions |
| PermissionsModal.tsx | 1046 | Permissions UI + state management + validation |
| NewProjectModal.tsx | 348 | New project creation form |

**Problema:**
- Difícil testear componentes individuales
- Cambios en uno afectan toda la cadena de render
- Difficultades para reutilizar sub-lógica
- Props drilling excesivo en algunos casos

**Impact:** Medium — testing de nuevas features será lento, mantenibilidad sufre

---

### 4. 🟡 Store Complexity (Medium Risk)

**Stores grandes (1779 LOC total):**
```
projectStore.ts      524 LOC  — proyecto, validación, navegación, async ops
agentFlowStore.ts    607 LOC  — canvas agents, links, placement, edit modal
assetStore.ts        648 LOC  — file browser, markdown editor, imports
```

**Problemas:**
- **Coupling alto:** projectStore debe consultar al bridge para casi todo
- **Discriminated unions complejas:** LinkRuleType, AgentType, ProfileModalTarget
- **Mixed concerns:** UI state + business logic + IPC coordination
- **Type inference chain:** Zod → types → store actions → components

**Impact:** Medium — nuevas features que toquen stores requerirán refactor mental

---

### 5. 🟢 Git Branch Fragmentation (Low-Medium Risk)

**Ramas activas (11):**
```
feat/agents-props
feat/behaviors-dir-names*  ← current
feat/connections-agents-properties-panel
feat/link-agent-profiles
feat/permissions-propety
feat/saving-persistent-agents-conexions
feat/tools-zoom-panels
feature/agents-properties
feature/feat/loading-project-data
fix/agent-profile-zindex
fix/fixing-readme
```

**Problemas:**
- Convención inconsistente: `feat/` vs `feature/`
- Algunas ramas parecen abandonadas (última commit ~14 commits atrás)
- Tipografía en nombres: "propety" en vez de "property"

**Impact:** Low — organizativo, no técnico. Puede causarconfusión, merge conflicts.

---

## ✅ Fortalezas Detectadas

### 1. 📋 Documentación Completa
- **SCHEMA_AGENT.md** (370 LOC) — referencia de tipos con ejemplos
- **ISSUES_MVP.md** (226 LOC) — checklist de tareas con criterios de aceptación
- **ESTIMACIONES_MVP.md** (162 LOC) — story points, análisis de riesgos
- **ELECTRON_INTEGRATION.md** (285 LOC) — arquitectura de IPC
- **INTEGRATION.md** (237 LOC) — capa de abstracción de persistencia

→ **Resultado:** Futuras propuestas tendrán contexto claro para integración

### 2. 🧪 Test Suite Sólido
- **532 passing tests** sin fallos
- Cobertura en: loader, storage, electron handlers, UI modals, permissions
- **20 test files** con patterns consistentes (Bun test + describe/test)
- Tests cubren casos edge (invalid JSON, circular refs, permission validation)

→ **Resultado:** Refactors futuros pueden confiar en tests existentes

### 3. 🏗️ Arquitectura Modular de Alto Nivel
**Layers bien separadas:**
```
src/ui/           → React components (presentation)
src/ui/store/     → Zustand stores (state management)
src/electron/     → IPC bridge (inter-process communication)
src/loader/       → Project loading + validation (business logic)
src/storage/      → Profile/adata persistence (data layer)
src/schemas/      → Zod schemas (data contracts)
src/types/        → Domain types (agent profiles, etc.)
```

→ **Resultado:** Fácil ubicar dónde colocar nuevas features

### 4. 🔒 TypeScript Strict Mode + Zod Validation
- `"strict": true` en tsconfig.json
- Todos los imports de tipos siguen convenciones (`import type { ... }`)
- Validación obligatoria via `schema.safeParse()` (no type casts)
- Inferencia de tipos desde Zod (`type Agent = z.infer<typeof AgentSchema>`)

→ **Resultado:** Nuevas features pueden proponer tipos sin ambigüedad

### 5. 📦 Stack Apropiado para Iteración Rápida
- **Bun:** Runtime + package manager + test runner (sin config)
- **React 19:** Componentes reutilizables, hooks estables
- **Zustand:** State management minimalista (vs Redux boilerplate)
- **Zod:** Validation runtime + type inference en un lugar
- **Vite:** HMR rápido para development
- **Electron:** Desktop app con full Node.js en main process

→ **Resultado:** Propuestas de features pueden iterar rápido si la arquitectura es clara

### 6. 🎯 Convenciones Claras
**README documenta:**
- Nomenclatura (PascalCase para componentes, camelCase para utils, etc.)
- Orden de imports (Node → dependencias → proyecto → types)
- Estructura de tests (*.test.ts colocados, casos feliz + error)
- Commits (Conventional Commits: feat/fix/refactor/test/docs/chore)

→ **Resultado:** Nuevas PRs pueden revisar rápidamente contra convenciones

---

## 🚨 Riesgos por Área

### Loader / Validation Layer (HIGH)
- **Size:** 104K, código complejo con lock manager, cross-validator, repairer
- **Testing:** Adecuado (5 test files, casos edge cubiertos)
- **Risk:** Si se proponen features que modifiquen schema/.afproj, necesita re-validación completa
- **Mitigación:** Documentar cambios de schema en migrations (ver R1 en ESTIMACIONES_MVP.md)

### Electron IPC Bridge (HIGH)
- **Size:** 144K, múltiples handlers (opencode-config, skills, permissions, profiles)
- **Complexity:** Crecimiento orgánico, handlers se fueron agregando
- **Risk:** Nuevas features que requieran IPC tendrán friction por bridge types
- **Mitigación:** Refactor bridge.types.ts para romper ciclos de inferencia

### Asset Panel / File Management (MEDIUM)
- **Size:** Sub-componente de UI pero toca filesystem
- **Testing:** Algunos tests pero menos coverage que loader
- **Risk:** Si se proponen features de import/export custom, necesita validación adicional
- **Mitigación:** Tests para nuevas operaciones de archivo

### Properties Panel (MEDIUM)
- **Size:** 1299 LOC, show casi todo lo relacionado con propiedades de agentes
- **Coupling:** Dependencias de projectStore, agentFlowStore, modals (profile, permissions)
- **Risk:** Cambios en propiedades del agente requerirán refactor aquí
- **Mitigación:** Extraer sub-componentes de propiedades específicas

---

## 📈 Oportunidades de Mejora Identificadas

### 1. 🎯 Refactor TypeScript Types (CRÍTICO)
**Objetivo:** Eliminar stack overflow en compiler

**Acciones:**
- Split `bridge.types.ts` en archivos más pequeños (una responsabilidad por archivo)
- Simplificar discriminated unions usando generics nombrados (reduce inferencia)
- Split projectStore en: projectStore (proyecto) + validationStore (issues) + uiStore (routing)
- Agregar type comments en lugares donde la inferencia sea sospechosa

**Beneficio:** CI/CD pipeline habilitado, nuevas features pueden validar tipos

---

### 2. 🧹 Component Extraction (ALTA PRIORIDAD)
**Objetivo:** Reducir monolitos de 1400+ LOC

**Acciones:**
- **FlowCanvas** → Split en: CanvasViewport (render) + CanvasInteraction (handlers) + LinkLayer (SVG)
- **PropertiesPanel** → Split en: AgentPropertiesSection + ProfilesSection + PermissionsSection
- **PermissionsModal** → Extract SkillsPermissionsEditor como sub-componente reutilizable

**Beneficio:** Más fácil agregar features, tests más granulares, reutilización de lógica

---

### 3. 🔀 Store Restructuring (MEDIA PRIORIDAD)
**Objetivo:** Reducir acoplamiento entre stores

**Acciones:**
- Crear `validationStore` separado (issues, errors, warnings, last load result)
- Crear `uiStore` para routing/navigation
- Mantener projectStore lean (solo proyecto + últimos async ops)
- Usar store subscriptions para sincronización (vs queries directas)

**Beneficio:** Stores más testeables, acoplamiento claro, nuevas features sin cross-cutting concerns

---

### 4. 🧪 UI Testing Framework (MEDIA PRIORIDAD)
**Objetivo:** Mejorar coverage de componentes React

**Acciones:**
- Agregar **@testing-library/react** (bun compatibility exists)
- Escribir tests para: FlowCanvas interactions, PropertiesPanel changes, PermissionsModal flows
- Tests e2e con Playwright o Tauri (si desktop testing es prioritario)

**Beneficio:** Refactors de componentes pueden confiar en tests, regresiones detectadas temprano

---

### 5. 📊 TypeScript Tooling (BAJA PRIORIDAD)
**Objetivo:** Mejorar DX de type checking

**Acciones:**
- Configurar **tsc --incremental** en dev (faster rebuilds)
- Configurar **type-coverage** para identificar `any` creep
- VSCode: configurar settings para auto-format imports

**Beneficio:** Feedback más rápido durante development

---

### 6. 🌳 Branch Cleanup (BAJA PRIORIDAD)
**Objetivo:** Mantener repo limpio

**Acciones:**
- Revisar ramas abandonadas, hacer merge o archive
- Estandarizar nombres: `feat/`, `fix/`, `docs/` (no `feature/`)
- Corregir tipografía: `permissions-property` (no `propety`)

**Beneficio:** Menos confusión al navigar branches, más claridad en historial

---

## 📋 Matriz de Decisión: ¿Proponer Features Ahora?

| Factor | Status | Decisión |
|--------|--------|----------|
| **TypeScript validation** | ❌ BLOQUEADO | Resolver primero |
| **Linter/formatter** | ❌ BLOQUEADO | Instalar Biome |
| **Test suite** | ✅ SÓLIDO | OK |
| **Documentation** | ✅ EXCELENTE | OK |
| **Architecture clarity** | ✅ CLARA | OK (con refactor stores) |
| **Component modularity** | 🟡 MEDIA | Mejorar con splits |
| **Conventions** | ✅ CLARAS | OK |
| **Git hygiene** | 🟡 ACEPTABLE | Cleanup Nice-to-have |

---

## 🎯 Recomendación Final

### ❌ NO Proponer Features Nuevas Ahora

**Razón:** Los blockers de TypeScript + Biome impiden validar código nuevo. Nueva code sin typecheck pasará a main y causará regresiones.

### ✅ Plan de Desbloqueo (2-3 días de work)

**Sprint 0 — Technical Debt Resolution:**

**Día 1:**
1. Instalar/verificar Biome (`bun add -D @biomejs/biome`)
2. Investigar raíz del TypeScript stack overflow
   - Revisar `bridge.types.ts` para ciclos
   - Revisar stores para unions complejas
   - Ejecutar `tsc --extendedDiagnostics` para profiling

**Día 2:**
3. Refactor TypeScript types
   - Split bridge.types en archivos smaller
   - Simplificar discriminated unions
   - Pruebas de `tsc --noEmit` en incrementos

**Día 3:**
4. Split stores (opcional, pero recomendado)
   - validationStore separado
   - Reducir projectStore a ~300 LOC
5. Ejecutar `bun run typecheck && bun run lint && bun test` full suite

**Once Sprint 0 is done:**
- ✅ CI/CD pipeline funcional
- ✅ Type safety habilitada
- ✅ Linting enforced
- ✅ Ahora SÍ listo para propuestas de features

---

## 🧭 Tipos de Propuestas que Encajarían DESPUÉS del Desbloqueo

### ✅ Buenas propuestas para este stack:

1. **Feature: Visual Agent Connections UI** (medio esfuerzo)
   - Encaja: Canvas ya existe, links ya modelados
   - Riesgo: Bajo (FlowCanvas split + tests)
   - Duración: 1-2 sprints

2. **Feature: Agent Profile Templates** (bajo esfuerzo)
   - Encaja: Profile system ya existe, Zod schemas listo
   - Riesgo: Bajo (storage layer estable)
   - Duración: 1 sprint

3. **Feature: OpenCode Config UI** (alto esfuerzo)
   - Encaja: IPC bridge lista, handlers existentes
   - Riesgo: Medio (nueva modal, permisos complejos)
   - Duración: 2 sprints

4. **Refactor: Component Extraction** (medio esfuerzo)
   - Encaja: Tests sólidos, patterns claros
   - Riesgo: Bajo (si hay tests)
   - Duración: 1 sprint

### ❌ Evitar por ahora:

- Features que requieran cambios de schema (hasta resolver R1 de ESTIMACIONES_MVP.md)
- UI features complejas sin test coverage (hasta tener @testing-library/react)
- Cambios al IPC bridge sin splitting types (hasta resolver TypeScript issue)

---

## 📊 Resumen Técnico

| Métrica | Valor | Status |
|---------|-------|--------|
| **LOC total** | ~7,680 | Normal para proyecto de este scope |
| **Test coverage** | 532 passing tests | Excelente |
| **Test failure rate** | 0% | Excelente |
| **TypeScript strict mode** | ✅ Enabled | Excelente |
| **Component size** | 1450 LOC max | Necesita splits |
| **Store size** | 607 LOC max | Necesita splits |
| **Documentation** | 1,395 LOC | Excelente |
| **Code quality (lint)** | ❌ Bloqueado | Necesita fix |
| **Type validation** | ❌ Bloqueado | CRÍTICO fix |
| **Git branches** | 11 active | Cleanup needed |
| **Conventions** | Clara | ✅ OK |

---

## 🏁 Conclusión

**AgentsFlow es un proyecto bien fundamentado con arquitectura clara y tests sólidos**, pero está temporalmente bloqueado por problemas técnicos (TypeScript + tooling).

**No se debe avanzar con nuevas features hasta resolver los blockers**, pero una vez resueltos (2-3 días), el proyecto estará en excelente posición para iterar rápido.

**Recomendación accionable:**
1. ✅ **Resolver TypeScript stack overflow** (Día 1-2)
2. ✅ **Instalar/verificar Biome** (Día 1)
3. ✅ **Refactor stores** (Día 3)
4. ✅ **Split componentes** (Iterativo, 1 sprint después)
5. 🎯 **ENTONCES sí**, proponer features con confianza

---

**Próximo paso:** Asignar 2-3 días a Sprint 0 y reportar estado.

