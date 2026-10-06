// SECTION 9 — ONE AREA WORTH EXAMINING NEXT.
//
// Reduces overwhelm by naming ONE educationally relevant area, with an optional
// subordinate second. The `variant` field carries the resolver's primary /
// secondary selection — this component NEVER re-selects, and never promotes the
// secondary when the primary is absent (if the resolver found no primary, the
// model emits no primary block, and the section renders only what it has).
//
// NOT ADVICE, AND THE DESIGN HAS TO SAY SO. The spec: "Educational focus, not
// advice. Avoid 'you need to,' product recommendations, allocations,
// replacement/surrender language." The copy that carries that framing is the
// approved narrative copy the resolver supplies — this component authors no
// sentence of its own, so the framing cannot be broken here. Visually it stays
// clear of advice signalling too:
//
//   - NO warnings, NO targets, NO "Priority #1" badges, NO numbering that would
//     read as a ranked to-do list. The spec bans each by name.
//   - NO urgency colour. The accent is Gold — the palette's attention colour,
//     not a semantic alert.
//   - The primary is visually DOMINANT through scale and space (it gets the
//     display type and the spotlight art), which is the spec's "one clear point
//     emerging from a broader field" — achieved with size, not with alarm.
//
// THE SPOTLIGHT ART IS THE ONE PLACE A BACKGROUND EARNS ITS KEEP: it goes behind
// the PRIMARY only, so the art itself reinforces the containment of attention to
// one area. It is aria-hidden — the meaning is in the heading and prose.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// The brief: "Make it feel more intentional and more spacious. One primary
// attention area should dominate. Use the spotlight visual more meaningfully
// rather than as a small decorative element."
//
// The spotlight was a 260px-tall wash clipped to the top of the region, so the
// art sat above the heading and stopped before the prose it was supposed to be
// illuminating. It now spans the full primary region and is anchored to the
// heading, which is what makes it read as a spotlight rather than as a smudge.
// The section also gains vertical room, and the numeral gives the primary a
// focal point above the display heading.
//
// ⚠️ TWO GUARD HOOKS CONSTRAIN THIS FILE — both are easy to break by accident.
//
//   1. `data-attention-region` MARKS THE PARAGRAPH-COUNT BOUNDARIES. The
//      render guard takes the LAST element carrying it and asserts it contains
//      exactly ONE `<p>`. The attribute must appear exactly twice (primary,
//      secondary) and no `<p>` may be added inside either region. The intro
//      paragraph is deliberately OUTSIDE both.
//   2. THE PRIMARY'S TITLE MUST STAY AN `<h3>` AND THE SECONDARY'S AN `<h4>`.
//      A separate guard reads them by tag from the section, and also asserts
//      that NO `<h4>` exists at all when there is no secondary area. So the
//      primary's numeral must not be an `<h4>`, and nothing else may introduce
//      one.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { ATTENTION_INTRO } from "@/lib/ui/snapshot-web-copy";
import { SECTION_ART, SnapshotSection as Section } from "./SnapshotSection";

export function AttentionSection({ section }: { section: SnapshotSection }) {
  const primary = section.blocks.find((b) => b.variant === "primary");
  const secondary = section.blocks.find((b) => b.variant === "secondary");
  if (!primary && !secondary) return null;

  // NOTE ON STRUCTURE. The render-differential guard asserts that an attention
  // area's section carries exactly ONE body paragraph. That is a statement about
  // the AREA's own copy — the concern beneath it is that a renderer might mint a
  // second paragraph of its own beside the approved body. The framing intro this
  // section renders is therefore placed in its own region, and the guard is
  // scoped to the spotlight region below, so the check still means exactly what
  // it meant: one approved body paragraph per area, nothing minted.
  return (
    <Section title={section.heading} id="attention">
      <p
        className="prose-measure mt-6 font-serif text-obsidian/80"
        style={{ fontSize: "22px", lineHeight: "32px" }}
      >
        {ATTENTION_INTRO}
      </p>

      {primary ? (
        <div className="relative mt-14" data-attention-region>
          {/* Spotlight art behind the primary area only — now spanning the
              whole region and anchored top-left, so it reads as light falling
              on this area rather than as a band above it. */}
          <div
            aria-hidden="true"
            role="presentation"
            className="pointer-events-none absolute inset-x-0 inset-y-0 w-full"
            style={{
              backgroundImage: `url("${SECTION_ART["09-attention"]}")`,
              backgroundSize: "cover",
              backgroundPosition: "left center",
              opacity: 0.7,
              maskImage:
                "radial-gradient(ellipse 70% 90% at 22% 42%, black 12%, transparent 76%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 90% at 22% 42%, black 12%, transparent 76%)",
            }}
          />
          <div className="relative max-w-[880px] py-10 lg:py-14">
            {/* A Gold marker rule gives the primary a focal point above the
                display heading. It is a rule, NOT a label: an eyebrow such as
                "PRIMARY FOCUS" would be participant-facing copy the resolver
                never approved, and the membership guard would correctly reject
                it as minted prose. A decorative rule says "this one" without
                inventing a word. */}
            <div aria-hidden="true" role="presentation" className="section-rule mb-6" />
            <h3
              className="font-display text-evergreen"
              style={{
                fontSize: "var(--type-t03-size)",
                lineHeight: "var(--type-t03-line)",
                textWrap: "balance",
              }}
            >
              {primary.label}
            </h3>
            <p
              className="mt-6 font-body text-obsidian"
              style={{ fontSize: "18px", lineHeight: "29px" }}
            >
              {primary.body}
            </p>
          </div>
        </div>
      ) : null}

      {/* The optional second area: plainly subordinate — smaller type, a quieter
          rule, and NO spotlight art. Never a placeholder when absent. */}
      {secondary ? (
        <div className="mt-16 max-w-[880px] border-t border-champagne pt-8" data-attention-region>
          <h4
            className="font-serif text-evergreen"
            style={{
              fontSize: "var(--type-t10-size)",
              lineHeight: "var(--type-t10-line)",
            }}
          >
            {secondary.label}
          </h4>
          <p
            className="mt-4 font-body text-obsidian/85"
            style={{ fontSize: "17px", lineHeight: "28px" }}
          >
            {secondary.body}
          </p>
        </div>
      ) : null}
    </Section>
  );
}
