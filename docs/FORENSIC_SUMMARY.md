# Resumen Ejecutivo: Bug Dialog Export

## El Problema
Cuando el usuario hace click en "Pick..." para seleccionar el directorio de exportación en el modal ExportModal, la ventana de la app se **congela completamente** y no responde. El usuario debe hacer `kill` en terminal para cerrar la app.

## Raíz del Bug
**NO es un error de código obviamente roto.** El bug es una **interacción defectuosa entre dos componentes**:

1. **React Modal Overlay** (ExportModal renderizado en document.body via createPortal)
2. **Electron Dialog Modal** (showOpenDialog con BrowserWindow.fromWebContents)

Cuando se abre el dialog Electron DESDE DENTRO de un overlay React, el event loop se bloquea en ambos niveles y el dialog nunca recibe eventos del usuario.

## Confirmaciones Técnicas
- ✅ El código ya extrae `BrowserWindow.fromWebContents(event.sender)` correctamente (línea 1358)
- ✅ Otros pickers (OPEN_FOLDER_DIALOG) funcionan bien PORQUE se usan fuera de modales
- ✅ SELECT_EXPORT_DIR falla SOLO porque se usa desde dentro de ExportModal  
- ✅ El log `[ipc] SELECT_EXPORT_DIR: opening folder picker` aparece, pero el proceso cuelga después
- ✅ Sin try-catch en el handler → si falla, error se pierde silenciosamente

## Soluciones Recomendadas

### Inmediata (Mitiga la congelación)
```typescript
// Añadir try-catch + timeout para evitar hang indefinido
ipcMain.handle(IPC_CHANNELS.SELECT_EXPORT_DIR, async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: "Choose export directory",
      properties: ["openDirectory", "createDirectory"],
    };
    
    // Implementar timeout: si el dialog no responde en 5s, rechazar
    const result = await Promise.race([
      win 
        ? dialog.showOpenDialog(win, opts) 
        : dialog.showOpenDialog(opts),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Dialog timeout")), 5000)
      )
    ]);
    
    return { dirPath: result.filePaths[0] ?? null };
  } catch (err) {
    console.error("[ipc] SELECT_EXPORT_DIR: error —", err);
    return { dirPath: null, error: String(err) };
  }
});
```

### Estructural (Solución a largo plazo)
1. Refactorizar ExportModal para abrir el picker **sin estar dentro del overlay React**
2. O cambiar a un file picker nativo del SO que NO bloquea el event loop
3. Instrumentar logs en preload + renderer para mejor observabilidad

## Impacto del Usuario
- **Actual**: App completamente congelada, requiere kill
- **Con workaround**: User ve "Dialog timeout" pero app sigue responsiva
- **Con solución estructural**: Picker funciona normalmente sin congelación

## Siguientes Pasos
1. ✅ Esta investigación (exploración completa)
2. ⏭️ Implementar workaround (5 minutos - mitiga el problema inmediato)
3. ⏭️ Diseñar refactor de ExportModal (30 minutos - solución estructural)
4. ⏭️ Implementar refactor (1-2 horas - elimina el bug radicalmente)

