/**
 * src/schemas/index.ts
 *
 * Public API for AgentFlow schemas.
 * Import schemas and types from here — do not import directly from individual schema files.
 */

export {
  AfprojSchema,
  AgentRefSchema,
  ConnectionSchema,
  type Afproj,
  type AgentRef,
  type Connection,
} from "./afproj.schema.ts";

export {
  AdataSchema,
  AspectRefSchema,
  SkillRefSchema,
  SubagentDeclSchema,
  type Adata,
  type AspectRef,
  type SkillRef,
  type SubagentDecl,
} from "./adata.schema.ts";
