import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PUT /api/session/[id]/response — REVISION (upsert of an already-answered item).
 *
 * WHY THIS FILE EXISTS.
 *
 * The response route is the single write path for participant answers, and it is
 * called twice per participant in the normal flow: once to answer, and again to
 * REVISE an earlier answer. `api-response-route.test.ts` covers the FIRST write
 * and the lifecycle gate, but its fake db records `deleted` as a boolean and
 * never seeds prior response state — so it cannot observe whether a revision
 * REPLACES the prior set or ACCUMULATES onto it, cannot assert the delete is
 * scoped to the revised item (rather than wiping every answer the session holds),
 * cannot observe a multi-select shrinking to a smaller set, and its §14-invalid
 * case seeds no prior answer so it cannot prove a rejected revision preserves an
 * existing good answer.
 *
 * THE DEFECT THIS PREVENTS. The route persists a revision as delete-then-insert.
 * If that delete is ever dropped or widened, a participant's "final" answers
 * silently become the union of everything they ever selected — a participant who
 * clicked Q1_C and then Q1_D ends up scored as having selected both, and the
 * §14 exclusivity rules (Q9_L / Q21_G stand alone) are then applied against a
 * contaminated set. Because the fake db here keeps `responses` as a LIVE
 * in-memory store — `delete()` really removes rows scoped by (session_id,
 * item_id) and `insert()` really appends — "replace vs accumulate" is asserted
 * as STORAGE STATE, not as a `deleted === true` flag, so the guard is exercised
 * against behaviour rather than against the shape of the route's source.
 *
 * Ordering is also pinned: validation precedes the delete, so a rejected
 * revision (422 INVALID_SELECTION) must not have first destroyed the prior,
 * still-valid answer.
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

interface SeedRow {
  session_id: string;
  item_id: string;
  option_code: string;
  // The fake db's delete() indexes rows by arbitrary column name (see the
  // `matches` check below), so a store row must support string-keyed access
  // in addition to its known columns. Every column is a string value, so the
  // index signature is string -> string.
  [key: string]: string;
}

interface Captured {
  inserted: Array<Record<string, unknown>> | null;
  /**
   * EVERY update the route issued against the session row, in order. A single
   * last-write-wins slot was not enough: a resume split into its own later
   * write still lands a payload carrying `status`, so a single captured slot
   * cannot tell "the resume rides WITH the answer in one write" from "the
   * resume happens in a second write after it" — the exact crash window the
   * route's own comment says it exists to close. Mutation testing found this.
   */
  sessionUpdates: Array<Record<string, unknown>>;
  /**
   * Every delete the route issued, as the FULL filter scope it used: the
   * columns filtered on, in order, and the merged filter. The column list is
   * load-bearing — a builder that merged filters into a column-keyed object
   * silently collapses a repeated `.eq("session_id", …)` onto one key, so a
   * delete re-scoped from (session_id, item_id) to session-wide would record
   * a scope it did not actually apply.
   */
  deletes: Array<{ columns: string[]; filter: Record<string, string> }>;
  /** The live responses store — what the route's delete+insert actually left. */
  store: SeedRow[];
}

function fakeDb(opts: { session?: Record<string, unknown> | null; seeded?: SeedRow[] } = {}) {
  // A LIVE store: rows are real objects, removed by delete() and added by insert().
  const store: SeedRow[] = (opts.seeded ?? []).map((r) => ({ ...r }));
  const deletes: Captured["deletes"] = [];
  const captured: Captured = { inserted: null, sessionUpdates: [], deletes, store };

  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    opts.session === undefined
                      ? { session_id: "s-1", status: "in_progress" }
                      : opts.session,
                  error: null,
                }),
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            captured.sessionUpdates.push({ ...payload });
            const chain = { eq: () => Promise.resolve({ error: null }) };
            return chain;
          },
        };
      }
      if (table === "responses") {
        return {
          // delete().eq(...).eq(...) — every filter the route chains is
          // captured and the statement is a THENABLE, so the delete is applied
          // when (and only when) the route awaits it, exactly as Postgres
          // would apply it server-side.
          delete: () => {
            const columns: string[] = [];
            const filter: Record<string, string> = {};
            const applyDelete = () => {
              deletes.push({ columns: [...columns], filter: { ...filter } });
              for (let i = store.length - 1; i >= 0; i--) {
                const row = store[i];
                // REAL delete semantics: a column the filter does not mention
                // matches every value. A delete scoped only to session_id
                // removes every row in that session; a delete that never
                // mentions session_id removes the item in EVERY session.
                //
                // This used to require `row.item_id === filter.item_id`
                // unconditionally, with the filters merged into a
                // column-keyed object. That could not represent a widened
                // delete at all: dropping or re-scoping the item_id filter
                // deleted NOTHING here (the opposite of what a real delete
                // does), so the "untouched item" test below passed on the
                // exact bug it names. Mutation testing found it; that is why
                // this fake now mirrors SQL rather than only the happy path.
                const matches = Object.entries(filter).every(
                  ([col, val]) => row[col] === val,
                );
                if (matches) store.splice(i, 1);
              }
              return { error: null };
            };
            interface Chain {
              eq: (col: string, val: string) => Chain;
              then: (resolve: (v: { error: null }) => unknown) => unknown;
            }
            const chain: Chain = {
              eq: (col: string, val: string) => {
                columns.push(col);
                filter[col] = val;
                return chain;
              },
              then: (resolve) => Promise.resolve(applyDelete()).then(resolve),
            };
            return chain;
          },
          insert: (rows: Array<Record<string, unknown>>) => {
            captured.inserted = rows;
            for (const r of rows) {
              store.push({
                session_id: r.session_id as string,
                item_id: r.item_id as string,
                option_code: r.option_code as string,
              });
            }
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return { db, captured };
}

/** The option codes the store holds for one item, in insertion order. */
function rowsFor(store: SeedRow[], itemId: string): string[] {
  return store.filter((r) => r.item_id === itemId).map((r) => r.option_code);
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
  opts: { session?: Record<string, unknown> | null; seeded?: SeedRow[] } = {},
) {
  const { db, captured } = fakeDb(opts);
  const { serviceClient } = await import("@/lib/db/client");
  // `db` is a hand-built partial chainable double that implements only the
  // tables and methods this route touches, so its shape is deliberately not
  // that of a real SupabaseClient. The type system cannot express "the subset
  // of SupabaseClient this fake provides"; the two-step cast through `unknown`
  // is the honest way to say "a deliberate stand-in".
  vi.mocked(serviceClient).mockReturnValue(db as unknown as SupabaseClient);
  const { PUT } = await import("@/app/api/session/[id]/response/route");
  const res = await PUT(put(body), ctx);
  return { res, body: await res.json().catch(() => null), captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("a revision replaces the prior set, never accumulates", () => {
  it("revising Q1 from {Q1_A,Q1_B} to {Q1_C,Q1_D} leaves exactly [Q1_C,Q1_D]", async () => {
    const { res, body, captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_C", "Q1_D"] },
      {
        seeded: [
          { session_id: "s-1", item_id: "Q1", option_code: "Q1_A" },
          { session_id: "s-1", item_id: "Q1", option_code: "Q1_B" },
        ],
      },
    );
    console.log("  revise Q1 ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    // The union [Q1_A,Q1_B,Q1_C,Q1_D] is what an insert-without-delete produces.
    expect(
      rowsFor(captured.store, "Q1"),
      "the revised item must hold exactly the new set, never old-plus-new",
    ).toEqual(["Q1_C", "Q1_D"]);
  });

  it("issues exactly one delete, scoped to {session_id:'s-1', item_id:'Q1'}", async () => {
    const { captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_B"] },
      { seeded: [{ session_id: "s-1", item_id: "Q1", option_code: "Q1_A" }] },
    );
    console.log("  deletes issued:", JSON.stringify(captured.deletes));
    expect(captured.deletes, "the revision must issue exactly one delete").toHaveLength(1);
    const [d] = captured.deletes;
    // TWO DISTINCT filters. Checked as a column SET, not a sequence, so a
    // harmless reordering of the two .eq calls does not fail the test — but a
    // delete that filters on the same column twice (which drops item_id) does.
    expect(
      [...d.columns].sort(),
      "the delete must filter on session_id AND item_id — two distinct filters",
    ).toEqual(["item_id", "session_id"]);
    expect(d.filter, "and be scoped to the revised item in this session").toEqual({
      session_id: "s-1",
      item_id: "Q1",
    });
  });

  it("an untouched item seeded alongside the revised one keeps its answer", async () => {
    const { captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_B"] },
      {
        seeded: [
          { session_id: "s-1", item_id: "Q1", option_code: "Q1_A" },
          { session_id: "s-1", item_id: "Q4", option_code: "Q4_C" },
          // A DIFFERENT session's copy of the revised item. It must survive:
          // the delete is scoped by session_id as well as item_id.
          { session_id: "s-2", item_id: "Q1", option_code: "Q1_D" },
        ],
      },
    );
    // A delete widened to the whole session would have erased Q4 too...
    expect(
      rowsFor(captured.store, "Q4"),
      "revising Q1 must not touch Q4 — the delete is scoped to the revised item",
    ).toEqual(["Q4_C"]);
    // ...and one widened past the session filter would have reached s-2.
    expect(
      rowsFor(
        captured.store.filter((r) => r.session_id === "s-2"),
        "Q1",
      ),
      "revising Q1 in s-1 must not reach s-2's Q1 — the delete is scoped to the session",
    ).toEqual(["Q1_D"]);
    // And the revision itself still landed, in place: s-1's Q1 holds ONLY the
    // new answer — its old Q1_A was deleted, not accumulated.
    expect(
      rowsFor(
        captured.store.filter((r) => r.session_id === "s-1"),
        "Q1",
      ),
    ).toEqual(["Q1_B"]);
  });

  it("shrinking a multi-select from two options to one leaves exactly the one", async () => {
    const { res, captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_C"] },
      {
        seeded: [
          { session_id: "s-1", item_id: "Q1", option_code: "Q1_A" },
          { session_id: "s-1", item_id: "Q1", option_code: "Q1_B" },
        ],
      },
    );
    console.log("  shrink Q1 ->", res.status, "store:", JSON.stringify(rowsFor(captured.store, "Q1")));
    expect(res.status).toBe(200);
    expect(
      rowsFor(captured.store, "Q1"),
      "shrinking to a smaller set must not leave the dropped option behind",
    ).toEqual(["Q1_C"]);
  });
});

describe("a revision respects the lifecycle it lands in", () => {
  it("revising on an ABANDONED session resumes in the SAME write and stores the revision", async () => {
    const { res, captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_B"] },
      {
        session: { session_id: "s-1", status: "abandoned" },
        seeded: [{ session_id: "s-1", item_id: "Q1", option_code: "Q1_A" }],
      },
    );
    console.log("  abandoned revise ->", res.status, "updates:", JSON.stringify(captured.sessionUpdates));
    expect(res.status).toBe(200);
    // SAME WRITE — one update, not a resume bolted on afterwards. A second
    // update (status mutating the row after the answer's own write has already
    // landed) would leave a crash window the route's comment says it exists to
    // close, and a last-write-wins capture could not tell the difference.
    expect(
      captured.sessionUpdates,
      "the resume must ride in ONE session update, with the autosave — not a second write",
    ).toHaveLength(1);
    const [u] = captured.sessionUpdates;
    expect(u.status, "the resume travels with the answer").toBe("in_progress");
    expect(u.lifecycle_changed_at, "and is timestamped").toEqual(expect.any(String));
    expect(u.last_activity_at, "in the same payload as the §23.2 autosave").toEqual(
      expect.any(String),
    );
    expect(
      rowsFor(captured.store, "Q1"),
      "the NEW answer is stored, not the stale one",
    ).toEqual(["Q1_B"]);
  });

  it("revising an in_progress session neither completes nor rewrites its status", async () => {
    const { res, body, captured } = await call(
      { itemId: "Q1", optionCodes: ["Q1_B"] },
      {
        session: { session_id: "s-1", status: "in_progress" },
        seeded: [{ session_id: "s-1", item_id: "Q1", option_code: "Q1_A" }],
      },
    );
    console.log("  in_progress revise ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    // The body is exactly the save acknowledgement — no completion marker.
    expect(body).toEqual({ saved: true, itemId: "Q1", optionCodes: ["Q1_B"] });
    // Exactly one session update (the §23.2 autosave) — never a second.
    expect(captured.sessionUpdates).toHaveLength(1);
    const [u] = captured.sessionUpdates;
    expect(
      u && "status" in u,
      "an in_progress session has nothing to resume — no status key",
    ).toBe(false);
    expect(
      u && "completed_at" in u,
      "a revision must never trigger completion",
    ).toBe(false);
  });
});

describe("a rejected revision does not first destroy the prior answer", () => {
  it("a §14-invalid revision (Q9_L + Q9_A) is refused 422 BEFORE any delete, preserving [Q9_A]", async () => {
    const { res, body, captured } = await call(
      { itemId: "Q9", optionCodes: ["Q9_L", "Q9_A"] },
      { seeded: [{ session_id: "s-1", item_id: "Q9", option_code: "Q9_A" }] },
    );
    console.log("  invalid Q9 revision ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("INVALID_SELECTION");
    expect(captured.deletes, "validation must precede the delete — zero deletes").toEqual([]);
    expect(captured.inserted, "and nothing may be inserted").toBeNull();
    expect(
      rowsFor(captured.store, "Q9"),
      "the participant's still-valid [Q9_A] must survive a rejected revision",
    ).toEqual(["Q9_A"]);
  });
});
