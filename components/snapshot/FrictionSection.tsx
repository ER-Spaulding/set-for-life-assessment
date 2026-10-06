// SECTION 5 — WHERE THERE'S FRICTION.
//
// THE DYNAMIC-CASE RULE, from the owner's directive:
//
//     0 -> OMIT the section entirely
//     1 -> a featured friction
//     2 -> two columns
//     3 -> stacked editorial findings
//
// As with Strengths, the zero case never reaches this component: the shared
// section model omits the module when the resolver found no meaningful friction,
// so there is no empty shell to fill and no temptation to fabricate one. The
// spec is explicit: "Never manufacture a problem to preserve layout symmetry."
//
// WHY 3 STACKS RATHER THAN A THREE-COLUMN GRID. The spec prefers it — "3: stacked
// editorial rows preferred when copy needs nuance" — and friction copy is the
// longest in the report (hard max ~70 words per finding). Three columns at this
// copy length produces narrow, hard-to-read measures. Stacking keeps the
// comfortable reading width the rest of the report uses.
//
// TONE IS THE WHOLE SECTION. The spec: "Do not equate low margin with low agency.
// Avoid danger-red treatment and punitive language." The owner's directive adds
// "No warning-red UI" and "No shame-based language."
//
// So this component uses:
//   - NO red. The section's accent is Rose, a warm neutral from the approved
//     palette, not a semantic alarm colour. The token for danger does not appear
//     in this file.
//   - NO warning iconography, no severity badges, no "!" affordances.
//   - NO ranking of findings — they are rendered in the resolver's order, which
//     is the payload's order, with no "most important" emphasis.
//
// An optional context sentence (spec: "Optional context sentence where necessary
// to prevent misinterpretation") arrives, when present, as an additional block in
// this section and renders as prose beneath the finding — never as a caveat box
// that would visually mark the finding as a problem.

// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// Part of the middle-page RHYTHM pass. The shipped build closed this section
// with the approved decorative band; with the same band also closing Big
// Picture, Strengths, Destination and Connection, five consecutive sections
// ended identically. The rhythm fix is subtraction: Friction now ends on its
// own prose with white space, and the approved art is used in the sections
// either side of it instead. The artwork file itself is untouched and still
// referenced elsewhere — nothing is orphaned.
//
// The dynamic-case rule, the copy, and the ordering are unchanged.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { FRICTION_INTRO } from "@/lib/ui/snapshot-web-copy";
import { SnapshotSection as Section } from "./SnapshotSection";

/**
 * One friction finding: its approved label and plain-English explanation.
 *
 * CARRIES NO GENERATED TEXT. An earlier draft appended a screen-reader-only
 * "Finding N of this section" line; it was removed deliberately. It was copy the
 * renderer minted rather than copy the resolver approved, and it added nothing a
 * screen reader user needs — the findings are already `<article>` elements in a
 * titled section, so their position is conveyed by document structure. The
 * render guard flagged it correctly.
 */
function Friction({ label, body, featured }: { label: string; body: string; featured: boolean }) {
  return (
    <article className="border-t border-blush pt-6">
      <h3
        className="font-display text-rose"
        style={{
          fontSize: featured ? "var(--type-t04-size)" : "var(--type-t05-size)",
          lineHeight: featured ? "var(--type-t04-line)" : "var(--type-t05-line)",
          textWrap: "balance",
        }}
      >
        {label}
      </h3>
      <p
        className="mt-5 font-body text-obsidian"
        style={{ fontSize: "18px", lineHeight: "29px" }}
      >
        {body}
      </p>
    </article>
  );
}

export function FrictionSection({ section }: { section: SnapshotSection }) {
  const blocks = section.blocks;
  if (blocks.length === 0) return null;

  return (
    <Section title={section.heading} intro={FRICTION_INTRO} id="friction">
      {blocks.length === 1 ? (
        <div className="mt-12 max-w-[880px]">
          <Friction label={blocks[0].label ?? ""} body={blocks[0].body} featured />
        </div>
      ) : blocks.length === 2 ? (
        <div className="mt-12 grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
          {blocks.map((block, i) => (
            <Friction key={i} label={block.label ?? ""} body={block.body} featured={false} />
          ))}
        </div>
      ) : (
        // 3+ — stacked editorial rows, generous spacing, no carousel.
        <div className="mt-12 flex max-w-[880px] flex-col gap-14">
          {blocks.map((block, i) => (
            <Friction key={i} label={block.label ?? ""} body={block.body} featured={false} />
          ))}
        </div>
      )}
    </Section>
  );
}
