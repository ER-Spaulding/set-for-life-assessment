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
