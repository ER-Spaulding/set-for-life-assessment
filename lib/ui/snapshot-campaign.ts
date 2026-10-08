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
// campaign copy for the Girl, I Got You Masterclass, verbatim from the
// approved sample Snapshot §10 (narrative-rewrite standard, 2026-10-07),
// which superseded the pilot's Financial Makeover copy (the URL is unchanged
// by Owner decision). None of it is authored here, and the renderer never
// re-words, re-orders, or truncates it.
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
   *  none — the current campaign supplies body + bullets. */
  body?: string;
  /** The benefits, rendered in order. Exactly three in the approved campaign. */
  bullets: readonly string[];
  /** The button label. */
  buttonLabel: string;
  /** Where the button goes. */
  url: string;
}

/**
 * The approved campaign: the Girl, I Got You Masterclass (sample §10).
 *
 * Copy is the owner's, verbatim from the approved sample — headline, body,
 * the three benefit bullets (sentence-cased first letters, no closing
 * periods), and the button label. Same registration URL as the pilot
 * campaign, per Owner decision (plan D10).
 */
export const MASTERCLASS_CAMPAIGN: SnapshotCampaign = Object.freeze({
  id: "girl_i_got_you_masterclass",
  active: true,
  eyebrow: "READY TO GO DEEPER?",
  headline: "Girl, I Got You.",
  body:
    "Your Snapshot showed you the pattern. The Girl, I Got You Masterclass is where " +
    "we help you go deeper—so you can better understand what your financial picture " +
    "is telling you and begin thinking more intentionally about what comes next.",
  bullets: Object.freeze([
    "See which part of your financial picture deserves your attention first",
    "Understand why knowing more does not always create more movement",
    "Think about your next financial decisions without trying to fix everything at once",
  ]),
  buttonLabel: "SAVE MY SEAT FOR THE GIRL, I GOT YOU MASTERCLASS",
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
