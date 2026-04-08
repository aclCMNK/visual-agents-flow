# SCHEMA_AGENT — Referencia del Schema Zod para Agentes y Subagentes

> Este documento es la referencia canónica del schema de datos para el editor AgentsFlow.  
> El archivo de implementación vive en `src/schema/agent.ts`.  
> **Fuente de verdad**: los tipos TypeScript se infieren del schema Zod — nunca se declaran de forma independiente.

---

## Índice

1. [Filosofía del Schema](#filosofía-del-schema)
2. [Diagrama de tipos](#diagrama-de-tipos)
3. [Schema completo anotado](#schema-completo-anotado)
4. [Descripción de cada campo](#descripción-de-cada-campo)
5. [Tipos inferidos TypeScript](#tipos-inferidos-typescript)
6. [Behaviors — Unión tipada](#behaviors--unión-tipada)
7. [Reglas de validación](#reglas-de-validación)
8. [Guía de uso](#guía-de-uso)
9. [Ejemplo de objeto válido completo](#ejemplo-de-objeto-válido-completo)
10. [Errores comunes de validación](#errores-comunes-de-validación)
11. [Extensibilidad y migraciones](#extensibilidad-y-migraciones)

---

## Filosofía del Schema

El schema sigue tres principios:

1. **Mínimo pero extensible** — solo los campos necesarios para el MVP. Se agrega vía versiones (`version`), no con cambios breaking.
2. **Zod como única fuente de tipos** — los tipos TypeScript no se declaran a mano. `z.infer<typeof Schema>` garantiza que tipo y validación estén siempre sincronizados.
3. **Fail loud y descriptivo** — un objeto inválido debe producir un mensaje de error que identifique exactamente qué campo falló y por qué.

---

## Diagrama de tipos

```
Agent
├── id: string (UUID)
├── name: string
├── description: string
├── version: number
├── metadata: Record<string, string>
├── behaviors: Behavior[]
│   ├── BehaviorPrompt  { type: "prompt", content: string }
│   └── BehaviorTool    { type: "tool", toolId: string, config?: Record<string,string> }
├── subagents: Subagent[]
│   ├── id: string (UUID)
│   ├── name: string
│   ├── description: string
│   ├── behaviors: Behavior[]
│   └── metadata: Record<string, string>
├── createdAt: string (ISO 8601)
└── updatedAt: string (ISO 8601)
```

---

## Schema completo anotado

```typescript
// src/schema/agent.ts
import { z } from "zod";

// ── Behaviors ──────────────────────────────────────────────────────────────

/**
 * Behavior de tipo "prompt": instrucción de texto plano enviada al modelo.
 */
export const BehaviorPromptSchema = z.object({
  type: z.literal("prompt"),
  content: z.string().min(1, "El prompt no puede estar vacío"),
});

/**
 * Behavior de tipo "tool": herramienta que el agente puede invocar.
 * `config` es opcional: pares clave-valor para parametrizar la herramienta.
 */
export const BehaviorToolSchema = z.object({
  type: z.literal("tool"),
  toolId: z.string().min(1, "toolId es requerido"),
  config: z.record(z.string()).optional(),
});

/**
 * Unión discriminada de behaviors.
 * Agregar nuevos tipos de behavior aquí sin romper los existentes.
 */
export const BehaviorSchema = z.discriminatedUnion("type", [
  BehaviorPromptSchema,
  BehaviorToolSchema,
]);

// ── Subagent ───────────────────────────────────────────────────────────────

/**
 * Un subagente es un agente simplificado que vive dentro de un agente padre.
 * No tiene subagentes propios (no hay anidamiento infinito en el MVP).
 */
export const SubagentSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido"),
  name: z.string().min(1, "El nombre es requerido").max(100),
  description: z.string().max(500).default(""),
  behaviors: z.array(BehaviorSchema).default([]),
  metadata: z.record(z.string()).default({}),
});

// ── Agent ──────────────────────────────────────────────────────────────────

/**
 * Schema principal del agente.
 * `version` se usa para detectar migraciones de formato en import/export.
 * `createdAt` y `updatedAt` son strings ISO 8601 — se asignan en la capa de persistencia.
 */
export const AgentSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido"),
  name: z.string().min(1, "El nombre es requerido").max(100),
  description: z.string().max(1000).default(""),
  version: z.number().int().positive().default(1),
  metadata: z.record(z.string()).default({}),
  behaviors: z.array(BehaviorSchema).default([]),
  subagents: z.array(SubagentSchema).default([]),
  createdAt: z.string().datetime({ message: "createdAt debe ser ISO 8601" }),
  updatedAt: z.string().datetime({ message: "updatedAt debe ser ISO 8601" }),
});

// ── Tipos inferidos ────────────────────────────────────────────────────────

export type BehaviorPrompt = z.infer<typeof BehaviorPromptSchema>;
export type BehaviorTool   = z.infer<typeof BehaviorToolSchema>;
export type Behavior       = z.infer<typeof BehaviorSchema>;
export type Subagent       = z.infer<typeof SubagentSchema>;
export type Agent          = z.infer<typeof AgentSchema>;
```

---

## Descripción de cada campo

### `Agent`

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `id` | `string` (UUID v4) | Sí | — | Identificador único. Siempre UUID v4. Se genera en la capa de persistencia, no en el schema. |
| `name` | `string` | Sí | — | Nombre visible del agente. 1–100 caracteres. |
| `description` | `string` | No | `""` | Descripción del propósito del agente. Máximo 1000 caracteres. |
| `version` | `number` | No | `1` | Versión del formato del objeto. Entero positivo. Incrementar en migraciones breaking. |
| `metadata` | `Record<string, string>` | No | `{}` | Pares clave-valor arbitrarios para metadatos del agente (e.g. `author`, `team`, `tags`). |
| `behaviors` | `Behavior[]` | No | `[]` | Array de behaviors del agente. Ver sección [Behaviors](#behaviors--unión-tipada). |
| `subagents` | `Subagent[]` | No | `[]` | Subagentes anidados. No hay anidamiento recursivo en el MVP. |
| `createdAt` | `string` ISO 8601 | Sí | — | Timestamp de creación. Asignado por la capa de persistencia. |
| `updatedAt` | `string` ISO 8601 | Sí | — | Timestamp de última modificación. Actualizado en cada mutación. |

### `Subagent`

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `id` | `string` (UUID v4) | Sí | — | Identificador único dentro del agente padre. |
| `name` | `string` | Sí | — | Nombre visible del subagente. 1–100 caracteres. |
| `description` | `string` | No | `""` | Descripción del subagente. Máximo 500 caracteres. |
| `behaviors` | `Behavior[]` | No | `[]` | Behaviors del subagente. Misma unión tipada que el agente. |
| `metadata` | `Record<string, string>` | No | `{}` | Metadatos del subagente. |

---

## Tipos inferidos TypeScript

Los tipos se infieren directamente del schema. **No los declares manualmente.**

```typescript
import type { Agent, Subagent, Behavior } from "@/schema/agent";

// ✅ Correcto — tipo inferido, siempre en sync con el schema
const agent: Agent = AgentSchema.parse(rawData);

// ❌ Incorrecto — declaración manual que puede divergir del schema
type Agent = {
  id: string;
  name: string;
  // ...
};
```

---

## Behaviors — Unión tipada

Los behaviors usan `z.discriminatedUnion` con el campo `type` como discriminante. Esto permite a TypeScript hacer narrowing automático:

```typescript
import { BehaviorSchema, type Behavior } from "@/schema/agent";

function describeBehavior(b: Behavior): string {
  switch (b.type) {
    case "prompt":
      // TypeScript sabe que b es BehaviorPrompt aquí
      return `Prompt: ${b.content.substring(0, 50)}...`;
    case "tool":
      // TypeScript sabe que b es BehaviorTool aquí
      return `Tool: ${b.toolId}`;
  }
}
```

### Agregar un nuevo tipo de Behavior

1. Define el nuevo schema: `export const BehaviorWebhookSchema = z.object({ type: z.literal("webhook"), url: z.string().url() });`
2. Agrégalo al array de `z.discriminatedUnion`: `[BehaviorPromptSchema, BehaviorToolSchema, BehaviorWebhookSchema]`
3. Agrega el caso al switch en todos los lugares donde se consume `Behavior`.
4. Bump del campo `version` en los agentes que usen el nuevo behavior (si aplica).

---

## Reglas de validación

| Campo | Regla | Mensaje de error |
|-------|-------|-----------------|
| `id` | UUID v4 válido | `"id debe ser un UUID válido"` |
| `name` | No vacío, max 100 chars | `"El nombre es requerido"` |
| `description` (Agent) | Max 1000 chars | Error estándar de Zod |
| `description` (Subagent) | Max 500 chars | Error estándar de Zod |
| `version` | Entero positivo | Error estándar de Zod |
| `createdAt` / `updatedAt` | ISO 8601 datetime | `"createdAt debe ser ISO 8601"` |
| `behaviors[].type` | Uno de: `"prompt"`, `"tool"` | `"Invalid discriminator value"` |
| `behaviors[].content` (prompt) | No vacío | `"El prompt no puede estar vacío"` |
| `behaviors[].toolId` (tool) | No vacío | `"toolId es requerido"` |
| `metadata` | Record de strings (valores string) | Error estándar de Zod |

---

## Guía de uso

### Parsear datos externos (import/API)

```typescript
import { AgentSchema } from "@/schema/agent";

// Parseo estricto — lanza ZodError si el dato es inválido
const agent = AgentSchema.parse(rawJson);

// Parseo seguro — devuelve { success, data } o { success, error }
const result = AgentSchema.safeParse(rawJson);
if (!result.success) {
  console.error(result.error.format());
  // Mostrar errores al usuario
} else {
  const agent = result.data;
}
```

### Validar parcialmente (edición de formularios)

```typescript
import { AgentSchema } from "@/schema/agent";

// Solo valida los campos presentes — útil para formularios parciales
const PartialAgentSchema = AgentSchema.partial();
const result = PartialAgentSchema.safeParse(formData);
```

### Crear un agente nuevo (con defaults)

```typescript
import { AgentSchema } from "@/schema/agent";
import { v4 as uuidv4 } from "uuid";

const now = new Date().toISOString();

const newAgent = AgentSchema.parse({
  id: uuidv4(),
  name: "Mi nuevo agente",
  createdAt: now,
  updatedAt: now,
  // description, version, metadata, behaviors, subagents → toman su default
});
```

---

## Ejemplo de objeto válido completo

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Agente de soporte técnico",
  "description": "Asiste a usuarios con problemas técnicos de nivel 1.",
  "version": 1,
  "metadata": {
    "author": "equipo-plataforma",
    "environment": "production"
  },
  "behaviors": [
    {
      "type": "prompt",
      "content": "Eres un asistente de soporte técnico amable y preciso. Responde en el idioma del usuario."
    },
    {
      "type": "tool",
      "toolId": "knowledge-base-search",
      "config": {
        "maxResults": "5",
        "threshold": "0.7"
      }
    }
  ],
  "subagents": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Clasificador de tickets",
      "description": "Clasifica el ticket por categoría antes de escalar.",
      "behaviors": [
        {
          "type": "prompt",
          "content": "Clasifica el ticket como: hardware, software, red, o acceso."
        }
      ],
      "metadata": {}
    }
  ],
  "createdAt": "2026-04-06T10:00:00.000Z",
  "updatedAt": "2026-04-06T10:00:00.000Z"
}
```

---

## Errores comunes de validación

| Error | Causa | Solución |
|-------|-------|----------|
| `"id debe ser un UUID válido"` | `id` no tiene formato UUID v4 | Generar con `crypto.randomUUID()` o `uuid` package. |
| `"El nombre es requerido"` | `name` es `""` o falta | Proveer un string no vacío. |
| `"createdAt debe ser ISO 8601"` | Timestamp en formato incorrecto | Usar `new Date().toISOString()`. |
| `"Invalid discriminator value"` | `behaviors[n].type` no es `"prompt"` ni `"tool"` | Verificar el campo `type` de cada behavior. |
| `"El prompt no puede estar vacío"` | `behaviors[n].content` es `""` | Proveer contenido no vacío en behaviors de tipo prompt. |
| `ZodError: Expected string, received number` | `metadata` tiene valor no-string | Todos los valores de `metadata` deben ser `string`. |

---

## Extensibilidad y migraciones

### Agregar un campo nuevo (no breaking)

Si el nuevo campo es opcional, agrégalo con `.optional()` o con un `.default(...)`. No incrementar `version`.

```typescript
// Agregar campo opcional sin romper datos existentes
export const AgentSchema = z.object({
  // ... campos existentes
  tags: z.array(z.string()).default([]),  // ← nuevo, no breaking
});
```

### Cambiar la forma de un campo (breaking)

1. Incrementar `version` en el schema (`z.number().int().positive().default(2)`).
2. Escribir una función de migración en `src/persistence/migrations.ts`:
   ```typescript
   export function migrateV1toV2(raw: unknown): unknown {
     // transformar el objeto del formato v1 al v2
   }
   ```
3. La función de import debe detectar `version` y aplicar migraciones en orden antes de parsear con el schema actual.

### Convención de versiones

| `version` | Descripción |
|-----------|-------------|
| `1` | Schema inicial del MVP |
| `2+` | Incrementar en cambios breaking al schema |
