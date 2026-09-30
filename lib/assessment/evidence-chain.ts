// PRD §29 test 16 — evidence-chain: every participant-facing insight must
// carry an evidence-chain record. The approved library's no-orphan-insight
// rule requires each record to store: insight_id, source question(s), answer
// pattern, signal/subsignal, context modifiers, evidence confidence,
// narrative key, approved attention area. The builder below REFUSES to
// produce a record missing any required field (it throws).
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import type {
  AttentionAreaKey,
  EvidenceConfidence,
  SignalId,
  SignalState,
} from './types';
import { ATTENTION_AREAS } from './interpretation';

/** All fields required by the no-orphan-insight rule. */
export interface EvidenceRecordInput {
  insight_id: string;
  sourceQuestions: string[];
  answerPattern: string;
  signal: SignalId;
  /** Subsignal / item detail, e.g. "Q4/Q5 pair". Empty string allowed, missing not. */
  subsignal: string;
  contextModifiers: string[];
  evidenceConfidence: EvidenceConfidence;
  narrativeKey: string;
  attentionArea: AttentionAreaKey;
}

/** A complete, validated evidence-chain record. */
export interface EvidenceRecord extends EvidenceRecordInput {
  readonly complete: true;
}

const SIGNALS: readonly SignalId[] = [
  'SEE',
  'ROOM',
  'DIRECT',
  'PREPARE',
  'AIM',
  'MOVE',
];

// Lowercase, deliberately: this value is persisted to
// computed_signals.evidence_confidence, whose CHECK constraint accepts only
// ('high','moderate','limited'). The library's UPPERCASE keys are mapped via
// LANGUAGE_STRENGTH_KEY when the approved sentence opener is needed.
const CONFIDENCES: readonly EvidenceConfidence[] = [
  'high',
  'moderate',
  'limited',
];

function nonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Evidence record missing required field: ${field}`);
  }
}

/**
 * Build a validated evidence-chain record. Throws when ANY required field
 * is missing or invalid: blank insight_id, empty source questions, blank
 * answer pattern, unknown signal, missing subsignal, missing context
 * modifiers, unknown confidence band, blank narrative key, or an attention
 * area outside the approved 7. Never returns a partial record.
 */
export function buildEvidenceRecord(input: EvidenceRecordInput): EvidenceRecord {
  nonEmpty(input.insight_id, 'insight_id');
  if (!Array.isArray(input.sourceQuestions) || input.sourceQuestions.length === 0) {
    throw new Error(
      'Evidence record missing required field: sourceQuestions (at least one)',
    );
  }
  for (const q of input.sourceQuestions) nonEmpty(q, 'sourceQuestions[]');
  nonEmpty(input.answerPattern, 'answerPattern');
  if (!SIGNALS.includes(input.signal)) {
    throw new Error(
      `Evidence record has unknown signal: ${String(input.signal)}`,
    );
  }
  if (typeof input.subsignal !== 'string') {
    throw new Error('Evidence record missing required field: subsignal');
  }
  if (!Array.isArray(input.contextModifiers)) {
    throw new Error(
      'Evidence record missing required field: contextModifiers (array, may be empty)',
    );
  }
  if (!CONFIDENCES.includes(input.evidenceConfidence)) {
    throw new Error(
      `Evidence record has unknown evidenceConfidence: ${String(input.evidenceConfidence)}`,
    );
  }
  nonEmpty(input.narrativeKey, 'narrativeKey');
  if (!(ATTENTION_AREAS as readonly string[]).includes(input.attentionArea)) {
    throw new Error(
      `Evidence record has unapproved attentionArea: ${String(input.attentionArea)}`,
    );
  }
  return Object.freeze({ ...input, complete: true as const });
}

// ---------------------------------------------------------------------------
// Evidence-confidence DERIVATION (PRD §19.1)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS. `computed_signals.evidence_confidence` was written as a
// hardcoded "high" for every signal. It is not decoration: the tier selects the
// strength of participant-facing language (PRD §19.1) —
//
//     high     -> "Your responses show…"
//     moderate -> "Your responses suggest…"
//     limited  -> "One possibility worth examining is…"
//
// so recording everything as "high" would address a participant whose evidence
// was thin with unwarranted certainty. The tier must be DERIVED.
//
// The spec defines the three tiers and the language each selects but states NO
// numeric derivation, so the rule below is CONFIG-DRIVEN (PRD §15) from
// `config/scoring-v1.0.json` `language_strength.derivation`, whose values are
// marked ASSUMED_PENDING_OPERATOR_REVIEW for pilot calibration. Recalibrating
// the config changes behaviour with no code change here.

/** The resolved thresholds the derivation reads. Never hand-constructed. */
export interface ConfidenceDerivationConfig {
  extremeStates: readonly string[];
  middleState: string;
  strongCorroborationMin: number;
  moderateCorroborationMin: number;
}

/**
 * Read `language_strength.derivation` from a scoring config object.
 *
 * Throws on a missing or malformed block rather than falling back to defaults:
 * a silent default here would re-create exactly the failure this module was
 * written to remove — a confidence tier that reflects no evidence at all.
 */
export function loadConfidenceDerivation(
  scoringConfig: unknown,
): ConfidenceDerivationConfig {
  const cfg = scoringConfig as Record<string, unknown> | null | undefined;
  const ls = cfg?.['language_strength'] as Record<string, unknown> | undefined;
  const d = ls?.['derivation'] as Record<string, unknown> | undefined;
  if (!d) {
    throw new Error(
      'evidence-chain.loadConfidenceDerivation: scoring config is missing language_strength.derivation',
    );
  }
  const extremeStates = d['extreme_states'];
  const middleState = d['middle_state'];
  const strongMin = d['strong_corroboration_min'];
  const moderateMin = d['moderate_corroboration_min'];
  if (!Array.isArray(extremeStates) || extremeStates.some((s) => typeof s !== 'string')) {
    throw new Error(
      'evidence-chain.loadConfidenceDerivation: derivation.extreme_states must be a string array',
    );
  }
  if (typeof middleState !== 'string') {
    throw new Error(
      'evidence-chain.loadConfidenceDerivation: derivation.middle_state must be a string',
    );
  }
  if (typeof strongMin !== 'number' || typeof moderateMin !== 'number') {
    throw new Error(
      'evidence-chain.loadConfidenceDerivation: corroboration minimums must be numbers',
    );
  }
  return {
    extremeStates,
    middleState,
    strongCorroborationMin: strongMin,
    moderateCorroborationMin: moderateMin,
  };
}

export interface DeriveConfidenceArgs {
  /** The signal's S-LADDER position (scoring.ts `state`), not displayState. */
  state: SignalState | null;
  /** Non-null when a capacity override applies (scoring.ts `specialState`). */
  specialState: string | null;
  /**
   * How many independent sources corroborate this signal: contributing items
   * that actually carried a value, plus triggered tensions referencing it.
   */
  corroboration: number;
}

/**
 * Derive one signal's evidence-confidence tier (PRD §19.1).
 *
 * Rule, from the config's prose bands:
 *   HIGH     — an extreme ladder state (S1/S5 by default) AND strong corroboration
 *   LIMITED  — a capacity override applies (evidence is context-constrained),
 *              or neither of the other conditions holds
 *   MODERATE — otherwise (a non-middle ladder state such as S2/S4, or
 *              enough corroboration to lift an S3 out of LIMITED)
 *
 * Returns exactly one of 'high' | 'moderate' | 'limited' — lowercase, because
 * that is what the `computed_signals.evidence_confidence` CHECK constraint
 * accepts (see tests/unit/evidence-confidence-contract.test.ts).
 */
export function deriveEvidenceConfidence(
  args: DeriveConfidenceArgs,
  derivation: ConfidenceDerivationConfig,
): EvidenceConfidence {
  const { state, specialState, corroboration } = args;

  // A capacity override means the numeric value is context-constrained by
  // definition — the config's LIMITED band names "override-constrained" first.
  if (specialState !== null) return 'limited';

  // No ladder position at all means no evidence to rate.
  if (state === null) return 'limited';

  const isExtreme = derivation.extremeStates.includes(state);
  const isMiddle = state === derivation.middleState;

  if (isExtreme && corroboration >= derivation.strongCorroborationMin) {
    return 'high';
  }
  // A non-middle state (S2/S4) is directional evidence on its own; an S3 needs
  // corroboration to rise above LIMITED.
  const moderateByState = !isMiddle && !isExtreme;
  if (
    moderateByState ||
    corroboration >= derivation.moderateCorroborationMin
  ) {
    return 'moderate';
  }
  return 'limited';
}
