import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The remaining API routes — session creation, resume lookup, mobile capture,
 * pilot feedback, and the two PROTECTED internal endpoints.
 *
 * WHY THIS FILE EXISTS.
 *
 * The activation defect lived in an untested layer; these six were the last
 * routes with no execution coverage. Two groups matter most:
 *
 *   - The INTERNAL endpoints (`audit`, `test-harness`) are the only ones that
 *     return the diagnostic machinery PRD §24 keeps away from participants —
 *     signal values, classifier tags, tensions, audit trail. Their bearer-token
 *     gate is therefore the single control protecting that data, and it is
 *     asserted here in all three states: unconfigured token (404, so the
 *     endpoint is not advertised), wrong token (401), correct token (proceeds).
 *
 *   - `participant/mobile` stores a phone number and must NOT write consent.
 *     "Storing a number is not consent to be messaged" (UIUX §22A) — writing a
 *     consent row here would manufacture permission the participant never gave.
 */

vi.mock("server-only", () => ({}));

// The sweep route's whole job is to invoke `runSweep` under a token gate, so
// the assertion that matters is "did it call the real sweep". Mocked at the
// module boundary rather than faked through the db, because the thing under
// test is the WIRING, not the sweep's logic — that logic has its own 32 tests
// in assessment-lifecycle.test.ts.
const runSweepMock = vi.fn(async (_now?: Date) => ({
  abandoned: 0,
  expired: 0,
  untouched: 0,
  thresholds: { savedWindowDays: 7, expirationWindowDays: 30 },
}));
vi.mock("@/lib/session/sweep", () => ({
  runSweep: (now?: Date) => runSweepMock(now),
  lifecycleThresholds: () => ({ savedWindowDays: 7, expirationWindowDays: 30 }),
}));

const isDbConfigured = vi.fn(() => true);
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => isDbConfigured(),
  isDatabaseConfigured: () => isDbConfigured(),
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

const PID = "11111111-2222-3333-4444-555555555555";

interface Captured {
  /** The LAST insert, for convenience. */
  inserted: Record<string, unknown> | null;
  insertedTable: string | null;
  /**
   * EVERY insert, in order. Necessary because a route may write more than one
   * row — and asserting only on the last would hide an extra write. A review
   * mutation that added a consent row alongside the mobile number passed the
   * whole suite until this was captured. See the mobile test below.
   */
  allInserts: Array<{ table: string; payload: Record<string, unknown> }>;
}

/** Build a fake db whose per-table reads return the supplied rows. */
function fakeDb(tables: Record<string, unknown> = {}, insertError: { code?: string } | null = null) {
  const captured: Captured = { inserted: null, insertedTable: null, allInserts: [] };

  const makeSelect = (table: string) => {
    const rows = tables[table];

    // `eq` FILTERS. It used to be a passthrough that ignored its arguments,
    // which meant the fake could not represent the difference between "this
    // table is empty" and "this table has rows, none of which match" — and a
    // route that correctly filtered and one that ignored its own WHERE clause
    // returned identical results. That is not a stub being loose; it is a stub
    // that cannot fail the thing under test. (Concretely: a §15 gate test
    // passed against a route that had the gate removed.)
    //
    // Filtering makes the fake stricter, so this is checked against the 19
    // existing tests in this file rather than assumed safe.
    let filtered: unknown = rows;
    const applyEq = (col: string, val: unknown) => {
      const src = Array.isArray(filtered) ? filtered : filtered ? [filtered] : [];
      const kept = src.filter(
        (r) => (r as Record<string, unknown> | null)?.[col] === val,
      );
      filtered = kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept;
      return chain;
    };

    // `.not(col, "is", null)` — "this column is not null". A real filter, and
    // it has to be: the §15 gate uses it, and without an implementation here
    // the call throws, the route's `.catch(() => null)` swallows it, and the
    // test sees `firstName: null` — the same value the CORRECT code produces.
    // A missing method made the fake agree with the bug.
    const applyNot = (col: string, _op: string, val: unknown) => {
      const src = Array.isArray(filtered) ? filtered : filtered ? [filtered] : [];
      const kept = src.filter(
        (r) => (r as Record<string, unknown> | null)?.[col] !== val,
      );
      filtered = kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept;
      return chain;
    };

    // `.in(col, values)` — the lifecycle query selects sessions whose status is
    // one of several values. A real filter, for the same reason `.eq` is: if the
    // fake ignored it, a route that correctly asked for
    // `in ['in_progress','abandoned']` and one that asked for nothing would
    // return identical results, and the test could not tell them apart.
    const applyIn = (col: string, vals: unknown[]) => {
      const src = Array.isArray(filtered) ? filtered : filtered ? [filtered] : [];
      const kept = src.filter((r) =>
        vals.includes((r as Record<string, unknown> | null)?.[col]),
      );
      filtered = kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept;
      return chain;
    };

    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    Object.assign(chain, {
      select: passthrough,
      eq: applyEq,
      in: applyIn,
      not: applyNot,
      order: passthrough,
      limit: passthrough,
      match: passthrough,
      maybeSingle: () =>
        Promise.resolve({
          data: Array.isArray(filtered) ? (filtered[0] ?? null) : filtered ?? null,
          error: null,
        }),
      single: () =>
        Promise.resolve({
          data: Array.isArray(filtered) ? (filtered[0] ?? null) : filtered ?? null,
          error: null,
        }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: Array.isArray(filtered) ? filtered : filtered ? [filtered] : [],
          error: null,
        }).then(resolve),
    });
    return chain;
  };

  const db = {
    from(table: string) {
      const base = makeSelect(table);
      return {
        ...base,
        insert: (payload: Record<string, unknown>) => {
          captured.inserted = payload;
          captured.insertedTable = table;
          captured.allInserts.push({ table, payload });
          if (insertError) return Promise.resolve({ error: insertError });
          // `.insert().select().single()` chains in the session route.
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { session_id: "new-session", assessment_version: "1.0", status: "in_progress", current_position: 1 },
                  error: null,
                }),
            }),
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(r),
          };
        },
      };
    },
  };
  return { db, captured };
}

async function bind(modulePath: string, db: unknown) {
  const { serviceClient } = await import("@/lib/db/client");
  // `db` is a hand-built partial chainable double, not a real client: it
  // implements only the handful of methods these routes call. The type system
  // cannot express "the subset of SupabaseClient this fake provides", and
  // `vi.mocked` refuses an `unknown` return regardless, so the two-step cast
  // through `unknown` is the honest way to say "a deliberate stand-in".
  vi.mocked(serviceClient).mockReturnValue(db as unknown as SupabaseClient);
  return import(/* @vite-ignore */ modulePath);
}

const jsonReq = (url: string, body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
  delete process.env.INTERNAL_HARNESS_TOKEN;
});

// ---------------------------------------------------------------------------

describe("POST /api/session — pins the version and validates the participant", () => {
  it("creates a session pinned to v1.0 for a known participant", async () => {
    const { db, captured } = fakeDb({ participants: { participant_id: PID } });
    const { POST } = await bind("@/app/api/session/route", db);
    const res = await POST(jsonReq("http://x/api/session", { participantId: PID }));
    const body = await res.json();

    console.log("  created ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(201);
    expect(captured.inserted).toMatchObject({
      participant_id: PID,
      assessment_version: "1.0",
      status: "in_progress",
    });
  });

  it("rejects an unverified participant id before touching the database", async () => {
    const { db } = fakeDb({ participants: { participant_id: PID } });
    const { POST } = await bind("@/app/api/session/route", db);
    for (const bad of ["", "nope", undefined]) {
      const res = await POST(jsonReq("http://x/api/session", { participantId: bad }));
      expect(res.status, `participantId=${String(bad)}`).toBe(400);
    }
  });

  it("returns 404 for an unknown participant rather than a foreign-key error", async () => {
    const { db } = fakeDb({ participants: null });
    const { POST } = await bind("@/app/api/session/route", db);
    const res = await POST(jsonReq("http://x/api/session", { participantId: PID }));
    console.log("  unknown participant ->", res.status);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/session/resumable — existence and position only, never answers", () => {
  it("returns the in-progress session's position but no responses", async () => {
    const { db } = fakeDb({
      assessment_sessions: {
        session_id: "s-1",
        // `participant_id` is required now that the fake honours `.eq()`. The
        // route filters sessions by participant, so a seed without it does not
        // match — which is correct behaviour, and this seed was previously
        // relying on the filter being ignored.
        participant_id: PID,
        status: "in_progress",
        current_position: 7,
        last_activity_at: "2026-09-30T00:00:00Z",
      },
      participant_contacts: {
        participant_id: PID,
        contact_type: "email",
        verified_at: "2026-09-30T00:00:00Z",
      },
      participants: { participant_id: PID, first_name: "Alicia" },
    });
    const { GET } = await bind("@/app/api/session/resumable/route", db);
    const res = await GET(
      new Request(`http://x/api/session/resumable?participantId=${PID}`),
    );
    const body = await res.json();

    console.log("  resumable ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body.resumable).toMatchObject({ sessionId: "s-1", currentPosition: 7 });
    // Answers come from GET /api/session/:id, scoped to one session, so this
    // endpoint cannot dump a response set.
    const serialized = JSON.stringify(body);
    for (const forbidden of ["responses", "answers", "option", "signals", "tensions"]) {
      expect(serialized, `resumable must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("no resumable session is a normal outcome, not an error", async () => {
    const { db } = fakeDb({ assessment_sessions: null });
    const { GET } = await bind("@/app/api/session/resumable/route", db);
    const res = await GET(new Request(`http://x/api/session/resumable?participantId=${PID}`));
    const body = await res.json();
    console.log("  none ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    // `firstName` was added 2026-10-01 for Addendum 02 §4.1's greeting. It is
    // null here because this fake has no verified contact — which is the
    // correct behaviour, not a placeholder: the greeting must omit the name
    // rather than substitute one. The §15 gate itself is covered by
    // tests/integration/returning-greeting.test.ts.
    //
    // `expired` was added with the assessment-lifecycle feature: "no RESUMABLE
    // session" is not the same as "no session at all", and a participant whose
    // assessment expired must be told that rather than shown a generic welcome.
    // False here because the fake has no expired session either.
    expect(body).toEqual({ resumable: null, firstName: null, expired: false });
  });

  it("the greeting name is gated on verification, not merely returned", async () => {
    // The §4.1 fix could be defeated by returning `participants.first_name`
    // unconditionally — the participant HAS a name, it is just unverified.
    // §15: "Do not use a name before it has been reliably associated with the
    // participant." Entry is not verification.
    //
    // THE FIRST VERSION OF THIS TEST WAS A FALSE GREEN and is worth recording.
    // It faked `participant_contacts: null` and asserted firstName === null —
    // which passed on the MUTATED code too, because the fake also had
    // `participants: null`, so an unconditional read returns null as well. The
    // test could not tell "the gate withheld it" from "there was nothing to
    // read". A test that passes on both the correct and the broken
    // implementation proves nothing.
    //
    // So the participant row IS present with a name, and the ONLY reason to
    // withhold it is the missing verified contact. Now the two implementations
    // give different answers, and the difference is the assertion.
    const NAMED = "4d5e6f70-1a2b-3c4d-5e6f-708192a3b4c5";
    const { db } = fakeDb({
      assessment_sessions: null,
      participants: { participant_id: NAMED, first_name: "Alicia" },
      participant_contacts: null, // no verified contact row — the only gate
    });
    const { GET } = await bind("@/app/api/session/resumable/route", db);
    const res = await GET(new Request(`http://x/api/session/resumable?participantId=${NAMED}`));
    const body = await res.json();
    console.log("  name present but unverified ->", JSON.stringify(body));
    expect(
      body.firstName,
      "the participant row carries a name, but no verified contact exists — §15 forbids using it",
    ).toBe(null);
  });

  it("...and returns it once the contact IS verified", async () => {
    // The other half. Without this, a route that never returns a name at all
    // would satisfy the test above, and §4.1's required first-name welcome
    // would be silently absent — which is exactly the state the greeting
    // defect was found in.
    const NAMED = "4d5e6f70-1a2b-3c4d-5e6f-708192a3b4c5";
    const { db } = fakeDb({
      assessment_sessions: null,
      participants: { participant_id: NAMED, first_name: "Alicia" },
      participant_contacts: {
        participant_id: NAMED,
        contact_type: "email",
        verified_at: "2026-10-01T00:00:00Z",
      },
    });
    const { GET } = await bind("@/app/api/session/resumable/route", db);
    const res = await GET(new Request(`http://x/api/session/resumable?participantId=${NAMED}`));
    const body = await res.json();
    console.log("  verified contact ->", JSON.stringify(body));
    expect(body.firstName, "a verified participant must be greeted by name").toBe("Alicia");
  });

  it("rejects a missing or malformed participant id", async () => {
    const { db } = fakeDb();
    const { GET } = await bind("@/app/api/session/resumable/route", db);
    for (const q of ["", "?participantId=nope", "?participantId="]) {
      const res = await GET(new Request(`http://x/api/session/resumable${q}`));
      expect(res.status, `query=${q}`).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/participant/mobile — a number is NOT consent (UIUX §22A)", () => {
  it("stores a normalised number and writes NO consent row", async () => {
    const { db, captured } = fakeDb();
    const { POST } = await bind("@/app/api/participant/mobile/route", db);
    const res = await POST(
      jsonReq("http://x/api/participant/mobile", {
        participantId: PID,
        mobile: "(555) 123-4567",
      }),
    );
    const body = await res.json();

    console.log("  stored ->", res.status, JSON.stringify(body));
    console.log("  ALL writes:", JSON.stringify(captured.allInserts));
    expect(res.status).toBe(201);
    expect(captured.insertedTable).toBe("participant_contacts");
    expect(captured.inserted).toMatchObject({
      participant_id: PID,
      contact_type: "mobile",
      normalized_value: "5551234567",
    });

    // THE POINT OF THIS TEST: storing a number must write EXACTLY ONE row, to
    // participant_contacts, and never a consent row. Writing one would
    // manufacture permission the participant never gave (UIUX §22A).
    //
    // Asserted over ALL writes, not the last one. An earlier version of this
    // test checked only `captured.inserted`, so a mutation that added a
    // `communication_consents` insert alongside the mobile number passed the
    // entire suite — the consent write simply overwrote the captured value.
    expect(captured.allInserts).toHaveLength(1);
    expect(captured.allInserts.map((w) => w.table)).toEqual(["participant_contacts"]);
    for (const w of captured.allInserts) {
      expect(w.table, "no consent row may be written here").not.toBe(
        "communication_consents",
      );
      expect(JSON.stringify(w.payload)).not.toContain("granted");
      expect(JSON.stringify(w.payload)).not.toContain("consent");
    }
  });

  it("rejects an invalid number with its own code (UIUX §27A)", async () => {
    const { db, captured } = fakeDb();
    const { POST } = await bind("@/app/api/participant/mobile/route", db);
    for (const bad of ["", "123", "not a phone", "+12345678901234567890"]) {
      const res = await POST(
        jsonReq("http://x/api/participant/mobile", { participantId: PID, mobile: bad }),
      );
      const body = await res.json();
      console.log(`  mobile=${JSON.stringify(bad)} ->`, res.status, body?.error?.code);
      expect(res.status).toBe(422);
      expect(body.error.code).toBe("INVALID_MOBILE");
    }
    expect(captured.inserted).toBeNull();
  });

  it("treats a duplicate as an idempotent success", async () => {
    const { db } = fakeDb({}, { code: "23505" });
    const { POST } = await bind("@/app/api/participant/mobile/route", db);
    const res = await POST(
      jsonReq("http://x/api/participant/mobile", { participantId: PID, mobile: "5551234567" }),
    );
    const body = await res.json();
    console.log("  duplicate ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body).toEqual({ stored: true, alreadyPresent: true });
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/session/[id]/pilot-feedback — two gates (PRD §26)", () => {
  const ctx = { params: Promise.resolve({ id: "s-1" }) };

  it("refuses feedback before the Snapshot exists", async () => {
    const { db, captured } = fakeDb({
      assessment_sessions: { session_id: "s-1", status: "in_progress", pilot_mode: true },
    });
    const { POST } = await bind("@/app/api/session/[id]/pilot-feedback/route", db);
    const res = await POST(
      jsonReq("http://x/api/session/s-1/pilot-feedback", { accuracy_rating: 4 }),
      ctx,
    );
    const body = await res.json();
    console.log("  not complete ->", res.status, body?.error?.code);
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("NOT_COMPLETE");
    expect(captured.inserted).toBeNull();
  });

  it("refuses feedback from a session that is not in pilot mode", async () => {
    // A feedback row collected outside pilot mode would look like valid pilot
    // data in analysis while coming from a different population.
    const { db, captured } = fakeDb({
      assessment_sessions: { session_id: "s-1", status: "completed", pilot_mode: false },
    });
    const { POST } = await bind("@/app/api/session/[id]/pilot-feedback/route", db);
    const res = await POST(
      jsonReq("http://x/api/session/s-1/pilot-feedback", { accuracy_rating: 4 }),
      ctx,
    );
    const body = await res.json();
    console.log("  not pilot ->", res.status, body?.error?.code);
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("NOT_PILOT");
    expect(captured.inserted).toBeNull();
  });

  it("records feedback when both gates pass", async () => {
    const { db, captured } = fakeDb({
      assessment_sessions: { session_id: "s-1", status: "completed", pilot_mode: true },
    });
    const { POST } = await bind("@/app/api/session/[id]/pilot-feedback/route", db);
    const res = await POST(
      jsonReq("http://x/api/session/s-1/pilot-feedback", {
        accuracy_rating: 5,
        free_text: "useful",
        // A field that is not on the allow-list must not reach the row.
        internal_score: 999,
      }),
      ctx,
    );
    console.log("  recorded ->", res.status, JSON.stringify(captured.inserted));
    expect(res.status).toBe(201);
    expect(captured.inserted).toMatchObject({ session_id: "s-1", accuracy_rating: 5 });
    expect(captured.inserted).not.toHaveProperty("internal_score");
  });

  it("maps an out-of-range rating to 422, not a 500", async () => {
    const { db } = fakeDb(
      { assessment_sessions: { session_id: "s-1", status: "completed", pilot_mode: true } },
      { code: "23514" },
    );
    const { POST } = await bind("@/app/api/session/[id]/pilot-feedback/route", db);
    const res = await POST(
      jsonReq("http://x/api/session/s-1/pilot-feedback", { accuracy_rating: 9 }),
      ctx,
    );
    const body = await res.json();
    console.log("  bad rating ->", res.status, body?.error?.code);
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("INVALID_RATING");
  });
});

// ---------------------------------------------------------------------------

describe("internal endpoints — the only ones exposing diagnostic machinery (PRD §24)", () => {
  const auditCtx = { params: Promise.resolve({ id: "s-1" }) };

  it("audit returns 404 when the harness token is unconfigured", async () => {
    // An unconfigured deployment must not advertise that the endpoint exists.
    const { db } = fakeDb();
    const { GET } = await bind("@/app/api/internal/session/[id]/audit/route", db);
    const res = await GET(new Request("http://x"), auditCtx);
    console.log("  unconfigured ->", res.status);
    expect(res.status).toBe(404);
  });

  it("audit returns 401 for a wrong, malformed, or missing token", async () => {
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    const { db } = fakeDb({ assessment_sessions: { session_id: "s-1" } });
    const { GET } = await bind("@/app/api/internal/session/[id]/audit/route", db);

    for (const header of [
      undefined,
      "Bearer wrong",
      "Bearer ",
      "Bearer",
      "",
      "Basic the-real-token",
      "Bearer the-real-token-x",
      "bearer The-Real-Token", // case-sensitive secret
    ]) {
      const res = await GET(
        new Request("http://x", header ? { headers: { authorization: header } } : undefined),
        auditCtx,
      );
      console.log(`  auth=${JSON.stringify(header)} ->`, res.status);
      expect(res.status).toBe(401);
    }
  });

  it("accepts the token with or without the `Bearer ` scheme — and nothing else", async () => {
    // Documents an observed leniency rather than asserting it away. The route
    // strips a leading `Bearer ` and then compares exactly, so a BARE token also
    // authenticates. That is not a weakness — the secret must still match
    // character-for-character, and the comparison is case-sensitive — but it is
    // the one input shape that is not rejected, so it is pinned here.
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    const { db } = fakeDb({ assessment_sessions: { session_id: "s-1" } });
    const { GET } = await bind("@/app/api/internal/session/[id]/audit/route", db);

    const bare = await GET(
      new Request("http://x", { headers: { authorization: "the-real-token" } }),
      auditCtx,
    );
    console.log("  bare token ->", bare.status);
    expect(bare.status).toBe(200);
  });

  it("audit returns the diagnostic machinery to an authorized caller", async () => {
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    const { db } = fakeDb({
      assessment_sessions: { session_id: "s-1", participant_id: PID, status: "completed" },
      computed_signals: [
        { signal: "SEE", value: 5, state: "S5", special_state: null, evidence_confidence: "high" },
      ],
      classifier_tags: [{ tag: "OPEN_MONEY_ENVIRONMENT" }],
      tensions: [{ tension_code: "HIGH_ACTIVITY_LOW_DIRECTION" }],
      overrides: [],
      audit_events: [{ event_type: "completed", event_at: "2026-09-30T00:00:00Z", metadata_json: {} }],
    });
    const { GET } = await bind("@/app/api/internal/session/[id]/audit/route", db);
    const res = await GET(
      new Request("http://x", { headers: { authorization: "Bearer the-real-token" } }),
      auditCtx,
    );
    const body = await res.json();

    console.log("  authorized ->", res.status, JSON.stringify(Object.keys(body)));
    expect(res.status).toBe(200);
    // This IS the machinery §24 keeps from participants — which is exactly why
    // the gate above is the control that matters.
    expect(body).toHaveProperty("signals");
    expect(body).toHaveProperty("classifierTags");
    expect(body).toHaveProperty("tensions");
    expect(body).toHaveProperty("auditTrail");
  });

  it("test-harness returns 404 when unconfigured and 401 for a wrong token", async () => {
    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/test-harness/run/route", db);

    const unconfigured = await POST(jsonReq("http://x", { responses: {} }));
    console.log("  unconfigured ->", unconfigured.status);
    expect(unconfigured.status).toBe(404);

    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    const wrong = await POST(
      jsonReq("http://x", { responses: {} }, "POST", { authorization: "Bearer nope" }),
    );
    console.log("  wrong token ->", wrong.status);
    expect(wrong.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

/**
 * The lifecycle sweep is REACHABLE.
 *
 * THE GAP THIS CLOSES. `runSweep` had no caller. Not a broken one — none. The
 * classification logic was unit-tested, the transitions were integration-tested
 * against a real Postgres, `planTransitions` was proven forward-only by a
 * property test across 36 status×elapsed combinations... and nothing in the
 * application ever invoked it. Every session would have sat at `in_progress`
 * forever and the operator's 30-day rule would have been enforced only by
 * tests that pass whether or not the feature runs.
 *
 * This is the failure mode this repo keeps re-learning: a green suite proves a
 * unit behaves correctly, never that anything calls it. The tests below are
 * deliberately about WIRING — that a route exists, that it is gated, and that
 * it invokes the sweep — because the sweep's own behaviour is already covered.
 *
 * The last test is the one that would have caught the original gap: it asserts
 * the route module can be resolved and that calling it reaches `runSweep`.
 */
describe("the lifecycle sweep has a reachable, gated entry point (operator #7)", () => {
  const sweepUrl = "http://x/api/internal/lifecycle/sweep";

  it("returns 404 when the harness token is unconfigured", async () => {
    // Same posture as the audit route: an unconfigured deployment must not
    // advertise an endpoint that writes lifecycle state.
    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/lifecycle/sweep/route", db);
    const res = await POST(jsonReq(sweepUrl, {}));
    console.log("  unconfigured ->", res.status);
    expect(res.status).toBe(404);
    expect(runSweepMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong, malformed, or missing token — and never sweeps", async () => {
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/lifecycle/sweep/route", db);

    for (const header of [undefined, "Bearer wrong", "Bearer", "Basic the-real-token"]) {
      const res = await POST(
        jsonReq(sweepUrl, {}, "POST", header ? { authorization: header } : {}),
      );
      console.log(`  auth=${JSON.stringify(header)} ->`, res.status);
      expect(res.status).toBe(401);
    }
    // The gate must run BEFORE the write. An unauthorized request that still
    // swept would be the whole point of the gate, missed.
    expect(runSweepMock).not.toHaveBeenCalled();
  });

  it("invokes the real sweep when authorized — this is the reachability assertion", async () => {
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    runSweepMock.mockClear();
    runSweepMock.mockResolvedValueOnce({
      abandoned: 2,
      expired: 1,
      untouched: 5,
      thresholds: { savedWindowDays: 7, expirationWindowDays: 30 },
    });

    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/lifecycle/sweep/route", db);
    const res = await POST(
      jsonReq(sweepUrl, {}, "POST", { authorization: "Bearer the-real-token" }),
    );
    const body = await res.json();

    console.log("  authorized ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    // The wiring assertion. Without this, the route could exist and do nothing.
    expect(runSweepMock).toHaveBeenCalledTimes(1);
    // Counts are echoed so an operator running the sweep can see what it did.
    expect(body).toMatchObject({ ok: true, abandoned: 2, expired: 1, untouched: 5 });
    // The thresholds in force are self-describing in the response rather than
    // only in a log — a sweep run against unexpected thresholds is a silent
    // mass-expiration otherwise.
    expect(body.thresholds).toEqual({ savedWindowDays: 7, expirationWindowDays: 30 });
  });

  it("passes an explicit `now` through, for boundary verification", async () => {
    // The 7/30-day boundaries cannot be verified live by waiting. `now` is
    // injectable for that reason, and this pins that it actually reaches the
    // sweep rather than being accepted and dropped.
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    runSweepMock.mockClear();

    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/lifecycle/sweep/route", db);
    await POST(
      jsonReq(`${sweepUrl}?now=2026-12-01T00:00:00.000Z`, {}, "POST", {
        authorization: "Bearer the-real-token",
      }),
    );

    const passed = runSweepMock.mock.calls[0]?.[0] as Date | undefined;
    console.log("  now passed through ->", passed?.toISOString());
    expect(passed).toBeInstanceOf(Date);
    expect(passed?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("rejects an unparseable `now` rather than silently sweeping against the wall clock", async () => {
    // A typo'd timestamp that fell back to `new Date()` would sweep against the
    // REAL present while the operator believed they were testing a boundary —
    // and could expire live sessions during what they thought was a dry run.
    process.env.INTERNAL_HARNESS_TOKEN = "the-real-token";
    runSweepMock.mockClear();

    const { db } = fakeDb();
    const { POST } = await bind("@/app/api/internal/lifecycle/sweep/route", db);
    const res = await POST(
      jsonReq(`${sweepUrl}?now=not-a-date`, {}, "POST", {
        authorization: "Bearer the-real-token",
      }),
    );
    console.log("  bad now ->", res.status);
    expect(res.status).toBe(400);
    expect(runSweepMock).not.toHaveBeenCalled();
  });
});
