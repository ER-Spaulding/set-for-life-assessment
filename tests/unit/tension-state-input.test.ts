import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";

/**
 * The tension evaluator must be fed the S-LADDER state, never the display state.
 *
 * WHY THIS TEST EXISTS.
 *
 * `SignalScore` exposes two state fields with different jobs:
 *   - `state`        — "the S-ladder position of value (reference position even
 *                      when overridden)"
 *   - `displayState` — "the state consumers should RENDER", which becomes a
 *                      SpecialSignalState when a capacity rule applies.
 *
 * Every tension trigger matches S1–S5 only. Completion initially fed
 * `displayState` into the evaluator, so a signal carrying a special state
 * matched nothing — and, worse, the failure was silent and PARTIAL:
 *
 *   AIM=S1     -> ["HIGH_ACTIVITY_LOW_DIRECTION"]        (rule matches)
 *   AIM=S4/S5  -> ["NO_MEANINGFUL_FRICTION_IDENTIFIED"]  (null path)
 *   AIM=<special state> -> []                            (NOTHING renders)
 *
 * An empty array means "no friction section" — so a capacity-constrained
 * participant would have received a Snapshot with that section missing
 * entirely, rather than falling back to the null finding.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const tables = loadScoringTables(cfg);
const cutoffs = loadQ18Cutoffs(cfg);

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;
const midItems = () => {
  const items: Record<string, number> = {};
  for (let i = 1; i <= 25; i++) items[`Q${i}`] = 3;
  return items;
};

/**
 * Evaluate with AIM set to `aimState`, and — when `othersState` is given —
 * every other signal set to that state too.
 *
 * `othersState` exists because the null finding is no longer a function of one
 * signal: since the operator-approved Option 2 gate it needs corroborating S4+
 * evidence across the profile. Varying AIM alone can only ever produce one
 * corroborating signal, which is below the bar, so a caller wanting the null
 * outcome must say what the rest of the profile looks like.
 */
const evalWith = (aimState: string, items = midItems(), othersState = "S3") =>
  evaluateTensions(
    {
      signalStates: Object.fromEntries(
        SIGNALS.map((s) => [s, s === "AIM" ? aimState : othersState]),
      ) as never,
      items,
      activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" } as never,
      tags: [],
      fearPresent: false,
    } as never,
    cfg,
  );

describe("PRD §15 — tension rules match the S-ladder state", () => {
  it("produces the null finding when no rule matches and no friction is present", () => {
    // "No rule matched" must never surface as an EMPTY list, which would read
    // as "render no friction section" instead of "nothing to report".
    //
    // The profile must be CORROBORATED, not merely non-weak. Under the
    // operator-approved Option 2 gate (2026-10-01) the null finding needs all
    // six signals at S3+ AND enough of them at S4+. This helper previously
    // varied AIM alone, leaving the other five at S3 — one corroborating
    // signal, which is now correctly insufficient. `evalWith` takes the
    // corroborating states so the test can express the profile it means.
    expect(evalWith("S4", midItems(), "S4")).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
    expect(evalWith("S5", midItems(), "S5")).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
  });

  it("does NOT produce the null finding for a merely developing profile", () => {
    // All six at S3: nothing weak, nothing strong. The third outcome Option 2
    // introduced — and the reason "no rule matched" can no longer be assumed to
    // mean "nothing to report".
    expect(evalWith("S3")).toEqual([]);
  });

  it("demonstrates the defect this guards against: a special state matches nothing", () => {
    // A special state is not on the S-ladder, so a rule testing state_in
    // ["S4","S5"] cannot match it. This is why completion must pass `state`.
    // Asserted so that if the evaluator ever gains special-state handling, the
    // assumption behind the fix is revisited rather than silently changed.
    expect(evalWith("AIM_CAPACITY_CONSTRAINED_ALIGNMENT")).toEqual([]);
    expect(evalWith("DIRECT_CAPACITY_LIMITED")).toEqual([]);
  });
});

describe("PRD §13.7 / §15 — completion feeds the ladder state, not the display state", () => {
  it("a capacity-constrained profile still reaches a tension, not an empty set", () => {
    // Q17/Q19 strong, Q18 weak, Capacity weak -> AIM carries a SPECIAL display
    // state. The evaluator must still be given the ladder position so rules
    // can match.
    const base: Record<string, string> = {
      OPEN_A: "A", OPEN_B: "C", Q1: "A", Q2: "C", Q3: "C", Q4: "C", Q5: "C", Q6: "C",
      Q7: "C", Q8: "C", Q9: "K", Q10: "C", Q11: "C", Q12: "C", Q13: "C", Q14: "C",
      Q15: "C", Q16: "A", Q17: "C", Q18: "C", Q19: "C", Q20: "C", Q21: "H", Q22: "C",
      Q23: "C", Q24: "C", Q25: "C", A1: "C", A2: "C", A3: "C", A4: "C",
    };
    const scored = scoreAssessment(
      { ...base, Q17: "E", Q19: "E", Q18: "A", Q7: "A", Q8: "A" },
      tables,
      cutoffs,
    );

    // Precondition: this profile really does produce a special display state,
    // otherwise the test would pass for the wrong reason.
    expect(scored.signals.AIM.displayState).toBe(
      "AIM_CAPACITY_CONSTRAINED_ALIGNMENT",
    );
    expect(scored.signals.AIM.state).toMatch(/^S[1-5]$/);

    const items = midItems();
    items.Q17 = 5; items.Q19 = 5; items.Q18 = 1; items.Q7 = 1; items.Q8 = 1;

    const usingLadder = evaluateTensions(
      {
        signalStates: Object.fromEntries(
          SIGNALS.map((s) => [s, scored.signals[s].state ?? "S3"]),
        ) as never,
        items,
        activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" } as never,
        tags: [],
        fearPresent: false,
      } as never,
      cfg,
    );

    // The ladder state must yield a real finding — never the empty set the
    // display state produced.
    expect(usingLadder.length).toBeGreaterThan(0);
  });
});
