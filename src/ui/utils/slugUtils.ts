/**
 * src/ui/utils/slugUtils.ts
 *
 * Robust slug generation and validation for agent names.
 *
 * ## Behaviour
 *
 * - Converts the input to lowercase.
 * - Normalises unicode: strips accents and diacritics (NFD + remove combining
 *   marks), and converts common special characters (ñ → n, ß → ss, etc.).
 * - Replaces any run of characters that are NOT [a-z0-9] with a single hyphen.
 * - Collapses consecutive hyphens into one.
 * - Strips leading and trailing hyphens.
 * - Enforces a minimum length of 2 characters and a maximum of 64 characters.
 *
 * ## Collision resolution
 *
 * If the resulting slug already exists in `existingSlugs` or is one of the
 * reserved words, an incremental numeric suffix is appended until a free slot
 * is found (e.g. `my-agent` → `my-agent-2` → `my-agent-3` …).
 *
 * ## API surface
 *
 * ```ts
 * import { slugify, isSlugValid } from "@/ui/utils/slugUtils";
 *
 * const slug = slugify("Mi Agente!", ["mi-agente"]);
 * // → "mi-agente-2"
 *
 * const ok = isSlugValid("admin", []);
 * // → false  (reserved word)
 * ```
 *
 * All functions are pure (no I/O, no side-effects) and trivially testable with
 * bun:test.
 */

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Slug words that must never be used as agent identifiers.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "system",
  "new-agent",
]);

/** Minimum number of characters in a valid slug. */
export const SLUG_MIN_LENGTH = 2;

/** Maximum number of characters in a valid slug. */
export const SLUG_MAX_LENGTH = 64;

// ── Character-map helpers ─────────────────────────────────────────────────

/**
 * Manual transliteration map for characters that NFD decomposition does NOT
 * reduce to a plain ASCII base letter.
 *
 * We apply this BEFORE the NFD+combining-mark strip so that each entry is
 * guaranteed to produce only [a-z0-9] characters after lowercasing.
 */
const CHAR_MAP: Record<string, string> = {
  // German
  ß: "ss",
  // Icelandic / Old English
  ð: "d",
  þ: "th",
  // Scandinavian
  ø: "o",
  œ: "oe",
  æ: "ae",
  // Other common ligatures / special letters
  ł: "l",
  đ: "d",
  ħ: "h",
  ı: "i",
  ĸ: "k",
  ŋ: "n",
  // Currency-like that can appear in names
  "€": "e",
  "£": "l",
  // Common punctuation that users might type as separators
  // NOTE: "_" is intentionally NOT mapped here so that underscores are
  // preserved in the slug (e.g. "puro_traqueteo" → "puro_traqueteo").
  // Step 3 of toSlug() already keeps [a-z0-9\-_] as-is.
  ".": "-",
  " ": "-",
};

/**
 * Replaces each character in `input` with its transliteration from CHAR_MAP,
 * or returns the character unchanged if it has no mapping.
 */
function applyCharMap(input: string): string {
  let result = "";
  for (const ch of input) {
    result += CHAR_MAP[ch] ?? ch;
  }
  return result;
}

// ── Core transformation ───────────────────────────────────────────────────

/**
 * Converts an arbitrary human-readable string into a URL / filesystem-safe
 * slug consisting only of `[a-z0-9-]`.
 *
 * **Does NOT check for uniqueness or reserved words.**
 * Use `slugify()` for the full pipeline that includes collision resolution.
 *
 * @param input - Raw user input (name, label, etc.)
 * @returns The normalised slug string.  May be empty if all characters are
 *   stripped (caller should handle that case).
 *
 * @example
 * toSlug("Mi Agente Nº1!")  // → "mi-agente-n1"
 * toSlug("Ágënt Böt")       // → "agent-bot"
 * toSlug("__hello world__") // → "hello-world"  (leading/trailing _ stripped)
 * toSlug("my-project_v2")   // → "my-project_v2" (hyphens and underscores preserved)
 * toSlug("puro-traqueteo")  // → "puro-traqueteo"
 * toSlug("puro_traqueteo")  // → "puro_traqueteo"
 */
export function toSlug(input: string): string {
  let s = input.toLowerCase();

  // 1. Apply manual transliteration map (before NFD so ß→ss etc.)
  //    Note: '_' is NOT in CHAR_MAP — it is preserved by step 3 below.
  s = applyCharMap(s);

  // 2. NFD decompose then strip combining diacritical marks (U+0300–U+036F)
  //    This handles à→a, é→e, ñ→n (ñ NFD = n + ̃), ü→u, etc.
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 3. Replace any character that is NOT [a-z0-9\-_] with a hyphen
  //    Hyphens (-) and underscores (_) are preserved as-is so that project/agent
  //    names like "my-project" or "my_agent" keep their separators in the path.
  s = s.replace(/[^a-z0-9\-_]+/g, "-");

  // 4. Collapse consecutive hyphens (but leave underscores untouched)
  s = s.replace(/-{2,}/g, "-");

  // 5. Strip leading and trailing hyphens and underscores
  s = s.replace(/^[-_]+|[-_]+$/g, "");

  // 6. Enforce maximum length (trim at a hyphen boundary if possible)
  if (s.length > SLUG_MAX_LENGTH) {
    s = s.slice(0, SLUG_MAX_LENGTH);
    // Avoid ending on a mid-word hyphen boundary artefact
    s = s.replace(/-+$/, "");
  }

  return s;
}

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Validates a *pre-formed* slug against all constraints:
 *
 * 1. Only `[a-z0-9-]` characters.
 * 2. No leading or trailing hyphens.
 * 3. No consecutive hyphens.
 * 4. Minimum length of `SLUG_MIN_LENGTH`.
 * 5. Maximum length of `SLUG_MAX_LENGTH`.
 * 6. Not in `RESERVED_SLUGS`.
 * 7. Not present in `existingSlugs` (case-insensitive comparison).
 *
 * @param slug          - The slug string to validate.
 * @param existingSlugs - Collection of slugs already in use.
 * @returns `true` if the slug passes all constraints; `false` otherwise.
 *
 * @example
 * isSlugValid("my-agent", ["other-agent"]) // → true
 * isSlugValid("admin", [])                 // → false (reserved)
 * isSlugValid("my-agent", ["my-agent"])    // → false (duplicate)
 */
export function isSlugValid(
  slug: string,
  existingSlugs: readonly string[],
): boolean {
  // Format check
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length < 2) {
    return false;
  }
  // Allow single-char slugs to fail length check (min 2)
  if (slug.length < SLUG_MIN_LENGTH) return false;
  if (slug.length > SLUG_MAX_LENGTH) return false;

  // Only [a-z0-9-] allowed
  if (!/^[a-z0-9-]+$/.test(slug)) return false;

  // No leading/trailing hyphens
  if (slug.startsWith("-") || slug.endsWith("-")) return false;

  // No consecutive hyphens
  if (/--/.test(slug)) return false;

  // Reserved check
  if (RESERVED_SLUGS.has(slug)) return false;

  // Uniqueness check (case-insensitive, just in case)
  const lower = slug.toLowerCase();
  if (existingSlugs.some((s) => s.toLowerCase() === lower)) return false;

  return true;
}

// ── Full pipeline ─────────────────────────────────────────────────────────

/**
 * Converts a human-readable `input` string into a valid, unique slug.
 *
 * Pipeline:
 * 1. Normalise via `toSlug()`.
 * 2. If the result is empty or too short, fall back to `"agent"`.
 * 3. If the result is reserved or already exists in `existingSlugs`, append
 *    an incremental numeric suffix (`-2`, `-3`, …) until a free slot is found.
 *
 * **This is the main function consumers should use.**
 *
 * @param input         - Raw user-supplied name (e.g. `"Mi Agente!"`)
 * @param existingSlugs - Slugs already in use (from existing agents).
 * @returns A slug string that is guaranteed to be valid and unique.
 *
 * @example
 * slugify("Mi Agente!")            // → "mi-agente"
 * slugify("Mi Agente!", ["mi-agente"]) // → "mi-agente-2"
 * slugify("admin", [])             // → "admin-2"
 * slugify("!!!",   [])             // → "agent"
 */
export function slugify(
  input: string,
  existingSlugs: readonly string[] = [],
): string {
  let base = toSlug(input);

  // Agent slugs must not contain underscores (isSlugValid only allows [a-z0-9-]).
  // toSlug() preserves '_' for project-path use, so we normalise them here.
  base = base.replace(/_+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");

  // Fallback when the entire input collapses to nothing meaningful
  if (base.length < SLUG_MIN_LENGTH) {
    base = "agent";
  }

  // If the base slug is itself valid and unique, return it immediately
  if (isSlugValid(base, existingSlugs)) {
    return base;
  }

  // Collision / reserved → find next free suffix
  let counter = 2;
  while (true) {
    const candidate = `${base}-${counter}`;
    if (isSlugValid(candidate, existingSlugs)) {
      return candidate;
    }
    counter++;

    // Safety valve: extremely unlikely but prevents an infinite loop if
    // existingSlugs is astronomically large.
    if (counter > 10_000) {
      // Return a UUID-based slug as last resort
      return `agent-${Math.random().toString(36).slice(2, 10)}`;
    }
  }
}
