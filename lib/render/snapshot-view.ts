// Addendum 01 v1.1 §5 — THE SHARED RESOLUTION CONTRACT.
//
// ONE SNAPSHOT PAYLOAD, ONE RESOLVER. This module is the SINGLE function that
// turns the stored, immutable `SnapshotPayload` into a fully-resolved,
// participant-facing view. The web results page and the PDF renderer must BOTH
// consume this module through the SAME shared section model
// (`resolveSnapshotContent` in lib/render/snapshot-sections.ts -> this module's
// `resolveSnapshotView` -> `resolveSnapshotSections`). There is exactly one
// implementation of key → copy; a renderer that grows its own lookup is a §5
// violation, and the guard test
// `tests/integration/snapshot-resolution-single-source.test.ts` fails the
// moment one appears.
//
// PURE, DETERMINISTIC, NO I/O. No Date.now(), no randomness, no network, no
// database. It cannot recompute: it imports NO scoring, tensions, classifiers,
// or session/service code. Its only input is the payload. The same payload
// resolves to the same view, everywhere, forever.
//
// KEYS IN, COPY OUT. The payload stores conclusion KEYS (never prose). This
// module resolves them against the PINNED narrative libraries at render time —
// config/narratives-v1.0.json and config/connection-statements-v1.0.json —
// exactly as the former lib/ui/narratives.ts did. Unresolvable keys are OMITTED
// (never rendered raw, never thrown): a raw identifier on a participant screen
// would expose internal vocabulary (§24) and read as a bug.
//
// The destination-theme labels resolve from the pinned question bank's Q16
// options via the client-safe projection in lib/ui/questions.ts (§9: "from the
// pinned question bank"), so that lookup has one owner too.
// The four activation dimension labels resolve from the ONE shared source
// lib/ui/snapshot-activation.ts (owner ruling 2026-10-02), so both renderers
// consume the same label from the resolved view.

import narratives from "../../config/narratives-v1.0.json";
import connectionStatements from "../../config/connection-statements-v1.0.json";
import { HUMAN_QUESTIONS } from "../ui/human-questions";
import { questionById } from "../ui/questions";
import {
  ACTIVATION_ITEMS,
  ACTIVATION_LABELS,
  type ActivationItem,
} from "../ui/snapshot-activation";
import type { SnapshotPayload } from "../assessment/snapshot-payload";

// ---------------------------------------------------------------------------
// Resolved view shapes
// ---------------------------------------------------------------------------

/** One signal, fully resolved to participant-facing copy. */
export interface ResolvedSignalRow {
  /** Internal id (SEE/ROOM/…) — for renderers' key/structure only, never shown. */
  signal: string;
  /** The §2.4 human-question label, verbatim, FULL CAPS. */
  question: string;
  /** The state's approved short title (e.g. "Hard to See Clearly"). */
  label: string;
  /** The narrative body. */
  copy: string;
  /** True iff the row resolved a special (off-ladder) capacity state. */
  isCapacity: boolean;
}

/** One approved connection statement. */
export interface ResolvedConnection {
  /** The statement's own headline — the Friction/Strength finding TITLE. */
  headline: string;
  /** The statement body — the Friction/Strength finding explanation. */
  body: string;
  /** The Connection section's own headline (falls back to `headline`). */
  connectionHeadline: string;
  /** The Connection section's own prose paragraphs (may be empty). */
  connectionFraming: string[];
  /**
   * True when `body` already renders elsewhere — as a friction or a strength.
   * The section model uses this so ONE approved string renders in exactly ONE
   * section (Owner §14 / plan D5); the Connection block then carries framing
   * only. The edge case where a connection code renders ONLY here (neither
   * friction nor strength) keeps the body, preserving the old headline+body.
   */
  bodyRenderedElsewhere: boolean;
}

/** One approved attention-area copy. */
export interface ResolvedAttentionArea {
  label: string;
  /** Short form for the subordinate secondary: "KEEP IN VIEW — <shortLabel>". */
  shortLabel: string;
  /** Approved body paragraphs (1+). */
  paragraphs: string[];
}

/** A strength or friction finding: a short title plus its body. */
export interface ResolvedFinding {
  label: string;
  copy: string;
}

/** The full, fully-resolved, participant-facing view of a Snapshot. */
export interface ResolvedSnapshotView {
  signals: ResolvedSignalRow[]; // payload order; un-resolvable key => OMITTED
  connections: ResolvedConnection[]; // primary, then optional secondary
  primaryAttentionArea: ResolvedAttentionArea | null;
  secondaryAttentionArea: ResolvedAttentionArea | null;
  bigPicture: {
    template: SnapshotPayload["bigPicture"]["template"];
    /** The editorial synthesis headline (Owner golden sample). */
    headline: string;
    /** The synthesis body paragraphs — NOT the borrowed `parts` keys. */
    body: string[];
  } | null;
  strengths: ResolvedFinding[];
  frictions: ResolvedFinding[];
  context: string[]; // resolved context-narrative strings, payload order
  perceptionGap: { label: string; body: string } | null; // only when finalized
  perceptionGapStatus: "finalized" | "not_ready" | "method_pending";
  activation: Array<{
    item: ActivationItem;
    level: "LOW" | "MID" | "HIGH";
    /** The band's STATE label (e.g. "No Manufactured Emergency"). */
    label: string;
    /** The dimension name from the ONE shared source (the readiness kicker). */
    dimension: string;
    /** Approved body paragraphs for this band. */
    paragraphs: string[];
  }>; // four separate, never averaged
  activationPatterns: string[]; // internal layout only, never displayed as copy
  destinationThemes: Array<{ code: string; label: string }>; // Q16 selections
  /**
   * Governed fixed framing paragraphs keyed by section id (the retired DRAFT
   * web-copy constants — plan D7 / Owner §13). Sections without a key get none.
   */
  sectionIntros: Record<string, string[]>;
  /**
   * Destination framing: the fixed intro PLUS the composed framing list (the
   * selected themes' governed fragments, joined), and the closing outro (lede
   * + composed outcome list). Compositional (Owner guardrail 2 / plan D8): no
   * per-combination entries; payloads without `q16Selections` get an empty
   * outro — the true fallback never invents one.
   */
  destinationFrame: { intro: string[]; outro: string[] };
  nullFinding: boolean;
}

// ---------------------------------------------------------------------------
// The pinned libraries (read once; same sources the former lib/ui/narratives.ts
// used).
// ---------------------------------------------------------------------------

type NarrativeValue = { label?: unknown; copy?: unknown };
type SignalStatesBlock = Record<string, Record<string, NarrativeValue>>;
type SpecialStatesBlock = Record<string, NarrativeValue>;
type AttentionAreasBlock = Record<
  string,
  { label?: unknown; short_label?: unknown; body?: unknown }
>;
type ConnectionStatementsBlock = Record<
  string,
  {
    headline?: unknown;
    body?: unknown;
    connection?: { headline?: unknown; framing?: unknown };
  }
>;
type ContextNarrativesBlock = Record<string, unknown>;
type PerceptionGapBlock = Record<string, { headline?: unknown; body?: unknown }>;
type ActivationBlock = Record<
  string,
  Record<string, { stateLabel?: unknown; body?: unknown }>
>;
type BigPictureBlock = Record<
  string,
  Record<string, { headline?: unknown; body?: unknown }>
>;

const SIGNAL_STATES = narratives.signal_states as unknown as SignalStatesBlock;
const SPECIAL_STATES = narratives.special_signal_states as unknown as SpecialStatesBlock;
const ATTENTION_AREAS = narratives.attention_areas as unknown as AttentionAreasBlock;
const CONNECTION_STATEMENTS = connectionStatements as unknown as ConnectionStatementsBlock;
const CONTEXT_NARRATIVES = narratives.context_narratives as unknown as ContextNarrativesBlock;
const PERCEPTION_GAP = narratives.perception_gap as unknown as PerceptionGapBlock;
const ACTIVATION = narratives.activation as unknown as ActivationBlock;
const BIG_PICTURE = (
  narratives as unknown as { big_picture?: BigPictureBlock }
).big_picture;
const SECTION_INTROS = (
  narratives as unknown as { section_intros?: Record<string, unknown> }
).section_intros;
const DESTINATION = (
  narratives as unknown as {
    destination?: {
      intro?: unknown;
      lede?: { contrast?: unknown; plain?: unknown };
      tail?: unknown;
      theme_clauses?: Record<string, unknown>;
    };
  }
).destination;
/** "Why it is a strength" framings for S5 signal-sourced strengths (D13/§14). */
const SIGNAL_STRENGTHS = (
  narratives as unknown as { signal_strengths?: Record<string, unknown> }
).signal_strengths;

/**
 * The three evidence-confidence voices a ladder state carries (Owner evidence-
 * stem decision, PRD §19.1). The write-path guard and other key-existence
 * callers resolve WITHOUT a confidence; `moderate` is their representative —
 * it exists only to prove the key resolves, never as a participant render
 * default. Participant rendering always passes the payload's persisted
 * confidence (see `resolveSnapshotView`), and a payload that carries none
 * renders the LIMITED voice — never a silent moderate.
 */
type EvidenceVoice = "high" | "moderate" | "limited";

// ---------------------------------------------------------------------------
// Low-level primitives (the SAME functions `resolveSnapshotView` uses)
// ---------------------------------------------------------------------------

/**
 * True when this narrative key is an off-ladder (capacity-override) state.
 *
 * The Snapshot renders these differently — the approved vocabulary describes a
 * constrained situation rather than a low score — but the SCREEN does not
 * explain the override. Nothing here says "capacity": the copy itself carries
 * the meaning, which keeps the machinery internal (§24).
 */
export function isSpecialState(key: string): boolean {
  return key.startsWith("special_signal_states.");
}

/**
 * The participant-facing label for a signal — one of §2.4's six human questions.
 *
 * The payload still keys on the internal id (SEE, ROOM, …). This is the
 * translation layer between the diagnostic vocabulary and what a participant
 * reads. Unknown keys return an EMPTY STRING rather than the raw code (§24).
 */
export function signalQuestionLabel(signal: string): string {
  return SIGNAL_QUESTION_LABEL[signal] ?? "";
}

/** Established-name alias — same implementation. */
export const signalLabel = signalQuestionLabel;

const SIGNAL_QUESTION_LABEL: Record<string, string> = Object.fromEntries(
  HUMAN_QUESTIONS.map((q) => [q.signal, q.question]),
);

/** Resolve a tension code to its approved connection statement. */
export function resolveConnection(code: string): ResolvedConnection | null {
  const entry = CONNECTION_STATEMENTS[code];
  if (!entry) return null;
  if (typeof entry.headline !== "string" || typeof entry.body !== "string") {
    return null;
  }
  const sub = entry.connection;
  const connectionHeadline =
    typeof sub?.headline === "string" ? sub.headline : entry.headline;
  const connectionFraming = Array.isArray(sub?.framing)
    ? (sub.framing.filter((p): p is string => typeof p === "string"))
    : [];
  return {
    headline: entry.headline,
    body: entry.body,
    connectionHeadline,
    connectionFraming,
    // Filled by `resolveSnapshotView`, which knows which codes render as
    // frictions/strengths; the key-guard path (below) never renders, so false
    // is harmless there.
    bodyRenderedElsewhere: false,
  };
}

/** Resolve an attention area to its approved copy. */
export function resolveAttentionArea(key: string): ResolvedAttentionArea | null {
  const entry = ATTENTION_AREAS[key];
  if (!entry) return null;
  if (typeof entry.label !== "string" || !Array.isArray(entry.body)) {
    return null;
  }
  const paragraphs = entry.body.filter((p): p is string => typeof p === "string");
  if (paragraphs.length === 0) return null;
  return {
    label: entry.label,
    shortLabel: typeof entry.short_label === "string" ? entry.short_label : entry.label,
    paragraphs,
  };
}

/**
 * Resolve the `{ label, copy }` of a signal narrative key.
 *
 * Accepts either form the engine emits:
 *   `signal_states.SEE.S5`              → the ladder-state copy (three voices)
 *   `special_signal_states.DIRECT_…`    → the off-ladder copy (single string)
 *
 * Ladder states carry a THREE-VOICE confidence variant. `confidence` is the
 * payload's persisted `evidence.confidence` (PRD §19.1 deterministic language-
 * strength selection). When the caller passes NO confidence (the write-path
 * guard's key-existence check) `moderate` is the representative — that is not
 * a render default. When a payload carries no confidence at all (a valid
 * schema-1.0 historical payload), `resolveSnapshotView` passes "limited": the
 * derivation's own "cannot establish strength" tier, so a legacy snapshot
 * never silently reads as moderate and never crashes (Owner amendment 4).
 *
 * Returns null for an unrecognised or malformed key — never the key itself.
 */
function resolveSignalStateCopy(
  key: string,
  confidence?: EvidenceVoice,
): { label: string; copy: string } | null {
  const parts = key.split(".");
  let value: NarrativeValue | undefined;
  let isLadder = false;

  if (parts.length === 3 && parts[0] === "signal_states") {
    value = SIGNAL_STATES?.[parts[1]]?.[parts[2]];
    isLadder = true;
  } else if (parts.length === 2 && parts[0] === "special_signal_states") {
    value = SPECIAL_STATES?.[parts[1]];
  } else {
    return null;
  }

  if (typeof value?.label !== "string") return null;

  if (isLadder) {
    const voices = value.copy as unknown;
    if (!voices || typeof voices !== "object") return null;
    const v = voices as Record<string, unknown>;
    const chosen = (confidence ?? "moderate") as EvidenceVoice;
    const pick = typeof v[chosen] === "string" ? v[chosen] : null;
    if (typeof pick !== "string") return null;
    return { label: value.label, copy: pick };
  }

  if (typeof value.copy !== "string") return null;
  return { label: value.label, copy: value.copy };
}

/**
 * Resolve one signal to its full row, or null when the key does not resolve.
 *
 * The single entry point the web page uses for its three signal fields (question,
 * label, copy) and the PDF reaches through the shared section model.
 *
 * `confidence` is the signal's persisted evidence voice; omitted only by
 * key-existence callers (guard), where `moderate` represents the key.
 */
export function resolveSignalRow(
  signal: string,
  narrativeKey: string | null,
  confidence?: string,
): ResolvedSignalRow | null {
  if (!narrativeKey) return null;
  const voice: EvidenceVoice | undefined =
    confidence === "high" || confidence === "moderate" || confidence === "limited"
      ? confidence
      : undefined;
  const stateCopy = resolveSignalStateCopy(narrativeKey, voice);
  if (!stateCopy) return null;
  return {
    signal,
    question: signalQuestionLabel(signal),
    label: stateCopy.label,
    copy: stateCopy.copy,
    isCapacity: isSpecialState(narrativeKey),
  };
}

/**
 * Resolve ANY dotted narrative key to its body/copy string (null on unknown).
 *
 * Handles the full key space the payload can contain — signal states, special
 * states, connection statements, context narratives, the perception gap,
 * attention areas, activation copy, and big-picture templates. Used to resolve
 * the big-picture parts and the context narratives; never throws, so an
 * unrecognised key omits rather than crashes a render.
 */
export function resolveNarrativeBody(key: string): string | null {
  let plain = key;
  for (const prefix of [
    "connection_statements.",
    "special_signal_states.",
    "context_narratives.",
    "perception_gap.",
    "attention_areas.",
    "signal_states.",
    "activation.",
    "big_picture.",
  ]) {
    if (plain.startsWith(prefix)) {
      plain = plain.slice(prefix.length);
      break;
    }
  }

  const conn = CONNECTION_STATEMENTS[plain];
  if (conn && typeof conn.body === "string") return conn.body;

  const dot = plain.split(".");
  if (dot.length === 2) {
    const sig = SIGNAL_STATES?.[dot[0]]?.[dot[1]];
    // Ladder copy is now a three-voice variant; this path exists for KEY
    // EXISTENCE (the write-path guard) and context-style lookups, never for
    // participant rendering — see resolveSignalStateCopy.
    if (sig && sig.copy && typeof sig.copy === "object") {
      const voices = sig.copy as Record<string, unknown>;
      if (typeof voices.moderate === "string") return voices.moderate;
    }
    const act = ACTIVATION?.[dot[0]]?.[dot[1]];
    if (act && Array.isArray(act.body)) {
      const first = act.body.find((p) => typeof p === "string");
      if (typeof first === "string") return first;
    }
  }

  const special = SPECIAL_STATES[plain];
  if (special && typeof special.copy === "string") return special.copy;

  const ctx = CONTEXT_NARRATIVES[plain];
  if (typeof ctx === "string") return ctx;

  const gap = PERCEPTION_GAP[plain];
  if (gap && typeof gap.body === "string") return gap.body;

  const area = ATTENTION_AREAS[plain];
  if (area && Array.isArray(area.body)) {
    const first = area.body.find((p) => typeof p === "string");
    if (typeof first === "string") return first;
  }

  // `big_picture.<TEMPLATE>[.<AREA>]` — the synthesis family (plan D2). The
  // payload never stores these as narrative keys (the template rides on
  // `bigPicture.template`), so this branch exists for completeness of the key
  // space; existence checks resolve to the default entry's first paragraph.
  if (dot.length <= 2) {
    const bp = BIG_PICTURE?.[dot[0]];
    const chosen = (dot.length === 2 && bp?.[dot[1]]) || bp?.["default"];
    if (chosen && Array.isArray(chosen.body)) {
      const first = chosen.body.find((p) => typeof p === "string");
      if (typeof first === "string") return first;
    }
  }

  return null;
}

/**
 * Resolve a strength/friction finding to `{ label, copy }` (null on unknown).
 *
 * EXPORTED FOR THE KEY GUARD. `assertNarrativeKeysResolvable` must ask exactly
 * the question this function answers — "would this finding render, or would it
 * be omitted?" — and the ONLY safe way to ask it is to call the same code. A
 * guard that reimplemented the check could accept a key this function rejects
 * (a connection statement with a body but no headline, say) and would then wave
 * through a payload whose content silently vanishes. Exporting the primitive
 * makes that class of disagreement impossible rather than merely tested for.
 */
export function resolveFinding(
  finding: {
    narrativeKey: string | null;
  },
  /**
   * Optional evidence voice for signal-sourced findings (S5 strengths), so a
   * participant render keeps the confidence variant. Key-existence callers
   * (the write-path guard) omit it and get the representative — see
   * resolveSignalStateCopy.
   */
  confidence?: string,
): ResolvedFinding | null {
  if (!finding.narrativeKey) return null;

  const connPrefix = "connection_statements.";
  if (finding.narrativeKey.startsWith(connPrefix)) {
    const code = finding.narrativeKey.slice(connPrefix.length);
    const conn = resolveConnection(code);
    if (!conn) return null;
    return { label: conn.headline, copy: conn.body };
  }

  const voice: EvidenceVoice | undefined =
    confidence === "high" || confidence === "moderate" || confidence === "limited"
      ? confidence
      : undefined;

  // SIGNAL-SOURCED STRENGTHS (D13 / Owner §14). An S5 signal is itself a
  // strength to name — but its ladder copy is exactly what the Money Picture
  // already renders for that dimension, so reusing it would make the two
  // sections say the same thing twice (the audit caught this at containment
  // 1.00). The governed `signal_strengths.<SIGNAL>` family supplies a distinct
  // "why this is a strength" framing instead; the LABEL stays the state title.
  // A missing entry falls back to the ladder copy (never omits).
  const ladder = finding.narrativeKey.split(".");
  if (ladder.length === 3 && ladder[0] === "signal_states" && ladder[2] === "S5") {
    const framing = SIGNAL_STRENGTHS?.[ladder[1]];
    if (typeof framing === "string") {
      const base = resolveSignalStateCopy(finding.narrativeKey, voice);
      if (base) return { label: base.label, copy: framing };
    }
  }

  return resolveSignalStateCopy(finding.narrativeKey, voice);
}

/** Resolve the perception gap's `{ label, body }` (headline → label). */
function resolvePerceptionGapCopy(gap: {
  code: string;
  narrativeKey: string;
}): { label: string; body: string } | null {
  const plain = gap.narrativeKey.startsWith("perception_gap.")
    ? gap.narrativeKey.slice("perception_gap.".length)
    : gap.code;
  const entry = PERCEPTION_GAP[plain];
  if (!entry || typeof entry.headline !== "string" || typeof entry.body !== "string") {
    return null;
  }
  return { label: entry.headline, body: entry.body };
}

/**
 * Resolve one activation band to `{ stateLabel, paragraphs }` (null when the
 * band does not exist). The participant render path uses this; the four
 * dimension NAMES stay in lib/ui/snapshot-activation.ts (owner ruling
 * 2026-10-02) and ride the view as `dimension`.
 */
export function resolveActivationEntry(
  item: string,
  level: string,
): { stateLabel: string; paragraphs: string[] } | null {
  const entry = ACTIVATION?.[item]?.[level];
  if (!entry || typeof entry.stateLabel !== "string" || !Array.isArray(entry.body)) {
    return null;
  }
  const paragraphs = entry.body.filter((p): p is string => typeof p === "string");
  if (paragraphs.length === 0) return null;
  return { stateLabel: entry.stateLabel, paragraphs };
}

/**
 * Resolve one activation sentence ("A1.HIGH"). Empty string on unknown.
 *
 * EXPORTED FOR THE KEY GUARD — same reasoning as `resolveFinding` above. Note
 * the empty-string contract: an unknown activation band yields `""` rather than
 * null, so the guard tests for a non-empty string rather than for null. Since
 * bands became `{stateLabel, body[]}`, the representative string is the first
 * body paragraph — key existence, never a label substitute.
 */
export function resolveActivationCopy(item: string, level: string): string {
  const entry = resolveActivationEntry(item, level);
  return entry ? entry.paragraphs[0] : "";
}

/** Resolve a Q16 option code to its label from the pinned question bank. */
function resolveQ16Label(code: string): string {
  const q16 = questionById("Q16");
  const option = q16?.options.find((o) => o.code === code);
  return option?.label ?? "";
}

// ---------------------------------------------------------------------------
// The full view
// ---------------------------------------------------------------------------

/**
 * Turn a stored, immutable `SnapshotPayload` into the fully-resolved,
 * participant-facing view BOTH renderers consume.
 *
 * Pure and deterministic: no I/O, no Date.now(), no randomness, no live reads.
 * Unresolvable keys are omitted; a module present in the payload can never be
 * silently dropped by one renderer — every populated field is derived here from
 * the payload alone.
 */
export function resolveSnapshotView(payload: SnapshotPayload): ResolvedSnapshotView {
  // Per-signal evidence voice. A valid schema-1.0 payload predates the
  // required `evidence` member (added in the 1.0→1.1 bump) and may carry none:
  // that renders the LIMITED voice — deterministic, non-strengthening, and it
  // never crashes a historical immutable Snapshot (Owner amendment 4). For
  // every schema-1.1 payload the member is present and this reads it as-is.
  const confidenceFor = (signal: string): string => {
    const sig = (payload.signals as Array<{ signal: string; evidence?: { confidence?: unknown } }>)
      .find((s) => s.signal === signal);
    const c = sig?.evidence?.confidence;
    return c === "high" || c === "moderate" || c === "limited" ? c : "limited";
  };
  const confidenceBySignal: Record<string, string> = {};
  for (const s of payload.signals) confidenceBySignal[s.signal] = confidenceFor(s.signal);

  const signals = payload.signals
    .map((s) => resolveSignalRow(s.signal, s.narrativeKey, confidenceBySignal[s.signal]))
    .filter((row): row is ResolvedSignalRow => row !== null);

  // A statement body renders in exactly ONE section: here in the Connection
  // block only when it is not already a rendered friction or strength.
  const findingCodes = new Set(
    [...payload.frictions, ...payload.strengths].map((f) => f.code),
  );
  const connections = payload.connections
    .map((c) => {
      const resolved = resolveConnection(c.code);
      if (!resolved) return null;
      return { ...resolved, bodyRenderedElsewhere: findingCodes.has(c.code) };
    })
    .filter((c): c is ResolvedConnection => c !== null);

  const primaryAttentionArea = resolveAttentionArea(payload.attentionAreas[0] ?? "");
  const secondaryAttentionArea = resolveAttentionArea(payload.attentionAreas[1] ?? "");

  // The Big Picture resolves from the SYNTHESIS key (template × primary
  // attention area, with a per-template default) — never from `parts`, whose
  // keys are the very sentences the later sections render (Owner §1: unfold,
  // not echo). `parts` stays in the payload as the engine's provenance record.
  const bigPicture = payload.bigPicture
    ? (() => {
        const entry = resolveBigPictureEntry(
          payload.bigPicture.template,
          payload.attentionAreas[0],
        );
        return entry
          ? { template: payload.bigPicture.template, headline: entry.headline, body: entry.body }
          : null;
      })()
    : null;

  const strengths = payload.strengths
    .map((f) => resolveFinding(f, f.source === "signal" ? confidenceBySignal[f.code] : undefined))
    .filter((f): f is ResolvedFinding => f !== null);

  const frictions = payload.frictions
    .map((f) => resolveFinding(f, f.source === "signal" ? confidenceBySignal[f.code] : undefined))
    .filter((f): f is ResolvedFinding => f !== null);

  const context = payload.context
    .map((c) => resolveNarrativeBody(c.narrativeKey))
    .filter((s): s is string => s !== null);

  const perceptionGap =
    payload.perceptionGapStatus === "finalized" && payload.perceptionGap
      ? resolvePerceptionGapCopy(payload.perceptionGap)
      : null;

  const activation = ACTIVATION_ITEMS.map((item) => {
    const level = payload.activation[item];
    const entry = resolveActivationEntry(item, level);
    return {
      item,
      level,
      label: entry ? entry.stateLabel : ACTIVATION_LABELS[item],
      dimension: ACTIVATION_LABELS[item],
      paragraphs: entry ? entry.paragraphs : [],
    };
  });

  // q16Selections is a schema-1.1 field; a valid 1.0 payload predates it.
  // Rendering an empty theme list is today's honest behaviour for "no
  // selections recorded" — never a crash on a historical snapshot.
  const q16Selections = payload.q16Selections ?? [];
  const destinationThemes = q16Selections.map((code) => ({
    code,
    label: resolveQ16Label(code),
  }));

  const sectionIntros: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(SECTION_INTROS ?? {})) {
    if (Array.isArray(value)) {
      const paras = value.filter((p): p is string => typeof p === "string");
      if (paras.length > 0) sectionIntros[id] = paras;
    }
  }

  const destinationFrame = resolveDestinationFrame(q16Selections);

  return {
    signals,
    connections,
    primaryAttentionArea,
    secondaryAttentionArea,
    bigPicture,
    strengths,
    frictions,
    context,
    perceptionGap,
    perceptionGapStatus: payload.perceptionGapStatus,
    activation,
    activationPatterns: payload.activationPatterns,
    destinationThemes,
    sectionIntros,
    destinationFrame,
    nullFinding: payload.nullFinding,
  };
}

/**
 * Resolve the Big Picture synthesis entry for `template × area`, falling back
 * to the template's `default`. Null when the family or entry is malformed —
 * the section then simply omits (never renders a scaffold, never throws).
 */
function resolveBigPictureEntry(
  template: SnapshotPayload["bigPicture"]["template"],
  area: string | undefined,
): { headline: string; body: string[] } | null {
  const byArea = BIG_PICTURE?.[template];
  if (!byArea) return null;
  const chosen = (area && byArea[area]) || byArea["default"];
  if (!chosen || typeof chosen.headline !== "string" || !Array.isArray(chosen.body)) {
    return null;
  }
  const body = chosen.body.filter((p): p is string => typeof p === "string");
  if (body.length === 0) return null;
  return { headline: chosen.headline, body };
}

/**
 * Destination framing: the fixed intro plus, when the participant's exact Q16
 * selection set has an authored synthesis, its body — and the closing outro.
 * Sets without an authored entry get the honest default: framing and the
 * verbatim themes, no manufactured synthesis (Owner §9/§10).
 */
/** "X" / "X and Y" / "X, Y, and Z" — deterministic prose join over the
 * participant's stored selection order (unranked by construction). */
function joinProse(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * COMPOSITIONAL destination framing (plan D8 / Owner guardrail 2).
 *
 * The payload stores the participant's Q16 selections (their order, never
 * rewritten or ranked — §10). This resolves ONLY the governed fragments of
 * the SELECTED codes: a framing list before the verbatim selections, then a
 * lede + outcome list after them. There is no per-combination entry: the
 * golden walkthrough's sample sentences fall out of the general machinery for
 * its genuine A+B+D selection, asserted as substrings in the golden test.
 *
 * Lede rule (governed, never golden-specific): the contrast lede argues
 * against "just more money", so a participant who selected the wealth theme
 * (Q16_E) gets the plain lede instead — the copy never contradicts the
 * selection. The tail is the Owner's fixed closing constant from the sample.
 *
 * Payloads without q16Selections (schema 1.0) and selections no governed
 * clause covers render intro + verbatim blocks only — never compose over
 * nothing, never invent a theme the participant did not choose.
 */
function resolveDestinationFrame(q16: readonly string[]): {
  intro: string[];
  outro: string[];
} {
  const cfg = DESTINATION;
  const intro = Array.isArray(cfg?.intro)
    ? (cfg.intro.filter((p): p is string => typeof p === "string"))
    : [];

  const clauses = cfg?.theme_clauses;
  const selected = q16.filter((code) => {
    const c = clauses?.[code] as
      | { framing?: unknown; outcome?: unknown }
      | undefined;
    return typeof c?.framing === "string" && typeof c?.outcome === "string";
  });
  if (selected.length === 0) return { intro, outro: [] };

  const fragment = (code: string, field: "framing" | "outcome"): string => {
    const c = clauses?.[code] as Record<string, unknown>;
    return c[field] as string;
  };
  const framingList = `${joinProse(selected.map((c) => fragment(c, "framing")))}.`;

  const lede: unknown = q16.includes("Q16_E") ? cfg?.lede?.plain : cfg?.lede?.contrast;
  const tail: unknown = cfg?.tail;
  if (typeof lede !== "string" || typeof tail !== "string") {
    // Governed copy incomplete: show the framing list, never a half-composed close.
    return { intro: [...intro, framingList], outro: [] };
  }

  const outcomeList = joinProse([...selected.map((c) => fragment(c, "outcome")), tail]);
  return { intro: [...intro, framingList], outro: [lede, outcomeList] };
}
