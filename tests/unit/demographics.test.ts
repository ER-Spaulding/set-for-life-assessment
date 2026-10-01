import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Demographic guards (PRD §8; PRD §29 acceptance test 7).
 *
 * D1–D3 must each offer a "Prefer not to say" response, and demographics
 * must carry no scoring/classifier/signal weight. The no-weight test below
 * inspects the structure — item flags, option keys, and the scoring
 * classifier tag maps — and asserts the absence of any such plumbing rather
 * than assuming it.
 */
const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);
const scoring = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

describe("demographics (PRD §8, §29 test 7)", () => {
  it("covers D1–D4, each offering a 'Prefer not to say' option (PRD §8)", () => {
    // D4 = State/jurisdiction, added 2026-10-01 by operator decision and placed
    // in this step rather than the front door, a Money Moment, or the Snapshot
    // cover. It belongs here because this is where the other optional,
    // non-diagnostic profile questions live.
    expect(cfg.demographics.map((d: { internal_id: string }) => d.internal_id)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
    ]);
    for (const d of cfg.demographics) {
      const hasOptOut = d.options.some(
        (o: { label: string }) => o.label.toLowerCase() === "prefer not to say",
      );
      expect(hasOptOut).toBe(true);
    }
  });

  it("D4 is profile data with the same non-diagnostic shape as D1–D3", () => {
    // The State question must not quietly become a scored item. It is optional,
    // non-diagnostic, not required for completion, and feeds no construct — the
    // same contract every other item in this step honours.
    const d4 = cfg.demographics.find((d: { internal_id: string }) => d.internal_id === "D4");
    expect(d4, "D4 must exist").toBeTruthy();
    expect(d4.required).toBe(false);
    expect(d4.required_for_completion).toBe(false);
    expect(d4.diagnostic).toBe(false);
    expect(d4.internal_construct).toBeNull();
    expect(d4.feeds).toBeNull();
    expect(d4.scoring_behavior).toBe("no_diagnostic_effect");
    // Its jurisdiction options come from the controlled list, not a copy.
    expect(d4.options_source).toBe("jurisdictions");
  });

  it("carries no scoring/classifier/signal weight (PRD §8, §29 test 7)", () => {
    // Every option code the scoring engine classifies. No demographic
    // option code may appear here — that would feed diagnosis.
    // Skip metadata entries: `.classifiers` also carries `_prd_section` and
    // `_notes` (strings), which have no `.tags`. Only question blocks do.
    const classifiedCodes = new Set(
      Object.values(scoring.classifiers)
        .filter(
          (c): c is { tags: Record<string, string> } =>
            typeof c === "object" && c !== null && "tags" in c,
        )
        .flatMap((c) => Object.keys(c.tags)),
    );
    for (const d of cfg.demographics) {
      expect(d.diagnostic).toBe(false);
      expect(d.feeds).toBeNull();
      expect(d.internal_construct).toBeNull();
      expect(d.required_for_completion).toBe(false);
      for (const o of d.options) {
        // Options carry identity only: no score/value/tag/signal keys.
        for (const key of Object.keys(o)) {
          expect(["code", "label", "open_text"]).toContain(key);
        }
        expect(classifiedCodes.has(o.code)).toBe(false);
      }
    }
  });
});
