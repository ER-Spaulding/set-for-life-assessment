import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveEvidenceConfidence,
  deriveEvidenceStrength,
  loadConfidenceDerivation,
} from "@/lib/assessment/evidence-chain";

/**
 * Evidence-confidence DERIVATION (PRD §19.1).
 *
 * WHY THIS TEST EXISTS.
 *
 * `computed_signals.evidence_confidence` was written as a hardcoded "high" for
 * every signal, flagged in-file as `UNRESOLVED_CONFIDENCE`. The tier is not
 * decoration: PRD §19.1 selects participant-facing language strength by it —
 *
 *     high     -> "Your responses show…"
 *     moderate -> "Your responses suggest…"
 *     limited  -> "One possibility worth examining is…"
 *
 * so a blanket "high" would address a participant whose evidence was thin with
 * unwarranted certainty. The type and the DB column both existed and were
 * tested; the DERIVATION between them did not, which is why the placeholder
 * survived a green suite.
 *
 * The spec names the three tiers but states no numeric rule, so the derivation
 * is CONFIG-DRIVEN (PRD §15) from `language_strength.derivation`. The last test
 * below proves that: it mutates the thresholds and the output changes.
 */

const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const derivation = loadConfidenceDerivation(scoringCfg);

/** Deep clone so a mutation test cannot leak into the shared config. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const CONFIDENCE_VALUES = ["high", "moderate", "limited"];

describe("deriveEvidenceConfidence — the rule matches the config's prose bands", () => {
  it("an EXTREME state with strong corroboration is HIGH", () => {
    // Config HIGH band: "Strong corroborated evidence (e.g. extreme signal
    // state S1/S5 with 2+ corroborating items or tensions)."
    for (const state of ["S1", "S5"] as const) {
      const got = deriveEvidenceConfidence(
        { state, specialState: null, corroboration: 3 },
        derivation,
      );
      console.log(`  ${state} + corroboration 3 -> ${got}`);
      expect(got).toBe("high");
    }
  });

  it("an EXTREME state WITHOUT corroboration is not HIGH", () => {
    // A single item cannot carry "strong corroborated evidence" — the band
    // explicitly requires 2+, so a lone extreme value must drop a tier.
    const got = deriveEvidenceConfidence(
      { state: "S5", specialState: null, corroboration: 1 },
      derivation,
    );
    console.log(`  S5 + corroboration 1 -> ${got}`);
    expect(got).not.toBe("high");
  });

  it("a capacity override is LIMITED regardless of how strong the value looks", () => {
    // Config LIMITED band: "Override-constrained, single-item, or
    // classifier-only contextual evidence." A capacity override means the
    // numeric value is context-constrained BY DEFINITION — verified end to end
    // in complete-session-end-to-end.test.ts, where DIRECT persists value 5
    // with state S5 yet a 'limited' confidence.
    const got = deriveEvidenceConfidence(
      { state: "S5", specialState: "DIRECT_CAPACITY_LIMITED", corroboration: 3 },
      derivation,
    );
    console.log(`  S5 + override -> ${got}`);
    expect(got).toBe("limited");
  });

  it("a thin single-source signal is LIMITED", () => {
    const got = deriveEvidenceConfidence(
      { state: "S3", specialState: null, corroboration: 1 },
      derivation,
    );
    console.log(`  S3 + corroboration 1 -> ${got}`);
    expect(got).toBe("limited");
  });

  it("a middling S3 with corroboration rises to MODERATE", () => {
    const got = deriveEvidenceConfidence(
      { state: "S3", specialState: null, corroboration: 2 },
      derivation,
    );
    console.log(`  S3 + corroboration 2 -> ${got}`);
    expect(got).toBe("moderate");
  });

  it("a directional S2/S4 state is MODERATE on its own", () => {
    // Config MODERATE band: "Single-signal or partially corroborated evidence
    // (e.g. S2/S4 states)."
    for (const state of ["S2", "S4"] as const) {
      const got = deriveEvidenceConfidence(
        { state, specialState: null, corroboration: 1 },
        derivation,
      );
      console.log(`  ${state} + corroboration 1 -> ${got}`);
      expect(got).toBe("moderate");
    }
  });

  it("no ladder state at all is LIMITED — there is no evidence to rate", () => {
    const got = deriveEvidenceConfidence(
      { state: null, specialState: null, corroboration: 0 },
      derivation,
    );
    expect(got).toBe("limited");
  });

  it("EVERY output is one of the three lowercase values the DB column accepts", () => {
    // The contract test (evidence-confidence-contract.test.ts) pins the values
    // to the schema; this pins the DERIVATION to the same set, so no reachable
    // input can produce a value the CHECK constraint would reject.
    const states = [null, "S1", "S2", "S3", "S4", "S5"] as const;
    const specials = [null, "DIRECT_CAPACITY_LIMITED"] as const;
    const seen = new Set<string>();
    for (const state of states) {
      for (const specialState of specials) {
        for (let c = 0; c <= 4; c++) {
          const got = deriveEvidenceConfidence(
            { state, specialState, corroboration: c },
            derivation,
          );
          seen.add(got);
          expect(CONFIDENCE_VALUES, `${String(state)}/${String(specialState)}/${c}`).toContain(got);
          // Never uppercase — the DB rejects 'HIGH'.
          expect(got).toBe(got.toLowerCase());
        }
      }
    }
    console.log("  values produced across the input space:", JSON.stringify([...seen].sort()));
  });
});

describe("the derivation is CONFIG-DRIVEN, not hardcoded (PRD §15)", () => {
  it("changing the config's thresholds changes the outcome with no code change", () => {
    const base = loadConfidenceDerivation(clone(scoringCfg));
    const input = { state: "S3" as const, specialState: null, corroboration: 2 };
    console.log("  default derivation ->", deriveEvidenceConfidence(input, base));
    expect(deriveEvidenceConfidence(input, base)).toBe("moderate");

    // Raise the bar so corroboration 2 no longer lifts an S3.
    const strict = clone(scoringCfg);
    strict.language_strength.derivation.moderate_corroboration_min = 4;
    const strictDerivation = loadConfidenceDerivation(strict);
    console.log("  raised threshold ->", deriveEvidenceConfidence(input, strictDerivation));
    expect(deriveEvidenceConfidence(input, strictDerivation)).toBe("limited");
  });

  it("changing which states count as extreme changes the outcome", () => {
    const mutated = clone(scoringCfg);
    mutated.language_strength.derivation.extreme_states = ["S3"];
    const d = loadConfidenceDerivation(mutated);
    // S3 is now "extreme", so strong corroboration makes it HIGH.
    const got = deriveEvidenceConfidence(
      { state: "S3", specialState: null, corroboration: 2 },
      d,
    );
    console.log("  S3 declared extreme ->", got);
    expect(got).toBe("high");
  });

  it("throws rather than defaulting when the derivation block is missing", () => {
    // A silent fallback would re-create the exact failure this replaced: a
    // tier that reflects no evidence at all.
    const broken = clone(scoringCfg);
    delete broken.language_strength.derivation;
    expect(() => loadConfidenceDerivation(broken)).toThrow(/language_strength\.derivation/);
  });

  it("the shipped config carries a calibration status and documents the rule", () => {
    const d = scoringCfg.language_strength.derivation;
    console.log("  calibration status:", d._calibration_status);

    // This asserted ASSUMED_PENDING_OPERATOR_REVIEW. On 2026-10-01 the operator
    // APPROVED these values for the pilot (strong=2, moderate=2) as "initial
    // calibration values, not permanently validated constants", so the status
    // moved to PILOT_APPROVED. The assertion now checks that the field states
    // WHICH kind of status it is, rather than pinning one value — because the
    // next legitimate state change is an evidence-based recalibration, and a
    // test that fails on every approval trains people to edit the test.
    //
    // What must NOT happen is the field disappearing or being blank: an
    // unlabelled derivation is a calibration decision hiding as a default.
    expect(typeof d._calibration_status).toBe("string");
    expect(d._calibration_status.length).toBeGreaterThan(0);
    expect(
      d._calibration_status,
      "the status must say whether this is assumed or approved, and by whom",
    ).toMatch(/ASSUMED|APPROVED/);

    // Approval does not remove the obligation to stay revisable.
    if (d._calibration_status.startsWith("PILOT_APPROVED")) {
      expect(
        typeof d._calibration_note,
        "an approved calibration must record its revision protocol",
      ).toBe("string");
      expect(d._calibration_note).toMatch(/version/i);
    }

    expect(typeof d._rule).toBe("string");
    expect(d._rule.length).toBeGreaterThan(20);
  });
});

describe("deriveEvidenceStrength — limitedReason preserves capacity vs thin evidence (§10)", () => {
  it("a capacity override yields LIMITED with reason CAPACITY_CONTEXT", () => {
    // Addendum 01 v1.1 §10: AGENCY_EVIDENCE=LIMITED_DUE_TO_CAPACITY_CONTEXT must
    // stay distinguishable from genuinely weak Agency. A capacity override makes
    // specialState non-null, so its LIMITED tier carries CAPACITY_CONTEXT.
    const got = deriveEvidenceStrength(
      { state: "S5", specialState: "DIRECT_CAPACITY_LIMITED", corroboration: 3 },
      derivation,
    );
    console.log("  override ->", JSON.stringify(got));
    expect(got.confidence).toBe("limited");
    expect(got.limitedReason).toBe("CAPACITY_CONTEXT");
  });

  it("a genuinely thin signal yields LIMITED with reason THIN_EVIDENCE", () => {
    // No override, but the responses provide little to go on. This is the
    // weak-Agency reading the capacity reason must NOT be confused with.
    const got = deriveEvidenceStrength(
      { state: "S3", specialState: null, corroboration: 1 },
      derivation,
    );
    console.log("  thin ->", JSON.stringify(got));
    expect(got.confidence).toBe("limited");
    expect(got.limitedReason).toBe("THIN_EVIDENCE");
  });

  it("non-limited confidence carries a null limitedReason", () => {
    for (const [state, corroboration] of [["S5", 3], ["S4", 1], ["S3", 2]] as const) {
      const got = deriveEvidenceStrength(
        { state, specialState: null, corroboration },
        derivation,
      );
      expect(got.confidence, `${state}/${corroboration}`).not.toBe("limited");
      expect(got.limitedReason, `${state}/${corroboration} must have no reason`).toBeNull();
    }
  });

  it("the strength's confidence EQUALS deriveEvidenceConfidence — never disagrees", () => {
    const states = [null, "S1", "S2", "S3", "S4", "S5"] as const;
    const specials = [null, "DIRECT_CAPACITY_LIMITED"] as const;
    for (const state of states) {
      for (const specialState of specials) {
        for (let c = 0; c <= 4; c++) {
          const args = { state, specialState, corroboration: c };
          expect(deriveEvidenceStrength(args, derivation).confidence).toBe(
            deriveEvidenceConfidence(args, derivation),
          );
        }
      }
    }
  });
});
