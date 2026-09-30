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
  ActivationKey,
  ActivationLevel,
  AttentionAreaKey,
  BigPictureTemplateKey,
  ContextNarrativeKey,
  EvidenceConfidence,
  LanguageStrength,
  NarrativeLibrary,
  PerceptionGapKey,
  SignalId,
  SignalState,
  SpecialSignalState,
  TensionCode,
} from './types';


/** Activation copy key, e.g. "A1.HIGH". */
export type ActivationCopyKey = `${ActivationKey}.${ActivationLevel}`;

/**
 * Plain approved-library keys accepted by resolveNarrative: connection
 * statements (the 18 tension codes), signal states ("SEE.S1"), special
 * states, context narratives, perception-gap keys, activation copies
 * ("A1.HIGH"), attention areas, and big-picture templates. (Distinct name
 * from types.ts `NarrativeKey`, which uses dotted library paths — the
 * resolver accepts both plain and dotted forms.)
 */
export type NarrativeLookupKey =
  | TensionCode
  | `${SignalId}.${SignalState}`
  | SpecialSignalState
  | ContextNarrativeKey
  | PerceptionGapKey
  | ActivationCopyKey
  | AttentionAreaKey
  | BigPictureTemplateKey;

/** Library-derived entry shapes (JSON values widen to string). */
export type ResolvedConnectionStatement =
  NarrativeLibrary['connection_statements'][TensionCode];
export type ResolvedSignalState =
  NarrativeLibrary['signal_states'][SignalId][SignalState];
export type ResolvedSpecialSignalState =
  NarrativeLibrary['special_signal_states'][SpecialSignalState];
export type ResolvedPerceptionGap =
  NarrativeLibrary['perception_gap'][PerceptionGapKey];
export type ResolvedAttentionArea =
  NarrativeLibrary['attention_areas'][AttentionAreaKey];

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

/** Resolve one connection statement by its tension code. Throws if unknown. */
export function resolveConnectionStatement(
  library: NarrativeLibrary,
  code: TensionCode,
): ResolvedConnectionStatement {
  const entry = (library.connection_statements as Record<string, ResolvedConnectionStatement>)[
    code
  ];
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
): ResolvedSignalState {
  const entry = (
    library.signal_states as Record<string, Record<string, ResolvedSignalState>>
  )[signal]?.[state];
  if (entry === undefined) {
    throw new Error(`Unknown signal state key: ${signal}.${state}`);
  }
  return entry;
}

/** Resolve one special (off-ladder) signal state. Throws if unknown. */
export function resolveSpecialSignalState(
  library: NarrativeLibrary,
  key: SpecialSignalState,
): ResolvedSpecialSignalState {
  const entry = (
    library.special_signal_states as Record<string, ResolvedSpecialSignalState>
  )[key as string];
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
  const entry = (library.context_narratives as Record<string, string>)[
    key as string
  ];
  if (entry === undefined) {
    throw new Error(`Unknown context narrative key: ${String(key)}`);
  }
  return entry;
}

/** Resolve one perception-gap entry. Throws if unknown. */
export function resolvePerceptionGap(
  library: NarrativeLibrary,
  key: PerceptionGapKey,
): ResolvedPerceptionGap {
  const entry = (library.perception_gap as Record<string, ResolvedPerceptionGap>)[
    key as string
  ];
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
  const entry = (
    library.activation as Record<string, Record<string, string>>
  )[question]?.[level];
  if (entry === undefined) {
    throw new Error(`Unknown activation key: ${key}`);
  }
  return entry;
}

/** Resolve one attention-area entry. Throws if unknown. */
export function resolveAttentionArea(
  library: NarrativeLibrary,
  key: AttentionAreaKey,
): ResolvedAttentionArea {
  const entry = (library.attention_areas as Record<string, ResolvedAttentionArea>)[
    key as string
  ];
  if (entry === undefined) {
    throw new Error(`Unknown attention area key: ${String(key)}`);
  }
  return entry;
}

/** Known dotted-path prefixes (types.ts `NarrativeKey` form) → plain key. */
const DOTTED_PREFIXES = [
  'connection_statements.',
  'special_signal_states.',
  'context_narratives.',
  'perception_gap.',
  'attention_areas.',
] as const;

/**
 * Generic approved-key lookup: resolve any lookup key to its primary
 * approved text (body/copy). Accepts the plain keys and the dotted
 * `NarrativeKey` library paths (prefixes are stripped, not interpreted).
 * Throws on any unknown key — never falls back, never generates.
 */
export function resolveNarrative(
  library: NarrativeLibrary,
  key: NarrativeLookupKey | string,
): string {
  let plain = key;
  for (const prefix of DOTTED_PREFIXES) {
    if (plain.startsWith(prefix)) {
      plain = plain.slice(prefix.length);
      break;
    }
  }
  if (plain.startsWith('signal_states.')) {
    plain = plain.slice('signal_states.'.length);
  } else if (plain.startsWith('activation.')) {
    plain = plain.slice('activation.'.length);
  }

  const conn = (library.connection_statements as Record<string, { body: string }>)[
    plain
  ];
  if (conn !== undefined) return conn.body;

  const dot = plain.split('.');
  if (dot.length === 2) {
    const [head, tail] = dot;
    const sig = (library.signal_states as Record<string, Record<string, { copy: string }>>)[
      head
    ]?.[tail];
    if (sig !== undefined) return sig.copy;
    const act = (library.activation as Record<string, Record<string, string>>)[
      head
    ]?.[tail];
    if (act !== undefined) return act;
  }
  const special = (
    library.special_signal_states as Record<string, { copy: string }>
  )[plain];
  if (special !== undefined) return special.copy;
  const ctx = (library.context_narratives as Record<string, string>)[plain];
  if (ctx !== undefined) return ctx;
  const gap = (library.perception_gap as Record<string, { body: string }>)[
    plain
  ];
  if (gap !== undefined) return gap.body;
  const area = (library.attention_areas as Record<string, { body: string }>)[
    plain
  ];
  if (area !== undefined) return area.body;
  const tpl = (
    (library as unknown as Record<string, Record<string, string>>)
      .big_picture_templates ?? {}
  )[plain];
  if (tpl !== undefined) return tpl;
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
 * the caller resolved via the lookups above. Throws on prohibited language
 * and on unknown template keys. Exact approved templates:
 * - PRIMARY_FRICTION: `{strength_sentence} {friction_sentence} {connection_sentence}`
 * - CAPACITY_FIRST: `{strength_sentence} Your responses suggest that limited financial room deserves to be interpreted before questions of discipline or intentionality. {connection_sentence}`
 * - NO_FRICTION: `{strength_sentence} Across the assessment, no single area of friction clearly explains the rest of your financial picture. {connection_sentence}`
 */
export function assembleBigPicture(
  library: NarrativeLibrary,
  template: BigPictureTemplateKey,
  slots: BigPictureSlots,
): string {
  const templates = (
    library as unknown as Record<string, Record<string, string>>
  ).big_picture_templates;
  const raw = templates?.[template];
  if (raw === undefined) {
    throw new Error(`Unknown big picture template: ${String(template)}`);
  }
  const out = raw
    .split('{strength_sentence}')
    .join(slots.strength_sentence)
    .split('{friction_sentence}')
    .join(slots.friction_sentence)
    .split('{connection_sentence}')
    .join(slots.connection_sentence);
  if (containsProhibitedLanguage(out)) {
    throw new Error('Assembled copy contains prohibited language.');
  }
  return out;
}
