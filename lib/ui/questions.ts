// UIUX §5, §8 — the CLIENT-SAFE question bank.
//
// WHY THIS MODULE EXISTS.
//
// `config/assessment-v1.0.json` is the locked instrument. It also carries
// scoring metadata — `scoring_behavior`, `internal_construct`, `feeds`,
// `notes`, classifier wiring — none of which may reach a participant (§24: "do
// not expose internal classifier tags or diagnostic machinery").
//
// Importing the raw config from a client component would ship all of it to the
// browser, where anyone can read it in devtools. This module projects ONLY the
// fields a question screen needs, and the projection is explicit and typed, so
// a new field added to the config is NOT automatically exposed.
//
// The projection is also asserted by tests/unit/ui-question-projection.test.ts —
// deleting a field from the allow-list there fails the suite rather than
// silently widening what participants can see.

import rawBank from "../../config/assessment-v1.0.json";
import interstitialConfig from "../../config/interstitial-v1.0.json";

/** A single answer option, as a participant sees it. */
export interface UiOption {
  code: string;
  label: string;
  /**
   * True when choosing this option clears every other selection on the item
   * (§14). The server enforces this regardless — `checkSelection` rejects a
   * set where an exclusive option sits alongside others — so this flag exists
   * only so the UI can behave the way the rule requires instead of letting a
   * participant build a selection that will be refused with a 422.
   *
   * Q9_L ("no pressure") and Q21_G ("no significant fear friction") are the
   * two on this instrument.
   */
  exclusive: boolean;
}

/**
 * One question, reduced to presentation data.
 *
 * Deliberately NO scoring fields: no `scoring_behavior`, no `feeds`, no
 * `internal_construct`, no `notes`, no `required_for_completion` (the
 * completeness rule is server-side, §23.5 — the client does not need it and
 * should not be able to reason about it).
 */
export interface UiQuestion {
  internal_id: string;
  prompt: string;
  type: string;
  options: UiOption[];
  /** Participant-facing order for Q1–Q25; absent for opening/activation. */
  external_order?: number;
}

export interface UiQuestionBank {
  opening: UiQuestion[];
  questions: UiQuestion[];
  activation: UiQuestion[];
  demographics: UiQuestion[];
}

/** Project one raw config item down to presentation fields only. */
function project(item: {
  internal_id?: unknown;
  prompt?: unknown;
  type?: unknown;
  options?: unknown;
  external_order?: unknown;
}): UiQuestion {
  const options = Array.isArray(item.options) ? item.options : [];
  const out: UiQuestion = {
    internal_id: String(item.internal_id ?? ""),
    prompt: String(item.prompt ?? ""),
    type: String(item.type ?? ""),
    options: options
      .filter(
        (o): o is { code: unknown; label: unknown; exclusive?: unknown } =>
          typeof o === "object" && o !== null,
      )
      .map((o) => ({
        code: String(o.code ?? ""),
        label: String(o.label ?? ""),
        exclusive: o.exclusive === true,
      })),
  };
  if (typeof item.external_order === "number") {
    out.external_order = item.external_order;
  }
  return out;
}

/**
 * The bank as the UI consumes it.
 *
 * Built once at module load: the instrument is pinned to v1.0 and immutable
 * (§22.6), so there is nothing to re-read.
 */
export const QUESTION_BANK: UiQuestionBank = {
  opening: (rawBank.opening ?? []).map(project),
  questions: (rawBank.questions ?? []).map(project),
  activation: (rawBank.activation ?? []).map(project),
  demographics: (rawBank.demographics ?? []).map(project),
};

/**
 * The participant's question sequence, in the order they answer.
 *
 * Opening A/B, then Q1–Q25 by `external_order`, then activation A1–A4.
 * Demographics are deliberately EXCLUDED — they sit outside the 31-item gate
 * (§8) and are not yet collected by any route.
 */
export const QUESTION_SEQUENCE: UiQuestion[] = [
  ...QUESTION_BANK.opening,
  ...[...QUESTION_BANK.questions].sort(
    (a, b) => (a.external_order ?? 0) - (b.external_order ?? 0),
  ),
  ...QUESTION_BANK.activation,
];

/** PRD §8: the required-item count the progress label reports. */
export const REQUIRED_QUESTION_COUNT = QUESTION_SEQUENCE.length;

/** Look up one question by internal id. Returns undefined when unknown. */
export function questionById(id: string): UiQuestion | undefined {
  return QUESTION_SEQUENCE.find((q) => q.internal_id === id);
}

/** How many options this item permits. Mirrors the server's own limits. */
export function maxSelections(type: string): number {
  switch (type) {
    case "single_select":
      return 1;
    case "multi_select_max_2":
    case "multi_select_max_2_exclusive_none":
      return 2;
    case "multi_select_max_3":
    case "multi_select_max_3_exclusive_no_pressure":
      return 3;
    default:
      return 1;
  }
}

/** True when the item takes more than one selection. */
export function isMultiSelect(type: string): boolean {
  return maxSelections(type) > 1;
}

// ---------------------------------------------------------------------------
// Money Moment placement (Addendum 02 v1.1 §9)
// ---------------------------------------------------------------------------

/**
 * Which sequence index each Money Moment follows, derived from the placement
 * recorded in `config/interstitial-v1.0.json`.
 *
 * DERIVED HERE RATHER THAN HARD-CODED, so the two cannot drift: the config says
 * "after the Nth diagnostic question", the diagnostic order lives in the
 * assessment config, and this resolves one against the other. If the instrument
 * order ever changes, the Money Moments move with it instead of landing between
 * the wrong questions.
 *
 * Returns a map of sequence index -> moment id: the moment is shown AFTER the
 * question at that index has been answered.
 */
export function moneyMomentPlacements(): Record<number, string> {
  const diagnosticOrder = [...QUESTION_BANK.questions]
    .sort((a, b) => (a.external_order ?? 0) - (b.external_order ?? 0))
    .map((q) => q.internal_id);

  const out: Record<number, string> = {};
  for (const m of interstitialConfig.moneyMoments) {
    const afterItem = diagnosticOrder[m.placement.afterDiagnosticIndex - 1];
    if (!afterItem) continue; // a placement beyond the diagnostic set is ignored
    const seqIndex = QUESTION_SEQUENCE.findIndex((q) => q.internal_id === afterItem);
    if (seqIndex >= 0) out[seqIndex] = m.id;
  }
  return out;
}

/** Milestone label for a moment (§13), or undefined. */
export function moneyMomentLabel(momentId: string): string | undefined {
  return interstitialConfig.moneyMoments.find((m) => m.id === momentId)?.milestoneLabel;
}
