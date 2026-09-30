// PRD §16, §29 test 15 — perception-gap: compares the participant's Opening B
// self-view against the assessed profile.
//
// ⚠️ SPECIFICATION GAP — READ BEFORE CHANGING THIS MODULE.
//
// The PRD names four outcomes and one gating rule, and explicitly does NOT
// define how to compare Opening B against the profile numerically:
//
//   "PERCEPTION GAP: Opening B cannot be finalized into a Perception Gap
//    interpretation until Q16 destination selections are available."
//     — PRD §29 acceptance test 15
//
//   outcomes: PERCEPTION_ALIGNED / PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE /
//             PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE / PERCEPTION_MIXED_COMPLEX
//
// config/scoring-v1.0.json records this as
//   perception_gap.comparison_method: "TBD_PENDING_OPERATOR_REVIEW"
//
// Therefore this module THROWS rather than guessing a threshold. Inventing a
// comparison rule would silently decide how every participant is told their
// self-perception relates to their answers — a diagnostic judgement the spec
// has not authorised (PRD §19). The structure below is deliberately shaped so
// that specifying the method is a config edit plus ONE implementation branch.
//
// THIS MODULE MUST NOT:
//   - invent, guess or default a comparison threshold;
//   - write participant-facing copy — it selects an approved library KEY only;
//   - use corrective or judgemental framing. UIUX §19 forbids "wrong",
//     "misperception", "reality check" and corrective arrows. The participant
//     is never told their self-view was incorrect.
//
// Pure functions only: no I/O, no Date, no randomness.

export type PerceptionGapCode =
  | "PERCEPTION_ALIGNED"
  | "PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE"
  | "PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE"
  | "PERCEPTION_MIXED_COMPLEX";

export const PERCEPTION_GAP_CODES: readonly PerceptionGapCode[] = Object.freeze([
  "PERCEPTION_ALIGNED",
  "PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE",
  "PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE",
  "PERCEPTION_MIXED_COMPLEX",
]);

/** Raised when the gap cannot be finalised — a gate, not a failure. */
export class PerceptionGapNotReadyError extends Error {
  constructor(message: string) {
    super(`perception-gap: ${message}`);
    this.name = "PerceptionGapNotReadyError";
  }
}

/** Raised when the comparison method is not specified in config. */
export class PerceptionGapMethodUnspecifiedError extends Error {
  constructor(detail: string) {
    super(`perception-gap: comparison method is not specified — ${detail}`);
    this.name = "PerceptionGapMethodUnspecifiedError";
  }
}

export interface PerceptionGapInput {
  /** Opening B — the participant's self-rated "how Set for Life do you feel". */
  openingB: number | null | undefined;
  /** Q16 destination selections. Presence gates finalisation (PRD §29 test 15). */
  q16Selections: readonly string[] | null | undefined;
  /** The six computed operating-signal means, 1–5. */
  signalMeans: Readonly<Record<string, number>>;
  /** The config's perception_gap block. */
  config: unknown;
}

export type PerceptionGapResult =
  | {
      status: "finalized";
      code: PerceptionGapCode;
      /** Library key for the approved copy. Never copy itself. */
      narrativeKey: string;
    }
  | {
      status: "not_ready";
      /** Why finalisation was refused. */
      reason: string;
    };

/**
 * The gating rule (PRD §29 test 15), which IS specified.
 *
 * "Opening B cannot be finalized into a Perception Gap interpretation until Q16
 * destination selections are available." Q16 defines what "Set for Life" means
 * to this particular participant, so without it there is nothing to interpret
 * the self-rating against.
 */
export function isReadyToFinalize(
  q16Selections: readonly string[] | null | undefined,
): boolean {
  return Array.isArray(q16Selections) && q16Selections.length > 0;
}

/**
 * Evaluate the perception gap.
 *
 * Returns `{status:'not_ready'}` when the Q16 gate is unmet — a legitimate
 * state, not an error. Throws when the gate IS met but the comparison method is
 * still unspecified in config, because at that point proceeding would require
 * inventing a rule.
 */
export function evaluatePerceptionGap(
  input: PerceptionGapInput,
): PerceptionGapResult {
  if (!isReadyToFinalize(input.q16Selections)) {
    return {
      status: "not_ready",
      reason:
        "Q16 destination selections are not available; PRD §29 test 15 forbids " +
        "finalising a Perception Gap before Q16",
    };
  }

  const cfg = input.config as
    | { comparison_method?: unknown; outcomes?: unknown }
    | null
    | undefined;

  const method = cfg?.comparison_method;

  if (typeof method !== "string" || method === "TBD_PENDING_OPERATOR_REVIEW") {
    throw new PerceptionGapMethodUnspecifiedError(
      `config perception_gap.comparison_method = ${JSON.stringify(method)}. ` +
        "The PRD defines the four outcomes but no numeric comparison. " +
        "Specify the method (and its thresholds) in config before enabling this path.",
    );
  }

  // --- One implementation branch goes here once the method is specified. ---
  // Until then, fail loudly rather than fabricate a diagnosis. When the method
  // lands, compare `input.openingB` against `input.signalMeans` per the config
  // and return the matching PerceptionGapCode with its library narrativeKey.
  throw new PerceptionGapMethodUnspecifiedError(
    `comparison_method "${method}" is configured but not implemented`,
  );
}

/**
 * The approved library key for a gap code. Lookup only — this module never
 * authors copy (PRD §19).
 */
export function narrativeKeyFor(code: PerceptionGapCode): string {
  if (!PERCEPTION_GAP_CODES.includes(code)) {
    throw new PerceptionGapNotReadyError(`unknown perception gap code "${String(code)}"`);
  }
  return `perception_gap.${code}`;
}
