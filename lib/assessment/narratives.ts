// PRD §19 / Approved Narrative Library: "No generative model may create,
// strengthen, soften, or reinterpret a participant diagnosis in MVP v1.0.
// Runtime output is assembled from these approved keys and the deterministic
// engine only."
//
// WHAT REMAINS HERE. This module previously held a second, DORMANT set of
// key → copy resolvers (`resolveNarrative(library, key)`, `resolveSignalState`,
// `resolveConnectionStatement`, `resolveAttentionArea`, `resolveContextNarrative`,
// `resolvePerceptionGap`, `resolveActivationCopy`, `assembleBigPicture`). Those
// have been REMOVED: Addendum 01 v1.1 §5 requires ONE payload, ONE resolver, and
// the single shared implementation now lives in `lib/render/snapshot-view.ts`
// (importable by both the web results page and the future PDF). Keeping a second
// resolver here is exactly the "one payload, two resolvers" divergence §5
// forbids — the two lookups disagreed (null-vs-throw, {label,copy}-vs-copy) and
// the dormant one is what a future PDF renderer would otherwise pick up.
//
// The two symbols that stay are not copy resolvers: the language-strength openers
// (metadata for deterministic language-strength selection, PRD §19.1) and the
// prohibited-language guard used by consumers that assemble approved sentences.

import type { EvidenceConfidence, LanguageStrength } from './types';

/**
 * Language-strength openers, verbatim from the approved library (PRD §19.1):
 *
 *   high     → "Your responses show…"
 *   moderate → "Your responses suggest…"
 *   limited  → "One possibility worth examining is…"
 *
 * Keyed by the persisted LOWERCASE EvidenceConfidence — the form written to
 * computed_signals.evidence_confidence. The library stores these tiers under
 * UPPERCASE keys; LANGUAGE_STRENGTH_KEY is the bridge for callers that need to
 * index the library directly.
 *
 * These strings are retyped here only because this module is config-
 * parameterised (the library is passed in, not imported). A test,
 * tests/unit/copy-library-consistency, pins them to the config so they cannot
 * drift from the approved wording.
 */
export const LANGUAGE_OPENERS: Record<EvidenceConfidence, LanguageStrength> = {
  high: 'Your responses show…',
  moderate: 'Your responses suggest…',
  limited: 'One possibility worth examining is…',
};

/** Phrases that must never appear in participant-facing copy (PRD §19.1). */
export const PROHIBITED_LANGUAGE = ['caused by', 'the real problem is'] as const;

/**
 * True when text contains prohibited causal/diagnostic language.
 * Case-insensitive. Pure check — callers use it to guard assembled output.
 */
export function containsProhibitedLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_LANGUAGE.some((phrase) => lower.includes(phrase));
}
