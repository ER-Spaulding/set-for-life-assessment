// Canonical UI/system copy for the Financial Snapshot surface.
//
// These are UI STATE strings and call-to-action labels — not narrative copy, so
// they deliberately live OUTSIDE config/narratives-v1.0.json (the state-keyed
// narrative library) and outside config/report-v1.0.json (the structural screen
// config). Keeping them in ONE module prevents the same button label or loading
// line from being re-authored independently across components.

/** Loading state shown while the server resolves the stored Snapshot payload.
 *  The ellipsis is U+2026 — NOT three dots (owner ruling 1, approved as-is). */
export const LOADING_COPY = "Preparing your Snapshot…";

/** Module 12 — the approved download call-to-action label. */
export const DOWNLOAD_CTA = "DOWNLOAD MY FINANCIAL SNAPSHOT";
