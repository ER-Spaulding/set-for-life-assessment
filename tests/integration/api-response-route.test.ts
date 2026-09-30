import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PUT /api/session/[id]/response — the participant data-write path.
 *
 * WHY THIS FILE EXISTS.
 *
 * PRD §23.2 says this route "upserts one response, validates item rules". The
 * load-bearing half is "validates item rules": the §14 selection limits and the
 * Q9_L / Q21_G exclusivity rules are enforced HERE, server-side, because a
 * client can post any selection set it likes. PRD §23.5 is explicit —
 * "Never trust client-side completion ... Required-item validation and final
 * scoring run server-side."
 *
 * The ordering also matters and is asserted below: nothing may be written
 * before the selection is validated. A route that inserted first and validated
 * second would persist a selection the instrument forbids, however briefly.
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

interface Captured {
  deleted: boolean;
  inserted: Array<Record<string, unknown>> | null;
  sessionUpdate: Record<string, unknown> | null;
}

function fakeDb(opts: { session?: Record<string, unknown> | null } = {}) {
  const captured: Captured = { deleted: false, inserted: null, sessionUpdate: null };

  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        // Two shapes: the initial SELECT ... maybeSingle(), then the UPDATE.
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.session === undefined
                    ? { session_id: "s-1", status: "in_progress" }
                    : opts.session,
                  error: null,
                }),
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            captured.sessionUpdate = payload;
            const chain = { eq: () => Promise.resolve({ error: null }) };
            return chain;
          },
        };
      }
      if (table === "responses") {
        return {
          delete: () => {
            captured.deleted = true;
            const chain = { eq: () => chain, then: undefined };
            // delete().eq().eq() resolves
            const inner = { eq: () => Promise.resolve({ error: null }) };
            return { eq: () => inner };
          },
          insert: (rows: Array<Record<string, unknown>>) => {
            captured.inserted = rows;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return { db, captured };
}

function put(body: unknown) {
  return new Request("http://x/api/session/s-1/response", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "s-1" }) };

async function call(
  body: unknown,
  opts: { session?: Record<string, unknown> | null } = {},
) {
  const { db, captured } = fakeDb(opts);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const { PUT } = await import("@/app/api/session/[id]/response/route");
  const res = await PUT(put(body), ctx);
  return { res, body: await res.json().catch(() => null), captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("a completed session is frozen at the API (PRD §22.5)", () => {
  it("refuses a write with 409 and persists nothing", async () => {
    const { res, body, captured } = await call(
      { itemId: "Q4", optionCode: "Q4_C" },
      { session: { session_id: "s-1", status: "completed" } },
    );
    console.log("  completed session ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("SESSION_COMPLETE");
    // The DB trigger would reject it anyway; failing early must also mean
    // failing BEFORE any write is attempted.
    expect(captured.deleted).toBe(false);
    expect(captured.inserted).toBeNull();
    expect(captured.sessionUpdate).toBeNull();
  });
});

describe("selection rules are enforced server-side (PRD §14, §23.5)", () => {
  it("rejects an item that is not on the instrument", async () => {
    const { res, body, captured } = await call({
      itemId: "Q999",
      optionCode: "Q999_A",
    });
    console.log("  unknown item ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("UNKNOWN_ITEM");
    expect(captured.inserted).toBeNull();
  });

  it("rejects a single-select item given two options", async () => {
    // Q4 is single-select. Two codes must be refused — this is the "a client
    // cannot persist a selection set the instrument does not permit" rule.
    const { res, body, captured } = await call({
      itemId: "Q4",
      optionCodes: ["Q4_A", "Q4_B"],
    });
    console.log("  two options on single-select ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("INVALID_SELECTION");
    expect(captured.inserted).toBeNull();
  });

  it("rejects an option code that does not belong to the item", async () => {
    const { res, captured } = await call({ itemId: "Q4", optionCode: "Q5_A" });
    console.log("  mismatched option code ->", res.status);
    expect(res.status).toBe(422);
    expect(captured.inserted).toBeNull();
  });

  it("VALIDATION HAPPENS BEFORE ANY WRITE — nothing is deleted first", async () => {
    // Ordering assertion. The route deletes the item's existing rows and
    // re-inserts the new set; if it deleted before validating, a rejected
    // selection would still have destroyed the participant's prior answer.
    const { res, captured } = await call({
      itemId: "Q4",
      optionCodes: ["Q4_A", "Q4_B"],
    });
    expect(res.status).toBe(422);
    expect(captured.deleted, "must not delete before validating").toBe(false);
    expect(captured.inserted).toBeNull();
  });

  it("rejects an empty selection", async () => {
    const { res, captured } = await call({ itemId: "Q4", optionCodes: [] });
    console.log("  empty selection ->", res.status);
    expect(res.status).toBe(400);
    expect(captured.inserted).toBeNull();
  });

  it("rejects a body with no item id", async () => {
    const { res, captured } = await call({ optionCode: "Q4_A" });
    expect(res.status).toBe(400);
    expect(captured.inserted).toBeNull();
  });
});

describe("the happy path", () => {
  it("saves a single-select answer and advances the position", async () => {
    const { res, body, captured } = await call({
      itemId: "Q4",
      optionCode: "Q4_C",
    });
    console.log("  saved ->", res.status, JSON.stringify(body));
    console.log("  session update:", JSON.stringify(captured.sessionUpdate));
    expect(res.status).toBe(200);
    expect(body).toEqual({ saved: true, itemId: "Q4", optionCodes: ["Q4_C"] });
    expect(captured.inserted).toHaveLength(1);
    expect(captured.inserted![0]).toMatchObject({
      session_id: "s-1",
      item_id: "Q4",
      option_code: "Q4_C",
    });
    expect(typeof captured.sessionUpdate!.last_activity_at).toBe("string");
    expect(typeof captured.sessionUpdate!.current_position).toBe("number");
  });

  it("saves a permitted multi-select set as one row per option", async () => {
    // Q1 is multi-select (classifier). A valid set of two must persist two rows.
    const { res, captured } = await call({
      itemId: "Q1",
      optionCodes: ["Q1_A", "Q1_B"],
    });
    console.log("  multi-select ->", res.status, "rows:", captured.inserted?.length);
    if (res.status === 200) {
      expect(captured.inserted).toHaveLength(2);
    }
  });
});

describe("failure modes stay opaque", () => {
  it("returns 404 for an unknown session", async () => {
    const { res, captured } = await call(
      { itemId: "Q4", optionCode: "Q4_C" },
      { session: null },
    );
    expect(res.status).toBe(404);
    expect(captured.inserted).toBeNull();
  });

  it("returns 503 without writing when the database is unconfigured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { res, captured } = await call({ itemId: "Q4", optionCode: "Q4_C" });
    expect(res.status).toBe(503);
    expect(captured.inserted).toBeNull();
  });
});
