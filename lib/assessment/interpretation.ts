// PRD §18, §19 — interpretation: selects the approved attention area.
//
// The 7 valid keys (config/narratives-v1.0.json `.attention_areas`):
// SEE_IT_MORE_CLEARLY, CREATE_MORE_ROOM, STRENGTHEN_RESILIENCE,
// DEFINE_THE_DESTINATION, TURN_INFORMATION_INTO_ACTION,
// BUILD_DECISION_CONFIDENCE, KEEP_OBSERVING.
// Signal-state vocabulary gives a default attention area per signal
// (config/signal-state-vocabulary-v1.0.json — uniform within each signal).
// Tension / connection statements each carry their own default attention
// area (config/narratives-v1.0.json `.connection_statements`).
// KEEP_OBSERVING is the null-finding default.
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import type { AttentionAreaKey, SignalId, TensionCode } from './types';

/** The 7 approved attention-area keys. Nothing else may be selected. */
export const ATTENTION_AREAS: readonly AttentionAreaKey[] = [
  'SEE_IT_MORE_CLEARLY',
  'CREATE_MORE_ROOM',
  'STRENGTHEN_RESILIENCE',
  'DEFINE_THE_DESTINATION',
  'TURN_INFORMATION_INTO_ACTION',
  'BUILD_DECISION_CONFIDENCE',
  'KEEP_OBSERVING',
];

/** Type guard for the approved attention-area vocabulary. */
export function isAttentionAreaKey(value: string): value is AttentionAreaKey {
  return (ATTENTION_AREAS as readonly string[]).includes(value);
}

/**
 * Default attention area per signal, from the signal-state vocabulary
 * (every state S1–S5 within a signal names the same area).
 */
export const SIGNAL_DEFAULT_ATTENTION: Record<SignalId, AttentionAreaKey> = {
  SEE: 'SEE_IT_MORE_CLEARLY',
  ROOM: 'CREATE_MORE_ROOM',
  DIRECT: 'BUILD_DECISION_CONFIDENCE',
  PREPARE: 'STRENGTHEN_RESILIENCE',
  AIM: 'DEFINE_THE_DESTINATION',
  MOVE: 'TURN_INFORMATION_INTO_ACTION',
};

/** Default attention area for one signal. Throws on an unknown signal. */
export function defaultAttentionAreaForSignal(
  signal: SignalId,
): AttentionAreaKey {
  const area = SIGNAL_DEFAULT_ATTENTION[signal];
  if (area === undefined) throw new Error(`Unknown signal: ${String(signal)}`);
  return area;
}

/**
 * Default attention area per tension / connection statement, from the
 * approved library's `connection_statements[*].attention_area`.
 */
export const TENSION_DEFAULT_ATTENTION: Record<TensionCode, AttentionAreaKey> =
  {
    HIGH_ACTIVITY_LOW_DIRECTION: 'DEFINE_THE_DESTINATION',
    HIGH_INFORMATION_LOW_ACTION: 'TURN_INFORMATION_INTO_ACTION',
    INFORMATION_ANALYSIS_BOTTLENECK: 'TURN_INFORMATION_INTO_ACTION',
    INFORMATION_EXECUTION_BOTTLENECK: 'TURN_INFORMATION_INTO_ACTION',
    INFORMATION_OVERLOAD_PATTERN: 'TURN_INFORMATION_INTO_ACTION',
    HIGH_VISIBILITY_LOW_CAPACITY: 'CREATE_MORE_ROOM',
    LOW_VISIBILITY_HIGH_CAPACITY: 'SEE_IT_MORE_CLEARLY',
    HIGH_DIRECTION_LOW_CAPACITY: 'CREATE_MORE_ROOM',
    HIGH_FEAR_HIGH_ACTIVATION: 'BUILD_DECISION_CONFIDENCE',
    SUPPORT_OPENNESS_AGENCY_VULNERABILITY: 'BUILD_DECISION_CONFIDENCE',
    HEALTHY_PRIVACY_BOUNDARY: 'BUILD_DECISION_CONFIDENCE',
    PRIVACY_AVOIDANCE_FRICTION: 'SEE_IT_MORE_CLEARLY',
    HIGH_CONFIDENCE_LOW_VISIBILITY: 'SEE_IT_MORE_CLEARLY',
    PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE: 'STRENGTHEN_RESILIENCE',
    BIG_PICTURE_CASHFLOW_GAP: 'SEE_IT_MORE_CLEARLY',
    DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED: 'DEFINE_THE_DESTINATION',
    CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT: 'CREATE_MORE_ROOM',
    NO_MEANINGFUL_FRICTION_IDENTIFIED: 'KEEP_OBSERVING',
  };

/** Default attention area for one tension code. Throws on unknown codes. */
export function attentionAreaForTension(code: TensionCode): AttentionAreaKey {
  const area = TENSION_DEFAULT_ATTENTION[code];
  if (area === undefined) {
    throw new Error(`Unknown tension code: ${String(code)}`);
  }
  return area;
}

/**
 * Canonical tension priority (config listing order). When several tensions
 * trigger with different default areas, the earliest-listed tension wins —
 * deterministic regardless of input order.
 */
const TENSION_PRIORITY: readonly TensionCode[] = [
  'HIGH_ACTIVITY_LOW_DIRECTION',
  'HIGH_INFORMATION_LOW_ACTION',
  'INFORMATION_ANALYSIS_BOTTLENECK',
  'INFORMATION_EXECUTION_BOTTLENECK',
  'INFORMATION_OVERLOAD_PATTERN',
  'HIGH_VISIBILITY_LOW_CAPACITY',
  'LOW_VISIBILITY_HIGH_CAPACITY',
  'HIGH_DIRECTION_LOW_CAPACITY',
  'HIGH_FEAR_HIGH_ACTIVATION',
  'SUPPORT_OPENNESS_AGENCY_VULNERABILITY',
  'HEALTHY_PRIVACY_BOUNDARY',
  'PRIVACY_AVOIDANCE_FRICTION',
  'HIGH_CONFIDENCE_LOW_VISIBILITY',
  'PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE',
  'BIG_PICTURE_CASHFLOW_GAP',
  'DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED',
  'CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT',
  'NO_MEANINGFUL_FRICTION_IDENTIFIED',
];

/**
 * Select the approved attention area for a set of triggered tensions.
 * Empty input or the null finding → KEEP_OBSERVING. Otherwise the
 * highest-priority triggered tension's default area. Throws on any code
 * outside the approved 18 (invented codes can never select an area).
 */
export function selectAttentionArea(triggered: TensionCode[]): AttentionAreaKey {
  for (const code of triggered) {
    if (!TENSION_PRIORITY.includes(code)) {
      throw new Error(`Unknown tension code: ${String(code)}`);
    }
  }
  const nonNull = triggered.filter(
    (c) => c !== 'NO_MEANINGFUL_FRICTION_IDENTIFIED',
  );
  if (nonNull.length === 0) return 'KEEP_OBSERVING';
  let best = nonNull[0];
  for (const code of nonNull) {
    if (
      TENSION_PRIORITY.indexOf(code) < TENSION_PRIORITY.indexOf(best)
    ) {
      best = code;
    }
  }
  return attentionAreaForTension(best);
}
