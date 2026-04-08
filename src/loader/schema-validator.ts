/**
 * src/loader/schema-validator.ts
 *
 * Validates raw parsed JSON against the AfprojSchema and AdataSchema (Zod).
 * Returns structured ValidationIssue arrays — never throws.
 *
 * This module only handles per-file schema validation.
 * Cross-file consistency is handled by cross-validator.ts.
 */

import { z } from "zod";
import { AfprojSchema } from "../schemas/afproj.schema.ts";
import { AdataSchema } from "../schemas/adata.schema.ts";
import type { Afproj } from "../schemas/afproj.schema.ts";
import type { Adata } from "../schemas/adata.schema.ts";
import type { ValidationIssue } from "./types.ts";

// ── Zod error → ValidationIssue conversion ────────────────────────────────

/**
 * Convert a ZodError into an array of ValidationIssue objects.
 *
 * @param error - The ZodError from a failed parse
 * @param source - The file path string to tag each issue with
 */
function zodErrorToIssues(error: z.ZodError, source: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: "error" as const,
    code: `SCHEMA_${issue.code.toUpperCase()}`,
    message: `${issue.path.length > 0 ? issue.path.join(".") + ": " : ""}${issue.message}`,
    source,
    repairHint: getRepairHint(issue),
  }));
}

/**
 * Generate a contextual repair hint for common Zod error codes.
 */
function getRepairHint(issue: z.core.$ZodIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      return `Wrong type. Check the field value type.`;
    case "too_small":
      return `Value is below the minimum allowed. Provide a non-empty value.`;
    case "too_big":
      return `Value exceeds the maximum allowed length.`;
    case "invalid_format":
      return `Value does not match the required format. Check pattern/format constraints.`;
    case "invalid_value":
      return `Value must be one of the allowed values.`;
    default:
      return undefined;
  }
}

// ── .afproj validation ─────────────────────────────────────────────────────

export interface AfprojValidationResult {
  success: boolean;
  data?: Afproj;
  issues: ValidationIssue[];
}

/**
 * Validate raw JSON against AfprojSchema.
 *
 * @param raw - The parsed (but unvalidated) JSON object
 * @param sourcePath - The file path for error reporting
 */
export function validateAfproj(
  raw: unknown,
  sourcePath: string
): AfprojValidationResult {
  const result = AfprojSchema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data, issues: [] };
  }

  return {
    success: false,
    issues: zodErrorToIssues(result.error, sourcePath),
  };
}

// ── .adata validation ──────────────────────────────────────────────────────

export interface AdataValidationResult {
  success: boolean;
  data?: Adata;
  issues: ValidationIssue[];
}

/**
 * Validate raw JSON against AdataSchema.
 *
 * @param raw - The parsed (but unvalidated) JSON object
 * @param sourcePath - The file path for error reporting
 */
export function validateAdata(
  raw: unknown,
  sourcePath: string
): AdataValidationResult {
  const result = AdataSchema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data, issues: [] };
  }

  return {
    success: false,
    issues: zodErrorToIssues(result.error, sourcePath),
  };
}

// ── Batch validation ───────────────────────────────────────────────────────

export interface BatchAdataResult {
  results: Map<string, AdataValidationResult>;
  allIssues: ValidationIssue[];
}

/**
 * Validate multiple .adata raw payloads in a single call.
 *
 * @param entries - Array of [sourcePath, rawJson] tuples
 */
export function validateAdataBatch(
  entries: Array<[sourcePath: string, raw: unknown]>
): BatchAdataResult {
  const results = new Map<string, AdataValidationResult>();
  const allIssues: ValidationIssue[] = [];

  for (const [sourcePath, raw] of entries) {
    const result = validateAdata(raw, sourcePath);
    results.set(sourcePath, result);
    allIssues.push(...result.issues);
  }

  return { results, allIssues };
}

// ── Partial / migration validation ────────────────────────────────────────

/**
 * Check whether a raw object has at least a valid `version` and `agentId` field.
 * Used for early detection of malformed .adata files before full parsing.
 */
export function hasAdataIdentity(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj["agentId"] === "string" &&
    obj["agentId"].length > 0 &&
    typeof obj["version"] === "number"
  );
}

/**
 * Check whether a raw object has the minimum required fields for an .afproj.
 */
export function hasAfprojIdentity(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj["name"] === "string" && typeof obj["version"] === "number";
}
