// PRD §11 — activation: A1 Urgency, A2 Readiness, A3 Commitment,
// A4 Support Readiness. "Never average A1–A4 into a single motivation
// score." This module returns four separate values only — there is no
// function here that produces a combined scalar, by design.
// Levels: LOW = A/B, MID = C, HIGH = D/E (5-point collapse).
// A4 is informational only: high A4 never creates appointment consent,
// marketing consent, or an automatic professional-service route.
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import type { ActivationKey, ActivationLevel } from './types';

/**
 * The four separate activation values. Never collapse to a scalar.
 *
 * Declared as a TYPE ALIAS, not an `interface`, and that is load-bearing.
 * TypeScript grants an implicit index signature to object-literal type
 * aliases but NOT to interfaces, so this shape is assignable to
 * `Record<string, ActivationLevel>` / `Partial<Record<...>>` (which the
 * tension evaluator's keyed lookups require) while still rejecting a missing
 * or misspelled A1–A4 key at the call site. As an `interface` it was
 * assignable to neither: consumers had to cast through `never`, and one such
 * cast hid a hardcoded all-MID object on the completion path — permanently
 * disabling every activation-driven tension rule. Keep this a type alias.
 */
export type ActivationLevels = {
  A1: ActivationLevel;
  A2: ActivationLevel;
  A3: ActivationLevel;
  A4: ActivationLevel;
};

/** Option letters collapsing to each level (config `activation.level_bands`). */
const LOW_LETTERS = ['A', 'B'];
const MID_LETTERS = ['C'];
const HIGH_LETTERS = ['D', 'E'];

/**
 * Collapse one selected option to its activation level.
 * Accepts full option ids ("A1_D") or bare letters ("D").
 * Throws on an unrecognised option — never silently defaults.
 */
export function levelForOption(option: string): ActivationLevel {
  const letter = option.includes('_') ? option.split('_').pop()! : option;
  const upper = letter.toUpperCase();
  if (LOW_LETTERS.includes(upper)) return 'LOW';
  if (MID_LETTERS.includes(upper)) return 'MID';
  if (HIGH_LETTERS.includes(upper)) return 'HIGH';
  throw new Error(`Unknown activation option: ${option}`);
}

/**
 * Map the four A1–A4 selections to four separate levels.
 * Returns a keyed object of four — never a scalar, never an average.
 */
export function levelsForActivation(
  selections: Record<ActivationKey, string>,
): ActivationLevels {
  return {
    A1: levelForOption(selections.A1),
    A2: levelForOption(selections.A2),
    A3: levelForOption(selections.A3),
    A4: levelForOption(selections.A4),
  };
}

/** Named A1–A4 patterns (config `activation.patterns`, PRD §17). */
export interface ActivationPatterns {
  HIGH_URGENCY_LOW_READINESS: boolean;
  LOW_URGENCY_HIGH_READINESS: boolean;
  HIGH_COMMITMENT_LOW_SUPPORT_READINESS: boolean;
  HIGH_SUPPORT_READINESS_LOW_PROFESSIONAL_AGENCY: boolean;
}

/**
 * Evaluate the named activation patterns. `q22ItemLow` feeds the
 * HIGH_SUPPORT_READINESS_LOW_PROFESSIONAL_AGENCY pattern (Q22 item-low
 * means threshold item_low, i.e. value <= 2); pass it explicitly —
 * activation never reads operating items on its own.
 */
export function activationPatterns(
  levels: ActivationLevels,
  opts?: { q22ItemLow?: boolean },
): ActivationPatterns {
  return {
    HIGH_URGENCY_LOW_READINESS: levels.A1 === 'HIGH' && levels.A2 === 'LOW',
    LOW_URGENCY_HIGH_READINESS: levels.A1 === 'LOW' && levels.A2 === 'HIGH',
    HIGH_COMMITMENT_LOW_SUPPORT_READINESS:
      levels.A3 === 'HIGH' && levels.A4 === 'LOW',
    HIGH_SUPPORT_READINESS_LOW_PROFESSIONAL_AGENCY:
      levels.A4 === 'HIGH' && opts?.q22ItemLow === true,
  };
}

/**
 * A4 safeguard (PRD §11): Support Readiness means openness to exploring
 * support under acceptable conditions. It is not appointment consent,
 * marketing consent, agreement to work with a professional, or purchase
 * intent. Low A4 is a preference, not financial friction (§17).
 */
export const A4_SAFEGUARD =
  'Support Readiness is informational only: it is not appointment consent, ' +
  'marketing consent, agreement to work with a professional, or purchase intent.';

/**
 * Consent / routing flags derived from A4. Always all-false: even HIGH A4
 * must never create consent or an automatic route. Callers gate any
 * consent or routing decision on this record.
 */
export function a4Consent(): {
  appointmentConsent: false;
  marketingConsent: false;
  automaticProfessionalRoute: false;
} {
  return {
    appointmentConsent: false,
    marketingConsent: false,
    automaticProfessionalRoute: false,
  };
}
