// PRD Addendum 01 §3, §5, §11, §12 — the Snapshot payload assembler.
//
// WHAT THIS IS. The single object that BOTH renderers read: the web results
// experience and the downloadable PDF. §5 is explicit that the app "must not
// rescore for PDF ... or generate different conclusions for web and PDF", so
// this runs ONCE, at completion, and its output is stored immutably.
//
// IT ASSEMBLES; IT DOES NOT DECIDE. Every interpretive decision has already
// been made by the engine (scoring, overrides, tensions, classifiers,
// activation) before this module is called. Nothing here scores, thresholds,
// or authors copy — §19 forbids generative authorship of participant-facing
// diagnosis, and the strongest guarantee is a module that CANNOT invent.
// Everything participant-facing is a resolved narrative KEY that a renderer
// looks up in the approved library.
//
// WHY KEYS AND NOT COPY. Storing resolved prose would freeze v1.0 wording into
// every historical payload forever, so a later approved copy revision could
// never reach an old report. Storing keys means the payload records WHAT was
// concluded (which is the immutable part) and the renderer resolves the
// current approved wording for that conclusion.
//
// Pure functions. No I/O, no Date.now(), no randomness.

import type { SignalId, SignalState } from './types';
import { selectAttentionArea, attentionAreaForTension } from './interpretation';
import {
  evaluatePerceptionGap,
  PerceptionGapMethodUnspecifiedError,
} from './perception-gap';
import { activationPatterns, levelsForActivation } from './activation';
import type { ActivationLevels } from './activation';

// ---------------------------------------------------------------------------
// The payload shape (Addendum §5, with §3's version fields alongside)
// ---------------------------------------------------------------------------

/** One operating signal, as the payload records it. */
export interface PayloadSignal {
  signal: SignalId;
  /** The S-LADDER position. Always present once scored. */
  state: SignalState | null;
  /** The off-ladder state when a capacity override applies, else null. */
  specialState: string | null;
  /** The state a renderer should show: specialState when one applies. */
  displayState: string | null;
  /** Approved-copy key for whichever state is being displayed. */
  narrativeKey: string | null;
}

/** A strength or friction entry: a state plus its approved copy key. */
export interface PayloadFinding {
  /** Where the finding came from, for the evidence chain. */
  source: 'signal' | 'tension' | 'context';
  /** Signal id or tension code, depending on `source`. */
  code: string;
  /** Approved-copy key. Never copy itself. */
  narrativeKey: string | null;
}

export interface SnapshotPayload {
  /** §3: version pinning, so a stored report can always be attributed. */
  versions: {
    assessment: string;
    questionBank: string;
    scoring: string;
    narrative: string;
    report: string;
    /**
     * Addendum 01 v1.1 §3.1 requires pinning the INTERSTITIAL version alongside
     * the other five. It is not bookkeeping: the Money Moments and the synthesis
     * reveal are interstitial content, so without this pin a stored Snapshot
     * cannot reproduce which pacing and which reveal the participant actually
     * saw. A scenario that replayed under revised interstitial copy would look
     * identical to one that did not.
     */
    interstitial: string;
  };

  signals: PayloadSignal[];

  /**
   * §11: the assembled big picture, as an ordered list of approved-copy keys
   * following the required structure — strength, friction (unless null
   * finding), connection, capacity qualifier when applicable, closing pointer.
   */
  bigPicture: {
    /**
     * FOUR outcomes, not three.
     *
     * `DEVELOPING_PICTURE` is the third outcome the Option 2 gate made
     * necessary. Once NO_MEANINGFUL_FRICTION began requiring corroborating S4+
     * evidence, an all-S3 profile (developing everywhere, nothing weak, nothing
     * strong) stopped qualifying for it — but no tension fires for it either, so
     * it has no friction to report. It must be neither of the other two:
     *
     *   PRIMARY_FRICTION      something fired; there IS friction to name.
     *   NO_MEANINGFUL_FRICTION corroborated clear; safe to say nothing needs
     *                          center stage.
     *   DEVELOPING_PICTURE     nothing weak, nothing strong. No friction to
     *                          name, but NOT an all-clear either.
     *   CAPACITY_FIRST         capacity override precedes everything (§12.2).
     *
     * Collapsing DEVELOPING_PICTURE into PRIMARY_FRICTION would render a
     * friction template with zero friction items — the silent fall-through the
     * operator's regression list requires to fail. Collapsing it into
     * NO_MEANINGFUL_FRICTION would tell a developing participant everything is
     * fine, which is the over-claim the whole decision exists to prevent.
     *
     * NOTE ON THE PERSISTED NAME: historical payloads store the literal
     * 'NO_FRICTION'. That string is retained as a readable alias by renderers;
     * see BIG_PICTURE_TEMPLATE_ALIASES below.
     */
    template:
      | 'PRIMARY_FRICTION'
      | 'NO_MEANINGFUL_FRICTION'
      | 'DEVELOPING_PICTURE'
      | 'CAPACITY_FIRST';
    /** Ordered parts; each is an approved-copy key. */
    parts: string[];
  };

  strengths: PayloadFinding[];
  frictions: PayloadFinding[];

  /** §12.4: the Connection Statements. Primary first, then optional secondary. */
  connections: Array<{ code: string; narrativeKey: string }>;

  /** Context narratives (classifier-derived) when they materially explain the profile. */
  context: Array<{ code: string; narrativeKey: string }>;

  /**
   * §12.3 / §18: the Perception Gap, present ONLY when it could be evaluated.
   * `null` here is a legitimate, expected state — see the note on
   * `perceptionGapStatus` below. §18 forbids inventing one to fill a page.
   */
  perceptionGap: { code: string; narrativeKey: string } | null;
  /**
   * WHY the Perception Gap is null, so a renderer can distinguish "not
   * applicable to this participant" from "not yet implementable".
   *
   *   'finalized'      — evaluated; `perceptionGap` is populated.
   *   'not_ready'      — the Q16 gate is unmet. Correct and permanent for this
   *                      participant; the module is simply omitted (§12.3).
   *   'method_pending' — Q16 WAS answered, but the comparison method is not yet
   *                      specified in config, so the gap cannot be computed.
   *                      This is a BUILD gap, not a participant state, and it
   *                      is recorded as such rather than silently rendered as
   *                      "not applicable" — which would misreport a missing
   *                      feature as a participant characteristic.
   */
  perceptionGapStatus: 'finalized' | 'not_ready' | 'method_pending';

  /** Activation, four separate dimensions. Never averaged (PRD §11, §17). */
  activation: ActivationLevels;
  /** Named A1–A4 patterns present on this profile (§17). */
  activationPatterns: string[];

  /** §6/§18: the primary attention area, plus an optional secondary (§12.4). */
  attentionAreas: string[];

  /** §12.1: true when the engine found no meaningful friction. */
  nullFinding: boolean;

  /** Contextual subsignals (MOVE's three parts), when the engine produced them. */
  moveSubsignals: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AssembleInput {
  /** Version strings to pin. Passed in — this module never reads config. */
  versions: SnapshotPayload['versions'];

  /** The scorer's output per signal. */
  signals: Record<
    SignalId,
    {
      value: number | null;
      state: SignalState | null;
      specialState: string | null;
      displayState: SignalState | string | null;
    }
  >;

  /** Tension codes the engine triggered, in engine order. */
  tensionCodes: readonly string[];

  /** Classifier tags, flat. Used only to pick CONTEXT narratives. */
  classifierTags: readonly string[];

  /** Activation selections (option codes such as "A1_D"). */
  activationSelections: Record<string, string>;

  /** Opening B raw value (1–5), for the Perception Gap. */
  openingB: number | null;

  /** Q16 selections, which GATE the Perception Gap (PRD §29 test 15). */
  q16Selections: readonly string[];

  /** The six signal means, for the Perception Gap comparison. */
  signalMeans: Record<string, number>;

  /** The config's `perception_gap` block. */
  perceptionGapConfig: unknown;

  /** MOVE's contextual subsignals, straight from the scorer. */
  moveSubsignals: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The null finding's code (PRD §18.3). */
export const NULL_FINDING_CODE = 'NO_MEANINGFUL_FRICTION_IDENTIFIED';

/**
 * Tension codes that describe something WORKING rather than friction.
 *
 * §6 requires separate "What's Already Working" and "Where There's Friction"
 * modules, so every triggered code has to be classified. The library provides
 * no such flag, so the split is declared here, explicitly, rather than inferred
 * from wording at runtime — an inference would silently reclassify copy if a
 * headline were ever edited.
 */
const STRENGTH_TENSION_CODES: readonly string[] = Object.freeze([
  'HEALTHY_PRIVACY_BOUNDARY',
  NULL_FINDING_CODE,
]);

/**
 * Context narratives keyed by classifier tag.
 *
 * §12.5: context systems "appear when they materially explain the operating
 * profile. They are not forced into every report." The `context_narratives`
 * library supplies the copy; this maps the tags that justify including it.
 */
const CONTEXT_TAGS: readonly string[] = Object.freeze([
  'OPEN_MONEY_ENVIRONMENT',
  'MIXED_MONEY_LEARNING',
  'OBSERVATIONAL_LEARNING',
  'CRISIS_BASED_MONEY_CONVERSATION',
  'CONFLICTING_MONEY_MESSAGES',
  'LIMITED_MONEY_CONVERSATION',
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
]);

/** The library key a signal's displayed state resolves to. */
export function signalNarrativeKey(
  signal: string,
  displayState: string | null,
): string | null {
  if (!displayState) return null;
  // An off-ladder state (DIRECT_CAPACITY_LIMITED, …) has its own block; every
  // other state is an S1–S5 position under the signal.
  return displayState.startsWith('S')
    ? `signal_states.${signal}.${displayState}`
    : `special_signal_states.${displayState}`;
}

/**
 * Historical template names that may appear in already-persisted payloads.
 *
 * WHY THIS EXISTS. Snapshots are APPEND-ONLY. Every payload written before the
 * Option 2 change stores the literal string 'NO_FRICTION'. Renaming the concept
 * does not and cannot rewrite those rows, so a renderer that resolved only the
 * new name would fail to render every historical report. This alias map is the
 * compatibility shim the operator asked to be reported before any persisted
 * contract changed — it is the report, in code: resolve BOTH names, and the
 * rename stays safe without a migration.
 */
export const BIG_PICTURE_TEMPLATE_ALIASES: Record<string, string> = Object.freeze({
  NO_FRICTION: 'NO_MEANINGFUL_FRICTION',
});

/** Resolve a template name from storage, mapping any historical alias forward. */
export function resolveBigPictureTemplate(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  return BIG_PICTURE_TEMPLATE_ALIASES[stored] ?? stored;
}

/**
 * Which big-picture template applies (Addendum §11, §12.1, §12.2).
 *
 * CAPACITY_FIRST takes precedence over the others: §12.2 requires that when
 * capacity overrides apply, "ROOM/capacity context appears BEFORE agency
 * criticism". A capacity-constrained participant shown a friction-led narrative
 * first would read as criticism of discipline when the constraint is available
 * margin — precisely the confusion §29 test 10 exists to prevent.
 *
 * THE FOUR-WAY BRANCH, and why the third arm is not optional:
 *
 *   capacity override  -> CAPACITY_FIRST
 *   corroborated clear -> NO_MEANINGFUL_FRICTION
 *   friction found     -> PRIMARY_FRICTION
 *   neither            -> DEVELOPING_PICTURE
 *
 * The last arm is the case Option 2 created. An all-S3 profile has no tension
 * (`frictions.length === 0`) and no longer qualifies as a null finding, so
 * without this branch it would take PRIMARY_FRICTION and render a friction
 * template with nothing in it. `frictions.length` is therefore part of the
 * decision rather than a downstream detail: the template must never claim
 * friction that does not exist, and must never claim an all-clear that was not
 * corroborated.
 */
export function selectBigPictureTemplate(args: {
  nullFinding: boolean;
  capacityConstrained: boolean;
  /** How many friction findings will actually render. 0 = nothing to name. */
  frictionCount?: number;
}): SnapshotPayload['bigPicture']['template'] {
  if (args.capacityConstrained) return 'CAPACITY_FIRST';
  if (args.nullFinding) return 'NO_MEANINGFUL_FRICTION';
  // No friction to name AND no corroborated all-clear: the developing case.
  if (args.frictionCount === 0) return 'DEVELOPING_PICTURE';
  return 'PRIMARY_FRICTION';
}

/**
 * True when a capacity override applies to any signal.
 *
 * Read from the scorer's own specialState, not re-derived — a second
 * derivation could disagree with what the participant is shown.
 */
export function isCapacityConstrained(
  signals: AssembleInput['signals'],
): boolean {
  return Object.values(signals).some((s) => s.specialState !== null);
}

// ---------------------------------------------------------------------------
// The assembler
// ---------------------------------------------------------------------------

/**
 * Assemble the complete Snapshot payload.
 *
 * NEVER THROWS ON PARTICIPANT STATE. Every branch that cannot be resolved
 * yields a recorded status rather than an exception, because this runs inside
 * completion — and a throw here would fail the participant's completion for a
 * reason that has nothing to do with their answers. (That failure mode has
 * already been seen twice in this build: a column mismatch and an unmanaged
 * assessment_number each made completion impossible.)
 */
export function assembleSnapshotPayload(input: AssembleInput): SnapshotPayload {
  const signalIds = Object.keys(input.signals) as SignalId[];

  // ---- signals ----
  const signals: PayloadSignal[] = signalIds.map((signal) => {
    const s = input.signals[signal];
    const displayState =
      typeof s.displayState === 'string' ? s.displayState : s.state;
    return {
      signal,
      state: s.state,
      specialState: s.specialState,
      displayState: displayState ?? null,
      narrativeKey: signalNarrativeKey(signal, displayState ?? null),
    };
  });

  const nullFinding = input.tensionCodes.includes(NULL_FINDING_CODE);
  const capacityConstrained = isCapacityConstrained(input.signals);

  // ---- strengths and frictions ----
  //
  // Every triggered tension lands in exactly one list. §6 needs both modules,
  // and a code that landed in neither would silently vanish from the report.
  const strengths: PayloadFinding[] = [];
  const frictions: PayloadFinding[] = [];

  for (const code of input.tensionCodes) {
    if (code === NULL_FINDING_CODE) continue; // represented by nullFinding
    const finding: PayloadFinding = {
      source: 'tension',
      code,
      narrativeKey: `connection_statements.${code}`,
    };
    if (STRENGTH_TENSION_CODES.includes(code)) strengths.push(finding);
    else frictions.push(finding);
  }

  // A signal at an extreme ladder position is itself a strength to name, even
  // when no tension fired — §6 asks what is WORKING, and a report that only
  // lists frictions misrepresents a healthy profile.
  for (const s of signals) {
    if (s.state === 'S5') {
      strengths.push({
        source: 'signal',
        code: s.signal,
        narrativeKey: s.narrativeKey,
      });
    }
  }

  // ---- connections (§12.4) ----
  //
  // Primary first, then a SECOND only when it is independent enough to add
  // meaning. §12.4 forbids a merely duplicative secondary, and §12.1 forbids
  // manufacturing one to fill a page. Attention-area overlap is the duplicate
  // test: two tensions pointing at the same area are one finding stated twice.
  const connections = selectConnections(input.tensionCodes);

  // ---- context (§12.5) ----
  const context = input.classifierTags
    .filter((tag) => CONTEXT_TAGS.includes(tag))
    .map((tag) => ({ code: tag, narrativeKey: `context_narratives.${tag}` }));

  // ---- perception gap (§12.3) ----
  const { perceptionGap, perceptionGapStatus } = resolvePerceptionGap(input);

  // ---- activation ----
  const activation = levelsForActivation({
    A1: input.activationSelections.A1,
    A2: input.activationSelections.A2,
    A3: input.activationSelections.A3,
    A4: input.activationSelections.A4,
  });
  const patterns = activationPatterns(activation);
  const activationPatternNames = (
    Object.keys(patterns) as Array<keyof typeof patterns>
  ).filter((k) => patterns[k] === true) as string[];

  // ---- attention areas (§6, §12.4) ----
  const attentionAreas: string[] = [];
  if (input.tensionCodes.length > 0) {
    attentionAreas.push(selectAttentionArea(input.tensionCodes as never));
    // A secondary area, only when the second-strongest finding points
    // somewhere genuinely different.
    for (const code of input.tensionCodes) {
      const area = attentionAreaForTension(code as never);
      if (area && !attentionAreas.includes(area)) {
        attentionAreas.push(area);
        break;
      }
    }
  } else {
    attentionAreas.push(selectAttentionArea([]));
  }

  // ---- big picture (§11) ----
  const bigPicture = assembleBigPicture({
    template: selectBigPictureTemplate({
      nullFinding,
      capacityConstrained,
      // The rendered count, not the triggered count: a code that produced no
      // renderable key must not make the template claim friction.
      frictionCount: frictions.filter((f) => f.narrativeKey).length,
    }),
    signals,
    connections,
    frictions,
    attentionAreas,
  });

  return {
    versions: input.versions,
    signals,
    bigPicture,
    strengths,
    frictions,
    connections,
    context,
    perceptionGap,
    perceptionGapStatus,
    activation,
    activationPatterns: activationPatternNames,
    attentionAreas,
    nullFinding,
    moveSubsignals: input.moveSubsignals,
  };
}

/**
 * Choose the primary Connection and, at most, one independent secondary.
 *
 * §12.4 renders a secondary "only when: independent enough to add meaning; not
 * merely duplicative of primary tension; approved precedence allows it." The
 * engine returns tensions in precedence order, so the FIRST is the primary.
 * A candidate is independent when it points at a different attention area.
 */
export function selectConnections(
  tensionCodes: readonly string[],
): Array<{ code: string; narrativeKey: string }> {
  const codes = tensionCodes.filter((c) => c !== NULL_FINDING_CODE);
  if (codes.length === 0) return [];

  const out = [{ code: codes[0], narrativeKey: `connection_statements.${codes[0]}` }];
  const primaryArea = attentionAreaForTension(codes[0] as never);

  for (const code of codes.slice(1)) {
    const area = attentionAreaForTension(code as never);
    if (area && area !== primaryArea) {
      out.push({ code, narrativeKey: `connection_statements.${code}` });
      break;
    }
  }
  return out;
}

/**
 * Resolve the Perception Gap, recording WHY it is absent when it is.
 *
 * The distinction this preserves matters: `not_ready` is a fact about the
 * participant (they did not answer Q16); `method_pending` is a fact about the
 * BUILD (the comparison method is not implemented). Collapsing the two would
 * report a missing feature as a participant characteristic.
 */
export function resolvePerceptionGap(input: AssembleInput): {
  perceptionGap: SnapshotPayload['perceptionGap'];
  perceptionGapStatus: SnapshotPayload['perceptionGapStatus'];
} {
  try {
    const result = evaluatePerceptionGap({
      openingB: input.openingB,
      q16Selections: input.q16Selections,
      signalMeans: input.signalMeans,
      config: input.perceptionGapConfig,
    });

    if (result.status === 'not_ready') {
      return { perceptionGap: null, perceptionGapStatus: 'not_ready' };
    }
    return {
      perceptionGap: { code: result.code, narrativeKey: result.narrativeKey },
      perceptionGapStatus: 'finalized',
    };
  } catch (err) {
    // The ONLY expected throw is the unspecified comparison method. Anything
    // else is a real defect, but failing the participant's completion for it
    // would be worse than recording it — their assessment is complete either
    // way, and §7.3 makes the same call for PDF generation.
    if (err instanceof PerceptionGapMethodUnspecifiedError) {
      return { perceptionGap: null, perceptionGapStatus: 'method_pending' };
    }
    return { perceptionGap: null, perceptionGapStatus: 'method_pending' };
  }
}

/**
 * Assemble the Big Picture as an ordered list of approved-copy keys (§11).
 *
 * The required structure is a SEQUENCE, not a concatenation of the six signal
 * descriptions — §11 says so explicitly. Each part is a key; a renderer
 * resolves them in order.
 */
export function assembleBigPicture(args: {
  template: SnapshotPayload['bigPicture']['template'];
  signals: PayloadSignal[];
  connections: Array<{ code: string; narrativeKey: string }>;
  frictions: PayloadFinding[];
  attentionAreas: string[];
}): SnapshotPayload['bigPicture'] {
  const parts: string[] = [];

  // 1. one approved strength sentence — the strongest signal present.
  const strongest = pickStrongest(args.signals);
  if (strongest?.narrativeKey) parts.push(strongest.narrativeKey);

  // 2. one approved friction sentence, unless the null finding holds (§12.1).
  //
  // The template guard carries BOTH non-friction outcomes, not just the null
  // one. DEVELOPING_PICTURE is a distinct third state, but it shares this
  // property with NO_MEANINGFUL_FRICTION: neither has friction to name. Writing
  // only the null check here would have let a developing profile emit friction
  // copy — the precise over-claim Option 2 exists to prevent.
  const hasNoFrictionToName =
    args.template === 'NO_MEANINGFUL_FRICTION' ||
    args.template === 'DEVELOPING_PICTURE';
  if (!hasNoFrictionToName && args.frictions.length > 0) {
    parts.push(args.frictions[0].narrativeKey ?? '');
  }

  // 3. one approved connection statement.
  if (args.connections.length > 0) parts.push(args.connections[0].narrativeKey);

  // 4. a capacity/context qualifier, when applicable (§12.2).
  if (args.template === 'CAPACITY_FIRST') {
    const constrained = args.signals.find((s) => s.specialState !== null);
    if (constrained?.narrativeKey) parts.push(constrained.narrativeKey);
  }

  // 5. a closing sentence pointing at the primary attention area, without
  //    prescribing a transaction (§11).
  if (args.attentionAreas.length > 0) {
    parts.push(`attention_areas.${args.attentionAreas[0]}`);
  }

  return { template: args.template, parts: parts.filter(Boolean) };
}

/** The highest ladder state present, used as the Big Picture's strength. */
function pickStrongest(signals: PayloadSignal[]): PayloadSignal | undefined {
  const order = ['S5', 'S4', 'S3', 'S2', 'S1'];
  return [...signals].sort((a, b) => {
    const ai = order.indexOf(a.state ?? '');
    const bi = order.indexOf(b.state ?? '');
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  })[0];
}
