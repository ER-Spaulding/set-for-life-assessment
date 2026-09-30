import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { levelsForActivation } from "@/lib/assessment/activation";

/**
 * Regression — activation-driven tension codes must be reachable from the
 * completion path.
 *
 * WHAT WENT WRONG (fixed 2026-09-30, found while repairing an unrelated
 * compile error).
 *
 * `lib/session/service.ts` called `evaluateTensions` with a HARDCODED
 * all-MID activation object:
 *
 *     activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" } as never,
 *
 * Two config rules read activation:
 *   HIGH_FEAR_HIGH_ACTIVATION            — any_activation_high: [A1, A2, A3]
 *   SUPPORT_OPENNESS_AGENCY_VULNERABILITY— activation_high:     [A4]
 *
 * No participant can be simultaneously all-MID and HIGH, so the `activation_*`
 * clause never evaluated true and BOTH codes were unreachable in production.
 * A participant who reported high urgency alongside financial fear received a
 * Snapshot with neither the fear-aware handling note (PRD §15: "Do not
 * increase pressure") nor the support-openness finding.
 *
 * WHY THE SUITE DID NOT CATCH IT. Every existing tension test constructs
 * `TensionInputs` itself and passes activation DIRECTLY to `evaluateTensions`.
 * That exercises the evaluator correctly but never the WIRING — the layer the
 * defect lived in. The evaluator was right the whole time; the value it was
 * handed was wrong. This is the write/read-convention false-green: a unit is
 * verified against a fixture that encodes the consumer's assumptions, so the
 * producer's real behaviour is never under test.
 *
 * So this file tests BOTH halves:
 *   1. BEHAVIOUR — the two codes really are reachable, with real values.
 *   2. WIRING — every production caller derives activation from the
 *      participant's own A1–A4 answers and passes no hardcoded literal.
 *
 * Half 2 is asserted structurally against the source text, the same technique
 * `acceptance-17-server-authority.test.ts` uses for the server-authority rule,
 * because the DB-bound `completeSession` cannot run without a database.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

/** Every item at the neutral midpoint unless overridden. */
function midItems(overrides: Record<string, number> = {}): Record<string, number> {
  const items: Record<string, number> = {};
  for (let i = 1; i <= 25; i++) items[`Q${i}`] = 3;
  return { ...items, ...overrides };
}

const MID_STATES = {
  SEE: "S3",
  ROOM: "S3",
  DIRECT: "S3",
  PREPARE: "S3",
  AIM: "S3",
  MOVE: "S3",
} as const;

function evalWith(
  activation: Record<string, string>,
  overrides: {
    items?: Record<string, number>;
    fearPresent?: boolean;
    tags?: string[];
  } = {},
) {
  return evaluateTensions(
    {
      signalStates: { ...MID_STATES },
      items: midItems(overrides.items),
      activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID", ...activation },
      tags: overrides.tags ?? [],
      fearPresent: overrides.fearPresent ?? false,
    },
    cfg,
  );
}

describe("activation-driven tension codes are REACHABLE (the behaviour the all-MID literal destroyed)", () => {
  it("HIGH_FEAR_HIGH_ACTIVATION fires when fear is present AND A1–A3 is HIGH", () => {
    const codes = evalWith(
      { A1: "HIGH", A2: "MID", A3: "MID" },
      { fearPresent: true },
    );
    console.log("  fear + A1 HIGH ->", JSON.stringify(codes));
    expect(codes).toContain("HIGH_FEAR_HIGH_ACTIVATION");
  });

  it("the same inputs with all-MID activation reproduce the defect: the code vanishes", () => {
    // This is the literal value the completion path used to hardcode. Asserting
    // it fails to fire documents WHY the bug was invisible: nothing threw,
    // nothing logged — the finding was simply absent.
    const codes = evalWith({}, { fearPresent: true });
    console.log("  fear + hardcoded all-MID ->", JSON.stringify(codes));
    expect(codes).not.toContain("HIGH_FEAR_HIGH_ACTIVATION");
  });

  it("SUPPORT_OPENNESS_AGENCY_VULNERABILITY fires when A4 is HIGH and Q22 is LOW", () => {
    const codes = evalWith({ A4: "HIGH" }, { items: { Q22: 1 } });
    console.log("  A4 HIGH + Q22 low ->", JSON.stringify(codes));
    expect(codes).toContain("SUPPORT_OPENNESS_AGENCY_VULNERABILITY");
  });

  it("the same inputs with all-MID activation reproduce the defect: the code vanishes", () => {
    const codes = evalWith({}, { items: { Q22: 1 } });
    console.log("  all-MID + Q22 low ->", JSON.stringify(codes));
    expect(codes).not.toContain("SUPPORT_OPENNESS_AGENCY_VULNERABILITY");
  });

  it("both codes are reachable TOGETHER from one real participant profile", () => {
    // The exact scenario from the fix: high urgency + high support openness +
    // fear + a weak Q22. Under the old hardcoded object this returned [].
    const codes = evalWith(
      { A1: "HIGH", A2: "MID", A3: "MID", A4: "HIGH" },
      { fearPresent: true, items: { Q22: 1 } },
    );
    console.log("  combined profile ->", JSON.stringify(codes));
    expect(codes).toEqual(
      expect.arrayContaining([
        "HIGH_FEAR_HIGH_ACTIVATION",
        "SUPPORT_OPENNESS_AGENCY_VULNERABILITY",
      ]),
    );
  });

  it("levelsForActivation maps the real option codes these rules depend on", () => {
    // Guards the other end of the wiring: the A1–A4 option ids the database
    // stores (A1_D, A4_E …) really do collapse to HIGH.
    const levels = levelsForActivation({
      A1: "A1_D",
      A2: "A2_C",
      A3: "A3_E",
      A4: "A4_D",
    });
    console.log("  levels:", JSON.stringify(levels));
    expect(levels).toEqual({ A1: "HIGH", A2: "MID", A3: "HIGH", A4: "HIGH" });
  });
});

describe("production callers DERIVE activation from the participant's answers (the wiring half)", () => {
  const serviceSrc = readFileSync(
    resolve(__dirname, "../../lib/session/service.ts"),
    "utf8",
  );
  const harnessSrc = readFileSync(
    resolve(__dirname, "../../app/api/internal/test-harness/run/route.ts"),
    "utf8",
  );

  it("no production caller hardcodes an all-MID activation literal", () => {
    // The precise shape that shipped. `as never` is included because that cast
    // is what suppressed the type error which would otherwise have flagged it.
    for (const [name, src] of [
      ["lib/session/service.ts", serviceSrc],
      ["app/api/internal/test-harness/run/route.ts", harnessSrc],
    ] as const) {
      expect(src, `${name} must not hardcode activation`).not.toMatch(
        /A1:\s*"MID"[\s\S]{0,80}A4:\s*"MID"/,
      );
    }
  });

  it("both callers build activation through levelsForActivation from A1–A4", () => {
    for (const [name, src] of [
      ["lib/session/service.ts", serviceSrc],
      ["app/api/internal/test-harness/run/route.ts", harnessSrc],
    ] as const) {
      const call = src.match(/levelsForActivation\(\{([\s\S]{0,200}?)\}\)/);
      expect(call, `${name} must call levelsForActivation`).not.toBeNull();
      for (const item of ["A1", "A2", "A3", "A4"]) {
        expect(call![1], `${name} must derive ${item}`).toContain(item);
      }
    }
  });

  it("both callers feed the LADDER state, not the display state, to the tension engine", () => {
    // The sibling defect: displayState becomes a SpecialSignalState under a
    // capacity override, and every trigger matches S1–S5 only — so an
    // overridden signal matched no rule. Both call sites must read `.state`.
    for (const [name, src] of [
      ["lib/session/service.ts", serviceSrc],
      ["app/api/internal/test-harness/run/route.ts", harnessSrc],
    ] as const) {
      const signalStates = src.match(
        /const signalStates = Object\.fromEntries\([\s\S]{0,300}?\)(?:\s+as\s+[^;]+)?;/,
      );
      expect(signalStates, `${name} must build signalStates`).not.toBeNull();
      const body = signalStates![0];
      expect(body, `${name} must read .state, not displayState`).not.toContain(
        "displayState",
      );
      expect(body).toContain(".state");
    }
  });

  it("both callers pass real classifier tags, not an empty list", () => {
    // The harness previously passed tags: [] so every tag-driven tension read
    // as "tag absent" regardless of the profile.
    for (const [name, src] of [
      ["lib/session/service.ts", serviceSrc],
      ["app/api/internal/test-harness/run/route.ts", harnessSrc],
    ] as const) {
      expect(src, `${name} must classify`).toContain("classifyAll(");
      expect(src, `${name} must flatten tags`).toContain("Object.values(tags).flat()");
    }
  });
});
