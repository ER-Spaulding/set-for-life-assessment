import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * D-1 RECOVERY — carrying a provisional sitting's answers forward.
 *
 * Owner policy 2026-10-06, in the owner's own terms:
 *
 *   "I do not want provisional answers from today silently merged into P2's
 *    pre-existing in-progress assessment. Those answers may represent two
 *    different sittings and two different points in time."
 *
 * So the destination is ALWAYS a fresh session owned by the verified
 * participant, and the participant's older session is never written to. These
 * tests pin the four properties that make that safe:
 *
 *   1. the destination is NEW — no existing session is mutated;
 *   2. answers travel by STABLE ITEM ID, not by position or sequence;
 *   3. the older session's answers are untouched (no silent blend);
 *   4. a failure does not leave a half-populated session.
 *
 * The fourth is the one that would be invisible in production: a session
 * missing some answers still renders, still looks like an assessment, and only
 * surfaces as a wrong Snapshot at the very end.
 */

const m = vi.hoisted(() => ({
  // Rows the provisional session holds, and rows written to the destination.
  provisionalRows: [] as { item_id: string; option_code: string; open_text: string | null }[],
  insertedSession: null as Record<string, unknown> | null,
  insertedResponses: [] as Record<string, unknown>[],
  failSessionInsert: false,
  failResponseInsert: false,
  throwOnRead: false,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/client", () => ({
  serviceClient: () => ({
    from(table: string) {
      if (table === "responses") {
        return {
          select: () => ({
            eq: () => {
              if (m.throwOnRead) return Promise.resolve({ data: null, error: { message: "boom" } });
              return Promise.resolve({ data: m.provisionalRows, error: null });
            },
          }),
          insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
            if (m.failResponseInsert) {
              return Promise.resolve({ error: { message: "insert failed" } });
            }
            m.insertedResponses.push(...(Array.isArray(rows) ? rows : [rows]));
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "assessment_sessions") {
        return {
          insert: (row: Record<string, unknown>) => {
            m.insertedSession = row;
            return {
              select: () => ({
                single: () =>
                  m.failSessionInsert
                    ? Promise.resolve({ data: null, error: { message: "insert failed" } })
                    : Promise.resolve({ data: { session_id: "new-session-id" }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
  isDatabaseConfigured: () => true,
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

vi.mock("@/lib/session/service", () => ({
  pinnedVersion: () => "1.0",
}));

const { carryForwardProvisionalAnswers, readSessionAnswers } = await import(
  "@/lib/session/recovery"
);

beforeEach(() => {
  vi.clearAllMocks();
  m.provisionalRows = [];
  m.insertedSession = null;
  m.insertedResponses = [];
  m.failSessionInsert = false;
  m.failResponseInsert = false;
  m.throwOnRead = false;
});

describe("the destination session", () => {
  it("is a NEW session owned by the VERIFIED participant", async () => {
    m.provisionalRows = [{ item_id: "Q7", option_code: "Q7_C", open_text: null }];

    const result = await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });

    expect(result.sessionId).toBe("new-session-id");
    expect(m.insertedSession).toMatchObject({
      participant_id: "verified-pid",
      status: "in_progress",
    });
  });

  it("does NOT supply assessment_number — the trigger assigns it", async () => {
    // Supplying one would risk colliding with the participant's existing
    // session and would be an attempt to renumber history. The DB owns this.
    m.provisionalRows = [{ item_id: "Q7", option_code: "Q7_C", open_text: null }];
    await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(m.insertedSession).not.toHaveProperty("assessment_number");
  });

  it("refuses when the provisional session holds nothing to carry", async () => {
    m.provisionalRows = [];
    await expect(
      carryForwardProvisionalAnswers({
        verifiedParticipantId: "verified-pid",
        provisionalSessionId: "prov-session",
      }),
    ).rejects.toThrow(/no answers to carry forward/);
    // Nothing was created — an empty session would be a phantom assessment.
    expect(m.insertedSession).toBeNull();
  });
});

describe("answers travel by stable item id", () => {
  it("copies item_id and option_code verbatim", async () => {
    m.provisionalRows = [
      { item_id: "Q7", option_code: "Q7_C", open_text: null },
      { item_id: "Q16", option_code: "Q16_A", open_text: null },
    ];
    await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(m.insertedResponses).toEqual([
      { session_id: "new-session-id", item_id: "Q7", option_code: "Q7_C", open_text: null },
      { session_id: "new-session-id", item_id: "Q16", option_code: "Q16_A", open_text: null },
    ]);
  });

  it("keeps a multi-select set whole (one row per chosen option)", async () => {
    m.provisionalRows = [
      { item_id: "Q1", option_code: "Q1_A", open_text: null },
      { item_id: "Q1", option_code: "Q1_B", open_text: null },
    ];
    const r = await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    // One ITEM, two rows — the count the participant sees is items, not rows.
    expect(r.carriedItems).toBe(1);
    expect(m.insertedResponses).toHaveLength(2);
  });

  it("carries OPEN_A — the participant's own answer, not a system-derived one", async () => {
    // §5 makes Opening A self-reported status, deliberately separate from the
    // system-known assessment count. The answer the participant gave at THIS
    // sitting is the faithful one.
    m.provisionalRows = [{ item_id: "OPEN_A", option_code: "OPEN_A_A", open_text: null }];
    await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(m.insertedResponses).toContainEqual(
      expect.objectContaining({ item_id: "OPEN_A", option_code: "OPEN_A_A" }),
    );
  });

  it("carries OPEN_B — the pre-assessment BASELINE must not be re-asked", async () => {
    // OWNER RULING 2026-10-06. OPEN_B is the participant's baseline:
    // "Before we get started, how 'Set for Life' do you feel financially right
    // now?" Re-asking it AFTER several assessment questions would elicit an
    // answer to a different question — how they feel NOW, having been primed by
    // the instrument — and the baseline would no longer be a baseline.
    //
    // The governing rule is general: "If the participant already answered a
    // required assessment item during the current provisional sitting, successful
    // identity recovery should not require them to answer that item again."
    // OPEN_B is the item where violating it does the most damage.
    m.provisionalRows = [
      { item_id: "OPEN_A", option_code: "OPEN_A_A", open_text: null },
      { item_id: "OPEN_B", option_code: "OPEN_B_D", open_text: null },
    ];
    await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(m.insertedResponses).toContainEqual(
      expect.objectContaining({ item_id: "OPEN_B", option_code: "OPEN_B_D" }),
    );
  });

  it("applies NO item filter — every answered item travels", async () => {
    // The carry-forward is deliberately unfiltered. A filter would be a place
    // for a required item to silently stop travelling, and the symptom would be
    // a participant re-answering something they already answered — invisible in
    // tests that only check the items they thought to list.
    m.provisionalRows = [
      { item_id: "OPEN_A", option_code: "OPEN_A_A", open_text: null },
      { item_id: "OPEN_B", option_code: "OPEN_B_B", open_text: null },
      { item_id: "Q7", option_code: "Q7_C", open_text: null },
      { item_id: "Q25", option_code: "Q25_E", open_text: null },
      { item_id: "A1", option_code: "A1_D", open_text: null },
    ];
    const r = await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(r.carriedItems).toBe(5);
    expect(m.insertedResponses.map((x) => x.item_id).sort()).toEqual(
      ["A1", "OPEN_A", "OPEN_B", "Q25", "Q7"].sort(),
    );
  });

  it("de-duplicates an identical (item, option) pair", async () => {
    m.provisionalRows = [
      { item_id: "Q7", option_code: "Q7_C", open_text: null },
      { item_id: "Q7", option_code: "Q7_C", open_text: null },
    ];
    await carryForwardProvisionalAnswers({
      verifiedParticipantId: "verified-pid",
      provisionalSessionId: "prov-session",
    });
    expect(m.insertedResponses).toHaveLength(1);
  });
});

describe("failure never leaves a half-populated session", () => {
  it("THROWS when the answer copy fails, so the caller can retry", async () => {
    m.provisionalRows = [{ item_id: "Q7", option_code: "Q7_C", open_text: null }];
    m.failResponseInsert = true;
    await expect(
      carryForwardProvisionalAnswers({
        verifiedParticipantId: "verified-pid",
        provisionalSessionId: "prov-session",
      }),
    ).rejects.toThrow(/carry forward answers/);
  });

  it("THROWS when the destination session cannot be created", async () => {
    m.provisionalRows = [{ item_id: "Q7", option_code: "Q7_C", open_text: null }];
    m.failSessionInsert = true;
    await expect(
      carryForwardProvisionalAnswers({
        verifiedParticipantId: "verified-pid",
        provisionalSessionId: "prov-session",
      }),
    ).rejects.toThrow(/create destination session/);
    // No answers written against a session that does not exist.
    expect(m.insertedResponses).toEqual([]);
  });

  it("THROWS when the provisional answers cannot be read", async () => {
    m.throwOnRead = true;
    await expect(
      carryForwardProvisionalAnswers({
        verifiedParticipantId: "verified-pid",
        provisionalSessionId: "prov-session",
      }),
    ).rejects.toThrow(/read provisional responses/);
    expect(m.insertedSession).toBeNull();
  });
});

describe("readSessionAnswers reports what a session holds", () => {
  it("groups rows by item id into the shape resumeIndex expects", async () => {
    m.provisionalRows = [
      { item_id: "Q1", option_code: "Q1_A", open_text: null },
      { item_id: "Q1", option_code: "Q1_B", open_text: null },
      { item_id: "Q7", option_code: "Q7_C", open_text: null },
    ];
    const answers = await readSessionAnswers("any-session");
    expect(answers).toEqual({ Q1: ["Q1_A", "Q1_B"], Q7: ["Q7_C"] });
  });
});
