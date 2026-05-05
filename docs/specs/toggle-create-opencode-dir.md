# 🧠 Spec: Toggle "Create .opencode dir" en ExportModal

**Fecha:** 2026-05-05  
**Estado:** Listo para implementación  
**Archivo de referencia:** `src/ui/components/ExportModal/ExportModal.tsx`

---

## 🎯 Objetivo

Agregar un toggle **"Create .opencode dir"** en la sección **General** del `ExportModal`.  
El toggle controla si el archivo `opencode.json` se exporta dentro de un subdirectorio `.opencode/` o directamente en el directorio de exportación seleccionado.

---

## 🧩 Contexto

- El ExportModal ya tiene toggles ON/OFF funcionales: **Auto update**, **Hide default planner**, **Hide default builder**.
- El campo **File Extension** permite elegir entre `.json` y `.jsonc`.
- El nuevo toggle **solo aplica cuando la extensión es `.json`** (OpenCode usa `.opencode/opencode.json` como convención).
- Cuando la extensión es `.jsonc`, el toggle no tiene sentido semántico y debe ocultarse.

---

## 🧭 Comportamiento Esperado

### Visibilidad
- **Visible:** solo cuando `config.fileExtension === "json"`
- **Oculto:** cuando `config.fileExtension === "jsonc"`
- Al cambiar de `.json` → `.jsonc`: el toggle desaparece, el valor interno se **preserva** (no se resetea)
- Al volver a `.json`: el toggle reaparece con el valor que tenía antes

### Posición en el formulario General
```
[ Schema URL          ] [input]
[ Auto update         ] [toggle ON/OFF]
[ Default agent       ] [select]
[ File extension      ] [.json | .jsonc]  Output: opencode.json
[ Create .opencode dir] [toggle ON/OFF]   ← NUEVO (solo si .json)
[ Hide default planner] [toggle ON/OFF]
[ Hide default builder] [toggle ON/OFF]
```

### Estado del toggle
| Estado | Comportamiento de exportación |
|--------|-------------------------------|
| **ON** (default) | El archivo se escribe en `{exportDir}/.opencode/opencode.json` |
| **OFF** | El archivo se escribe en `{exportDir}/opencode.json` |

---

## 🔧 Cambios Requeridos

### 1. `export-logic.ts` — Extender `OpenCodeExportConfig`

**Archivo:** `src/ui/components/ExportModal/export-logic.ts`

#### A. Agregar campo a la interfaz `OpenCodeExportConfig`

```ts
export interface OpenCodeExportConfig {
  schemaUrl: string;
  autoUpdate: boolean;
  defaultAgentId: string;
  fileExtension: "json" | "jsonc";
  plugins: PluginEntry[];
  hideDefaultPlanner: boolean;
  hideDefaultBuilder: boolean;
  /** NEW: When true and fileExtension === "json", export into a .opencode/ subdirectory */
  createOpencodeDir: boolean;
}
```

#### B. Agregar valor default en `makeDefaultOpenCodeConfig()`

```ts
export function makeDefaultOpenCodeConfig(): OpenCodeExportConfig {
  return {
    schemaUrl: OPENCODE_SCHEMA_URL_DEFAULT,
    autoUpdate: true,
    defaultAgentId: "",
    fileExtension: "json",
    plugins: [],
    hideDefaultPlanner: false,
    hideDefaultBuilder: false,
    createOpencodeDir: true,  // ← NEW: default ON
  };
}
```

> **Razón del default `true`:** La convención de OpenCode es usar `.opencode/opencode.json`. Activarlo por defecto es lo más seguro y correcto para el 99% de los casos.

---

### 2. `ExportModal.tsx` — Inicialización desde `project.properties`

**Archivo:** `src/ui/components/ExportModal/ExportModal.tsx`

#### A. Leer `createOpencodeDir` desde `project.properties` al inicializar `config`

En el `useState<OpenCodeExportConfig>(() => { ... })` (línea ~240), agregar:

```ts
createOpencodeDir: typeof props.createOpencodeDir === "boolean"
  ? props.createOpencodeDir
  : defaults.createOpencodeDir,
```

**Resultado final del bloque de inicialización:**
```ts
return {
  ...defaults,
  defaultAgentId:      typeof props.defaultAgent      === "string"  ? props.defaultAgent      : defaults.defaultAgentId,
  fileExtension:       (props.fileExtension === "json" || props.fileExtension === "jsonc") ? props.fileExtension : defaults.fileExtension,
  autoUpdate:          typeof props.autoupdate         === "boolean" ? props.autoupdate         : defaults.autoUpdate,
  hideDefaultPlanner:  typeof props.hideDefaultPlanner === "boolean" ? props.hideDefaultPlanner : defaults.hideDefaultPlanner,
  hideDefaultBuilder:  typeof props.hideDefaultBuilder === "boolean" ? props.hideDefaultBuilder : defaults.hideDefaultBuilder,
  createOpencodeDir:   typeof props.createOpencodeDir  === "boolean" ? props.createOpencodeDir  : defaults.createOpencodeDir,  // ← NEW
};
```

---

### 3. `ExportModal.tsx` — Persistencia en `saveGeneralProperties`

En la función `saveGeneralProperties` (línea ~573), agregar la nueva propiedad al objeto `updatedProperties`:

```ts
const saveGeneralProperties = useCallback((next: OpenCodeExportConfig) => {
  if (!project) return;
  const updatedProperties: Record<string, unknown> = {
    ...(project.properties ?? {}),
    defaultAgent:        next.defaultAgentId,
    fileExtension:       next.fileExtension,
    autoupdate:          next.autoUpdate,
    hideDefaultPlanner:  next.hideDefaultPlanner,
    hideDefaultBuilder:  next.hideDefaultBuilder,
    createOpencodeDir:   next.createOpencodeDir,  // ← NEW
  };
  saveProject({ properties: updatedProperties }).catch((err: unknown) => {
    console.warn("[ExportModal] No se pudo guardar la configuración general en project.properties:", err);
  });
}, [project, saveProject]);
```

---

### 4. `ExportModal.tsx` — Render del toggle en la sección General

**Posición:** Inmediatamente después del bloque `File extension` (línea ~1083–1114), antes de `Hide default planner`.

```tsx
{/* ── [NEW] Create .opencode dir toggle (solo visible cuando ext === "json") ── */}
{config.fileExtension === "json" && (
  <div className="export-modal__field-row">
    <label className="export-modal__label">
      Create .opencode dir
    </label>
    <div className="export-modal__switch-row">
      <button
        role="switch"
        aria-checked={config.createOpencodeDir}
        className={`export-modal__switch${config.createOpencodeDir ? " export-modal__switch--on" : ""}`}
        onClick={() => setConfig((c) => {
          const next = { ...c, createOpencodeDir: !c.createOpencodeDir };
          saveGeneralProperties(next);
          return next;
        })}
        title="Toggle create .opencode subdirectory on export"
      >
        {config.createOpencodeDir ? "ON" : "OFF"}
      </button>
    </div>
  </div>
)}
```

> **Clases CSS usadas:** `export-modal__field-row`, `export-modal__label`, `export-modal__switch-row`, `export-modal__switch`, `export-modal__switch--on`  
> Son exactamente las mismas que usa el toggle **Auto update** — sin CSS nuevo requerido.

---

### 5. `ExportModal.tsx` — Efecto en el proceso de exportación (`handleExport`)

En `handleExport`, calcular el `destDir` efectivo antes de llamar a `bridge.writeExportFile`:

```ts
// ── [NEW] Compute effective destination directory ──────────────────────────
// When createOpencodeDir is ON and extension is "json", write into .opencode/
const effectiveDestDir =
  config.createOpencodeDir && config.fileExtension === "json"
    ? `${exportDir}/.opencode`
    : exportDir;

const writeResult = await bridge.writeExportFile({
  destDir: effectiveDestDir,   // ← usar effectiveDestDir en lugar de exportDir
  fileName: outputFileName,
  content,
});
```

> **Importante:** `bridge.writeExportFile` ya crea el directorio si no existe (comportamiento actual). No se requiere cambio en el bridge ni en el main process.

> **Skills y profiles:** Los exports de skills y profiles siguen usando `exportDir` (el directorio raíz elegido por el usuario), **no** `effectiveDestDir`. El `.opencode/` solo afecta al archivo de configuración principal.

---

## 📋 Resumen de Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/ui/components/ExportModal/export-logic.ts` | Agregar `createOpencodeDir: boolean` a `OpenCodeExportConfig` + default `true` en `makeDefaultOpenCodeConfig()` |
| `src/ui/components/ExportModal/ExportModal.tsx` | 4 puntos: init desde props, persistencia en `saveGeneralProperties`, render del toggle, `effectiveDestDir` en `handleExport` |

**Sin cambios requeridos en:**
- CSS (reutiliza clases existentes)
- Bridge / IPC / main process
- Otros tabs del modal
- Skills export / profiles export

---

## ⚠️ Riesgos y Consideraciones

1. **`bridge.writeExportFile` debe crear el dir si no existe:** Verificar que el handler en el main process crea recursivamente el directorio destino (incluyendo `.opencode/`). Si no lo hace, agregar `fs.mkdirSync(destDir, { recursive: true })` antes de escribir.

2. **Visibilidad del toggle al cambiar extensión:** El valor `createOpencodeDir` NO se resetea al cambiar a `.jsonc`. Esto es intencional — si el usuario vuelve a `.json`, recupera su preferencia anterior.

3. **Mensaje de resultado post-export:** El `exportResult.message` ya muestra `writeResult.filePath` (el path real del archivo escrito). Si `effectiveDestDir` incluye `.opencode/`, el path mostrado al usuario será correcto automáticamente.

4. **Compatibilidad con `project.properties` existentes:** Proyectos sin `createOpencodeDir` en sus properties caerán al default `true` — comportamiento correcto y seguro.

---

## 📝 Notas Adicionales

- El toggle **no afecta** la validación de `isOpenCodeConfigValid()` — no es necesario modificar esa función.
- El toggle **no afecta** el `outputFileName` (sigue siendo `opencode.json`).
- El hint `Output: <code>{outputFileName}</code>` debajo del selector de extensión podría actualizarse para mostrar el path completo: `Output: <code>{config.createOpencodeDir && config.fileExtension === "json" ? ".opencode/" : ""}{outputFileName}</code>` — esto es **opcional** y queda a criterio del developer.
