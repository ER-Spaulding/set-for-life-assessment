// Addendum 01 v1.1 §6, §9, §14, §20 — the participant-facing results view.
//
// SERVER-SIDE PRESENTATION ONLY. This component receives the SHARED
// content/section model (`SnapshotSection[]`, produced by
// `resolveSnapshotContent(payload)` in lib/render/snapshot-sections.ts from the
// stored immutable Snapshot payload) and arranges it into the twelve sections of
// the approved visual design. It does NO resolution of its own: every NARRATIVE
// string and every module's existence and heading arrive already decided in the
// shared model, and this file contains no scoring, no interpretation, no key→copy
// lookup of narrative copy.
//
// DECOMPOSED, NOT REWRITTEN. The former single-file renderer held all eight
// modules inline. Each module now lives in its own component under
// `components/snapshot/` (SnapshotHero, BigPictureSection, MoneyPictureSection,
// StrengthsSection, FrictionSection, ConnectionSection, DestinationSection,
// ReadinessSection, AttentionSection, ContinuationCTA, SnapshotDownload,
// SnapshotFooter, plus the shared SnapshotSection frame). This file is the
// COMPOSITION: it picks the module for each section id, in the model's order,
// and passes the shared frame the page's own chrome.
//
// WHY THE DECOMPOSITION IS SAFE. The guards that bind this surface are
// behavioural — they render this component and walk the output — so they test
// the COMPOSITION, not the file layout. The one rule that follows the file
// boundary is the legacy-resolver import ban, which applies to every file in
// `components/snapshot/`, and every new module satisfies it: none imports a
// resolver, and all copy reaches them through props or a canonical constant.
//
// THE SHARED MODEL IS THE CLIENT BOUNDARY. This component and everything below
// it are server-rendered: the only thing that reaches the browser is
// participant-facing HTML. Internal fields — `state`, `specialState`,
// `displayState`, `evidence`, `openingB`, `moveSubsignals`, `classifierTags`,
// tension codes, signal codes — never appear here and never serialize. The
// shared model carries the resolved copy and the renderer only ever prints
// `kicker`/`label`/`body` strings.
//
// COPY PROVENANCE — each participant-facing string has ONE canonical source:
//   - the eight content SECTION HEADINGS resolve in the SHARED model
//     (lib/render/snapshot-sections.ts) from config/report-v1.0.json screens[] —
//     this file renders `section.heading` verbatim, never re-authoring a title.
//   - the cover title/lead come from the report config's cover screen; the hero
//     reads them, and NOTHING here re-types the approved strings.
//   - NARRATIVE copy (signal states, connection statements, attention areas,
//     activation) arrives already resolved inside the shared model's blocks.
//   - WEB chrome the page owns (hero conceptual line + cue, section intros, the
//     Section 11 block) lives in lib/ui/snapshot-web-copy.ts.
//   - the Section 10 campaign lives in lib/ui/snapshot-campaign.ts.
//   - the educational DISCLOSURE and the PDF cover/footer copy live in
//     lib/ui/snapshot-doc-copy.ts (fixed-by-ruling document furniture).
//   - the download CTA label lives in lib/ui/snapshot-copy.ts.
//   - the brand name and the official logo live in lib/brand.ts.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import reportConfig from "@/config/report-v1.0.json";
import type { HeroVariant } from "@/lib/ui/snapshot-hero";
import { SnapshotHero } from "./SnapshotHero";
import { BigPictureSection } from "./BigPictureSection";
import { MoneyPictureSection } from "./MoneyPictureSection";
import { StrengthsSection } from "./StrengthsSection";
import { FrictionSection } from "./FrictionSection";
import { ConnectionSection } from "./ConnectionSection";
import { DestinationSection } from "./DestinationSection";
import { ReadinessSection } from "./ReadinessSection";
import { AttentionSection } from "./AttentionSection";
import { ActionTransition } from "./ActionTransition";
import { ContinuationCTA } from "./ContinuationCTA";
import { SnapshotDownload } from "./SnapshotDownload";
import { SnapshotFooter } from "./SnapshotFooter";
import { Shell } from "./SnapshotSection";

interface ReportScreen {
  id: string;
  title: string;
  lead?: string;
}

const SCREENS = reportConfig.screens as unknown as ReportScreen[];

/** The exact approved title for a screen, from the report config (single source). */
function screenTitle(id: string): string {
  return SCREENS.find((screen) => screen.id === id)?.title ?? "";
}

/** The cover lead (owner ruling 2), from the report config cover screen. */
const COVER_LEAD = SCREENS.find((screen) => screen.id === "cover")?.lead ?? "";

/** The hero's target: the first content section on the page. */
const FIRST_SECTION_HREF = "#big-picture";

export function SnapshotResults({
  sections,
  sessionId,
  heroVariant = "neutral",
  firstName = null,
}: {
  sections: SnapshotSection[];
  sessionId?: string;
  /**
   * The Section 1 image variant, resolved SERVER-SIDE from the participant's
   * explicit demographic response (lib/ui/snapshot-hero.server.ts). It defaults
   * to the neutral hero so every existing caller — including the render guards,
   * which construct this component directly — renders a complete, valid page
   * without having to know about hero selection at all.
   */
  heroVariant?: HeroVariant;
  /** The VERIFIED first name, or null. Omitting it drops the personalization
   *  line rather than substituting a placeholder. */
  firstName?: string | null;
}) {
  const byId = (id: SnapshotSection["id"]) => sections.find((s) => s.id === id);

  return (
    <Shell>
      {/* SECTION 1 — the hero. §14: oversized editorial declaration. */}
      <SnapshotHero
        eyebrow={screenTitle("cover")}
        lead={COVER_LEAD}
        variant={heroVariant}
        firstName={firstName}
        transitionHref={FIRST_SECTION_HREF}
      />

      {/* SECTIONS 2–9 — the content modules, each rendering only when the shared
          model emitted it, in the model's report-config order. */}
      {sections.map((section) => {
        switch (section.id) {
          case "big-picture":
            return <BigPictureSection key={section.id} section={section} />;
          case "money-picture":
            return <MoneyPictureSection key={section.id} section={section} />;
          case "strengths":
            return <StrengthsSection key={section.id} section={section} />;
          case "friction":
            return <FrictionSection key={section.id} section={section} />;
          case "connection":
            return <ConnectionSection key={section.id} section={section} />;
          case "destination":
            return <DestinationSection key={section.id} section={section} />;
          case "readiness":
            return <ReadinessSection key={section.id} section={section} />;
          case "attention":
            return <AttentionSection key={section.id} section={section} />;
          default:
            return null;
        }
      })}

      {/* THE EDITORIAL PAUSE — the seam between the last interpretation module
          and the continuation campaign. New in the visual refinement; carries a
          DRAFT statement and no participant data. */}
      <ActionTransition />

      {/* SECTION 10 — the configurable next-step campaign. */}
      <ContinuationCTA />

      {/* SECTION 11 — keep the results. Rendered AFTER the campaign because the
          section numbering is the owner's approved order (§10 then §11). This
          ordering does NOT gate the download: the button performs its own POST
          and reads no state from the campaign above it. */}
      {sessionId ? <SnapshotDownload sessionId={sessionId} /> : null}

      {/* ⛔ THE "YOU DECIDE WHAT HAPPENS NEXT." BLOCK WAS REMOVED HERE ON THE
          OWNER'S INSTRUCTION (visual refinement, 2026-10-05). The directive:
          "Remove its options such as Keep Learning / Look Closer at My
          Financial Picture / Explore Ways to Create More Income / Not Right
          Now ... This was not part of the approved Snapshot architecture and
          dilutes the primary continuation path." The page now ends
          CTA → Download → Footer.

          The component file is KEPT in the tree, unrendered, rather than
          deleted: its `continuation_options` entries are still present in
          config/report-v1.0.json (a locked copy library this phase must not
          edit), and restoring the block is one line. Its header comment — which
          argued for retaining the non-promotional paths, including "Not Right
          Now" — is retained as the record of the tradeoff the owner has now
          decided. No automated test asserts this block either way. */}
      {/* <ContinuationOptions /> */}

      {/* SECTION 12 — the logo and the approved disclosure. No CTA after it. */}
      <SnapshotFooter />
    </Shell>
  );
}

export { Shell } from "./SnapshotSection";
