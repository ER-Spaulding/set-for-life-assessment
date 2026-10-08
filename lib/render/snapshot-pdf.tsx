// Addendum 01 v1.1 §5, §8, §9, §14 step 6 — the PDF renderer.
//
// ONE SNAPSHOT PAYLOAD -> ONE RESOLVER -> ONE SHARED SECTION MODEL -> TWO RENDERERS.
//
// This module is the PDF half of that contract. Its INTERPRETIVE input is the
// SHARED content/section model (`SnapshotSection[]`) produced by
// `resolveSnapshotContent(payload)` in lib/render/snapshot-sections.ts — the SAME
// model the web renderer builds from. Every NARRATIVE string it emits (`kicker`,
// `label`, `body`) is a string that shared model already carries. It holds:
//   - NO key -> copy lookup
//   - NO config import (not report-v1.0.json, not narratives-v1.0.json, nothing)
//   - NO scoring / tension / classifier / session / db import
//   - NO reference to `SnapshotPayload` or `ResolvedSnapshotView`
// It never sees the raw payload, so it CANNOT rescore, reinterpret, or mint a
// conclusion the shared model did not already produce. Its sole interpretive
// input is the same section model the web page builds at
// `app/(public)/snapshot/[sessionId]/page.tsx`
// (`const sections = resolveSnapshotContent(payload)`).
//
// SEPARATELY, it draws on APPROVED document furniture from
// `lib/ui/snapshot-doc-copy.ts` (the cover title/subtitle, the personalization
// line, the standardized footer, the educational disclosure) — owner rulings
// 2026-10-02, applied verbatim. That module is fixed-by-ruling copy, NOT a
// second resolution path: it performs no key->copy lookup and reads no config,
// scoring, or resolver internals.
//
// THE LAYOUT IS PRESENTATION ONLY. `snapshotPdfSections` reorders the shared
// model's blocks into the §9 page order (primary connection pulled up beside the
// Big Picture on page 2; the secondary connection on the connection page; empty
// sections omitted; no Perception Gap section — Module 8 is deferred and must
// read as complete). Reordering is presentation (§5: "the copy strings are what
// must be identical"), and every string emitted below is a MEMBER of the shared
// section model's string set — never new prose. The guard test
// `tests/integration/snapshot-pdf-parity.test.ts` fails the moment a string is
// minted here.
//
// METADATA IS A SEPARATE, NON-INTERPRETIVE CHANNEL. First name (§8 cover, gated
// by Addendum 02 §3.2), completion date and report version are NOT part of the
// resolver's payload->copy contract and are deliberately NOT added to it. They
// arrive as a distinct `SnapshotPdfMeta`, read server-side. The first name feeds
// the APPROVED personalization line via `preparedForLine` (omitted when the name
// is unverified/provisional). The completion date and report version remain
// Document METADATA only — their participant-facing labels were never approved,
// so no such string is emitted (never invented).
//
// §24: no internal diagnostic machinery (signal codes, tension codes,
// classifier tags, evidence internals, dotted narrative keys) reaches the PDF.
// The only strings here arrived already resolved; nothing internal is imported
// or reconstructed.

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { SnapshotSection, SnapshotBlock, SnapshotSectionId } from "./snapshot-sections";
import {
  SNAPSHOT_TITLE,
  SNAPSHOT_SUBTITLE,
  SNAPSHOT_DISCLOSURE,
  preparedForLine,
  footerLine,
} from "../ui/snapshot-doc-copy";

/** Non-interpretive report metadata, read server-side — never from the resolver. */
export interface SnapshotPdfMeta {
  /** Verified first name, or null when unverified/provisional (§3.2 gating). */
  firstName: string | null;
  /** The snapshot's completion timestamp (snapshots.generated_at), or null. */
  generatedAt: string | null;
  /** The report version (payload.versions.report), or null. */
  reportVersion: string | null;
}

/** One §9-ordered section. The `id` is structural only, never shown. */
export interface PdfSection {
  id: SnapshotSectionId;
  blocks: SnapshotBlock[];
}

/**
 * Turn the shared section model into the §9 page order, emitting ONLY strings
 * the shared model already carries.
 *
 * §9 (authoritative for PDF page order):
 *   PAGE 2  Big Picture Narrative + primary Connection Statement
 *   PAGE 3  Money Picture (six human questions, each with state title + copy)
 *   PAGE 4  What's Already Working
 *   PAGE 5  Where There's Friction
 *   PAGE 6  optional independent secondary Connection (primary already on page 2)
 *   PAGE 7  What Set for Life Means to You (destination themes)
 *   PAGE 8  Your Readiness Right Now (four separate activation statements)
 *   PAGE 9  One Area Worth Examining Next (+ optional secondary)
 *
 * The only reordering this performs is presentation: it pulls the shared model's
 * primary connection block (variant "primary") up beside the Big Picture on page
 * 2 and leaves the secondary connection(s) on the connection page. It never adds
 * a block, never drops a non-empty block, and never alters a string.
 *
 * The Perception Gap (Module 8) is DEFERRED and must not appear — no section,
 * no placeholder, no gap — and the shared model never emits one, so the report
 * reads as complete.
 */
export function snapshotPdfSections(sections: SnapshotSection[]): PdfSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const connection = byId.get("connection");
  const primaryConnection = connection?.blocks.find((b) => b.variant === "primary");
  const secondaryConnections =
    connection?.blocks.filter((b) => b.variant !== "primary") ?? [];

  const out: PdfSection[] = [];

  // PAGE 2 — Big Picture Narrative + primary Connection Statement. Emitted when
  // either the narrative sentences or the primary connection is present.
  const bigPictureBlocks: SnapshotBlock[] = [
    ...(byId.get("big-picture")?.blocks ?? []),
    ...(primaryConnection ? [primaryConnection] : []),
  ];
  if (bigPictureBlocks.length > 0) {
    out.push({ id: "big-picture", blocks: bigPictureBlocks });
  }

  // PAGE 3–5 — Money Picture, What's Already Working, Where There's Friction.
  for (const id of ["money-picture", "strengths", "friction"] as const) {
    const section = byId.get(id);
    if (section && section.blocks.length > 0) out.push({ id, blocks: section.blocks });
  }

  // PAGE 6 — optional independent secondary Connection (primary is on page 2).
  if (secondaryConnections.length > 0) {
    out.push({ id: "connection", blocks: secondaryConnections });
  }

  // PAGE 7–9 — destination themes, readiness, attention.
  for (const id of ["destination", "readiness", "attention"] as const) {
    const section = byId.get(id);
    if (section && section.blocks.length > 0) out.push({ id, blocks: section.blocks });
  }

  return out;
}

// Layout styles. Presentation only — these never mint or alter a string.
const styles = StyleSheet.create({
  page: {
    paddingTop: 60,
    paddingBottom: 72,
    paddingHorizontal: 56,
    fontSize: 12,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
    color: "#1a1a1a",
  },
  block: { marginBottom: 18 },
  kicker: {
    fontSize: 9,
    letterSpacing: 1.2,
    // NO textTransform: react-pdf bakes the transform into the content stream,
    // so an uppercasing kicker made the extracted PDF text differ from the
    // model string for any kicker stored in title case (the Readiness dimension
    // names) — a web/PDF parity break the byte-level guard correctly caught.
    // The §2.4 human questions are stored FULL CAPS in config, so their
    // rendered look is unchanged.
    color: "#9b2c2c",
    marginBottom: 4,
  },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    marginBottom: 6,
    color: "#0f3d33",
  },
  body: { fontSize: 12 },
  /** Gap above a continuation paragraph inside one block (multi-paragraph copy). */
  bodyParagraphGap: { marginTop: 8 },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#6b6b6b",
  },
  coverTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    lineHeight: 1.2,
    color: "#0f3d33",
    marginTop: 120,
    marginBottom: 22,
  },
  coverSubtitle: {
    fontSize: 12,
    lineHeight: 1.6,
    color: "#1a1a1a",
    marginBottom: 14,
  },
  coverPersonalization: {
    fontSize: 12,
    color: "#1a1a1a",
    marginBottom: 48,
  },
  disclosure: {
    fontSize: 8,
    lineHeight: 1.5,
    color: "#6b6b6b",
  },
});

/**
 * The standardized footer on every page: `SET FOR LIFE • FINANCIAL SNAPSHOT •
 * {PAGE} OF {TOTAL}` (owner ruling 2026-10-02). `totalPages` is the document's
 * real page count, supplied by @react-pdf/renderer's `render` callback — page
 * values are generated document furniture, never narrative copy.
 */
function PdfFooter() {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) => footerLine(pageNumber, totalPages)}
    />
  );
}

/**
 * Render the shared section model to PDF bytes — a pure function of the section
 * model plus the non-interpretive metadata channel and the approved document
 * furniture in `lib/ui/snapshot-doc-copy.ts`.
 *
 * Page 1 is the APPROVED cover (title + subtitle + the name-gated
 * personalization line + the educational disclosure). Pages 2..N are the §9
 * section pages, each built EXCLUSIVELY from `snapshotPdfSections(sections)` —
 * the strings those pages emit are, by construction, the strings that function
 * returns: there is no second source of narrative copy. `meta.generatedAt` /
 * `meta.reportVersion` remain Document METADATA only (their labels were never
 * approved, so no such string is emitted).
 */
export async function renderSnapshotPdf(
  sections: SnapshotSection[],
  meta: SnapshotPdfMeta,
): Promise<Buffer> {
  const pdfSections = snapshotPdfSections(sections);

  // §8 cover — the personalization line is OMITTED (not rendered, not blank,
  // not placeholdered) when the name is unverified/provisional.
  const personalization = preparedForLine(meta.firstName);

  const cover = (
    <Page key="cover" size="LETTER" style={styles.page}>
      <Text style={styles.coverTitle}>{SNAPSHOT_TITLE}</Text>
      <Text style={styles.coverSubtitle}>{SNAPSHOT_SUBTITLE}</Text>
      {personalization ? (
        <Text style={styles.coverPersonalization}>{personalization}</Text>
      ) : null}
      <Text style={styles.disclosure}>{SNAPSHOT_DISCLOSURE}</Text>
      <PdfFooter />
    </Page>
  );

  const contentPages = pdfSections.map((section) => (
    <Page key={section.id} size="LETTER" style={styles.page}>
      {/* Section intros/outros (the governed `section_intros` + destination
          framing/synthesis) are WEB-ONLY: the PDF is a fixed-layout editorial
          document whose pages are numbered by §9, and the shared section
          model's intro/outro deliberately do not reach it. Recorded here as a
          renderer difference, not an omission — a test pins that the PDF emits
          no intro/outro string. */}
      {section.blocks.map((block, i) => (
        // The wrapper MUST be a View (block container), not a Text. Nested
        // <Text> children of a <Text> flow inline and render the kicker, label
        // and body as one merged run; a View stacks them on separate lines.
        <View key={i} style={styles.block} wrap={false}>
          {block.kicker ? <Text style={styles.kicker}>{block.kicker}</Text> : null}
          {block.label ? <Text style={styles.label}>{block.label}</Text> : null}
          <Text style={styles.body}>{block.body}</Text>
          {(block.paragraphs ?? []).map((p, pi) => (
            <Text key={pi} style={[styles.body, styles.bodyParagraphGap]}>
              {p}
            </Text>
          ))}
        </View>
      ))}
      <PdfFooter />
    </Page>
  ));

  const document = (
    <Document
      subject={meta.reportVersion ?? undefined}
      creationDate={meta.generatedAt ? new Date(meta.generatedAt) : undefined}
    >
      {cover}
      {contentPages}
    </Document>
  );

  return renderToBuffer(document);
}
