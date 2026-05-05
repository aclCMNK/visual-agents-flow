# Spec: Fix — Doble Fuente de Verdad para `projectName` en Export

**Estado:** 🔴 BUG ACTIVO — NO CERRAR sin evidencia visual  
**Fecha diagnóstico:** 2026-05-05  
**Reportado por:** Evidencia visual (screenshot)  
**Síntoma:** Directorio físico = `prompts/puro_traqueteo/` pero JSON = `prompts/puro-traqueteo/el-patron.md`

---

## 🔍 Root Cause Real

El bug es **arquitectural**: existen **DOS fuentes de verdad** para el nombre del proyecto en el flujo de export:

### Fuente 1 — Directorio físico (profile-export-handlers.ts)

```typescript
// src/electron/profile-export-handlers.ts, línea 397-400
function extractProjectName(projectDir: string): string {
  const parts = projectDir.split(/[\\/]/);
  return parts[parts.length - 1] || 'project';
}
// → Devuelve el basename del directorio: "puro_traqueteo" (con underscore)
```

Luego aplica `toSlug("puro_traqueteo")` → `"puro_traqueteo"` → directorio físico: `prompts/puro_traqueteo/`

### Fuente 2 — JSON prompt field (export-logic.ts vía UI)

```typescript
// src/ui/components/ExportModal/export-logic.ts
// buildOpenCodeV2Config recibe projectName desde el UI
// El UI toma el campo `name` del .afproj: "puro-traqueteo" (con guión)
const projSlug = toSlug(projectName) // toSlug("puro-traqueteo") → "puro-traqueteo"
const prompt = `{file:./prompts/${projSlug}/${agentSlug}.md}`
// → JSON genera: prompts/puro-traqueteo/el-patron.md ❌
```

### Por qué divergen

El proyecto fue creado con nombre `"puro-traqueteo"` (guión) en el `.afproj`, pero el directorio físico en disco es `puro_traqueteo/` (underscore) — posiblemente creado en una versión anterior del código, o el nombre original tenía underscore y el `.afproj` fue editado manualmente.

**La función `toSlug()` es correcta en ambos lados.** El problema es que recibe **inputs distintos**:
- Lado filesystem: `toSlug("puro_traqueteo")` → `"puro_traqueteo"` ✅
- Lado JSON: `toSlug("puro-traqueteo")` → `"puro-traqueteo"` ❌ (diferente al directorio)

---

## 🎯 Fix Requerido

### Opción elegida: El directorio físico es la fuente canónica

El directorio físico ya existe en disco. El JSON debe coincidir con él, no con el nombre del `.afproj`.

### Fix A — En el UI (ExportModal)

El UI debe pasar como `projectName` el **basename del directorio del proyecto** (ya slugificado), NO el campo `name` del `.afproj`.

**Buscar en el código del ExportModal** dónde se llama a `buildOpenCodeV2Config` y cambiar:

```typescript
// ANTES (buggy):
const projectName = project.name; // "puro-traqueteo" del .afproj

// DESPUÉS (correcto):
import { basename } from 'node:path'; // o equivalente en el renderer
const projectName = basename(project.projectDir); // "puro_traqueteo" del directorio real
```

### Fix B — Alternativa: leer el .afproj desde el export handler

Si el UI no tiene acceso al `projectDir`, el export handler puede leer el `.afproj` para obtener el nombre canónico y luego aplicar `toSlug()` sobre él. Pero esto solo funciona si el nombre del `.afproj` coincide con el directorio.

**Recomendación: Fix A es más simple y directo.**

---

## ✅ Test Manual Obligatorio (Pre y Post Fix)

> **REGLA DURA: El bug NO se cierra sin evidencia visual de estos tests.**  
> No se aceptan validaciones automáticas, unit tests ni afirmaciones verbales.

### Test 1 — Proyecto con underscore: `puro_traqueteo`

**Pasos:**
1. Crear proyecto con nombre exacto: `"puro_traqueteo"` (con underscore)
2. Agregar agente con nombre: `"el-patron"` (con guión)
3. Asignar perfil al agente (archivo `.md`)
4. Ejecutar **Profile Export** (exportar perfiles)
5. Ejecutar **Config Export V2** (exportar opencode.json)

**Evidencia requerida:**
- [ ] Screenshot del explorador de archivos mostrando: `prompts/puro_traqueteo/el-patron.md`
- [ ] Screenshot del `opencode.json` generado mostrando: `"prompt": "{file:./prompts/puro_traqueteo/el-patron.md}"`
- [ ] Ambos slugs son **idénticos**: `puro_traqueteo` (con underscore)

### Test 2 — Proyecto con guión: `puro-traqueteo`

**Pasos:**
1. Crear proyecto con nombre exacto: `"puro-traqueteo"` (con guión)
2. Agregar agente: `"el-patron"`
3. Exportar perfil y config V2

**Evidencia requerida:**
- [ ] Screenshot: directorio = `prompts/puro-traqueteo/el-patron.md`
- [ ] Screenshot: JSON = `"prompt": "{file:./prompts/puro-traqueteo/el-patron.md}"`
- [ ] Ambos slugs son **idénticos**: `puro-traqueteo` (con guión)

### Test 3 — Nombre mixto: `"Mi Proyecto_2026"`

**Pasos:**
1. Crear proyecto: `"Mi Proyecto_2026"` (espacio + underscore)
2. `toSlug("Mi Proyecto_2026")` debe producir: `"mi-proyecto_2026"` (espacio→guión, underscore preservado)
3. Exportar

**Evidencia requerida:**
- [ ] Screenshot: directorio = `prompts/mi-proyecto_2026/`
- [ ] Screenshot: JSON = `"prompt": "{file:./prompts/mi-proyecto_2026/agente.md}"`
- [ ] Ambos slugs son **idénticos**: `mi-proyecto_2026`

---

## 🚫 Criterio de Cierre (NON-NEGOTIABLE)

El bug se cierra **ÚNICAMENTE** cuando:

1. ✅ Se presentan screenshots de los 3 tests anteriores
2. ✅ En cada test, el slug del directorio físico y el slug en el JSON son **byte-a-byte idénticos**
3. ✅ El proyecto `puro_traqueteo` específicamente muestra `puro_traqueteo` (underscore) en AMBOS artefactos
4. ✅ No hay ningún caso donde guión y underscore se intercambien entre directorio y JSON

---

## 📁 Archivos Afectados

| Archivo | Cambio requerido |
|---|---|
| `src/ui/components/ExportModal/export-logic.ts` | Verificar qué `projectName` se pasa a `buildOpenCodeV2Config` |
| `src/electron/profile-export-handlers.ts` | `extractProjectName` usa basename del directorio (correcto) |
| Caller del ExportModal | Cambiar `project.name` por `basename(project.projectDir)` como `projectName` |

---

## 🔬 Traza de toSlug() para referencia

```
toSlug("puro_traqueteo") → "puro_traqueteo"  (underscore preservado ✅)
toSlug("puro-traqueteo") → "puro-traqueteo"  (guión preservado ✅)
toSlug("Mi Proyecto_2026") → "mi-proyecto_2026"  (espacio→guión, underscore preservado ✅)
toSlug("el-patron") → "el-patron"  (guión preservado ✅)
```

La función `toSlug()` es correcta. El bug está en **qué string se le pasa**, no en cómo lo transforma.
