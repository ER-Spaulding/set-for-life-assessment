// PRD §8, §23.5 — validation.
//
// The 31-item completeness gate: Opening A + Opening B + Q1–Q25 + A1–A4.
// Demographics (D1–D3) are NOT part of the 31 and must not affect
// completeness. Completeness is computed from the response set only — there
// is deliberately no parameter for a client-supplied "complete" flag, so no
// caller can bypass the gate by asserting completion (§23.5: never trust the
// client flag).
//
// Pure functions only: no I/O, no Date, no randomness. Same input → same output.

/** Canonical required-item order: Opening A + Opening B + Q1–Q25 + A1–A4. */
export const REQUIRED_ITEM_IDS: readonly string[] = Object.freeze([
  'OPEN_A',
  'OPEN_B',
  ...Array.from({ length: 25 }, (_, i) => `Q${i + 1}`),
  'A1',
  'A2',
  'A3',
  'A4',
]);

/** Item ids that exist on the instrument but are excluded from the 31. */
export const EXCLUDED_FROM_COMPLETENESS: readonly string[] = Object.freeze([
  'D1',
  'D2',
  'D3',
]);

export interface ValidationResult {
  /** True only when all 31 required items carry an answer. */
  complete: boolean;
  /** Required ids with no usable answer, in canonical order. Empty when complete. */
  missing: string[];
  /** Count of required items answered. */
  present: number;
  /** Always 31. */
  required: number;
}

/** An answer counts as present when it is not null/undefined/empty. */
function hasAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Compute completeness from the response set only.
 * @param responses map of item id → answer (any non-empty value counts).
 * Extra ids (e.g. D1–D3) are ignored; a client "complete" flag cannot be
 * passed and would be ignored if it could — only the 31 items decide.
 */
export function validateCompleteness(
  responses: Record<string, unknown>,
): ValidationResult {
  const missing = REQUIRED_ITEM_IDS.filter((id) => !hasAnswer(responses[id]));
  return {
    complete: missing.length === 0,
    missing,
    present: REQUIRED_ITEM_IDS.length - missing.length,
    required: REQUIRED_ITEM_IDS.length,
  };
}

/** Convenience predicate over the same response-set-only rule. */
export function isComplete(responses: Record<string, unknown>): boolean {
  return validateCompleteness(responses).complete;
}
