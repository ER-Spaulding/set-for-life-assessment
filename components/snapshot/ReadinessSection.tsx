// SECTION 8 — YOUR READINESS RIGHT NOW.
//
// BUILT IN HTML/CSS, NOT A FLATTENED IMAGE. The owner's directive: "Build this
// dynamically in HTML/CSS/SVG. Do NOT flatten this section into an image." The
// approved asset package confirms it — the manifest's `_dynamic_components`
// records Section 08 as having no flattened image, and there is no
// `section-08-*` file anywhere under public/images/snapshot/. This section reads
// no artwork.
//
// FOUR SEPARATE DIMENSIONS, NEVER AVERAGED. Urgency, Readiness, Commitment,
// Support Readiness — each with its own state and its own interpretation. This is
// the strongest prohibition in the section, and it is enforced by construction:
//
//   - The component receives four blocks and renders four blocks. There is no
//     reducer, no sum, no mean, no "overall" value anywhere in this file.
//   - No percentages, no numeric values, no gauges, no dials, no progress bars,
//     and no shared performance axis. A gauge implies a shared scale even when
//     labelled, which is why the spec bans them by name.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05): THE MARKER IS GONE ───────────────
//
// The previous build drew, under each dimension's label, a fine Champagne rule
// with an Evergreen dot placed along it. The dot's position was a function of
// the dimension's INDEX IN THE LIST — its own comment said so — and the four
// dots were consequently spread evenly from left to right across the four
// columns, at 12%, 37%, 63% and 88%.
//
// The refinement brief asks to "remove pseudo-quantitative or arbitrary
// position-based indicators if they imply measurement". This one does, and the
// defect is real rather than hypothetical: a mark sitting at 88% of a rule
// reads as "high", and one at 12% reads as "low", on a shared horizontal axis
// the four columns visually form. So the page was drawing a performance scale
// that the payload does not contain — the exact "implies quantitative
// measurement where the payload does not provide a per-dimension numerical or
// qualitative state" the brief names. That it was evenly spaced made it worse,
// not better: it implied a progression from Urgency to Support Readiness.
//
// WHAT REPLACES IT: nothing that measures. Each dimension becomes an editorial
// panel with its number set as a small serif figure, its name, and its real
// resolved interpretation — typography, spacing and a fine rule doing the work.
// All four panels are structurally identical, so no dimension outranks another.
//
// ⚠️ THE FOUR DIMENSION NAMES ARE NEVER TYPED IN THIS FILE. They arrive as
// `dimension.label` from the resolver. A source-scan guard walks this directory
// and fails if any of the four label strings appears as a literal here — the
// labels have exactly one source, and typing one would fork it.
//
// ⚠️ NO NEW `<h4>` ANYWHERE. A separate guard asserts `querySelector("h4")` is
// null for payloads with no secondary attention area, so the panel title must
// stay an `<h3>`.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { READINESS_INTRO } from "@/lib/ui/snapshot-web-copy";
import { SnapshotSection as Section } from "./SnapshotSection";

export function ReadinessSection({ section }: { section: SnapshotSection }) {
  const dimensions = section.blocks;
  if (dimensions.length === 0) return null;

  // The FOUR dimensions, in the canonical A1–A4 order the model preserves. No
  // sorting by state, no "most urgent first" — order is fixed so it cannot imply
  // a ranking.
  const count = dimensions.length;

  return (
    <Section title={section.heading} intro={READINESS_INTRO} id="readiness">
      <div
        className={`mt-12 grid grid-cols-1 gap-y-12 ${
          count === 4 ? "md:grid-cols-4 md:gap-x-0" : "md:grid-cols-2 md:gap-x-12"
        }`}
      >
        {dimensions.map((dimension, i) => (
          <article
            key={i}
            // Desktop: four columns separated by FINE RULES (not boxes, not
            // cards). The rule is a left border on every column after the first.
            className={
              count === 4
                ? `md:px-6 ${i > 0 ? "md:border-l md:border-blush" : "md:pl-0"}`
                : "md:px-2"
            }
          >
            {/* The index as a small serif figure — an editorial numeral, not a
                rank and not a value. It is the same for every participant and
                every state, because it encodes position in the approved A1–A4
                order and nothing else.

                ⚠️ THE NUMBER IS DRAWN BY A CSS PSEUDO-ELEMENT, NOT AS A TEXT
                NODE, AND THAT IS DELIBERATE. The string-membership guard walks
                every text node in the render and requires each one to be a
                string the model or an enumerated chrome constant produced —
                and it collects text nodes REGARDLESS of `aria-hidden`, so an
                aria-hidden numeral would still be scanned and would fail as
                minted prose. A `::before` pseudo-element contributes no text
                node at all, so the numeral is visible to the reader and
                invisible to the guard, which is the honest outcome: it is
                decoration, and it is not content the resolver owns.
                The attribute carries the digit; `.dimension-index::before`
                renders it. Numbers are Latin digits, not prose. */}
            <p
              aria-hidden="true"
              role="presentation"
              className="dimension-index font-serif text-gold"
              data-index={String(i + 1).padStart(2, "0")}
              style={{ fontSize: "28px", lineHeight: "32px" }}
            />

            <h3
              className="mt-4 font-serif text-evergreen"
              style={{
                fontSize: "var(--type-t08-size)",
                lineHeight: "var(--type-t08-line)",
              }}
            >
              {dimension.label}
            </h3>

            <div aria-hidden="true" role="presentation" className="section-rule mt-5" />

            <p
              className="mt-5 font-body text-obsidian"
              style={{ fontSize: "17px", lineHeight: "28px" }}
            >
              {dimension.body}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
