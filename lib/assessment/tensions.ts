// PRD §15 — tensions: evaluates the 18 tension codes, producing the
// triggered subset. Only a triggered key may render its statement.
// PRD §18.3 (hard product rule): NO_MEANINGFUL_FRICTION_IDENTIFIED must be
// reachable and must NEVER be replaced by an invented weakness — if nothing
// triggers and the null condition holds, the null finding is returned; if
// the null condition does not hold either, an empty list is returned (no
// friction section renders) rather than a low signal dressed up as friction.
//
// Trigger logic mirrors config/scoring-v1.0.json `.tensions`:
//   item_high = value >= 4, item_low = value <= 2
//   (config `tension_thresholds`; values ASSUMED pending pilot calibration).
// Within one clause, a list of items means ALL listed items meet the band.
// Missing items never satisfy a clause (no trigger without evidence).
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import type {
  ActivationKey,
  ActivationLevel,
  SignalId,
  SignalState,
  TensionCode,
} from './types';

/** Inputs the tension engine needs. Owned by sibling modules' outputs. */
export interface TensionInputs {
  /** Operating signal states (from the scoring engine). */
  signalStates: Record<SignalId, SignalState>;
  /** Raw item values, 1–5 Likert (e.g. { Q4: 4, Q5: 2, ... }). */
  items: Record<string, number>;
  /** Four separate activation levels (from activation.ts — never averaged). */
  activation: Record<ActivationKey, ActivationLevel>;
  /** Classifier tags across Q1/Q9/Q16/Q21 (default: none). */
  tags?: string[];
  /** Any Q21 selection other than exclusive Q21_G (default: false). */
  fearPresent?: boolean;
  /**
   * Capacity mean (ROOM items). Falls back to mean(Q7, Q8) when both are
   * present; undefined otherwise (capacity-gated rules cannot trigger).
   */
  capacityMean?: number;
}

const ITEM_HIGH = 4;
const ITEM_LOW = 2;
const PAIR_LOW_AVG = 2.5;
const DIRECTION_CLARITY_HIGH = 4.0;
const CAPACITY_LOW = 2.5;

function itemGte(items: Record<string, number>, ids: string[]): boolean {
  return ids.every((id) => items[id] !== undefined && items[id] >= ITEM_HIGH);
}

function itemLte(items: Record<string, number>, ids: string[]): boolean {
  return ids.every((id) => items[id] !== undefined && items[id] <= ITEM_LOW);
}

function avgLte(items: Record<string, number>, ids: string[]): boolean {
  if (!ids.every((id) => items[id] !== undefined)) return false;
  const mean = ids.reduce((s, id) => s + items[id], 0) / ids.length;
  return mean <= PAIR_LOW_AVG;
}

function signalIn(
  states: Record<SignalId, SignalState>,
  signal: SignalId,
  allowed: SignalState[],
): boolean {
  return allowed.includes(states[signal]);
}

function capacityMeanOf(inputs: TensionInputs): number | undefined {
  if (inputs.capacityMean !== undefined) return inputs.capacityMean;
  const { items } = inputs;
  if (items.Q7 !== undefined && items.Q8 !== undefined) {
    return (items.Q7 + items.Q8) / 2;
  }
  return undefined;
}

/**
 * Contextual friction tags (operationalization of the null-finding
 * "no meaningful contextual friction" clause; ASSUMED pending operator
 * review). Any pressure/fear/avoidance/overload tag counts; the explicit
 * no-friction tags (NO_SIGNIFICANT_PRESSURE, NO_SIGNIFICANT_FEAR_FRICTION)
 * and the neutral Q1-environment / Q16-destination tags do not.
 */
const CONTEXT_FRICTION_TAGS: readonly string[] = [
  'INCOME_PRESSURE',
  'LOW_AVAILABLE_MONEY',
  'DEBT_PRESSURE',
  'MAJOR_FIXED_COST_PRESSURE',
  'COST_OF_LIVING_PRESSURE',
  'INCOME_VOLATILITY',
  'UNEXPECTED_EXPENSE_PRESSURE',
  'SPENDING_PRESSURE',
  'FAMILY_SUPPORT_PRESSURE',
  'LEGACY_COMMITMENT_PRESSURE',
  'UNIDENTIFIED_PRESSURE',
  'OTHER_PRESSURE',
  'INFORMATION_OVERLOAD',
  'TRUTH_AVOIDANCE',
  'JUDGMENT_EXPOSURE',
  'WRONG_DECISION_FEAR',
  'REGRET_COMMITMENT_FEAR',
  'EXPLOITATION_PRESSURE_CONCERN',
  'OTHER_FEAR_FRICTION',
];

/** True when tags or fear presence show meaningful contextual friction. */
export function hasMeaningfulContextualFriction(
  tags: string[],
  fearPresent: boolean,
): boolean {
  if (fearPresent) return true;
  return tags.some((t) => CONTEXT_FRICTION_TAGS.includes(t));
}

const STATE_RANK: Record<SignalState, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
};

/** Every operating signal at S3 or above. */
export function allSignalsS3OrAbove(
  states: Record<SignalId, SignalState>,
): boolean {
  const signals: SignalId[] = ['SEE', 'ROOM', 'DIRECT', 'PREPARE', 'AIM', 'MOVE'];
  return signals.every(
    (s) => states[s] !== undefined && STATE_RANK[states[s]] >= 3,
  );
}

type TensionRule = (inputs: TensionInputs) => boolean;

function tagsOf(inputs: TensionInputs): string[] {
  return inputs.tags ?? [];
}

function fearOf(inputs: TensionInputs): boolean {
  return inputs.fearPresent === true;
}

/** The 17 non-null tension rules, in canonical config order. */
const TENSION_RULES: ReadonlyArray<{ code: TensionCode; when: TensionRule }> = [
  {
    code: 'HIGH_ACTIVITY_LOW_DIRECTION',
    when: (i) =>
      signalIn(i.signalStates, 'DIRECT', ['S4', 'S5']) &&
      signalIn(i.signalStates, 'AIM', ['S1', 'S2']),
  },
  {
    code: 'HIGH_INFORMATION_LOW_ACTION',
    when: (i) => itemGte(i.items, ['Q23', 'Q24']) && itemLte(i.items, ['Q25']),
  },
  {
    code: 'INFORMATION_ANALYSIS_BOTTLENECK',
    when: (i) => itemGte(i.items, ['Q23']) && itemLte(i.items, ['Q24', 'Q25']),
  },
  {
    code: 'INFORMATION_EXECUTION_BOTTLENECK',
    when: (i) => itemGte(i.items, ['Q23', 'Q24']) && itemLte(i.items, ['Q25']),
  },
  {
    code: 'INFORMATION_OVERLOAD_PATTERN',
    when: (i) =>
      itemLte(i.items, ['Q23', 'Q24', 'Q25']) ||
      tagsOf(i).includes('INFORMATION_OVERLOAD'),
  },
  {
    code: 'HIGH_VISIBILITY_LOW_CAPACITY',
    when: (i) =>
      signalIn(i.signalStates, 'SEE', ['S4', 'S5']) &&
      signalIn(i.signalStates, 'ROOM', ['S1', 'S2']),
  },
  {
    code: 'LOW_VISIBILITY_HIGH_CAPACITY',
    when: (i) =>
      signalIn(i.signalStates, 'ROOM', ['S4', 'S5']) &&
      signalIn(i.signalStates, 'SEE', ['S1', 'S2']),
  },
  {
    code: 'HIGH_DIRECTION_LOW_CAPACITY',
    when: (i) =>
      signalIn(i.signalStates, 'AIM', ['S4', 'S5']) &&
      signalIn(i.signalStates, 'ROOM', ['S1', 'S2']),
  },
  {
    code: 'HIGH_FEAR_HIGH_ACTIVATION',
    when: (i) =>
      fearOf(i) &&
      (i.activation.A1 === 'HIGH' ||
        i.activation.A2 === 'HIGH' ||
        i.activation.A3 === 'HIGH'),
  },
  {
    code: 'SUPPORT_OPENNESS_AGENCY_VULNERABILITY',
    when: (i) => i.activation.A4 === 'HIGH' && itemLte(i.items, ['Q22']),
  },
  {
    code: 'HEALTHY_PRIVACY_BOUNDARY',
    when: (i) =>
      itemLte(i.items, ['Q20']) &&
      itemGte(i.items, ['Q6', 'Q22']) &&
      !tagsOf(i).includes('TRUTH_AVOIDANCE') &&
      !tagsOf(i).includes('JUDGMENT_EXPOSURE'),
  },
  {
    code: 'PRIVACY_AVOIDANCE_FRICTION',
    when: (i) =>
      itemLte(i.items, ['Q20']) &&
      itemLte(i.items, ['Q6']) &&
      (tagsOf(i).includes('TRUTH_AVOIDANCE') ||
        tagsOf(i).includes('JUDGMENT_EXPOSURE')),
  },
  {
    code: 'HIGH_CONFIDENCE_LOW_VISIBILITY',
    when: (i) => itemGte(i.items, ['Q24']) && avgLte(i.items, ['Q4', 'Q5']),
  },
  {
    code: 'PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE',
    when: (i) => itemGte(i.items, ['Q14']) && avgLte(i.items, ['Q13', 'Q15']),
  },
  {
    code: 'BIG_PICTURE_CASHFLOW_GAP',
    when: (i) => itemGte(i.items, ['Q4']) && itemLte(i.items, ['Q5']),
  },
  {
    code: 'DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED',
    when: (i) => itemGte(i.items, ['Q17']) && itemLte(i.items, ['Q19']),
  },
  {
    code: 'CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT',
    when: (i) => {
      const { items } = i;
      if (items.Q17 === undefined || items.Q19 === undefined) return false;
      if (items.Q18 === undefined) return false;
      const cap = capacityMeanOf(i);
      if (cap === undefined) return false;
      return (
        (items.Q17 + items.Q19) / 2 >= DIRECTION_CLARITY_HIGH &&
        items.Q18 <= ITEM_LOW &&
        cap <= CAPACITY_LOW
      );
    },
  },
];

/**
 * Null-finding condition (config `null_finding.operationalization`):
 * no other tension triggered AND every operating signal at S3 or above
 * AND no meaningful contextual friction.
 */
export function isNullFinding(
  triggeredExcludingNull: TensionCode[],
  inputs: TensionInputs,
): boolean {
  return (
    triggeredExcludingNull.length === 0 &&
    allSignalsS3OrAbove(inputs.signalStates) &&
    !hasMeaningfulContextualFriction(tagsOf(inputs), fearOf(inputs))
  );
}

/**
 * Evaluate all tensions in canonical order. Returns the triggered codes;
 * returns [NO_MEANINGFUL_FRICTION_IDENTIFIED] when the null condition
 * holds; returns [] when neither regular tensions nor the null condition
 * hold — never an invented weakness.
 */
export function evaluateTensions(inputs: TensionInputs): TensionCode[] {
  const triggered = TENSION_RULES.filter((r) => {
    try {
      return r.when(inputs);
    } catch {
      return false;
    }
  }).map((r) => r.code);
  if (triggered.length > 0) return triggered;
  if (isNullFinding(triggered, inputs)) {
    return ['NO_MEANINGFUL_FRICTION_IDENTIFIED'];
  }
  return [];
}
