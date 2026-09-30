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
