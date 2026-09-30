import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANGUAGE_OPENERS } from "@/lib/assessment/narratives";

/**
 * Evidence-confidence contract — the type, the database and the approved
 * library must all agree.
 *
 * WHY THIS TEST EXISTS.
 *
 * `EvidenceConfidence` was originally derived as
 * `keyof typeof narratives.language_strength`, which is UPPERCASE
 * ("HIGH" | "MODERATE" | "LIMITED"). The library stores those tiers under
 * uppercase keys, so the derivation looked natural and compiled cleanly.
 *
 * But the value that actually gets PERSISTED is written to
 * `computed_signals.evidence_confidence`, whose CHECK constraint accepts only
 * lowercase ('high','moderate','limited'). So the engine's type disagreed with
 * the schema it writes into — a defect invisible to both tsc and the test
 * suite, because Vitest transpiles without typechecking.
 *
 * A later "fix" resolved the compile error by changing the ENGINE to uppercase
 * instead — making tsc green while leaving the contract still wrong. That is
 * the failure this test is designed to make impossible: it asserts the casing
 * against the schema itself, so satisfying the compiler is not enough.
 */

const repo = resolve(__dirname, "../..");

const schema = readFileSync(
  resolve(repo, "supabase/migrations/20260930000001_initial_schema.sql"),
  "utf8",
);

const narratives = JSON.parse(
  readFileSync(resolve(repo, "config/narratives-v1.0.json"), "utf8"),
) as { language_strength: Record<string, string> };

/** The values the DB CHECK constraint actually permits. */
function dbAllowedValues(): string[] {
  const m = schema.match(/evidence_confidence IN \(([^)]*)\)/);
  if (!m) throw new Error("could not find the evidence_confidence CHECK constraint");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

describe("evidence_confidence contract (schema ↔ engine ↔ library)", () => {
  it("persists the same casing the database CHECK constraint permits", () => {
    const allowed = dbAllowedValues();
    // The schema is the authority: lowercase.
    expect(allowed).toEqual(["high", "moderate", "limited"]);

    const engineValues = Object.keys(LANGUAGE_OPENERS);
    for (const v of engineValues) {
      expect(allowed, `engine value "${v}" must be writable to the column`).toContain(v);
    }
    expect(new Set(engineValues)).toEqual(new Set(allowed));
  });

  it("keeps the library's uppercase keys as the only casing difference", () => {
    // The library keys are the uppercase form of the persisted values — no
    // third casing, no synonyms.
    const allowed = dbAllowedValues();
    expect(Object.keys(narratives.language_strength).sort()).toEqual(
      allowed.map((v) => v.toUpperCase()).sort(),
    );
  });

  it("carries the approved PRD §19.1 openers verbatim", () => {
    // Pinned against the library so a retyped string cannot drift.
    expect(LANGUAGE_OPENERS.high).toBe(narratives.language_strength.HIGH);
    expect(LANGUAGE_OPENERS.moderate).toBe(narratives.language_strength.MODERATE);
    expect(LANGUAGE_OPENERS.limited).toBe(narratives.language_strength.LIMITED);

    // And the literal approved strings themselves (PRD §19.1).
    expect(LANGUAGE_OPENERS.high).toBe("Your responses show…");
    expect(LANGUAGE_OPENERS.moderate).toBe("Your responses suggest…");
    expect(LANGUAGE_OPENERS.limited).toBe("One possibility worth examining is…");
  });
});
