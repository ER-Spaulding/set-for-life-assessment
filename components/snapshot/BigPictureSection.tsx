// SECTION 2 — YOUR BIG PICTURE. The executive summary.
//
// THE SPEC'S CONSTRAINT ON THIS SECTION IS THE HARD PART: "This is a summary,
// not a duplicate of later sections," and §2 warns against exposing the engine's
// synthesis ingredients "as five separate technical blocks."
//
// ⚠️ AN ARCHITECTURAL LIMIT, STATED PLAINLY RATHER THAN PAPERED OVER.
//
// Spec §2 names four parts: Overall Picture, What's Working, Where There's
// Friction, Worth Noticing. The stored payload cannot bind content to those four
// names. `bigPicture.parts` is an ORDERED LIST of resolved synthesis SENTENCES —
// it carries no per-part label, no part identifier, and no count guarantee. So
// there is no honest way to render "this sentence is the What's Working part":
// any such claim would be a renderer inventing structure the data does not have.
//
// The second route — pulling the strengths / friction / connection modules'
// findings up into this section as bullets — is also closed, and correctly so.
// Those strings belong to their own modules; rendering them here would be the
// misattribution defect the render guard exists to catch ("a strength body shown
// as readiness prose"), and it would make this section the duplicate of later
// sections that §2 forbids.
//
// WHAT THIS COMPONENT THEREFORE DOES, and why it is the faithful reading:
// it renders the section's OWN resolved synthesis prose — the engine's
// strength + friction + context + connection + activation conclusions, already
// composed into sentences by the resolver — under one subhead. That is the
// summary §2 asks for, it duplicates nothing downstream, and it invents no
// structure. The other three parts of §2's structure ARE delivered, in full and
// in their own modules (4, 5, 6), which is where §2 says the reader will find
// them.
//
// If the owner wants the four named parts rendered literally inside Section 2,
// the payload has to carry per-part labels first — a change to the immutable
// Snapshot payload and therefore a versioned decision, not a renderer change.
// Raised in the phase report rather than worked around here.
//
// NO FABRICATED FRICTION. When the engine found no meaningful friction it
// resolves the approved `NO_MEANINGFUL_FRICTION` synthesis; this component
// renders whatever prose arrived and adds nothing, per §2's "do not invent one."
//
// The decorative background is an editorial ACCENT sized as a band, per §2's
// "should command ~15–25% of visual attention, not half the section."
//
// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// The brief: "too text-first ... one dominant synthesis statement; a smaller
// number of supporting findings; stronger layout contrast; approved Big Picture
// abstract artwork as an editorial accent, not merely a decorative wave beneath
// paragraphs." And the participant should grasp the main point in about 30
// seconds.
//
// The change is purely one of HIERARCHY, and it invents nothing. The resolver's
// first synthesis sentence is the engine's leading conclusion — it is already
// ordered first — so it becomes the dominant statement set at display scale,
// and the remaining sentences become the supporting prose beneath it. No
// sentence is reworded, reordered, dropped, or added, and every sentence still
// renders as its own `<p>` (the paragraph-duplication guard counts them).
//
// The artwork is promoted from a band under the prose to a composed element
// beside the opening statement: on desktop the dominant sentence and the
// artwork share a row (60/40), which is what gives the section its "layout
// contrast". On mobile the artwork returns beneath the prose.
//
// ⚠️ THE ARTWORK ELEMENT CARRIES NO ACCESSIBLE ATTRIBUTE. It is aria-hidden and
// role="presentation" with only className/style, which the membership guard's
// attribute allowlist deliberately does not cover.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { BIG_PICTURE_OVERALL_LABEL } from "@/lib/ui/snapshot-web-copy";
import { SECTION_ART, SnapshotSection as Section } from "./SnapshotSection";

export function BigPictureSection({ section }: { section: SnapshotSection }) {
  const sentences = section.blocks.map((b) => b.body).filter((s) => s.length > 0);

  // The engine's leading conclusion, and the support beneath it. This is a
  // presentation split of an already-ordered list — not a re-selection.
  const [dominant, ...supporting] = sentences;

  return (
    <Section title={section.heading} id="big-picture">
      <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-5">
        {/* THE DOMINANT STATEMENT — 3 of 5 columns on desktop. */}
        <div className="lg:col-span-3">
          {/* Rendered VERBATIM, including its mixed case. The membership guard
              registers this constant's exact string as a chrome source and then
              asserts it appears as a rendered text node — uppercasing it here
              (as the section headings are uppercased in the frame) would make it
              unattributable. */}
          <h3
            className="font-body text-rose"
            style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
          >
            {BIG_PICTURE_OVERALL_LABEL}
          </h3>

          {dominant ? (
            <p
              className="mt-6 font-serif text-evergreen"
              style={{
                fontSize: "var(--type-t05-size)",
                lineHeight: "var(--type-t05-line)",
                textWrap: "balance",
              }}
            >
              {dominant}
            </p>
          ) : null}
        </div>

        {/* THE APPROVED ARTWORK — 2 of 5 columns, a composed counterweight to
            the statement rather than a band beneath it. */}
        <div
          aria-hidden="true"
          role="presentation"
          className="hidden lg:col-span-2 lg:block"
          style={{
            backgroundImage: `url("${SECTION_ART["02-big-picture"]}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            maskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
          }}
        />
      </div>

      {/* THE SUPPORTING SYNTHESIS — the remaining sentences, at reading scale. */}
      {supporting.length > 0 ? (
        <div className="mt-10 flex max-w-[880px] flex-col gap-5 border-t border-blush pt-8">
          {supporting.map((s, i) => (
            <p
              key={i}
              className="prose-measure font-body text-obsidian"
              style={{ fontSize: "18px", lineHeight: "29px" }}
            >
              {s}
            </p>
          ))}
        </div>
      ) : null}

      {/* Mobile keeps the artwork as the band beneath the prose. */}
      <div
        aria-hidden="true"
        role="presentation"
        className="mt-10 h-[130px] w-full lg:hidden"
        style={{
          backgroundImage: `url("${SECTION_ART["02-big-picture"]}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          maskImage: "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        }}
      />
    </Section>
  );
}
