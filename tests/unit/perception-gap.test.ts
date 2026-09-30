import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluatePerceptionGap,
  isReadyToFinalize,
  narrativeKeyFor,
  PerceptionGapMethodUnspecifiedError,
  PERCEPTION_GAP_CODES,
} from "@/lib/assessment/perception-gap";

/**
 * Perception Gap — PRD §16, §29 acceptance test 15.
 *
 * Two things are being guarded here, and they pull in opposite directions:
 *
 *   1. The GATE must hold: Opening B cannot be finalised before Q16 is
 *      available (PRD §29 test 15).
 *   2. The MODULE must refuse to guess the comparison method. The PRD names
 *      four outcomes but no numeric method, so inventing one would silently
 *      decide how every participant is told their self-perception relates to
 *      their answers. It must throw, not default.
 */

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

const baseInput = {
  openingB: 4,
  signalMeans: { SEE: 3, ROOM: 3, DIRECT: 3, PREPARE: 3, AIM: 3, MOVE: 3 },
};

describe("PRD §29 test 15 — the Q16 gate", () => {
  it("refuses to finalise when Q16 selections are absent", () => {
    const r = evaluatePerceptionGap({
      ...baseInput,
      q16Selections: [],
      config: scoringCfg.perception_gap,
    });
    expect(r.status).toBe("not_ready");
    if (r.status === "not_ready") {
      expect(r.reason).toMatch(/Q16/);
    }
  });

  it("treats null/undefined Q16 the same as empty", () => {
    expect(isReadyToFinalize(null)).toBe(false);
    expect(isReadyToFinalize(undefined)).toBe(false);
    expect(isReadyToFinalize([])).toBe(false);
    expect(isReadyToFinalize(["Q16_A"])).toBe(true);
  });
});

describe("the comparison method is unspecified — the module must not invent one", () => {
  it("throws rather than guessing when the config method is TBD", () => {
    // The shipped config records comparison_method as
    // TBD_PENDING_OPERATOR_REVIEW. With the gate satisfied, proceeding would
    // require inventing a threshold, so this must throw.
    expect(scoringCfg.perception_gap.comparison_method).toBe(
      "TBD_PENDING_OPERATOR_REVIEW",
    );
    expect(() =>
      evaluatePerceptionGap({
        ...baseInput,
        q16Selections: ["Q16_A"],
        config: scoringCfg.perception_gap,
      }),
    ).toThrow(PerceptionGapMethodUnspecifiedError);
  });

  it("still throws for a configured-but-unimplemented method, rather than defaulting", () => {
    expect(() =>
      evaluatePerceptionGap({
        ...baseInput,
        q16Selections: ["Q16_A"],
        config: { comparison_method: "SOME_FUTURE_METHOD" },
      }),
    ).toThrow(/not implemented/);
  });
});

describe("outcome codes", () => {
  it("exposes exactly the four approved outcomes", () => {
    expect([...PERCEPTION_GAP_CODES].sort()).toEqual([
      "PERCEPTION_ALIGNED",
      "PERCEPTION_MIXED_COMPLEX",
      "PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE",
      "PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE",
    ]);
  });

  it("maps a code to its approved library key — never to copy", () => {
    // PRD §19: this module selects keys; the library owns the words.
    for (const code of PERCEPTION_GAP_CODES) {
      expect(narrativeKeyFor(code)).toBe(`perception_gap.${code}`);
    }
  });

  it("every mapped key resolves in the approved library", () => {
    const narratives = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/narratives-v1.0.json"), "utf8"),
    );
    for (const code of PERCEPTION_GAP_CODES) {
      expect(narratives.perception_gap[code], `${code} in library`).toBeDefined();
    }
  });
});
