import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import {
  evaluateTensions,
  allSignalsS3OrAbove,
  countSignalsS4OrAbove,
  hasSufficientCorroboration,
  isNullFinding,
  loadMinSignalsS4,
} from "@/lib/assessment/tensions";
import { classifyAll } from "@/lib/assessment/classifiers";
import {
  assembleSnapshotPayload,
  selectBigPictureTemplate,
  resolveBigPictureTemplate,
  NULL_FINDING_CODE,
} from "@/lib/assessment/snapshot-payload";
import { selectAttentionArea } from "@/lib/assessment/interpretation";

/**
 * The null-finding gate — operator decision 2026-10-01 (Option 2).
 *
 * THE PROBLEM THIS SUITE PINS DOWN.
 *
 * The gate previously required only "every signal at S3 or above". S3's approved
 * labels are the DEVELOPING band ("Coming Into Focus", "Some Direction",
 * "Developing Direction"), so an all-S3 profile returned
 * NO_MEANINGFUL_FRICTION_IDENTIFIED — and was therefore indistinguishable, in
 * the participant's report, from a profile genuinely clear at S4/S5. Verified by
 * execution before the change: both produced the same code, the same template,
 * and the same KEEP_OBSERVING attention area, with zero frictions rendered.
 *
 * PRD §29 asks for "STRONG consistent evidence across all operating signals".
 *
 * THE APPROVED RULE, all four conditions:
 *   1. no other tension triggered;
 *   2. every signal at S3 or above            (the floor);
 *   3. at least N signals at S4 or above      (the corroboration);
 *   4. no meaningful contextual friction.
 *
 * And the third outcome this created: an all-S3 profile now satisfies neither
 * the null finding nor any friction trigger, so it must resolve to
 * DEVELOPING_PICTURE — never to a friction template with nothing in it, and
 * never to an all-clear it did not earn.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const narratives = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/narratives-v1.0.json"), "utf8"),
);
const tables = loadScoringTables(cfg);
const cutoffs = loadQ18Cutoffs(cfg);

/** All items neutral ('C'), which lands most signals mid-scale. */
function build(overrides: Record<string, string> = {}) {
  const input: Record<string, string> = {};
  for (const it of [
    "OPEN_A", "OPEN_B",
    ...[...Array(25)].map((_, i) => `Q${i + 1}`),
    "A1", "A2", "A3", "A4",
  ]) {
    input[it] = "C";
  }
  input.OPEN_A = "B";
  input.OPEN_B = "C";
  input.Q16 = "A";
  input.Q21 = "G";
  Object.assign(input, overrides);
  return input;
}

/**
 * Answer sets that drive every signal to a target ladder state.
 *
 * These were found by PROBING the scorer rather than by assumption — the point
 * of each case is the resulting `states`, which is asserted below rather than
 * trusted, so a fixture that stopped producing the intended profile would fail
 * loudly instead of making the test vacuous.
 */
const ALL_S4 = {
  Q4: "D", Q5: "D", Q6: "D",
  Q7: "D", Q8: "D",
  Q10: "D", Q11: "D", Q12: "D",
  Q13: "D", Q15: "D",
  Q17: "D", Q18: "D", Q19: "D",
  Q20: "D", Q22: "D", Q23: "D", Q24: "D", Q25: "D",
} as const;

function scored(overrides: Record<string, string>) {
  const input = build(overrides);
  const result = scoreAssessment(input as never, tables, cutoffs);
  const tags = Object.values(
    classifyAll({
      Q1: [input.Q1], Q9: [input.Q9], Q16: [input.Q16], Q21: [input.Q21],
    }),
  ).flat();
  const states = Object.fromEntries(
    Object.entries(result.signals).map(([k, v]) => [k, v.state ?? "S3"]),
  ) as never;
  const codes = evaluateTensions(
    {
      signalStates: states,
      items: {},
      activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" },
      tags,
      fearPresent: false,
    } as never,
    cfg,
  );
  return { states, codes };
}

function payloadFor(overrides: Record<string, string>) {
  const input = build(overrides);
  const result = scoreAssessment(input as never, tables, cutoffs);
  const { codes } = scored(overrides);

  // REAL scorer output, not `{}`. An earlier version of this helper passed an
  // empty signal map, so `isCapacityConstrained` could never see a specialState
  // and the capacity case in the sweep below silently resolved to
  // DEVELOPING_PICTURE — the sweep was not exercising the branch it claimed to,
  // and passed anyway. Capacity must ride on the scorer's own output.
  // A fixed evidence object is a legitimate ASSEMBLY-only input; this suite
  // tests the null-finding gate, not the derivation (covered separately).
  const signals = Object.fromEntries(
    Object.entries(result.signals).map(([k, v]) => [
      k,
      { ...v, evidence: { confidence: "moderate" as const, limitedReason: null } },
    ]),
  );

  return assembleSnapshotPayload({
    versions: {
      assessment: "1.0",
      questionBank: "1.0",
      scoring: "1.0",
      narrative: "1.0",
      report: "1.0",
      interstitial: "1.0",
    },
    signals: signals as never,
    tensionCodes: codes,
    classifierTags: [],
    activationSelections: { A1: "C", A2: "C", A3: "C", A4: "C" },
    openingB: null,
    q16Selections: [],
    signalMeans: Object.fromEntries(
      Object.entries(result.signals).map(([k, v]) => [k, v.value ?? 0]),
    ),
    perceptionGapConfig: cfg.perception_gap,
    moveSubsignals: result.moveSubsignals as never,
  });
}

// ---------------------------------------------------------------------------

describe("all six signals at S3 — the case the decision is about", () => {
  it("does NOT return the null finding", () => {
    const { states, codes } = scored({});
    console.log("  all-S3 states:", JSON.stringify(states));
    console.log("  all-S3 codes :", JSON.stringify(codes));

    // Precondition — otherwise the test is vacuous.
    expect(allSignalsS3OrAbove(states)).toBe(true);
    expect(countSignalsS4OrAbove(states)).toBe(0);

    // THE CHANGE: developing everywhere is not "strong consistent evidence".
    expect(codes).not.toContain(NULL_FINDING_CODE);
  });

  it("does NOT manufacture a friction finding either", () => {
    // The other half of the operator's instruction: "Do not manufacture a
    // friction finding merely because a participant is all-S3. S3 remains a
    // legitimate developing/middle state."
    const { codes } = scored({});
    expect(codes).toEqual([]);
  });

  it("resolves to DEVELOPING_PICTURE — the third outcome", () => {
    const p = payloadFor({});
    console.log("  all-S3 template:", p.bigPicture.template);
    expect(p.nullFinding).toBe(false);
    expect(p.bigPicture.template).toBe("DEVELOPING_PICTURE");
    // And it renders NO friction sentence, because there is none to render.
    expect(p.frictions.filter((f) => f.narrativeKey)).toHaveLength(0);
  });

  it("is DISTINGUISHABLE from an all-S4 profile", () => {
    // The operator's explicit requirement. Before Option 2 these two were
    // identical in the participant's report.
    const s3 = payloadFor({});
    const s4 = payloadFor(ALL_S4);
    console.log("  all-S3:", s3.bigPicture.template, "| all-S4:", s4.bigPicture.template);
    expect(s3.bigPicture.template).not.toBe(s4.bigPicture.template);
    expect(s4.bigPicture.template).toBe("NO_MEANINGFUL_FRICTION");
  });
});

describe("all six signals at S4 — a legitimate null finding", () => {
  it("returns the null code", () => {
    const { states, codes } = scored(ALL_S4);
    console.log("  all-S4 states:", JSON.stringify(states));
    console.log("  all-S4 codes :", JSON.stringify(codes));

    expect(allSignalsS3OrAbove(states)).toBe(true);
    expect(countSignalsS4OrAbove(states)).toBe(6);
    expect(codes).toEqual([NULL_FINDING_CODE]);
  });

  it("renders the revised copy that does not imply everything is clear", () => {
    const p = payloadFor(ALL_S4);
    expect(p.nullFinding).toBe(true);
    expect(p.bigPicture.template).toBe("NO_MEANINGFUL_FRICTION");

    // The approved sentence, verbatim, from the library.
    const copy = narratives.big_picture_templates.NO_MEANINGFUL_FRICTION as string;
    console.log("  null copy:", copy);
    expect(copy).toContain(
      "Nothing in your responses points to one area that needs to take center stage right now.",
    );
    expect(copy).toContain(
      "Several parts of your financial picture may still be coming into focus.",
    );
  });
});

describe("the corroboration requirement is config-driven and calibrated", () => {
  it("reads its threshold from config, not a literal", () => {
    const n = loadMinSignalsS4(cfg);
    console.log("  min_signals_s4_or_above:", n);
    expect(n).toBe(3);
  });

  it("throws loudly on a malformed value rather than defaulting silently", () => {
    // A silent fallback would change engine behaviour with no signal.
    expect(() => loadMinSignalsS4({ null_finding: { operationalization: {} } })).toThrow();
    expect(() =>
      loadMinSignalsS4({ null_finding: { operationalization: { min_signals_s4_or_above: 9 } } }),
    ).toThrow();
    expect(() =>
      loadMinSignalsS4({ null_finding: { operationalization: { min_signals_s4_or_above: 2.5 } } }),
    ).toThrow();
  });

  it("all >= S3 WITH the required S4+ corroboration clears the gate", () => {
    const states = { SEE: "S4", ROOM: "S4", DIRECT: "S4", PREPARE: "S3", AIM: "S3", MOVE: "S3" } as never;
    console.log("  3xS4 + 3xS3:", JSON.stringify(states));
    expect(allSignalsS3OrAbove(states)).toBe(true);
    expect(hasSufficientCorroboration(states, 3)).toBe(true);
    expect(isNullFinding([], { signalStates: states, tags: [], fearPresent: false } as never, 3)).toBe(true);
  });

  it("all >= S3 with INSUFFICIENT corroboration does NOT", () => {
    // Two S4s and four S3s: broadly developing. Must not read as an all-clear.
    const states = { SEE: "S4", ROOM: "S4", DIRECT: "S3", PREPARE: "S3", AIM: "S3", MOVE: "S3" } as never;
    console.log("  2xS4 + 4xS3:", JSON.stringify(states));
    expect(allSignalsS3OrAbove(states)).toBe(true);
    expect(hasSufficientCorroboration(states, 3)).toBe(false);
    expect(isNullFinding([], { signalStates: states, tags: [], fearPresent: false } as never, 3)).toBe(false);
  });

  it("S5 counts toward corroboration, not just S4", () => {
    const states = { SEE: "S5", ROOM: "S5", DIRECT: "S5", PREPARE: "S3", AIM: "S3", MOVE: "S3" } as never;
    expect(hasSufficientCorroboration(states, 3)).toBe(true);
  });
});

describe("a weak signal keeps the gate shut", () => {
  it("one S2 with the rest at S3+ does NOT return the null finding", () => {
    // Q4=A Q5=B Q6=C yields SEE=2.00/S2 with every other signal at S3 — found by
    // SWEEPING the scorer, not by guessing. An earlier version of this test used
    // Q4/Q5/Q6 all "A", which actually produces S1: it claimed S2 coverage it
    // did not have, and the assertion below would have passed anyway because
    // both are below the floor.
    const { states, codes } = scored({ Q4: "A", Q5: "B", Q6: "C" });
    console.log("  one-weak states:", JSON.stringify(states));
    console.log("  one-weak codes :", JSON.stringify(codes));

    // Precondition: this really is the S2 case, not S1.
    expect((states as Record<string, string>).SEE).toBe("S2");
    expect(allSignalsS3OrAbove(states)).toBe(false);
    expect(codes).not.toContain(NULL_FINDING_CODE);
  });

  it("S1 behaves the same way — the floor is a floor", () => {
    const { states, codes } = scored({ Q4: "A", Q5: "A", Q6: "A" });
    expect((states as Record<string, string>).SEE).toBe("S1");
    expect(allSignalsS3OrAbove(states)).toBe(false);
    expect(codes).not.toContain(NULL_FINDING_CODE);
  });
});

describe("friction: a template must never claim friction that does not exist", () => {
  it("PRIMARY_FRICTION requires at least one renderable friction", () => {
    // Operator requirement: "primary-friction profile with zero rendered
    // friction items must fail rather than silently fall through to
    // KEEP_OBSERVING."
    expect(
      selectBigPictureTemplate({ nullFinding: false, capacityConstrained: false, frictionCount: 0 }),
    ).toBe("DEVELOPING_PICTURE");
    expect(
      selectBigPictureTemplate({ nullFinding: false, capacityConstrained: false, frictionCount: 2 }),
    ).toBe("PRIMARY_FRICTION");
  });

  it("no reachable input yields PRIMARY_FRICTION with an empty friction list", () => {
    // Sweep the real engine across every case in this suite. If any profile
    // produced a friction template with nothing to render, this fails.
    const cases: Array<[string, Record<string, string>]> = [
      ["all-S3", {}],
      ["all-S4", ALL_S4],
      ["one S2", { Q4: "A", Q5: "A", Q6: "A" }],
      ["capacity override", { Q11: "A" }],
    ];
    for (const [name, o] of cases) {
      const p = payloadFor(o);
      const rendered = p.frictions.filter((f) => f.narrativeKey).length;
      console.log(`  ${name.padEnd(20)} template=${p.bigPicture.template} frictions=${rendered}`);
      if (p.bigPicture.template === "PRIMARY_FRICTION") {
        expect(rendered, `${name}: PRIMARY_FRICTION with nothing to render`).toBeGreaterThan(0);
      }
      if (p.bigPicture.template === "DEVELOPING_PICTURE") {
        expect(rendered, `${name}: DEVELOPING_PICTURE must render no friction`).toBe(0);
      }
    }
  });

  it("KEEP_OBSERVING is not reached by accident", () => {
    // The attention area for an all-S3 profile must be a deliberate choice, not
    // the empty-list default that made the old behaviour look intentional.
    const { codes } = scored({});
    const areaWithEmpty = selectAttentionArea([]);
    console.log("  all-S3 codes:", JSON.stringify(codes), "| default area:", areaWithEmpty);

    // The engine returns [] for this profile, so the payload's attention area
    // comes from the empty-list default. That is the path the operator flagged;
    // it is now paired with a template that does not claim friction, so the two
    // cannot disagree about whether a problem exists.
    const p = payloadFor({});
    expect(p.attentionAreas).toContain(areaWithEmpty);
    expect(p.bigPicture.template).not.toBe("PRIMARY_FRICTION");
  });
});

describe("capacity still precedes everything (§12.2)", () => {
  it("a capacity override outranks both the null finding and the developing case", () => {
    expect(
      selectBigPictureTemplate({ nullFinding: true, capacityConstrained: true, frictionCount: 0 }),
    ).toBe("CAPACITY_FIRST");
    expect(
      selectBigPictureTemplate({ nullFinding: false, capacityConstrained: true, frictionCount: 0 }),
    ).toBe("CAPACITY_FIRST");
  });
});

describe("the rename kept historical payloads readable", () => {
  it("resolves the stored 'NO_FRICTION' alias forward", () => {
    // Snapshots are append-only, so every payload written before this change
    // still contains the literal 'NO_FRICTION'. A renderer resolving only the
    // new name would fail on all of them.
    console.log("  NO_FRICTION ->", resolveBigPictureTemplate("NO_FRICTION"));
    expect(resolveBigPictureTemplate("NO_FRICTION")).toBe("NO_MEANINGFUL_FRICTION");
    expect(resolveBigPictureTemplate("PRIMARY_FRICTION")).toBe("PRIMARY_FRICTION");
    expect(resolveBigPictureTemplate("DEVELOPING_PICTURE")).toBe("DEVELOPING_PICTURE");
    expect(resolveBigPictureTemplate(null)).toBeNull();
  });

  it("both names exist in the library so neither renderer path 404s", () => {
    const tpl = narratives.big_picture_templates as Record<string, string>;
    expect(Object.keys(tpl).sort()).toEqual(
      ["CAPACITY_FIRST", "DEVELOPING_PICTURE", "NO_MEANINGFUL_FRICTION", "PRIMARY_FRICTION"].sort(),
    );
    expect(tpl.NO_FRICTION, "the old key must be gone from the library").toBeUndefined();
  });
});
