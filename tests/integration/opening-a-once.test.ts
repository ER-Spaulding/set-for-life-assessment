import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F-06 — Opening A is answered EXACTLY ONCE.
 *
 * The defect: the front door asked "Is this your first time…?" and pushed
 * `?openingA=yes`, but nothing read it, so the instrument asked the identical
 * question again as question 1 of 31. The Owner's approved architecture seeds
 * the canonical OPEN_A response server-side at session creation, chosen from
 * WHICH door was used, and the instrument never presents Opening A.
 *
 * These tests drive the REAL creation routes and the REAL response route
 * against a recording fake db, and assert the resume/navigation logic that
 * keeps Opening A out of the instrument. Numbered 1–10 to map to the plan
 * (test 4 lives in tests/unit/build-profile.test.ts).
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

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

import {
  QUESTION_BANK,
  QUESTION_SEQUENCE,
  FRONT_DOOR_ITEM_IDS,
  FIRST_IN_INSTRUMENT_INDEX,
  resumeIndex,
} from "@/lib/ui/questions";

const UUID = "12345678-1234-1234-1234-123456789012";

interface Captured {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  deletes: string[];
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
}

interface FakeDbOptions {
  participant?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  /** Rows returned by the response route's front-door lock read. */
  existingResponses?: Array<Record<string, unknown>>;
  /** Make the canonical OPEN_A seed fail, to prove a seed error is non-fatal. */
  seedFails?: boolean;
}

/** A recording fake db, chainable enough for the creation + response routes. */
function fakeDb(opts: FakeDbOptions = {}) {
  const captured: Captured = { inserts: [], deletes: [], updates: [] };

  const db = {
    from(table: string) {
      if (table === "participants") {
        return {
          insert: (payload: Record<string, unknown>) => {
            captured.inserts.push({ table, payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data:
                      opts.participant ??
                      ({ participant_id: "p-uuid", sfl_number: "7K2Q-9M4X" } as Record<
                        string,
                        unknown
                      >),
                    error: null,
                  }),
              }),
            };
          },
          select: () => {
            const chain: Record<string, unknown> = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    opts.participant === undefined
                      ? ({ participant_id: "p-uuid" } as Record<string, unknown>)
                      : opts.participant,
                  error: null,
                }),
            };
            return chain;
          },
        };
      }
      if (table === "assessment_sessions") {
        return {
          insert: (payload: Record<string, unknown>) => {
            captured.inserts.push({ table, payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data:
                      opts.session ??
                      ({
                        session_id: "s-1",
                        assessment_version: "1.0",
                        status: "in_progress",
                        current_position: 1,
                      } as Record<string, unknown>),
                    error: null,
                  }),
              }),
            };
          },
          select: () => {
            const chain: Record<string, unknown> = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    opts.session === undefined
                      ? ({ session_id: "s-1", status: "in_progress" } as Record<
                          string,
                          unknown
                        >)
                      : opts.session,
                  error: null,
                }),
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            captured.updates.push({ table, payload });
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "responses") {
        return {
          insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const r of rows) captured.inserts.push({ table, payload: r });
            // Only the canonical OPEN_A seed fails — the response route's own
            // writes are unaffected, so the two cases stay distinguishable.
            const isFrontDoorSeed = rows.every((r) => r.item_id === "OPEN_A");
            if (opts.seedFails && isFrontDoorSeed) {
              return Promise.resolve({ error: { message: "injected seed failure" } });
            }
            return Promise.resolve({ error: null });
          },
          select: () => {
            const chain: Record<string, unknown> = {
              eq: () => chain,
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: opts.existingResponses ?? [],
                  error: null,
                }).then(resolve),
            };
            return chain;
          },
          delete: () => {
            captured.deletes.push(table);
            const inner: Record<string, unknown> = {
              eq: () => inner,
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ error: null }).then(resolve),
            };
            return { eq: () => inner };
          },
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return { db, captured };
}

async function bindService(db: unknown) {
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  return serviceClient;
}

async function runProvisional(opts: FakeDbOptions = {}) {
  const { db, captured } = fakeDb(opts);
  await bindService(db);
  const { createProvisionalParticipant } = await import("@/lib/session/provisional");
  const result = await createProvisionalParticipant();
  return { result, captured };
}

async function runSessionRoute(opts: FakeDbOptions = {}) {
  const { db, captured } = fakeDb(opts);
  await bindService(db);
  const { POST } = await import("@/app/api/session/route");
  const res = await POST(
    new Request("http://x/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: UUID }),
    }),
  );
  const body = await res.json().catch(() => null);
  return { res, body, captured };
}

async function runResponseRoute(
  body: unknown,
  opts: FakeDbOptions = {},
) {
  const { db, captured } = fakeDb(opts);
  await bindService(db);
  const { PUT } = await import("@/app/api/session/[id]/response/route");
  const res = await PUT(
    new Request("http://x/api/session/s-1/response", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "s-1" }) },
  );
  const json = await res.json().catch(() => null);
  return { res, body: json, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("F-06 — Opening A is answered once", () => {
  it("1. first-time: the provisional route seeds exactly one OPEN_A_A and the instrument resumes at Opening B", async () => {
    const { result, captured } = await runProvisional();
    expect(result.sessionId).toBe("s-1");

    const responses = captured.inserts.filter((i) => i.table === "responses");
    expect(responses, "exactly one response is written at creation").toHaveLength(1);
    expect(responses[0].payload).toEqual({
      session_id: "s-1",
      item_id: "OPEN_A",
      option_code: "OPEN_A_A",
      open_text: null,
    });

    // The instrument never presents Opening A: resume lands on Opening B.
    expect(resumeIndex({ OPEN_A: ["OPEN_A_A"] })).toBe(FIRST_IN_INSTRUMENT_INDEX);
    expect(QUESTION_SEQUENCE[FIRST_IN_INSTRUMENT_INDEX].internal_id).toBe("OPEN_B");
  });

  it("1b. once OPEN_B is ANSWERED, resume skips past it — it is never re-asked", () => {
    // OWNER RULING 2026-10-06. This is the other half of carrying OPEN_B
    // forward: carrying the row is only useful if the instrument then STEPS
    // OVER it. OPEN_B is the participant's pre-assessment baseline, and
    // re-presenting it after several assessment questions would collect an
    // answer to a different question — how they feel having been primed by the
    // instrument rather than before it.
    //
    // The rule is general (§"should not require them to answer that item
    // again") and rests on `resumeIndex` finding the first UNANSWERED item, so
    // it holds for every carried item, not just this one.
    const answered = { OPEN_A: ["OPEN_A_A"], OPEN_B: ["OPEN_B_D"] };
    const at = resumeIndex(answered);
    expect(QUESTION_SEQUENCE[at].internal_id, "must not land on OPEN_B").not.toBe("OPEN_B");
    expect(at, "must be past OPEN_B").toBeGreaterThan(FIRST_IN_INSTRUMENT_INDEX);

    // A recovered sitting with a few diagnostics answers resumes at the first
    // gap, and every carried item is stepped over.
    const carried = {
      OPEN_A: ["OPEN_A_A"],
      OPEN_B: ["OPEN_B_D"],
      Q4: ["Q4_C"], // the FIRST diagnostic in presentation order
    };
    const at2 = resumeIndex(carried);
    expect(QUESTION_SEQUENCE[at2].internal_id, "skips the carried Q4").toBe("Q1");
  });

  it("2. returning: the session route seeds exactly one OPEN_A_B and the instrument resumes at Opening B", async () => {
    const { res, captured } = await runSessionRoute();
    expect(res.status).toBe(201);

    const responses = captured.inserts.filter((i) => i.table === "responses");
    expect(responses, "exactly one response is written at creation").toHaveLength(1);
    expect(responses[0].payload).toEqual({
      session_id: "s-1",
      item_id: "OPEN_A",
      option_code: "OPEN_A_B",
      open_text: null,
    });

    expect(resumeIndex({ OPEN_A: ["OPEN_A_B"] })).toBe(FIRST_IN_INSTRUMENT_INDEX);
    expect(QUESTION_SEQUENCE[FIRST_IN_INSTRUMENT_INDEX].internal_id).toBe("OPEN_B");
  });

  it("3. the front-door answer IS the canonical stored OPEN_A for each door", async () => {
    const provisional = await runProvisional();
    const pRows = provisional.captured.inserts.filter((i) => i.table === "responses");
    expect(pRows).toHaveLength(1);
    expect(pRows[0].payload.item_id).toBe("OPEN_A");
    expect(pRows[0].payload.option_code).toBe("OPEN_A_A"); // Yes = first-time

    const returning = await runSessionRoute();
    const rRows = returning.captured.inserts.filter((i) => i.table === "responses");
    expect(rRows).toHaveLength(1);
    expect(rRows[0].payload.item_id).toBe("OPEN_A");
    expect(rRows[0].payload.option_code).toBe("OPEN_A_B"); // No = returning
  });

  it("4b. a seed FAILURE does not strand a participant whose rows are already committed", async () => {
    // The participant and session inserts have COMMITTED by the time the seed
    // runs, so a seed error must not 500 the request that created them: the
    // participant would hold no id and a retry would mint a duplicate record.
    // The fallback is already correct — with no seeded OPEN_A the instrument
    // starts at Opening A and the participant answers it there, which is the
    // pre-F-06 behaviour.
    //
    // Mutation that must fail this: removing the try/catch around the seed so
    // the error propagates out of the creation path.
    const { db, captured } = fakeDb({ seedFails: true });
    await bindService(db);
    const { createProvisionalParticipant } = await import("@/lib/session/provisional");

    const result = await createProvisionalParticipant();

    // The creation still SUCCEEDS and returns ids the participant can use.
    expect(result.sessionId).toBeTruthy();
    expect(result.participantId).toBeTruthy();
    // And the session row really was written — the failure is only the seed.
    expect(captured.inserts.some((i) => i.table === "assessment_sessions")).toBe(true);
  });

  it("5. resumeIndex on a session holding only OPEN_A returns the OPEN_B index", () => {
    expect(QUESTION_SEQUENCE[FIRST_IN_INSTRUMENT_INDEX].internal_id).toBe("OPEN_B");
    expect(resumeIndex({ OPEN_A: ["OPEN_A_A"] })).toBe(FIRST_IN_INSTRUMENT_INDEX);

    // Never a front-door index, even with no answers at all.
    expect(resumeIndex({})).toBeGreaterThanOrEqual(FIRST_IN_INSTRUMENT_INDEX);
    expect(resumeIndex({})).not.toBe(-1);

    // Never -1: a fully-answered session lands on the LAST in-instrument item.
    const allAnswered = Object.fromEntries(
      QUESTION_SEQUENCE.map((q) => [q.internal_id, [`${q.internal_id}_X`]]),
    );
    const last = resumeIndex(allAnswered);
    expect(last).toBe(QUESTION_SEQUENCE.length - 1);
    expect(last).toBeGreaterThanOrEqual(FIRST_IN_INSTRUMENT_INDEX);
  });

  it("6. Opening B cannot Back-navigate to Opening A; the next question's Back returns to Opening B", () => {
    const page = read("app/(public)/assessment/[sessionId]/page.tsx");
    // Back exists only ABOVE the first in-instrument index (Opening B), so
    // Opening B has no Back and the NEXT question's Back returns to Opening B.
    expect(page).toMatch(/onBack=\{\s*index > FIRST_IN_INSTRUMENT_INDEX\s*\?/);
    expect(
      page,
      "the Back floor must be the derived FIRST_IN_INSTRUMENT_INDEX, not a literal index > 0",
    ).not.toMatch(/onBack=\{\s*index > 0\s*\?/);
  });

  it("7a. the response route refuses (409) to modify a front-door item that already has an answer", async () => {
    const { res, body, captured } = await runResponseRoute(
      { itemId: "OPEN_A", optionCode: "OPEN_A_A" },
      {
        session: { session_id: "s-1", status: "in_progress" },
        existingResponses: [{ item_id: "OPEN_A" }],
      },
    );
    console.log("  OPEN_A edit ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("OPENING_A_LOCKED");
    // Nothing is written: no delete, no insert, no session update.
    expect(captured.deletes).toEqual([]);
    expect(captured.inserts).toEqual([]);
    expect(captured.updates).toEqual([]);
  });

  it("7b. responses is UNIQUE(session_id,item_id,option_code) — the DB cannot hold two OPEN_A rows", () => {
    const schema = read("supabase/migrations/20260930000001_initial_schema.sql");
    expect(schema, "a duplicate OPEN_A row must be rejected at the schema level").toMatch(
      /UNIQUE \(session_id, item_id, option_code\)/,
    );
  });

  it("7c. the instrument cannot present Opening A", () => {
    expect(FRONT_DOOR_ITEM_IDS).toEqual(["OPEN_A"]);
    // OPEN_A sits at sequence index 0, which is the only front-door index.
    expect(
      QUESTION_SEQUENCE.findIndex((q) => FRONT_DOOR_ITEM_IDS.includes(q.internal_id)),
    ).toBe(0);

    // resumeIndex never returns a front-door index, so the instrument never
    // lands on Opening A.
    expect(resumeIndex({})).toBeGreaterThanOrEqual(FIRST_IN_INSTRUMENT_INDEX);
    expect(resumeIndex({ OPEN_A: ["OPEN_A_A"] })).toBeGreaterThanOrEqual(
      FIRST_IN_INSTRUMENT_INDEX,
    );

    // And the page uses resumeIndex, with Back floored at the first in-instrument
    // index, so neither resume nor Back can reach Opening A.
    const page = read("app/(public)/assessment/[sessionId]/page.tsx");
    expect(page).toMatch(/setIndex\(resumeIndex\(restored\)\)/);
    expect(page).toMatch(/FIRST_IN_INSTRUMENT_INDEX/);
  });

  it("8. the front door replaces history instead of pushing a submittable door", () => {
    const page = read("app/(public)/assessment/start/page.tsx");
    expect(page, "first-time navigation must replace, not push").toMatch(
      /router\.replace\(`\/assessment\/\$\{data\.sessionId\}`\)/,
    );
    expect(
      page,
      "no push of the assessment URL — that would leave the submittable door in history",
    ).not.toMatch(/router\.push\(`\/assessment\/\$\{data\.sessionId\}`/);
    expect(page, "the dead ?openingA=yes hint is removed").not.toMatch(/openingA=yes/);
  });

  it("9. changing Opening A requires the restart flow, not ordinary response editing", () => {
    const route = read("app/api/session/[id]/response/route.ts");
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The lock derives from the FRONT_DOOR set, not a bare OPEN_A literal.
    expect(code).toMatch(/FRONT_DOOR_ITEM_IDS\.includes\(itemId\)/);
    expect(code, "no bare OPEN_A literal check").not.toMatch(/itemId === "OPEN_A"/);
    // The refusal points to starting a new assessment — the intentional restart
    // flow — rather than accepting an in-place edit.
    expect(code).toMatch(/start a new assessment/);
  });

  it("10. FRONT_DOOR_ITEM_IDS is derived from the opening bank, not a second literal list", () => {
    expect(FRONT_DOOR_ITEM_IDS).toEqual(["OPEN_A"]);
    expect(FRONT_DOOR_ITEM_IDS).toEqual(
      QUESTION_BANK.opening
        .filter((q) => q.internal_id !== "OPEN_B")
        .map((q) => q.internal_id),
    );
    // The discriminator: a literal ["OPEN_A"] would coincide today, so also
    // assert the SOURCE derives it from the opening bank.
    const src = read("lib/ui/questions.ts");
    expect(src).toMatch(
      /FRONT_DOOR_ITEM_IDS:\s*readonly string\[\]\s*=\s*QUESTION_BANK\.opening/,
    );
  });
});
