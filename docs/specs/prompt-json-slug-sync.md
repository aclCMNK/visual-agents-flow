# Spec: Sincronización slug en JSON V2 — directorio del proyecto, campo `prompt` y claves de agente

**Archivo:** `docs/specs/prompt-json-slug-sync.md`  
**Fecha:** 2026-05-05  
**Estado:** Pendiente de implementación  
**Prioridad:** Alta — bug confirmado por QA y usuario

---

## 🎯 Objetivo

Garantizar que **el directorio físico del proyecto**, **el segmento del proyecto en el campo `prompt`** del JSON V2, y **las claves de agente** en el JSON V2 usen **siempre el mismo slug canónico** (`toSlug()`), respetando guiones (`-`) y underscores (`_`) tal como aparecen en el nombre original.

---

## 🐛 Diagnóstico completo de bugs

### Bug principal: `-` → `_` en el directorio del proyecto

#### Síntoma

Cuando el nombre del proyecto contiene guiones (ej: `"my-project"`), el directorio físico se crea como `my_project/` (con underscore), pero el campo `prompt` en el JSON V2 genera `prompts/my-project/agent.md` (con guión). Esto hace que OpenCode no pueda resolver el archivo de prompt porque la ruta en el JSON no coincide con el directorio real en disco.

#### Causa raíz — análisis del flujo completo

El bug tiene **tres actores** en el pipeline de creación y exportación:

---

##### Actor 1 — `src/loader/project-factory.ts` → función `slugify()` local (línea 56-63)

```ts
// ACTUAL (bug):
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")   // ← AQUÍ: convierte "-" a "_"
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "project";
}
```

Esta función **local** (diferente a `toSlug()` de `slugUtils.ts`) convierte **cualquier carácter no alfanumérico** — incluyendo el guión `-` — a underscore `_`.

**Resultado:** `"my-project"` → directorio `my_project/`

---

##### Actor 2 — `src/electron/profile-export-handlers.ts` → `extractProjectName()` (línea 397-399)

```ts
function extractProjectName(projectDir: string): string {
  const parts = projectDir.split(/[\\/]/);
  return parts[parts.length - 1] || 'project';
}
```

Esta función extrae el nombre del directorio físico **verbatim**. Si el directorio es `my_project/`, retorna `"my_project"`.

**Resultado:** `projectName = "my_project"` (con underscore)

---

##### Actor 3 — `src/electron/profile-export-handlers.ts` → `buildDestinationPath()` y `mkdir` (líneas 383-391, 481)

```ts
function buildDestinationPath(projectName, agentName, exportDir) {
  const projectSlug = toSlug(projectName) || "project";  // toSlug("my_project") → "my_project"
  ...
}

await mkdir(join(exportDir, 'prompts', toSlug(projectName) || 'project'), { recursive: true });
// → crea: prompts/my_project/
```

`toSlug("my_project")` preserva el underscore → `"my_project"`. El directorio de prompts se crea como `prompts/my_project/`.

---

##### Actor 4 — `src/ui/components/ExportModal/export-logic.ts` → `buildOpenCodeV2AgentEntry()` (línea 621)

```ts
const projSlug = toSlug(projectName) || "project";
// projectName aquí es el nombre del .afproj: "my-project" (nombre humano)
// toSlug("my-project") → "my-project"
const prompt = `{file:./prompts/${projSlug}/${agentSlug}.md}`;
// → "{file:./prompts/my-project/agent.md}"
```

Aquí `projectName` es el **nombre humano del proyecto** (del `.afproj`), NO el nombre del directorio. `toSlug("my-project")` preserva el guión → `"my-project"`.

---

#### Tabla de divergencia — bug `-` → `_`

| Nombre del proyecto | Directorio físico (project-factory) | Directorio prompts (profile-export-handlers) | Ruta en JSON (export-logic) |
|---|---|---|---|
| `"my-project"` | `my_project/` ❌ | `prompts/my_project/` | `prompts/my-project/` ❌ |
| `"My Project"` | `my_project/` | `prompts/my_project/` | `prompts/my-project/` ❌ |
| `"DevTeam_1"` | `devteam_1/` | `prompts/devteam_1/` | `prompts/devteam_1/` ✓ |
| `"my_project"` | `my_project/` | `prompts/my_project/` | `prompts/my_project/` ✓ |
| `"ÉquipoÁgil"` | `equipoagil/` ❌ | `prompts/equipoagil/` | `prompts/equipoagil/` ✓ |
| `"Drass MemorIA"` | `drass_memoria/` | `prompts/drass_memoria/` | `prompts/drass-memoria/` ❌ |

> **Nota:** El bug solo se manifiesta cuando el nombre contiene `-` o caracteres que `slugify()` convierte a `_` pero `toSlug()` convierte a `-` (espacios, puntos, etc.).

---

### Bug secundario: clave del objeto agente en JSON V2 usa nombre verbatim

#### Síntoma

La clave del objeto agente en el JSON V2 usa el nombre verbatim del agente (ej: `"Björn Ström"`), pero el archivo `.md` en el filesystem usa el slug (ej: `bjorn-strom.md`). OpenCode no puede resolver el agente.

#### Causa raíz

**`src/ui/components/ExportModal/export-logic.ts` línea 672:**

```ts
// ACTUAL (bug):
return { [agentName]: entry };
//        ↑ verbatim: "Björn Ström", "Ágënt Böt", "Ñoño"
```

```ts
// CORRECTO:
const keySlug = toSlug(agentName) || agentName;
return { [keySlug]: entry };
```

---

### Bug terciario: campo `default_agent` usa nombre verbatim

#### Causa raíz

**`src/ui/components/ExportModal/export-logic.ts` línea 725:**

```ts
// ACTUAL (bug):
default_agent = defaultAgent.name;
//              ↑ verbatim: "Mi Agente Principal"
```

```ts
// CORRECTO:
default_agent = toSlug(defaultAgent.name) || defaultAgent.name;
```

---

## 📐 Especificación de la corrección

### Fix 1 (RAÍZ): `project-factory.ts` — función `slugify()` local

**Archivo:** `src/loader/project-factory.ts`  
**Ubicación:** línea 56-63

**Problema:** La función local `slugify()` convierte `-` a `_`, divergiendo de `toSlug()`.

**Solución A (recomendada):** Reemplazar la función local por `toSlug()` importada de `slugUtils.ts`.

```ts
// ANTES:
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "project";
}
```

```ts
// DESPUÉS:
import { toSlug } from "../ui/utils/slugUtils.ts";

export function slugify(name: string): string {
  return toSlug(name.trim()).slice(0, 80) || "project";
}
```

**Solución B (alternativa mínima):** Cambiar solo el regex para preservar `-`:

```ts
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")   // preserva - y _
    .replace(/-{2,}/g, "-")            // colapsa hyphens consecutivos
    .replace(/^[-_]+|[-_]+$/g, "")     // strip leading/trailing
    .slice(0, 80) || "project";
}
```

> **Regla:** La función `slugify()` en `project-factory.ts` DEBE producir el mismo resultado que `toSlug()` de `slugUtils.ts` para cualquier entrada. Si se mantienen como funciones separadas, deben tener comportamiento idéntico.

---

### Fix 2: `buildOpenCodeV2AgentEntry` — clave del objeto retornado

**Archivo:** `src/ui/components/ExportModal/export-logic.ts`  
**Ubicación:** línea ~672

**Antes:**
```ts
return { [agentName]: entry };
```

**Después:**
```ts
const keySlug = toSlug(agentName) || agentName;
return { [keySlug]: entry };
```

**Regla:** La clave del objeto agente en el JSON V2 DEBE ser siempre `toSlug(agentName)`. Si `toSlug` retorna vacío (nombre completamente inválido), usar `agentName` como fallback de emergencia.

---

### Fix 3: `buildOpenCodeV2Config` — campo `default_agent`

**Archivo:** `src/ui/components/ExportModal/export-logic.ts`  
**Ubicación:** línea ~725

**Antes:**
```ts
default_agent = defaultAgent.name;
```

**Después:**
```ts
default_agent = toSlug(defaultAgent.name) || defaultAgent.name;
```

**Regla:** `default_agent` DEBE ser el slug del agente, para que coincida con la clave del objeto agente en el mismo JSON.

---

### Invariante de consistencia (contrato)

Para cualquier proyecto y agente exportado en V2, las siguientes expresiones DEBEN producir el mismo valor:

```
toSlug(project.name)                  // slug canónico del proyecto
↓
nombre del directorio físico          // <baseDir>/<slug>/
↓
segmento proyecto en prompt           // prompts/<slug>/agent.md
↓
directorio de prompts creado          // <exportDir>/prompts/<slug>/
```

Y para el agente:

```
toSlug(agent.name)                    // slug canónico del agente
↓
clave en agentObj del JSON            // { [slug]: entry }
↓
nombre del archivo .md en filesystem  // prompts/<projSlug>/<slug>.md
↓
segmento final del campo prompt       // {file:./prompts/<projSlug>/<slug>.md}
↓
valor de default_agent (si aplica)    // "<slug>"
```

---

## 🧪 Casos de prueba exhaustivos

### Suite 1: `project-factory.ts::slugify` — preservación de guiones

```ts
// Caso 1: guión preservado (BUG PRINCIPAL)
expect(slugify("my-project")).toBe("my-project");
// Antes del fix: "my_project" ← BUG

// Caso 2: underscore preservado
expect(slugify("my_project")).toBe("my_project");

// Caso 3: espacio → guión (no underscore)
expect(slugify("My Project")).toBe("my-project");
// Antes del fix: "my_project" ← BUG

// Caso 4: guión y underscore mixtos
expect(slugify("my-project_v2")).toBe("my-project_v2");
// Antes del fix: "my_project_v2" ← BUG (guión convertido a underscore)

// Caso 5: punto → guión
expect(slugify("my.project")).toBe("my-project");
// Antes del fix: "my_project" ← BUG

// Caso 6: nombre con acento
expect(slugify("ÉquipoÁgil")).toBe("equipoagil");

// Caso 7: nombre con ß (CHAR_MAP)
expect(slugify("Straße")).toBe("strasse");

// Caso 8: nombre con ø (CHAR_MAP)
expect(slugify("Søren")).toBe("soren");

// Caso 9: nombre con espacios múltiples
expect(slugify("Drass  MemorIA")).toBe("drass-memoria");
// Antes del fix: "drass__memoria" ← BUG

// Caso 10: nombre largo (max 80 chars)
expect(slugify("a".repeat(90)).length).toBeLessThanOrEqual(80);

// Caso 11: nombre completamente inválido → fallback "project"
expect(slugify("!!!")).toBe("project");

// Caso 12: nombre vacío → fallback "project"
expect(slugify("")).toBe("project");

// Caso 13: nombre con guión al inicio/final → strip
expect(slugify("-my-project-")).toBe("my-project");

// Caso 14: guiones consecutivos → colapsar
expect(slugify("my--project")).toBe("my-project");
```

### Suite 2: Consistencia `slugify` (project-factory) ↔ `toSlug` (slugUtils)

```ts
import { slugify } from "../../src/loader/project-factory.ts";
import { toSlug } from "../../src/ui/utils/slugUtils.ts";

// Para cualquier nombre de proyecto, slugify y toSlug deben producir el mismo resultado
// (salvo el límite de longitud: slugify tiene max 80, toSlug tiene max 64)
const testNames = [
  "my-project",
  "my_project",
  "My Project",
  "DevTeam_1",
  "Drass MemorIA",
  "ÉquipoÁgil",
  "Straße",
  "Søren",
  "my.project",
  "my-project_v2",
  "Agent.Bot",
];

for (const name of testNames) {
  const fromFactory = slugify(name);
  const fromSlugUtils = toSlug(name.trim()) || "project";
  expect(fromFactory).toBe(fromSlugUtils.slice(0, 80));
}
```

### Suite 3: `buildOpenCodeV2AgentEntry` — clave del objeto

```ts
// Caso 1: nombre con acento
const result = buildOpenCodeV2AgentEntry(
  { id: "1", name: "Björn Ström", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result)[0]).toBe("bjorn-strom");
expect(result["bjorn-strom"].prompt).toBe("{file:./prompts/myproject/bjorn-strom.md}");

// Caso 2: CHAR_MAP — ß
const result2 = buildOpenCodeV2AgentEntry(
  { id: "2", name: "Straße", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result2)[0]).toBe("strasse");
expect(result2["strasse"].prompt).toBe("{file:./prompts/myproject/strasse.md}");

// Caso 3: CHAR_MAP — ø (Scandinavian)
const result3 = buildOpenCodeV2AgentEntry(
  { id: "3", name: "Søren", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result3)[0]).toBe("soren");

// Caso 4: CHAR_MAP — þ (Icelandic)
const result4 = buildOpenCodeV2AgentEntry(
  { id: "4", name: "Þórr", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result4)[0]).toBe("thorr");

// Caso 5: CHAR_MAP — € (currency)
const result5 = buildOpenCodeV2AgentEntry(
  { id: "5", name: "€uro Agent", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result5)[0]).toBe("euro-agent");

// Caso 6: nombre con punto (CHAR_MAP: . → -)
const result6 = buildOpenCodeV2AgentEntry(
  { id: "6", name: "Agent.Bot", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result6)[0]).toBe("agent-bot");

// Caso 7: underscore preservado
const result7 = buildOpenCodeV2AgentEntry(
  { id: "7", name: "my_agent", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result7)[0]).toBe("my_agent");
expect(result7["my_agent"].prompt).toBe("{file:./prompts/myproject/my_agent.md}");

// Caso 8: hyphen preservado
const result8 = buildOpenCodeV2AgentEntry(
  { id: "8", name: "my-agent", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result8)[0]).toBe("my-agent");

// Caso 9: nombre con espacios
const result9 = buildOpenCodeV2AgentEntry(
  { id: "9", name: "Mi Agente Principal", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result9)[0]).toBe("mi-agente-principal");

// Caso 10: nombre con ñ (NFD strip)
const result10 = buildOpenCodeV2AgentEntry(
  { id: "10", name: "Ñoño", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result10)[0]).toBe("nono");

// Caso 11: nombre largo (max 64 chars)
const longName = "A".repeat(70);
const result11 = buildOpenCodeV2AgentEntry(
  { id: "11", name: longName, agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result11)[0].length).toBeLessThanOrEqual(64);

// Caso 12: nombre completamente inválido (fallback)
// toSlug("!!!") → "" → fallback a agentName
const result12 = buildOpenCodeV2AgentEntry(
  { id: "12", name: "!!!", agentType: "Agent", ... },
  "MyProject"
);
expect(Object.keys(result12)[0]).toBe("!!!");
```

### Suite 4: `buildOpenCodeV2AgentEntry` — proyecto con guión (bug `-` → `_`)

```ts
// Caso crítico: proyecto con guión → el segmento en prompt debe usar guión
const result = buildOpenCodeV2AgentEntry(
  { id: "1", name: "my-agent", agentType: "Agent", ... },
  "my-project"
);
// El directorio físico (post-fix) será: my-project/
// El prompt debe ser: prompts/my-project/my-agent.md
expect(result["my-agent"].prompt).toBe("{file:./prompts/my-project/my-agent.md}");

// Caso: proyecto con espacio → guión en prompt
const result2 = buildOpenCodeV2AgentEntry(
  { id: "2", name: "worker", agentType: "Agent", ... },
  "Drass MemorIA"
);
// El directorio físico (post-fix) será: drass-memoria/
// El prompt debe ser: prompts/drass-memoria/worker.md
expect(result2["worker"].prompt).toBe("{file:./prompts/drass-memoria/worker.md}");

// Caso: proyecto con underscore → underscore preservado en prompt
const result3 = buildOpenCodeV2AgentEntry(
  { id: "3", name: "worker", agentType: "Agent", ... },
  "DevTeam_1"
);
// El directorio físico será: devteam_1/
// El prompt debe ser: prompts/devteam_1/worker.md
expect(result3["worker"].prompt).toBe("{file:./prompts/devteam_1/worker.md}");
```

### Suite 5: `buildOpenCodeV2Config` — campo `default_agent`

```ts
// Caso 1: default_agent con acento
const config = buildOpenCodeV2Config(
  [{ id: "1", name: "Björn Ström", agentType: "Agent", ... }],
  { defaultAgentId: "1", plugins: [], hideDefaultPlanner: false, hideDefaultBuilder: false },
  "MyProject"
);
expect(config.default_agent).toBe("bjorn-strom");
// Y debe coincidir con la clave del objeto agente:
expect("bjorn-strom" in config.agent).toBe(true);

// Caso 2: default_agent con ß
const config2 = buildOpenCodeV2Config(
  [{ id: "2", name: "Straße", agentType: "Agent", ... }],
  { defaultAgentId: "2", ... },
  "MyProject"
);
expect(config2.default_agent).toBe("strasse");
expect("strasse" in config2.agent).toBe(true);

// Caso 3: default_agent sin agente seleccionado → ""
const config3 = buildOpenCodeV2Config(
  [{ id: "1", name: "Agent", agentType: "Agent", ... }],
  { defaultAgentId: undefined, ... },
  "MyProject"
);
expect(config3.default_agent).toBe("");
```

### Suite 6: Consistencia clave ↔ prompt ↔ filesystem

```ts
// Para cualquier agente, la clave del JSON y el segmento final del prompt deben coincidir
function assertKeyPromptConsistency(agentName: string, projectName: string) {
  const result = buildOpenCodeV2AgentEntry(
    { id: "x", name: agentName, agentType: "Agent", ... },
    projectName
  );
  const key = Object.keys(result)[0];
  const prompt = result[key].prompt;
  // El prompt termina en "<key>.md}"
  expect(prompt.endsWith(`${key}.md}`)).toBe(true);
}

assertKeyPromptConsistency("Björn Ström", "MyProject");
assertKeyPromptConsistency("Straße", "MyProject");
assertKeyPromptConsistency("my_agent", "MyProject");
assertKeyPromptConsistency("Ñoño", "MyProject");
assertKeyPromptConsistency("€uro Agent", "MyProject");
assertKeyPromptConsistency("Þórr", "MyProject");
assertKeyPromptConsistency("Mi Agente", "MyProject");
assertKeyPromptConsistency("my-agent", "my-project");
assertKeyPromptConsistency("worker", "Drass MemorIA");
```

### Suite 7: Consistencia directorio físico ↔ ruta en JSON (integración)

```ts
// Verifica que el directorio creado por project-factory y la ruta en el JSON coincidan
import { slugify } from "../../src/loader/project-factory.ts";
import { toSlug } from "../../src/ui/utils/slugUtils.ts";

const projectNames = [
  "my-project",       // BUG PRINCIPAL: antes → my_project vs my-project
  "My Project",       // antes → my_project vs my-project
  "DevTeam_1",        // OK: devteam_1 vs devteam_1
  "Drass MemorIA",    // antes → drass_memoria vs drass-memoria
  "ÉquipoÁgil",       // antes → equipoagil vs equipoagil (OK por coincidencia)
  "my.project",       // antes → my_project vs my-project
  "my-project_v2",    // antes → my_project_v2 vs my-project_v2
];

for (const name of projectNames) {
  const dirSlug = slugify(name);           // lo que crea project-factory en disco
  const jsonSlug = toSlug(name) || "project"; // lo que usa export-logic en el JSON
  // POST-FIX: deben ser iguales
  expect(dirSlug).toBe(jsonSlug.slice(0, 80));
}
```

---

## 📁 Archivos afectados

| Archivo | Cambio requerido |
|---|---|
| `src/loader/project-factory.ts` | **Fix 1 (RAÍZ):** Reemplazar `slugify()` local para preservar `-` igual que `toSlug()` |
| `src/ui/components/ExportModal/export-logic.ts` | **Fix 2:** Clave objeto agente → usar `toSlug(agentName)` (línea ~672) |
| `src/ui/components/ExportModal/export-logic.ts` | **Fix 3:** Campo `default_agent` → usar `toSlug(defaultAgent.name)` (línea ~725) |
| `tests/loader/project-factory.test.ts` | Agregar Suite 1 y Suite 2 |
| `tests/ui/opencode-v2-config.test.ts` | Actualizar tests que esperan verbatim; agregar Suites 3-6 |

> **No se requieren cambios en:**
> - `src/ui/utils/slugUtils.ts` — `toSlug()` ya es correcto
> - `src/electron/profile-export-handlers.ts` — ya usa `toSlug()` correctamente para el filesystem de prompts

---

## ⚠️ Riesgos y consideraciones

### Riesgo 1: Proyectos existentes con directorio `_` (migración)

Si un usuario ya tiene un proyecto creado con el directorio `my_project/` (con underscore), después del fix los nuevos proyectos se crearán como `my-project/`. Los proyectos existentes **no se renombran automáticamente**. Esto es aceptable porque:
- El directorio del proyecto es el que manda (es la fuente de verdad)
- El JSON se regenera en cada exportación
- El fix solo afecta proyectos **nuevos**

Para proyectos existentes, el JSON seguirá usando `toSlug(extractProjectName(projectDir))` que preservará el underscore del directorio existente.

### Riesgo 2: Tests existentes que esperan comportamiento antiguo

Los tests en `tests/ui/opencode-v2-config.test.ts` que esperan claves verbatim (ej: `result["My Agent"]`, `result["Sub-Worker"]`) deben actualizarse para esperar slugs. Buscar y actualizar:
- Línea 112: `result["My Agent"]` → `result["my-agent"]`
- Línea 122: `["Research-Agent"]` → `["research-agent"]`
- Línea 127: `result["El Jefe"]` → `result["el-jefe"]`
- Línea 132: `result["Sub-Worker"]` → `result["sub-worker"]`
- Línea 137: `result["Coordinador"]` → `result["coordinador"]`
- Línea 142: `result["Agénte Líder"]` → `result["agente-lider"]`

### Riesgo 3: Compatibilidad con agentes ya exportados

Si un usuario exportó previamente con claves verbatim y tiene un `opencode.json` con `"Björn Ström"` como clave, la corrección cambiará la clave a `"bjorn-strom"`. Esto es **correcto** porque el archivo físico siempre fue `bjorn-strom.md`. El JSON anterior era el que estaba mal.

### Riesgo 4: Agentes con nombres ASCII puros

Para nombres como `"my-agent"`, `"agent"`, `"my_agent"`, `toSlug()` retorna el mismo valor que el nombre original. **No hay cambio de comportamiento** para estos casos.

### Riesgo 5: Fallback cuando `toSlug` retorna vacío

Si `toSlug(agentName)` retorna `""` (nombre completamente inválido como `"!!!"`), el fallback debe ser `agentName` verbatim. Esto ya está implementado en el campo `prompt` (`|| agentName`) y debe replicarse en la clave del objeto.

### Riesgo 6: Colisión de slugs entre agentes

Si dos agentes tienen nombres distintos que producen el mismo slug (ej: `"Björn"` y `"Bjorn"`), el segundo sobrescribirá al primero en `agentObj`. Este es un problema de diseño preexistente, fuera del scope de este fix. Se recomienda agregar una advertencia en consola si se detecta colisión.

---

## 📝 Notas de implementación

1. **Importar `toSlug` en `project-factory.ts`**: La función `toSlug` está en `src/ui/utils/slugUtils.ts`. Verificar que el path de importación sea correcto desde `src/loader/project-factory.ts` → `../ui/utils/slugUtils.ts`.

2. **No duplicar `toSlug` en `buildOpenCodeV2AgentEntry`**: La variable `agentSlug` ya se calcula para el campo `prompt`. Reutilizarla como clave del objeto retornado.

3. **Orden de operaciones en `buildOpenCodeV2Config`**: El slug de `default_agent` debe calcularse con la misma función `toSlug` importada en el módulo. No inline la lógica.

4. **Actualizar el comentario en `project-factory.ts`**: El comentario en línea 21 dice `spaces→'_'`. Debe actualizarse a `spaces→'-'` después del fix.

5. **Actualizar el comentario en línea 238**: `"my_cool_project"` → `"my-cool-project"` en el ejemplo del comentario.

---

## ✅ Criterio de aceptación

### Bug principal (`-` → `_` en directorio)
- [ ] `slugify("my-project")` === `"my-project"` (no `"my_project"`)
- [ ] `slugify("My Project")` === `"my-project"` (no `"my_project"`)
- [ ] `slugify("my.project")` === `"my-project"` (no `"my_project"`)
- [ ] `slugify("my_project")` === `"my_project"` (underscore preservado)
- [ ] `slugify("DevTeam_1")` === `"devteam_1"` (underscore preservado)
- [ ] Para todo nombre de proyecto: `slugify(name)` === `toSlug(name.trim()).slice(0, 80) || "project"`

### Bug secundario (clave agente verbatim)
- [ ] `Object.keys(buildOpenCodeV2AgentEntry({ name: "Björn Ström", ... }, "P"))[0]` === `"bjorn-strom"`
- [ ] `Object.keys(buildOpenCodeV2AgentEntry({ name: "Straße", ... }, "P"))[0]` === `"strasse"`
- [ ] `Object.keys(buildOpenCodeV2AgentEntry({ name: "Søren", ... }, "P"))[0]` === `"soren"`
- [ ] `Object.keys(buildOpenCodeV2AgentEntry({ name: "my_agent", ... }, "P"))[0]` === `"my_agent"`
- [ ] `Object.keys(buildOpenCodeV2AgentEntry({ name: "my-agent", ... }, "P"))[0]` === `"my-agent"`

### Bug terciario (default_agent verbatim)
- [ ] `buildOpenCodeV2Config([{ name: "Björn Ström", ... }], { defaultAgentId: "1", ... }, "P").default_agent` === `"bjorn-strom"`
- [ ] Para todo agente, `default_agent` coincide con la clave del objeto agente en el mismo JSON

### Invariante de consistencia
- [ ] Para todo agente, `prompt` termina en `<clave>.md}` donde `<clave>` es la clave del objeto
- [ ] El directorio físico creado por `project-factory` coincide con el segmento de proyecto en el `prompt` del JSON
- [ ] Todos los tests de las suites anteriores pasan
- [ ] No hay regresión en nombres ASCII puros (`my-agent`, `agent`, `my_agent`, `DevTeam_1`)
