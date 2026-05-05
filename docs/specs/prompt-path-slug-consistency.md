# 📋 Spec: Consistencia de Slug en Rutas de Prompts (Filesystem vs JSON)

> **⚠️ INSTRUCCIÓN OBLIGATORIA PARA EL DEVELOPER:**
> Debes leer este documento **DOS VECES COMPLETAS** antes de tocar cualquier línea de código.
> Confirma en tu respuesta: "He leído las specs dos veces y entiendo todos los casos borde."

---

## 🎯 Objetivo

Garantizar que el directorio físico creado en el filesystem y el campo `prompt` en el JSON exportado usen **exactamente la misma función de transformación** y produzcan **exactamente el mismo string** para cualquier nombre de proyecto o agente, incluyendo nombres con `-`, `_`, acentos, espacios y caracteres especiales.

---

## 🧩 Contexto del Problema

### Arquitectura actual

El sistema exporta configuraciones de agentes en dos formatos:

1. **V1** (`buildAgentOpenCodeJson` en `export-logic.ts`): genera `{file:./prompt/<projSlug>/<agentSlug>.md}`
2. **V2** (`buildOpenCodeV2AgentEntry` en `export-logic.ts`): genera `{file:./prompts/<projSlug>/<agentName>.md}`

El **filesystem** (lado Electron) crea el directorio físico en `profile-export-handlers.ts` usando su propia copia local de `toSlug()`.

### Raíz del problema histórico

Ha habido múltiples iteraciones de bugs porque:

1. **Dos implementaciones de `toSlug`** existen en paralelo:
   - `src/ui/utils/slugUtils.ts` → exportada como `toSlug()` (UI side)
   - `src/electron/profile-export-handlers.ts` → función local `toSlug()` (Electron side)

2. **Divergencias pasadas documentadas:**
   - `_` en CHAR_MAP convertía `_` → `-` antes de que el paso 3 pudiera preservarlo
   - `buildOpenCodeV2AgentEntry` usaba `projectName.toLowerCase()` en vez de `toSlug(projectName)`
   - La función local de Electron no incluía el paso `applyCharMap` (CHAR_MAP), por lo que `ß`, `ñ`, etc. se procesaban diferente

3. **Estado actual (post-fixes):** Ambas funciones están sincronizadas en lógica, pero la función local de Electron **no aplica CHAR_MAP** (no tiene el paso `applyCharMap`). Esto es una divergencia latente para nombres con `ß`, `ø`, `æ`, `œ`, etc.

---

## 🔍 Diagnóstico Detallado

### Función canónica: `toSlug()` en `src/ui/utils/slugUtils.ts`

```
Pipeline de 6 pasos:
1. toLowerCase()
2. applyCharMap()  ← aplica CHAR_MAP: ß→ss, ø→o, æ→ae, .→-, " "→-, etc.
3. NFD normalize + strip combining marks (U+0300–U+036F)
4. replace /[^a-z0-9\-_]+/g → "-"   ← preserva - y _
5. replace /-{2,}/g → "-"            ← colapsa hyphens consecutivos
6. replace /^[-_]+|[-_]+$/g → ""     ← strip leading/trailing - y _
7. Enforce max length (64 chars)
```

### Función local: `toSlug()` en `src/electron/profile-export-handlers.ts`

```
Pipeline de 4 pasos:
1. toLowerCase()
2. NFD normalize + strip combining marks  ← NO tiene applyCharMap antes
3. replace /[^a-z0-9\-_]+/g → "-"
4. replace /-{2,}/g → "-"
5. replace /^[-_]+|[-_]+$/g → ""
   (sin enforce max length)
```

### Tabla de divergencias actuales

| Input | `slugUtils.ts toSlug()` | `profile-export-handlers.ts toSlug()` | ¿Diverge? |
|-------|------------------------|--------------------------------------|-----------|
| `"my-project"` | `"my-project"` | `"my-project"` | ✅ No |
| `"my_project"` | `"my_project"` | `"my_project"` | ✅ No |
| `"my-project_v2"` | `"my-project_v2"` | `"my-project_v2"` | ✅ No |
| `"Mi Proyecto"` | `"mi-proyecto"` | `"mi-proyecto"` | ✅ No |
| `"straße"` | `"strasse"` | `"strae"` | ❌ **SÍ** |
| `"søren"` | `"soren"` | `"sren"` | ❌ **SÍ** |
| `"façade"` | `"facade"` | `"facade"` | ✅ No (NFD resuelve ç) |
| `"œuvre"` | `"oeuvre"` | `"-uvre"` → `"uvre"` | ❌ **SÍ** |
| `"my.project"` | `"my-project"` | `"my-project"` | ✅ No (NFD step) |
| `"Agënte Böt"` | `"agente-bot"` | `"agente-bot"` | ✅ No (NFD resuelve ë, ö) |

> **Nota:** Los caracteres que NFD puede descomponer (á, é, ë, ö, ñ, ç, etc.) se resuelven igual en ambas funciones. Los que NO se descomponen por NFD (ß, ø, œ, æ, ł, ð, þ) **divergen** porque solo `slugUtils.ts` tiene CHAR_MAP.

### Divergencia en `buildOpenCodeV2AgentEntry`: agentName no slugificado

En `export-logic.ts` línea 622:
```ts
const prompt = `{file:.${separator}prompts${separator}${projSlug}${separator}${agentName}.md}`;
```

`agentName` viene de `agent.name` **sin pasar por `toSlug()`**, mientras que en el filesystem (`profile-export-handlers.ts` línea 327):
```ts
const agentSlug = toSlug(agentName) || agentName;
```

El filesystem **sí slugifica** el nombre del agente. Si el agente tiene nombre con caracteres especiales, el JSON apuntará a un archivo diferente al que existe en disco.

---

## 🚀 Plan de Acción

### Fix 1: Unificar implementaciones de `toSlug` — eliminar la copia local

**Problema:** Hay dos implementaciones de `toSlug`. La de Electron no tiene CHAR_MAP.

**Solución:** La función local en `profile-export-handlers.ts` debe ser idéntica a la de `slugUtils.ts`, incluyendo CHAR_MAP y el paso `applyCharMap`.

**Alternativa preferida:** Compartir la función via un módulo compartido (si la arquitectura lo permite). Si Electron no puede importar desde `src/ui/`, mantener la copia pero sincronizarla **exactamente**.

### Fix 2: Slugificar `agentName` en `buildOpenCodeV2AgentEntry`

**Problema:** El JSON usa `agentName` verbatim; el filesystem usa `toSlug(agentName)`.

**Solución:** Aplicar `toSlug(agentName)` también en el campo `prompt` del JSON V2.

---

## 📁 Archivos a Modificar

| Archivo | Función | Cambio requerido |
|---------|---------|-----------------|
| `src/electron/profile-export-handlers.ts` | `toSlug()` (local, línea 49) | Agregar CHAR_MAP y `applyCharMap()` idénticos a `slugUtils.ts` |
| `src/ui/components/ExportModal/export-logic.ts` | `buildOpenCodeV2AgentEntry()` (línea 602) | Cambiar `agentName` → `toSlug(agentName) \|\| agentName` en el campo `prompt` |

---

## 📐 Especificaciones Exactas

### Spec 1: `toSlug()` en `profile-export-handlers.ts`

La función local debe implementar **exactamente** este pipeline:

```typescript
// ── CHAR_MAP — debe ser idéntico al de slugUtils.ts ──────────────────────
const CHAR_MAP: Record<string, string> = {
  ß: "ss",
  ð: "d",
  þ: "th",
  ø: "o",
  œ: "oe",
  æ: "ae",
  ł: "l",
  đ: "d",
  ħ: "h",
  ı: "i",
  ĸ: "k",
  ŋ: "n",
  "€": "e",
  "£": "l",
  ".": "-",
  " ": "-",
  // NOTA CRÍTICA: "_" NO debe estar en este mapa.
  // Si "_" estuviera aquí, se convertiría a "-" ANTES del paso 4,
  // y "my_project" produciría "my-project" en vez de "my_project".
};

function applyCharMap(input: string): string {
  let result = "";
  for (const ch of input) {
    result += CHAR_MAP[ch] ?? ch;
  }
  return result;
}

function toSlug(input: string): string {
  let s = input.toLowerCase();
  // Paso 1: CHAR_MAP (antes de NFD para que ß→ss funcione)
  s = applyCharMap(s);
  // Paso 2: NFD + strip combining marks
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Paso 3: Preservar - y _; reemplazar todo lo demás con -
  s = s.replace(/[^a-z0-9\-_]+/g, "-");
  // Paso 4: Colapsar hyphens consecutivos
  s = s.replace(/-{2,}/g, "-");
  // Paso 5: Strip leading/trailing - y _
  s = s.replace(/^[-_]+|[-_]+$/g, "");
  // Paso 6: Enforce max length (64 chars, igual que slugUtils.ts)
  if (s.length > 64) {
    s = s.slice(0, 64);
    s = s.replace(/-+$/, "");
  }
  return s;
}
```

**⚠️ Advertencia crítica:** El orden de los pasos importa. `applyCharMap` DEBE ir antes de `normalize("NFD")` porque `ß` no se descompone por NFD (no tiene forma NFD estándar que resulte en ASCII).

### Spec 2: `buildOpenCodeV2AgentEntry` en `export-logic.ts`

Cambiar la línea 622 de:
```typescript
const prompt = `{file:.${separator}prompts${separator}${projSlug}${separator}${agentName}.md}`;
```

A:
```typescript
const agentSlug = toSlug(agentName) || agentName;
const prompt = `{file:.${separator}prompts${separator}${projSlug}${separator}${agentSlug}.md}`;
```

---

## 🧪 Casos de Prueba — Input/Output Esperado

### Casos normales (deben funcionar igual en ambas implementaciones)

| Input (projectName) | Output `toSlug()` | Directorio creado | Campo JSON `prompt` |
|--------------------|-------------------|-------------------|---------------------|
| `"my-project"` | `"my-project"` | `prompts/my-project/` | `{file:./prompts/my-project/agent.md}` |
| `"my_project"` | `"my_project"` | `prompts/my_project/` | `{file:./prompts/my_project/agent.md}` |
| `"my-project_v2"` | `"my-project_v2"` | `prompts/my-project_v2/` | `{file:./prompts/my-project_v2/agent.md}` |
| `"Mi Proyecto"` | `"mi-proyecto"` | `prompts/mi-proyecto/` | `{file:./prompts/mi-proyecto/agent.md}` |
| `"My Project 2026"` | `"my-project-2026"` | `prompts/my-project-2026/` | `{file:./prompts/my-project-2026/agent.md}` |

### Casos con caracteres especiales (requieren CHAR_MAP)

| Input | Output correcto | Output incorrecto (sin CHAR_MAP) |
|-------|----------------|----------------------------------|
| `"straße"` | `"strasse"` | `"strae"` ❌ |
| `"søren"` | `"soren"` | `"sren"` ❌ |
| `"œuvre"` | `"oeuvre"` | `"uvre"` ❌ |
| `"æsthetic"` | `"aesthetic"` | `"sthetic"` ❌ |
| `"straße-projekt"` | `"strasse-projekt"` | `"strae-projekt"` ❌ |

### Casos borde críticos

| Input | Output esperado | Explicación |
|-------|----------------|-------------|
| `"my_project"` | `"my_project"` | `_` se preserva (NO está en CHAR_MAP) |
| `"my-project"` | `"my-project"` | `-` se preserva |
| `"my--project"` | `"my-project"` | hyphens consecutivos se colapsan |
| `"my__project"` | `"my__project"` | underscores consecutivos NO se colapsan (solo hyphens) |
| `"_my_project_"` | `"my_project"` | leading/trailing `_` se strip |
| `"-my-project-"` | `"my-project"` | leading/trailing `-` se strip |
| `"my_-project"` | `"my_-project"` | combinación válida, se preserva |
| `"MY_PROJECT"` | `"my_project"` | lowercase aplicado |
| `"my.project"` | `"my-project"` | `.` → `-` via CHAR_MAP |
| `"my project"` | `"my-project"` | espacio → `-` via CHAR_MAP |
| `""` (vacío) | `""` | retorna vacío, el caller usa fallback `"project"` |
| `"___"` | `""` | todo stripped, retorna vacío |
| `"---"` | `""` | todo stripped, retorna vacío |
| `"a"` (1 char) | `"a"` | válido (toSlug no impone min length, solo slugify lo hace) |
| Nombre de 100 chars | primeros 64 chars (sin trailing `-`) | enforce max length |

### Casos borde para agentName en V2

| `agent.name` | `toSlug(agent.name)` | Path en JSON | Path en filesystem |
|-------------|---------------------|--------------|-------------------|
| `"my-agent"` | `"my-agent"` | `prompts/proj/my-agent.md` | `prompts/proj/my-agent.md` ✅ |
| `"my_agent"` | `"my_agent"` | `prompts/proj/my_agent.md` | `prompts/proj/my_agent.md` ✅ |
| `"Straße Bot"` | `"strasse-bot"` | `prompts/proj/strasse-bot.md` | `prompts/proj/strasse-bot.md` ✅ |
| `"Straße Bot"` (sin fix) | N/A | `prompts/proj/Straße Bot.md` ❌ | `prompts/proj/strasse-bot.md` |

---

## 🗂️ Estructura de Archivos Relevantes

```
src/
├── ui/
│   ├── utils/
│   │   └── slugUtils.ts                    ← FUENTE DE VERDAD de toSlug()
│   └── components/
│       └── ExportModal/
│           └── export-logic.ts             ← buildAgentOpenCodeJson (V1)
│                                              buildOpenCodeV2AgentEntry (V2)
│                                              buildOpenCodeV2Config
└── electron/
    └── profile-export-handlers.ts          ← toSlug() LOCAL (debe sincronizarse)
                                               buildDestinationPath()
                                               mkdir() calls

tests/
└── ui/
    └── slug-utils.test.ts                  ← Tests existentes de toSlug/slugify
```

---

## ✅ Checklist de Verificación Post-Implementación

El developer debe verificar cada punto antes de considerar el fix completo:

- [ ] `toSlug("straße")` retorna `"strasse"` en **ambas** implementaciones
- [ ] `toSlug("søren")` retorna `"soren"` en **ambas** implementaciones
- [ ] `toSlug("my_project")` retorna `"my_project"` en **ambas** implementaciones (NO `"my-project"`)
- [ ] `toSlug("my-project")` retorna `"my-project"` en **ambas** implementaciones
- [ ] `toSlug("my-project_v2")` retorna `"my-project_v2"` en **ambas** implementaciones
- [ ] `toSlug("MY_PROJECT")` retorna `"my_project"` en **ambas** implementaciones
- [ ] `toSlug("")` retorna `""` en **ambas** implementaciones
- [ ] El campo `prompt` en JSON V2 usa `toSlug(agentName)` (no `agentName` verbatim)
- [ ] El directorio creado en filesystem usa el mismo slug que el campo `prompt` en JSON
- [ ] Los tests existentes en `slug-utils.test.ts` siguen pasando
- [ ] Agregar tests para los casos con CHAR_MAP (ß, ø, œ, æ) si no existen

---

## ⚠️ Riesgos y Advertencias

### Riesgo 1: Orden de pasos en el pipeline
`applyCharMap` DEBE ejecutarse ANTES de `normalize("NFD")`. Si se invierte el orden, `ß` no se convierte a `"ss"` porque NFD no descompone `ß` en caracteres ASCII.

### Riesgo 2: `_` en CHAR_MAP
`_` NO debe estar en CHAR_MAP. Si se agrega `"_": "-"`, entonces `"my_project"` → `"my-project"` (incorrecto). El paso 3 (`replace /[^a-z0-9\-_]+/g`) ya preserva `_` sin necesidad de mapearlo.

### Riesgo 3: Underscores consecutivos
El paso 4 solo colapsa hyphens consecutivos (`-{2,}`), NO underscores. `"my__project"` → `"my__project"` (se preservan ambos underscores). Esto es intencional y consistente con la función canónica.

### Riesgo 4: Migración de exports existentes
Si hay archivos `.md` ya exportados con nombres incorrectos (e.g., `strae-projekt.md` en vez de `strasse-projekt.md`), el fix no los renombra automáticamente. Los usuarios deberán re-exportar.

### Riesgo 5: agentName en V2 ya es slug
En la práctica, `agent.name` en V2 ya debería ser un slug (generado por `slugify()` al crear el agente). Sin embargo, si por alguna razón contiene caracteres especiales, el fix en `buildOpenCodeV2AgentEntry` los normalizará correctamente.

---

## 📝 Notas Adicionales

- La función `slugify()` (con collision resolution) NO debe usarse para paths — solo `toSlug()`. `slugify()` convierte `_` a `-` para cumplir con `isSlugValid()`, lo cual rompería la consistencia de paths.
- El campo `prompt` en V1 usa `"prompt"` (singular) y en V2 usa `"prompts"` (plural). Esto es intencional y no debe cambiarse.
- En Windows, el separador es `\\` en vez de `/`. Esto ya está implementado y no debe modificarse.
- El fallback cuando `toSlug()` retorna vacío es `"project"` para projectName y `agentName` verbatim para agentName. Estos fallbacks deben mantenerse.

---

## 🔗 Referencias de Memoria del Proyecto

- Bugfix: "Fixed toSlug underscore preservation — removed _ from CHAR_MAP"
- Bugfix: "Fixed divergence between JSON prompt path and filesystem directory in V2 export"
- Decision: "Fixed toSlug to preserve hyphens and underscores in prompt paths"
- Decision: "Implemented Windows prompt path separator fix in JSON export"

---

*Documento generado por Weight-Planner — Fecha: 2026-05-05*
*Versión: 1.0*
