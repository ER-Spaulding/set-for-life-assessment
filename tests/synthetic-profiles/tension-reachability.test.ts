import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTensions } from "@/lib/assessment/tensions";

/**
 * Tension reachability — PRD §15, §18.3.
 *
 * A tension rule that can never fire is dead config: the connection statement
 * it feeds would never reach a participant, and nothing would report the loss.
 * Conversely a rule that fires when it should not puts unsupported copy in
 * front of someone.
 *
 * This sweeps the 18 approved codes and asserts each one is REACHABLE from
 * some legal input — with the two documented exceptions below, which are
 * selected outside the tension evaluator.
 *
 * Note on method: an earlier broad sweep (all signals uniform, all items set
 * to 3) reached only 7 of 18. That was a defect in the SWEEP, not the engine —
 * most tensions are item-driven and need distinct per-item values. The probes
 * below therefore target each code explicitly.
 */

const scoring = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;
const ITEMS = Array.from({ length: 25 }, (_, i) => `Q${i + 1}`);

const approvedCodes: string[] = Object.keys(scoring.tensions).filter(
  (k) => !k.startsWith("_"),
);

interface Probe {
  signalStates?: Record<string, string>;
  items?: Record<string, number>;
  tags?: string[];
  fearPresent?: boolean;
  activation?: Record<string, string>;
}

const evaluate = (p: Probe): string[] =>
  evaluateTensions({
    signalStates: Object.fromEntries(
      SIGNALS.map((s) => [s, p.signalStates?.[s] ?? "S3"]),
    ) as never,
    items: { ...Object.fromEntries(ITEMS.map((q) => [q, 3])), ...p.items },
    activation: (p.activation ?? { A1: "MID", A2: "MID", A3: "MID", A4: "MID" }) as never,
    tags: p.tags ?? [],
    fearPresent: p.fearPresent ?? false,
  } as never);

/** One legal input per code that must trigger it. */
const REACHABLE_BY: Record<string, Probe> = {
  HIGH_ACTIVITY_LOW_DIRECTION: { signalStates: { DIRECT: "S5", AIM: "S1" } },
  HIGH_INFORMATION_LOW_ACTION: { items: { Q23: 5, Q24: 5, Q25: 1 } },
  INFORMATION_ANALYSIS_BOTTLENECK: { items: { Q23: 5, Q24: 1, Q25: 1 } },
  INFORMATION_EXECUTION_BOTTLENECK: { items: { Q23: 5, Q24: 5, Q25: 1 } },
  INFORMATION_OVERLOAD_PATTERN: { items: { Q23: 1, Q24: 1, Q25: 1 } },
  HIGH_VISIBILITY_LOW_CAPACITY: { signalStates: { SEE: "S5", ROOM: "S1" } },
  LOW_VISIBILITY_HIGH_CAPACITY: { signalStates: { SEE: "S1", ROOM: "S5" } },
  HIGH_DIRECTION_LOW_CAPACITY: { signalStates: { AIM: "S5", ROOM: "S1" } },
  // fearPresent is a distinct INPUT to the evaluator, not a derived tag — it
  // mirrors the Q21 fear classifier, where every option except exclusive
  // Q21_G counts as fear present.
  HIGH_FEAR_HIGH_ACTIVATION: {
    fearPresent: true,
    activation: { A1: "HIGH", A2: "MID", A3: "MID", A4: "MID" },
  },
  SUPPORT_OPENNESS_AGENCY_VULNERABILITY: {
    items: { Q22: 1 },
    activation: { A1: "MID", A2: "MID", A3: "MID", A4: "HIGH" },
  },
  HEALTHY_PRIVACY_BOUNDARY: { items: { Q20: 1, Q6: 5, Q22: 5 } },
  PRIVACY_AVOIDANCE_FRICTION: { items: { Q20: 1, Q6: 1 }, tags: ["TRUTH_AVOIDANCE"] },
  HIGH_CONFIDENCE_LOW_VISIBILITY: { items: { Q24: 5, Q4: 1, Q5: 2 } },
  PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE: { items: { Q14: 5, Q13: 1, Q15: 2 } },
  BIG_PICTURE_CASHFLOW_GAP: { items: { Q4: 5, Q5: 1 } },
  DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED: { items: { Q17: 5, Q19: 1 } },
};

/**
 * Codes selected OUTSIDE the tension list. Both are legitimate:
 *  - NO_MEANINGFUL_FRICTION_IDENTIFIED is the null finding (§18.3), returned by
 *    the evaluator when nothing triggers and no contextual friction holds.
 *  - CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT carries a `trigger_ref`
 *    into the Q18 modifier, so it is driven by the override path (§13.7).
 */
const SELECTED_ELSEWHERE = [
  "NO_MEANINGFUL_FRICTION_IDENTIFIED",
  "CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT",
];

describe("PRD §15 — every approved tension is reachable", () => {
  it("covers all 18 approved codes (none silently dropped)", () => {
    expect(approvedCodes).toHaveLength(18);
    const covered = [...Object.keys(REACHABLE_BY), ...SELECTED_ELSEWHERE].sort();
    expect(covered).toEqual([...approvedCodes].sort());
  });

  it.each(Object.keys(REACHABLE_BY))("%s is reachable", (code) => {
    const out = evaluate(REACHABLE_BY[code]);
    expect(out, `${code} should fire for its probe`).toContain(code);
  });
});

describe("PRD §18.3 — the null finding", () => {
  it("is returned when nothing triggers and there is no contextual friction", () => {
    const out = evaluate({});
    expect(out).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
  });

  it("never invents a weakness — an untouched profile yields no friction code", () => {
    const out = evaluate({});
    const frictionCodes = out.filter((c) => c !== "NO_MEANINGFUL_FRICTION_IDENTIFIED");
    expect(frictionCodes).toEqual([]);
  });

  it("fear present suppresses the null finding", () => {
    // Meaningful contextual friction means the null finding does not apply —
    // but the engine still must not manufacture a *different* weakness.
    const out = evaluate({ fearPresent: true });
    expect(out).not.toContain("NO_MEANINGFUL_FRICTION_IDENTIFIED");
  });
});

describe("PRD §15 — only approved codes are ever emitted", () => {
  it("emits nothing outside the 18-code union across the probe set", () => {
    const approved = new Set(approvedCodes);
    for (const probe of Object.values(REACHABLE_BY)) {
      for (const code of evaluate(probe)) {
        expect(approved.has(code), `emitted unapproved code "${code}"`).toBe(true);
      }
    }
  });
});
