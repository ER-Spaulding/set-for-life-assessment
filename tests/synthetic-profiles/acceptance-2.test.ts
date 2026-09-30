import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { evaluateQ18CapacityModifier, loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { selectAttentionArea } from "@/lib/assessment/interpretation";
import { buildEvidenceRecord } from "@/lib/assessment/evidence-chain";

/**
 * Engine acceptance tests, second set — PRD §29.
 *
 * Same method as `acceptance.test.ts`: build a synthetic profile, run it through
 * the real deterministic engine, assert on the computed output. Nothing here
 * asserts merely that a function exists.
 */

const repo = resolve(__dirname, "../..");
const scoringCfg = JSON.parse(
  readFileSync(resolve(repo, "config/scoring-v1.0.json"), "utf8"),
);
const tables = loadScoringTables(scoringCfg);

const S = "E"; // strongest option
const W = "A"; // weakest option
const M = "C"; // middle

/** A complete, mid-range 31-item profile. */
const base: Record<string, string> = {
  OPEN_A: "A", OPEN_B: "C",
  Q1: "A", Q2: "C", Q3: "C",
  Q4: M, Q5: M, Q6: M,
  Q7: M, Q8: M, Q9: "K",
  Q10: M, Q11: "C", Q12: "C",
  Q13: M, Q14: M, Q15: M,
  Q16: "A",
  Q17: M, Q18: M, Q19: M,
  Q20: "C", Q21: "H", Q22: "C",
  Q23: M, Q24: M, Q25: M,
  A1: "C", A2: "C", A3: "C", A4: "C",
};

/**
 * Score a profile. The Q18 cutoffs MUST be passed: `scoreAssessment` only
 * evaluates the §13.7 capacity modifier when they are supplied, so omitting
 * them silently yields `q18ModifierFired: false` regardless of the answers.
 */
const run = (overrides: Record<string, string>) =>
  scoreAssessment({ ...base, ...overrides }, tables, loadQ18Cutoffs(scoringCfg));

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;

const tensionInput = (
  overrides: Record<string, string>,
  tags: string[] = [],
  fearPresent = false,
) => {
  const scored = run(overrides);
  const items: Record<string, number> = {};
  const LETTERS: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };
  const responses = { ...base, ...overrides };
  for (const [k, v] of Object.entries(responses)) {
    const n = LETTERS[v];
    if (n !== undefined) items[k] = n;
  }
  return {
    scored,
    inputs: {
      signalStates: Object.fromEntries(
        SIGNALS.map((s) => [s, scored.signals[s].displayState ?? "S3"]),
      ) as never,
      items,
      activation: {
        A1: "MID", A2: "MID", A3: "MID", A4: "MID",
      } as never,
      tags,
      fearPresent,
    },
  };
};

describe("PRD §29 test 11 — high direction / low capacity", () => {
  it("returns capacity-constrained alignment, not low direction", () => {
    // Q17/Q19 strong, Q18 weak, Capacity weak.
    const { scored } = tensionInput({ Q17: S, Q19: S, Q18: W, Q7: W, Q8: W });

    // AIM is the Direction signal. Its mean includes the weak Q18, so it will
    // sit mid — but the point of §13.7 is that the CONSTRAINED reading is
    // chosen rather than a low-direction one.
    const cutoffs = loadQ18Cutoffs(scoringCfg);
    const modifierFires = evaluateQ18CapacityModifier(
      {
        directionClarity: (5 + 5) / 2, // Q17/Q19 strong
        q18Value: 1, // Q18 weak
        capacityMean: 1, // Capacity weak
      },
      cutoffs,
    );
    expect(modifierFires).toBe(true);

    // And the engine exposes it, so a consumer can render the constrained
    // language instead of "low direction".
    expect(scored.q18ModifierFired).toBe(true);
  });

  it("does NOT fire the modifier when direction clarity is genuinely low", () => {
    const cutoffs = loadQ18Cutoffs(scoringCfg);
    expect(
      evaluateQ18CapacityModifier(
        { directionClarity: 2, q18Value: 1, capacityMean: 1 },
        cutoffs,
      ),
    ).toBe(false);
  });
});

describe("PRD §29 test 12 — healthy privacy is not friction", () => {
  it("fires HEALTHY_PRIVACY_BOUNDARY and never PRIVACY_AVOIDANCE_FRICTION", () => {
    // Q20 privacy-leaning, Q6 and Q22 strong, no truth/judgment fear tags.
    const { inputs } = tensionInput({ Q20: W, Q6: S, Q22: S });
    const codes = evaluateTensions(inputs, scoringCfg);

    expect(codes).toContain("HEALTHY_PRIVACY_BOUNDARY");
    // The spec's point: selective sharing with strong visibility and agency is
    // a healthy boundary, not avoidance.
    expect(codes).not.toContain("PRIVACY_AVOIDANCE_FRICTION");
  });

  it("does fire PRIVACY_AVOIDANCE_FRICTION when avoidance tags are present", () => {
    const { inputs } = tensionInput({ Q20: W, Q6: W }, ["TRUTH_AVOIDANCE"]);
    expect(evaluateTensions(inputs, scoringCfg)).toContain("PRIVACY_AVOIDANCE_FRICTION");
  });
});

describe("PRD §29 test 13 — information execution gap", () => {
  it("identifies an execution bottleneck, not a need for more information", () => {
    const { inputs, scored } = tensionInput({ Q23: S, Q24: S, Q25: W });
    const codes = evaluateTensions(inputs, scoringCfg);

    expect(codes).toContain("INFORMATION_EXECUTION_BOTTLENECK");
    // The mechanism, asserted directly: consumption and analysis are high while
    // ACTION is low. That is why "needs more information" would be the wrong
    // reading — the participant already takes information in and evaluates it.
    expect(scored.moveSubsignals.consumption).toBeGreaterThanOrEqual(4);
    expect(scored.moveSubsignals.analysis).toBeGreaterThanOrEqual(4);
    expect(scored.moveSubsignals.action).toBeLessThanOrEqual(2);
  });

  it("distinguishes the analysis bottleneck from the execution bottleneck", () => {
    // Q23 strong but Q24 weak is an ANALYSIS problem, not an execution one.
    const { inputs } = tensionInput({ Q23: S, Q24: W, Q25: W });
    const codes = evaluateTensions(inputs, scoringCfg);
    expect(codes).toContain("INFORMATION_ANALYSIS_BOTTLENECK");
  });
});

describe("PRD §29 test 14 — null finding invents nothing", () => {
  it("returns NO_MEANINGFUL_FRICTION_IDENTIFIED with no accompanying weakness", () => {
    // All signals strong and consistent, no contextual friction.
    const { inputs } = tensionInput({
      Q4: S, Q5: S, Q6: S,
      Q7: S, Q8: S,
      Q10: S, Q11: "E", Q12: "E",
      Q13: S, Q14: S, Q15: S,
      Q17: S, Q18: S, Q19: S,
      Q20: "E", Q22: "E",
      Q23: S, Q24: S, Q25: S,
    });
    const codes = evaluateTensions(inputs, scoringCfg);

    expect(codes).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
    // No friction code may ride along to populate a section.
    const friction = codes.filter((c) => c !== "NO_MEANINGFUL_FRICTION_IDENTIFIED");
    expect(friction).toEqual([]);
  });

  it("routes the null finding to KEEP_OBSERVING", () => {
    // §18.3: when nothing is supported, the report points at observation rather
    // than manufacturing a problem to work on.
    expect(selectAttentionArea(["NO_MEANINGFUL_FRICTION_IDENTIFIED"])).toBe(
      "KEEP_OBSERVING",
    );
    expect(selectAttentionArea([])).toBe("KEEP_OBSERVING");
  });
});

describe("PRD §29 test 16 — evidence chain", () => {
  it("builds a complete record carrying every required field", () => {
    const { inputs } = tensionInput({ Q23: S, Q24: S, Q25: W });
    const codes = evaluateTensions(inputs, scoringCfg);
    const area = selectAttentionArea(codes);

    const record = buildEvidenceRecord({
      insight_id: "insight-1",
      sourceQuestions: ["Q23", "Q24", "Q25"],
      answerPattern: "Q23/Q24 strong, Q25 weak",
      signal: "MOVE",
      subsignal: "execution",
      contextModifiers: [],
      evidenceConfidence: "high",
      narrativeKey: "INFORMATION_EXECUTION_BOTTLENECK",
      attentionArea: area,
    });

    // The approved library's no-orphan-insight rule: every personalized
    // sentence must resolve to a stored narrative key and evidence chain.
    expect(record.insight_id).toBe("insight-1");
    expect(record.sourceQuestions.length).toBeGreaterThan(0);
    expect(record.narrativeKey).toBe("INFORMATION_EXECUTION_BOTTLENECK");
    expect(record.attentionArea).toBe(area);
    expect(record.evidenceConfidence).toBe("high");
  });

  it("refuses to build a record with no source items", () => {
    // An insight with no evidence must be unconstructible — otherwise the
    // no-orphan-insight rule is unenforceable.
    expect(() =>
      buildEvidenceRecord({
        insight_id: "insight-2",
        sourceQuestions: [],
        answerPattern: "x",
        signal: "MOVE",
        subsignal: "execution",
        contextModifiers: [],
        evidenceConfidence: "high",
        narrativeKey: "INFORMATION_EXECUTION_BOTTLENECK",
        attentionArea: "TURN_INFORMATION_INTO_ACTION",
      }),
    ).toThrow();
  });
});

describe("PRD §29 test 18 — version pinning (config/seed side)", () => {
  // The DATABASE half of this test has been verified by executing SQL directly:
  // `trg_sessions_version_pin` rejects repointing a completed session after a
  // later version is published. That is not repeated here. What follows asserts
  // the config/seed half — that the pinned versions exist and agree.
  it("declares the assessment version in config", () => {
    const assessment = JSON.parse(
      readFileSync(resolve(repo, "config/assessment-v1.0.json"), "utf8"),
    );
    expect(assessment.version).toBe("1.0");
  });

  it("pins all four sub-versions in the seed, so a session can record them", () => {
    const seed = readFileSync(
      resolve(repo, "supabase/seed/001_assessment_v1.sql"),
      "utf8",
    );
    // PRD §22.6: a completed session retains the versions used at completion.
    for (const col of [
      "question_bank_version",
      "scoring_config_version",
      "narrative_version",
      "report_version",
    ]) {
      expect(seed, `seed pins ${col}`).toContain(col);
    }
    expect(seed).toMatch(/'1\.0'/);
  });

  it("keeps the app's version constants aligned with the pinned build", () => {
    const env = readFileSync(resolve(repo, ".env.example"), "utf8");
    expect(env).toMatch(/ASSESSMENT_VERSION=1\.0/);
    expect(env).toMatch(/SCORING_VERSION=1\.0/);
    expect(env).toMatch(/NARRATIVE_VERSION=1\.0/);
  });
});

// PRD §29 test 17 (server authority) is deliberately absent here: it can only be
// exercised against the API layer, which is being built separately. Asserting it
// at the engine level would be vacuous — the engine has no client boundary.
