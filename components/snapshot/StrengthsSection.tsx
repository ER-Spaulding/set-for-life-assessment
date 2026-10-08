// SECTION 4 — WHAT'S ALREADY WORKING FOR YOU.
//
// THE DYNAMIC-CASE RULE, from the owner's directive and the wireframe spec:
//
//     0 strengths -> OMIT the section entirely
//     1           -> a featured panel
//     2           -> two columns
//     3           -> three editorial panels
//
// "No invented strengths for layout symmetry."
//
// The omission is handled by the CALLER, not here: the shared section model only
// emits a `strengths` section when the resolver found at least one, so this
// component is never mounted for the zero case. That is the structural version
// of the rule — the renderer has no empty branch to fill, so it cannot fill one.
//
// The 1/2/3 layouts are chosen from the ACTUAL block count, not from a fixed
// grid: a participant with two strengths gets two full columns, not two panels
// beside an empty third slot.
//
// TONE. The spec is specific: "Acknowledgment, not praise," no rankings, no
// comparisons to others, no gamified "success" iconography. So this section uses
// no checkmarks, no trophies, no confetti, and no per-item colour. The editorial
// treatment is a fine rule and generous type — the same visual language the rest
// of the report uses, which is what keeps a strength from reading as a reward.
//
// The approved Strengths art is a decorative band: it carries no meaning and is
// hidden from assistive tech.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// Part of the middle-page RHYTHM pass. The shipped build put an identical
// decorative band at the foot of Big Picture, Strengths, Friction, Destination
// and Connection — five sections in a row ending the same way, which is a large
// part of why the page read as templated. The bands are now deployed
// differently per section rather than uniformly: here the art moves from a
// closing band to a composed column BESIDE the findings, so it participates in
// the layout instead of punctuating it.
//
// The findings themselves are untouched: same labels, same bodies, same order,
// same 1-featured / 2-column / 3-panel count rule.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { SECTION_ART, SnapshotSection as Section } from "./SnapshotSection";

/** One strength: its approved title and its why-it-matters explanation. */
function Strength({
  label,
  body,
  paragraphs,
  featured,
}: {
  label: string;
  body: string;
  paragraphs?: string[];
  featured: boolean;
}) {
  return (
    <article className={featured ? "border-t border-gold/60 pt-8" : "border-t border-blush pt-6"}>
      <h3
        className="font-display text-evergreen"
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
      {(paragraphs ?? []).map((p, i) => (
        <p
          key={i}
          className="mt-4 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {p}
        </p>
      ))}
    </article>
  );
}

export function StrengthsSection({ section }: { section: SnapshotSection }) {
  const blocks = section.blocks;
  if (blocks.length === 0) return null;

  const featured = blocks.length === 1;

  return (
    <Section title={section.heading} intro={section.intro} id="strengths">
      <div className="mt-12 grid grid-cols-1 gap-x-14 gap-y-12 lg:grid-cols-5">
        {/* THE FINDINGS — 3 of 5 columns on desktop. */}
        <div className="lg:col-span-3">
          {featured ? (
            // 1 — a single featured panel, given the full measure.
            <Strength label={blocks[0].label ?? ""} body={blocks[0].body} paragraphs={blocks[0].paragraphs} featured />
          ) : (
            // 2 or 3 — a grid whose column count is the ACTUAL item count, so no
            // participant ever sees an empty slot holding a place for a finding
            // that does not exist.
            <div
              className={`grid grid-cols-1 gap-x-14 gap-y-12 ${
                blocks.length === 2 ? "md:grid-cols-2 lg:grid-cols-1" : "md:grid-cols-3 lg:grid-cols-1"
              }`}
            >
              {blocks.map((block, i) => (
                <Strength key={i} label={block.label ?? ""} body={block.body} paragraphs={block.paragraphs} featured={false} />
              ))}
            </div>
          )}
        </div>

        {/* THE APPROVED ARTWORK — 2 of 5 columns, a composed counterweight.
            Decorative; carries no accessible attribute. */}
        <div
          aria-hidden="true"
          role="presentation"
          className="hidden lg:col-span-2 lg:block lg:self-stretch"
          style={{
            minHeight: "260px",
            backgroundImage: `url("${SECTION_ART["04-strengths"]}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            maskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
          }}
        />
      </div>

      {/* Mobile keeps the art as the closing band. */}
      <div
        aria-hidden="true"
        role="presentation"
        className="mt-10 h-[120px] w-full lg:hidden"
        style={{
          backgroundImage: `url("${SECTION_ART["04-strengths"]}")`,
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
