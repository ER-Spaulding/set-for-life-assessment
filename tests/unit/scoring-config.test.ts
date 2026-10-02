import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Scoring-config guards for config/scoring-v1.0.json (PRD §13–§15).
 *
 * Tension-code parity with the connection-statement library, classifier
 * sizes, special signal states, thresholds-as-configuration (PRD §15: the
 * engine reads this file — no numeric cutoff may live in code), and
 * visibility of ASSUMED_PENDING_OPERATOR_REVIEW calibration debt.
 */
const scoring = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const connections = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../config/connection-statements-v1.0.json"),
    "utf8",
  ),
);

/**
 * Counts string VALUES carrying the calibration-debt marker anywhere in the
 * scoring config, so assumed thresholds stay visible and cannot silently
 * disappear (or silently resolve without operator review).
 */
function countMarked(node: unknown, marker: string): number {
  if (typeof node === "string") return node.includes(marker) ? 1 : 0;
  if (Array.isArray(node))
    return node.reduce((n: number, v: unknown) => n + countMarked(v, marker), 0);
  if (node !== null && typeof node === "object")
    return Object.values(node as Record<string, unknown>).reduce(
      (n: number, v: unknown) => n + countMarked(v, marker),
      0,
    );
  return 0;
}

describe("scoring config (PRD §13–§15)", () => {
  it("defines exactly the 18 tension codes matching the connection library (PRD §15)", () => {
    // Exclude metadata keys (_prd_section, _notes) — they are documentation
    // inside the tensions block, not tension codes.
    const tensionCodes = Object.keys(scoring.tensions).filter(
      (k) => !k.startsWith("_"),
    );
    // The connection library gained `version` and `_version_note` on 2026-10-01
    // for the Snapshot version architecture. They describe the ARTIFACT rather
    // than naming a statement, so they are metadata on the same footing as
    // `_prd_section` — excluded here, because the assertion is about which
    // TENSIONS both files define.
    const METADATA = new Set(["version", "_version_note"]);
    const statementKeys = Object.keys(connections).filter(
      (k) => !k.startsWith("_") && !METADATA.has(k),
    );
    expect(tensionCodes).toHaveLength(18);
    // Bidirectional: no missing codes, no extra codes — report any difference.
    expect(new Set(tensionCodes)).toEqual(new Set(statementKeys));
  });

  it("sizes the classifiers exactly: Q1→7, Q9→13, Q16→11, Q21→8 (PRD §14)", () => {
    expect(
      Object.keys(scoring.classifiers.Q1_money_environment.tags),
    ).toHaveLength(7);
    expect(
      Object.keys(scoring.classifiers.Q9_capacity_context.tags),
    ).toHaveLength(13);
    expect(
      Object.keys(scoring.classifiers.Q16_destination.tags),
    ).toHaveLength(11);
    expect(
      Object.keys(scoring.classifiers.Q21_fear_friction.tags),
    ).toHaveLength(8);
  });

  it("declares the three special signal states (PRD §13.6–§13.7)", () => {
    for (const key of [
      "DIRECT_CAPACITY_LIMITED",
      "DIRECT_LIMITED_EVIDENCE_CAPACITY",
      "AIM_CAPACITY_CONSTRAINED_ALIGNMENT",
    ]) {
      expect(scoring.special_signal_states[key]).toBeDefined();
    }
  });

  it("keeps thresholds as configuration the engine can read (PRD §15)", () => {
    // Numeric band/threshold data must live in config, not code literals.
    expect(scoring.tension_thresholds).toBeDefined();
    // Skip metadata entries (_prd_section, _notes) inside .signals — only the
    // six signal blocks carry a `states` map with numeric bands.
    const signalBlocks = Object.values(scoring.signals).filter(
      (s): s is { states: Record<string, { min: number; max: number }> } =>
        typeof s === "object" &&
        s !== null &&
        "states" in s &&
        typeof (s as { states: unknown }).states === "object",
    );
    expect(signalBlocks).toHaveLength(6);
    for (const signal of signalBlocks) {
      for (const band of Object.values(signal.states)) {
        expect(typeof band.min).toBe("number");
        expect(typeof band.max).toBe("number");
      }
    }
  });

  it("keeps ASSUMED_PENDING_OPERATOR_REVIEW calibration debt visible", () => {
    const count = countMarked(scoring, "ASSUMED_PENDING_OPERATOR_REVIEW");
    console.log(
      `ASSUMED_PENDING_OPERATOR_REVIEW values in scoring config: ${count}`,
    );
    expect(count).toBeGreaterThan(0);
  });
});
