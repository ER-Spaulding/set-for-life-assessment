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

/**
 * Option letters collapsing to each level — the SHIPPED DEFAULT.
 *
 * These were frozen constants while `config.activation.level_bands` sat unread
 * beside them: the same three bands, stated twice, with only one copy live. So a
 * calibration edit to the config changed nothing, and the config read as a
 * control that was not one.
 *
 * `levelForOption` now accepts the config's bands, and these are the fallback
 * for callers that have no config to hand (the pure-function tests, and the
 * acceptance harness). Production passes the config — see `levelsForActivation`
 * below, and its call sites in `snapshot-payload.ts` and `service.ts`.
 *
 * SHAPE CHANGE, not a value change: A/B / C / D-E are identical in both places,
 * so no participant's level moves. What changes is that editing the config now
 * moves them.
 */
export const DEFAULT_LEVEL_BANDS: Record<ActivationLevel, string[]> = {
  LOW: ['A', 'B'],
  MID: ['C'],
  HIGH: ['D', 'E'],
};

/** Validate a config-supplied bands object, or fall back to the default. */
export function resolveLevelBands(
  bands: { LOW?: unknown; MID?: unknown; HIGH?: unknown } | undefined,
): Record<ActivationLevel, string[]> {
  const pick = (key: ActivationLevel): string[] => {
    const raw = bands?.[key];
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((x) => typeof x === 'string' && x.length === 1)
    ) {
      return raw.map((x) => (x as string).toUpperCase());
    }
    return DEFAULT_LEVEL_BANDS[key];
  };
  return { LOW: pick('LOW'), MID: pick('MID'), HIGH: pick('HIGH') };
}

/**
 * Collapse one selected option to its activation level.
 * Accepts full option ids ("A1_D") or bare letters ("D").
 * Throws on an unrecognised option — never silently defaults.
 *
 * `bands` comes from `config.activation.level_bands`; omit it to use the
 * shipped default. An option that matches NO band still throws, which is the
 * behaviour a config error should produce — a participant whose answer falls
 * outside every band is a real fault, not something to absorb.
 */
export function levelForOption(
  option: string,
  bands: Record<ActivationLevel, string[]> = DEFAULT_LEVEL_BANDS,
): ActivationLevel {
  const letter = option.includes('_') ? option.split('_').pop()! : option;
  const upper = letter.toUpperCase();
  if (bands.LOW.includes(upper)) return 'LOW';
  if (bands.MID.includes(upper)) return 'MID';
  if (bands.HIGH.includes(upper)) return 'HIGH';
  throw new Error(`Unknown activation option: ${option}`);
}

/**
 * Map the four A1–A4 selections to four separate levels.
 * Returns a keyed object of four — never a scalar, never an average.
 *
 * `bands` is optional and defaults to the shipped bands, so existing callers
 * keep working unchanged. Production callers pass
 * `resolveLevelBands(cfg.activation?.level_bands)` so the config is what decides.
 */
export function levelsForActivation(
  selections: Record<ActivationKey, string>,
  bands: Record<ActivationLevel, string[]> = DEFAULT_LEVEL_BANDS,
): ActivationLevels {
  return {
    A1: levelForOption(selections.A1, bands),
    A2: levelForOption(selections.A2, bands),
    A3: levelForOption(selections.A3, bands),
    A4: levelForOption(selections.A4, bands),
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
