import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";

/**
 * Synthetic-profile builder — PRD §29 acceptance-test support.
 *
 * Produces complete 31-item response sets (OPEN_A, OPEN_B, Q1–Q25, A1–A4)
 * from a compact spec: every item defaults to a neutral "middle" answer and
 * the caller overrides only the items a test cares about.
 *
 * Option letters verified against config/assessment-v1.0.json (see
 * tests/unit/build-profile.test.ts — it loads the real bank and checks every
 * default below exists):
 *   - single-select profile items (Q2–Q8, Q10, Q11, Q13–Q15, Q17–Q20,
 *     Q22–Q25): bare letters A–E, low-to-high left-to-right in the instrument.
 *   - Q11: A–E, where Q11_A is the capacity override (no numeric value).
 *   - Q12: A–F, where Q12_F is the capacity override (no numeric value).
 *   - OPEN_A: A/B. OPEN_B: A–E. A1–A4: A–E (activation bands LOW=A/B,
 *     MID=C, HIGH=D/E — see lib/assessment/activation.ts).
 *   - Classifiers take FULL option-code arrays, not letters:
 *     Q1 (max 2): Q1_A–Q1_G. Q9 (max 3, Q9_L exclusive): Q9_A–Q9_M.
 *     Q16 (max 3): Q16_A–Q16_K. Q21 (max 2, Q21_G exclusive): Q21_A–Q21_H.
 *
 * A malformed fixture fails LOUDLY (throws) instead of silently scoring a
 * partial set: unknown item ids, wrong value shapes, and incomplete profiles
 * are all rejected here, before the engine ever sees them.
 */

/** One synthetic participant's full 31-item answer set. */
export interface SyntheticProfile {
  /**
   * All 31 required ids → answer. Single-selects (incl. OPEN_A/B, A1–A4)
   * hold a bare option letter; the four classifiers (Q1, Q9, Q16, Q21) hold
   * arrays of full option codes.
   */
  answers: Record<string, string | string[]>;
  /** Classifier selections as full option-code arrays (mirrors answers). */
  selections: {
    Q1: string[];
    Q9: string[];
    Q16: string[];
    Q21: string[];
  };
}

/** Compact spec: item id → bare letter (single-selects) or code array. */
export type ProfileOverrides = Record<string, string | string[]>;

const CLASSIFIER_IDS = ["Q1", "Q9", "Q16", "Q21"] as const;
const CLASSIFIER_SET = new Set<string>(CLASSIFIER_IDS);

/**
 * Neutral defaults: every profile item at its middle ("C", value 3),
 * classifiers at their explicit no-friction options, activation at MID.
 * Q1_B (mixed learning) and Q16_A (peace/reduced stress) emit neutral tags
 * that appear in no friction rule; Q9_L and Q21_G are the exclusive
 * no-pressure / no-fear options, so the default profile carries no
 * meaningful contextual friction (PRD §18.3 null-finding gate).
 */
const DEFAULT_ANSWERS: Record<string, string | string[]> = {
  OPEN_A: "A",
  OPEN_B: "C",
  Q1: ["Q1_B"],
  Q2: "C",
  Q3: "C",
  Q4: "C",
  Q5: "C",
  Q6: "C",
  Q7: "C",
  Q8: "C",
  Q9: ["Q9_L"],
  Q10: "C",
  Q11: "C",
  Q12: "C",
  Q13: "C",
  Q14: "C",
  Q15: "C",
  Q16: ["Q16_A"],
  Q17: "C",
  Q18: "C",
  Q19: "C",
  Q20: "C",
  Q21: ["Q21_G"],
  Q22: "C",
  Q23: "C",
  Q24: "C",
  Q25: "C",
  A1: "C",
  A2: "C",
  A3: "C",
  A4: "C",
};

/** Throw unless the profile answers all 31 required items. */
export function assertComplete(profile: SyntheticProfile): void {
  const missing = REQUIRED_ITEM_IDS.filter((id) => {
    const v = profile.answers[id];
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    return String(v).trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `synthetic profile incomplete — missing required item(s): ${missing.join(", ")}`,
    );
  }
}

/**
 * Build a complete 31-item profile. All items default to the neutral middle;
 * `overrides` replaces specific items. Override values must be a bare letter
 * (A–F) for single-selects or a non-empty full-code array for the four
 * classifiers. Unknown item ids throw (typo guard).
 */
export function buildProfile(
  overrides: ProfileOverrides = {},
): SyntheticProfile {
  for (const key of Object.keys(overrides)) {
    if (!REQUIRED_ITEM_IDS.includes(key)) {
      throw new Error(
        `buildProfile: unknown item id "${key}" — expected one of the 31 required ids`,
      );
    }
    const value = overrides[key];
    if (CLASSIFIER_SET.has(key)) {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          `buildProfile: classifier ${key} expects a non-empty array of full option codes (e.g. ["Q21_G"])`,
        );
      }
    } else if (typeof value !== "string" || !/^[A-F]$/.test(value)) {
      throw new Error(
        `buildProfile: ${key} expects a single bare option letter A–F, got ${JSON.stringify(value)}`,
      );
    }
  }

  const answers: Record<string, string | string[]> = {};
  for (const id of REQUIRED_ITEM_IDS) {
    if (id in overrides) {
      const v = overrides[id];
      answers[id] = Array.isArray(v) ? [...v] : v;
    } else {
      const d = DEFAULT_ANSWERS[id];
      if (d === undefined) {
        throw new Error(
          `buildProfile: no neutral default for required item "${id}"`,
        );
      }
      answers[id] = Array.isArray(d) ? [...d] : d;
    }
  }

  const profile: SyntheticProfile = {
    answers,
    selections: {
      Q1: [...(answers.Q1 as string[])],
      Q9: [...(answers.Q9 as string[])],
      Q16: [...(answers.Q16 as string[])],
      Q21: [...(answers.Q21 as string[])],
    },
  };
  assertComplete(profile);
  return profile;
}

/** Every scored item at its strongest (E / value 5). No capacity overrides. */
export function buildAllStrong(): SyntheticProfile {
  const overrides: ProfileOverrides = {
    OPEN_B: "E",
    Q2: "E",
    Q3: "E",
    Q4: "E",
    Q5: "E",
    Q6: "E",
    Q7: "E",
    Q8: "E",
    Q10: "E",
    Q11: "E",
    Q12: "E",
    Q13: "E",
    Q14: "E",
    Q15: "E",
    Q17: "E",
    Q18: "E",
    Q19: "E",
    Q20: "E",
    Q22: "E",
    Q23: "E",
    Q24: "E",
    Q25: "E",
    A1: "E",
    A2: "E",
    A3: "E",
    A4: "E",
    Q1: ["Q1_A"],
    Q9: ["Q9_L"],
    Q16: ["Q16_A"],
    Q21: ["Q21_G"],
  };
  return buildProfile(overrides);
}

/**
 * Every scored item at its weakest (A / value 1 — Q11 at B / value 2).
 *
 * Deliberate: "weak" means low-value answers, NOT the capacity overrides.
 * Q11_A and Q12_F are substantive capacity answers, not low-agency evidence
 * (PRD §13.4–§13.6), so they must not stand in for weakness here — Q11 takes
 * B (value 2, still item-low) and Q12 takes A (value 1).
 */
export function buildAllWeak(): SyntheticProfile {
  const overrides: ProfileOverrides = {
    OPEN_B: "A",
    Q2: "A",
    Q3: "A",
    Q4: "A",
    Q5: "A",
    Q6: "A",
    Q7: "A",
    Q8: "A",
    Q10: "A",
    Q11: "B",
    Q12: "A",
    Q13: "A",
    Q14: "A",
    Q15: "A",
    Q17: "A",
    Q18: "A",
    Q19: "A",
    Q20: "A",
    Q22: "A",
    Q23: "A",
    Q24: "A",
    Q25: "A",
    A1: "A",
    A2: "A",
    A3: "A",
    A4: "A",
    Q1: ["Q1_F"],
    Q9: ["Q9_A"],
    Q16: ["Q16_J"],
    Q21: ["Q21_B"],
  };
  return buildProfile(overrides);
}

/**
 * The letter-only input scoreAssessment() consumes. Classifier ids
 * (Q1/Q9/Q16/Q21) are arrays in the profile and are never read by scoring —
 * they are dropped here, not coerced. Throws on any non-letter value so a
 * malformed fixture fails loudly instead of scoring a partial set.
 */
export function scoringInput(profile: SyntheticProfile): Record<string, string> {
  assertComplete(profile);
  const out: Record<string, string> = {};
  for (const id of REQUIRED_ITEM_IDS) {
    if (CLASSIFIER_SET.has(id)) continue;
    const v = profile.answers[id];
    if (typeof v !== "string" || !/^[A-F]$/.test(v)) {
      throw new Error(
        `scoringInput: ${id} must hold a single bare option letter A–F, got ${JSON.stringify(v)}`,
      );
    }
    out[id] = v;
  }
  return out;
}
