// PRD §13.4, §13.5, §13.6, §13.7 — overrides.
//
// Capacity overrides: Q11_A and Q12_F are substantive answers about constrained
// capacity. They carry NO numeric agency value (null in option_value_maps) and
// must never be scored as low agency. This module detects the overrides and
// derives the resulting DIRECT special states; scoring.ts consumes it.
//
// Pure functions only: no I/O, no Date, no randomness. Same input → same output.

/** Flags raised by the capacity-override rules (§13.4–§13.6). */
export interface CapacityOverrideFlags {
  /** §13.4 — Q11_A selected: Q11 contributes no numeric value to Agency. */
  Q11_CAPACITY_OVERRIDE: boolean;
  /** §13.5 — Q12_F selected: Q12 contributes no numeric value to Agency. */
  Q12_CAPACITY_OVERRIDE: boolean;
  /**
   * §13.6 — both selected: AGENCY_EVIDENCE=LIMITED_DUE_TO_CAPACITY_CONTEXT.
   * This is not missing data; both are substantive answers.
   */
  AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT: boolean;
}

/** Off-ladder DIRECT states driven by capacity overrides. */
export type DirectSpecialState =
  | 'NONE'
  | 'DIRECT_CAPACITY_LIMITED'
  | 'DIRECT_LIMITED_EVIDENCE_CAPACITY';

/**
 * Evaluate capacity overrides from raw option letters.
 * Expects the option letter answered for Q11 / Q12 ('A'–'F'), or null/undefined
 * when unanswered. Only the exact override codes trigger flags.
 */
export function evaluateCapacityOverrides(
  q11Option: string | null | undefined,
  q12Option: string | null | undefined,
): CapacityOverrideFlags {
  const q11 = q11Option === 'A';
  const q12 = q12Option === 'F';
  return {
    Q11_CAPACITY_OVERRIDE: q11,
    Q12_CAPACITY_OVERRIDE: q12,
    AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT: q11 && q12,
  };
}

/**
 * Map override flags to the DIRECT special state.
 * 0 overrides → NONE (plain S-ladder state applies).
 * 1 override  → DIRECT_CAPACITY_LIMITED (approved-library interpretation rule).
 * 2 overrides → DIRECT_LIMITED_EVIDENCE_CAPACITY (§13.6 explicit rule).
 */
export function directSpecialState(
  flags: CapacityOverrideFlags,
): DirectSpecialState {
  if (flags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT) {
    return 'DIRECT_LIMITED_EVIDENCE_CAPACITY';
  }
  if (flags.Q11_CAPACITY_OVERRIDE || flags.Q12_CAPACITY_OVERRIDE) {
    return 'DIRECT_CAPACITY_LIMITED';
  }
  return 'NONE';
}

// ---------------------------------------------------------------------------
// Q18 capacity modifier (§13.7)
// ---------------------------------------------------------------------------

/**
 * Numeric cutoffs for the §13.7 condition. Always loaded from
 * config/scoring-v1.0.json via loadQ18Cutoffs() — never hard-code these.
 */
export interface Q18Cutoffs {
  /** mean(Q17, Q19) at or above this counts as high direction clarity. */
  directionHighAtOrAbove: number;
  /** Q18 at or below this counts as low alignment. */
  alignmentLowAtOrBelow: number;
  /** Capacity mean at or below this counts as low capacity. */
  capacityLowAtOrBelow: number;
}

/**
 * Load the §13.7 cutoffs from the raw scoring config object
 * (config/scoring-v1.0.json → overrides.Q18_capacity_modifier.condition).
 * The condition strings embed the numbers (e.g. "mean(Q17, Q19) >= 4.0");
 * they are parsed here so a future calibration is a config edit, not a
 * code change. Throws a descriptive error if the config shape is unexpected.
 */
export function loadQ18Cutoffs(scoringConfig: unknown): Q18Cutoffs {
  const cfg = scoringConfig as Record<string, unknown>;
  const overrides = cfg['overrides'] as Record<string, unknown> | undefined;
  const mod = overrides?.['Q18_capacity_modifier'] as
    | Record<string, unknown>
    | undefined;
  const cond = mod?.['condition'] as Record<string, string> | undefined;
  if (!cond) {
    throw new Error(
      'overrides.loadQ18Cutoffs: missing overrides.Q18_capacity_modifier.condition in scoring config',
    );
  }
  const num = (key: string): number => {
    const raw = cond[key];
    // Take the LAST number: condition strings embed question ids too
    // (e.g. "mean(Q17, Q19) >= 4.0" — the threshold 4.0 is the final number).
    const all = raw?.match(/-?\d+(\.\d+)?/g);
    const m = all?.[all.length - 1];
    if (!m) {
      throw new Error(
        `overrides.loadQ18Cutoffs: cannot parse a number from condition.${key} (${JSON.stringify(raw)})`,
      );
    }
    // `m` is the matched string (match() with /g returns strings, not arrays
    // of groups). Number(m[0]) would take the FIRST CHARACTER and silently
    // truncate "2.5" to 2 and "4.0" to 4 — which would quietly loosen the
    // §13.7 alignment and capacity gates. Parse the whole match.
    return Number(m);
  };
  return {
    directionHighAtOrAbove: num('direction_clarity_high'),
    alignmentLowAtOrBelow: num('alignment_low'),
    capacityLowAtOrBelow: num('capacity_low'),
  };
}

export interface Q18ModifierInput {
  /** mean(Q17, Q19) — direction clarity without the alignment item. */
  directionClarity: number | null;
  /** Numeric value of Q18 (1–5), or null when unanswered. */
  q18Value: number | null;
  /** Capacity mean (scoring.ts passes the ROOM signal value). */
  capacityMean: number | null;
}

/**
 * §13.7: "If Direction clarity is high, Q18 alignment is low, and Capacity is
 * low, generate CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT rather than
 * low-direction language." Returns true when all three hold. Any missing input
 * yields false — the modifier must not fire on incomplete evidence.
 */
export function evaluateQ18CapacityModifier(
  input: Q18ModifierInput,
  cutoffs: Q18Cutoffs,
): boolean {
  const { directionClarity, q18Value, capacityMean } = input;
  if (directionClarity === null || q18Value === null || capacityMean === null) {
    return false;
  }
  return (
    directionClarity >= cutoffs.directionHighAtOrAbove &&
    q18Value <= cutoffs.alignmentLowAtOrBelow &&
    capacityMean <= cutoffs.capacityLowAtOrBelow
  );
}
