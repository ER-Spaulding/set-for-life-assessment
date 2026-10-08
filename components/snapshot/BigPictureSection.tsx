// SECTION 2 — YOUR BIG PICTURE. The executive summary.
//
// THE SECTION'S ONE JOB (Owner narrative-rewrite standard §2): answer "when we
// put the whole assessment together, what is the central story?" — SYNTHESIS,
// not a catalog, and never a repeat of what later sections say. Since the
// 2020-10-07 rewrite the model delivers exactly that: one editorial synthesis
// HEADLINE (`block.label`, resolved from the governed `big_picture` family —
// template × primary attention area) plus its body paragraphs
// (`block.body` + `block.paragraphs`).
//
// WHAT CHANGED AND WHY. Previously this section rendered `bigPicture.parts` —
// an ordered list of borrowed narrative keys (the strongest signal, the primary
// friction, the capacity qualifier, the attention area) whose sentences ALSO
// render in full in the Strengths/Friction/Connection/Attention modules. That
// construction made the Big Picture a structural echo: the reader met the same
// sentences again and again as they descended (Owner §1, "unfold, not echo").
// The resolver now ignores `parts` (kept in the payload as the engine's
// provenance record) and resolves the synthesis family instead, so every
// sentence here is this section's own.
//
// The old "four named parts" limitation note (spec §2's Overall Picture /
// What's Working / Where There's Friction / Worth Noticing) no longer applies
// in the same way: the synthesis family can carry an arbitrary number of
// authored paragraphs under one headline, and the other three parts remain
// delivered in full in their own modules (4, 5, 6).
//
// NO FABRICATED FRICTION. When the engine found no meaningful friction it
// resolves the approved `NO_MEANINGFUL_FRICTION` synthesis; this component
// renders whatever prose arrived and adds nothing, per §2's "do not invent one."
//
// The decorative background is an editorial ACCENT sized as a band, per §2's
// "should command ~15–25% of visual attention, not half the section."
//
// ⚠️ THE ARTWORK ELEMENT CARRIES NO ACCESSIBLE ATTRIBUTE. It is aria-hidden and
// role="presentation" with only className/style, which the membership guard's
// attribute allowlist deliberately does not cover.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { SECTION_ART, SnapshotSection as Section } from "./SnapshotSection";

export function BigPictureSection({ section }: { section: SnapshotSection }) {
  // Every paragraph of the synthesis, in order — the headline is NOT among
  // them; it renders as the section's own title below.
  const block = section.blocks[0];
  const headline = block?.label;
  const sentences = section.blocks
    .flatMap((b) => [b.body, ...(b.paragraphs ?? [])])
    .filter((s) => s.length > 0);

  // The leading sentence becomes the dominant statement at display scale; the
  // rest support it. This is a presentation split of an already-ordered list —
  // not a re-selection, not a rewording.
  const [dominant, ...supporting] = sentences;

  return (
    <Section title={section.heading} id="big-picture">
      <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-5">
        {/* THE HEADLINE + DOMINANT STATEMENT — 3 of 5 columns on desktop. */}
        <div className="lg:col-span-3">
          {/* The editorial synthesis headline, rendered VERBATIM including its
              mixed case — it is a model string (`block.label`), not chrome, and
              uppercasing it would make it unattributable to the model. */}
          {headline ? (
            <h3
              className="font-body text-rose"
              style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
            >
              {headline}
            </h3>
          ) : null}

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

      {/* THE SUPPORTING SYNTHESIS — the remaining paragraphs, at reading scale. */}
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
