// THE CONTINUATION CAMPAIGN BLOCK — Section 10 of the Financial Snapshot.
//
// THE SECTION IS PERMANENT; THE CAMPAIGN IS REPLACEABLE. The Snapshot always
// closes with an invitation to continue. WHAT it invites the participant to is
// campaign content, and the owner requires it be swappable WITHOUT redesigning
// the Snapshot:
//
//   "Make campaign fields configurable so a future campaign can replace:
//    eyebrow; headline; body; bullets; button; URL; campaign ID — without
//    redesigning the Snapshot."
//
// So every one of those fields is a value in the object below, and the renderer
// reads ONLY the object. A future campaign is a data change here — or, when the
// campaign is managed operationally, a row this module loads — never an edit to
// a component.
//
// WHERE THIS COPY COMES FROM. Every string below is the owner's approved
// campaign copy, supplied verbatim in the visual-implementation directive
// (2026-10-05) and matching the approved wireframe spec §10, which LOCKED the
// three benefit bullets word-for-word. None of it is authored here, and the
// renderer never re-words, re-orders, or truncates it.
//
// THE CAMPAIGN MUST NOT READ THE PARTICIPANT. This module takes no participant
// input at all. The wireframe spec is explicit that the CTA is an invitation and
// not a diagnosis-driven requirement, and the owner's directive adds: "Do not
// dynamically pressure the participant based on Activation results." A campaign
// whose copy varied with a participant's readiness state would be exactly that
// pressure, so the type here has no field a participant value could flow into —
// the forbidden behaviour is unrepresentable rather than merely avoided.

/** The eyebrow, the working headline, and the three locked benefit bullets. */
export interface SnapshotCampaign {
  /** Stable campaign identifier — used for analytics and future swaps. */
  id: string;
  /** Whether the block renders at all. A campaign can be switched off without
   *  removing its definition, so the section never becomes a dead branch. */
  active: boolean;
  /** The small line above the headline. */
  eyebrow: string;
  /** The working headline. */
  headline: string;
  /** Optional supporting paragraph. Omitted (never faked) when a campaign has
   *  none — the approved masterclass campaign supplies headline + bullets. */
  body?: string;
  /** The benefits, rendered in order. Exactly three in the approved campaign. */
  bullets: readonly string[];
  /** The button label. */
  buttonLabel: string;
  /** Where the button goes. */
  url: string;
}

/**
 * The approved campaign running in the pilot: the Financial Makeover Masterclass.
 *
 * Copy is the owner's, verbatim. The bullet strings are the spec's LOCKED
 * bullets, including the sentence-cased first letter and the absence of closing
 * periods — preserved exactly as approved.
 */
export const MASTERCLASS_CAMPAIGN: SnapshotCampaign = Object.freeze({
  id: "financial_makeover_masterclass",
  active: true,
  eyebrow: "READY TO GO DEEPER?",
  headline:
    "Your Snapshot helped you see the picture. Now let’s help you understand what to do with what you see.",
  bullets: Object.freeze([
    "See your financial picture more clearly",
    "Understand which areas deserve your attention",
    "Learn how to think about your next moves with greater intention",
  ]),
  buttonLabel: "SAVE MY SEAT FOR THE MASTERCLASS",
  url: "https://masterclass.setforlifelive.com/register",
});

/**
 * The campaign to render, or null when none is running.
 *
 * A single accessor so the renderer never reaches past it: when a campaign is
 * replaced (or switched off during a gap between campaigns), only this function
 * changes, and the Snapshot's structure is untouched.
 */
export function activeCampaign(): SnapshotCampaign | null {
  return MASTERCLASS_CAMPAIGN.active ? MASTERCLASS_CAMPAIGN : null;
}
