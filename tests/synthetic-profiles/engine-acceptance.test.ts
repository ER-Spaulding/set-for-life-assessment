import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { evaluateTensions } from "@/lib/assessment/tensions";
import {
  levelsForActivation,
  a4Consent,
  type ActivationLevels,
} from "@/lib/assessment/activation";
import {
  tagsForSelection,
  isFearPresent,
} from "@/lib/assessment/classifiers";
import { selectAttentionArea } from "@/lib/assessment/interpretation";
import { buildEvidenceRecord } from "@/lib/assessment/evidence-chain";
import type { SignalId, SignalState } from "@/lib/assessment/types";
import {
  buildProfile,
  buildAllStrong,
  scoringInput,
  type SyntheticProfile,
} from "./build-profile";

/**
 * Engine acceptance tests — PRD §29, executed end to end through the
 * synthetic-profile builder (./build-profile.ts).
 *
 * Each test builds a complete 31-item synthetic participant, runs it through
 * the REAL deterministic pipeline —
 *   scoreAssessment (+ §13.7 cutoffs) → classifier tags → evaluateTensions —
 * and asserts on COMPUTED output. Console lines print the observed values so
 * a failure shows what the engine actually did.
 *
 * Relationship to the sibling files (deliberately not modified here):
 *   acceptance.test.ts — the first engine batch (TEST 10 core, overrides,
 *     activation separation sketch, MOVE subsignals).
 *   acceptance-2.test.ts — TESTs 11–14, 16, 18 with hand-rolled fixtures.
 *   activation-safeguard.test.ts — TESTs 8/9 at the activation-module layer.
 *   tension-reachability.test.ts — per-code reachability probes.
 * This file re-covers TESTs 2/3/4, 8–14 and 16 END TO END through the shared
 * builder, so the 31-item wiring (not just module inputs) is under test.
 */

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const tables = loadScoringTables(scoringCfg);
const cutoffs = loadQ18Cutoffs(scoringCfg);

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;

interface EngineRun {
  scoring: ReturnType<typeof scoreAssessment>;
  tensions: string[];
  tags: string[];
  fearPresent: boolean;
  activation: ActivationLevels;
  items: Record<string, number>;
}

/**
 * Full engine pipeline for one synthetic participant. Letter→value mapping
 * goes through the LOADED scoring tables (Q11/Q12 override letters map to
 * null and are omitted — no numeric evidence, so they can never satisfy a
 * tension clause). Classifier selections become tags + fear presence via the
 * real classifier module.
 */
function runEngine(profile: SyntheticProfile): EngineRun {
  const input = scoringInput(profile);
  const scoring = scoreAssessment(input, tables, cutoffs);

  const items: Record<string, number> = {};
  for (const [id, letter] of Object.entries(input)) {
    if (!/^Q\d+$/.test(id)) continue; // OPEN_*/A* are unscored, never items
    const map =
      id === "Q11"
        ? tables.values.q11
        : id === "Q12"
          ? tables.values.q12
          : tables.values.profile;
    const v = map[letter];
    // null = capacity override (Q11_A / Q12_F): substantive answer, no numeric
    // value — omitted from the item map rather than imputed.
    if (typeof v === "number") items[id] = v;
  }

  const tags = [
    ...tagsForSelection("Q1", profile.selections.Q1),
    ...tagsForSelection("Q9", profile.selections.Q9),
    ...tagsForSelection("Q16", profile.selections.Q16),
    ...tagsForSelection("Q21", profile.selections.Q21),
  ];
  const fearPresent = isFearPresent(profile.selections.Q21);
  const activation = levelsForActivation({
    A1: input.A1,
    A2: input.A2,
    A3: input.A3,
    A4: input.A4,
  });

  const states = {} as Record<SignalId, SignalState>;
  for (const s of SIGNALS) {
    const st = scoring.signals[s].state;
    if (st === null) {
      throw new Error(
        `runEngine: no ladder state for ${s} (value ${scoring.signals[s].value})`,
      );
    }
    states[s] = st;
  }

  const tensions = evaluateTensions(
    {
      signalStates: states,
      items,
      // Spread to a plain record: TensionInputs takes Record<string, ...> and
      // ActivationLevels is a closed four-key shape (the point of TEST 8).
      activation: { ...activation },
      tags,
      fearPresent,
      capacityMean: scoring.signals.ROOM.value ?? undefined,
    },
    scoringCfg,
  );
  return { scoring, tensions, tags, fearPresent, activation, items };
}

describe("PRD §29 TEST 10 — high Visibility + low Capacity must not drag DIRECT low", () => {
  it("strong Q4/Q5/Q6 with weak Q7/Q8 and MID agency leaves DIRECT at S3", () => {
    // DIRECT items stay at the neutral default (C=3): if any ROOM value leaked
    // into the Agency average, DIRECT would drop below 3 — that is the defect
    // this test guards. SEE high, ROOM low, DIRECT untouched.
    const { scoring, tensions } = runEngine(
      buildProfile({ Q4: "E", Q5: "E", Q6: "E", Q7: "A", Q8: "A" }),
    );
    console.log(
      "  SEE:",
      scoring.signals.SEE.value,
      scoring.signals.SEE.state,
      "| ROOM:",
      scoring.signals.ROOM.value,
      scoring.signals.ROOM.state,
      "| DIRECT:",
      scoring.signals.DIRECT.value,
      scoring.signals.DIRECT.displayState,
      "| tensions:",
      JSON.stringify(tensions),
    );
    expect(scoring.signals.SEE.value).toBe(5);
    expect(scoring.signals.SEE.state).toBe("S5");
    expect(scoring.signals.ROOM.value).toBe(1);
    expect(scoring.signals.ROOM.state).toBe("S1");
    // THE product-integrity rule (PRD §29 test 10): capacity constraint is not
    // low agency — DIRECT stays exactly at its own evidence (3.0, S3).
    expect(scoring.signals.DIRECT.value).toBe(3);
    expect(scoring.signals.DIRECT.state).toBe("S3");
    expect(scoring.signals.DIRECT.displayState).toBe("S3");
    // The capacity constraint IS named — as capacity, not agency.
    expect(tensions).toContain("HIGH_VISIBILITY_LOW_CAPACITY");
  });
});

describe("PRD §29 TESTs 2/3/4 — capacity overrides through the full engine", () => {
  it("TEST 2: Q11_A only → DIRECT from Q10+Q12, DIRECT_CAPACITY_LIMITED", () => {
    const { scoring } = runEngine(
      buildProfile({ Q10: "E", Q11: "A", Q12: "E" }),
    );
    console.log(
      "  DIRECT:",
      scoring.signals.DIRECT.value,
      scoring.signals.DIRECT.displayState,
      "flags:",
      JSON.stringify(scoring.overrideFlags),
    );
    expect(scoring.overrideFlags.Q11_CAPACITY_OVERRIDE).toBe(true);
    expect(scoring.overrideFlags.Q12_CAPACITY_OVERRIDE).toBe(false);
    expect(
      scoring.overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT,
    ).toBe(false);
    expect(scoring.directSpecial).toBe("DIRECT_CAPACITY_LIMITED");
    // mean(Q10=5, Q12=5) — the overridden Q11 contributes nothing, not even a 1.
    expect(scoring.signals.DIRECT.value).toBe(5);
    expect(scoring.signals.DIRECT.displayState).toBe(
      "DIRECT_CAPACITY_LIMITED",
    );
  });

  it("TEST 3: Q12_F only → DIRECT from Q10+Q11, DIRECT_CAPACITY_LIMITED", () => {
    const { scoring } = runEngine(
      buildProfile({ Q10: "E", Q11: "E", Q12: "F" }),
    );
    console.log(
      "  DIRECT:",
      scoring.signals.DIRECT.value,
      scoring.signals.DIRECT.displayState,
      "flags:",
      JSON.stringify(scoring.overrideFlags),
    );
    expect(scoring.overrideFlags.Q11_CAPACITY_OVERRIDE).toBe(false);
    expect(scoring.overrideFlags.Q12_CAPACITY_OVERRIDE).toBe(true);
    expect(
      scoring.overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT,
    ).toBe(false);
    expect(scoring.directSpecial).toBe("DIRECT_CAPACITY_LIMITED");
    expect(scoring.signals.DIRECT.value).toBe(5);
    expect(scoring.signals.DIRECT.displayState).toBe(
      "DIRECT_CAPACITY_LIMITED",
    );
  });

  it("TEST 4: Q11_A + Q12_F → DIRECT from Q10 only, LIMITED_DUE_TO_CAPACITY_CONTEXT", () => {
    const { scoring } = runEngine(
      buildProfile({ Q10: "E", Q11: "A", Q12: "F" }),
    );
    console.log(
      "  DIRECT:",
      scoring.signals.DIRECT.value,
      scoring.signals.DIRECT.displayState,
      "flags:",
      JSON.stringify(scoring.overrideFlags),
    );
    expect(scoring.overrideFlags.Q11_CAPACITY_OVERRIDE).toBe(true);
    expect(scoring.overrideFlags.Q12_CAPACITY_OVERRIDE).toBe(true);
    expect(
      scoring.overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT,
    ).toBe(true);
    expect(scoring.directSpecial).toBe("DIRECT_LIMITED_EVIDENCE_CAPACITY");
    // Q10 alone (E=5) — two substantive capacity answers, zero low-agency evidence.
    expect(scoring.signals.DIRECT.value).toBe(5);
    expect(scoring.signals.DIRECT.displayState).toBe(
      "DIRECT_LIMITED_EVIDENCE_CAPACITY",
    );
  });
});

describe("PRD §29 TEST 11 — high Direction + low Capacity is capacity-constrained alignment", () => {
  it("strong Q17/Q19 + weak Q18 + weak Capacity → capacity-constrained language, never low-Direction", () => {
    const { scoring, tensions } = runEngine(
      buildProfile({ Q17: "E", Q19: "E", Q18: "A", Q7: "A", Q8: "A" }),
    );
    console.log(
      "  AIM value:",
      scoring.signals.AIM.value,
      "ladder:",
      scoring.signals.AIM.state,
      "display:",
      scoring.signals.AIM.displayState,
      "modifier fired:",
      scoring.q18ModifierFired,
      "| ROOM:",
      scoring.signals.ROOM.value,
      "| tensions:",
      JSON.stringify(tensions),
    );
    expect(scoring.signals.ROOM.value).toBe(1); // capacity genuinely weak
    expect(scoring.signals.AIM.value).toBeCloseTo(11 / 3, 10); // mean(5,1,5)
    expect(scoring.q18ModifierFired).toBe(true);
    // AIM must NOT render as low Direction (S1/S2): the §13.7 special applies.
    expect(scoring.signals.AIM.displayState).toBe(
      "AIM_CAPACITY_CONSTRAINED_ALIGNMENT",
    );
    expect(["S1", "S2"]).not.toContain(scoring.signals.AIM.displayState);
    // The tension surface agrees via the same §13.7 condition.
    expect(tensions).toContain(
      "CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT",
    );
  });
});

describe("PRD §29 TEST 12 — healthy privacy must not read as privacy friction", () => {
  it("Q20 privacy-leaning + strong Q6/Q22 + Q21_G → HEALTHY_PRIVACY_BOUNDARY only", () => {
    const { tensions, tags, fearPresent } = runEngine(
      buildProfile({ Q20: "A", Q6: "E", Q22: "E", Q21: ["Q21_G"] }),
    );
    console.log(
      "  tensions:",
      JSON.stringify(tensions),
      "tags:",
      JSON.stringify(tags),
      "fear:",
      fearPresent,
    );
    expect(fearPresent).toBe(false);
    expect(tags).not.toContain("TRUTH_AVOIDANCE");
    expect(tags).not.toContain("JUDGMENT_EXPOSURE");
    expect(tensions).toEqual(["HEALTHY_PRIVACY_BOUNDARY"]);
    expect(tensions).not.toContain("PRIVACY_AVOIDANCE_FRICTION");
  });
});

describe("PRD §29 TEST 13 — information execution gap is an execution bottleneck", () => {
  it("strong Q23/Q24 + weak Q25 → INFORMATION_EXECUTION_BOTTLENECK, not an analysis/overload framing", () => {
    const { scoring, tensions } = runEngine(
      buildProfile({ Q23: "E", Q24: "E", Q25: "A" }),
    );
    console.log(
      "  MOVE:",
      scoring.signals.MOVE.value,
      "subsignals:",
      JSON.stringify(scoring.moveSubsignals),
      "| tensions:",
      JSON.stringify(tensions),
    );
    // The mechanism is visible in the subsignals: intake and evaluation high,
    // follow-through low — an execution bottleneck, not "needs more information".
    expect(scoring.moveSubsignals).toEqual({
      consumption: 5,
      analysis: 5,
      action: 1,
    });
    // Both fire: the spec defines HIGH_INFORMATION_LOW_ACTION and
    // INFORMATION_EXECUTION_BOTTLENECK on effectively identical conditions
    // (config `tension_precedence` records the display tie-break; both codes
    // remain stored for the evidence chain).
    expect(tensions).toEqual([
      "HIGH_INFORMATION_LOW_ACTION",
      "INFORMATION_EXECUTION_BOTTLENECK",
    ]);
    // ...and neither "needs more information" framing fires.
    expect(tensions).not.toContain("INFORMATION_ANALYSIS_BOTTLENECK");
    expect(tensions).not.toContain("INFORMATION_OVERLOAD_PATTERN");
  });
});

describe("PRD §29 TEST 14 — null finding: no invented weakness", () => {
  it("all-strong consistent profile → exactly NO_MEANINGFUL_FRICTION_IDENTIFIED", () => {
    const { scoring, tensions } = runEngine(buildAllStrong());
    const states = SIGNALS.map((s) => scoring.signals[s].state);
    console.log(
      "  states:",
      JSON.stringify(states),
      "modifier fired:",
      scoring.q18ModifierFired,
      "| tensions:",
      JSON.stringify(tensions),
    );
    expect(states).toEqual(["S5", "S5", "S5", "S5", "S5", "S5"]);
    expect(scoring.q18ModifierFired).toBe(false);
    expect(tensions).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
    // ...and no low-signal friction code is emitted just to populate a section.
    const friction = tensions.filter(
      (c) => c !== "NO_MEANINGFUL_FRICTION_IDENTIFIED",
    );
    expect(friction).toEqual([]);
    expect(selectAttentionArea(tensions as never)).toBe("KEEP_OBSERVING");
  });
});

describe("PRD §29 TEST 8 — activation separation", () => {
  it("changing ONLY A1–A4 leaves all six operating signals identical", () => {
    const a = runEngine(
      buildProfile({ A1: "A", A2: "A", A3: "A", A4: "A" }),
    );
    const b = runEngine(
      buildProfile({ A1: "E", A2: "E", A3: "E", A4: "E" }),
    );
    for (const s of SIGNALS) {
      expect(
        b.scoring.signals[s].value,
        `${s} value must not move with activation`,
      ).toBe(a.scoring.signals[s].value);
      expect(
        b.scoring.signals[s].displayState,
        `${s} display must not move with activation`,
      ).toBe(a.scoring.signals[s].displayState);
    }
    expect(b.tensions).toEqual(a.tensions);
  });

  it("activation output is four separate values — no combined score exists", () => {
    const { activation } = runEngine(
      buildProfile({ A1: "E", A2: "C", A3: "D", A4: "B" }),
    );
    console.log("  activation:", JSON.stringify(activation));
    expect(activation).toEqual({
      A1: "HIGH",
      A2: "MID",
      A3: "HIGH",
      A4: "LOW",
    });
    expect(Object.keys(activation).sort()).toEqual(["A1", "A2", "A3", "A4"]);
    const forbidden =
      /average|mean|combined|total|score|index|composite|overall/i;
    for (const key of Object.keys(activation)) {
      expect(key, `no aggregate key "${key}"`).not.toMatch(forbidden);
    }
  });
});

describe("PRD §29 TEST 9 — A4 HIGH creates no consent and no route", () => {
  it("a4Consent() is all-false even for a maximally support-open participant", () => {
    const { activation } = runEngine(buildProfile({ A4: "E" }));
    expect(activation.A4).toBe("HIGH");
    const consent = a4Consent();
    console.log(
      "  A4:",
      activation.A4,
      "consent:",
      JSON.stringify(consent),
    );
    expect(consent).toEqual({
      appointmentConsent: false,
      marketingConsent: false,
      automaticProfessionalRoute: false,
    });
    for (const [k, v] of Object.entries(consent)) {
      expect(typeof v, `${k} must be a boolean flag`).toBe("boolean");
      expect(v, `${k} must be false`).toBe(false);
    }
  });
});

describe("PRD §29 TEST 16 — evidence chain", () => {
  // Seam statement, pinned as a test rather than a comment: at this layer the
  // engine produces CODES (tension keys) plus a VALIDATED record builder — it
  // does not auto-generate participant-facing insights. ScoringResult carries
  // no insights payload and evaluateTensions returns bare codes; mapping a
  // code to a complete record is the report composer's job, and the builder
  // below refuses to produce a record missing any required field.
  it("the scoring layer emits codes, not insights — no insights payload exists here", () => {
    const { scoring, tensions } = runEngine(
      buildProfile({ Q4: "E", Q5: "A" }),
    );
    console.log(
      "  tensions:",
      JSON.stringify(tensions),
      "scoring keys:",
      Object.keys(scoring).sort().join(","),
    );
    expect(tensions).toContain("BIG_PICTURE_CASHFLOW_GAP");
    expect(scoring).not.toHaveProperty("insights");
    expect(Array.isArray(tensions)).toBe(true);
    for (const code of tensions) {
      expect(typeof code).toBe("string");
    }
  });

  it("every hand-built insight record carries source items — the builder refuses orphans", () => {
    const rec = buildEvidenceRecord({
      insight_id: "BIG_PICTURE_CASHFLOW_GAP",
      sourceQuestions: ["Q4", "Q5"],
      answerPattern: "Q4=E (strong big-picture clarity) with Q5=A (weak cash-flow tracking)",
      signal: "SEE",
      subsignal: "Q4/Q5 pair",
      contextModifiers: [],
      evidenceConfidence: "high",
      narrativeKey: "connection_statements.BIG_PICTURE_CASHFLOW_GAP",
      attentionArea: "SEE_IT_MORE_CLEARLY",
    });
    console.log("  record:", JSON.stringify(rec));
    expect(rec.complete).toBe(true);
    expect(rec.sourceQuestions).toEqual(["Q4", "Q5"]);
    expect(rec.evidenceConfidence).toBe("high");
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it("a record without source items (or any other required field) cannot be constructed", () => {
    const valid = {
      insight_id: "BIG_PICTURE_CASHFLOW_GAP",
      sourceQuestions: ["Q4", "Q5"],
      answerPattern: "Q4=E with Q5=A",
      signal: "SEE" as const,
      subsignal: "Q4/Q5 pair",
      contextModifiers: [] as string[],
      evidenceConfidence: "high" as const,
      narrativeKey: "connection_statements.BIG_PICTURE_CASHFLOW_GAP",
      attentionArea: "SEE_IT_MORE_CLEARLY" as const,
    };
    expect(() =>
      buildEvidenceRecord({ ...valid, sourceQuestions: [] }),
    ).toThrow(/sourceQuestions/);
    expect(() => buildEvidenceRecord({ ...valid, insight_id: "  " })).toThrow(
      /insight_id/,
    );
    expect(() =>
      buildEvidenceRecord({ ...valid, signal: "NOPE" as never }),
    ).toThrow(/unknown signal/);
    expect(() =>
      buildEvidenceRecord({
        ...valid,
        evidenceConfidence: "extreme" as never,
      }),
    ).toThrow(/evidenceConfidence/);
    expect(() =>
      buildEvidenceRecord({ ...valid, attentionArea: "TRY_HARDER" as never }),
    ).toThrow(/attentionArea/);
  });
});

describe("engine determinism — same input → same output", () => {
  it("a repeated run is deep-identical", () => {
    const first = runEngine(
      buildProfile({ Q4: "E", Q7: "A", Q17: "E", Q23: "E", Q25: "A" }),
    );
    const second = runEngine(
      buildProfile({ Q4: "E", Q7: "A", Q17: "E", Q23: "E", Q25: "A" }),
    );
    expect(second.scoring).toEqual(first.scoring);
    expect(second.tensions).toEqual(first.tensions);
    expect(second.tags).toEqual(first.tags);
  });
});
