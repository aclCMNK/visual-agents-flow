# Propiedades de agentes

## Objetivo:
Vamos a crear un formulario para configurar los agentes en diferentes adaptadores o chats.

1. Campo 1: Adaptador - Tipo selector
    1.1. Opciones:
        - Ninguno, no se crea un adaptador. Viene seleccionado por defecto y no es seleccionable
        - OpenCode, tiene como valor "opencode"


2. Botón: Crear Adaptador:
    - Crea el adaptador seleccionado.
    - Si no hay adaptador seleccionado, no hace nada, pero se debe mostrar un mensaje de error debajo del selector.
    - Si el adaptador ya existe, no hace nada, pero se debe mostrar un mensaje de error debajo del selector.
    - Si el adaptador se ha creado con éxito, se debe mostrar los campos del formulario de configuración del respectivo adaptador.


## Formularios de configuraciones:

    ### OpenCode:
    1. Proveedor "Provider" - Tipo selector
        1.1. Opciones:
            - Se deben cargar los proveedores de OpenCode

    2. Modelos "Models" - Tipo selector
        2.1. Opciones:
            - Se deben cargar los modelos de los proveedores de OpenCode
    - Crear aquí un grupo o sección especial para perfilamiento del agente:
        - Colocar un botón para agregar un documento .md
            - Al clickear en agregar, se debe mostrar un botón adicional que despliegue un modal.
                - En el modal se debe mostrar un explorador de archivos que solo permita visualizar subdirectorios y archivos ubicados desde el directorio "behavior" del proyecto
                - El usuario podrá navegar y explorar en el componente
                - El usuario podrá seleccionar un archivo .md
                - Al seleccionar un archivo .md se debe colocar el nombre del archivo en el botón que desplegó el modal
            - Al lado del boton agregar otro boton para eliminar el documento .md
        - Estructura:
            +-------------------------------------+
            | Add profile (button)                |
            |-------------------------------------|
            | Select... (button) | x (button)     |
            |...                                  |
            +-------------------------------------+
    3. Temperatura "Temperature" - Tipo selector
        3.1.Opciones:
            - Se deben mostrar valores de 0 a 100 con valores internos de 0.0 a 1.0
    4. Herramientas "Tools" - Tipo grupo
        4.1 Boton agregar "Add" - Tipo botón
        4.2 Cuando se agrega, se crea un fila con los siguientes campos:
            4.2.1. Nombre herramienta "ToolName" - Tipo texto
            4.2.2. Valor herramienta "ToolValue" - Tipo selector
                4.2.2.1. Opciones:
                    - True, con valor internamente "true"
                    - False, con valor internamente "false"
                    - Allow, con valor internamente "allow"
                    - Deny, con valor internamente "deny"
                    - Ask, con valor internamente "ask"
            4.2.3. Boton eliminar "Delete" - Tipo botón
    4. Permisos "Permissions" - Tipo grupo
        - UIX: Parecido a la propiedad de perfilamiento.
            - Debe haber un boton que despliegue un modal para agregar permisos
        UIX-Modal:
            - Boton agregar "Add tool" - Tipo botón
                - Campo "ToolName" - Tipo texto: Nombre que agrupa permisos
                - Boton agregar "Add permission" - Tipo botón: Agrega una fila descrita en (A)
                - (A) Cuando se agrega, se crea un fila con los siguientes campos:
                    4.2.1. Nombre herramienta "ToolName" - Tipo texto
                    4.2.2. Valor herramienta "ToolValue" - Tipo selector
                        4.2.2.1. Opciones:
                            - Allow, con valor internamente "allow"
                            - Deny, con valor internamente "deny"
                            - Ask, con valor internamente "ask"
                    4.2.3. Boton eliminar "Delete" - Tipo botón
        - Crear aquí un grupo o sección especial para asignación de permisos de skills:
            - Colocar un botón para agregar un subgrupo de campos
                - Al clickear en agregar, se debe mostrar un botón adicional que despliegue un modal.
                    - En el modal se debe mostrar un explorador de archivos que solo permita visualizar una lista de skills ubicadas desde el directorio "skills" del proyecto
                    - También se debe mostrar un buscador de skills del listado del item de arriba
                    - A medida que el usuario va tipeando en un campo de texto, el editor listará los skills que se acerquen con la busqueda que está tipeando. El buscador mostrará un listado de terminos parecidos de la siguiente manera:
                        - palabras_relacionadas/parecidas
                        - palabra1_palabra2_...-*
                        - palabra1_...-*
                        - palabra1*
                    - Al seleccionar la palabra, el campo de texto se completará con la opción seleccionada
                    - Cuando se acepte el criterio encontrado, se debe crear una nueva fila con los siguientes campos en el grupo:
            - Estructura:
                +------------------------------------------------+
                | Add skill (button)                             |
                |------------------------------------------------|
                | select... (button) | (dropdown) | x(button)    | 
                |...                                             |
                +------------------------------------------------+
            - Donde dice select, debe mostrar textualmente el skill seleccionado
            - el dropdown debe tener las siguientes opciones:
                - Allow
                - Deny
                - Ask
    5. Oculto "Hidden" - Tipo toogle o switch
        Regla:
            - Solo aparece cuando el agente es de tipo subagente
        5.1 Nombre de propiedad: "Hidden"
        5.2 Se debe agregar un boton con "?" para mostrar la ayuda:
            - "Hide a subagent from the @ autocomplete menu with hidden: true. Useful for internal subagents that should only be invoked programmatically by other agents via the Task tool."
            - "This only affects user visibility in the autocomplete menu. Hidden agents can still be invoked by the model via the Task tool if permissions allow."
        5.1 Opciones:
            - True, con valor internamente "true"
            - False, con valor internamente "false"
    6. Pasos "Steps" - Tipo numerico
        Regla:
            - el campo debe ser de tipo numérico
    7. Color "Color" - Tipo color picker
        Regla:
            - el campo debe devolver y asignar un valor tipo hexadecimal
        7.1 Campo de colorpicker
        7.2 Campo de texto para mostrar el color seleccionado
