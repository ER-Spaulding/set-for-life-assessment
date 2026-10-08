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
//   GROUP B — RETIRED. The short section INTROS moved to the governed
//   `section_intros` family in config/narratives-v1.0.json with the 2026-10-07
//   Owner narrative-rewrite standard (plan D7 / §13); the DRAFT constants are
//   gone. What remains in this file is layout furniture (the Money Picture
//   centre label, the Connection sub-label, the footer's disclosure label) and
//   the Owner's APPROVED sample chrome below (§9 transition, §11 download,
//   §12 closing) — verbatim from the approved sample Snapshot in the brief.
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

/** §11 — the supporting line, verbatim from the Owner's approved sample §11. */
export const KEEP_SNAPSHOT_BODY =
  "Your Snapshot is a picture of where things stand right now. "
  + "It is not a grade. It is not a permanent label. And it is not a prediction of "
  + "where you will end up. Download your copy so you can revisit it later, notice "
  + "what changes, or bring it with you into a future financial conversation.";

// ---------------------------------------------------------------------------
// GROUP B — CHROME CONSTANTS
//
// RETIRED 2026-10-07 (Owner narrative-rewrite standard, plan D7 / §13): the six
// section intros and the Big Picture subhead were DRAFT constants here — ad-hoc
// copy beside React-adjacent chrome, which §13 forbids once real copy exists.
// They now live in the governed `section_intros` / `big_picture` families in
// config/narratives-v1.0.json and reach both renderers through the shared
// section model (`section.intro`, `block.label`). Nothing in this file may
// reintroduce participant-facing narrative copy: chrome here is limited to
// fixed furniture the model does not carry.
// ---------------------------------------------------------------------------

/** §3 — the label at the centre of the map. Spec-supplied ("YOU in the
 *  center"), not drafted. Layout furniture, not narrative copy. */
export const MONEY_PICTURE_CENTER_LABEL = "YOU";

/** §6 sub-label under the stacked Connection heading. The report config owns
 *  the full title; this names the second half when the layout splits it across
 *  two lines. Layout furniture, not narrative copy. */
export const CONNECTION_SUBLABEL = "HERE’S THE PART WORTH NOTICING";

/**
 * §9 — THE EDITORIAL PAUSE between the last interpretation module and the
 * continuation campaign. Owner sample §9, VERBATIM (approved narrative-rewrite
 * standard, 2026-10-07) — these lines replaced the earlier draft. The block is
 * deliberately non-promotional: no campaign copy, no offer, no product mention,
 * no onward link; the component takes no props, so it cannot vary with an
 * assessment result. History: the refinement brief asked to rework "Turn
 * Information Into Action" — that string is a §9 attention-AREA label
 * (participant content, not chrome), so the pause became its own block.
 */
export const ACTION_TRANSITION_LINES = [
  "You have the picture. Now the question becomes what you do with what you can see.",
  "You do not need to solve your entire financial life today.",
  "But clarity becomes much more valuable when you know how to use it.",
] as const;

/** §12 — the closing brand moment, Owner sample §12 VERBATIM (same standard). */
export const CLOSING_LINES = [
  "A richer you lives here.",
  "Clarity gives you somewhere to begin.",
  "What happens next is yours to decide.",
] as const;

/** §12 — the footer's own label above the disclosure. UI chrome, not narrative.
 *  The disclosure itself is NOT here: it is fixed-by-ruling document furniture
 *  in lib/ui/snapshot-doc-copy.ts, where the PDF reads the same string. */
export const FOOTER_DISCLOSURE_LABEL = "IMPORTANT DISCLOSURE";
