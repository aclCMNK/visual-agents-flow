/**
 * src/loader/index.ts
 *
 * Public API for the AgentFlow Project Loader.
 *
 * Import from here — do not import directly from internal loader modules.
 */

// ── Main loader ────────────────────────────────────────────────────────────
export { ProjectLoader, loadProject } from "./project-loader.ts";

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  LoaderOptions,
  LoadResult,
  ProjectModel,
  AgentModel,
  SubagentModel,
  ValidationIssue,
  IssueSeverity,
  RepairAction,
  RepairActionKind,
  FileReadRecord,
} from "./types.ts";

// ── Schema validator (for programmatic use) ────────────────────────────────
export {
  validateAfproj,
  validateAdata,
  validateAdataBatch,
  hasAdataIdentity,
  hasAfprojIdentity,
} from "./schema-validator.ts";

// ── Cross-validator ────────────────────────────────────────────────────────
export { crossValidate, hasErrors, filterBySeverity } from "./cross-validator.ts";

// ── Lock manager ───────────────────────────────────────────────────────────
export {
  acquireLock,
  atomicWriteJson,
  atomicWriteText,
  getLockInfo,
  forceReleaseLock,
  type LockInfo,
} from "./lock-manager.ts";

// ── File reader (for advanced use) ────────────────────────────────────────
export {
  readJsonFile,
  readTextFile,
  fileExists,
  isFile,
  isDirectory,
  resolveProjectPath,
  toRelativePath,
  findAfprojFiles,
  findAdataFiles,
  findBehaviorFiles,
  findSkillFiles,
} from "./file-reader.ts";
