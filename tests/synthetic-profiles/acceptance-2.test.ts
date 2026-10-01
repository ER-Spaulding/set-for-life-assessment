import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import {
  loadQ18Cutoffs,
  evaluateQ18CapacityModifier,
} from "@/lib/assessment/overrides";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { selectAttentionArea } from "@/lib/assessment/interpretation";
import { buildEvidenceRecord } from "@/lib/assessment/evidence-chain";
import { tagsForSelection, isFearPresent } from "@/lib/assessment/classifiers";
import { loadQuestionBank } from "@/lib/assessment/questions";

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const assessmentCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);
const reportCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/report-v1.0.json"), "utf8"),
);
const seedText = readFileSync(
  resolve(__dirname, "../../supabase/seed/001_assessment_v1.sql"),
  "utf8",
);
const tables = loadScoringTables(scoringCfg);
const q18cutoffs = loadQ18Cutoffs(scoringCfg);
const S = "E",
  W = "A",
  M = "C";
// Same neutral 31-item profile as acceptance.test.ts: every answer mid-scale
// except the classifier singles (Q9 "K", Q21 "H" are single letters there).
const base: Record<string, string> = {
  OPEN_A: "A", OPEN_B: "C", Q1: "A", Q2: "C", Q3: "C", Q4: M, Q5: M, Q6: M,
  Q7: M, Q8: M, Q9: "K", Q10: M, Q11: "C", Q12: "C", Q13: M, Q14: M, Q15: M, Q16: "A",
  Q17: M, Q18: M, Q19: M, Q20: "C", Q21: "H", Q22: "C", Q23: M, Q24: M, Q25: M,
  A1: "C", A2: "C", A3: "C", A4: "C",
};
const run = (o: Record<string, string>) => scoreAssessment({ ...base, ...o }, tables);
const runC = (o: Record<string, string>) =>
  scoreAssessment({ ...base, ...o }, tables, q18cutoffs);

// Tension probe helper (same pattern as tension-reachability.test.ts:
// every signal S3, every item 3, unless overridden).
const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;
const ITEMS = Array.from({ length: 25 }, (_, i) => `Q${i + 1}`);
interface Probe {
  signalStates?: Record<string, string>;
  items?: Record<string, number>;
  tags?: string[];
  fearPresent?: boolean;
  activation?: Record<string, string>;
}
const probeTensions = (p: Probe): string[] =>
  evaluateTensions({
    signalStates: Object.fromEntries(
      SIGNALS.map((s) => [s, p.signalStates?.[s] ?? "S3"]),
    ) as never,
    items: { ...Object.fromEntries(ITEMS.map((q) => [q, 3])), ...p.items },
    activation: (p.activation ?? { A1: "MID", A2: "MID", A3: "MID", A4: "MID" }) as never,
    tags: p.tags ?? [],
    fearPresent: p.fearPresent ?? false,
  } as never);

/**
 * PRD §29 acceptance tests, second batch (tests 11–14, 16, 18).
 *
 * NOTE on PRD §29 Test 17 (server authority): covered in the sibling file
 * acceptance-17-server-authority.test.ts, now that lib/session/service.ts
 * exists. It is deliberately not duplicated here.
 */

describe("PRD §29 TEST 11 — high direction / low capacity is capacity-constrained alignment, not low Direction", () => {
  it("§13.7 override path fires on high clarity + low alignment + low capacity", () => {
    // Cutoffs are read from config/scoring-v1.0.json, never literals.
    console.log("  cutoffs:", JSON.stringify(q18cutoffs));
    expect(q18cutoffs.directionHighAtOrAbove).toBe(4.0);
    expect(q18cutoffs.alignmentLowAtOrBelow).toBe(2);
    // Harmonised to 2.59 on 2026-10-01 — see tests/unit/capacity-low-boundary.test.ts.
    expect(q18cutoffs.capacityLowAtOrBelow).toBe(2.59);
    const fired = evaluateQ18CapacityModifier(
      { directionClarity: 5, q18Value: 1, capacityMean: 1 },
      q18cutoffs,
    );
    console.log("  modifier fired:", fired);
    expect(fired).toBe(true);
    // Any missing input must NOT fire — no alignment claim on thin evidence.
    expect(
      evaluateQ18CapacityModifier(
        { directionClarity: null, q18Value: 1, capacityMean: 1 },
        q18cutoffs,
      ),
    ).toBe(false);
  });

  it("end to end: strong Q17/Q19 + weak Q18 + weak Capacity -> AIM capacity-constrained, never low-direction", () => {
    const r = runC({ Q17: S, Q19: S, Q18: W, Q7: W, Q8: W });
    console.log("  AIM value:", r.signals.AIM.value, "state:", r.signals.AIM.state);
    console.log("  AIM display:", r.signals.AIM.displayState, "modifier fired:", r.q18ModifierFired);
    console.log("  ROOM:", r.signals.ROOM.value, r.signals.ROOM.state);
    expect(r.signals.ROOM.value).toBe(1); // capacity genuinely weak
    expect(r.signals.AIM.value).toBeCloseTo(11 / 3, 10); // mean(5,1,5)
    expect(r.q18ModifierFired).toBe(true);
    // The product rule: AIM must NOT render as low Direction (S1/S2).
    expect(r.signals.AIM.displayState).toBe("AIM_CAPACITY_CONSTRAINED_ALIGNMENT");
    expect(["S1", "S2"]).not.toContain(r.signals.AIM.displayState);
    // The tension surface agrees via the same §13.7 condition.
    const out = probeTensions({ items: { Q17: 5, Q19: 5, Q18: 1, Q7: 1, Q8: 1 } });
    console.log("  tensions:", JSON.stringify(out));
    expect(out).toEqual(["CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT"]);
  });
});

describe("PRD §29 TEST 12 — healthy privacy must not read as privacy friction", () => {
  it("privacy-leaning Q20 + strong Q6/Q22 + no fear tags -> HEALTHY_PRIVACY_BOUNDARY, never PRIVACY_AVOIDANCE_FRICTION", () => {
    const out = probeTensions({ items: { Q20: 1, Q6: 5, Q22: 5 }, tags: [], fearPresent: false });
    console.log("  tensions:", JSON.stringify(out));
    expect(out).toEqual(["HEALTHY_PRIVACY_BOUNDARY"]);
    expect(out).not.toContain("PRIVACY_AVOIDANCE_FRICTION");
  });

  it("Q21_G ('none of these stop me') yields no truth/judgment fear tags and no fear presence", () => {
    const tags = tagsForSelection("Q21", ["Q21_G"]);
    const fear = isFearPresent(["Q21_G"]);
    console.log("  Q21_G tags:", JSON.stringify(tags), "fear present:", fear);
    expect(tags).toEqual(["NO_SIGNIFICANT_FEAR_FRICTION"]);
    expect(tags).not.toContain("TRUTH_AVOIDANCE");
    expect(tags).not.toContain("JUDGMENT_EXPOSURE");
    expect(fear).toBe(false);
  });
});

describe("PRD §29 TEST 13 — information execution gap is an execution bottleneck, not 'needs more information'", () => {
  it("strong Q23/Q24 + weak Q25 -> INFORMATION_EXECUTION_BOTTLENECK", () => {
    const out = probeTensions({ items: { Q23: 5, Q24: 5, Q25: 1 } });
    console.log("  tensions:", JSON.stringify(out));
    // Both fire: the spec defines HIGH_INFORMATION_LOW_ACTION and
    // INFORMATION_EXECUTION_BOTTLENECK on effectively identical conditions
    // (config `tension_precedence` records this as an assumed tie-break for
    // display; both codes remain stored for the evidence chain).
    expect(out).toEqual([
      "HIGH_INFORMATION_LOW_ACTION",
      "INFORMATION_EXECUTION_BOTTLENECK",
    ]);
  });

  it("MOVE subsignals show the mechanism: consumption/analysis high, action low", () => {
    const r = run({ Q23: S, Q24: S, Q25: W });
    console.log("  MOVE:", r.signals.MOVE.value, "subsignals:", JSON.stringify(r.moveSubsignals));
    expect(r.moveSubsignals).toEqual({ consumption: 5, analysis: 5, action: 1 });
    expect(r.moveSubsignals.consumption!).toBeGreaterThanOrEqual(4);
    expect(r.moveSubsignals.analysis!).toBeGreaterThanOrEqual(4);
    expect(r.moveSubsignals.action!).toBeLessThanOrEqual(2);
  });
});

describe("PRD §29 TEST 14 — null finding: strong consistent evidence with no friction invents no friction", () => {
  // Every scored item at full strength, no capacity overrides anywhere.
  const strong: Record<string, string> = {
    Q4: S, Q5: S, Q6: S, Q7: S, Q8: S, Q10: S, Q11: S, Q12: S,
    Q13: S, Q14: S, Q15: S, Q17: S, Q18: S, Q19: S, Q20: S, Q22: S,
    Q23: S, Q24: S, Q25: S,
  };

  it("all-strong profile through the real engine -> exactly NO_MEANINGFUL_FRICTION_IDENTIFIED", () => {
    const r = runC(strong);
    const states: Record<string, string> = {};
    for (const s of SIGNALS) {
      const st = r.signals[s].state;
      if (st === null) throw new Error(`expected a ladder state for ${s}`);
      states[s] = st;
    }
    console.log("  states:", JSON.stringify(states), "modifier fired:", r.q18ModifierFired);
    expect(Object.values(states)).toEqual(["S5", "S5", "S5", "S5", "S5", "S5"]);
    expect(r.q18ModifierFired).toBe(false);
    const tags = [
      ...tagsForSelection("Q9", ["Q9_L"]),
      ...tagsForSelection("Q21", ["Q21_G"]),
      ...tagsForSelection("Q1", ["Q1_A"]),
      ...tagsForSelection("Q16", ["Q16_A"]),
    ];
    const fear = isFearPresent(["Q21_G"]);
    console.log("  tags:", JSON.stringify(tags), "fear:", fear);
    const out = evaluateTensions({
      signalStates: states as never,
      items: Object.fromEntries(Object.keys(strong).map((q) => [q, 5])),
      activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" } as never,
      tags,
      fearPresent: fear,
      capacityMean: r.signals.ROOM.value ?? undefined,
    } as never);
    console.log("  tensions:", JSON.stringify(out));
    expect(out).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
    // ...and no friction code accompanies it.
    const frictionCodes = out.filter((c) => c !== "NO_MEANINGFUL_FRICTION_IDENTIFIED");
    expect(frictionCodes).toEqual([]);
  });

  it("selectAttentionArea yields KEEP_OBSERVING for the null finding", () => {
    expect(selectAttentionArea(["NO_MEANINGFUL_FRICTION_IDENTIFIED"])).toBe("KEEP_OBSERVING");
    expect(selectAttentionArea([])).toBe("KEEP_OBSERVING");
  });
});

describe("PRD §29 TEST 16 — every participant-facing insight carries a complete evidence-chain record", () => {
  const valid: {
    insight_id: string;
    sourceQuestions: string[];
    answerPattern: string;
    signal: "SEE";
    subsignal: string;
    contextModifiers: string[];
    evidenceConfidence: "high";
    narrativeKey: string;
    attentionArea: "SEE_IT_MORE_CLEARLY";
  } = {
    insight_id: "BIG_PICTURE_CASHFLOW_GAP",
    sourceQuestions: ["Q4", "Q5"],
    answerPattern: "Q4=E (strong big-picture clarity) with Q5=A (weak cash-flow tracking)",
    signal: "SEE",
    subsignal: "Q4/Q5 pair",
    contextModifiers: [],
    evidenceConfidence: "high",
    narrativeKey: "connection_statements.BIG_PICTURE_CASHFLOW_GAP",
    attentionArea: "SEE_IT_MORE_CLEARLY",
  };

  it("builds a complete record carrying all eight required fields", () => {
    const rec = buildEvidenceRecord({ ...valid });
    console.log("  record:", JSON.stringify(rec));
    expect(rec.complete).toBe(true);
    expect(rec.insight_id).toBe("BIG_PICTURE_CASHFLOW_GAP");
    expect(rec.sourceQuestions).toEqual(["Q4", "Q5"]);
    expect(rec.answerPattern).toBe(valid.answerPattern);
    expect(rec.signal).toBe("SEE");
    expect(rec.subsignal).toBe("Q4/Q5 pair");
    expect(rec.contextModifiers).toEqual([]);
    expect(rec.evidenceConfidence).toBe("high");
    expect(rec.narrativeKey).toBe("connection_statements.BIG_PICTURE_CASHFLOW_GAP");
    expect(rec.attentionArea).toBe("SEE_IT_MORE_CLEARLY");
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it("a record without source items must not be constructible", () => {
    expect(() => buildEvidenceRecord({ ...valid, sourceQuestions: [] })).toThrow(
      /sourceQuestions/,
    );
  });

  it("throws on any other missing or invalid required field", () => {
    expect(() => buildEvidenceRecord({ ...valid, insight_id: "  " })).toThrow(/insight_id/);
    expect(() =>
      buildEvidenceRecord({ ...valid, signal: "NOPE" as never }),
    ).toThrow(/unknown signal/);
    expect(() =>
      buildEvidenceRecord({ ...valid, evidenceConfidence: "extreme" as never }),
    ).toThrow(/evidenceConfidence/);
    expect(() =>
      buildEvidenceRecord({ ...valid, attentionArea: "TRY_HARDER" as never }),
    ).toThrow(/attentionArea/);
  });
});

describe("PRD §29 TEST 18 — version pinning (config/seed side)", () => {
  // The DATABASE half of this test (trg_sessions_version_pin rejecting a
  // repoint of a completed session after v1.1 publishes) was already verified
  // by direct SQL execution against supabase/migrations/
  // 20260930000002_immutability.sql and is deliberately NOT duplicated here.

  it("assessment, scoring, and report configs all declare version 1.0 and the app's bank version agrees", () => {
    console.log(
      "  versions:",
      assessmentCfg.version,
      assessmentCfg.question_bank_version,
      scoringCfg.version,
      reportCfg.version,
    );
    expect(assessmentCfg.version).toBe("1.0");
    expect(assessmentCfg.question_bank_version).toBe("1.0");
    expect(scoringCfg.version).toBe("1.0");
    expect(reportCfg.version).toBe("1.0");
    const bank = loadQuestionBank(assessmentCfg);
    expect(bank.version).toBe("1.0");
  });

  it("seed 001 pins 1.0 across all four sub-versions", () => {
    for (const col of [
      "question_bank_version",
      "scoring_config_version",
      "narrative_version",
      "report_version",
    ]) {
      expect(seedText, `seed must pin ${col}`).toContain(col);
    }
    console.log(
      "  seed values:",
      (seedText.match(/VALUES\s*\(([\s\S]*?)\)/) ?? [])[1]?.replace(/\s+/g, " ").trim(),
    );
    // version_id 1.0, then the four sub-versions pinned to 1.0 in column order.
    expect(seedText).toMatch(/VALUES\s*\(\s*'1\.0'/);
    expect(seedText).toMatch(/'active',\s*'1\.0',\s*'1\.0',\s*'1\.0',\s*'1\.0'/);
  });
});
