import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  levelForOption,
  levelsForActivation,
  a4Consent,
  A4_SAFEGUARD,
} from "@/lib/assessment/activation";

/**
 * Activation safeguards — PRD §11, §29 acceptance tests 8 and 9.
 *
 * Two independent guarantees, both of which are product commitments rather
 * than technicalities:
 *
 *   8. Activation separation — A1–A4 describe readiness, not financial
 *      condition. Changing them must never move an operating signal, and they
 *      must never be collapsed into one "motivation score."
 *
 *   9. Support readiness — A4 measures openness to professional guidance. It
 *      is NOT consent. High A4 must never create appointment consent,
 *      marketing consent, or an automatic service route. The spec is explicit
 *      that a preference not to explore guidance "does not count as financial
 *      friction" (approved narrative library, A4/LOW).
 */

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

describe("PRD §11 — activation level mapping", () => {
  it("collapses the 5-point scale as LOW=A/B, MID=C, HIGH=D/E", () => {
    expect(levelForOption("A")).toBe("LOW");
    expect(levelForOption("B")).toBe("LOW");
    expect(levelForOption("C")).toBe("MID");
    expect(levelForOption("D")).toBe("HIGH");
    expect(levelForOption("E")).toBe("HIGH");
  });

  it("agrees with the bands recorded in config", () => {
    // The config carries its own LOW/MID/HIGH bands; code and config must not
    // drift apart on a mapping that drives participant-facing copy.
    const bands = scoringCfg.activation?.level_bands;
    if (bands) {
      const letters = (b: unknown): string[] =>
        Array.isArray(b) ? b : (b as { letters?: string[] })?.letters ?? [];
      if (letters(bands.LOW).length) {
        for (const l of letters(bands.LOW)) expect(levelForOption(l)).toBe("LOW");
        for (const l of letters(bands.MID)) expect(levelForOption(l)).toBe("MID");
        for (const l of letters(bands.HIGH)) expect(levelForOption(l)).toBe("HIGH");
      }
    }
  });
});

describe("PRD §11 — A1–A4 are never averaged", () => {
  it("returns four separate values, not a scalar", () => {
    const r = levelsForActivation({ A1: "A", A2: "C", A3: "E", A4: "D" });
    expect(r).toEqual({ A1: "LOW", A2: "MID", A3: "HIGH", A4: "HIGH" });
    expect(typeof r).toBe("object");
  });

  it("exposes no combined score anywhere in its output", () => {
    // Spread to a plain object: ActivationLevels is a closed shape with no
    // index signature, and this test is deliberately probing for keys the type
    // does not declare — which is the point.
    const r = { ...levelsForActivation({ A1: "E", A2: "E", A3: "E", A4: "E" }) } as Record<
      string,
      unknown
    >;
    const forbidden = /average|mean|combined|total|score|index|composite|overall/i;
    for (const key of Object.keys(r)) {
      expect(key, `no aggregate key "${key}"`).not.toMatch(forbidden);
    }
  });
});

describe("PRD §29 test 9 — A4 never implies consent", () => {
  it("returns every consent flag false, at every activation level", () => {
    // The safeguard must not depend on A4's value: even a maximal A4 response
    // is a statement of openness, not permission.
    const c = a4Consent();
    expect(c.appointmentConsent).toBe(false);
    expect(c.marketingConsent).toBe(false);
    expect(c.automaticProfessionalRoute).toBe(false);
  });

  it("carries the safeguard text for callers that surface it", () => {
    expect(A4_SAFEGUARD).toMatch(/not appointment consent/i);
    expect(A4_SAFEGUARD).toMatch(/marketing consent/i);
  });

  it("keeps A4 out of any consent-shaped return value", () => {
    const c = a4Consent() as Record<string, unknown>;
    for (const [k, v] of Object.entries(c)) {
      expect(typeof v, `${k} must be a boolean flag`).toBe("boolean");
      expect(v, `${k} must be false`).toBe(false);
    }
  });
});
