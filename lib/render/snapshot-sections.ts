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
  /** A leading emphasis line, e.g. one of §2.4's six human questions — or the
   *  Readiness dimension name (the state label rides `label`). */
  kicker?: string;
  /** An emphasized title: a state label, finding title, connection headline,
   *  activation state label, Big Picture headline, or attention label. */
  label?: string;
  /** The FIRST narrative paragraph (or the sole string for body-only blocks:
   *  destination-theme labels). Empty string when the block is label-only
   *  during scaffolding — renderers must tolerate it. */
  body: string;
  /** Additional approved paragraphs after `body` (Owner §8 multi-paragraph
   *  copy). Absent when there are none. */
  paragraphs?: string[];
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
  /**
   * Fixed framing paragraphs rendered above the blocks, from the governed
   * `section_intros` family (and, for destination, its framing + synthesis).
   * Absent when the section has none. The PDF skips these — a recorded
   * renderer difference, not an accident.
   */
  intro?: string[];
  /** Closing paragraphs rendered below the blocks (destination synthesis
   *  outro). Absent when there are none. */
  outro?: string[];
  blocks: SnapshotBlock[];
}

/**
 * THE MAXIMUM PARTICIPANT-FACING FINDINGS PER FINDINGS MODULE (1–3 rule).
 *
 * ⚠️ THE RULE IS NOT INVENTED HERE — IT IS ENFORCED HERE, AND IT IS THE
 * APPROVED RULE, STATED IN THREE GOVERNING ARTIFACTS AND THE OWNER'S BRIEF:
 *
 *   docs/design/snapshot/Set_for_Life_Snapshot_Wireframe_Spec_v1.md §4/§5
 *     "1–3 evidence-supported strengths only"
 *     "1–3 meaningful friction findings"
 *   config/report-v1.0.json, screens[].notes (the operator's own config)
 *     strengths: "1–3 evidence-supported strengths only."
 *     friction:  "1–3 meaningful findings."
 *   docs/design/snapshot/Set_for_Life_Snapshot_Wireframe_Prototype_v1.html
 *     both count controls offer exactly 0 / 1 / 2 / 3 — there is no "4+" state
 *     in the approved prototype, so the approved layout has never had a shape
 *     for a fourth finding.
 *
 * THE ENGINE HAS NO CAP, AND THAT IS CORRECT. `assembleSnapshotPayload` pushes
 * every triggered tension into `frictions` — no cap, no priority filter — and
 * the payload must keep them: it is the immutable record of what the engine
 * found, and `bigPicture` asks it "is there any friction at all?" to choose
 * between PRIMARY_FRICTION and DEVELOPING_PICTURE. Measuring v1.0 against the
 * live data, one real session (9aaf15f0) carries SIX triggered tensions, so six
 * findings were reaching the renderer and six rendered.
 *
 * THE ORDER IS THE ENGINE'S OWN PRECEDENCE, NOT A NEW ONE. `evaluateTensions`
 * builds its list by iterating the config's tension keys in listing order, and
 * `interpretation.ts` records that same listing as the canonical
 * `TENSION_PRIORITY`. So `frictions[0]` is ALREADY the primary — `assembleBigPicture`
 * names exactly it ("one approved friction sentence"), and `selectConnections`
 * takes `codes[0]` as the primary connection. Taking the first three therefore
 * keeps the primary and its two highest-precedence supporting findings, and
 * picks nothing that the engine did not already rank.
 *
 * WHY THE CAP LIVES HERE AND NOT IN THE COMPONENT. This module's stated job is
 * to decide "WHICH findings are included (the resolved strengths/frictions)",
 * once, for BOTH renderers. Capping in `FrictionSection.tsx` would (a) be the
 * CSS-hiding the brief rules out, and (b) leave the PDF uncapped, so the web
 * page and the PDF would print different numbers of findings off the same
 * immutable payload — the exact web/PDF divergence this shared layer exists to
 * prevent.
 *
 * NOTHING IS DISCARDED. The payload keeps every finding; this truncates the
 * SECTION's view of them. A future config revision can raise this number and
 * historical payloads will immediately show more, because the findings were
 * never removed from the record.
 */
export const MAX_PARTICIPANT_FINDINGS = 3;

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

  // big-picture — ONE block: the editorial synthesis headline plus its body
  // paragraphs. It deliberately does NOT render `bigPicture.parts`, whose keys
  // are the sentences the later sections render in full (Owner §1: unfold, not
  // echo). Present only when the synthesis entry resolved.
  if (view.bigPicture && view.bigPicture.body.length > 0) {
    sections.push({
      id: "big-picture",
      heading: sectionHeading("big-picture"),
      ...(view.sectionIntros["big-picture"] ? { intro: view.sectionIntros["big-picture"] } : {}),
      blocks: [
        {
          label: view.bigPicture.headline,
          body: view.bigPicture.body[0],
          ...(view.bigPicture.body.length > 1
            ? { paragraphs: view.bigPicture.body.slice(1) }
            : {}),
        },
      ],
    });
  }

  // money-picture — always a module (the web renders its heading even under the
  // degenerate empty-signals shape); the PDF omits the empty page.
  sections.push({
    id: "money-picture",
    heading: sectionHeading("money-picture"),
    ...(view.sectionIntros["money-picture"] ? { intro: view.sectionIntros["money-picture"] } : {}),
    blocks: view.signals.map((row) => ({
      kicker: row.question,
      label: row.label,
      body: row.copy,
    })),
  });

  // Both findings modules carry the SAME 1–3 rule (see MAX_PARTICIPANT_FINDINGS)
  // and both take the engine's own precedence order, so the first finding is the
  // primary. The null behaviour is preserved exactly: 0 → the section is not
  // pushed at all (the `> 0` guard is unchanged), 1 → one block, 2 → two, 3+ →
  // three. `slice` never fabricates a finding to reach a count.
  const strengths = view.strengths.slice(0, MAX_PARTICIPANT_FINDINGS);
  if (strengths.length > 0) {
    sections.push({
      id: "strengths",
      heading: sectionHeading("strengths"),
      ...(view.sectionIntros["strengths"] ? { intro: view.sectionIntros["strengths"] } : {}),
      blocks: strengths.map((f) => ({ label: f.label, body: f.copy })),
    });
  }

  const frictions = view.frictions.slice(0, MAX_PARTICIPANT_FINDINGS);
  if (frictions.length > 0) {
    sections.push({
      id: "friction",
      heading: sectionHeading("friction"),
      ...(view.sectionIntros["friction"] ? { intro: view.sectionIntros["friction"] } : {}),
      blocks: frictions.map((f) => ({ label: f.label, body: f.copy })),
    });
  }

  // connection — the section's OWN headline and framing prose. The statement
  // body joins the block ONLY when it renders nowhere else (not a rendered
  // friction or strength), so one approved string lives in exactly one section
  // (Owner §14 / plan D5). A block can therefore be headline-only (`body: ""`)
  // while its statement body renders in the Friction module.
  if (view.connections.length > 0) {
    sections.push({
      id: "connection",
      heading: sectionHeading("connection"),
      ...(view.sectionIntros["connection"] ? { intro: view.sectionIntros["connection"] } : {}),
      blocks: view.connections.map((c, i) => {
        const paras = [
          ...c.connectionFraming,
          ...(c.bodyRenderedElsewhere ? [] : [c.body]),
        ];
        return {
          label: c.connectionHeadline,
          body: paras[0] ?? "",
          ...(paras.length > 1 ? { paragraphs: paras.slice(1) } : {}),
          variant: i === 0 ? ("primary" as const) : ("secondary" as const),
        };
      }),
    });
  }

  if (view.destinationThemes.length > 0) {
    sections.push({
      id: "destination",
      heading: sectionHeading("destination"),
      // The fixed framing PLUS any selection-set synthesis body precede the
      // verbatim themes; the closing outro follows them. The themes themselves
      // are never rewritten, ranked, or diagnosed (Owner §10).
      ...(view.destinationFrame.intro.length > 0 ? { intro: view.destinationFrame.intro } : {}),
      ...(view.destinationFrame.outro.length > 0 ? { outro: view.destinationFrame.outro } : {}),
      blocks: view.destinationThemes.map((t) => ({ body: t.label })),
    });
  }

  // readiness — always a module: four separate dimensions, never averaged, always
  // present (the resolver maps the fixed A1–A4 items unconditionally). The
  // dimension NAME rides as the kicker; the band's STATE label is the block
  // label; the approved paragraphs carry the copy.
  sections.push({
    id: "readiness",
    heading: sectionHeading("readiness"),
    ...(view.sectionIntros["readiness"] ? { intro: view.sectionIntros["readiness"] } : {}),
    blocks: view.activation.map((a) => ({
      kicker: a.dimension,
      label: a.label,
      body: a.paragraphs[0] ?? "",
      ...(a.paragraphs.length > 1 ? { paragraphs: a.paragraphs.slice(1) } : {}),
    })),
  });

  const attention: SnapshotBlock[] = [];
  if (view.primaryAttentionArea) {
    attention.push({
      label: view.primaryAttentionArea.label,
      body: view.primaryAttentionArea.paragraphs[0],
      ...(view.primaryAttentionArea.paragraphs.length > 1
        ? { paragraphs: view.primaryAttentionArea.paragraphs.slice(1) }
        : {}),
      variant: "primary",
    });
  }
  if (view.secondaryAttentionArea) {
    // The subordinate secondary is composed HERE, in the shared model, so the
    // composed string is a model string both renderers and the membership
    // guards see — never ad-hoc copy in a component.
    attention.push({
      label: `KEEP IN VIEW — ${view.secondaryAttentionArea.shortLabel}`,
      body: view.secondaryAttentionArea.paragraphs[0],
      ...(view.secondaryAttentionArea.paragraphs.length > 1
        ? { paragraphs: view.secondaryAttentionArea.paragraphs.slice(1) }
        : {}),
      variant: "secondary",
    });
  }
  if (attention.length > 0) {
    sections.push({
      id: "attention",
      heading: sectionHeading("attention"),
      ...(view.sectionIntros["attention"] ? { intro: view.sectionIntros["attention"] } : {}),
      blocks: attention,
    });
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
