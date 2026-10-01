import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { classifyAll } from "@/lib/assessment/classifiers";
import {
  assembleSnapshotPayload,
  selectBigPictureTemplate,
  isCapacityConstrained,
  resolvePerceptionGap,
  NULL_FINDING_CODE,
} from "@/lib/assessment/snapshot-payload";

const cfg = JSON.parse(readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"));
const tables = loadScoringTables(cfg);
const cutoffs = loadQ18Cutoffs(cfg);

const VERSIONS = {
  assessment: "1.0",
  questionBank: "1.0",
  scoring: "1.0",
  narrative: "1.0",
  report: "1.0",
  // Addendum 01 v1.1 §3.1 requires this sixth pin. The type makes it
  // non-optional, which is the point: a fixture cannot quietly omit a version
  // the payload is required to carry.
  interstitial: "1.0",
};

/**
 * Build the letter map the scorer actually receives.
 *
 * `scoreAssessment` reads BARE LETTERS — `evaluateCapacityOverrides` compares
 * `q11Option === 'A'`, and `at()` looks up `responses[id]` directly. Production
 * converts option codes to letters in `toLetterMap` before calling the scorer,
 * so a fixture that passes "Q11_A" would silently exercise NOTHING (no override
 * fires, DIRECT comes back null) while looking correct. These tests use bare
 * letters for the same reason the route does.
 */
function build(overrides: Record<string, string> = {}) {
  const input: Record<string, string> = {};
  for (const it of ["OPEN_A","OPEN_B", ...[...Array(25)].map((_,i)=>`Q${i+1}`), "A1","A2","A3","A4"]) {
    input[it] = "C";
  }
  // Items whose option sets have no "C" or a different neutral.
  input.OPEN_A = "B"; input.OPEN_B = "C";
  input.Q3 = "C"; input.Q9 = "C"; input.Q10 = "C"; input.Q11 = "C"; input.Q12 = "C";
  input.Q16 = "A"; input.Q21 = "G";
  Object.assign(input, overrides);
  return input;
}

function assemble(overrides: Record<string, string> = {}) {
  const input = build(overrides);
  const scored = scoreAssessment(input as never, tables, cutoffs);
  const tags = Object.values(classifyAll({
    Q1: [input.Q1], Q9: [input.Q9], Q16: [input.Q16], Q21: [input.Q21],
  })).flat();
  const signalStates = Object.fromEntries(
    Object.entries(scored.signals).map(([k, v]) => [k, v.state ?? "S3"]),
  ) as never;
  const tensionCodes = evaluateTensions({
    signalStates,
    items: {},
    activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" },
    tags,
    fearPresent: input.Q21 !== "Q21_G",
  } as never, cfg);

  return assembleSnapshotPayload({
    versions: VERSIONS,
    signals: scored.signals,
    tensionCodes,
    classifierTags: tags,
    activationSelections: { A1: input.A1, A2: input.A2, A3: input.A3, A4: input.A4 },
    openingB: 3,
    q16Selections: [input.Q16],
    signalMeans: Object.fromEntries(
      Object.entries(scored.signals).map(([k, v]) => [k, v.value ?? 0]),
    ),
    perceptionGapConfig: cfg.perception_gap,
    moveSubsignals: scored.moveSubsignals as never,
  });
}

describe("snapshot payload — assembles without throwing", () => {
  it("produces a complete payload for a neutral profile", () => {
    const p = assemble();
    console.log("  signals:", p.signals.length, "| strengths:", p.strengths.length,
      "| frictions:", p.frictions.length, "| connections:", p.connections.length);
    console.log("  bigPicture:", p.bigPicture.template, JSON.stringify(p.bigPicture.parts));
    console.log("  perceptionGapStatus:", p.perceptionGapStatus);
    expect(p.signals).toHaveLength(6);
    expect(p.bigPicture.parts.length).toBeGreaterThan(0);
    expect(p.versions).toEqual(VERSIONS);
  });

  it("NEVER throws — the five profiles that exercise every branch", () => {
    // A throw here would fail the participant's completion for a reason
    // unrelated to their answers.
    const profiles: Array<[string, Record<string, string>]> = [
      ["neutral", {}],
      ["capacity override", { Q11: "A" }],
      ["dual override", { Q11: "A", Q12: "F" }],
      ["fear + high activation", { Q21: "A", A1: "D" }],
      ["extreme spread", { Q4: "E", Q5: "E", Q6: "E", Q7: "A", Q8: "A" }],
    ];
    for (const [name, o] of profiles) {
      expect(() => assemble(o), `profile "${name}" must not throw`).not.toThrow();
    }
  });
});

describe("capacity precedes friction (Addendum §12.2)", () => {
  it("CAPACITY_FIRST wins over PRIMARY_FRICTION", () => {
    expect(selectBigPictureTemplate({ nullFinding: false, capacityConstrained: true }))
      .toBe("CAPACITY_FIRST");
    expect(selectBigPictureTemplate({ nullFinding: false, capacityConstrained: false }))
      .toBe("PRIMARY_FRICTION");
    expect(selectBigPictureTemplate({ nullFinding: true, capacityConstrained: false }))
      .toBe("NO_FRICTION");
  });

  it("a capacity override is detected from the scorer's own specialState", () => {
    const p = assemble({ Q11: "A" });
    const direct = p.signals.find((s) => s.signal === "DIRECT")!;
    console.log("  DIRECT:", JSON.stringify(direct));
    expect(direct.specialState).toBe("DIRECT_CAPACITY_LIMITED");
    expect(direct.narrativeKey).toBe("special_signal_states.DIRECT_CAPACITY_LIMITED");
    expect(p.bigPicture.template).toBe("CAPACITY_FIRST");
  });
});

describe("perception gap records WHY it is absent (§12.3, §18)", () => {
  it("reports 'method_pending' when Q16 is answered but the method is unspecified", () => {
    // The distinction that matters: this is a BUILD gap, not a participant
    // state. Reporting it as 'not_ready' would present a missing feature as a
    // characteristic of the participant.
    const p = assemble({ Q16: "A" });
    console.log("  status:", p.perceptionGapStatus, "| gap:", p.perceptionGap);
    expect(p.perceptionGapStatus).toBe("method_pending");
    expect(p.perceptionGap).toBeNull();
  });

  it("never invents a gap to fill the report", () => {
    const p = assemble();
    expect(p.perceptionGap).toBeNull();
  });
});

describe("null finding does not manufacture friction (§12.1)", () => {
  it("NO_FRICTION template when the engine returns the null code", () => {
    const r = assembleSnapshotPayload({
      versions: VERSIONS,
      signals: {} as never,
      tensionCodes: [NULL_FINDING_CODE],
      classifierTags: [],
      activationSelections: { A1: "C", A2: "C", A3: "C", A4: "C" },
      openingB: null, q16Selections: [], signalMeans: {},
      perceptionGapConfig: cfg.perception_gap,
      moveSubsignals: {},
    });
    console.log("  nullFinding:", r.nullFinding, "| template:", r.bigPicture.template);
    expect(r.nullFinding).toBe(true);
    expect(r.bigPicture.template).toBe("NO_FRICTION");
    // No friction language manufactured.
    expect(r.frictions).toHaveLength(0);
  });
});

describe("every part of the payload is a resolvable approved key", () => {
  it("signal narrative keys follow the library's shape", () => {
    const p = assemble({ Q11: "A" });
    for (const s of p.signals) {
      if (!s.narrativeKey) continue;
      const ok = s.narrativeKey.startsWith("special_signal_states.")
        || /^signal_states\.[A-Z]+\.[S][1-5]$/.test(s.narrativeKey);
      expect(ok, `unexpected key shape: ${s.narrativeKey}`).toBe(true);
    }
  });

  it("bigPicture parts are all non-empty keys", () => {
    const p = assemble({ Q4: "E", Q5: "E", Q6: "E" });
    for (const part of p.bigPicture.parts) {
      expect(part.length).toBeGreaterThan(0);
      expect(part).not.toContain("undefined");
    }
  });
});

describe("activation is four separate dimensions, never averaged (§11, §17)", () => {
  it("carries A1–A4 individually with no aggregate", () => {
    const p = assemble({ A1: "D", A2: "C", A3: "E", A4: "A" });
    console.log("  activation:", JSON.stringify(p.activation));
    expect(Object.keys(p.activation).sort()).toEqual(["A1","A2","A3","A4"]);
    expect(p.activation).not.toHaveProperty("score");
    expect(p.activation).not.toHaveProperty("average");
  });
});

describe("interstitial version pin (Addendum 01 v1.1 §3.1)", () => {
  it("the payload carries all six pinned versions, including interstitial", () => {
    // §3.1: "pin assessment, question-bank, scoring/config, narrative,
    // interstitial, and report versions." The payload previously pinned five.
    const r = assembleSnapshotPayload({
      versions: VERSIONS,
      signals: {} as never,
      tensionCodes: [],
      classifierTags: [],
      activationSelections: { A1: "C", A2: "C", A3: "C", A4: "C" },
      openingB: null, q16Selections: [], signalMeans: {},
      perceptionGapConfig: cfg.perception_gap,
      moveSubsignals: {},
    } as never);

    console.log("  payload versions:", JSON.stringify(r.versions));
    expect(Object.keys(r.versions).sort()).toEqual(
      ["assessment", "interstitial", "narrative", "questionBank", "report", "scoring"].sort(),
    );
    expect(r.versions.interstitial).toBe("1.0");
  });

  it("the interstitial config it pins is the one the Money Moments come from", () => {
    // Guards the failure mode where the pin cites a version but nothing ties
    // that version to the content actually shown. If the interstitial config
    // is revised without its version moving, the pin silently lies — the same
    // class of defect as §D-7's hardcoded narrative version.
    const interstitial = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/interstitial-v1.0.json"), "utf8"),
    ) as { version?: string; moneyMoments?: unknown[] };

    console.log("  interstitial config version:", interstitial.version);
    expect(typeof interstitial.version).toBe("string");
    expect(interstitial.version).toBe(VERSIONS.interstitial);
    expect(interstitial.moneyMoments).toHaveLength(5);
  });
});
