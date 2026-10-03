// Owner ruling 2026-10-02 (binding, applied verbatim) — the four participant-
// facing Activation dimension labels for the readiness section ("Your Readiness
// Right Now"). The canonical labels are exactly:
//
//     A1  Urgency
//     A2  Readiness
//     A3  Commitment
//     A4  Support Readiness
//
// SINGLE SOURCE OF TRUTH. These four labels were previously hand-maintained as
// a hardcoded map in `components/snapshot/results-view.tsx` while the PDF
// renderer (`lib/render/snapshot-pdf.tsx`) OMITTED them entirely — a web/PDF
// parity defect. This module is now the ONE place the four names live. Both the
// web Financial Snapshot and the PDF Financial Snapshot consume them through the
// SAME path: the shared resolver (`lib/render/snapshot-view.ts`) reads this
// module and attaches the resolved `label` to each activation dimension of the
// `ResolvedSnapshotView`, so neither renderer holds (or may grow) its own copy.
//
// FOUR SEPARATE MEASURES — NEVER COMBINED. These four dimensions MUST REMAIN
// SEPARATE. There is no lead score, no composite readiness score, and no
// average. This module exports four labels keyed A1–A4 and no combined value;
// nothing here computes a scalar. The narrative activation COPY (the sentence
// that accompanies each label) is a separate concern: it lives in
// config/narratives-v1.0.json (activation.*) and resolves in
// lib/render/snapshot-view.ts — never here.
//
// These are participant-facing dimension NAMES fixed by ruling, in the same
// sense that lib/ui/snapshot-doc-copy.ts holds the PDF's fixed document
// furniture. They are NOT derived from the payload and NOT part of a narrative
// state-keyed library.

/** The four activation item ids, in canonical order. */
export type ActivationItem = "A1" | "A2" | "A3" | "A4";

/** The four activation items, in canonical order (A1–A4). */
export const ACTIVATION_ITEMS: readonly ActivationItem[] = ["A1", "A2", "A3", "A4"];

/**
 * The four participant-facing Activation dimension labels, verbatim from the
 * owner ruling. Never a lead score, never a composite, never averaged.
 */
export const ACTIVATION_LABELS: Readonly<Record<ActivationItem, string>> = {
  A1: "Urgency",
  A2: "Readiness",
  A3: "Commitment",
  A4: "Support Readiness",
};

/**
 * The participant-facing label for an activation item, or "" on an unknown key
 * (mirrors the resolver's omit-not-expose convention — a raw internal id must
 * never reach a participant, §24).
 */
export function activationLabel(item: string): string {
  return (ACTIVATION_LABELS as Record<string, string>)[item] ?? "";
}
