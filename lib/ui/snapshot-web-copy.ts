// THE WEB SNAPSHOT'S OWN PARTICIPANT-FACING COPY — the hero, the short section
// intros, and the Section 11 utility block.
//
// ⚠️ PROVENANCE IS NOT UNIFORM IN THIS FILE — READ THE PER-CONSTANT NOTES.
//
//   GROUP A — OWNER-SUPPLIED, VERBATIM. The hero copy (§1), the Section 10
//   campaign (see lib/ui/snapshot-campaign.ts), and the Section 11 heading/body/
//   CTA were supplied word-for-word in the owner's visual-implementation
//   directive of 2026-10-05 and are reproduced exactly. These are approved.
//
//   GROUP B — NEWLY DRAFTED, NOT YET APPROVED BY THE OWNER. The short section
//   INTROS (Big Picture kicker, Money Picture, Strengths, Friction, Destination,
//   Readiness, Attention) are NOT owner-supplied copy. The wireframe spec gives
//   each section a SUGGESTED WORD COUNT for an intro and, in §7, marks its
//   framing line "optional" — it does not supply the words. Those strings were
//   drafted to fill the spec's suggested slots so the owner can review a
//   complete layout, and they are marked `DRAFT — NEEDS OWNER APPROVAL` below.
//   They are isolated in this one module precisely so they are trivial to
//   replace, and every one of them is listed in the phase report as an open
//   implementation choice. Nothing in Group B is presented to the owner as
//   approved language.
//
// WHY A MODULE AND NOT LITERALS IN THE COMPONENTS. Two independent rules force
// this.
//
//   1. THE COPY-PROVENANCE RULE. This project pins participant-facing language
//      to canonical modules, and a guard test
//      (tests/integration/snapshot-resolution-single-source.test.ts) scans
//      app/, components/ and lib/ for approved narrative strings appearing as
//      inline literals. Copy authored inside a renderer is copy that no test can
//      find and no ruling can trace. Every string below has ONE home.
//
//   2. THE STRING-MEMBERSHIP GUARD. The web render is walked node by node and
//      every text node and participant-visible attribute must be accountable to
//      the shared section model OR to an enumerated chrome source
//      (tests/integration/snapshot-web-string-membership.test.ts). That guard's
//      chrome list is built from canonical constants — so this copy must BE
//      canonical constants to be attributable at all.
//
// WHAT DOES *NOT* BELONG HERE. Anything the resolver produces from the payload
// (signal states, connection statements, attention areas, activation copy,
// destination themes) and anything the report config owns (the eight section
// headings, the cover lead). Those arrive through the shared section model. This
// module holds ONLY the web page's own fixed chrome.

// ---------------------------------------------------------------------------
// GROUP A — owner-supplied, verbatim
// ---------------------------------------------------------------------------

/**
 * §1 — the conceptual line, verbatim from the owner's directive.
 */
export const HERO_CONCEPTUAL_LINE = "One answer is a detail. Together, they make a picture.";

/** §1 — the transition cue into the picture itself, verbatim. */
export const HERO_TRANSITION_CUE = "SEE MY PICTURE";

/**
 * §1 — the personalization line.
 *
 * "Prepared for {FIRST_NAME}" is the SAME approved personalization the PDF cover
 * uses, so it is not re-authored: this re-exports the one implementation from
 * lib/ui/snapshot-doc-copy.ts. A second copy of this string is how the web and
 * the PDF would drift apart on a ruling change.
 */
export { preparedForLine as heroGreetingLine } from "./snapshot-doc-copy";

/** §11 — the heading, verbatim from the owner's directive. */
export const KEEP_SNAPSHOT_HEADING = "KEEP YOUR SNAPSHOT";

/** §11 — the supporting line, verbatim from the owner's directive. */
export const KEEP_SNAPSHOT_BODY =
  "Download your personalized Set for Life Financial Snapshot to save, review, or bring with you to a future financial conversation.";

// ---------------------------------------------------------------------------
// GROUP B — DRAFT, NEEDS OWNER APPROVAL
//
// Each constant below fills a slot the wireframe spec describes only as a word
// COUNT. They are drafts. The owner should either approve, replace, or delete
// them; the layout renders correctly with every one of them removed, so deleting
// any or all is a safe operation that needs no component change.
// ---------------------------------------------------------------------------

/**
 * DRAFT — NEEDS OWNER APPROVAL. The §2 subhead.
 *
 * Spec §2 names four parts (Overall Picture / What's Working / Where There's
 * Friction / Worth Noticing). The stored payload cannot bind content to those
 * names — `bigPicture.parts` is an unlabelled ordered list of synthesis
 * sentences — so this renders the one subhead that is always true of the prose
 * beneath it. See components/snapshot/BigPictureSection.tsx for the full
 * reasoning and for the payload change that would be required to render all
 * four literally.
 */
export const BIG_PICTURE_OVERALL_LABEL = "Overall Picture";

/** DRAFT — NEEDS OWNER APPROVAL. §3 intro (spec suggests 25–45 words). */
export const MONEY_PICTURE_INTRO =
  "Six questions, six parts of one picture. They are not a score, and none of them outranks another — read them together, and you are looking at how your financial life currently works.";

/** §3 — the label at the centre of the map. Spec-supplied ("YOU in the
 *  center"), not drafted. */
export const MONEY_PICTURE_CENTER_LABEL = "YOU";

/** DRAFT — NEEDS OWNER APPROVAL. §4 intro (spec suggests 20–30 words). */
export const STRENGTHS_INTRO =
  "These are the parts of your financial life that are already carrying weight for you — the ground you can build on.";

/** DRAFT — NEEDS OWNER APPROVAL. §5 intro (spec suggests 20–30 words). */
export const FRICTION_INTRO =
  "These are the places where things are tighter, less consistent, or harder to hold together. Naming them is not a judgment.";

/** DRAFT — NEEDS OWNER APPROVAL. §7 framing (spec marks this line "optional",
 *  suggests 15–25 words). */
export const DESTINATION_INTRO =
  "These are the words you chose for what “Set for Life” means to you. They are shown as you selected them — nothing here is ranked.";

/** DRAFT — NEEDS OWNER APPROVAL. §8 intro (spec suggests 18–30 words). */
export const READINESS_INTRO =
  "Four separate dimensions, each measured on its own. They are never averaged into a single score, because they do not move together.";

/** DRAFT — NEEDS OWNER APPROVAL. §9 framing (spec suggests 18–30 words). */
export const ATTENTION_INTRO =
  "This is where your responses suggest the most value in looking closer next — an area to examine, not a recommendation to act.";

/** DRAFT — NEEDS OWNER APPROVAL. §6 sub-label under the stacked Connection
 *  heading. The report config owns the full title; this names the second half
 *  when the layout splits it across two lines. */
export const CONNECTION_SUBLABEL = "HERE’S THE PART WORTH NOTICING";

/**
 * DRAFT — NEEDS OWNER APPROVAL. The editorial PAUSE between the last
 * interpretation module and the continuation campaign at the end of the page.
 *
 * ⚠️ READ THIS BEFORE TREATING THE COPY AS APPROVED — AND BEFORE ASSUMING THE
 * SECTION IS WHAT THE BRIEF DESCRIBED IT AS.
 *
 * The refinement brief asks to rework "the current 'Turn Information Into
 * Action' treatment" into "a deliberate editorial pause between interpretation
 * and continuation", keeping the "understanding → movement" bridge.
 *
 * THERE IS NO SUCH BLOCK IN THE BUILD, AND "TURN INFORMATION INTO ACTION" IS
 * NOT ONE. That string is a §9 ATTENTION-AREA label — it is the value of
 * `attention_areas.TURN_INFORMATION_INTO_ACTION` in the narrative library, and
 * it renders as the primary label INSIDE Section 9, beneath "ONE AREA WORTH
 * EXAMINING NEXT". It is participant-specific content, produced by the resolver
 * from the participant's own answers; it is not page chrome, it is not a
 * transition, and it cannot be reworked into one. Two other attention labels
 * ("BUILD DECISION CONFIDENCE", "SEE IT MORE CLEARLY") appear in the same slot
 * for other participants.
 *
 * What the brief is asking FOR — a designed pause before the campaign, so the
 * page does not jump straight from diagnosis to invitation — is a real gap and
 * is worth closing. This constant closes it. But the words below are DRAFTED
 * HERE to fill a slot the spec never supplied, exactly like Group B above: they
 * are NOT owner-supplied, NOT approved, and NOT a rework of anything that
 * existed. The layout renders correctly with this constant removed.
 *
 * The bridge is deliberately non-promotional: it does not mention the
 * Masterclass, it makes no offer, and it does not point forward to a product.
 * It states the transition the brief names (understanding → movement) and stops,
 * so it cannot read as pressure on a participant the engine judged less ready.
 */
export const ACTION_TRANSITION_STATEMENT =
  "You have the picture. What you do with it is the part that changes things.";

/** §12 — the footer's own label above the disclosure. UI chrome, not narrative.
 *  The disclosure itself is NOT here: it is fixed-by-ruling document furniture
 *  in lib/ui/snapshot-doc-copy.ts, where the PDF reads the same string. */
export const FOOTER_DISCLOSURE_LABEL = "IMPORTANT DISCLOSURE";
