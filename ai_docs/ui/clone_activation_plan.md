# 🧠 Plan de Solución: Activación de Botón Clone para Repos Privados

## 🎯 Objective
Implementar la lógica de activación, validación y ejecución del botón "Clone" específicamente para repositorios privados de GitHub, asegurando que el usuario tenga los permisos necesarios y que el flujo de comunicación entre la UI y el proceso principal (IPC) sea robusto.

## 🧩 Context
Actualmente, el botón de clonado puede estar habilitado para repos públicos, pero los repos privados requieren una validación de autenticación (Token/SSH) antes de permitir la acción. Se necesita un flujo que evite intentos de clonado fallidos y proporcione feedback claro al usuario.

## 🧭 Strategy
Adoptar un enfoque de **"Validación Proactiva"**. El botón permanecerá deshabilitado o en estado de "verificación" hasta que el sistema confirme que el repositorio es accesible con las credenciales actuales. Se utilizará un flujo asíncrono vía IPC para no bloquear la interfaz de usuario.

## 🚀 Phases

### 🔹 Phase 1: UI & UX Enhancements
**Description:** Modificar la interfaz para reflejar el estado de disponibilidad del botón de clonado.

**Tasks:**
- **Task:** Implementar estados visuales para el botón (Disabled, Loading, Enabled, Error).
  - **Assigned to:** UI Developer
  - **Dependencies:** None
- **Task:** Crear un tooltip o mensaje de ayuda que explique por qué el botón está deshabilitado (ej: "Autenticación requerida para repos privados").
  - **Assigned to:** UI Developer
  - **Dependencies:** None

---

### 🔹 Phase 2: State Management
**Description:** Gestionar el estado de acceso al repositorio en el store global.

**Tasks:**
- **Task:** Definir una variable de estado `repoAccessStatus` (`'unknown' | 'public' | 'private_authorized' | 'private_unauthorized'`).
  - **Assigned to:** State Manager / Frontend Dev
  - **Dependencies:** None
- **Task:** Implementar el trigger de actualización de estado al cargar la URL del repositorio.
  - **Assigned to:** State Manager / Frontend Dev
  - **Dependencies:** None

---

### 🔹 Phase 3: Validation Logic & IPC Calls
**Description:** Establecer la comunicación entre el proceso de renderizado y el proceso principal para validar el acceso.

**Tasks:**
- **Task:** Crear función de validación `validateRepoAccess(url)` que envíe un mensaje IPC al backend.
  - **Assigned to:** IPC Handler / Backend Dev
  - **Dependencies:** Phase 2
- **Task:** Implementar en el proceso principal (Main Process) la lógica de chequeo mediante la API de GitHub o un `git ls-remote` simulado.
  - **Assigned to:** Backend Dev
  - **Dependencies:** Phase 3 (Task 1)
- **Task:** Manejar la respuesta del IPC para actualizar el `repoAccessStatus` en la UI.
  - **Assigned to:** IPC Handler / Frontend Dev
  - **Dependencies:** Phase 3 (Task 2)

---

### 🔹 Phase 4: Execution Logic (The Clone Action)
**Description:** Implementar la llamada final de clonado una vez validado el acceso.

**Tasks:**
- **Task:** Vincular el evento `onClick` del botón Clone a la función de ejecución de clonado.
  - **Assigned to:** Frontend Dev
  - **Dependencies:** Phase 3
- **Task:** Implementar el comando de clonado en el backend asegurando el uso de las credenciales almacenadas.
  - **Assigned to:** Backend Dev
  - **Dependencies:** Phase 3

---

### 🔹 Phase 5: Testing Strategy
**Description:** Asegurar que todos los escenarios de permisos sean cubiertos.

**Tasks:**
- **Task:** Test de Repositorio Público $\rightarrow$ Botón habilitado inmediatamente.
  - **Assigned to:** QA / Tester
  - **Dependencies:** Phase 4
- **Task:** Test de Repositorio Privado (Sin Token) $\rightarrow$ Botón deshabilitado + Mensaje de error.
  - **Assigned to:** QA / Tester
  - **Dependencies:** Phase 4
- **Task:** Test de Repositorio Privado (Con Token Válido) $\rightarrow$ Botón habilitado $\rightarrow$ Clonado exitoso.
  - **Assigned to:** QA / Tester
  - **Dependencies:** Phase 4
- **Task:** Test de Token Expirado $\rightarrow$ Flujo de re-autenticación.
  - **Assigned to:** QA / Tester
  - **Dependencies:** Phase 4

---

## ⚠️ Risks
- **Latencia de API:** El chequeo de acceso puede tardar, dejando el botón en "Loading" demasiado tiempo. *Mitigación: Implementar timeout y caché de acceso.*
- **Seguridad de Tokens:** Manejo inseguro de credenciales en el proceso de IPC. *Mitigación: No enviar tokens vía IPC, manejarlos exclusivamente en el Main Process.*

## 📝 Notes
- Se recomienda utilizar `git ls-remote` para validar el acceso sin necesidad de clonar el repositorio completo primero.
- El estado del botón debe persistir mientras la URL del repositorio no cambie.
