import { describe, it, expect, vi, beforeEach } from "vitest";
import { decideResponseWrite, mayProduceSnapshot } from "@/lib/session/lifecycle";

/**
 * Save My Progress, exercised end-to-end as a LIFECYCLE concept.
 *
 * WHY THIS FILE EXISTS. `assessment-lifecycle.test.ts` proves the state machine
 * (the 7/30-day boundaries, resumability, expiration) but pins the
 * saved-vs-unsaved distinction only as SOURCE TEXT — it matches
 * `participantHasVerifiedContact` and `saved,` in sweep.ts. A regex over that
 * file passes while `participantHasVerifiedContact` returns the wrong answer,
 * which is exactly the class of false green this repo has been bitten by. This
 * file RUNS the sweep and the claim route against a stubbed database and asserts
 * on the `saved` value and the HTTP contract that a caller actually sees.
 *
 * The durable record of "I used Save My Progress" is a `participant_contacts`
 * row with a non-null `verified_at`. The sweep derives saved-vs-unsaved from
 * that one fact (participantHasVerifiedContact) — there is deliberately no
 * second `saved` flag to drift from the contact row.
 */

const m = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  recordEvent: vi.fn((_e: RecordedLifecycleEvent) => Promise.resolve(true)),
  recordEventInBackground: vi.fn(),
  sendVerificationEmail: vi.fn(() => Promise.resolve({ sent: true, id: "test-id" })),
  queryIfEmailBelongsToAnother: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  isDatabaseConfigured: () => true,
  getServiceClient: vi.fn(),
  serviceClient: m.serviceClient,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));
vi.mock("@/lib/analytics/write", () => ({
  recordEvent: m.recordEvent,
  recordEventInBackground: m.recordEventInBackground,
}));
vi.mock("@/lib/email/verification", () => ({
  sendVerificationEmail: m.sendVerificationEmail,
}));
// The claim route only needs the read-only conflict probe; mocking it keeps the
// heavy scoring graph out of this test without touching the route's
// merge-vs-refuse decision, which is the behaviour under test.
vi.mock("@/lib/session/provisional", () => ({
  queryIfEmailBelongsToAnother: m.queryIfEmailBelongsToAnother,
}));

// issueVerificationToken HMAC-signs with REMINDER_LINK_SECRET and throws when
// unset. A clearly-fake, test-only literal (the real value lives in the env).
process.env.REMINDER_LINK_SECRET = "test-only-not-a-real-secret";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const agoIso = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const PID = "11111111-1111-4111-8111-111111111111";

interface SessionRow {
  session_id: string;
  participant_id: string;
  status: string;
  last_activity_at: string;
  current_position: number;
}

/**
 * A `participant_contacts` row as it exists in the database. A row may exist
 * and still be UNVERIFIED (`verified_at` null), which is NOT the same as having
 * no contact row at all — and only the first is the interesting case.
 */
interface ContactRow {
  contact_id: string;
  verified_at: string | null;
}

/**
 * The event `runSweep` passes to `recordEvent` — the shape the mock's
 * `.mock.calls` will be read back as. Declared so the mock's call tuple is
 * non-empty and its elements (`eventName`, `sessionId`, `payload.saved`) are
 * typed rather than inferred as `any`/`[]`.
 */
interface RecordedLifecycleEvent {
  eventName: "assessment_abandoned" | "assessment_expired";
  participantId: string;
  sessionId: string;
  payload: {
    position: number;
    stage?: string;
    saved: boolean;
  };
}

/**
 * A `participant_contacts` row joined with its `participant_id`, read back by
 * column name. The index signature is the honest model of what this fake does:
 * it applies whatever column `eq`/`not` name at runtime, so the row really is
 * indexable by an arbitrary string, and the value is always `string | null`.
 */
type ParticipantContactRow = {
  participant_id: string;
  contact_id: string;
  verified_at: string | null;
  [column: string]: string | null | undefined;
};

/**
 * A chainable fake for the sweep's Supabase calls:
 *   assessment_sessions: select→in (the incomplete-session query) and
 *                       update→eq→eq (the transition write);
 *   participant_contacts: select→eq→not→maybeSingle (the verified-contact probe).
 *
 * The contact probe APPLIES the query it is handed instead of returning
 * pre-filtered rows. A stub that ignores the filter arguments cannot tell
 * `.not('verified_at', 'is', null)` from `.not('contact_id', 'is', null)` —
 * the arguments never reach it — so a probe pointed at the wrong column reads
 * as a pass. Here the stored row is matched against the column the query
 * actually named, and the filterless shape (`.not` dropped) returns the row on
 * `participant_id` alone, exactly as the database would.
 */
function sweepDb(
  sessions: SessionRow[],
  contactsByParticipant: Record<string, ContactRow | null>,
) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: sessions, error: null }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => {
                updates.push(payload);
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "participant_contacts") {
        return {
          select: () => ({
            eq: (eqCol: string, eqVal: unknown) => {
              // The filterless shape — `.not` dropped from the production chain.
              // Supabase returns every row matching the `eq` filter, verified or not.
              const resolve = () => {
                const rows = Object.entries(contactsByParticipant)
                  .map(([participant_id, row]): ParticipantContactRow | null =>
                    row ? { participant_id, ...row } : null,
                  )
                  .filter((r): r is ParticipantContactRow => r !== null)
                  .filter((r) => r[eqCol] === eqVal);
                return Promise.resolve({ data: rows[0] ?? null, error: null });
              };
              const not = (notCol: string, op: string, operand: unknown) => {
                if (op !== "is" || operand !== null) {
                  throw new Error(`sweepDb: unsupported filter .not(${notCol}, ${op})`);
                }
                return {
                  maybeSingle: () => {
                    const rows = Object.entries(contactsByParticipant)
                      .map(([participant_id, row]): ParticipantContactRow | null =>
                        row ? { participant_id, ...row } : null,
                      )
                      .filter((r): r is ParticipantContactRow => r !== null)
                      .filter((r) => r[eqCol] === eqVal)
                      // `verified_at IS NOT NULL`: the column the query NAMED is
                      // the one read, so pointing it at another column is a miss.
                      .filter((r) => r[notCol] !== null);
                    return Promise.resolve({ data: rows[0] ?? null, error: null });
                  },
                };
              };
              return { not, maybeSingle: resolve };
            },
          }),
        };
      }
      throw new Error(`sweepDb: unexpected table ${table}`);
    },
  };
  return { db, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.queryIfEmailBelongsToAnother.mockResolvedValue(false);
});

describe("the sweep derives `saved` from the verified contact", () => {
  it("records saved=true and saved=false for the SAME abandonment — countable apart", async () => {
    const { runSweep } = await import("@/lib/session/sweep");

    const saved: SessionRow = {
      session_id: "s-saved",
      participant_id: "p-saved",
      status: "in_progress",
      last_activity_at: agoIso(10),
      current_position: 5,
    };
    const unsaved: SessionRow = {
      session_id: "s-unsaved",
      participant_id: "p-unsaved",
      status: "in_progress",
      last_activity_at: agoIso(10),
      current_position: 5,
    };

    const { db } = sweepDb([saved, unsaved], {
      "p-saved": { contact_id: "c-1", verified_at: "2026-09-20T12:00:00.000Z" },
      // A contact row EXISTS but was never verified: not saved.
      "p-unsaved": { contact_id: "c-2", verified_at: null },
    });
    m.serviceClient.mockReturnValue(db);

    await runSweep(NOW);

    const events = m.recordEvent.mock.calls.map((c) => c[0]);
    const bySession = Object.fromEntries(events.map((e) => [e.sessionId, e]));

    expect(events).toHaveLength(2);
    expect(bySession["s-saved"].eventName).toBe("assessment_abandoned");
    expect(bySession["s-saved"].payload.saved).toBe(true);
    expect(bySession["s-unsaved"].eventName).toBe("assessment_abandoned");
    expect(bySession["s-unsaved"].payload.saved).toBe(false);

    // The operator's requirement in one assertion: a saved abandonment and an
    // unsaved abandonment must be countable apart.
    expect(bySession["s-saved"].payload.saved).not.toBe(
      bySession["s-unsaved"].payload.saved,
    );
  });

  it("a saved abandonment stays abandoned — never expired, never terminal", async () => {
    const { runSweep } = await import("@/lib/session/sweep");

    const saved: SessionRow = {
      session_id: "s-saved",
      participant_id: "p-saved",
      status: "in_progress",
      last_activity_at: agoIso(10),
      current_position: 8,
    };

    const { db, updates } = sweepDb([saved], {
      "p-saved": { contact_id: "c-1", verified_at: "2026-09-20T12:00:00.000Z" },
    });
    m.serviceClient.mockReturnValue(db);

    await runSweep(NOW);

    // The verified contact changes the `saved` flag, NOT the lifecycle phase:
    // the transition target is `abandoned`, never `expired`.
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("abandoned");

    // And the emitted event is abandonment, not expiration.
    expect(m.recordEvent).toHaveBeenCalledTimes(1);
    const recorded = m.recordEvent.mock.calls[0][0];
    expect(recorded.eventName).toBe("assessment_abandoned");
    expect(recorded.eventName).not.toBe("assessment_expired");
    expect(recorded.payload.saved).toBe(true);

    // `abandoned` is resumable and non-terminal — the same rule the response
    // and completion routes consult. Saved does not make it expired or terminal.
    const write = decideResponseWrite("abandoned");
    expect(write.allowed).toBe(true);
    expect(write.allowed && write.resumeTo).toBe("in_progress");
    expect(mayProduceSnapshot("abandoned")).toBe(true);
  });

  it("saved=false when a contact row exists but was never VERIFIED", async () => {
    const { runSweep } = await import("@/lib/session/sweep");

    // The two fixture sessions above cover verified vs NO ROW. This covers the
    // third state a real database has — a row whose verified_at is NULL, i.e.
    // Save My Progress was started and the link never clicked. It was the
    // earlier version of this file's own fake that hid the distinction: it
    // returned pre-filtered rows and ignored the query, so the probe's
    // `verified_at IS NOT NULL` filter was untested. The fake now applies the
    // filter, and this case pins the fact it exists for.
    const halfSaved: SessionRow = {
      session_id: "s-half",
      participant_id: "p-half",
      status: "in_progress",
      last_activity_at: agoIso(10),
      current_position: 5,
    };

    const { db } = sweepDb([halfSaved], {
      "p-half": { contact_id: "c-3", verified_at: null },
    });
    m.serviceClient.mockReturnValue(db);

    await runSweep(NOW);

    const events = m.recordEvent.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(1);
    expect(events[0].payload.saved).toBe(false);
  });
});

describe("the claim route refuses an identity conflict instead of merging", () => {
  const claimRequest = (body: unknown) =>
    new Request("http://x/api/participant/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns 409 EMAIL_IN_USE when the email belongs to a DIFFERENT participant", async () => {
    m.queryIfEmailBelongsToAnother.mockResolvedValue(true);
    const { POST } = await import("@/app/api/participant/claim/route");

    const res = await POST(
      claimRequest({ participantId: PID, firstName: "Ada", email: "ada@example.com" }),
    );
    const body = await res.json();

    console.log("  409 body:", JSON.stringify(body));
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("EMAIL_IN_USE");

    // Refusing is a clean stop: no verification link and no analytics event.
    expect(m.sendVerificationEmail).not.toHaveBeenCalled();
    expect(m.recordEventInBackground).not.toHaveBeenCalled();
  });

  it("consults the record server-side with the NORMALISED email before sending", async () => {
    m.queryIfEmailBelongsToAnother.mockResolvedValue(false);
    const { POST } = await import("@/app/api/participant/claim/route");

    const res = await POST(
      claimRequest({ participantId: PID, firstName: "Ada", email: "MixedCase@Example.COM" }),
    );
    expect(res.status).toBe(202);
    expect(m.queryIfEmailBelongsToAnother).toHaveBeenCalledWith(
      PID,
      "mixedcase@example.com",
    );
  });

  it("records save_progress_used server-side with NO name, NO email, NO content", async () => {
    m.queryIfEmailBelongsToAnother.mockResolvedValue(false);
    const { POST } = await import("@/app/api/participant/claim/route");

    const res = await POST(
      claimRequest({ participantId: PID, firstName: "Ada", email: "ada@example.com" }),
    );
    expect(res.status).toBe(202);

    // The exact object the route passed: two correlators and nothing else. There
    // is no payload at all, so there is no key through which a name, email, or
    // participant-entered value could arrive. Asserting the exact call pins this
    // harder than a "does not contain X" sweep ever could.
    expect(m.recordEventInBackground).toHaveBeenCalledTimes(1);
    expect(m.recordEventInBackground).toHaveBeenCalledWith({
      eventName: "save_progress_used",
      participantId: PID,
    });

    // The name and email belong in the verification email — delivered only to
    // the address being verified — never in an analytics payload.
    expect(m.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.com", claimParticipantId: PID }),
    );
  });
});
