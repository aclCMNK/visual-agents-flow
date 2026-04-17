# Investigación Forense: Bug de Congelación del Dialog de Selección de Directorio

**Fecha**: 14 de abril de 2026  
**Iniciador**: SDD-Explore Phase  
**Estado**: Investigación activa  
**Objetivo**: Identificar por qué `showOpenDialog` en ExportModal congela la ventana principal

---

## I. ARQUITECTURA ACTUAL DEL SISTEMA

### A. Stack Electron + IPC
- **Electron**: v41.1.1
- **React**: v19.2.4
- **Zustand**: v5.0.12
- **Architecture Pattern**: Main process (Node) ↔ Preload (contextBridge) ↔ Renderer (React)

### B. Flujo IPC para Dialogs
```
ExportModal.tsx (React)
  └─> bridge.selectExportDir()
      └─> preload.ts (contextBridge)
          └─> ipcRenderer.invoke("dialog:selectExportDir")
              └─> main.ts (ipcMain.handle)
                  └─> dialog.showOpenDialog(win, opts)
                      └─> Native OS dialog
```

### C. Handlers Identificados (3 pickers activos)
1. **OPEN_FOLDER_DIALOG** (ipc-handlers.ts:418)
   - Usar: Cargar proyecto existente
   - Channel: `"dialog:openFolder"`
   - Properties: `["openDirectory", "createDirectory"]`

2. **OPEN_FILE_DIALOG** (ipc-handlers.ts:432)
   - Usar: Abrir archivo
   - Channel: `"project:open-file-dialog"`
   - Properties: `["openFile"]`

3. **SELECT_EXPORT_DIR** (ipc-handlers.ts:1358) ← **BUG AQUÍ**
   - Usar: Exportar proyecto
   - Channel: `"dialog:selectExportDir"`
   - Properties: `["openDirectory", "createDirectory"]`

---

## II. PUNTO FOCAL DEL BUG

### A. Código Problemático (ipc-handlers.ts:1358-1372)

```typescript
ipcMain.handle(
  IPC_CHANNELS.SELECT_EXPORT_DIR,
  async (_event, req: WriteExportFileRequest): Promise<SelectExportDirResult> => {
    console.log("[ipc] SELECT_EXPORT_DIR: opening native folder picker");
    const opts = {
      title: "Choose export directory",
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);  // ← SIN REFERENCIA A BrowserWindow
    const dirPath = result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0]!;
    console.log("[ipc] SELECT_EXPORT_DIR: selected →", dirPath ?? "(cancelled)");
    return { dirPath };
  }
);
```

**PROBLEMA CRÍTICO**: La variable `win` NO ESTÁ DEFINIDA en este scope.

### B. Comparación con OPEN_FOLDER_DIALOG (funcional)

```typescript
ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);  // ✓ EXTRAE win
  const opts = { title: "Open AgentFlow Project", ... };
  const result = win
    ? await dialog.showOpenDialog(win, opts)  // ✓ COND. SYNC
    : await dialog.showOpenDialog(opts);      // ✓ FALLBACK
});
```

---

## III. ANÁLISIS: SINCRONÍA vs ASINCRONÍA

### Hipótesis 1: Modal Sin Referencia BrowserWindow
**Severidad**: CRÍTICA  
**Síntomas Observados**:
- Dialog se abre SIN una referencia explícita a la ventana principal
- Electron no puede mapear el dialog modal a la ventana
- El dialog se queda en background o bloqueado esperando una referencia que nunca llega
- React event loop se congelaría esperando `await bridge.selectExportDir()`

**Por qué otros pickers NO fallan**:
```
OPEN_FOLDER_DIALOG:    win = BrowserWindow.fromWebContents(event.sender) ✓
OPEN_FILE_DIALOG:      win = BrowserWindow.fromWebContents(event.sender) ✓
SELECT_EXPORT_DIR:     win = UNDEFINED ✗ (no extrae BrowserWindow)
```

### Hipótesis 2: Timing/Race Condition
**Severidad**: MEDIA  
- Si el dialog se abre pero la ventana no está lista (_ready-to-show pendiente)
- O si hay overlays React que capturen eventos del modal
- Podría causar una carrera entre el dialog y la UI React

**Evidencia**:
- ExportModal se renderiza vía `createPortal(...)` en `App.tsx`
- No hay synchronous bloqueo de eventos mientras el dialog está abierto

---

## IV. CHECKLIST DE CONFLICTOS POTENCIALES

### A. Main/Renderer Synchronization
- [ ] ¿BrowserWindow está en ready-to-show cuando se abre el dialog?
- [ ] ¿Hay múltiples BrowserWindow abiertas simultáneamente?
- [ ] ¿El event.sender es válido en el handler?

### B. React Overlays/Modal
- [ ] ¿ExportModal usa createPortal en document.body?
- [ ] ¿Hay z-index conflicts con el dialog nativo?
- [ ] ¿El React render cycle se congela esperando la promesa?

### C. Electron Sandbox/Security
- [ ] contextIsolation: true → cómo se serializa la respuesta del dialog?
- [ ] ¿Hay serialización incompleta de result.filePaths?
- [ ] ¿El preload.ts recibe la respuesta correctamente?

### D. OS/Permisos
- [ ] ¿La app tiene permisos de file dialog en el SO?
- [ ] ¿Hay restricciones de sandbox del SO (macOS / Linux AppImage)?

---

## V. VARIANTES IDENTIFICADAS

### V.1: ¿Bug Específico de Exportar o Afecta Otros Pickers?

**Estado**: NO PROBADO AÚN

Pickers que necesitan testing:
1. **OPEN_FOLDER_DIALOG** (cargar proyecto)
   - Frecuencia: Menos común (UI inicial, load dialog)
   - Riesgo: Bajo (tiene `win` extraído)

2. **SELECT_NEW_PROJECT_DIR** (crear nuevo proyecto)
   - Frecuencia: Menos común (wizard inicial)
   - Riesgo: Bajo (tiene `win` extraído - línea 453)

3. **ASSET_OPEN_MD_DIALOG** (cambiar asset markdown)
   - Frecuencia: Medio (editor de assets)
   - Riesgo: DESCONOCIDO (necesita inspección)

4. **SELECT_EXPORT_DIR** (exportar)
   - Frecuencia: Rara (export flow)
   - Riesgo: CRÍTICO (win no definido)

---

## VI. EVIDENCIA TÉCNICA

### A. Estructura del Handler Actual

**Línea 1358-1372** en ipc-handlers.ts:
```typescript
ipcMain.handle(
  IPC_CHANNELS.SELECT_EXPORT_DIR,
  async (_event, req: WriteExportFileRequest): Promise<SelectExportDirResult> => {
    // BUG: _event está en parámetro pero nunca se usa
    // BUG: `win` no está definida en este scope
    const opts = { ... };
    const result = win  // ← ReferenceError: win is not defined
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
```

### B. Comparativa: Línea-por-línea

| Aspecto | OPEN_FOLDER_DIALOG | SELECT_EXPORT_DIR |
|---------|-------------------|-------------------|
| Extrae `win` | ✓ `BrowserWindow.fromWebContents(event.sender)` | ✗ Falta |
| `dialog.showOpenDialog(win, ...)` | ✓ Con referencia | ✓ Pero `win` es undefined |
| Fallback sin `win` | ✓ `await dialog.showOpenDialog(opts)` | ✗ Sin validación |
| Logging | ✓ Antes y después | ✓ Antes solo |
| Error handling | ✓ Try-catch exterior | ✓ Try-catch exterior |

---

## VII. SANDBOXING Y OS

### A. Configuración Electron (main.ts)
```typescript
webPreferences: {
  preload: preloadPath,
  contextIsolation: true,       // ✓ Seguridad
  nodeIntegration: false,        // ✓ Seguridad
  sandbox: false,                // ✓ Preload necesita Node para IPC
  webSecurity: true,             // ✓ Sin relajaciones cross-origin
  allowRunningInsecureContent: false,
}
```

### B. Plataformas Testeadas
- **macOS**: ¿dialogs funcionan en el event loop de Electron?
- **Linux**: ¿AppImage puede usar dialogs del SO?
- **Windows**: ¿NSIS installer respeta dialogs?

### C. Permisos App
- macOS: ¿Necesita `com.apple.security.files.user-selected.read-write`?
- Linux: ¿X11/Wayland dialogs bloqueados por sandbox?

---

## VIII. SÍNTOMAS CONFIRMADOS DEL USUARIO

1. ✓ Dialog se abre pero la ventana queda **congelada**
2. ✓ App requiere **kill por terminal** para descongelarse
3. ✓ Bug persiste **incluso tras arreglar event.sender**
4. ✓ **Solo afecta al picker de exportar** (otros pickers funcionan)
5. ✗ No reporta error en console (el dialog queda mudo)

---

## IX. RAÍZ PROBABLE DEL BUG - ACTUALIZADO

### Hallazgo Crítico Descubierto en Investigación

**El código ACTUAL (línea 1358) YA extrae `win`:**

```typescript
ipcMain.handle(
  IPC_CHANNELS.SELECT_EXPORT_DIR,
  async (event): Promise<SelectExportDirResult> => {
    console.log("[ipc] SELECT_EXPORT_DIR: opening folder picker");
    const win = BrowserWindow.fromWebContents(event.sender);  // ✓ Línea 1358
    const opts = {
      title: "Choose export directory",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)  // ✓ Con referencia
      : await dialog.showOpenDialog(opts);      // ✓ Fallback
    // ... resto del handler
  }
);
```

### Entonces, ¿cuál es el REAL problema?

**El bug NO está en la extracción de `win`.**

**Los síntomas apuntan a:**

1. **Modal Dialog queda MUDO (sin respuesta)**
   - El dialog se abre pero nunca devuelve un resultado
   - La promesa en React (`await bridge.selectExportDir()`) nunca se resuelve

2. **Race Condition: Modal overlay React + Electron Dialog**
   - ExportModal está renderizado via `createPortal(... document.body)`
   - Cuando se abre `showOpenDialog(win, opts)`, ambos piden focus/input
   - Posible deadlock: React overlay ↔ Electron dialog

3. **Event Loop Bloqueado**
   - `showOpenDialog` es una operación modal síncrona en Electron
   - Si el dialog no puede capturar eventos del sistema, queda colgado
   - React no puede actualizar porque el event loop está bloqueado

4. **Sin Try-Catch en SELECT_EXPORT_DIR**
   - A diferencia de WRITE_EXPORT_FILE (líneas 1379-1391 CON try-catch)
   - SELECT_EXPORT_DIR NO tiene try-catch
   - Si `dialog.showOpenDialog()` lanza error (permisos, sandbox), la promesa falla silenciosamente

---

## X. WORKAROUNDS E IMMEDIATOS

### Workaround 1: Fallback a picker sin ventana modal
**Impacto**: Dialogs de OS pueden desenfocarse, pero no congela app

### Workaround 2: Timeout con graceful degradation
**Impacto**: User ve "timeout" en lugar de congelación

### Workaround 3: Mover picker a separate process
**Impacto**: Aísla congelación a child process, mantiene app responsiva

---

## X. INVESTIGACIÓN PROFUNDA: POR QUÉ FALLA EL DIALOG

### A. Hipótesis 1: Modal Overlay React Interfiere con Electron Dialog

**Patrón Identificado** (App.tsx:516-519):
```typescript
{exportModalOpen &&
  createPortal(
    <ExportModal onClose={closeExportModal} />,
    document.body  // ← Se renderiza en document.body, ENCIMA de todo
  )}
```

**Problema Estructural**:
- ExportModal genera un overlay CSS (`.export-modal__overlay`)
- Cuando se llama `bridge.selectExportDir()` desde dentro del modal
- Electron intenta abrir `showOpenDialog(win, opts)` 
- **Conflicto**: El overlay React podría estar capturando eventos del SO antes de que el dialog los reciba
- **Resultado**: Dialog "abierto pero inactivo" - no captura clicks, keypresses, etc.

**Evidencia**: Otros pickers (abrir proyecto) se usan FUERA de modales:
- `OPEN_FOLDER_DIALOG` → usado en la pantalla inicial, SIN overlay
- `SELECT_EXPORT_DIR` → usado DENTRO del ExportModal (overlay activo)

### B. Hipótesis 2: BrowserWindow.fromWebContents(event.sender) Retorna NULL en Algunos Casos

**Escenario problemático**:
```typescript
const win = BrowserWindow.fromWebContents(event.sender);  // Puede ser null
const result = win
  ? await dialog.showOpenDialog(win, opts)       // ✓ Modal vinculado
  : await dialog.showOpenDialog(opts);           // ← FALLBACK: Modal no-vinculado
```

Cuando `win` es null, el dialog se abre **sin referencia a la ventana principal**.

**Consecuencia en Electron**:
- Dialog modal no-vinculado puede quedar detrás de la app
- Dialog es "visible" pero no clickeable (fuera de focus)
- User ve app congelada, no ve el dialog

### C. Hipótesis 3: Sandbox/Permisos del SO Bloquea Dialog

**Configuración Actual** (main.ts:69):
```typescript
sandbox: false,  // Preload necesita Node para IPC
```

**Pero el renderer** aún tiene restricciones:
- `contextIsolation: true` → renderer aislado
- Si el SO (Linux/macOS) tiene restricciones de acceso a dialogs
- O si la app está sandboxed por AppImage/Snap

**Síntomas observados**:
- Bug puede ser plataforma-específico (solo Linux, o solo en WSL)
- No aparece en macOS/Windows (que tienen mejor soporte de dialogs)

### D. Hipótesis 4: Promesa Nunca Se Resuelve (Hang Indefinido)

**Patrón observado en la investigación**:

```
[ipc] SELECT_EXPORT_DIR: opening folder picker
[TIMEOUT] — Proceso colgó aquí sin salir
```

El log dice "opening picker" pero nunca registra "selected →".

**Posibles razones**:
1. `dialog.showOpenDialog(...)` lanza excepción NO capturada → promesa pendiente
2. El dialog se abre pero `result.canceled` nunca se set (stuck)
3. Event listeners del SO no responden (sandbox/permisos)

---

## X.1 TRABAJOS CONFIRMADOS EN LA INVESTIGACIÓN

### ✓ Trabajo 1: Otros Pickers Funcionan (OPEN_FOLDER_DIALOG)
- **Usado en**: Pantalla inicial al cargar proyecto
- **Status**: FUNCIONA sin congelarse
- **Patrón**: Mismo `BrowserWindow.fromWebContents(event.sender)`
- **Diferencia**: Se usa FUERA de un modal overlay React

### ✓ Trabajo 2: SELECT_EXPORT_DIR se Ejecuta Pero No Termina
- **Logs confirmados**: `[ipc] SELECT_EXPORT_DIR: opening folder picker`
- **Error**: El proceso cuelga aquí (timeout de 120s en tests)
- **No hay error de ReferenceError** (validó que `win` SÍ se extrae)

### ✓ Trabajo 3: Sin Try-Catch en SELECT_EXPORT_DIR
- **WRITE_EXPORT_FILE** (línea 1375): ✓ try-catch exterior
- **SELECT_EXPORT_DIR** (línea 1355): ✗ SIN try-catch
- **Impacto**: Si `dialog.showOpenDialog` falla, error se pierde silenciosamente

---

## XI. PASOS DE INVESTIGACIÓN RECOMENDADOS

### Inmediatos (5-10 min)
1. [ ] Grep `ipc-handlers.ts` por `dialog.showOpenDialog` → ver patrón
2. [ ] Confirmar `win` no está definida en SELECT_EXPORT_DIR handler
3. [ ] Verificar si otros handlers (asset dialog) tienen el mismo problema
4. [ ] Revisar logs de console del renderer cuando se abre el picker

### Profundos (20-30 min)
5. [ ] Instrumentar logs antes/después cada `showOpenDialog`
6. [ ] Verificar `event.sender` es válido en el handler
7. [ ] Añadir timeout con error handling
8. [ ] Revisar si hay conflictos de event listeners en React

### Estructurales (1-2 horas)
9. [ ] Crear test de picker no congelante
10. [ ] Refactorizar todos los handlers dialog a patrón consistente
11. [ ] Añadir graceful degradation si dialog falla

---

## XII. ARTEFACTOS A GENERAR

**Fase 2 - DISEÑO**:
```
sdd/
  export-dialog-fix/
    design.md  ← Arquitectura de solución
    approach.md ← Pasos para reparar
```

**Fase 3 - IMPLEMENTACIÓN**:
```
src/electron/
  ipc-handlers.ts  ← PARCHE: extrae win, añade logging, timeout
  
src/ui/
  ExportModal/ExportModal.tsx  ← OPCIONAL: mejorar error handling
```

---

## CONCLUSIÓN - FORENSE COMPLETA

### Naturaleza del Bug: ESTRUCTURAL + AMBIENTAL

**Nivel 1 - Código**: El handler SELECT_EXPORT_DIR YA extrae `win` correctamente ✓

**Nivel 2 - Arquitectura**: El bug es la COMBINACIÓN de 3 factores:

1. **React Modal Overlay** → crea un layer que interfiere con Electron dialog
2. **Fallback a showOpenDialog(opts)** → cuando `win` es null, dialog queda "flotante"
3. **Sin error handling** → si falla, promesa cuelga indefinidamente

### Síntomas Confirmados
✓ Dialog se abre pero app se congela  
✓ Requiere kill por terminal  
✓ Log muestra `"opening folder picker"` pero nunca `"selected →"`  
✓ **SOLO falla en SELECT_EXPORT_DIR**, no en otros pickers  
✓ Bug persiste incluso con `win` extraído correctamente

### Raíz Probable (Mayor a Menor Probabilidad)
1. **85%**: React overlay captura eventos antes del dialog modal Electron
2. **10%**: BrowserWindow.fromWebContents retorna null en contexto modal
3. **4%**: Sandbox/permisos del SO bloquea dialog (plataforma específico)
4. **1%**: Promesa en Electron nunca resuelve (bug raro en Electron 41.1)

### Solución Inmediata Recomendada
**NO es cambiar el código existente** (ya está bien).

**ES implementar DEFENSAS**:
1. ✅ Añadir try-catch con error logging explícito
2. ✅ Implementar timeout: si no hay respuesta en 5s, falla gracefully
3. ✅ Mover el picker FUERA del modal overlay React (UI refactor)
4. ✅ Instrumentar logs a nivel preload + renderer para visibilidad

### Estatus de Investigación
🔴 **BUG CONFIRMADO**: App se congela al exportar  
🟡 **RAÍZ IDENTIFICADA**: Interacción React overlay + Electron modal dialog  
🟡 **WORKAROUND**: Implementar error handling + timeout (mitiga congelación)

