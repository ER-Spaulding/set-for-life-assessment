// PRD §14 — classifiers: assigns classifier tags from the config dictionary.
//
// Exact tag counts: Q1 → 7 tags, Q9 → 13 tags, Q16 → 11 tags, Q21 → 8 tags.
// Q9_L and Q21_G are EXCLUSIVE — selecting either excludes every other
// option in that question. Q9 contributes context tags only — no numeric
// value ever. Q1_G and Q16_J are explicitly NOT exclusive.
// Tag names below mirror config/scoring-v1.0.json `.classifiers` exactly.
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

/** Classifier question ids. */
export type ClassifierQuestionId =
  | 'Q1_money_environment'
  | 'Q9_capacity_context'
  | 'Q16_destination'
  | 'Q21_fear_friction';

/** Short aliases accepted by the helpers below. */
export type ClassifierQuestionShortId = 'Q1' | 'Q9' | 'Q16' | 'Q21';

/** Tag emitted per selected option, keyed by option id. */
const Q1_TAGS: Record<string, string> = {
  Q1_A: 'OPEN_MONEY_ENVIRONMENT',
  Q1_B: 'MIXED_MONEY_LEARNING',
  Q1_C: 'OBSERVATIONAL_LEARNING',
  Q1_D: 'CRISIS_BASED_MONEY_CONVERSATION',
  Q1_E: 'CONFLICTING_MONEY_MESSAGES',
  Q1_F: 'LIMITED_MONEY_CONVERSATION',
  Q1_G: 'OTHER_MONEY_ENVIRONMENT',
};

const Q9_TAGS: Record<string, string> = {
  Q9_A: 'INCOME_PRESSURE',
  Q9_B: 'LOW_AVAILABLE_MONEY',
  Q9_C: 'DEBT_PRESSURE',
  Q9_D: 'MAJOR_FIXED_COST_PRESSURE',
  Q9_E: 'COST_OF_LIVING_PRESSURE',
  Q9_F: 'INCOME_VOLATILITY',
  Q9_G: 'UNEXPECTED_EXPENSE_PRESSURE',
  Q9_H: 'SPENDING_PRESSURE',
  Q9_I: 'FAMILY_SUPPORT_PRESSURE',
  Q9_J: 'LEGACY_COMMITMENT_PRESSURE',
  Q9_K: 'UNIDENTIFIED_PRESSURE',
  Q9_L: 'NO_SIGNIFICANT_PRESSURE',
  Q9_M: 'OTHER_PRESSURE',
};

const Q16_TAGS: Record<string, string> = {
  Q16_A: 'PEACE_REDUCED_STRESS',
  Q16_B: 'INCOME_SUFFICIENCY',
  Q16_C: 'DEBT_FREEDOM',
  Q16_D: 'FINANCIAL_SECURITY',
  Q16_E: 'WEALTH_OWNERSHIP',
  Q16_F: 'WORK_OPTIONALITY',
  Q16_G: 'FAMILY_SUPPORT',
  Q16_H: 'LEGACY',
  Q16_I: 'TIME_CHOICE',
  Q16_J: 'DESTINATION_STILL_FORMING',
  Q16_K: 'OTHER_DESTINATION',
};

const Q21_TAGS: Record<string, string> = {
  Q21_A: 'TRUTH_AVOIDANCE',
  Q21_B: 'WRONG_DECISION_FEAR',
  Q21_C: 'JUDGMENT_EXPOSURE',
  Q21_D: 'EXPLOITATION_PRESSURE_CONCERN',
  Q21_E: 'INFORMATION_OVERLOAD',
  Q21_F: 'REGRET_COMMITMENT_FEAR',
  Q21_G: 'NO_SIGNIFICANT_FEAR_FRICTION',
  Q21_H: 'OTHER_FEAR_FRICTION',
};

/** Options whose selection excludes every other option in the same question. */
export const EXCLUSIVE_OPTIONS: Record<string, string[]> = {
  Q9_capacity_context: ['Q9_L'],
  Q21_fear_friction: ['Q21_G'],
};

/** Q21 selections that count as fear present (everything except exclusive Q21_G). */
const FEAR_PRESENT_OPTIONS = [
  'Q21_A',
  'Q21_B',
  'Q21_C',
  'Q21_D',
  'Q21_E',
  'Q21_F',
  'Q21_H',
];

const TAG_MAPS: Record<ClassifierQuestionId, Record<string, string>> = {
  Q1_money_environment: Q1_TAGS,
  Q9_capacity_context: Q9_TAGS,
  Q16_destination: Q16_TAGS,
  Q21_fear_friction: Q21_TAGS,
};

const SHORT_TO_LONG: Record<ClassifierQuestionShortId, ClassifierQuestionId> = {
  Q1: 'Q1_money_environment',
  Q9: 'Q9_capacity_context',
  Q16: 'Q16_destination',
  Q21: 'Q21_fear_friction',
};

function resolveQuestionId(
  q: ClassifierQuestionId | ClassifierQuestionShortId,
): ClassifierQuestionId {
  return (SHORT_TO_LONG[q as ClassifierQuestionShortId] ?? q) as ClassifierQuestionId;
}

/**
 * Enforce exclusivity for one classifier question. If an exclusive option
 * (Q9_L / Q21_G) is selected alongside others, the exclusive option wins and
 * every other selection is dropped.
 */
export function enforceExclusivity(
  question: ClassifierQuestionId | ClassifierQuestionShortId,
  selected: string[],
): string[] {
  const qid = resolveQuestionId(question);
  const exclusive = EXCLUSIVE_OPTIONS[qid] ?? [];
  const hit = selected.find((s) => exclusive.includes(s));
  if (hit !== undefined) return [hit];
  return [...selected];
}

/**
 * Map selected options to their classifier tags (exclusivity applied first).
 * Unknown option ids are ignored. Q9 output is context tags only — this
 * function never produces a numeric value for any question.
 */
export function tagsForSelection(
  question: ClassifierQuestionId | ClassifierQuestionShortId,
  selected: string[],
): string[] {
  const qid = resolveQuestionId(question);
  const map = TAG_MAPS[qid];
  if (!map) throw new Error(`Unknown classifier question: ${String(question)}`);
  return enforceExclusivity(qid, selected)
    .map((opt) => map[opt])
    .filter((t): t is string => t !== undefined);
}

/**
 * Classify all four classifier questions at once. Input maps question id
 * (long or short form) to selected option ids. Returns question id → tags.
 */
export function classifyAll(
  selections: Partial<
    Record<ClassifierQuestionId | ClassifierQuestionShortId, string[]>
  >,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [q, selected] of Object.entries(selections)) {
    out[q] = tagsForSelection(
      q as ClassifierQuestionId | ClassifierQuestionShortId,
      selected ?? [],
    );
  }
  return out;
}

/** True when any Q21 selection other than exclusive Q21_G is present. */
export function isFearPresent(q21Selected: string[]): boolean {
  const effective = enforceExclusivity('Q21', q21Selected);
  return effective.some((s) => FEAR_PRESENT_OPTIONS.includes(s));
}

/** True when the exclusive "no significant pressure" Q9 option is selected. */
export function isNoSignificantPressure(q9Selected: string[]): boolean {
  return enforceExclusivity('Q9', q9Selected).includes('Q9_L');
}
