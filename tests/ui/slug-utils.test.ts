/**
 * tests/ui/slug-utils.test.ts
 *
 * Unit tests for src/ui/utils/slugUtils.ts
 *
 * Covers:
 *   - toSlug()      — character normalisation pipeline
 *   - isSlugValid() — all validation constraints
 *   - slugify()     — full pipeline including conflict resolution
 *
 * Test runner: bun:test
 */

import { describe, it, expect } from "bun:test";
import {
  toSlug,
  isSlugValid,
  slugify,
  RESERVED_SLUGS,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
} from "../../src/ui/utils/slugUtils.ts";

// ── toSlug — basic transformations ────────────────────────────────────────

describe("toSlug — basic transformations", () => {
  it("lowercases the input", () => {
    expect(toSlug("MyAgent")).toBe("myagent");
  });

  it("replaces spaces with hyphens", () => {
    expect(toSlug("my agent")).toBe("my-agent");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(toSlug("my   agent")).toBe("my-agent");
  });

  it("strips leading and trailing hyphens", () => {
    expect(toSlug("  hello  ")).toBe("hello");
  });

  it("preserves underscores (hyphens and underscores are kept as-is)", () => {
    expect(toSlug("my_agent")).toBe("my_agent");
    expect(toSlug("puro_traqueteo")).toBe("puro_traqueteo");
    expect(toSlug("puro-traqueteo")).toBe("puro-traqueteo");
  });

  it("replaces dots with hyphens", () => {
    expect(toSlug("my.agent")).toBe("my-agent");
  });

  it("collapses consecutive hyphens from mixed separators", () => {
    expect(toSlug("my---agent")).toBe("my-agent");
    // spaces become hyphens; underscore is preserved, so "my _ agent" → "my-_-agent" → "my-_-agent"
    // (the spaces become hyphens, underscore stays, consecutive hyphens collapse)
    expect(toSlug("my _ agent")).toBe("my-_-agent");
  });

  it("removes characters outside [a-z0-9-] after normalisation", () => {
    expect(toSlug("hello!@#world")).toBe("hello-world");
  });

  it("preserves digits", () => {
    expect(toSlug("agent42")).toBe("agent42");
    expect(toSlug("Agent 3000")).toBe("agent-3000");
  });

  it("returns empty string for all-special input", () => {
    expect(toSlug("!!!")).toBe("");
    expect(toSlug("@@@")).toBe("");
  });

  it("truncates at SLUG_MAX_LENGTH characters", () => {
    const longInput = "a".repeat(SLUG_MAX_LENGTH + 10);
    const result = toSlug(longInput);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});

// ── toSlug — accent / diacritic stripping ─────────────────────────────────

describe("toSlug — accent and diacritic stripping", () => {
  it("strips acute accents (á é í ó ú)", () => {
    expect(toSlug("áéíóú")).toBe("aeiou");
  });

  it("strips grave accents (à è ì ò ù)", () => {
    expect(toSlug("àèìòù")).toBe("aeiou");
  });

  it("strips umlaut (ä ë ï ö ü)", () => {
    expect(toSlug("äëïöü")).toBe("aeiou");
  });

  it("strips tilde on ã and õ", () => {
    expect(toSlug("ã")).toBe("a");
    expect(toSlug("õ")).toBe("o");
  });

  it("handles ñ → n", () => {
    // ñ NFD = n + combining tilde → n after mark removal
    expect(toSlug("mañana")).toBe("manana");
  });

  it("handles ç → c", () => {
    expect(toSlug("façade")).toBe("facade");
  });

  it("transliterates ß → ss", () => {
    expect(toSlug("straße")).toBe("strasse");
  });

  it("transliterates œ → oe and æ → ae", () => {
    expect(toSlug("œuvre")).toBe("oeuvre");
    expect(toSlug("æsthetic")).toBe("aesthetic");
  });

  it("transliterates ø → o", () => {
    expect(toSlug("søren")).toBe("soren");
  });

  it("handles a complex accented name", () => {
    expect(toSlug("Agënte Ñúmero 1")).toBe("agente-numero-1");
  });

  it("handles mixed accents and special chars", () => {
    // "Ágente Böt!" → "agente-bot"
    expect(toSlug("Ágente Böt!")).toBe("agente-bot");
  });
});

// ── isSlugValid — format constraints ──────────────────────────────────────

describe("isSlugValid — format constraints", () => {
  it("accepts a well-formed slug", () => {
    expect(isSlugValid("my-agent", [])).toBe(true);
  });

  it("accepts a slug with only lowercase letters", () => {
    expect(isSlugValid("hello", [])).toBe(true);
  });

  it("accepts a slug with digits", () => {
    expect(isSlugValid("agent42", [])).toBe(true);
    expect(isSlugValid("agent-42", [])).toBe(true);
  });

  it("rejects a slug shorter than SLUG_MIN_LENGTH", () => {
    expect(isSlugValid("a", [])).toBe(false);
  });

  it(`accepts a slug of exactly ${SLUG_MIN_LENGTH} characters`, () => {
    expect(isSlugValid("ab", [])).toBe(true);
  });

  it(`rejects a slug longer than ${SLUG_MAX_LENGTH} characters`, () => {
    const longSlug = "a".repeat(SLUG_MAX_LENGTH + 1);
    expect(isSlugValid(longSlug, [])).toBe(false);
  });

  it(`accepts a slug of exactly ${SLUG_MAX_LENGTH} characters`, () => {
    const maxSlug = "a".repeat(SLUG_MAX_LENGTH);
    expect(isSlugValid(maxSlug, [])).toBe(true);
  });

  it("rejects a slug with uppercase letters", () => {
    expect(isSlugValid("MyAgent", [])).toBe(false);
  });

  it("rejects a slug with spaces", () => {
    expect(isSlugValid("my agent", [])).toBe(false);
  });

  it("rejects a slug with underscores", () => {
    expect(isSlugValid("my_agent", [])).toBe(false);
  });

  it("rejects a slug with leading hyphen", () => {
    expect(isSlugValid("-my-agent", [])).toBe(false);
  });

  it("rejects a slug with trailing hyphen", () => {
    expect(isSlugValid("my-agent-", [])).toBe(false);
  });

  it("rejects a slug with consecutive hyphens", () => {
    expect(isSlugValid("my--agent", [])).toBe(false);
  });

  it("rejects a slug with accented characters", () => {
    expect(isSlugValid("agënte", [])).toBe(false);
  });

  it("rejects a slug with special characters", () => {
    expect(isSlugValid("my!agent", [])).toBe(false);
  });
});

// ── isSlugValid — reserved words ──────────────────────────────────────────

describe("isSlugValid — reserved words", () => {
  for (const reserved of RESERVED_SLUGS) {
    it(`rejects the reserved slug "${reserved}"`, () => {
      expect(isSlugValid(reserved, [])).toBe(false);
    });
  }

  it("accepts a slug that STARTS WITH a reserved word (not exact match)", () => {
    expect(isSlugValid("admin-bot", [])).toBe(true);
  });

  it("accepts a slug that ENDS WITH a reserved word segment", () => {
    expect(isSlugValid("my-admin", [])).toBe(true);
  });
});

// ── isSlugValid — uniqueness ───────────────────────────────────────────────

describe("isSlugValid — uniqueness", () => {
  it("rejects a slug already in existingSlugs", () => {
    expect(isSlugValid("my-agent", ["my-agent"])).toBe(false);
  });

  it("accepts a slug not in existingSlugs", () => {
    expect(isSlugValid("my-agent", ["other-agent"])).toBe(true);
  });

  it("uniqueness check is case-insensitive", () => {
    // Slugs should always be lowercase, but defensive check
    expect(isSlugValid("my-agent", ["My-Agent"])).toBe(false);
  });

  it("accepts an empty existingSlugs array", () => {
    expect(isSlugValid("valid-slug", [])).toBe(true);
  });
});

// ── slugify — basic pipeline ───────────────────────────────────────────────

describe("slugify — basic pipeline", () => {
  it("returns a slug from a simple name", () => {
    expect(slugify("My Agent")).toBe("my-agent");
  });

  it("returns a slug from an accented name", () => {
    expect(slugify("Agente Número 1")).toBe("agente-numero-1");
  });

  it("returns a slug from a name with special chars", () => {
    expect(slugify("Mi Agente! #2")).toBe("mi-agente-2");
  });

  it("falls back to 'agent' when input produces empty slug", () => {
    expect(slugify("!!!")).toBe("agent");
    expect(slugify("")).toBe("agent");
    expect(slugify("@")).toBe("agent");
  });

  it("falls back to 'agent' when input is too short after normalisation", () => {
    // Single character slugs are too short (min 2)
    expect(slugify("a")).toBe("agent");
  });

  it("returns the slug unchanged when no conflicts", () => {
    expect(slugify("code-bot", [])).toBe("code-bot");
  });

  it("uses the existing slug list to avoid conflicts", () => {
    const result = slugify("code-bot", ["code-bot"]);
    expect(result).toBe("code-bot-2");
  });
});

// ── slugify — conflict / suffix resolution ────────────────────────────────

describe("slugify — conflict resolution with numeric suffix", () => {
  it("appends -2 on first conflict", () => {
    expect(slugify("my-agent", ["my-agent"])).toBe("my-agent-2");
  });

  it("appends -3 when -2 is also taken", () => {
    expect(slugify("my-agent", ["my-agent", "my-agent-2"])).toBe("my-agent-3");
  });

  it("appends -4 when -2 and -3 are taken", () => {
    const existing = ["my-agent", "my-agent-2", "my-agent-3"];
    expect(slugify("my-agent", existing)).toBe("my-agent-4");
  });

  it("skips over a large range of taken suffixes", () => {
    const existing = [
      "bot",
      ...Array.from({ length: 8 }, (_, i) => `bot-${i + 2}`),
    ];
    // "bot", "bot-2" … "bot-9" taken → expects "bot-10"
    expect(slugify("bot", existing)).toBe("bot-10");
  });

  it("resolves conflict when base is reserved and the suffixed form is free", () => {
    // "admin" is reserved; "admin-2" should be free
    expect(slugify("admin", [])).toBe("admin-2");
  });

  it("resolves conflict when base and -2 are reserved/taken", () => {
    // "system" reserved, "system-2" taken → "system-3"
    expect(slugify("system", ["system-2"])).toBe("system-3");
  });

  it("resolves conflict when 'new-agent' is input and it is reserved", () => {
    expect(slugify("new agent", [])).toBe("new-agent-2");
  });
});

// ── slugify — complex / real-world names ──────────────────────────────────

describe("slugify — complex real-world names", () => {
  it("handles a fully Portuguese name with accents", () => {
    expect(slugify("Agente de Suporte Técnico")).toBe("agente-de-suporte-tecnico");
  });

  it("handles a German name with ß and umlauts", () => {
    expect(slugify("Büro-Assistent")).toBe("buro-assistent");
    expect(slugify("Straßen-Bot")).toBe("strassen-bot");
  });

  it("handles a French name with accents and ligature", () => {
    expect(slugify("Système d'Information")).toBe("systeme-d-information");
  });

  it("handles emoji in input (strips them)", () => {
    expect(slugify("Agent 🤖 Pro")).toBe("agent-pro");
  });

  it("handles leading/trailing spaces", () => {
    expect(slugify("  my agent  ")).toBe("my-agent");
  });

  it("handles all-caps input", () => {
    expect(slugify("ORCHESTRATOR")).toBe("orchestrator");
  });

  it("handles mixed separators (dots, underscores, spaces)", () => {
    expect(slugify("my.agent_bot pro")).toBe("my-agent-bot-pro");
  });

  it("handles numeric-only input", () => {
    expect(slugify("42")).toBe("42");
  });

  it("handles a very long name — truncates to SLUG_MAX_LENGTH", () => {
    const longName = "very long agent name that exceeds the maximum allowed slug length for the system";
    const result = slugify(longName);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(isSlugValid(result, [])).toBe(true);
  });

  it("handles conflict on a truncated slug", () => {
    const longName = "very long agent name that exceeds the maximum allowed slug length for the system";
    const base = toSlug(longName);
    const result = slugify(longName, [base]);
    expect(result).not.toBe(base);
    expect(isSlugValid(result, [base])).toBe(true);
  });
});

// ── Roundtrip invariants ──────────────────────────────────────────────────

describe("slugify — output is always a valid slug", () => {
  const cases: [string, string[]][] = [
    ["Hello World", []],
    ["Agente Número 1", []],
    ["admin", []],
    ["System Bot", ["system-bot"]],
    ["!!!", []],
    ["  ", []],
    ["Ágënte Böt!", ["agente-bot"]],
    ["new agent", []],
    ["a", []],
    ["æsthetic-bot", []],
  ];

  for (const [input, existing] of cases) {
    it(`slugify(${JSON.stringify(input)}, ${JSON.stringify(existing)}) produces a valid slug`, () => {
      const result = slugify(input, existing);
      // Must satisfy all format constraints
      expect(result.length).toBeGreaterThanOrEqual(SLUG_MIN_LENGTH);
      expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      expect(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(result) || /^[a-z0-9]{2}$/.test(result)).toBe(true);
      expect(result).not.toMatch(/--/);
      expect(result.startsWith("-")).toBe(false);
      expect(result.endsWith("-")).toBe(false);
      // Must not be in existingSlugs
      expect(existing.includes(result)).toBe(false);
    });
  }
});
