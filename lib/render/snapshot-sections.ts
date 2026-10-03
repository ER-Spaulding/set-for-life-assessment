// Addendum 01 v1.1 §5 — THE SHARED RESOLVED CONTENT/SECTION MODEL.
//
// ONE SNAPSHOT PAYLOAD -> ONE RESOLVER -> ONE SHARED SECTION MODEL -> TWO RENDERERS.
//
// `resolveSnapshotView` (lib/render/snapshot-view.ts) resolves the immutable
// payload's narrative KEYS into participant-facing COPY. This module is the NEXT
// layer of that contract: it turns the fully-resolved view into a SHARED list of
// content sections that BOTH renderers build FROM. It is the single place that
// decides — once, for both media — the content-level questions the renderers
// must NOT answer for themselves:
//
//   - WHICH participant-facing modules exist (and their report-config order);
//   - WHICH approved heading applies to each module (the exact participant-facing
//     string, uppercased, from config/report-v1.0.json screens[]);
//   - WHICH findings are included (the resolved strengths/frictions);
//   - WHICH Activation labels apply (the resolved activation[].label, from the
//     ONE shared source lib/ui/snapshot-activation.ts);
//   - WHICH primary/secondary attention area is selected (the resolver's
//     primaryAttentionArea / secondaryAttentionArea, marked primary/secondary);
//   - WHICH connection is primary (connections[0]) vs secondary (connections[1]);
//   - WHICH participant-facing interpretation (the resolved copy strings).
//
// The web renderer (components/snapshot/results-view.tsx) and the PDF renderer
// (lib/render/snapshot-pdf.tsx) consume this model and are free to differ ONLY in
// LAYOUT: order of pages, fonts, spacing, whether a heading is shown, whether the
// primary connection sits beside the Big Picture (§9 page 2) or in the connection
// module. Those are presentation decisions; the CONTENT — every string, every
// heading, every module's existence, every primary/secondary selection — is fixed
// HERE, in shared code. Divergence therefore requires changing SHARED code, never
// one renderer's local code.
//
// MEDIUM-SPECIFIC BOUNDARY (documented, not papered over). Two deliberate
// layout differences remain, and both are the PDF refusing to print an EMPTY
// page:
//   - the money-picture module always exists (the web renders its heading even
//     under the degenerate empty-signals shape); the PDF omits the section when
//     it has no blocks, because an empty page is meaningless in a printed report;
//   - the PDF pulls the primary connection up beside the Big Picture (§9 page 2)
//     and leaves only the secondary connection on the connection page, while the
//     web shows all connections in one module. The CONTENT of those connections
//     is identical in both; only the page placement differs.
//
// §24: no internal diagnostic machinery (signal/tension/classifier codes, dotted
// narrative keys) appears here — every string arrives already resolved.

import reportConfig from "@/config/report-v1.0.json";
import { resolveSnapshotView } from "./snapshot-view";
import type { ResolvedSnapshotView } from "./snapshot-view";
import type { SnapshotPayload } from "../assessment/snapshot-payload";

/** The eight participant-facing content modules, in report-config order. */
export type SnapshotSectionId =
  | "big-picture"
  | "money-picture"
  | "strengths"
  | "friction"
  | "connection"
  | "destination"
  | "readiness"
  | "attention";

/** One resolved block of participant-facing copy. */
export interface SnapshotBlock {
  /** A leading emphasis line, e.g. one of §2.4's six human questions. */
  kicker?: string;
  /** An emphasized title: a state label, finding title, connection headline,
   *  activation label, or attention label. */
  label?: string;
  /** The narrative body (or the sole string for body-only blocks: big-picture
   *  sentences and destination-theme labels). */
  body: string;
  /**
   * Marks the resolver's PRIMARY vs SECONDARY selection where one exists
   * (connection: connections[0] is primary; attention: primaryAttentionArea vs
   * secondaryAttentionArea). Renderers use this for LAYOUT only — the PDF pulls
   * the primary connection up to page 2, the web renders the secondary attention
   * area at a subordinate heading level. It never changes the content.
   */
  variant?: "primary" | "secondary";
}

/** One content section: a module id, its approved heading, and its blocks. */
export interface SnapshotSection {
  id: SnapshotSectionId;
  /**
   * The approved participant-facing heading, uppercased (the exact string the
   * web renders), sourced once from config/report-v1.0.json. The PDF does not
   * render headings — its pages are numbered by §9 — so it ignores this field;
   * that is a layout choice, not a second heading source.
   */
  heading: string;
  blocks: SnapshotBlock[];
}

/** Map each content module to the report-config screen id that owns its title. */
const SCREEN_FOR_SECTION: Record<SnapshotSectionId, string> = {
  "big-picture": "big-picture",
  "money-picture": "operating-profile",
  strengths: "strengths",
  friction: "friction",
  connection: "connection",
  destination: "destination-meaning",
  readiness: "readiness",
  attention: "attention-area",
};

/** The exact approved heading for a content module, uppercased. */
function sectionHeading(id: SnapshotSectionId): string {
  const screens = reportConfig.screens as unknown as Array<{ id: string; title: string }>;
  const title = screens.find((s) => s.id === SCREEN_FOR_SECTION[id])?.title ?? "";
  return title.toUpperCase();
}

/**
 * Turn the fully-resolved view into the SHARED content/section model BOTH
 * renderers build from. Pure: no I/O, no clock, no re-resolution — it only
 * arranges strings the resolver already produced and the report config already
 * owns. This is the single place module existence, headings, findings, activation
 * labels, attention areas, and the primary/secondary selections are decided.
 */
export function resolveSnapshotSections(view: ResolvedSnapshotView): SnapshotSection[] {
  const sections: SnapshotSection[] = [];

  // big-picture — present only when it has sentences to render.
  const bigPicture: SnapshotBlock[] = (view.bigPicture?.sentences ?? []).map((s) => ({
    body: s,
  }));
  if (bigPicture.length > 0) {
    sections.push({ id: "big-picture", heading: sectionHeading("big-picture"), blocks: bigPicture });
  }

  // money-picture — always a module (the web renders its heading even under the
  // degenerate empty-signals shape); the PDF omits the empty page.
  sections.push({
    id: "money-picture",
    heading: sectionHeading("money-picture"),
    blocks: view.signals.map((row) => ({
      kicker: row.question,
      label: row.label,
      body: row.copy,
    })),
  });

  if (view.strengths.length > 0) {
    sections.push({
      id: "strengths",
      heading: sectionHeading("strengths"),
      blocks: view.strengths.map((f) => ({ label: f.label, body: f.copy })),
    });
  }

  if (view.frictions.length > 0) {
    sections.push({
      id: "friction",
      heading: sectionHeading("friction"),
      blocks: view.frictions.map((f) => ({ label: f.label, body: f.copy })),
    });
  }

  if (view.connections.length > 0) {
    sections.push({
      id: "connection",
      heading: sectionHeading("connection"),
      blocks: view.connections.map((c, i) => ({
        label: c.headline,
        body: c.body,
        variant: i === 0 ? ("primary" as const) : ("secondary" as const),
      })),
    });
  }

  if (view.destinationThemes.length > 0) {
    sections.push({
      id: "destination",
      heading: sectionHeading("destination"),
      blocks: view.destinationThemes.map((t) => ({ body: t.label })),
    });
  }

  // readiness — always a module: four separate dimensions, never averaged, always
  // present (the resolver maps the fixed A1–A4 items unconditionally).
  sections.push({
    id: "readiness",
    heading: sectionHeading("readiness"),
    blocks: view.activation.map((a) => ({ label: a.label, body: a.copy })),
  });

  const attention: SnapshotBlock[] = [];
  if (view.primaryAttentionArea) {
    attention.push({
      label: view.primaryAttentionArea.label,
      body: view.primaryAttentionArea.body,
      variant: "primary",
    });
  }
  if (view.secondaryAttentionArea) {
    attention.push({
      label: view.secondaryAttentionArea.label,
      body: view.secondaryAttentionArea.body,
      variant: "secondary",
    });
  }
  if (attention.length > 0) {
    sections.push({ id: "attention", heading: sectionHeading("attention"), blocks: attention });
  }

  return sections;
}

/**
 * The single production entry point both render paths go through: resolve the
 * stored immutable payload to copy, then to the shared section model. `page.tsx`
 * (web) and `lib/snapshot/document.ts` (PDF) each call exactly this, so the
 * content they consume is produced by ONE shared code path — there is no
 * post-resolution step either could diverge at without changing shared code.
 */
export function resolveSnapshotContent(payload: SnapshotPayload): SnapshotSection[] {
  return resolveSnapshotSections(resolveSnapshotView(payload));
}
