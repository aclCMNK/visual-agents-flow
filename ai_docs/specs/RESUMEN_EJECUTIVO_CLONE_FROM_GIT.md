# RESUMEN EJECUTIVO: "Clone from Git" (AgentsFlow)

## 1. OBJETIVO

Implementar un flujo de interfaz para clonar un repositorio Git y crear un nuevo proyecto dentro del editor AgentsFlow. Se agrega para reducir la fricción al iniciar proyectos existentes alojados en Git, integrando el proceso de clone con el flujo actual (clone → validar → cargar → abrir editor) y manteniendo la UX consistente con los botones existentes en ProjectBrowser.

## 2. REQUISITOS

- Agregar un tercer botón "From Git" en ProjectBrowser junto a los botones "New Project" y "Open Project".
- Mostrar un modal centrado que bloquea la interacción con el fondo mientras está abierto (backdrop modal).
- Autocompletar el nombre del nuevo proyecto extraído automáticamente desde la URL del repositorio proporcionada (ej.: extraer el segmento final del path del repo y sugerirlo como nombre de carpeta/proyecto).
- No implementar validaciones complejas por ahora (por ejemplo, no validar credenciales SSH/protocolos ni políticas remotas); solo comprobaciones básicas de URL no vacía y formato mínimo.
- Integración completa con el flujo existente: disparar operación de clone (IPC → proceso native), validar resultado, cargar proyecto en el store y abrir el editor si el clone fue exitoso.
- Registrar errores y exponer mensajes de error simples en el modal (texto amigable), sin reintentos automáticos en esta primera iteración.

## 3. BLOQUES ESTRATÉGICOS (orden de implementación)

1. Bloque 1: Bridge IPC
   - Agregar nuevos canales IPC en el bridge/electron layer para solicitar un clone desde el renderer y recibir progreso/resultado.
   - Canales esperados (sugeridos): `clone-git:start` (request), `clone-git:progress` (optional), `clone-git:done` (response), `clone-git:error` (response).
   - Implementar handling mínimo en el proceso main/electron que invoque git clone (o el helper de backend existente) y devuelva resultado.

2. Bloque 2: projectStore
   - Añadir acción `cloneProjectFromGit(url: string, destinationName?: string)` en el store de proyectos (Zustand) que coordine la llamada al bridge IPC y realice los pasos: iniciar clone → esperar resultado → on success: crear registro de proyecto y cargarlo.
   - Dejar un TODO/hook en la acción para futuras validaciones y reintentos.

3. Bloque 3: CloneFromGitModal.tsx
   - Nuevo componente React que contiene: campo de URL, campo de nombre (autocompletado desde URL, editable), botones "Cancel" y "Clone".
   - Estado: url, suggestedName, loading, errorMessage.
   - Llamar a `projectStore.cloneProjectFromGit` y mostrar feedback visual (spinner / disabled) durante la operación.

4. Bloque 4: Integración ProjectBrowser.tsx
   - Agregar botón "From Git" que abre el modal.
   - Mantener estilos y posicionamiento consistentes con los botones existentes.

5. Bloque 5: Pruebas básicas
   - Tests manuales y unitarios mínimos: abrir/cerrar modal, autocompletar nombre desde URL, llamada al store que dispara IPC, manejo de éxito y error (mock del bridge).

## 4. DECISIONES TÉCNICAS

| Decisión | Opción elegida | Razonamiento / Notas |
|---|---:|---|
| Reusar vs. crear canales IPC | Crear nuevos canales específicos (`clone-git:*`) | Separación de responsabilidades: evita romper otros flujos IPC; permite evolucionar el protocolo de clone sin impactos colaterales. Si ya existe un canal genérico probado, se puede mapear internamente, pero exponer uno dedicado mejora trazabilidad.
| Directorio destino | Crear subcarpeta dentro del workspace/default projects dir con el nombre sugerido | Mantiene cada proyecto en su propio subfolder; coherencia con comportamiento de "New Project". Si la carpeta existe, devolver error y pedir confirmación en iteración futura.
| Manejo de errores | Mensajes simples al usuario + logging detallado en backend | En primera iteración no reintentos automáticos; se informa error en modal y se registra el detalle en logs para debugging. Dejar hook para agregar reintentos y manejo de autenticación en iteraciones posteriores.
| Autocompletado de nombre | Extraer último segmento del path del repo (strip `.git`) | Suficiente para mayoría de repos; editable por el usuario. No hacer validaciones complejas de caracteres en esta fase.

## 5. TIMELINE (estimado, 1 dev)

- Sprint 1 (1–2 días): Implementar Bridge IPC y handlers en main/electron; agregar minimal API para clone.
- Sprint 2 (1–2 días): Implementar action en projectStore y el componente CloneFromGitModal; integrar botón en ProjectBrowser.tsx.
- Sprint 3 (1 día): Pruebas básicas (unit/integration mocks) y correcciones menores.
- Total estimado: 3–5 días por 1 desarrollador con conocimiento del repo.

## 6. CRITERIOS DE ÉXITO

- El botón "From Git" es visible en ProjectBrowser y respeta estilos existentes.
- El modal se abre y cierra correctamente; bloquea la UI de fondo mientras está activo.
- El campo de nombre se autocompleta al pegar una URL válida y es editable.
- Al confirmar "Clone", se dispara la llamada IPC al endpoint backend y se recibe respuesta (success/error).
- En caso de éxito, el nuevo proyecto aparece cargado en el editor y el flujo continúa (abrir editor). En caso de error, se muestra mensaje en el modal.

## 7. PREGUNTA #5 DE MEMORIA: "Validaciones complejas y estrategias de reintento"

Qué es: conjunto de comportamientos que abordan fallas frecuentes en operaciones remotas (errores de red, autenticación SSH/HTTP, permisos, repos privados, timeouts). Incluye: validación de credenciales, reintentos con backoff, prompts de autenticación, y validaciones pre-clone (p. ej. comprobar cabeceras/ACL si el backend lo permite).

Decisión para esta entrega: marcar como tarea para iteración futura. No se implementan validaciones avanzadas ni reintentos automáticos en la primera versión; sólo validaciones mínimas de URL y manejo de errores simple.

Implementación práctica inmediata: dejar un "hook" en el código (comentario TODO y función exportada) dentro de projectStore (ej.: `// TODO: implement clone retries & auth flow - MEM-5`) y en el bridge (`// TODO: expose auth callbacks for clone - MEM-5`) para que el equipo encuentre fácilmente el lugar donde extender la lógica. Esto actúa como recordatorio y punto de integración para la siguiente iteración.

## 8. REFERENCIAS A ARCHIVOS REALES (modificar / agregar)

- Modificar: src/ui/ProjectBrowser.tsx — agregar botón "From Git" e invocar apertura del modal.
- Agregar: src/ui/modals/CloneFromGitModal.tsx — nuevo componente del modal.
- Modificar / Agregar: src/store/projectStore.ts (o donde exista el store de proyectos) — acción `cloneProjectFromGit` y hook TODO para validaciones/reintentos.
- Modificar: electron/bridge.ts (o el archivo que expone canales IPC) — nuevos canales `clone-git:start`, `clone-git:done`, `clone-git:error` y manejo asociado en main process.
- Agregar (tests): tests/ui/clone-from-git.test.tsx y tests/store/project-store-clone.test.ts (mocks para IPC).

---

Notas finales: el alcance descrito prioriza un MVP funcional y seguro para usuario final, sin entrar aún en soporte de repos privados, autenticación interactivas ni reintentos sofisticados. Estas capacidades deben planearse en una segunda iteración marcada con el hook MEM-5.
