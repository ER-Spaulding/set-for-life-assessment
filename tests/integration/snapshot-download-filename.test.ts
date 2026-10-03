import { describe, it, expect } from "vitest";

import {
  SNAPSHOT_DOWNLOAD_FILENAME_PATTERN,
  SNAPSHOT_DOWNLOAD_FILENAME_PREFIX,
  snapshotDownloadFilename,
  snapshotDownloadDisposition,
} from "@/lib/snapshot/download-filename";

/**
 * The approved download filename — Addendum 01 v1.1 §8 (owner ruling 2026-10-02).
 *
 * `Set-for-Life-Financial-Snapshot-YYYY-MM-DD.pdf`, where the date is the
 * Snapshot's COMPLETION date (`snapshots.generated_at`), not the current time
 * and not the PDF artifact's own generation timestamp.
 *
 * This guard asserts three invariants:
 *   1. the filename is EXACTLY the approved shape — nothing prepended or
 *      appended, the date is the UTC calendar date of the completion timestamp;
 *   2. the filename cannot carry participant PII — the function accepts ONLY the
 *      timestamp (a name/email/Set for Life Number is not a parameter, and a
 *      name passed as the timestamp yields no filename, not a name-bearing one),
 *      and the pattern rejects any tail that is not four digit-runs;
 *   3. header-injection safety — the output is `[A-Za-z0-9.-]` only, so nothing
 *      can break the `Content-Disposition` header.
 */

describe("snapshotDownloadFilename builds exactly the approved filename", () => {
  it("is the fixed prefix plus the completion date", () => {
    expect(SNAPSHOT_DOWNLOAD_FILENAME_PREFIX).toBe("Set-for-Life-Financial-Snapshot");
    expect(snapshotDownloadFilename("2026-10-02T15:30:00.000Z")).toBe(
      "Set-for-Life-Financial-Snapshot-2026-10-02.pdf",
    );
  });

  it("derives the UTC calendar date, not the server-local day", () => {
    // A timestamp near midnight: the date must be the UTC day of the timestamp.
    expect(snapshotDownloadFilename("2026-10-02T23:59:59Z")).toBe(
      "Set-for-Life-Financial-Snapshot-2026-10-02.pdf",
    );
    // A non-UTC offset normalizes to its UTC instant before the date is read.
    expect(snapshotDownloadFilename("2026-10-02T23:30:00-07:00")).toBe(
      "Set-for-Life-Financial-Snapshot-2026-10-03.pdf",
    );
  });

  it("zero-pads single-digit month and day", () => {
    expect(snapshotDownloadFilename("2026-01-05T00:00:00Z")).toBe(
      "Set-for-Life-Financial-Snapshot-2026-01-05.pdf",
    );
  });
});

describe("the filename is a fixed pattern, exactly and nothing else", () => {
  it("matches the approved pattern on every produced filename", () => {
    for (const ts of [
      "2026-10-02T15:30:00.000Z",
      "2026-01-01T00:00:00Z",
      "2026-12-31T23:59:59Z",
      "2026-06-15T12:00:00+00:00",
    ]) {
      const filename = snapshotDownloadFilename(ts);
      expect(filename, `filename for ${ts}`).toMatch(SNAPSHOT_DOWNLOAD_FILENAME_PATTERN);
    }
  });

  it("the pattern is anchored — a PII-bearing tail cannot slip through", () => {
    // A participant name / email / Set for Life Number anywhere in the filename
    // breaks the `\d{4}-\d{2}-\d{2}` tail and fails the match. These are the
    // strings a regression would have to be caught on.
    const piiBearing = [
      "Set-for-Life-Financial-Snapshot-Jane-Doe-2026-10-02.pdf",
      "Set-for-Life-Financial-Snapshot-2026-10-02-Jane-Doe.pdf",
      "Set-for-Life-Financial-Snapshot-jane@example.com-2026-10-02.pdf",
      "Set-for-Life-Financial-Snapshot-1234-5678-2026-10-02.pdf", // Set for Life Number XXXX-XXXX
      "Jane-Doe-Set-for-Life-Financial-Snapshot-2026-10-02.pdf",
    ];
    for (const candidate of piiBearing) {
      expect(candidate, candidate).not.toMatch(SNAPSHOT_DOWNLOAD_FILENAME_PATTERN);
    }
  });
});

describe("the filename cannot carry participant PII by construction", () => {
  it("accepts only a timestamp — a name passed as the date yields no filename", () => {
    // The function's single input is the completion timestamp. A participant
    // name is not a valid timestamp, so it produces null (no filename), never a
    // name-bearing one.
    expect(snapshotDownloadFilename("Jane Doe")).toBeNull();
    expect(snapshotDownloadFilename("jane@example.com")).toBeNull();
    expect(snapshotDownloadFilename("1234-5678")).toBeNull();
  });

  it("returns null (no invented date) for null, empty, or unparseable input", () => {
    expect(snapshotDownloadFilename(null)).toBeNull();
    expect(snapshotDownloadFilename("")).toBeNull();
    expect(snapshotDownloadFilename("not-a-date")).toBeNull();
    expect(snapshotDownloadFilename("2026-13-99T00:00:00Z")).toBeNull();
  });

  it("rejects an implausible year rather than emit a garbage date", () => {
    // A bare number parses in some engines to a 2000s date; the sanity bound
    // must refuse anything outside a plausible completion window.
    expect(snapshotDownloadFilename("123")).toBeNull();
  });
});

describe("header-injection safety", () => {
  it("the filename is [A-Za-z0-9.-] only — no CR, LF, quote, semicolon, or space", () => {
    for (const ts of ["2026-10-02T15:30:00.000Z", "2026-01-05T00:00:00Z"]) {
      const filename = snapshotDownloadFilename(ts)!;
      expect(filename, filename).toMatch(/^[A-Za-z0-9.-]+$/);
      expect(filename).not.toMatch(/[\r\n";\s\\]/);
    }
  });

  it("the disposition is `attachment` always, with the filename quoted only when derivable", () => {
    expect(snapshotDownloadDisposition("2026-10-02T15:30:00.000Z")).toBe(
      'attachment; filename="Set-for-Life-Financial-Snapshot-2026-10-02.pdf"',
    );
    expect(snapshotDownloadDisposition(null)).toBe("attachment");
    expect(snapshotDownloadDisposition("Jane Doe")).toBe("attachment");
  });
});
