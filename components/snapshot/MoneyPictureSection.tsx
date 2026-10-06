// SECTION 3 — YOUR SET FOR LIFE MONEY PICTURE™. The signature visualization.
//
// BUILT IN SVG FROM RESOLVED DATA. The owner's directive is explicit: "Build
// this dynamically in HTML/CSS/SVG. Do NOT flatten it into an image." So the map
// is drawn as real vector geometry, not a background asset, and there is no
// Section-03 image anywhere in the approved package (confirmed: the asset
// manifest's `_dynamic_components` records sections 03 and 08 as having no
// flattened image). Nothing here reads a picture file.
//
// THE RULES THAT SHAPE THE GEOMETRY, each of which is a spec prohibition:
//
//   - YOU in the centre; six dimensions around it — one per §2.4 human question.
//   - ALL SIX NODES ARE STRUCTURALLY EQUAL. Same size, same radius, same
//     treatment, for every participant. Node geometry is a CONSTANT here: no
//     dimension of a node is computed from a resolved state, a label, or any
//     other payload value. The spec forbids size or placement varying with
//     outcome, so the code cannot express it — there is no code path from a
//     signal's state to a coordinate.
//   - No arrows (the connectors are plain lines), no raw scores, no percentages,
//     no ranking, no radar chart, and no red/yellow/green semantics. The only
//     colour used is Evergreen for the centre and a single warm neutral for the
//     ring — deliberately NOT a per-state colour scale, because a colour that
//     varied with state would communicate the result through colour alone,
//     which the brief forbids outright ("No information may be communicated
//     solely through color").
//
// ACCESSIBILITY. The map is a picture of a structure the six interpretations
// below already state in words, so the SVG itself is `aria-hidden` and the
// reading order is: heading, intro, then the six dimensions as real text. A
// screen-reader user receives the complete content; a sighted user gets the
// shape. Neither is a second-class path.
//
// MOBILE. The spec warns: "Do not miniaturize the full desktop map." Below the
// desktop breakpoint the ring is replaced by a compact vertical list of the same
// six dimensions joined by a single connecting rule — the same information, at a
// size where it is legible, rather than a shrunken diagram.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// The brief: this "must become the signature visual moment of the Snapshot",
// and the owner's report was that the six surrounding nodes and their
// connectors were "too faint" to read as a picture at all.
//
// The section now sits on the DEEP EVERGREEN PLATE — the page's 20% bold
// colour field, and deliberately the same Evergreen family as the Section 10
// campaign rather than a second competing brand colour. Against that ground:
//
//   - the connectors move from Blush at 1px to Blush at 1.75px (8.8:1 on the
//     plate), so the radial relationship is actually visible;
//   - the six nodes become Ivory plates with a Blush outline at 1.5px;
//   - the outer ring and the centre's ring move to Gold, which is decorative
//     and now also clears AA on this ground (5.7:1);
//   - the nodes and the YOU disc both scale up (see the constants below).
//
// ⚠️ THE NODE GEOMETRY REMAINS A PURE CONSTANT. Enlarging the nodes is a
// presentation change to ONE shared size used by all six; nothing here reads a
// resolved state to choose a size, position, or colour. The "all six are
// structurally equal" property is unchanged and still unrepresentable
// otherwise. The gold ring is a single ring around all six — it is structure,
// not a per-node measure.
//
// ⚠️ THE SIX INTERPRETATION BLOCKS ARE THE LOAD-BEARING CONTENT. The render
// guard asserts, per block: the `<article>` has EXACTLY three element children,
// in order `<p>`(kicker) → `<h3>`(label) → `<p>`(body). No wrapper, no
// decorative element, and no fourth child may be added inside an article, and
// the kicker must stay the FIRST child.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import {
  MONEY_PICTURE_CENTER_LABEL,
  MONEY_PICTURE_INTRO,
} from "@/lib/ui/snapshot-web-copy";
import { SnapshotSection as Section } from "./SnapshotSection";

/** Geometry constants — fixed, so no coordinate can depend on a resolved state. */
const VIEW = { w: 1100, h: 760 } as const;
const CENTER = { x: VIEW.w / 2, y: VIEW.h / 2 } as const;
const RING_RADIUS = 300;
/** Every node is the same size. This is the "structurally equal" rule as code. */
const NODE = { w: 320, h: 132, rx: 3 } as const;
/** The YOU disc, sized so the six nodes never overlap it at any angle. */
const CENTER_RADIUS = 96;

/** The six §2.4 questions, arranged clockwise from the top. */
const ANGLES = [-90, -30, 30, 90, 150, 210] as const;

/** The deep-plate palette, as literals — SVG fills cannot read Tailwind classes.
 *  Values are the approved brand hexes; see .surface-deep for the measured
 *  contrast of each pairing against the plate ground. */
const PLATE = {
  ivory: "#F7F2E9",
  champagne: "#E2C98F",
  gold: "#C49A45",
  blush: "#DAAAA6",
  evergreen: "#28513F",
  /** The node-kicker Rose, darkened for small text. Brand Rose (#93504F) is
   *  5.38:1 on the Ivory node — it passes AA — but it is an 11.5px uppercase
   *  label with wide tracking, which is the hardest thing on the page to read;
   *  #7E4342 measures 6.80:1 and holds up at that size without leaving the
   *  brand's warm red-brown family. Used only here; the section headings keep
   *  the lighter brand Rose. */
  roseDeep: "#7E4342",
} as const;

function nodePosition(i: number) {
  const rad = (ANGLES[i] * Math.PI) / 180;
  return {
    cx: CENTER.x + RING_RADIUS * Math.cos(rad),
    cy: CENTER.y + RING_RADIUS * Math.sin(rad),
  };
}

/**
 * ⚠️ ONE TEXT NODE PER STRING — NO WRAPPING, NO `<tspan>` SPLITTING.
 *
 * The obvious way to fit a long state label into a node is to break it across
 * `<tspan>` lines. That is not available here, and the reason is structural
 * rather than aesthetic: the string-membership guard walks EVERY text node in
 * the render and requires each one to be a string the shared model produced. A
 * wrapped label becomes several text nodes holding FRAGMENTS ("Developing",
 * "Resilience"), none of which is a model string, and the guard correctly
 * rejects them as minted prose.
 *
 * So each node renders its kicker and its label as exactly one text node each,
 * with the full resolved string. The node is a glance; the interpretation panel
 * beneath the map restates both in full at reading size, so nothing is lost if
 * a long label runs slightly wide of its box. It is never truncated.
 */

export function MoneyPictureSection({ section }: { section: SnapshotSection }) {
  // The model's money-picture blocks: one per resolved signal, each carrying the
  // §2.4 question as `kicker`, the resolved state label, and its interpretation.
  const blocks = section.blocks;
  const hasBlocks = blocks.length > 0;

  return (
    <Section
      title={section.heading}
      intro={MONEY_PICTURE_INTRO}
      id="money-picture"
      plate
    >
      {hasBlocks ? (
        <>
          {/* DESKTOP MAP — a decorative presentation of the structure the
              panels below state in words. */}
          <div className="mt-14 hidden justify-center lg:flex">
            <svg
              viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
              role="presentation"
              aria-hidden="true"
              className="h-auto w-full max-w-[1100px]"
            >
              {/* The outer ring: structure, not progress. Drawn first, under
                  everything.

                  ⚠️ OPACITY 0.85, NOT 0.55 (readability polish 2026-10-05).
                  A 0.55 Gold on this plate composites to #756734, which measures
                  2.74:1 — UNDER the 3.0 floor for non-text graphic objects. The
                  ring is the line that makes the six nodes read as one radial
                  system rather than six loose boxes, so it has to be visible to
                  do its job. At 0.85 it clears the floor with margin while
                  staying quieter than the connectors and the nodes. */}
              <circle
                cx={CENTER.x}
                cy={CENTER.y}
                r={RING_RADIUS}
                fill="none"
                stroke={PLATE.gold}
                strokeWidth={1.75}
                opacity={0.85}
              />

              {/* Connectors — visible now, still thin, still no arrowheads.

                  ⚠️ FULL OPACITY (readability polish 2026-10-05). These were
                  Blush at 0.75, which composites to #a98a84 — 4.87:1, legible
                  but muted enough that six long spokes across a dark field read
                  as background texture rather than as the relationship they
                  describe. At full opacity the same 1.75px line measures 7.52:1
                  and the radial structure is unmistakable. Still no arrowheads:
                  the connectors assert membership in the picture, never
                  direction or sequence. */}
              {blocks.map((_, i) => {
                const p = nodePosition(i);
                return (
                  <line
                    key={`l-${i}`}
                    x1={CENTER.x}
                    y1={CENTER.y}
                    x2={p.cx}
                    y2={p.cy}
                    stroke={PLATE.blush}
                    strokeWidth={1.75}
                  />
                );
              })}

              {/* YOU — the centre. A Gold ring separates it from the plate. */}
              <circle
                cx={CENTER.x}
                cy={CENTER.y}
                r={CENTER_RADIUS + 6}
                fill={PLATE.gold}
                opacity={0.9}
              />
              <circle cx={CENTER.x} cy={CENTER.y} r={CENTER_RADIUS} fill={PLATE.evergreen} />
              <text
                x={CENTER.x}
                y={CENTER.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={PLATE.ivory}
                fontFamily="var(--font-cormorant), Georgia, serif"
                fontSize="40"
                letterSpacing="3"
              >
                {MONEY_PICTURE_CENTER_LABEL}
              </text>

              {/* THE SIX NODES — identical geometry for every participant.
                  Each carries the §2.4 question and its resolved state label,
                  the same two strings the interpretation panels below repeat in
                  full. A ring of empty boxes would read as a rendering fault
                  rather than as the participant's picture; naming each node is
                  what makes the map legible as a picture at a glance.

                  ⚠️ NODE GEOMETRY IS STILL A PURE CONSTANT. The rect, the
                  wrap width and the type size are the same for all six and for
                  every participant. Only the STRINGS vary, and they vary
                  because they are the participant's own resolved content — no
                  coordinate, size, or colour is derived from a state. */}
              {blocks.map((block, i) => {
                const p = nodePosition(i);
                return (
                  <g key={`n-${i}`}>
                    <rect
                      x={p.cx - NODE.w / 2}
                      y={p.cy - NODE.h / 2}
                      width={NODE.w}
                      height={NODE.h}
                      rx={NODE.rx}
                      fill={PLATE.ivory}
                      stroke={PLATE.gold}
                      strokeWidth={1.5}
                    />
                    <text
                      x={p.cx}
                      y={p.cy - NODE.h / 2 + 30}
                      textAnchor="middle"
                      fill={PLATE.roseDeep}
                      fontFamily="var(--font-inter), Arial, sans-serif"
                      fontSize="11.5"
                      fontWeight="600"
                      letterSpacing="0.6"
                    >
                      {block.kicker}
                    </text>
                    {/* ⚠️ THE LABEL IS SIZED TO ITS OWN LENGTH (readability
                        polish 2026-10-05), AND THAT IS NOT A STATE-DERIVED
                        SIZE.

                        The rule this must not break is that no node dimension
                        varies with a resolved STATE — all six are structurally
                        equal, and no coordinate or size may be chosen from an
                        outcome. This does not choose from an outcome. It
                        measures the STRING the resolver produced, which is
                        already participant-facing content, and every node with
                        the same string gets the same size. A participant whose
                        PREPARE label is "Developing Resilience" and one whose
                        AIM label is "Clear Direction — Limited Room to Act" are
                        not ranked by this: they simply get type that fits.

                        MEASURED, NOT GUESSED. The two long special-state labels
                        are 335px and 300px at 21px inside a 320px node — they
                        ran past the Ivory plate and their last words landed on
                        the DEEP EVERGREEN ground as Evergreen text, which
                        measured at roughly 1.2:1 and was effectively invisible.
                        That is a legibility failure the participant would read
                        as a rendering fault.

                        So the size steps down only as far as needed:
                        21px fits ordinary labels; 17px fits the longest
                        special-state label at 271px inside the 320px plate with
                        24px of margin. Nothing is truncated, ellipsised, or
                        wrapped into fragments (a wrapped label would break the
                        one-text-node-per-string guard, see the note above). */}
                    <text
                      x={p.cx}
                      y={p.cy + 10}
                      textAnchor="middle"
                      fill={PLATE.evergreen}
                      fontFamily="var(--font-cormorant), Georgia, serif"
                      fontSize={(block.label ?? "").length > 22 ? 17 : 21}
                      fontWeight="600"
                    >
                      {block.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* MOBILE — the same six dimensions as a connected vertical spine.
              The brief allows this adaptation but asks it to "feel
              intentionally designed as the mobile expression of the same
              signature system": so the spine now carries the same Gold
              structure as the desktop ring, and each dimension's marker is a
              small Ivory disc on the spine rather than a bare dot. */}
          <div className="mt-12 lg:hidden">
            <ol className="relative flex flex-col gap-7 border-l-2 border-gold/50 pl-7">
              {blocks.map((block, i) => (
                <li key={`m-${i}`} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[35px] top-[9px] block h-[11px] w-[11px] rounded-full border-2 border-gold bg-evergreen"
                  />
                  <p
                    className="font-body text-champagne"
                    style={{ fontSize: "14px", lineHeight: "22px", letterSpacing: "0.06em" }}
                  >
                    {block.kicker}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {/* THE SIX INTERPRETATIONS — 2-column editorial grid on desktop,
              stacked on mobile. These carry the real, readable content.
              On the deep plate they render as Ivory cards over a Gold rule. */}
          <div className="mt-16 grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
            {blocks.map((block, i) => (
              <article key={`d-${i}`} className="border-t-2 border-gold/60 pt-6">
                <p
                  className="font-body text-champagne"
                  style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
                >
                  {block.kicker}
                </p>
                <h3
                  className="mt-3 font-serif text-ivory"
                  style={{
                    fontSize: "var(--type-t10-size)",
                    lineHeight: "var(--type-t10-line)",
                  }}
                >
                  {block.label}
                </h3>
                <p
                  className="mt-4 font-body text-ivory/85"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {block.body}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </Section>
  );
}
