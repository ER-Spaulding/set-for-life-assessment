// PRD §13, §26 — consistency: cross-response sanity checks.
//
// SCOPE IS DELIBERATELY SMALL. The PRD does not define a consistency engine, so
// this module implements only the contradictions the spec DOES make visible —
// chiefly the exclusive-option rules of §14 — and nothing invented.
//
// THIS MODULE MUST NOT:
//   - alter, weight, or veto any signal score. Findings here are ADVISORY. A
//     capacity constraint is not low agency (PRD §29 test 10), and an internally
//     inconsistent response set is not a diagnosis (PRD §19);
//   - surface to participants. These findings are for the evidence chain and
//     internal review only — exposing them would be a corrective judgement the
//     UIUX spec forbids;
//   - invent checks the spec does not imply.
//
// Pure functions only: no I/O, no Date, no randomness.

export type ConsistencyCode =
  | "EXCLUSIVE_OPTION_COEXISTS"
  | "SELECTION_LIMIT_EXCEEDED"
  | "UNKNOWN_OPTION_CODE"
  | "MISSING_REQUIRED_ITEM";

export interface ConsistencyFinding {
  code: ConsistencyCode;
  /** The instrument item the finding concerns. */
  itemId: string;
  /** A precise, non-judgemental description for internal review. */
  detail: string;
}

export interface ConsistencyInput {
  /**
   * Raw selections keyed by internal item id. Values are option-code arrays;
   * a single_select item may pass a one-element array.
   */
  responses: Readonly<Record<string, readonly string[]>>;
  /** The instrument, for option codes, types and exclusivity (PRD §9, §14). */
  questions: ReadonlyArray<{
    internal_id: string;
    type: string;
    options: ReadonlyArray<{ code: string }>;
    exclusive_option_codes?: readonly string[];
  }>;
  /** The 31 required item ids (PRD §8). */
  requiredItemIds: readonly string[];
}

/** Selection limits per approved response type (PRD §9). */
const LIMITS: Readonly<Record<string, number>> = Object.freeze({
  single_select: 1,
  multi_select_max_2: 2,
  multi_select_max_3: 3,
  multi_select_max_2_exclusive_none: 2,
  multi_select_max_3_exclusive_no_pressure: 3,
});

/**
 * Check one response set for internal contradictions.
 *
 * Returns findings — never throws on participant data. An empty array means no
 * contradiction was detected, which is not a claim that the answers are
 * "correct"; it means the mechanical checks found nothing.
 */
export function checkConsistency(input: ConsistencyInput): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const byId = new Map(input.questions.map((q) => [q.internal_id, q]));

  for (const [itemId, selected] of Object.entries(input.responses)) {
    const q = byId.get(itemId);
    if (!q) {
      findings.push({
        code: "UNKNOWN_OPTION_CODE",
        itemId,
        detail: `response recorded for "${itemId}", which is not an instrument item`,
      });
      continue;
    }

    const known = new Set(q.options.map((o) => o.code));
    const unknown = selected.filter((c) => !known.has(c));
    if (unknown.length > 0) {
      findings.push({
        code: "UNKNOWN_OPTION_CODE",
        itemId,
        detail: `option code(s) not on this item: ${unknown.join(", ")}`,
      });
    }

    // §14 exclusivity: an exclusive option stands alone. Q9_L / Q21_G.
    const exclusive = new Set(q.exclusive_option_codes ?? []);
    const chosenExclusive = selected.filter((c) => exclusive.has(c));
    if (chosenExclusive.length > 0 && selected.length > 1) {
      findings.push({
        code: "EXCLUSIVE_OPTION_COEXISTS",
        itemId,
        detail:
          `"${chosenExclusive.join(", ")}" excludes every other option, but ` +
          `${selected.length} options are selected (PRD §14)`,
      });
    }

    const limit = LIMITS[q.type];
    if (limit !== undefined && selected.length > limit) {
      findings.push({
        code: "SELECTION_LIMIT_EXCEEDED",
        itemId,
        detail: `type "${q.type}" permits at most ${limit}, got ${selected.length}`,
      });
    }
  }

  // §8: the required 31. Reported here for completeness of the internal view;
  // the authoritative gate is lib/assessment/validation.ts.
  for (const id of input.requiredItemIds) {
    const selected = input.responses[id];
    if (!selected || selected.length === 0) {
      findings.push({
        code: "MISSING_REQUIRED_ITEM",
        itemId: id,
        detail: `required item "${id}" has no recorded response (PRD §8)`,
      });
    }
  }

  return findings;
}

/**
 * True when no mechanical contradiction was found. Deliberately NOT named
 * "isValid" — this is the absence of detected conflicts, not a judgement about
 * the participant.
 */
export function hasNoDetectedContradiction(
  findings: readonly ConsistencyFinding[],
): boolean {
  return findings.length === 0;
}

/**
 * Findings grouped by item, for evidence-chain rendering. Order is stable so
 * output is deterministic for a given input.
 */
export function findingsByItem(
  findings: readonly ConsistencyFinding[],
): Record<string, ConsistencyFinding[]> {
  const grouped: Record<string, ConsistencyFinding[]> = {};
  for (const f of [...findings].sort((a, b) =>
    a.itemId === b.itemId ? a.code.localeCompare(b.code) : a.itemId.localeCompare(b.itemId),
  )) {
    (grouped[f.itemId] ??= []).push(f);
  }
  return grouped;
}
