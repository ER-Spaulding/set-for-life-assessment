import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The READ PATH of the snapshot-schema guard.
 *
 * WHY THIS FILE EXISTS.
 *
 * `assertSupportedSchema` was proven only as a UNIT (it throws on an unknown
 * schema) and never through the consumer that actually uses it: `loadSnapshot`.
 * Deleting the single call to it inside `loadSnapshot` passed every test and
 * `tsc`, because no test drove the read path with a payload whose schema this
 * build does not understand.
 *
 * The guard is what makes "an existing immutable Snapshot is never silently
 * reinterpreted" TRUE at read time. Without it, a reader applies current-shape
 * parsing to an old-shape object and produces confidently wrong results. The
 * unit test can pass forever while the call site is gone — the ONLY test that
 * can catch its removal is one that calls `loadSnapshot` with a stored payload
 * at an unsupported schema and asserts it REFUSES.
 *
 * This file drives `loadSnapshot` against an in-memory stub of the Supabase
 * client, exactly as the write-path tests do for `completeSession`.
 */

vi.mock("server-only", () => ({}));

import { loadSnapshot } from "@/lib/session/service";
import { serviceClient } from "@/lib/db/client";
import { SUPPORTED_SNAPSHOT_SCHEMAS } from "@/lib/assessment/versions";

vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  isDatabaseConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

const SESSION_ID = "11111111-2222-3333-4444-555555555555";

/**
 * An in-memory stand-in that serves exactly the two reads `loadSnapshot`
 * performs: the session status read and the Snapshot payload read. The stored
 * payload is whatever the test wants a completed Snapshot to have been written
 * with — the whole point is to round-trip a FOREIGN-shape payload through the
 * real reader.
 */
function fakeDb(storedPayload: unknown) {
  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: () =>
            Promise.resolve({
              data: { session_id: SESSION_ID, status: "completed" },
              error: null,
            }),
        };
        return q;
      }
      if (table === "snapshots") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                snapshot_id: "snap-0001",
                payload_json: storedPayload,
                rendered_payload_json: null,
                report_version: "1.0",
                generated_at: "2026-10-02T00:00:00.000Z",
              },
              error: null,
            }),
        };
        return q;
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return db;
}

beforeEach(() => vi.clearAllMocks());

describe("loadSnapshot refuses a payload whose schema this build does not understand", () => {
  it("REFUSES (throws) a stored payload at an unsupported schema instead of misreading it", async () => {
    // A payload written by a FUTURE build, or by an assembly this build has
    // never seen. `SUPPORTED_SNAPSHOT_SCHEMAS` is ['1.0','1.1']; "99.0" is not
    // among them, so the reader must throw rather than return a view parsed
    // under current assumptions.
    vi.mocked(serviceClient).mockReturnValue(
      fakeDb({ versions: { snapshotSchema: "99.0" } }) as never,
    );

    await expect(loadSnapshot(SESSION_ID)).rejects.toThrow(
      /written by payload schema 99\.0, which this build does not understand/,
    );
    // The refusal names the snapshot, so the failure is actionable.
    await expect(loadSnapshot(SESSION_ID)).rejects.toThrow(/snap-0001/);
  });

  it("the unsupported marker really is unsupported — the test asserts a foreign shape", () => {
    // Self-check: if "99.0" ever joins SUPPORTED_SNAPSHOT_SCHEMAS, the refusal
    // above stops meaning anything, and this makes that impossible to miss.
    expect(SUPPORTED_SNAPSHOT_SCHEMAS).not.toContain("99.0");
  });

  it("ACCEPTS a stored payload at a supported schema — the reader does not refuse everything", async () => {
    // The complementary half. Without it, a loadSnapshot that threw
    // UNCONDITIONALLY would still pass the refusal test above, and the real
    // defect (rejecting a perfectly readable Snapshot) would ship green.
    const stored = {
      versions: { snapshotSchema: "1.1" },
      signals: [
        {
          signal: "DIRECT",
          state: "HEALTHY",
          specialState: null,
          displayState: null,
          narrativeKey: "narrative.DIRECT",
        },
      ],
      connections: [{ code: "DIRECT_TO_GIVING", narrativeKey: "connection.DIRECT" }],
      attentionAreas: ["KEEP_OBSERVING"],
    };
    vi.mocked(serviceClient).mockReturnValue(fakeDb(stored) as never);

    const result = await loadSnapshot(SESSION_ID);

    expect(result).not.toBeNull();
    expect(result!.snapshotId).toBe("snap-0001");
    // The reader renders the stored signals and attention area — i.e. it did
    // NOT throw, so the guard ACCEPTED the supported schema.
    expect(result!.signals).toHaveLength(1);
    expect(result!.signals[0].narrativeKey).toBe("narrative.DIRECT");
    expect(result!.attentionArea).toBe("KEEP_OBSERVING");
  });

  it("ACCEPTS a legacy 1.0-shaped payload — reading history is not refusal", async () => {
    // A pre-marker Snapshot was written by the 1.0 assembler and must stay
    // readable. This pins the ACCEPTING direction for the legacy case too, so a
    // future guard tightening that would refuse historical data is caught.
    vi.mocked(serviceClient).mockReturnValue(
      fakeDb({
        versions: { snapshotSchema: "1.0" },
        signals: [],
        connections: [],
        attentionAreas: ["KEEP_OBSERVING"],
      }) as never,
    );

    const result = await loadSnapshot(SESSION_ID);
    expect(result).toMatchObject({ snapshotId: "snap-0001" });
    expect(result!.attentionArea).toBe("KEEP_OBSERVING");
  });
});
