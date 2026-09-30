/**
 * Narrative / config-layer types for the Set for Life assessment (MVP v1.0).
 *
 * GOVERNING RULE (PRD §19): No generative model may create, strengthen,
 * soften, or reinterpret a participant diagnosis in MVP v1.0. Runtime output
 * is assembled from these approved keys and the deterministic engine only.
 *
 * The union types below are derived from the actual approved JSON libraries,
 * not guessed. Key lists were dumped with jq and pasted into comments above
 * each union so any drift between JSON and types is visible at a glance.
 * A typo in a rule key becomes a compile error wherever these types are used.
 *
 * Source libraries:
 * - config/narratives-v1.0.json
 * - config/connection-statements-v1.0.json
 * - config/signal-state-vocabulary-v1.0.json
 * - config/report-v1.0.json (ReportScreen)
 */

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** The six assessment signals. */
export type SignalId = 'SEE' | 'ROOM' | 'DIRECT' | 'PREPARE' | 'AIM' | 'MOVE';

/** Standard five-state ladder per signal. Verified in jq output:
 *  every signal (SEE ROOM DIRECT PREPARE AIM MOVE) in both
 *  narratives.signal_states and the signal-state vocabulary has S1 S2 S3 S4 S5. */
export type SignalState = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

// ---------------------------------------------------------------------------
// Special signal states
// ---------------------------------------------------------------------------
// jq -r '.SPECIAL|keys[]' config/signal-state-vocabulary-v1.0.json
// jq -r '.special_signal_states|keys[]' config/narratives-v1.0.json
// (both files carry the same three keys):
//   AIM_CAPACITY_CONSTRAINED_ALIGNMENT
//   DIRECT_CAPACITY_LIMITED
//   DIRECT_LIMITED_EVIDENCE_CAPACITY

/** The 3 special (off-ladder) signal states present in the JSON. */
export type SpecialSignalState =
  | 'AIM_CAPACITY_CONSTRAINED_ALIGNMENT'
  | 'DIRECT_CAPACITY_LIMITED'
  | 'DIRECT_LIMITED_EVIDENCE_CAPACITY';

// ---------------------------------------------------------------------------
// Connection statements / tensions
// ---------------------------------------------------------------------------
// jq -r 'keys[]' config/connection-statements-v1.0.json  (18 keys, top level)
// jq -r '.connection_statements|keys[]' config/narratives-v1.0.json (same 18):
//   BIG_PICTURE_CASHFLOW_GAP
//   CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT
//   DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED
//   HEALTHY_PRIVACY_BOUNDARY
//   HIGH_ACTIVITY_LOW_DIRECTION
//   HIGH_CONFIDENCE_LOW_VISIBILITY
//   HIGH_DIRECTION_LOW_CAPACITY
//   HIGH_FEAR_HIGH_ACTIVATION
//   HIGH_INFORMATION_LOW_ACTION
//   HIGH_VISIBILITY_LOW_CAPACITY
//   INFORMATION_ANALYSIS_BOTTLENECK
//   INFORMATION_EXECUTION_BOTTLENECK
//   INFORMATION_OVERLOAD_PATTERN
//   LOW_VISIBILITY_HIGH_CAPACITY
//   NO_MEANINGFUL_FRICTION_IDENTIFIED
//   PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE
//   PRIVACY_AVOIDANCE_FRICTION
//   SUPPORT_OPENNESS_AGENCY_VULNERABILITY

/** Union of all 18 connection-statement keys. Doubles as the tension code:
 *  each tension resolves to the connection statement with the same key. */
export type TensionCode =
  | 'BIG_PICTURE_CASHFLOW_GAP'
  | 'CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT'
  | 'DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED'
  | 'HEALTHY_PRIVACY_BOUNDARY'
  | 'HIGH_ACTIVITY_LOW_DIRECTION'
  | 'HIGH_CONFIDENCE_LOW_VISIBILITY'
  | 'HIGH_DIRECTION_LOW_CAPACITY'
  | 'HIGH_FEAR_HIGH_ACTIVATION'
  | 'HIGH_INFORMATION_LOW_ACTION'
  | 'HIGH_VISIBILITY_LOW_CAPACITY'
  | 'INFORMATION_ANALYSIS_BOTTLENECK'
  | 'INFORMATION_EXECUTION_BOTTLENECK'
  | 'INFORMATION_OVERLOAD_PATTERN'
  | 'LOW_VISIBILITY_HIGH_CAPACITY'
  | 'NO_MEANINGFUL_FRICTION_IDENTIFIED'
  | 'PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE'
  | 'PRIVACY_AVOIDANCE_FRICTION'
  | 'SUPPORT_OPENNESS_AGENCY_VULNERABILITY';

// ---------------------------------------------------------------------------
// Attention areas
// ---------------------------------------------------------------------------
// jq -r '.attention_areas|keys[]' config/narratives-v1.0.json (7 keys):
//   BUILD_DECISION_CONFIDENCE
//   CREATE_MORE_ROOM
//   DEFINE_THE_DESTINATION
//   KEEP_OBSERVING
//   SEE_IT_MORE_CLEARLY
//   STRENGTHEN_RESILIENCE
//   TURN_INFORMATION_INTO_ACTION

/** Union of the `attention_areas` keys in narratives JSON. */
export type AttentionAreaKey =
  | 'BUILD_DECISION_CONFIDENCE'
  | 'CREATE_MORE_ROOM'
  | 'DEFINE_THE_DESTINATION'
  | 'KEEP_OBSERVING'
  | 'SEE_IT_MORE_CLEARLY'
  | 'STRENGTHEN_RESILIENCE'
  | 'TURN_INFORMATION_INTO_ACTION';

// ---------------------------------------------------------------------------
// Context narratives
// ---------------------------------------------------------------------------
// jq -r '.context_narratives|keys[]' config/narratives-v1.0.json (25 keys,
// each a plain string value):
//   CONFLICTING_MONEY_MESSAGES
//   COST_OF_LIVING_PRESSURE
//   CRISIS_BASED_MONEY_CONVERSATION
//   DEBT_PRESSURE
//   EXPLOITATION_PRESSURE_CONCERN
//   FAMILY_SUPPORT_PRESSURE
//   INCOME_PRESSURE
//   INCOME_VOLATILITY
//   INFORMATION_OVERLOAD
//   JUDGMENT_EXPOSURE
//   LEGACY_COMMITMENT_PRESSURE
//   LIMITED_MONEY_CONVERSATION
//   LOW_AVAILABLE_MONEY
//   MAJOR_FIXED_COST_PRESSURE
//   MIXED_MONEY_LEARNING
//   NO_SIGNIFICANT_FEAR_FRICTION
//   NO_SIGNIFICANT_PRESSURE
//   OBSERVATIONAL_LEARNING
//   OPEN_MONEY_ENVIRONMENT
//   REGRET_COMMITMENT_FEAR
//   SPENDING_PRESSURE
//   TRUTH_AVOIDANCE
//   UNEXPECTED_EXPENSE_PRESSURE
//   UNIDENTIFIED_PRESSURE
//   WRONG_DECISION_FEAR

/** Union of `context_narratives` keys. */
export type ContextNarrativeKey =
  | 'CONFLICTING_MONEY_MESSAGES'
  | 'COST_OF_LIVING_PRESSURE'
  | 'CRISIS_BASED_MONEY_CONVERSATION'
  | 'DEBT_PRESSURE'
  | 'EXPLOITATION_PRESSURE_CONCERN'
  | 'FAMILY_SUPPORT_PRESSURE'
  | 'INCOME_PRESSURE'
  | 'INCOME_VOLATILITY'
  | 'INFORMATION_OVERLOAD'
  | 'JUDGMENT_EXPOSURE'
  | 'LEGACY_COMMITMENT_PRESSURE'
  | 'LIMITED_MONEY_CONVERSATION'
  | 'LOW_AVAILABLE_MONEY'
  | 'MAJOR_FIXED_COST_PRESSURE'
  | 'MIXED_MONEY_LEARNING'
  | 'NO_SIGNIFICANT_FEAR_FRICTION'
  | 'NO_SIGNIFICANT_PRESSURE'
  | 'OBSERVATIONAL_LEARNING'
  | 'OPEN_MONEY_ENVIRONMENT'
  | 'REGRET_COMMITMENT_FEAR'
  | 'SPENDING_PRESSURE'
  | 'TRUTH_AVOIDANCE'
  | 'UNEXPECTED_EXPENSE_PRESSURE'
  | 'UNIDENTIFIED_PRESSURE'
  | 'WRONG_DECISION_FEAR';

// ---------------------------------------------------------------------------
// Perception gap
// ---------------------------------------------------------------------------
// jq -r '.perception_gap|keys[]' config/narratives-v1.0.json (4 keys):
//   PERCEPTION_ALIGNED
//   PERCEPTION_MIXED_COMPLEX
//   PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE
//   PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE

/** Union of `perception_gap` keys. */
export type PerceptionGapKey =
  | 'PERCEPTION_ALIGNED'
  | 'PERCEPTION_MIXED_COMPLEX'
  | 'PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE'
  | 'PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE';

// ---------------------------------------------------------------------------
// Activation (PRD §11: never averaged — A1..A4 render as separate rows)
// ---------------------------------------------------------------------------
// jq -r '.activation|keys[]' → A1 A2 A3 A4
// jq -r '.activation.A1|keys[]' → HIGH LOW MID

/** The four readiness questions. */
export type ActivationKey = 'A1' | 'A2' | 'A3' | 'A4';

/** Activation level per question. */
export type ActivationLevel = 'LOW' | 'MID' | 'HIGH';

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Evidence confidence band used by the deterministic engine. */
export type EvidenceConfidence = 'high' | 'moderate' | 'limited';

// NOTE: narratives JSON carries language_strength under UPPERCASE keys
// (jq -r '.language_strength|keys[]' → HIGH LIMITED MODERATE). The engine
// normalises to lowercase; this type is the normalised form.
/** Language-strength band used by the deterministic engine. */
export type LanguageStrength = 'high' | 'moderate' | 'limited';

// ---------------------------------------------------------------------------
// Entry shapes (matching the JSON actually on disk)
// ---------------------------------------------------------------------------

/**
 * One connection statement. Matches both
 * connection-statements-v1.0.json values and
 * narratives-v1.0.json connection_statements values:
 * { headline, body, attention_area }.
 */
export interface ConnectionStatement {
  headline: string;
  body: string;
  attention_area: AttentionAreaKey;
}

/**
 * One standard signal-state entry. Matches the shape in
 * signal-state-vocabulary-v1.0.json per signal (S1..S5) and
 * narratives-v1.0.json signal_states:
 * { label, copy, attention_area, source }.
 * (Special states carry only { label, copy } — see SpecialSignalStateEntry.)
 */
export interface SignalStateEntry {
  label: string;
  copy: string;
  attention_area: AttentionAreaKey;
  source: string;
}

/** Off-ladder special state entry: { label, copy } only. */
export interface SpecialSignalStateEntry {
  label: string;
  copy: string;
}

/** Big-picture template keys. jq -r '.big_picture_templates|keys[]'
 *  → CAPACITY_FIRST NO_FRICTION PRIMARY_FRICTION */
export type BigPictureTemplateKey =
  | 'CAPACITY_FIRST'
  | 'NO_FRICTION'
  | 'PRIMARY_FRICTION';

// ---------------------------------------------------------------------------
// Library shapes
// ---------------------------------------------------------------------------

/** Shape of config/narratives-v1.0.json. */
export interface NarrativeLibrary {
  signal_states: Record<SignalId, Record<SignalState, SignalStateEntry>>;
  special_signal_states: Record<SpecialSignalState, SpecialSignalStateEntry>;
  connection_statements: Record<TensionCode, ConnectionStatement>;
  attention_areas: Record<AttentionAreaKey, { label: string; body: string }>;
  context_narratives: Record<ContextNarrativeKey, string>;
  perception_gap: Record<
    PerceptionGapKey,
    { headline: string; body: string }
  >;
  activation: Record<ActivationKey, Record<ActivationLevel, string>>;
  big_picture_templates: Record<BigPictureTemplateKey, string>;
  language_strength: Record<string, string>;
  rules: string[];
}

/** Shape of config/connection-statements-v1.0.json (flat key → entry). */
export type ConnectionStatementLibrary = Record<
  TensionCode,
  ConnectionStatement
>;

/** Shape of config/signal-state-vocabulary-v1.0.json. */
export interface SignalStateVocabulary {
  SEE: Record<SignalState, SignalStateEntry>;
  ROOM: Record<SignalState, SignalStateEntry>;
  DIRECT: Record<SignalState, SignalStateEntry>;
  PREPARE: Record<SignalState, SignalStateEntry>;
  AIM: Record<SignalState, SignalStateEntry>;
  MOVE: Record<SignalState, SignalStateEntry>;
  SPECIAL: Record<SpecialSignalState, SpecialSignalStateEntry>;
}

// ---------------------------------------------------------------------------
// Report config (config/report-v1.0.json)
// ---------------------------------------------------------------------------

/** Screen kinds in the Snapshot composition config. */
export type ReportScreenType =
  | 'section'
  | 'conditional'
  | 'consent'
  | 'paths'
  | 'feedback';

/** One entry of the report config `screens` array. */
export interface ReportScreen {
  id: string;
  title: string;
  type: ReportScreenType;
  description?: string;
  /** Narrative source keys feeding this screen (structure refs, never copy). */
  source?: Record<string, unknown>;
  /** S18 only: render condition (perception-gap key triggered). */
  condition?: {
    render_when: string;
    trigger_keys: PerceptionGapKey[];
  };
  /** S19 only: MUST be false — A1..A4 are never aggregated (PRD §11). */
  aggregate?: boolean;
  /** S21 only: continuation paths; preselect must stay null (UIUX §22). */
  paths?: Array<{
    id: string;
    preselect: null;
    deprioritize: boolean;
  }>;
}
