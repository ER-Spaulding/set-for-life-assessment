// Addendum 01 v1.1 §8 — the approved download filename (owner ruling 2026-10-02).
//
// The participant-facing download filename is EXACTLY:
//
//     Set-for-Life-Financial-Snapshot-YYYY-MM-DD.pdf
//
// where YYYY-MM-DD is the Snapshot's COMPLETION date — the UTC calendar date of
// `snapshots.generated_at`, the authoritative completion timestamp. It is NOT
// the current time and NOT the PDF artifact's `snapshot_documents.generated_at`
// (that is when the PDF was re-rendered, which can differ from when the
// Snapshot completed and would make the filename unstable across a retry).
//
// PII IS STRUCTURALLY ABSENT. This module takes one input — the completion
// timestamp — and emits the fixed prefix plus the date's digits. There is no
// parameter and no code path through which a participant name, email address,
// Set for Life Number, session id, or document id can reach the output. The
// approved pattern is a closed form: anything interpolated other than four
// digit-runs breaks it, which is what the guard test asserts.
//
// HEADER-INJECTION SAFETY IS STRUCTURAL. The filename is emitted verbatim into
// a `Content-Disposition` header. The date is reconstructed from validated
// integers (year/month/day pulled off a parsed Date and re-printed with
// zero-padding), so the output is guaranteed to match /^\d{4}-\d{2}-\d{2}$/
// between the fixed prefix and the `.pdf` suffix. No CR, no LF, no quote, no
// semicolon, no whitespace, no non-ASCII byte can appear — there is nothing in
// the output a caller could smuggle into.

/** The fixed, approved filename prefix (owner ruling 2026-10-02). */
export const SNAPSHOT_DOWNLOAD_FILENAME_PREFIX = "Set-for-Life-Financial-Snapshot";

/**
 * The approved filename pattern, exactly and nothing else. Exposed so the guard
 * can assert the route never emits a filename that is not this shape — a name,
 * email, or Set for Life Number interpolated into the filename breaks the
 * `\d{4}-\d{2}-\d{2}` tail and fails the match.
 */
export const SNAPSHOT_DOWNLOAD_FILENAME_PATTERN =
  /^Set-for-Life-Financial-Snapshot-\d{4}-\d{2}-\d{2}\.pdf$/;

/**
 * Build the approved download filename from the Snapshot completion timestamp
 * (`snapshots.generated_at`, an ISO-8601 string). Returns null when a date
 * cannot be derived, so the caller omits the filename rather than invent a
 * wrong date (a completed Snapshot always has `generated_at` — `snapshots`
 * declares it NOT NULL — so null is a defensive, never-in-production path).
 */
export function snapshotDownloadFilename(generatedAt: string | null): string | null {
  if (!generatedAt) return null;

  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) return null;

  const yyyy = parsed.getUTCFullYear();
  // A sanity bound, not a business rule: it rejects an unparseable-but-coercible
  // input (e.g. a bare number) that `Date` would otherwise accept, and caps the
  // output to a fixed, plausible width.
  if (yyyy < 2000 || yyyy > 9999) return null;

  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");

  return `${SNAPSHOT_DOWNLOAD_FILENAME_PREFIX}-${yyyy}-${mm}-${dd}.pdf`;
}

/**
 * The exact `Content-Disposition` value the download route emits for a derivable
 * completion date. `attachment` is preserved always; the filename is appended,
 * quoted, only when `snapshotDownloadFilename` produced one. Because the
 * filename is guaranteed to contain no quote, CR, or LF, quoting is safe.
 */
export function snapshotDownloadDisposition(generatedAt: string | null): string {
  const filename = snapshotDownloadFilename(generatedAt);
  return filename ? `attachment; filename="${filename}"` : "attachment";
}
