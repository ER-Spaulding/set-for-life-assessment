// PRD §19 / Approved Narrative Library: "No generative model may create,
// strengthen, soften, or reinterpret a participant diagnosis in MVP v1.0.
// Runtime output is assembled from these approved keys and the deterministic
// engine only."

// PRD §19 — narratives: LOOKUP ONLY. Every resolver below is a pure lookup
// into a caller-supplied approved library object (no I/O — the caller loads
// the JSON). Unknown keys THROW. No templating, no string building, no
// generation, no fallback text — except assembleBigPicture, which slots
// already-approved sentences into the three exact approved templates.
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import type {
  AttentionAreaKey,
  BigPictureTemplateKey,
  ConnectionStatement,
  ContextNarrativeKey,
  NarrativeLibrary,
  PerceptionGapKey,
  SignalId,
  SignalState,
  SignalStateEntry,
  SpecialSignalStateEntry,
  SpecialSignalState,
  TensionCode,
} from './types';

/** Activation copy key, e.g. "A1.HIGH". */
export type ActivationCopyKey =
  `${import('./types').ActivationKey}.${import('./types').ActivationLevel}`;

/**
 * Every key the approved library can resolve: connection statements (the 18
 * tension codes), signal states ("SEE.S1"), special states, context
 * narratives, perception-gap keys, activation copies ("A1.HIGH"), attention
 * areas, and big-picture templates.
 */
export type NarrativeKey =
  | TensionCode
  | `${SignalId}.${SignalState}`
  | SpecialSignalState
  | ContextNarrativeKey
  | PerceptionGapKey
  | ActivationCopyKey
  | AttentionAreaKey
  | BigPictureTemplateKey;

/** Language-strength openers, verbatim (PRD §19.1). */
export const LANGUAGE_OPENERS = {
  high: 'Your responses show…',
  moderate: 'Your responses suggest…',
  limited: 'One possibility worth examining is…',
} as const;

/** Phrases that must never appear in participant-facing copy (PRD §19.1). */
export const PROHIBITED_LANGUAGE = [
  'caused by',
  'the real problem is',
] as const;

/**
 * True when text contains prohibited causal/diagnostic language.
 * Case-insensitive. Pure check — callers use it to guard assembled output.
 */
export function containsProhibitedLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_LANGUAGE.some((phrase) => lower.includes(phrase));
}

/** Resolve one connection statement by its tension code. Throws if unknown. */
export function resolveConnectionStatement(
  library: NarrativeLibrary,
  code: TensionCode,
): ConnectionStatement {
  const entry = library.connection_statements[code];
  if (entry === undefined) {
    throw new Error(`Unknown connection statement key: ${String(code)}`);
  }
  return entry;
}

/** Resolve one standard signal-state entry ("SEE.S1"). Throws if unknown. */
export function resolveSignalState(
  library: NarrativeLibrary,
  signal: SignalId,
  state: SignalState,
): SignalStateEntry {
  const entry = library.signal_states[signal]?.[state];
  if (entry === undefined) {
    throw new Error(`Unknown signal state key: ${signal}.${state}`);
  }
  return entry;
}

/** Resolve one special (off-ladder) signal state. Throws if unknown. */
export function resolveSpecialSignalState(
  library: NarrativeLibrary,
  key: SpecialSignalState,
): SpecialSignalStateEntry {
  const entry = library.special_signal_states[key];
  if (entry === undefined) {
    throw new Error(`Unknown special signal state key: ${String(key)}`);
  }
  return entry;
}

/** Resolve one context narrative string. Throws if unknown. */
export function resolveContextNarrative(
  library: NarrativeLibrary,
  key: ContextNarrativeKey,
): string {
  const entry = library.context_narratives[key];
  if (entry === undefined) {
    throw new Error(`Unknown context narrative key: ${String(key)}`);
  }
  return entry;
}

/** Resolve one perception-gap entry. Throws if unknown. */
export function resolvePerceptionGap(
  library: NarrativeLibrary,
  key: PerceptionGapKey,
): { headline: string; body: string } {
  const entry = library.perception_gap[key];
  if (entry === undefined) {
    throw new Error(`Unknown perception gap key: ${String(key)}`);
  }
  return entry;
}

/** Resolve one activation sentence ("A1.HIGH"). Throws if unknown. */
export function resolveActivationCopy(
  library: NarrativeLibrary,
  key: ActivationCopyKey,
): string {
  const [question, level] = key.split('.');
  const entry = library.activation[question as keyof NarrativeLibrary['activation']]?.[
    level as keyof NarrativeLibrary['activation']['A1']
  ];
  if (entry === undefined) {
    throw new Error(`Unknown activation key: ${key}`);
  }
  return entry;
}

/** Resolve one attention-area entry. Throws if unknown. */
export function resolveAttentionArea(
  library: NarrativeLibrary,
  key: AttentionAreaKey,
): { label: string; body: string } {
  const entry = library.attention_areas[key];
  if (entry === undefined) {
    throw new Error(`Unknown attention area key: ${String(key)}`);
  }
  return entry;
}

/**
 * Generic approved-key lookup: resolve any NarrativeKey to its primary
 * approved text (body/copy). Throws on any unknown key — never falls back.
 */
export function resolveNarrative(
  library: NarrativeLibrary,
  key: NarrativeKey,
): string {
  if (key in library.connection_statements) {
    return resolveConnectionStatement(library, key as TensionCode).body;
  }
  const dot = (key as string).split('.');
  if (dot.length === 2) {
    const [head, tail] = dot;
    if (head in library.signal_states) {
      return resolveSignalState(
        library,
        head as SignalId,
        tail as SignalState,
      ).copy;
    }
    if (head in library.activation) {
      return resolveActivationCopy(library, key as ActivationCopyKey);
    }
  }
  if ((key as string) in library.special_signal_states) {
    return resolveSpecialSignalState(library, key as SpecialSignalState).copy;
  }
  if ((key as string) in library.context_narratives) {
    return resolveContextNarrative(library, key as ContextNarrativeKey);
  }
  if ((key as string) in library.perception_gap) {
    return resolvePerceptionGap(library, key as PerceptionGapKey).body;
  }
  if ((key as string) in library.attention_areas) {
    return resolveAttentionArea(library, key as AttentionAreaKey).body;
  }
  if ((key as string) in library.big_picture_templates) {
    return library.big_picture_templates[key as BigPictureTemplateKey];
  }
  throw new Error(`Unknown narrative key: ${String(key)}`);
}

/** Approved big-picture assembly slots — already-approved sentences only. */
export interface BigPictureSlots {
  strength_sentence: string;
  friction_sentence: string;
  connection_sentence: string;
}

/**
 * Assemble the big-picture paragraph by slotting already-approved sentences
 * into the exact approved template. No new prose is authored here: the
 * template comes from the library and every slot must be an approved string
 * the caller resolved via the lookups above. Throws on prohibited language.
 */
export function assembleBigPicture(
  library: NarrativeLibrary,
  template: BigPictureTemplateKey,
  slots: BigPictureSlots,
): string {
  const raw = library.big_picture_templates[template];
  if (raw === undefined) {
    throw new Error(`Unknown big picture template: ${String(template)}`);
  }
  const out = raw
    .replace('{strength_sentence}', slots.strength_sentence)
    .replace('{friction_sentence}', slots.friction_sentence)
    .replace('{connection_sentence}', slots.connection_sentence);
  if (containsProhibitedLanguage(out)) {
    throw new Error('Assembled copy contains prohibited language.');
  }
  return out;
}
