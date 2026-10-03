/**
 * Approved copy-library types — Set for Life Financial Assessment (MVP v1.0).
 *
 * These types describe the APPROVED, LOCKED participant-facing language
 * libraries in `config/`. Union types are derived from the actual JSON keys
 * wherever feasible, so a typo in a rule key becomes a compile error. If a
 * library gains or loses a key, the derived unions follow automatically —
 * and the consistency test in `tests/unit/copy-library-consistency.mjs`
 * guards the JSON↔JSON and MD↔JSON referential integrity at runtime.
 *
 * Sources (read-only, never edited here):
 * - config/narratives-v1.0.json
 * - config/connection-statements-v1.0.json
 * - config/signal-state-vocabulary-v1.0.json
 */

import narratives from "../../config/narratives-v1.0.json";
import connectionStatements from "../../config/connection-statements-v1.0.json";
import vocabulary from "../../config/signal-state-vocabulary-v1.0.json";

/** Operating signals: SEE / ROOM / DIRECT / PREPARE / AIM / MOVE. */
export type SignalName = keyof typeof narratives.signal_states;

/** Descriptive state level within a signal. Raw 1–5 values are never exposed. */
export type SignalState = "S1" | "S2" | "S3" | "S4" | "S5";

/** Dotted signal-state address, e.g. "SEE.S3". */
export type SignalStateKey = `${SignalName}.${SignalState}`;

/** Governed special states (capacity-constrained overlays). */
export type SpecialSignalStateKey = keyof typeof narratives.special_signal_states;

/**
 * Tension / override codes. Each code selects one connection statement.
 * Derived from the standalone connection-statement library, which is the
 * authoritative key set (it is value-identical to the embedded block in
 * narratives-v1.0.json — see tests/unit/copy-library-consistency.mjs).
 */
/**
 * Metadata keys on a copy library — NOT copy keys.
 *
 * These describe the artifact (its version, and notes about it) rather than
 * naming a participant-facing statement. `version` and `_version_note` were
 * added to the configs on 2026-10-01 for the Snapshot version architecture, and
 * because `TensionCode` is `keyof typeof connectionStatements`, they became
 * legal "tension codes" the moment they landed — which then broke
 * `TENSION_DEFAULT_ATTENTION`'s exhaustiveness with two keys that are not
 * tensions at all.
 *
 * Excluded here rather than removed from the configs, because the standalone
 * library is exactly the artifact that needs to declare its own version.
 */
type MetadataKey = "version" | "_version_note" | "_prd_section" | "_notes";

export type TensionCode = Exclude<keyof typeof connectionStatements, MetadataKey>;

/** Alias: the key that selects a connection statement. */
export type ConnectionStatementKey = TensionCode;

/** Educational attention areas (PRD §20.2). */
export type AttentionAreaKey = keyof typeof narratives.attention_areas;

/** Descriptive context narrative keys (money history, pressure sources, fears). */
export type ContextNarrativeKey = keyof typeof narratives.context_narratives;

/** Perception-gap narrative keys. */
export type PerceptionGapKey = keyof typeof narratives.perception_gap;

/** Activation items A1–A4 (kept separate; never combined into an index). */
export type ActivationItem = keyof typeof narratives.activation;

/** Activation response level per item. */
export type ActivationLevel = "LOW" | "MID" | "HIGH";

/**
 * Keys of the library's `language_strength` block — UPPERCASE, exactly as they
 * appear in config/narratives-v1.0.json.
 */
export type LanguageStrengthKey = keyof typeof narratives.language_strength;

/**
 * Evidence confidence AS PERSISTED AND CARRIED THROUGH THE ENGINE — lowercase.
 *
 * The authority here is not the library's key casing but the database:
 *   computed_signals.evidence_confidence CHECK (... IN ('high','moderate','limited'))
 * and PRD §19.1, whose tiers are *high* / *moderate* / *limited*. The library
 * happens to store those tiers under UPPERCASE keys; that is a presentation
 * detail of the JSON, not the contract. Typing this from `keyof` therefore
 * produced a type that compiled fine and would have written values the CHECK
 * constraint rejects.
 */
export type EvidenceConfidence = "high" | "moderate" | "limited";

/**
 * WHY a signal's evidence confidence is LIMITED (Addendum 01 v1.1 §10).
 *
 * The distinction is load-bearing and must survive into the persisted payload:
 *
 *   CAPACITY_CONTEXT — the numeric value is context-constrained by a capacity
 *       override (Q11/Q12/Q18). Limited margin is NOT weak agency; the signal's
 *       narrative key still comes from its special state, so this reason is
 *       metadata ONLY.
 *   THIN_EVIDENCE    — the responses themselves provide little to go on (a
 *       single source, or no ladder position at all).
 *
 * Collapsing the two would let a capacity-constrained participant be addressed
 * as though their agency were weakly evidenced — the exact misreading §13.4–
 * §13.7 exist to prevent. `AGENCY_EVIDENCE=LIMITED_DUE_TO_CAPACITY_CONTEXT` must
 * remain distinguishable from genuinely weak Agency.
 */
export type EvidenceLimitedReason = "CAPACITY_CONTEXT" | "THIN_EVIDENCE";

/**
 * Evidence strength is METADATA about how strongly the participant's response
 * pattern supports a finding. It is NOT another participant score and must
 * never become an overall financial-health rating — there is no aggregate
 * evidence field, and a renderer may use it only to select deterministic
 * language strength (PRD §19.1), never to override the signal's narrative key.
 */
export interface EvidenceStrength {
  confidence: EvidenceConfidence;
  limitedReason: EvidenceLimitedReason | null;
}

/**
 * Compile-time guard: the lowercase contract and the library's uppercase keys
 * must stay in step. If a tier is added to one and not the other, this fails
 * to compile rather than drifting silently at runtime.
 */
type _TiersAgree =
  Uppercase<EvidenceConfidence> extends LanguageStrengthKey ? true : never;
const _tiersAgree: _TiersAgree = true;
void _tiersAgree;

/**
 * The approved sentence prefixes themselves, keyed by the library's tier keys.
 * Indexed with `Uppercase<EvidenceConfidence>` so callers holding the lowercase
 * persisted value cannot accidentally index the library with the wrong casing.
 */
export type LanguageStrength =
  (typeof narratives.language_strength)[Uppercase<EvidenceConfidence>];

/** Map the lowercase persisted value to its library key. */
export const LANGUAGE_STRENGTH_KEY = {
  high: "HIGH",
  moderate: "MODERATE",
  limited: "LIMITED",
} as const satisfies Record<EvidenceConfidence, LanguageStrengthKey>;

/**
 * Any addressable narrative entry, as a dotted path. The deterministic engine
 * and report composer may only render entries reachable through these keys.
 */
export type NarrativeKey =
  | `signal_states.${SignalStateKey}`
  | `special_signal_states.${SpecialSignalStateKey}`
  | `connection_statements.${TensionCode}`
  | `context_narratives.${ContextNarrativeKey}`
  | `perception_gap.${PerceptionGapKey}`
  | `activation.${ActivationItem}.${ActivationLevel}`
  | `attention_areas.${AttentionAreaKey}`;

/** Entry shapes (structural view of the approved JSON). */
export interface SignalStateEntry {
  label: string;
  copy: string;
  attention_area: AttentionAreaKey;
  source: string;
}

export interface SpecialSignalStateEntry {
  label: string;
  copy: string;
}

export interface ConnectionStatementEntry {
  headline: string;
  body: string;
  attention_area: AttentionAreaKey;
}

export interface AttentionAreaEntry {
  label: string;
  body: string;
}

/** Whole-library shapes, derived from the approved JSON files. */
export type NarrativeLibrary = typeof narratives;
export type ConnectionStatementLibrary = typeof connectionStatements;
export type SignalStateVocabulary = typeof vocabulary;

/* ---------------------------------------------------------------------------
 * Backward-compatible aliases.
 *
 * The scoring engine and report composer were specified against these names.
 * They are aliases, not separate types — the derived unions above remain the
 * single source of truth, so both naming schemes stay in sync automatically.
 * ------------------------------------------------------------------------- */

/** @deprecated Use `SignalName`. Alias kept for engine compatibility. */
export type SignalId = SignalName;

/** @deprecated Use `SpecialSignalStateKey`. Alias kept for engine compatibility. */
export type SpecialSignalState = SpecialSignalStateKey;

/** @deprecated Use `ActivationItem`. Alias kept for engine compatibility. */
export type ActivationKey = ActivationItem;

/** @deprecated Use `ConnectionStatementEntry`. Alias kept for engine compatibility. */
export type ConnectionStatement = ConnectionStatementEntry;

/**
 * Big-picture assembly template keys (PRD §20). The approved library defines
 * three: PRIMARY_FRICTION, CAPACITY_FIRST, NO_FRICTION.
 */
export type BigPictureTemplateKey =
  | "PRIMARY_FRICTION"
  | "CAPACITY_FIRST"
  | "NO_FRICTION";

/**
 * Snapshot screen shape, matching config/report-v1.0.json.
 * Screen IDs follow the UIUX §8 screen map (S12–S22).
 */
export interface ReportScreen {
  id: string;
  title: string;
  source_keys?: string[];
  condition?: { render_when?: string; trigger_keys?: string[] } | null;
  [key: string]: unknown;
}

export type ReportScreenType = ReportScreen["id"];
