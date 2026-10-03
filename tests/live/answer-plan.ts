// The live-QA answer plan — validated by REQUIRED ITEM ID, never by position.
//
// WHY THIS FILE EXISTS, AND WHY IT IS IN THE REPO.
//
// Live lifecycle verification was driven by a throwaway script in /tmp. That
// script built its answers as a hardcoded list and took `slice(0, 31)` of it.
// The list had 33 entries, the vocabulary was in a different order than the
// harness assumed, and the effect was that the run silently posted 29 of the 31
// required responses while reporting success. Every completion then failed with
// "missing: Q9, Q16, ..." and it was briefly possible to mistake that for an
// application defect. It was a TEST-HARNESS defect, and the operator called it
// out precisely:
//
//   "Verify that the authoritative assessment plan explicitly identifies the
//    exact 31 required responses rather than relying on positional slicing of a
//    larger collection. ... Prefer validation by required question IDs/keys over
//    array position alone."
//
// So this file does three things differently:
//
//   1. It derives the item list from `REQUIRED_ITEM_IDS` — the SAME constant the
//      application's completeness gate uses (lib/assessment/validation.ts). There
//      is no second list to drift.
//   2. It validates by ID and membership, not by count or position, and it
//      throws on all four failure modes the operator named.
//   3. It lives in the repo, so the pre-pilot re-run uses the fixed harness
//      rather than a shell history.
//
// Kept out of the vitest include glob (tests/live/) because it is not a test —
// it is the plan the live verification will post. Its own correctness is proven
// by tests/integration/live-answer-plan.test.ts, which DOES run in the suite.

import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";

/** One item to answer, in the shape the response route accepts. */
export interface PlannedAnswer {
  itemId: string;
  /** The full option codes to select. Always an array — see `checkSelection`. */
  optionCodes: string[];
}

/**
 * Neutral answers, keyed by the item ids the APPLICATION says are required.
 *
 * The letters are verified against the real bank by
 * tests/unit/build-profile.test.ts, which loads config/assessment-v1.0.json and
 * checks every default exists as an option on its item. Reusing those letters
 * here rather than inventing a parallel set means a bank change breaks one
 * fixture, loudly, in the unit suite — instead of silently invalidating the
 * live run.
 *
 * The four classifiers take FULL option codes, not bare letters: checkSelection
 * compares against `q.options[].code`, and a bare "B" is an unknown code for Q1.
 * That distinction is what the /tmp script got wrong.
 */
const NEUTRAL: Record<string, string[]> = {
  OPEN_A: ["OPEN_A_A"],
  OPEN_B: ["OPEN_B_C"],
  Q1: ["Q1_B"],
  Q2: ["Q2_C"],
  Q3: ["Q3_C"],
  Q4: ["Q4_C"],
  Q5: ["Q5_C"],
  Q6: ["Q6_C"],
  Q7: ["Q7_C"],
  Q8: ["Q8_C"],
  Q9: ["Q9_L"],
  Q10: ["Q10_C"],
  Q11: ["Q11_C"],
  Q12: ["Q12_C"],
  Q13: ["Q13_C"],
  Q14: ["Q14_C"],
  Q15: ["Q15_C"],
  Q16: ["Q16_A"],
  Q17: ["Q17_C"],
  Q18: ["Q18_C"],
  Q19: ["Q19_C"],
  Q20: ["Q20_C"],
  Q21: ["Q21_G"],
  Q22: ["Q22_C"],
  Q23: ["Q23_C"],
  Q24: ["Q24_C"],
  Q25: ["Q25_C"],
  A1: ["A1_C"],
  A2: ["A2_C"],
  A3: ["A3_C"],
  A4: ["A4_C"],
};

/** The live run posts exactly this many items. Named so it cannot be a magic number. */
export const EXPECTED_RESPONSE_COUNT = 31;

export class AnswerPlanError extends Error {}

/**
 * Validate a plan by ID, and throw on every failure mode the operator listed.
 *
 * Deliberately NOT a count check. A plan with 31 entries that swapped Q24 for
 * a duplicated Q23 has the right count and the wrong membership, and a count
 * check passes it — which is the whole defect this replaces.
 */
export function assertPlanIsComplete(plan: PlannedAnswer[]): void {
  const ids = plan.map((p) => p.itemId);

  // 1. Duplicates. Two entries for one item means one required item is absent
  //    even when the arithmetic works out.
  const seen = new Set<string>();
  const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (duplicates.length > 0) {
    throw new AnswerPlanError(
      `answer plan has duplicate item(s): ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  // 2. A required question missing.
  const missing = REQUIRED_ITEM_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new AnswerPlanError(
      `answer plan is missing required item(s): ${missing.join(", ")} — ` +
        `this is the defect that silently posted 29 of 31`,
    );
  }

  // 3. A NON-required entry substituted in. D1–D3 are demographics and are not
  //    part of the 31; a plan that answers them and calls itself complete is
  //    wrong even though it has "enough" answers.
  const required = new Set<string>(REQUIRED_ITEM_IDS);
  const extra = ids.filter((id) => !required.has(id));
  if (extra.length > 0) {
    throw new AnswerPlanError(
      `answer plan contains non-required item(s): ${extra.join(", ")} — ` +
        `the 31 are OPEN_A, OPEN_B, Q1–Q25, A1–A4, and D1–D3 are excluded`,
    );
  }

  // 4. The count, last and only as a cross-check on top of the membership
  //    checks above. On its own it proves nothing.
  if (plan.length !== EXPECTED_RESPONSE_COUNT) {
    throw new AnswerPlanError(
      `answer plan has ${plan.length} entries, expected ${EXPECTED_RESPONSE_COUNT}`,
    );
  }
}

/**
 * The plan, built by walking `REQUIRED_ITEM_IDS` — the application's own list.
 *
 * ORDER COMES FROM THE APPLICATION, not from this file's key order, which is
 * what makes an ordering change safe: if the instrument's required order
 * changes, the plan follows it and every item is still answered. That is the
 * fourth failure mode the operator named.
 *
 * `overrides` replaces specific items (a live run may want a different
 * activation band); unknown ids throw, so a typo cannot silently no-op.
 */
export function buildAnswerPlan(
  overrides: Record<string, string[]> = {},
): PlannedAnswer[] {
  const required = new Set<string>(REQUIRED_ITEM_IDS);
  for (const [id, codes] of Object.entries(overrides)) {
    if (!required.has(id)) {
      throw new AnswerPlanError(`buildAnswerPlan: "${id}" is not a required item`);
    }
    if (!Array.isArray(codes) || codes.length === 0) {
      throw new AnswerPlanError(`buildAnswerPlan: "${id}" needs a non-empty option-code array`);
    }
  }

  const plan = REQUIRED_ITEM_IDS.map((itemId) => {
    const optionCodes = overrides[itemId] ?? NEUTRAL[itemId];
    if (!optionCodes || optionCodes.length === 0) {
      // A required item with no neutral answer is a gap in THIS file. Failing
      // here beats posting 30 items and discovering it as a completion failure.
      throw new AnswerPlanError(
        `buildAnswerPlan: no neutral answer defined for required item "${itemId}"`,
      );
    }
    return { itemId, optionCodes };
  });

  assertPlanIsComplete(plan);
  return plan;
}

/** The request body the response route expects for one planned item. */
export function toRequestBody(answer: PlannedAnswer): Record<string, unknown> {
  return { itemId: answer.itemId, optionCodes: answer.optionCodes };
}
