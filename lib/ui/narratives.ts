// UIUX §8 S12–S20, §14 — the CLIENT-SAFE narrative projections.
//
// Same reasoning as lib/ui/questions.ts: the approved libraries carry more than
// a participant should receive. `narratives-v1.0.json` holds `rules` (internal
// assembly logic), `language_strength` (with its calibration status), and the
// per-signal state copy; `connection-statements` holds headline+body per tension
// code.
//
// This module exposes ONLY the copy a Snapshot screen renders, keyed by the
// identifiers the API already returns (`narrativeKey`, tension codes, attention
// area). Nothing here computes or decides — §19 requires the engine to be the
// only thing that decides, and this is a presentation lookup.

import narratives from "../../config/narratives-v1.0.json";
import connectionStatements from "../../config/connection-statements-v1.0.json";

/**
 * Approved copy for one signal state.
 *
 * The library stores each state as `{ label, copy, attention_area?, source? }`.
 * Only `label` and `copy` are participant-facing; `attention_area` is internal
 * wiring and `source` is provenance, so neither is exposed here.
 */
export interface SignalStateCopy {
  /** Short participant-facing title, e.g. "Hard to See Clearly". */
  label: string;
  /** The narrative body. */
  copy: string;
}

/** Approved connection statement: headline + body, per tension code. */
export interface ConnectionCopy {
  headline: string;
  body: string;
}

/** Approved attention-area copy. */
export interface AttentionAreaCopy {
  label: string;
  body: string;
}

type NarrativeValue = { label?: unknown; copy?: unknown };
type SignalStatesBlock = Record<string, Record<string, NarrativeValue>>;
type SpecialStatesBlock = Record<string, NarrativeValue>;

const SIGNAL_STATES = narratives.signal_states as unknown as SignalStatesBlock;
const SPECIAL_STATES = narratives.special_signal_states as unknown as SpecialStatesBlock;

/**
 * Resolve the `narrativeKey` the API returns into its body text.
 *
 * Accepts either form the engine emits:
 *   `signal_states.SEE.S5`                     → the ladder-state copy
 *   `special_signal_states.DIRECT_CAPACITY_LIMITED` → the off-ladder copy
 *
 * Returns null for an unrecognised key rather than rendering the key itself —
 * a raw identifier on a participant screen would expose internal vocabulary
 * (§24) and read as a bug.
 */
export function resolveNarrative(key: string): SignalStateCopy | null {
  const parts = key.split(".");
  let value: NarrativeValue | undefined;

  if (parts.length === 3 && parts[0] === "signal_states") {
    value = SIGNAL_STATES?.[parts[1]]?.[parts[2]];
  } else if (parts.length === 2 && parts[0] === "special_signal_states") {
    value = SPECIAL_STATES?.[parts[1]];
  } else {
    return null;
  }

  // `copy` is the narrative body and `label` the short title; both are
  // required, so a malformed entry returns null rather than rendering a
  // half-populated card.
  if (typeof value?.copy !== "string" || typeof value?.label !== "string") {
    return null;
  }
  return { label: value.label, copy: value.copy };
}

/**
 * The participant-facing label for a signal.
 *
 * The API returns the internal id (SEE, ROOM, …), which happens to be the
 * participant-facing label on this instrument — the spec names the signals
 * that way deliberately (§13, "participant-friendly labels"). Kept as a
 * function so a future divergence has one place to change.
 */
export function signalLabel(signal: string): string {
  return signal;
}

/** Resolve a tension code to its approved connection statement. */
export function resolveConnection(code: string): ConnectionCopy | null {
  const entry = (connectionStatements as Record<string, unknown>)[code];
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { headline?: unknown; body?: unknown };
  if (typeof e.headline !== "string" || typeof e.body !== "string") return null;
  return { headline: e.headline, body: e.body };
}

/** Resolve an attention area to its approved copy. */
export function resolveAttentionArea(key: string): AttentionAreaCopy | null {
  const areas = narratives.attention_areas as unknown as Record<
    string,
    { label?: unknown; body?: unknown }
  >;
  const entry = areas?.[key];
  if (!entry) return null;
  if (typeof entry.label !== "string" || typeof entry.body !== "string") return null;
  return { label: entry.label, body: entry.body };
}

/**
 * True when this signal state is an off-ladder (capacity-override) state.
 *
 * The Snapshot renders these differently — the approved vocabulary describes a
 * constrained situation rather than a low score — but the SCREEN does not
 * explain the override. Nothing here says "capacity": the copy itself carries
 * the meaning, which keeps the machinery internal (§24).
 */
export function isSpecialState(key: string): boolean {
  return key.startsWith("special_signal_states.");
}
