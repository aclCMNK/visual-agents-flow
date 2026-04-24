# QA Checklist: Clone de Repos Privados de GitHub con Credenciales

## Objetivo
Verificar que el flujo completo de clonado de repositorios privados de GitHub funciona correctamente, de manera segura y con buena experiencia de usuario.

## Checklist de 21 Ítems

### 1. Happy path: repo público sin credenciales
**Objetivo:** Verificar que repos públicos se clonan sin problemas.
- **Prueba automatizada:** Mock de git clone exitoso, verificar que `success: true` y `clonedPath` correcto.
- **Instrucciones manuales:**
  1. Abrir modal "Clone from Git"
  2. Ingresar URL de repo público GitHub (ej: `https://github.com/facebook/react`)
  3. Elegir directorio destino
  4. Click "Clone"
  5. Verificar: 
     - Barra de progreso muestra stages (Receiving objects, Resolving deltas)
     - Finaliza con mensaje "Cloned successfully"
     - Directorio destino contiene archivos del repo

### 2. Happy path privado GitHub: credenciales válidas
**Objetivo:** Verificar clonado exitoso con token válido.
- **Prueba automatizada:** Mock de git clone con URL autenticada, verificar sanitización de logs.
- **Instrucciones manuales:**
  1. Abrir modal "Clone from Git"
  2. Ingresar URL de repo privado GitHub (requiere acceso)
  3. Ingresar username y token válido en CredentialsBlock
  4. Click "Clone"
  5. Verificar:
     - Progreso se muestra correctamente
     - No hay logs con credenciales en texto plano
     - Finaliza con éxito
     - Credenciales se limpian de memoria UI post-operación

### 3. Credenciales inválidas: token inválido
**Objetivo:** Validación previa detecta token inválido.
- **Prueba automatizada:** Mock de GitHub API devuelve 401, verificar errorCode `AUTH_ERROR`.
- **Instrucciones manuales:**
  1. Ingresar URL repo privado
  2. Ingresar token inválido (ej: "invalid-token")
  3. Click "Validate token" o intentar clonar
  4. Verificar:
     - UI muestra "Token inválido" o "Autenticación fallida"
     - No se intenta clonar si validación falla
     - Botón "Clone" deshabilitado hasta credenciales válidas

### 4. Token sin permisos (scope `repo`)
**Objetivo:** Detectar token sin permisos necesarios.
- **Prueba automatizada:** Mock de GitHub API devuelve 403, verificar mapeo a mensaje específico.
- **Instrucciones manuales:**
  1. Crear token GitHub sin scope `repo`
  2. Ingresar en CredentialsBlock
  3. Click "Validate token"
  4. Verificar:
     - UI muestra "Token sin permisos necesarios"
     - Sugerencia: "El token necesita permiso 'repo' para acceder a repositorios privados"

### 5. Repo no encontrado (404)
**Objetivo:** Manejo de repo inexistente.
- **Prueba automatizada:** Mock de git clone con exit code 128 y stderr "Repository not found".
- **Instrucciones manuales:**
  1. Ingresar URL de repo que no existe: `https://github.com/user/nonexistent-repo`
  2. Click "Clone"
  3. Verificar:
     - ErrorCode `UNKNOWN` o `NETWORK_ERROR` según mapping
     - UI muestra "Repositorio no encontrado"
     - Sugerencia: "Verifique la URL y que tenga acceso al repositorio"

### 6. Red caída durante clone
**Objetivo:** Recuperación elegante de fallos de red.
- **Prueba automatizada:** Simular error de red durante git clone, verificar `NETWORK_ERROR`.
- **Instrucciones manuales:**
  1. Iniciar clonado de repo grande
  2. Desconectar red a mitad de proceso
  3. Verificar:
     - UI muestra "Error de red al intentar clonar"
     - Sugerencia: "Verifique conexión y proxy. Intente nuevamente."
     - Botón "Retry" disponible

### 7. Cancelación por usuario
**Objetivo:** Cancelación limpia de proceso en curso.
- **Prueba automatizada:** Mock de child process, enviar SIGTERM, verificar cleanup.
- **Instrucciones manuales:**
  1. Iniciar clonado de repo grande
  2. Click "Cancel" durante el proceso
  3. Verificar:
     - Proceso se detiene (no más updates de progreso)
     - UI muestra "Clone cancelled"
     - Child process recibe SIGTERM
     - No persisten archivos temporales con credenciales

### 8. Cancelación forzada (SIGKILL)
**Objetivo:** Timeout y terminación forzada si proceso no responde.
- **Prueba automatizada:** Mock de child que ignora SIGTERM, verificar SIGKILL después de 5s.
- **Instrucciones manuales:**
  1. (Requiere simulación) Proceso que ignore SIGTERM
  2. Iniciar clonado y cancelar
  3. Esperar 5+ segundos
  4. Verificar:
     - Si proceso no termina en 5s, recibe SIGKILL
     - UI muestra "Clone cancelled (forced)"

### 9. Destino existente no vacío
**Objetivo:** Prevenir sobreescritura accidental.
- **Prueba automatizada:** Verificar `DEST_EXISTS` cuando directorio no vacío.
- **Instrucciones manuales:**
  1. Elegir directorio destino que ya contiene archivos
  2. Intentar clonar repo
  3. Verificar:
     - ErrorCode `DEST_EXISTS`
     - UI muestra "Directorio destino ya existe y no está vacío"
     - Sugerencia: "Elija otro directorio o mueva/borre el existente"

### 10. Git no instalado
**Objetivo:** Mensaje claro cuando git no está disponible.
- **Prueba automatizada:** Simular `ENOENT` en spawn, verificar `GIT_NOT_FOUND`.
- **Instrucciones manuales:**
  1. Renombrar binario git temporalmente o modificar PATH
  2. Intentar clonar cualquier repo
  3. Verificar:
     - ErrorCode `GIT_NOT_FOUND`
     - UI muestra "Git no está instalado (o no encontrado en PATH)"
     - Sugerencia: "Instale Git y reinicie la aplicación"

### 11. URL malformada
**Objetivo:** Validación temprana de URL inválida.
- **Prueba automatizada:** Test unitario para regex de validación de URL.
- **Instrucciones manuales:**
  1. Ingresar URL inválida: `not-a-url`, `git@github`, `https://`
  2. Verificar:
     - Botón "Clone" deshabilitado
     - Mensaje de error debajo del input: "URL inválida"
     - No se envía request al main process

### 12. Race condition en detección de visibilidad
**Objetivo:** Credenciales se limpian correctamente al cambiar URL.
- **Prueba automatizada:** Test de limpieza de estado cuando URL cambia rápidamente.
- **Instrucciones manuales:**
  1. Ingresar URL repo privado, llenar credenciales
  2. Cambiar rápidamente a URL repo público
  3. Verificar:
     - CredentialsBlock se oculta/limpia
     - Estado `auth` se resetea a `undefined`
     - No hay fugas de credenciales en memoria

### 13. Sanitización de logs
**Objetivo:** Credenciales nunca aparecen en logs.
- **Prueba automatizada:** Test de función sanitizadora reemplaza `https://user:pass@` por `https://[REDACTED]@`.
- **Instrucciones manuales:**
  1. Configurar logging verbose
  2. Clonar repo privado con credenciales
  3. Provocar error (ej: repo no existe)
  4. Verificar logs:
     - Ninguna línea contiene `user:token` en texto plano
     - URLs aparecen como `https://[REDACTED]@github.com/...`

### 14. Throttling de progreso
**Objetivo:** UI no se inunda con updates.
- **Prueba automatizada:** Test de throttling (máx 2 updates/segundo).
- **Instrucciones manuales:**
  1. Clonar repo grande
  2. Observar updates de progreso en consola devtools
  3. Verificar:
     - Updates no más frecuentes que 500ms
     - Barra de progreso se actualiza suavemente
     - No hay lag en UI por exceso de eventos IPC

### 15. Multi-stage reporting
**Objetivo:** Mostrar diferentes stages del proceso git.
- **Prueba automatizada:** Test de parsing de stderr para diferentes stages.
- **Instrucciones manuales:**
  1. Clonar repo con suficiente tamaño para ver múltiples stages
  2. Verificar UI muestra:
     - "Receiving objects: XX%"
     - "Resolving deltas: XX%"
     - "Counting objects: 100%"
  3. Fallback a spinner si no se puede parsear porcentaje

### 16. Validación previa de token
**Objetivo:** Botón "Validate token" funciona correctamente.
- **Prueba automatizada:** Test de endpoint GitHub API.
- **Instrucciones manuales:**
  1. Ingresar token válido
  2. Click "Validate token"
  3. Verificar:
     - UI muestra "Token válido" ✓
     - Spinner durante validación
  4. Repetir con token inválido (401) y sin permisos (403)

### 17. No persistencia de token
**Objetivo:** Credenciales no persisten en storage.
- **Prueba automatizada:** Verificar que token no se guarda en localStorage, sessionStorage, ni archivos.
- **Instrucciones manuales:**
  1. Usar DevTools para inspeccionar:
     - `localStorage`
     - `sessionStorage`
     - Zustand store después de operación
  2. Verificar:
     - No hay keys que contengan `token`, `password`, `auth`
     - Credenciales solo en memoria durante la operación

### 18. Límite de concurrencia
**Objetivo:** Prevenir DoS local por múltiples clones.
- **Prueba automatizada:** Test de límite N clones simultáneos.
- **Instrucciones manuales:**
  1. Intentar iniciar 4+ clones simultáneos (N=3 por defecto)
  2. Verificar:
     - Clones 4+ en adelante son rechazados o encolados
     - UI muestra mensaje "Máximo de clones simultáneos alcanzado"
     - Límite configurable si es necesario

### 19. Logs de errores técnicos
**Objetivo:** Detalles técnicos disponibles para debugging.
- **Prueba automatizada:** Test de que `error` y `errorCode` están presentes en resultado.
- **Instrucciones manuales:**
  1. Provocar error de clonado
  2. Expandir sección "Detalles técnicos"
  3. Verificar:
     - Muestra `errorCode` (ej: `AUTH_ERROR`)
     - Muestra mensaje de error sanitizado
     - No muestra credenciales
     - Stack trace si aplica

### 20. Token expirado / rate limit
**Objetivo:** Manejo de respuestas GitHub API 403/429.
- **Prueba automatizada:** Mock de rate limit (429) y token expirado.
- **Instrucciones manuales:**
  1. Usar token expirado
  2. Validar token
  3. Verificar:
     - UI muestra "Token expirado" o "Rate limit exceeded"
     - Sugerencia apropiada según código HTTP
  4. Simular rate limit (429) y verificar mensaje "Demasiadas solicitudes, intente más tarde"

### 21. Seguridad UI
**Objetivo:** Buenas prácticas de seguridad en inputs.
- **Prueba automatizada:** Test de atributos HTML en CredentialsBlock.
- **Instrucciones manuales:**
  1. Inspeccionar CredentialsBlock en DevTools:
     - `autoComplete="new-password"`
     - `type="password"` para token input
  2. Probar botón "Clear credentials":
     - Limpia ambos campos
     - No deja texto en clipboard
     - Resetea estado de validación

## Tests Automatizados Requeridos

### Unit Tests
1. **`clone-from-git-validation.test.ts`** - Extender con:
   - Validación de URL GitHub
   - Sanitización de logs (`sanitizeGitOutput`)
   - Parsing de progreso de stderr

2. **`clone-permission.test.ts`** - Extender con:
   - Lógica de visibilidad (public/private)
   - Restricción a solo GitHub para credenciales

3. **Nuevo: `clone-progress-parser.test.ts`**
   ```typescript
   test('parseReceivingObjects', () => {
     const line = "Receiving objects:  45% (450/1000)";
     const result = parseProgressLine(line);
     expect(result).toEqual({
       stage: 'RECEIVING_OBJECTS',
       percent: 45,
       raw: line
     });
   });
   ```

4. **Nuevo: `clone-error-mapper.test.ts`**
   ```typescript
   test('mapGitErrorToCode', () => {
     expect(mapGitErrorToCode('Authentication failed')).toBe('AUTH_ERROR');
     expect(mapGitErrorToCode('Repository not found')).toBe('UNKNOWN');
   });
   ```

### Integration Tests
5. **`clone-handler.integration.test.ts`** (Electron main process)
   - Mock child_process.spawn
   - Test cancelación con SIGTERM/SIGKILL
   - Test sanitización de URL post-spawn
   - Test límite de concurrencia

6. **`clone-modal.integration.test.ts`** (UI React)
   - Test flujo completo con MSW para mock GitHub API
   - Test limpieza de estado al cambiar URL
   - Test throttling de eventos de progreso

## Instrucciones de Ejecución de Tests

### Tests Unitarios
```bash
npm test -- --testPathPattern="clone"
```

### Tests de Integración
```bash
# Con ambiente Electron mock
npm run test:integration -- clone
```

### Tests Manuales Rápidos
1. **Smoke test:** `npm run test:smoke-clone`
   - Clona repo público
   - Valida token mock
   - Verifica UI updates

2. **Security audit:** `npm run audit:clone`
   - Busca patrones de credenciales en logs
   - Verifica atributos de seguridad en DOM
   - Check memory leaks

## Criterios de Aceptación

### Obligatorios (Blocking)
- [ ] Todos los tests automatizados pasan
- [ ] No hay credenciales en logs (sanitización 100%)
- [ ] Cancelación funciona en < 10 segundos
- [ ] UI responsive durante clonado largo
- [ ] Mensajes de error claros y accionables

### Deseables (Nice-to-have)
- [ ] Progress bar animada
- [ ] Estimación de tiempo restante
- [ ] Resume clone después de error de red
- [ ] Soporte para otros providers (GitLab, Bitbucket)
- [ ] Historial de clones recientes

## Archivos de Configuración para Tests

### `jest.config.clone.js`
```javascript
module.exports = {
  testMatch: ['**/*.clone.test.{js,jsx,ts,tsx}'],
  setupFilesAfterEnv: ['./tests/setup/clone-mocks.ts'],
  testEnvironment: 'jsdom',
};
```

### `tests/mocks/github-api.ts`
```typescript
export const mockGitHubAPI = {
  validToken: { status: 200, data: { login: 'testuser' } },
  invalidToken: { status: 401, data: { message: 'Bad credentials' } },
  noScopeToken: { status: 403, data: { message: 'Resource not accessible' } },
  rateLimited: { status: 429, headers: { 'X-RateLimit-Remaining': '0' } },
};
```

## Notas de Implementación para QA

1. **Ambiente de testing:** Usar repos de prueba GitHub (no producción)
2. **Tokens de prueba:** Usar tokens con scope limitado `repo`
3. **Monitoreo:** Habilitar logging verbose durante pruebas
4. **Performance:** Medir tiempo de clonado y uso de memoria
5. **Edge cases:** Probar con repos muy grandes (>1GB) y muy pequeños

## Responsables
- **Dev:** Implementación de features y tests unitarios
- **QA:** Ejecución de checklist manual y reporte de bugs
- **Security:** Revisión de sanitización y prácticas de seguridad
- **UX:** Validación de mensajes de error y flujos de usuario

---

*Última actualización: 2025-04-23*  
*Versión: 1.0*  
*Basado en: docs/plans/clone-private-github-flow.md*