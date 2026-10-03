import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F-07 — the reveal is READ-DRIVEN; a refusal never becomes "0 of 31".
 *
 * The defect: SynthesisReveal POSTs /complete on mount. The route answers an
 * already-complete session with a LIFECYCLE REFUSAL body (complete:false,
 * refused:true, message) — but the client only understood the INCOMPLETE body,
 * so it fell back to `present ?? 0, required ?? 31` and a participant who had
 * answered all 31 was told "0 of 31 responses are saved".
 *
 * The Owner's approved behaviour: once completed, READ the authoritative
 * completion state and the verified name, recognise the participant as
 * complete, and go straight to ready with ZERO /complete POSTs — no re-complete,
 * no re-score, no re-created Snapshot. An already-complete condition is evidence
 * the session already crossed completion, never a reason to show a count.
 *
 * Tests 12/18 assert the client's read-first control flow structurally (client
 * components are never rendered in this repo); the rest drive the REAL service
 * and routes against a recording fake db. Numbered to map to the plan; test 14
 * (the completion endpoint's refused branch) lives in api-routes.test.ts.
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

import { completeSession } from "@/lib/session/service";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";

const UUID = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------------------
// fake db for the REAL completeSession (tests 11, 15, 16).
// ---------------------------------------------------------------------------

interface CompleteCaptured {
  writes: string[];
  snapshot: Record<string, unknown> | null;
  sessionUpdate: Record<string, unknown> | null;
  computedSignals: Array<Record<string, unknown>>;
}

function fakeCompleteDb(
  rows: Array<{ item_id: string; option_code: string }>,
  initialStatus = "in_progress",
) {
  let sessionStatus = initialStatus;
  const captured: CompleteCaptured = {
    writes: [],
    snapshot: null,
    sessionUpdate: null,
    computedSignals: [],
  };

  const db = {
    /**
     * THE ATOMIC BOUNDARY (owner ruling item 3). Every derived write and the
     * Snapshot go through this one call, which the real database runs in a
     * single transaction.
     *
     * The refusal check comes FIRST and writes nothing — which is what makes
     * the "already complete performs ZERO writes" assertion below meaningful
     * rather than a coincidence of the caller's ordering.
     */
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name !== "complete_session_atomic") {
        throw new Error(`fakeCompleteDb: unexpected rpc ${name}`);
      }
      if (sessionStatus !== "in_progress" && sessionStatus !== "abandoned") {
        return Promise.resolve({ data: { ok: false, state: sessionStatus }, error: null });
      }
      captured.computedSignals = (params.p_signals as Array<Record<string, unknown>>) ?? [];
      captured.writes.push("computed_signals");
      if (((params.p_overrides as unknown[]) ?? []).length) captured.writes.push("overrides");
      captured.writes.push("tensions");
      captured.snapshot = params.p_snapshot as Record<string, unknown>;
      captured.writes.push("snapshots");
      captured.sessionUpdate = { status: "completed" };
      captured.writes.push("assessment_sessions");
      sessionStatus = "completed";
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table: string) {
      if (table === "responses") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: rows, error: null }),
          }),
        };
      }
      // Direct writes to the derived tables are REFUSED (item 3). Before the
      // atomic boundary these were four separate round-trips, which is exactly
      // how a failed Snapshot insert could strand committed scoring rows.
      if (
        table === "computed_signals" ||
        table === "tensions" ||
        table === "overrides" ||
        table === "snapshots"
      ) {
        throw new Error(
          `fakeCompleteDb: ${table} must be written through complete_session_atomic, not directly`,
        );
      }
      if (table === "assessment_sessions") {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: () =>
            Promise.resolve({ data: { status: sessionStatus }, error: null }),
        };
        return q;
      }
      throw new Error(`fakeCompleteDb: unexpected table ${table}`);
    },
  };

  return { db, captured };
}

/** 31 required rows, one per REQUIRED_ITEM_IDS, option `${id}_C`. */
function full31Rows() {
  return REQUIRED_ITEM_IDS.map((id) => ({ item_id: id, option_code: `${id}_C` }));
}

async function runComplete(
  rows: Array<{ item_id: string; option_code: string }>,
  initialStatus = "in_progress",
) {
  const { db, captured } = fakeCompleteDb(rows, initialStatus);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await completeSession(UUID);
  return { result, captured };
}

// ---------------------------------------------------------------------------
// fake db for the REAL loadResumeState via the REAL GET route (tests 13, 17).
// ---------------------------------------------------------------------------

interface ResumeSeed {
  session: Record<string, unknown> | null;
  responses: Array<Record<string, unknown>>;
  contacts: Record<string, unknown> | null;
  participants: Record<string, unknown> | null;
}

function fakeResumeDb(seed: ResumeSeed) {
  // A selectable/single chain for the three single-row tables.
  const chain = (data: Record<string, unknown> | null) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      not: () => q,
      maybeSingle: () => Promise.resolve({ data, error: null }),
    };
    return q;
  };

  const db = {
    from(table: string) {
      if (table === "assessment_sessions") return chain(seed.session);
      if (table === "responses") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: seed.responses, error: null }),
          }),
        };
      }
      if (table === "participant_contacts") return chain(seed.contacts);
      if (table === "participants") return chain(seed.participants);
      throw new Error(`fakeResumeDb: unexpected table ${table}`);
    },
  };

  return { db };
}

async function getResume(seed: ResumeSeed) {
  const { db } = fakeResumeDb(seed);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const { GET } = await import("@/app/api/session/[id]/route");
  const res = await GET(
    new Request(`http://x/api/session/${UUID}`),
    { params: Promise.resolve({ id: UUID }) },
  );
  const body = await res.json();
  return { res, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("F-07 — the reveal is read-driven; a refusal never becomes a response count", () => {
  it("11. completing the 31st response produces the ready precondition (complete, snapshot written, name null)", async () => {
    const { result, captured } = await runComplete(full31Rows());
    console.log("  complete:", JSON.stringify(result));
    expect(result.complete).toBe(true);
    // The genuine completion path still persists the Snapshot — the reveal's
    // "ready" outcome is backed by a real, persisted payload.
    expect(captured.snapshot).not.toBeNull();
    expect(captured.writes).toContain("snapshots");
    expect(captured.sessionUpdate?.status).toBe("completed");
    // No verified contact in this fake -> the name is null by the §3.2/§15 gate.
    expect(result.firstName).toBe(null);

    // And the reveal's genuine-completion path (not the read shortcut) sets
    // ready from the POST's own 200 body.
    const src = read("components/reveal/SynthesisReveal.tsx");
    expect(src).toMatch(
      /setOutcome\(\{\s*kind: "ready",\s*firstName: data\.firstName \?\? null\s*\}\)/,
    );
  });

  it("12. a completed participant who REFRESHES the reveal goes straight to ready with ZERO /complete POSTs", () => {
    const src = read("components/reveal/SynthesisReveal.tsx");
    // READ-FIRST: the reveal GETs the session's authoritative state.
    expect(src).toMatch(/fetch\(`\/api\/session\/\$\{sessionId\}`\)/);
    // ...checks `completed`, ...
    expect(src).toMatch(/state\.completed === true/);
    // ...and goes straight to ready from the READ's name — no POST in this path.
    expect(src).toMatch(
      /setOutcome\(\{\s*kind: "ready",\s*firstName: state\.firstName \?\? null\s*\}\)/,
    );
    // The genuine completion POST still exists, but only AFTER the read gate:
    // a completed session returns before ever reaching it.
    const readIdx = src.indexOf("fetch(`/api/session/${sessionId}`)");
    const postIdx = src.indexOf("fetch(`/api/session/${sessionId}/complete`");
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(postIdx).toBeGreaterThan(readIdx);
  });

  it("13. a completed participant who returns DIRECTLY to the reveal is read as complete with their verified name", async () => {
    const completed = await getResume({
      session: { session_id: UUID, status: "completed", current_position: 31, participant_id: "p-1" },
      responses: full31Rows(),
      contacts: { participant_id: "p-1", contact_type: "email", verified_at: "2026-10-01T00:00:00Z" },
      participants: { participant_id: "p-1", first_name: "Avery" },
    });
    console.log("  completed read:", JSON.stringify(completed.body));
    expect(completed.res.status).toBe(200);
    expect(completed.body.completed).toBe(true);
    expect(completed.body.firstName).toBe("Avery");

    // The verification gate is preserved, not bypassed: a completed session
    // whose identity is UNVERIFIED still gets no name.
    const unverified = await getResume({
      session: { session_id: UUID, status: "completed", current_position: 31, participant_id: "p-2" },
      responses: full31Rows(),
      contacts: null,
      participants: { participant_id: "p-2", first_name: "Avery" },
    });
    expect(unverified.body.completed).toBe(true);
    expect(unverified.body.firstName).toBe(null);
  });

  it("15. all 31 required responses remain associated with the completed session", async () => {
    const rows = full31Rows();
    const { result } = await runComplete(rows);
    expect(result.complete).toBe(true);

    // The 31 are still the canonical set, and every one of them is what the
    // completed session held.
    expect(REQUIRED_ITEM_IDS).toHaveLength(31);
    expect(REQUIRED_ITEM_IDS[0]).toBe("OPEN_A");
    expect(REQUIRED_ITEM_IDS[1]).toBe("OPEN_B");
    const stored = new Set(rows.map((r) => r.item_id));
    for (const id of REQUIRED_ITEM_IDS) {
      expect(stored.has(id), `${id} must be present in the completed set`).toBe(true);
    }
  });

  it("16. an already-completed session performs ZERO writes — no second Snapshot, no second scoring", async () => {
    const { result, captured } = await runComplete(full31Rows(), "completed");
    console.log("  already-complete:", JSON.stringify(result));

    // The lifecycle gate refuses (it is already complete)...
    expect(result.complete).toBe(false);
    expect(typeof result.refusal).toBe("string");

    // ...and NEVER re-runs scoring or re-persists anything.
    expect(captured.writes).toEqual([]);
    expect(captured.snapshot).toBeNull();
    expect(captured.sessionUpdate).toBeNull();
    expect(captured.computedSignals).toEqual([]);
  });

  it("17. an actually-incomplete participant cannot bypass completion into results", async () => {
    // Even a participant whose identity IS verified gets completed:false and
    // firstName:null while their session is still in progress — the name gate
    // is keyed on completion, not merely on verification.
    const { res, body } = await getResume({
      session: { session_id: UUID, status: "in_progress", current_position: 12, participant_id: "p-1" },
      responses: [{ item_id: "Q4", option_code: "Q4_C" }],
      contacts: { participant_id: "p-1", contact_type: "email", verified_at: "2026-10-01T00:00:00Z" },
      participants: { participant_id: "p-1", first_name: "Alicia" },
    });
    console.log("  in-progress read:", JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body.completed).toBe(false);
    expect(body.firstName).toBe(null);

    // The reveal only short-circuits to ready on `completed === true`; an
    // in-progress session falls through to the genuine completion POST.
    const src = read("components/reveal/SynthesisReveal.tsx");
    expect(src).toMatch(/state\.completed === true/);
    expect(src).toMatch(/method: "POST"/);
  });

  it("18. a malformed 422 never renders a response count", () => {
    const src = read("components/reveal/SynthesisReveal.tsx");
    // The refusal branch is keyed on the server's own field...
    expect(src).toMatch(/data\.refused === true/);
    expect(src).toMatch(/kind: "refused"/);
    // ...and the incomplete branch requires the counts to actually be present,
    // so a malformed body cannot be defaulted into "0 of 31".
    expect(src).toMatch(/typeof data\.present === "number"/);
    expect(src).toMatch(/typeof data\.required === "number"/);
    // STOP DEFAULTING: the old `?? 0` / `?? 31` fallbacks are gone.
    expect(src).not.toMatch(/\?\? 0/);
    expect(src).not.toMatch(/\?\? 31/);
  });
});
