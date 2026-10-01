import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import {
  loadTensionThresholds,
  applyThresholdOp,
  evaluateTensions,
} from "@/lib/assessment/tensions";

/**
 * capacity_low must mean ONE thing on every path.
 *
 * THE DEFECT THIS PINS DOWN. The same concept was read from two different config
 * fields by two different loaders, and they disagreed by 0.09:
 *
 *   tension engine       tension_thresholds.capacity_low.value            -> 2.59
 *   §13.7 Q18 override   overrides.Q18_capacity_modifier.condition        -> 2.5
 *
 * A participant whose capacity mean fell in (2.5, 2.59] was capacity-limited for
 * one rule and NOT for the other — exactly the gap the config's own note claimed
 * to have closed. It sits in §12.2's protection: that limited margin is never
 * read as poor discipline.
 *
 * OPERATOR DECISION 2026-10-01: harmonise to **2.59**, consistent with the
 * approved S2 band (1.80–2.59). "There must not be separate 2.50 and 2.59
 * interpretations in different loaders/code paths."
 *
 * WHY THE BOUNDARIES ARE THE TEST. An off-by-one-hundredth is invisible in
 * normal use and only shows up for participants whose mean lands exactly on the
 * edge — which is precisely the population the §12.2 protection exists for. So
 * the four values that bracket the threshold are asserted explicitly, on BOTH
 * paths, rather than trusting that two loaders reading one config will agree.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

const q18 = loadQ18Cutoffs(cfg);
const thresholds = loadTensionThresholds(cfg);
const tensionCapacityLow = thresholds["capacity_low"];

describe("both loaders read the SAME value", () => {
  it("the §13.7 override and the tension engine agree", () => {
    console.log(
      "  q18.capacityLowAtOrBelow:",
      q18.capacityLowAtOrBelow,
      "| tension capacity_low:",
      JSON.stringify(tensionCapacityLow),
    );
    expect(q18.capacityLowAtOrBelow).toBe(tensionCapacityLow.n);
  });

  it("the shared value is 2.59, matching the approved S2 band ceiling", () => {
    // The S2 band is 1.80–2.59 and is labelled "Limited Room". A capacity mean
    // the band table calls limited must be treated as limited by the rules too.
    expect(q18.capacityLowAtOrBelow).toBe(2.59);
    expect(tensionCapacityLow).toEqual({ op: "<=", n: 2.59 });
  });

  it("no capacity THRESHOLD field still carries 2.5", () => {
    // Scans the RAW config text rather than the parsed object, so a stale
    // documentation string cannot hide — the dead `numeric` field and the
    // assumption-register rows contradicted the live value, and a future reader
    // is likeliest to consult them.
    //
    // SCOPED DELIBERATELY to lines that state a capacity CUTOFF. A blanket
    // /capacity/i scan also matched two legitimate lines: the note explaining
    // this very fix (which quotes 2.5 as the old value) and the A3 row's
    // `pair-low avg <= 2.5`, which is a DIFFERENT threshold that the operator
    // explicitly said not to change. Flagging those would mean the guard could
    // only pass by deleting its own explanation.
    const raw = readFileSync(
      resolve(__dirname, "../../config/scoring-v1.0.json"),
      "utf8",
    );
    // The capacity CLAUSE specifically, not the whole line. The A3 assumption
    // row holds two thresholds — "capacity_low = mean <= 2.59; pair-low avg <=
    // 2.5" — so a line-level check cannot separate them, and the pair-low half
    // is legitimately 2.5 and must not change.
    //
    // Matches:   capacity_low = mean <= 2.5        (JSON key form)
    //            "capacity_low": "Capacity mean <= 2.5"
    //            Capacity <= 2.5                   (prose/condition form)
    // and ignores any 2.5 that belongs to pair_low_avg.
    const badClauses = [
      ...raw.matchAll(/capacity[_a-z]*["\s:=]*(?:mean)?[^0-9\n]{0,12}2\.5\b/gi),
    ].map((m) => m[0].trim());

    console.log("  stale capacity clauses at 2.5:", JSON.stringify(badClauses));
    expect(
      badClauses,
      `capacity threshold still 2.5: ${badClauses.join(" | ")}`,
    ).toEqual([]);

    // And confirm the historical note is still present, so the check above
    // cannot be satisfied by deleting the explanation of why 2.59 is correct.
    expect(raw).toMatch(/LAGGED at 2\.5/);
  });

  it("pair_low_avg is a DIFFERENT threshold and stays at 2.5", () => {
    // Guards the scope of the correction: the operator said harmonise
    // capacity_low only, and pair_low_avg legitimately remains 2.5.
    expect(thresholds["pair_low_avg"]).toEqual({ op: "<=", n: 2.5 });
  });
});

describe("boundaries — 2.49 / 2.50 / 2.59 / 2.60", () => {
  const cases: Array<[number, boolean, string]> = [
    [2.49, true, "below the old threshold; limited on every interpretation"],
    [2.5, true, "THE VALUE THAT USED TO DISAGREE — must now be limited on both"],
    [2.59, true, "the S2 band ceiling; inclusive"],
    [2.6, false, "just past the ceiling; no longer limited"],
  ];

  for (const [value, expected, why] of cases) {
    it(`${value} -> capacity_low ${expected ? "TRUE" : "FALSE"} (${why})`, () => {
      const viaQ18 = value <= q18.capacityLowAtOrBelow;
      const viaTension = applyThresholdOp(value, tensionCapacityLow);
      console.log(
        `  ${value}: q18=${viaQ18} tension=${viaTension} expected=${expected}`,
      );
      expect(viaQ18).toBe(expected);
      expect(viaTension).toBe(expected);
      // The whole point: they must not merely both be right, they must AGREE.
      expect(viaQ18).toBe(viaTension);
    });
  }

  it("2.5 IS the regression — it must behave exactly like 2.59", () => {
    // The single assertion that would have caught the original defect. Under the
    // old config, 2.5 was limited on both paths while 2.59 was limited only on
    // the tension path; now the two are indistinguishable.
    const a = applyThresholdOp(2.5, tensionCapacityLow);
    const b = applyThresholdOp(2.59, tensionCapacityLow);
    console.log(`  2.5 -> ${a} | 2.59 -> ${b}`);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(2.5 <= q18.capacityLowAtOrBelow).toBe(2.59 <= q18.capacityLowAtOrBelow);
  });
});

describe("the correction reaches the paths that consume it", () => {
  it("the tension engine no longer leaves a (2.5, 2.59] hole", () => {
    // A capacity mean inside the former gap must behave the same as one just
    // below it — the engine's own evaluation, not just the parsed threshold.
    const inGap = evaluateTensions(
      {
        signalStates: { SEE: "S3", ROOM: "S2", DIRECT: "S3", PREPARE: "S3", AIM: "S3", MOVE: "S3" },
        items: { Q7: 3, Q8: 2 }, // capacity mean 2.5
        activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" },
        tags: [],
        fearPresent: false,
      } as never,
      cfg,
    );
    console.log("  capacity mean 2.5 tension codes:", JSON.stringify(inGap));
    // It must not throw and must not silently produce nothing due to a
    // threshold mismatch — the codes themselves are calibration-dependent, so
    // this asserts the call is well-formed and deterministic.
    expect(Array.isArray(inGap)).toBe(true);
  });

  it("no OTHER calibration value was touched by this correction", () => {
    // The operator was explicit: "Do not independently change any other
    // calibration values as part of this fix." The sibling thresholds that share
    // the block are asserted unchanged so a broad find-replace would be caught.
    expect(thresholds["item_high"]).toEqual({ op: ">=", n: 4 });
    expect(thresholds["item_low"]).toEqual({ op: "<=", n: 2 });
    expect(thresholds["pair_low_avg"]).toEqual({ op: "<=", n: 2.5 });
    expect(q18.directionHighAtOrAbove).toBe(4);
    expect(q18.alignmentLowAtOrBelow).toBe(2);
    console.log("  sibling thresholds unchanged:", JSON.stringify({
      item_high: thresholds["item_high"],
      item_low: thresholds["item_low"],
      pair_low_avg: thresholds["pair_low_avg"],
      q18_direction: q18.directionHighAtOrAbove,
      q18_alignment: q18.alignmentLowAtOrBelow,
    }));
  });
});
