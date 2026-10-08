// SECTION 6 — THE CONNECTION / HERE'S THE PART WORTH NOTICING.
//
// The "I had not connected those two things" moment.
//
// ⚠️ THE SIDE-LABEL RULE — READ BEFORE CHANGING THE GRAPHIC.
//
// The spec permits a relational diagram with labelled sides ONLY "if reliable
// participant-facing 'Side A / Side B' labels exist", and the owner's directive
// repeats it: "If the resolved model does not expose reliable participant-facing
// labels for two sides of a connection, do not invent them in the renderer. Use
// an abstract relationship graphic instead."
//
// THEY DO NOT EXIST. The resolver produces `ResolvedConnection { headline, body }`
// and nothing else — there is no field naming the two things being connected.
// The tension code that WOULD name them is internal vocabulary (§24) and must
// never reach a participant. So this section renders an ABSTRACT graphic: two
// equal-weight marks joined to the finding, with no labels on the sides at all.
// Inventing "Decision-making" / "Follow-through" style labels from the headline
// text would be minting participant-facing copy in a renderer, which this project
// forbids outright.
//
// If approved side labels are ever added, they must arrive as new fields on the
// resolved connection — a payload/resolver change, versioned, not a renderer
// change. Raised in the phase report.
//
// PRIMARY vs SECONDARY. `variant` marks the resolver's selection (connections[0]
// is primary; connections[1], when present, is secondary). They are NEVER
// reordered or re-selected here. The primary carries the display type and the
// graphic; the secondary is clearly subordinate — smaller type, no graphic, a
// quieter rule — per the spec's "one featured + one subordinate".
//
// NEVER MORE THAN TWO. The spec: "Never show more than two." The model already
// carries at most two; this component slices defensively so a future payload
// cannot silently render a third at equal weight.
//
// LANGUAGE. The spec requires relational phrasing ("may be connected," "worth
// noticing alongside") and forbids unsupported causation ("this caused that").
// That phrasing lives in the approved narrative copy the resolver supplies — this
// component adds NO sentence of its own, which is what guarantees the relational
// framing cannot be broken by a renderer.

// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// The brief calls this "the key 'aha' moment" and asks that it be "visually
// separate[d] from ordinary narrative sections", with the approved artwork
// "used more meaningfully within the composition".
//
// Two changes, both surface and composition only:
//
//   1. The section moves onto the WARM BLUSH WASH. Together with the Money
//      Picture's deep plate this gives the page its rhythm: two tinted moments,
//      far apart, different in kind. Everything the section SAYS is unchanged.
//   2. The artwork is promoted from a band under the articles to a composed
//      column BESIDE the primary connection, so the "aha" has a visual event
//      attached to it rather than a footer rule. The secondary stays beneath,
//      quieter, as before.
//
// THE PRIMARY MUST DOMINATE. The brief repeats the spec's requirement. That is
// carried by size (T04 display vs T10 serif), by the artwork being scoped to the
// primary's row, and by the secondary's own rule — never by colour, which stays
// identical for both.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { SECTION_ART, SnapshotSection as Section } from "./SnapshotSection";

/** The abstract two-points-and-a-finding graphic. Decorative; no text. */
function RelationshipGraphic() {
  return (
    <svg
      viewBox="0 0 520 140"
      role="presentation"
      aria-hidden="true"
      className="h-auto w-full max-w-[520px]"
    >
      {/* Two equal-weight marks. Identical geometry: neither side outranks the
          other, which is the visual claim the spec's "equal-weight" asks for. */}
      <circle cx="52" cy="70" r="11" fill="none" stroke="#BC5248" strokeWidth="2" />
      <circle cx="468" cy="70" r="11" fill="none" stroke="#BC5248" strokeWidth="2" />
      {/* Connectors converging on the centre — no arrowheads. */}
      <line x1="63" y1="70" x2="244" y2="70" stroke="#93504F" strokeWidth="1.5" opacity="0.55" />
      <line x1="276" y1="70" x2="457" y2="70" stroke="#93504F" strokeWidth="1.5" opacity="0.55" />
      {/* The interpretation: a filled mark at the meeting point. */}
      <circle cx="260" cy="70" r="15" fill="#28513F" />
    </svg>
  );
}

export function ConnectionSection({ section }: { section: SnapshotSection }) {
  const blocks = section.blocks;
  if (blocks.length === 0) return null;

  // EVERY block the model provides is rendered. The renderer does NOT slice to
  // two: how many connections exist is a decision the RESOLVER makes (its
  // payload carries a primary and at most one optional secondary), and a
  // renderer that silently dropped a block would be deciding content — exactly
  // the §5 divergence the shared model exists to prevent. The "never more than
  // two" rule is enforced where the model is built.
  //
  // ⚠️ EVERY CONNECTION RENDERS AS AN `<article>` WITH `<h3>` THEN ONE OR MORE
  // `<p>`s — NOTHING ELSE. The render-differential guard derives the expected
  // child count from the shared model (1 heading + 1 body + any `paragraphs`),
  // so framing paragraphs raise the count honestly while a minted wrapper,
  // caption, or decorative span still fails the suite. The relationship graphic
  // and the artwork are therefore SIBLINGS of the articles, never children.
  const primary = blocks.find((b) => b.variant === "primary");
  const secondary = blocks.find((b) => b.variant === "secondary");
  // Defensive: if the resolver ever emits only a secondary, it must still
  // render rather than vanish. `remaining` is what the loop below iterates.
  const remaining = blocks.filter((b) => b !== primary);

  return (
    <Section title={section.heading} id="connection" toneBleed>
      {primary ? (
        <div className="mt-12 grid grid-cols-1 items-start gap-x-14 gap-y-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <RelationshipGraphic />
            <article className="mt-10">
              <h3
                className="font-display text-evergreen"
                style={{
                  fontSize: "var(--type-t04-size)",
                  lineHeight: "var(--type-t04-line)",
                  textWrap: "balance",
                }}
              >
                {primary.label}
              </h3>
              <p
                className="mt-5 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                {primary.body}
              </p>
              {(primary.paragraphs ?? []).map((p, i) => (
                <p
                  key={i}
                  className="mt-4 font-body text-obsidian"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {p}
                </p>
              ))}
            </article>
          </div>

          {/* The approved Connection artwork, as a full-height composition
              element beside the finding. Decorative; carries no text. */}
          <div
            aria-hidden="true"
            role="presentation"
            className="hidden lg:col-span-2 lg:block lg:self-stretch"
            style={{
              minHeight: "340px",
              backgroundImage: `url("${SECTION_ART["06-connection"]}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              maskImage:
                "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
            }}
          />
        </div>
      ) : null}

      {/* The subordinate connection(s). Same structure, quieter register, no
          artwork, and clearly below the primary. */}
      {remaining.length > 0 ? (
        <div className="mt-14 flex max-w-[880px] flex-col gap-12">
          {remaining.map((block, i) => (
            <article key={i} className="border-t border-rose/25 pt-8">
              <h3
                className="font-serif text-evergreen"
                style={{
                  fontSize: "var(--type-t10-size)",
                  lineHeight: "var(--type-t10-line)",
                  textWrap: "balance",
                }}
              >
                {block.label}
              </h3>
              <p
                className="mt-4 font-body text-obsidian/85"
                style={{ fontSize: "17px", lineHeight: "28px" }}
              >
                {block.body}
              </p>
              {(block.paragraphs ?? []).map((p, i) => (
                <p
                  key={i}
                  className="mt-4 font-body text-obsidian/85"
                  style={{ fontSize: "17px", lineHeight: "28px" }}
                >
                  {p}
                </p>
              ))}
            </article>
          ))}
        </div>
      ) : null}

      {/* Mobile keeps the artwork as the closing band. */}
      <div
        aria-hidden="true"
        role="presentation"
        className="mt-12 h-[110px] w-full lg:hidden"
        style={{
          backgroundImage: `url("${SECTION_ART["06-connection"]}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          maskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
        }}
      />
    </Section>
  );
}
