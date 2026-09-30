import { describe, it, expect, vi, beforeEach } from "vitest";

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
    const single = Array.isArray(rows) ? null : rows ?? null;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    Object.assign(chain, {
      select: passthrough,
      eq: passthrough,
      order: passthrough,
      limit: passthrough,
      match: passthrough,
      maybeSingle: () => Promise.resolve({ data: single, error: null }),
      single: () => Promise.resolve({ data: single, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: list, error: null }).then(resolve),
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
  vi.mocked(serviceClient).mockReturnValue(db as never);
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
        status: "in_progress",
        current_position: 7,
        last_activity_at: "2026-09-30T00:00:00Z",
      },
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
    expect(body).toEqual({ resumable: null });
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
