// The single canonical brand name — a brand/system token, not narrative copy.
//
// Owner ruling (Addendum 01 copy rulings, ruling 11): "Set for Life" is an
// approved brand token. It does not require a Narrative Library entry merely to
// display the brand name; it is maintained from ONE canonical brand constant so
// the same string never drifts across render sites (web footer, application
// metadata, PDF footer furniture).
//
// Where a compound, already-approved string embeds the brand inside a larger
// title (e.g. report-v1.0.json's "YOUR SET FOR LIFE FINANCIAL SNAPSHOT",
// "Your Set for Life Money Picture"), that string is a WHOLE approved title and
// is NOT decomposed — only the STANDALONE brand mark consumes this constant.

export const BRAND_NAME = "Set for Life";

/**
 * The OFFICIAL, OWNER-SUPPLIED logo — the production asset delivered in
 * `Set_for_Life_Snapshot_Production_Assets_v1` and committed as-is.
 *
 * THE ONE LOGO. The owner's rule for this phase: "Do not recreate, redraw,
 * typeset, or substitute the Set for Life wordmark." So this constant is the
 * single place the official mark's path is written, and the single place any
 * component may obtain it. No component typesets the wordmark, and no second
 * logo asset exists anywhere under `public/`.
 *
 * NOTE — this is the SNAPSHOT's brand mark. The ASSESSMENT shell's
 * `components/assessment/BrandHeader.tsx` renders a TYPESET wordmark ("Set for
 * Life" in Playfair) by an earlier UIUX §5 decision, documented in that file.
 * That remains untouched here: it is a different surface, it is not part of the
 * Snapshot, and changing it would be a redesign of the assessment shell rather
 * than the Snapshot. It is flagged for the owner in the phase report.
 */
export const BRAND_LOGO = {
  src: "/images/snapshot/set-for-life-logo.png",
  /** Intrinsic dimensions of the supplied asset (2048×857), so the layout can
   *  reserve space before it loads. */
  width: 2048,
  height: 857,
  /** Describes the mark for assistive tech. The image itself reads
   *  "SET FOR LIFE / FINANCIAL ASSESSMENT". */
  alt: "Set for Life Financial Assessment",
} as const;
