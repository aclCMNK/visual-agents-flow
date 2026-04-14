# Exporter form:

EL exportador es un modal con formularios de acuerdo al adaptador de IA que el usuario elija.
Por ahora el unico adaptador soportado es OpenCode.

## Artifacts and Requirements:

### UIX:
    - Imagen "./exporter-opencode.jpg" en el presente directorio de este documento

## Characteristics:

- El exportador es un modal con fondo oscuro, 0.8 de opacidad y con desenfoque.
- El modal debe estar centrado en la pantalla.
- El modal debe cumplir con el estilo de la aplicación.
- El modal debe tener un botón de exportar y un botón de cancelar.
- El botón exportar debe tener el titulo "Export".
- El botón cancelar debe tener el titulo "Cancel".
- El botón exportar debe estar al lado izquierdo del botón cancelar.
- El botón exportar debe estar deshabilitado hasta que se haya seleccionado un adaptador.
    - Si no se ha seleccionado un adaptador, el botón exportar debe estar deshabilitado.
    - Si se ha seleccionado un adaptador, el botón exportar debe estar habilitado.
- El botón cancelar siempre debe estar habilitado y cierra el modal al ser pulsado.
- Tener en cuenta la imagen: "./exporter-opencode.jpg" ya que especifica la estructura del modal.
- El modal debe estar centrado en la pantalla.

## Requirements:

- El primer campo mostrado en el modal debe ser el adaptador de IA.
- El adaptador de IA debe ser un select.
- El adaptador por defecto debe ser OpenCode.
- El segundo campo mostrado debe ser un campo que contenga la ruta de donde se va a guardar la configuración.
    - Se debe despleguar un dialogo para seleccionar el directorio donde se exportará la configuración.
    - Una vez seleccionado el directorio, se debe mostrar la ruta de la configuración en el campo.
- El tercero bloque a mostrar es el formulario del adaptador de IA (OpenCode).
    - Se debe mostrar un panel de botones al lado izquierdo mostrando:
        - Un botón de "General" (seleccionado por defecto).
        - Un botón de "Agents".
        - Un botón de "Relations".
        - Un botón de "skills".
        - Un botón de "MCPs".
        - Un botón de "Plugins".
    - Se debe mostrar un panel al lado derecho mostrando las subsecciones de acuerdo al botón seleccionado del panel izquierdo.
        - Si se selecciona "General", se debe mostrar:
            - Un campo de texto para el schema de OpenCode (Se debe llamar "schema"). Se debe poner por defecto como valor "https://opencode.ai/config.json"
            - Un campo de switch para la actualización automática (Se debe llamar "Auto update"). Se debe poner por defecto como valor "true".
            - Un campo dropdown para seleccionar el agente por defecto (Se debe llamar "Default Agent"). Se debe colocar por defecto el agente orquestador.
        - Si se selecciona "Agents", se debe mostrar:
                - Un campo dropdown donde se muestran todos los agentes. Por defecto se debe mostrar el agente orquestador. Se debe llamar "Select Agent"
                - Luego un campo de textarea en el que se muestre un json con la siguiente configuración formateado en json:
                    {
                        "[nombre del agente]": {
                            "enabled": true,
                            "hidden": [boolean| true/false dependiendo si el agente es oculto o no], <-- si agente es de tipo agente o subagente no hidden, no colocar este campo
                            "mode": [string| primary/subagent], <-- si el agente es orquestado el valor debe ser primary, sino, es subagent
                            "prompt": [string| "{file:./prompt/proj_name/agent_name.md}"], <-- la ruta debe ser relativa a la configuración. "proj_name" es el nombre del proyecto creado en el editor. "agent_name.md" es el nombre del agente
                            "description": [string| "Descripción del agente"], <-- ingresado desde el modal basico de edición de agentes
                            "model": [string| "proveedor/modelo"], <-- ingresados desde el panel de propiedades del agente, Campo "Provider" y "Model"
                            "temperature": [number| temperatura], <-- ingresado desde el panel de propiedades del agente, Campo "Temperature"
                            "step": [number| pasos], <-- ingresado desde el panel de propiedades del agente, campo "Steps"
                            "color": [string| color], <-- ingresado desde el panel de propiedades del agente, campo "Color"
                            "permissions": [object| {}], <-- Detallar los diferentes grupos de permisos que el usuario asignen ya sean indivisuales o grupales
                        }
                    }
                    - En los "permissions" se debe desplegar los diferentes grupos de permisos que el usuario asigne en formato json siguiendo los mismos nombres-valores que estpan definidos desde el modal de permisos
                    - En los "permissions" tener en cuenta:
                        - Los skills que se definen en el modal de permisos > grupo skills.
                        - Tener en cuenta también las delegaciones que el agente haga con el nombre "skill-delegation-[nombre_subagente_a_delegar]"
                            - El "nombre_subagente_a_delegar" debe ser el nombre del subagente a delegar
                - Luego un campo de textarea en el que se muestren agregados todos los .md correspondiente al perfil del agente.
                    - Tener en cuenta que los .md deben ser referentes a los behaviors/ del agente en el proyecto
                    - Tener en cuenta el orden de los .md referente al behaviors/ del agente. El orden se determina desde el modal de perfilamiento del agente
                    - Cada .md se agrega a este textarea cada uno separado por un salto de linea.
            - Si se selecciona "Relations", se debe mostrar:
                - Mostrar un campo selector donde se pueda seleccionar un agente.
                    - Por defecto este campo debe tener por defecto el agente orquestador.
                - Desplegar un componente de react en el que se muestre la lista de relaciones del agente seleccionado.
                    - Mostrar primero si el agente recibe alguna delegación del usuario y si responde
                    - Por cada relación se debe mostrar a quien delega
            - Si se selecciona "skills", se debe mostrar: (Recordar que depende del directorio "skills" del proyecto)
                - Un campo dropdown donde se muestran todas las skills. Se debe llamar "Select Skill"
                - Luego un campo de textarea en el que se muestre el contenido de la skill seleccionada.
            - Si se selecciona "MCPs", se debe mostrar:
                - Mostrar "This feature is not yet implemented"
            - Si se selecciona "Plugins", se debe mostrar:
                - Desplegar un campo que active un dialogo en el que se se pueda seleccionar archivos .js y .ts
                - Mostrar un botón en el que se pueda agregar la ruta del archivo seleccionado
                - Componente en el que se listen las rutas de los .js y .ts agregados
                - Cada item agregado se puede eliminar con un botón
                - Cada item se puede editar con un botón

## Export action:

1. Al pulsar el botón exportar se debe:
    NOTA: Tener en cuenta la ruta de exportación que el usuario haya seleccionado en el modal de exportación.
    1. Crear un archivo opencode.json en el directorio seleccionado.
        1. El json a crear debe tener la siguiente estructura:
        {
            "$schema": [string | schema], <-- definido en el modal de exportación
            "auto_update": true,
            "default_agent": [string | default_agent], <-- definido en el modal de exportación
            "watcher": {
                "ignore": [
                    "node_modules/**",
                    "dist/**",
                    ".git/**"
                ]
            },
            "plugins": [array<string> | plugins], <-- listado de plugins (rutas de .js y .ts) definido en el modal de exportación
            "mcp": [], <-- por ahora no se implementa
            "agents": [array<object> | agents], <-- definido en el editor
        }
    2. Crear si no está creado el directorio "prompts" en el directorio seleccionado.
        1. Dentro de "prompts" crear un archivo "[nombre_agente].md" por cada agente, donde en ese archivo estén todos los ".md" que el usuario asignó desde el modal administrador "profiles" de cada agente.
        NOTA: Mantener el orden de los .md referente al behaviors/ del agente. El orden se determina desde el modal de perfilamiento del agente.
    3. Crear si no está creado el directorio "skills" en el directorio seleccionado de exportación.
        1. Dentro de "skills" crear todos los directorios referente a los skills que están creados en el proyecto.
        2. Crear adicionalmente un directorio "skill-delegation-[nombre_subagente_a_delegar]/SKILL.md"
            1. El "nombre_subagente_a_delegar" debe ser el nombre del subagente a delegar
            2. En la plantilla se debe leer las reglas de delegación que se definen en el panel de propiedades de las delegaciones.
            3. En la plantilla se debe leer las reglas de respuestas del subagente a delegar que se definen en el panel de propiedades de las respuestas del subagente a delegar
        4. La plantilla de SKILL.md referente a la delegación está definida en la sección "SKILLS - Delegations template" de este documento

## Cancel action:

1. Al pulsar el botón cancelar se debe cerrar el modal de exportación.
2. No se debe hacer ninguna exportación.

## SKILLS - Delegations template:

---
name: skill-delegation-[nombre_subagente_a_delegar]
description: >
  This skill is used to delegate to [nombre_subagente_a_delegar] with the following rules.
  Trigger: When the delegator agent needs something from [nombre_subagente_a_delegar]
license: Apache-2.0
metadata:
  author: Drass.Creator
  version: "1.0"
allowed-tools: Task
---

## When delegated to [nombre_subagente_a_delegar]

1. When the agent needs something from [nombre_subagente_a_delegar]
2. When the agent does not have the tools or habilities to perform the task

---

agent:
  id: "agent-name"          # Identificador único del agente
  name: "Agent Name"           # Nombre descriptivo para el editor visual
  role: "orchestrator | subagent"  # Rol dentro del sistema
  description: >
    [colocar aquí la descripción del agente definido en el modal básico de edición de agentes]

---

delegations:

  - id: "skill-delegation-[nombre_subagente_a_delegar]"
    name: [string | "Delegation Name"]

    # ── A quién se delega ──────────────────────────────────────────────────
    target_agent: ["nombre-subagente-a-delegar"]

    # ── Cuándo se delega (condición de disparo) ────────────────────────────
    trigger:
      description: >
        When the agent needs something from [nombre_subagente_a_delegar] and the agent does not have the tools or habilities to perform the task
      delegation_type:
        [string | el tipo de delegación definido en el panel de propiedades de las delegaciones]
      conditions:
        [lista | las reglas definidas en el panel de propiedades de las delegaciones]

    # ── Qué se envía al subagente ──────────────────────────────────────────
    request:
      description: >
        Prompt, orden o explicación del mensaje o payload que el agente necesita desarrollar y envía al subagente.
      format: "text"
      template: |
        Ñaño, necesito el siguiente insumo o artefacto de tu parte {{prompt}}.

    # ── Qué se espera recibir del subagente ───────────────────────────────
    response_contract:
      description: >
        Contrato de respuesta del subagente que se espera recibir. Se debe leer de las reglas de respuestas que el subagente delegado
      format: "text"

    # ── Cómo manejar la respuesta ─────────────────────────────────────────
    response_handling:
      on_success:
        action: "continue | return_to_user | trigger_next_delegation | store"
        description: >
          Qué hace este agente cuando recibe una respuesta exitosa del subagente.
        next_delegation: [nombre_siguiente_delegado]        # solo si aplica

      on_partial:
        action: "retry | escalate | continue_with_warning"
        description: >
            Este agente puede intentar responder de nuevo, intentar con otro subagente o abortar el proceso.
        max_retries: 2

      on_failure:
        action: "retry | escalate | fallback | abort"
        description: >
            Este agente puede intentar responder de nuevo, intentar con otro subagente o abortar el proceso.
        fallback_delegation: [nombre_siguiente_delegado]    # nombre de delegación alternativa si aplica
        max_retries: 1
        notify_user: true

    # ── Restricciones y límites ───────────────────────────────────────────
    constraints:
      timeout_seconds: 30
      max_tokens: 2000
      allow_sub_delegations: [true/false]   # ¿El subagente puede sub-delegar? Solo es true si tiene más subagentes a delegar
      priority: "high | normal | low"

---
