// PRD §8, §9 — questions: loads and exposes the locked assessment instrument.
//
// THIS MODULE MUST NOT:
//   - author, paraphrase, reword or "tidy" any participant-facing string;
//   - invent questions, options, codes or selection limits;
//   - let a caller bypass the 31-item required count.
//
// The instrument is locked (PRD §34: "Preserve exact approved participant
// question wording and external order"). This module is a reader and a
// validator over a caller-supplied, already-approved config object. It performs
// no I/O — the caller loads the JSON.
//
// Pure functions only: no I/O, no Date, no randomness. Same input → same output.

/** Selection limits implied by each approved response type (PRD §9). */
export const MAX_SELECTIONS_BY_TYPE: Readonly<Record<string, number>> =
  Object.freeze({
    single_select: 1,
    multi_select_max_2: 2,
    multi_select_max_3: 3,
    multi_select_max_2_exclusive_none: 2,
    multi_select_max_3_exclusive_no_pressure: 3,
  });

/** PRD §8: required assessment responses = 2 opening + 25 questions + 4 activation. */
export const REQUIRED_QUESTION_COUNT = 25;
export const REQUIRED_OPENING_COUNT = 2;
export const REQUIRED_ACTIVATION_COUNT = 4;
export const REQUIRED_TOTAL = 31;

export interface QuestionOption {
  code: string;
  label: string;
  /** PRD §14: Q9_L and Q21_G stand alone; selecting one excludes the rest. */
  exclusive?: boolean;
  /** Write-in blanks (Q9_M, Q16_K, Q21_H, D2_C) carry a free-text affordance. */
  open_text?: boolean;
}

export interface QuestionItem {
  internal_id: string;
  prompt: string;
  type: string;
  options: QuestionOption[];
  external_order?: number;
  exclusive_option_codes?: string[];
  [key: string]: unknown;
}

export interface AssessmentBank {
  version?: string;
  opening: QuestionItem[];
  questions: QuestionItem[];
  activation: QuestionItem[];
  demographics?: QuestionItem[];
}

/** A malformed instrument — thrown rather than returned, so it cannot be ignored. */
export class QuestionBankError extends Error {
  constructor(message: string) {
    super(`questions: ${message}`);
    this.name = "QuestionBankError";
  }
}

/**
 * Validate a caller-supplied bank against PRD §8/§9 and return it narrowed.
 *
 * Throws on: wrong counts, duplicate internal ids, duplicate external orders,
 * a missing/incomplete 1–25 external sequence, unknown response types, or
 * questions with no options. Nothing here is a warning — a malformed instrument
 * must stop the build, not degrade quietly.
 */
export function loadQuestionBank(config: unknown): AssessmentBank {
  const c = config as Partial<AssessmentBank> | null | undefined;
  if (!c || typeof c !== "object") {
    throw new QuestionBankError("config is not an object");
  }

  const opening = c.opening ?? [];
  const questions = c.questions ?? [];
  const activation = c.activation ?? [];

  // --- PRD §8: the 31-item required model -------------------------------
  if (opening.length !== REQUIRED_OPENING_COUNT) {
    throw new QuestionBankError(
      `expected ${REQUIRED_OPENING_COUNT} opening items, got ${opening.length}`,
    );
  }
  if (questions.length !== REQUIRED_QUESTION_COUNT) {
    throw new QuestionBankError(
      `expected ${REQUIRED_QUESTION_COUNT} questions, got ${questions.length}`,
    );
  }
  if (activation.length !== REQUIRED_ACTIVATION_COUNT) {
    throw new QuestionBankError(
      `expected ${REQUIRED_ACTIVATION_COUNT} activation items, got ${activation.length}`,
    );
  }
  // Demographics are explicitly NOT part of the diagnostic 31 (§8) — they are
  // never counted here, and their absence must not fail this validation.

  // --- internal id uniqueness -------------------------------------------
  const ids = [...opening, ...questions, ...activation].map((q) => q.internal_id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length > 0) {
    throw new QuestionBankError(`duplicate internal_id: ${[...new Set(dupIds)].join(", ")}`);
  }

  // --- PRD §9: the locked external order --------------------------------
  const orders = questions.map((q) => q.external_order);
  if (orders.some((o) => typeof o !== "number")) {
    throw new QuestionBankError("every question must carry a numeric external_order");
  }
  const sorted = [...(orders as number[])].sort((a, b) => a - b);
  const expected = Array.from({ length: REQUIRED_QUESTION_COUNT }, (_, i) => i + 1);
  if (sorted.join(",") !== expected.join(",")) {
    throw new QuestionBankError(
      `external_order must be exactly 1..${REQUIRED_QUESTION_COUNT} with no gaps or repeats; got [${sorted.join(", ")}]`,
    );
  }

  // --- per-question shape ------------------------------------------------
  for (const q of [...opening, ...questions, ...activation]) {
    if (typeof q.prompt !== "string" || q.prompt.trim() === "") {
      throw new QuestionBankError(`${q.internal_id} has an empty prompt`);
    }
    if (!(q.type in MAX_SELECTIONS_BY_TYPE)) {
      throw new QuestionBankError(
        `${q.internal_id} has unknown type "${String(q.type)}"`,
      );
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      throw new QuestionBankError(`${q.internal_id} has no options`);
    }
    const codes = q.options.map((o) => o.code);
    if (codes.some((code) => typeof code !== "string" || code === "")) {
      throw new QuestionBankError(`${q.internal_id} has an option with an empty code`);
    }
    const dupCodes = codes.filter((code, i) => codes.indexOf(code) !== i);
    if (dupCodes.length > 0) {
      throw new QuestionBankError(
        `${q.internal_id} has duplicate option codes: ${[...new Set(dupCodes)].join(", ")}`,
      );
    }
  }

  return {
    version: c.version,
    opening,
    questions,
    activation,
    demographics: c.demographics ?? [],
  };
}

/**
 * The 25 questions in participant-facing order (external 1–25).
 * Internal ids are never shown to a participant (PRD §9).
 */
export function questionsInExternalOrder(bank: AssessmentBank): QuestionItem[] {
  return [...bank.questions].sort(
    (a, b) => (a.external_order as number) - (b.external_order as number),
  );
}

/** Every item that counts toward the required 31, in canonical order. */
export function requiredItems(bank: AssessmentBank): QuestionItem[] {
  return [...bank.opening, ...questionsInExternalOrder(bank), ...bank.activation];
}

/** Look up a question by its internal id. Throws if absent. */
export function questionById(bank: AssessmentBank, internalId: string): QuestionItem {
  const found = requiredItems(bank).find((q) => q.internal_id === internalId);
  if (!found) throw new QuestionBankError(`unknown internal_id "${internalId}"`);
  return found;
}

/** External position (1–25) for an internal id. Throws if absent. */
export function externalOrderOf(bank: AssessmentBank, internalId: string): number {
  const q = questionById(bank, internalId);
  if (typeof q.external_order !== "number") {
    throw new QuestionBankError(`${internalId} has no external_order`);
  }
  return q.external_order;
}

/** Maximum selections permitted for a question, from its approved type. */
export function maxSelections(q: QuestionItem): number {
  const limit = MAX_SELECTIONS_BY_TYPE[q.type];
  if (limit === undefined) {
    throw new QuestionBankError(`${q.internal_id} has unknown type "${q.type}"`);
  }
  return limit;
}

/** Option codes on a question that exclude every other option (PRD §14). */
export function exclusiveCodes(q: QuestionItem): string[] {
  const fromArray = Array.isArray(q.exclusive_option_codes)
    ? q.exclusive_option_codes
    : [];
  const fromFlags = q.options.filter((o) => o.exclusive === true).map((o) => o.code);
  return [...new Set([...fromArray, ...fromFlags])];
}

export interface SelectionCheck {
  ok: boolean;
  /** A human-readable reason when `ok` is false. */
  reason?: string;
  /**
   * The selection with any conflicting options removed. When an exclusive
   * option is chosen it stands alone; when a normal option is chosen the
   * exclusive one is dropped.
   */
  normalized: string[];
}

/**
 * Enforce selection rules for one question (PRD §9 types, §14 exclusivity).
 *
 * The exclusive option wins: selecting Q9_L or Q21_G clears every other choice.
 * Selecting a normal option alongside an exclusive one drops the exclusive.
 * Ties are resolved deterministically by preferring the exclusive option, so
 * the same input always produces the same output.
 */
export function checkSelection(q: QuestionItem, selected: string[]): SelectionCheck {
  const known = new Set(q.options.map((o) => o.code));
  const unknown = selected.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `${q.internal_id}: unknown option code(s) ${unknown.join(", ")}`,
      normalized: [],
    };
  }

  const exclusive = exclusiveCodes(q);
  const chosenExclusive = selected.filter((c) => exclusive.includes(c));

  // An exclusive option stands alone — it clears everything else.
  if (chosenExclusive.length > 0) {
    if (chosenExclusive.length > 1) {
      return {
        ok: false,
        reason: `${q.internal_id}: exclusive options cannot coexist (${chosenExclusive.join(", ")})`,
        normalized: [chosenExclusive[0]],
      };
    }
    const only = chosenExclusive[0];
    return {
      ok: selected.length === 1,
      reason:
        selected.length === 1
          ? undefined
          : `${q.internal_id}: "${only}" excludes every other option`,
      normalized: [only],
    };
  }

  const limit = maxSelections(q);
  if (selected.length > limit) {
    return {
      ok: false,
      reason: `${q.internal_id}: at most ${limit} selection(s) allowed, got ${selected.length}`,
      normalized: selected.slice(0, limit),
    };
  }

  return { ok: true, normalized: [...selected] };
}

/**
 * Apply a selection change, returning the resulting option set after
 * exclusivity and limit rules. Never throws on a legal change.
 */
export function applySelection(
  q: QuestionItem,
  current: string[],
  toggled: string,
  on: boolean,
): string[] {
  let next = on
    ? [...current.filter((c) => c !== toggled), toggled]
    : current.filter((c) => c !== toggled);

  // Turning on an exclusive option clears the rest immediately.
  if (on && exclusiveCodes(q).includes(toggled)) {
    next = [toggled];
  } else if (on) {
    // Turning on a normal option clears any exclusive choice.
    const exclusive = exclusiveCodes(q);
    next = next.filter((c) => !exclusive.includes(c));
  }

  const limit = maxSelections(q);
  if (next.length > limit) {
    // Drop the oldest non-toggled choice, keeping the most recent intent.
    next = next.filter((c) => c !== toggled).slice(-(limit - 1)).concat(toggled);
  }
  return next;
}
