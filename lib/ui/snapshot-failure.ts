// The Snapshot page's two failure states, and the approved copy for each.
//
// WHY TWO STATES, AND WHY THEY MUST NOT SHARE COPY. The route returns 403 when
// the assessment is genuinely incomplete (or the session is unknown); "Your
// Snapshot is prepared once all required assessment questions are complete" is
// TRUE for that participant. But a COMPLETED session whose payload write was
// interrupted surfaces as a 500, and telling that participant to finish their
// questions is a falsehood — they answered everything. Collapsing the two into
// one branch is exactly the bug this module exists to prevent.

export type SnapshotFailureStatus = "unavailable" | "error";

/**
 * The failure status a failed Snapshot load maps to.
 *
 * 403 -> "unavailable" (genuinely not ready yet). Anything else non-OK -> "error"
 * (a server-side problem, not a missing answer).
 */
export function statusForFailedResponse(httpStatus: number): SnapshotFailureStatus {
  return httpStatus === 403 ? "unavailable" : "error";
}

export interface SnapshotFailureCopy {
  headline: string;
  body: string;
}

/**
 * Approved copy for the two failure states. Deliberately no internal code,
 * error code, or session identifier — §24 forbids diagnostic vocabulary here.
 */
export const UNAVAILABLE_COPY: SnapshotFailureCopy = {
  headline: "Your Snapshot is not available yet.",
  body: "Your Snapshot is prepared once all required assessment questions are complete.",
};

/** A server problem, not a missing answer — so it never claims questions are open. */
export const SERVER_ERROR_COPY: SnapshotFailureCopy = {
  headline: "We could not prepare your Snapshot.",
  body: "Please try again.",
};

/**
 * An EXPIRED assessment — owner ruling 2026-10-03.
 *
 * WHY THIS IS SEPARATE FROM `UNAVAILABLE_COPY`. That copy says the Snapshot "is
 * not available YET" and that it arrives "once all required questions are
 * complete". For an incomplete, still-resumable participant both are true, and
 * that is the state `UNAVAILABLE_COPY` is for. For an EXPIRED assessment neither
 * is: the questions may all be answered, and this session will never produce a
 * Snapshot. Sending an expired participant back to finish their questions would
 * point them at a session that cannot complete.
 *
 * THE OWNER'S WORDS, VERBATIM. Do not reword these strings, and do not author a
 * further Snapshot-error narrative for expiration.
 *
 * APOSTROPHE CODE POINT — a deliberate, stated choice. The ruling's text uses
 * U+2019 (’), but this repository's rendered participant copy uses the ASCII
 * apostrophe throughout — e.g. lib/ui/human-questions.ts's "How clearly do
 * today's financial decisions connect to the future you want?" — while U+2019
 * appears nowhere in shipped participant strings. This file therefore uses
 * U+0027 so the new copy matches the established voice rather than introducing
 * a mixed-invisible-character inconsistency. The trademark symbol is kept
 * exactly as ruled: Money Picture™ (U+2122).
 *
 * THE NAME IS A TEMPLATE, resolved by `expiredFreshStartGreeting()` below. The
 * owner's copy opens "Welcome back, {First Name}." — the name is DROPPED, never
 * replaced with placeholder text, when no verified name is available. That is
 * the pattern `frame5()` in lib/ui/reveal-copy.ts already established, and it is
 * what Addendum 02 §3.2/§15 require: no name before it is reliably associated
 * with the participant.
 */
export const EXPIRED_FRESH_START_COPY = {
  greetingTemplate: "Welcome back, {First Name}.",
  body:
    "It's been a little while since you started your last assessment, and " +
    "financial circumstances can change. Let's start fresh so your Set for Life " +
    "Money Picture™ reflects where you are today.",
  cta: "START MY CURRENT ASSESSMENT",
} as const;

/**
 * The greeting, with the name when one is known.
 *
 * When `firstName` is null the sentence renders WITHOUT the name prefix — the
 * name is dropped, not substituted. No new copy is authored for that case.
 */
export function expiredFreshStartGreeting(firstName: string | null): string {
  if (!firstName) return EXPIRED_FRESH_START_COPY.greetingTemplate.replace("Welcome back, ", "Welcome back.");
  return EXPIRED_FRESH_START_COPY.greetingTemplate.replace("{First Name}", firstName);
}

/**
 * Where the expired CTA sends the participant: the approved returning entry,
 * which resolves the Set of Life Number, verifies identity, and starts the
 * current assessment. The reveal holds a session and no verified identity, so
 * the verification that legitimately yields a name happens there.
 */
export const FRESH_START_HREF = "/assessment/returning";
