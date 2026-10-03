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
  headline: string;
  body: string;
}

/** One approved attention-area copy. */
export interface ResolvedAttentionArea {
  label: string;
  body: string;
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
    sentences: string[];
  } | null;
  strengths: ResolvedFinding[];
  frictions: ResolvedFinding[];
  context: string[]; // resolved context-narrative strings, payload order
  perceptionGap: { label: string; body: string } | null; // only when finalized
  perceptionGapStatus: "finalized" | "not_ready" | "method_pending";
  activation: Array<{
    item: ActivationItem;
    level: "LOW" | "MID" | "HIGH";
    /** The participant-facing dimension label, from the ONE shared source
     *  lib/ui/snapshot-activation.ts — never re-authored per renderer. */
    label: string;
    copy: string;
  }>; // four separate, never averaged
  activationPatterns: string[]; // internal layout only, never displayed as copy
  destinationThemes: Array<{ code: string; label: string }>; // Q16 selections
  nullFinding: boolean;
}

// ---------------------------------------------------------------------------
// The pinned libraries (read once; same sources the former lib/ui/narratives.ts
// used).
// ---------------------------------------------------------------------------

type NarrativeValue = { label?: unknown; copy?: unknown };
type SignalStatesBlock = Record<string, Record<string, NarrativeValue>>;
type SpecialStatesBlock = Record<string, NarrativeValue>;
type AttentionAreasBlock = Record<string, { label?: unknown; body?: unknown }>;
type ConnectionStatementsBlock = Record<string, { headline?: unknown; body?: unknown }>;
type ContextNarrativesBlock = Record<string, unknown>;
type PerceptionGapBlock = Record<string, { headline?: unknown; body?: unknown }>;
type ActivationBlock = Record<string, Record<string, unknown>>;

const SIGNAL_STATES = narratives.signal_states as unknown as SignalStatesBlock;
const SPECIAL_STATES = narratives.special_signal_states as unknown as SpecialStatesBlock;
const ATTENTION_AREAS = narratives.attention_areas as unknown as AttentionAreasBlock;
const CONNECTION_STATEMENTS = connectionStatements as unknown as ConnectionStatementsBlock;
const CONTEXT_NARRATIVES = narratives.context_narratives as unknown as ContextNarrativesBlock;
const PERCEPTION_GAP = narratives.perception_gap as unknown as PerceptionGapBlock;
const ACTIVATION = narratives.activation as unknown as ActivationBlock;
const BIG_PICTURE_TEMPLATES = (
  narratives as unknown as { big_picture_templates?: Record<string, unknown> }
).big_picture_templates;

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
  return { headline: entry.headline, body: entry.body };
}

/** Resolve an attention area to its approved copy. */
export function resolveAttentionArea(key: string): ResolvedAttentionArea | null {
  const entry = ATTENTION_AREAS[key];
  if (!entry) return null;
  if (typeof entry.label !== "string" || typeof entry.body !== "string") {
    return null;
  }
  return { label: entry.label, body: entry.body };
}

/**
 * Resolve the `{ label, copy }` of a signal narrative key.
 *
 * Accepts either form the engine emits:
 *   `signal_states.SEE.S5`              → the ladder-state copy
 *   `special_signal_states.DIRECT_…`    → the off-ladder copy
 *
 * Returns null for an unrecognised or malformed key — never the key itself.
 */
function resolveSignalStateCopy(key: string): { label: string; copy: string } | null {
  const parts = key.split(".");
  let value: NarrativeValue | undefined;

  if (parts.length === 3 && parts[0] === "signal_states") {
    value = SIGNAL_STATES?.[parts[1]]?.[parts[2]];
  } else if (parts.length === 2 && parts[0] === "special_signal_states") {
    value = SPECIAL_STATES?.[parts[1]];
  } else {
    return null;
  }

  if (typeof value?.copy !== "string" || typeof value?.label !== "string") {
    return null;
  }
  return { label: value.label, copy: value.copy };
}

/**
 * Resolve one signal to its full row, or null when the key does not resolve.
 *
 * The single entry point the web page uses for its three signal fields (question,
 * label, copy) and the PDF reaches through the shared section model.
 */
export function resolveSignalRow(
  signal: string,
  narrativeKey: string | null,
): ResolvedSignalRow | null {
  if (!narrativeKey) return null;
  const stateCopy = resolveSignalStateCopy(narrativeKey);
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
function resolveNarrativeBody(key: string): string | null {
  let plain = key;
  for (const prefix of [
    "connection_statements.",
    "special_signal_states.",
    "context_narratives.",
    "perception_gap.",
    "attention_areas.",
    "signal_states.",
    "activation.",
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
    if (sig && typeof sig.copy === "string") return sig.copy;
    const act = ACTIVATION?.[dot[0]]?.[dot[1]];
    if (typeof act === "string") return act;
  }

  const special = SPECIAL_STATES[plain];
  if (special && typeof special.copy === "string") return special.copy;

  const ctx = CONTEXT_NARRATIVES[plain];
  if (typeof ctx === "string") return ctx;

  const gap = PERCEPTION_GAP[plain];
  if (gap && typeof gap.body === "string") return gap.body;

  const area = ATTENTION_AREAS[plain];
  if (area && typeof area.body === "string") return area.body;

  const template = BIG_PICTURE_TEMPLATES?.[plain];
  if (typeof template === "string") return template;

  return null;
}

/** Resolve a strength/friction finding to `{ label, copy }` (null on unknown). */
function resolveFinding(finding: {
  narrativeKey: string | null;
}): ResolvedFinding | null {
  if (!finding.narrativeKey) return null;

  const connPrefix = "connection_statements.";
  if (finding.narrativeKey.startsWith(connPrefix)) {
    const code = finding.narrativeKey.slice(connPrefix.length);
    const conn = resolveConnection(code);
    if (!conn) return null;
    return { label: conn.headline, copy: conn.body };
  }

  return resolveSignalStateCopy(finding.narrativeKey);
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

/** Resolve one activation sentence ("A1.HIGH"). Empty string on unknown. */
function resolveActivationCopy(item: string, level: string): string {
  const entry = ACTIVATION?.[item]?.[level];
  return typeof entry === "string" ? entry : "";
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
  const signals = payload.signals
    .map((s) => resolveSignalRow(s.signal, s.narrativeKey))
    .filter((row): row is ResolvedSignalRow => row !== null);

  const connections = payload.connections
    .map((c) => resolveConnection(c.code))
    .filter((c): c is ResolvedConnection => c !== null);

  const primaryAttentionArea = resolveAttentionArea(payload.attentionAreas[0] ?? "");
  const secondaryAttentionArea = resolveAttentionArea(payload.attentionAreas[1] ?? "");

  const bigPicture = payload.bigPicture
    ? {
        template: payload.bigPicture.template,
        sentences: payload.bigPicture.parts
          .map(resolveNarrativeBody)
          .filter((s): s is string => s !== null),
      }
    : null;

  const strengths = payload.strengths
    .map(resolveFinding)
    .filter((f): f is ResolvedFinding => f !== null);

  const frictions = payload.frictions
    .map(resolveFinding)
    .filter((f): f is ResolvedFinding => f !== null);

  const context = payload.context
    .map((c) => resolveNarrativeBody(c.narrativeKey))
    .filter((s): s is string => s !== null);

  const perceptionGap =
    payload.perceptionGapStatus === "finalized" && payload.perceptionGap
      ? resolvePerceptionGapCopy(payload.perceptionGap)
      : null;

  const activation = ACTIVATION_ITEMS.map((item) => ({
    item,
    level: payload.activation[item],
    label: ACTIVATION_LABELS[item],
    copy: resolveActivationCopy(item, payload.activation[item]),
  }));

  const destinationThemes = payload.q16Selections.map((code) => ({
    code,
    label: resolveQ16Label(code),
  }));

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
    nullFinding: payload.nullFinding,
  };
}
