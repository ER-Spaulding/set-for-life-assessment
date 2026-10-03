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
