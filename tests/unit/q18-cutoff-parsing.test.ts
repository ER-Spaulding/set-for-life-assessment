import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { loadTensionThresholds } from "@/lib/assessment/tensions";

/**
 * Q18 capacity-modifier cutoff parsing — PRD §13.7.
 *
 * THE BUG THIS GUARDS AGAINST.
 *
 * The §13.7 condition strings embed question IDs alongside their thresholds:
 *
 *     "direction_clarity_high": "mean(Q17, Q19) >= 4.0"
 *     "alignment_low":          "Q18 <= 2"
 *     "capacity_low":           "Capacity mean <= 2.5"
 *
 * A first-match number regex reads that first string as `17` (the Q of "Q17"),
 * not `4.0`. The engine would then require direction clarity >= 17 on a 1–5
 * scale — a condition that can never be satisfied — silently disabling the
 * capacity-constrained-alignment path (§13.7) and the
 * CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT connection statement.
 *
 * Nothing would crash. No type error. The signal would simply never fire, and
 * participants whose real pattern is "clear destination, no margin" would be
 * told something else. Parsing the LAST number is correct because these
 * strings end with their threshold.
 */

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

describe("PRD §13.7 — Q18 modifier cutoffs load from config", () => {
  it("parses the threshold, not an embedded question id", () => {
    const cutoffs = loadQ18Cutoffs(scoringCfg);

    // If the FIRST-match-number bug regressed, this would read 17 (from "Q17").
    expect(cutoffs.directionHighAtOrAbove).toBe(4.0);
    expect(cutoffs.alignmentLowAtOrBelow).toBe(2);
    // 2.59 — harmonised 2026-10-01 with the tension engine's capacity_low and
    // with the approved S2 band ceiling (1.80-2.59). It read 2.5 here while the
    // tension engine used 2.59, leaving a (2.5, 2.59] gap where a participant
    // was capacity-limited for one rule and not the other.
    expect(cutoffs.capacityLowAtOrBelow).toBe(2.59);

    // The property that would have caught the original defect: this loader and
    // the tension engine must read the SAME number, not merely two defensible
    // ones. Boundaries are covered in tests/unit/capacity-low-boundary.test.ts.
    const tt = loadTensionThresholds(scoringCfg);
    expect(cutoffs.capacityLowAtOrBelow).toBe(tt["capacity_low"].n);
  });

  it("preserves decimal precision — never truncates a float cutoff", () => {
    // Guards a second, subtler bug: Number(m[0]) takes the first CHARACTER of
    // the matched string, so "2.59" would silently become 2 and "4.0" become 4.
    // Both would quietly loosen the §13.7 gates without any error surfacing.
    const c = loadQ18Cutoffs(scoringCfg);
    expect(c.capacityLowAtOrBelow).toBe(2.59);
    expect(c.capacityLowAtOrBelow).not.toBe(2);
    expect(Number.isInteger(c.capacityLowAtOrBelow)).toBe(false);
  });

  it("keeps every cutoff on the 1–5 scale", () => {
    // The signal scale is 1–5. A cutoff above 5 can never be met, so any
    // value outside the scale is proof of a parsing failure.
    const c = loadQ18Cutoffs(scoringCfg);
    for (const [name, value] of Object.entries(c)) {
      if (typeof value !== "number") continue;
      expect(value, `${name} must be <= 5`).toBeLessThanOrEqual(5);
      expect(value, `${name} must be >= 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it("reads the values from config rather than hard-coding them", () => {
    // PRD §15: thresholds are configuration. Perturb the config and confirm
    // the loader follows it — proving the numbers are not baked into code.
    const perturbed = JSON.parse(JSON.stringify(scoringCfg));
    perturbed.overrides.Q18_capacity_modifier.condition.direction_clarity_high =
      "mean(Q17, Q19) >= 3.3";
    const c = loadQ18Cutoffs(perturbed);
    expect(c.directionHighAtOrAbove).toBe(3.3);
  });
});
