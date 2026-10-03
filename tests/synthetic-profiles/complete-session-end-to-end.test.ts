import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `completeSession` executed END TO END, with the database stubbed.
 *
 * WHY THIS FILE EXISTS.
 *
 * The activation defect (see tests/unit/activation-tension-wiring.test.ts) was
 * invisible to 159 passing tests because NONE of them ever ran the completion
 * path. Every tension test built its own `TensionInputs` and called
 * `evaluateTensions` directly; every service test read `lib/session/service.ts`
 * as TEXT and asserted on substrings. So the one thing nobody tested was the
 * thing that was broken: what `completeSession` actually computes and writes.
 *
 * A structural assertion proves a string is present. It cannot prove the
 * function behaves. This file closes that gap: the Supabase client is stubbed
 * with a minimal in-memory fake, and the REAL `completeSession` runs against it
 * — real scoring, real classifier tags, real tension evaluation, real
 * derivation — with the persisted rows captured and asserted.
 *
 * This is the cross-check the write/read-convention false-green lesson calls
 * for: exercise the PRODUCER, not a fixture that encodes the consumer's
 * assumptions.
 */

// `lib/session/service.ts` is server-only and throws on a bare import outside
// react-server. Mock the marker so the module can be loaded under Vitest.
vi.mock("server-only", () => ({}));

import { completeSession } from "@/lib/session/service";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";

const repo = resolve(__dirname, "../..");

/**
 * Minimal in-memory stand-in for the Supabase service client.
 *
 * LIMITATION, STATED PLAINLY: this fake accepts ANY column name, because it
 * has no schema. It therefore cannot catch a SQL column mismatch — and one
 * shipped (`computed_signals` was written with `signal`/`value`/
 * `special_state`, none of which exist), failing every completion while this
 * suite stayed green. That class of defect is covered by
 * tests/integration/schema-column-contract.test.ts, which checks the column
 * names against the real migration, and was confirmed against a live Postgres.
 * Keep both: this file proves BEHAVIOUR, that one proves the SQL is well-formed.
 */
interface Captured {
  computedSignals: Array<Record<string, unknown>>;
  tensions: Array<Record<string, unknown>>;
  overrides: Array<Record<string, unknown>>;
  /** The persisted Snapshot payload (Addendum 01 §3/§5). */
  snapshot: Record<string, unknown> | null;
  /** Order of operations, so the payload-before-completion contract is testable. */
  writes: string[];
  sessionUpdate: Record<string, unknown> | null;
  /**
   * EVERY update to assessment_sessions, in order. F-08 needs to distinguish
   * the resume (status -> in_progress) from the terminal flip (status ->
   * completed), which `sessionUpdate` alone (last write) cannot.
   */
  sessionUpdates: Array<Record<string, unknown>>;
}

function fakeDb(
  rows: Array<{ item_id: string; option_code: string }>,
  /**
   * The session's starting lifecycle status.
   *
   * `in_progress` by default so existing tests exercise the normal path. Tests
   * for the lifecycle gate pass 'expired' or 'abandoned' to prove the refusal.
   */
  initialStatus = "in_progress",
  /**
   * Simulate the sweep expiring the session BETWEEN completeSession's status
   * read and its guarded resume write — the race the guard exists for.
   */
  opts: { sweepWinsRace?: boolean } = {},
) {
  let sessionStatus = initialStatus;
  let raceFired = false;
  const captured: Captured = {
    computedSignals: [],
    tensions: [],
    overrides: [],
    snapshot: null,
    writes: [],
    sessionUpdate: null,
    sessionUpdates: [],
  };

  const db = {
    from(table: string) {
      if (table === "responses") {
        const q = {
          select: () => q,
          eq: () => Promise.resolve({ data: rows, error: null }),
        };
        return q;
      }
      if (table === "computed_signals") {
        return {
          upsert: (payload: Array<Record<string, unknown>>) => {
            captured.computedSignals = payload;
            captured.writes.push("computed_signals");
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "tensions") {
        return {
          upsert: (payload: Array<Record<string, unknown>>) => {
            captured.tensions = payload;
            captured.writes.push("tensions");
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "overrides") {
        return {
          upsert: (payload: Array<Record<string, unknown>>) => {
            captured.overrides = payload;
            captured.writes.push("overrides");
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "snapshots") {
        return {
          insert: (payload: Record<string, unknown>) => {
            captured.snapshot = payload;
            captured.writes.push("snapshots");
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "assessment_sessions") {
        // The fake serves BOTH operations the real code performs on this table:
        // a status READ (the lifecycle gate added 2026-10-01) and a status
        // UPDATE (completion).
        //
        // The read was added because `completeSession` now checks the session's
        // lifecycle before scoring. A fake that could not answer that read would
        // crash rather than test anything — and the tempting shortcut, deleting
        // the guard so the old fake passes, would remove the check the operator
        // required. Serving the read keeps the guard under test.
        // The guarded resume writes `.eq("status", "abandoned")` — a status
        // PREDICATE, not just a session-id match. The fake records the
        // predicates it was given so a test can assert the guard exists, and
        // `sweepWinsRace` lets a test simulate the sweep expiring the session
        // BETWEEN completeSession's status read and its resume write.
        // A FRESH chain per call, and the update is EVALUATED ONLY WHEN THE
        // CHAIN RESOLVES. Supabase's builder is lazy: `update(payload).eq(...)
        // .eq(...).select()` collects every predicate BEFORE it issues the
        // statement. An eager fake that matched on the predicates collected so
        // far would see NONE of the chained `.eq()`s — which is precisely how a
        // test asserting "the guard works" passes or fails for the wrong reason.
        // The first attempt at this fake had exactly that defect and reported a
        // spurious failure; the fake, not the production code, was wrong.
        const table = "assessment_sessions";
        function chain() {
          const predicates: Array<[string, unknown]> = [];
          const state: { payload?: Record<string, unknown> } = {};
          const builder: Record<string, unknown> = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
              predicates.push([col, val]);
              return builder;
            },
            maybeSingle: () =>
              Promise.resolve({ data: { status: sessionStatus }, error: null }),
            update: (payload: Record<string, unknown>) => {
              state.payload = payload;
              return builder;
            },
            // `select()` after an update is what resolves the statement.
            then: (resolve: (v: unknown) => unknown) => {
              if (state.payload === undefined) {
                // A plain select chain (the status read).
                return Promise.resolve({ data: { status: sessionStatus }, error: null }).then(
                  resolve,
                );
              }
              const payload = state.payload;
              captured.sessionUpdate = payload;
              captured.sessionUpdates.push(payload);
              captured.writes.push(table);

              // THE RACE. When armed, the sweep lands before this guarded update
              // is issued: the row becomes `expired`, so the WHERE no longer
              // holds. That is the interleaving the guard exists for — the status
              // completeSession acted on was read earlier and is now stale.
              if (opts.sweepWinsRace && !raceFired) {
                raceFired = true;
                sessionStatus = "expired";
              }

              const statusGuard = predicates.find(([c]) => c === "status");
              const matched = statusGuard === undefined || statusGuard[1] === sessionStatus;
              if (matched && typeof payload.status === "string") sessionStatus = payload.status;
              const rows = matched ? [{ status: sessionStatus }] : [];
              return Promise.resolve({ data: rows, error: null }).then(resolve);
            },
          };
          return builder;
        }
        return {
          select: () => chain(),
          update: (payload: Record<string, unknown>) => {
            const b = chain();
            (b.update as (p: Record<string, unknown>) => unknown)(payload);
            return b;
          },
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };

  return { db, captured };
}

vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

/** Build stored response rows for a full 31-item set, with overrides. */
function storedRows(overrides: Record<string, string | string[]>) {
  const base: Record<string, string> = {};
  for (const id of REQUIRED_ITEM_IDS) {
    base[id] = `${id}_C`; // neutral middle for every item
  }
  const merged = { ...base, ...overrides };
  const rows: Array<{ item_id: string; option_code: string }> = [];
  for (const [item, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      for (const v of value) rows.push({ item_id: item, option_code: v });
    } else {
      rows.push({ item_id: item, option_code: value });
    }
  }
  return rows;
}

async function run(overrides: Record<string, string | string[]>) {
  const { db, captured } = fakeDb(storedRows(overrides));
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await completeSession("11111111-2222-3333-4444-555555555555");
  return { result, captured };
}

/**
 * Run the REAL completeSession against a fake db whose starting status is
 * explicit. The `initialStatus` parameter of `fakeDb` was previously unused by
 * every test here (all completed from `in_progress`); F-08 is the first caller
 * that needs a status read and a responses read to disagree — the session row
 * says `abandoned`/`expired`/`completed` while the responses table still holds
 * the full 31.
 */
async function runWithStatus(
  rows: Array<{ item_id: string; option_code: string }>,
  initialStatus: string,
) {
  const { db, captured } = fakeDb(rows, initialStatus);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await completeSession("11111111-2222-3333-4444-555555555555");
  return { result, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("completeSession end to end — the activation fix reaches the persisted tensions", () => {
  it("persists the activation-driven codes when the participant really chose HIGH", async () => {
    // A1 HIGH + fear on Q21 + A4 HIGH + weak Q22. Under the old hardcoded
    // all-MID activation this wrote NO activation-driven tension at all.
    const { result, captured } = await run({
      A1: "A1_D", // HIGH
      A2: "A2_C", // MID
      A3: "A3_C", // MID
      A4: "A4_D", // HIGH
      Q21: "Q21_A", // fear present
      Q22: "Q22_A", // low -> support-openness clause
    });

    const codes = captured.tensions.map((t) => t.tension_code as string);
    console.log("  completed:", JSON.stringify(result));
    console.log("  persisted tensions:", JSON.stringify(codes));

    expect(result.complete).toBe(true);
    expect(codes).toContain("HIGH_FEAR_HIGH_ACTIVATION");
    expect(codes).toContain("SUPPORT_OPENNESS_AGENCY_VULNERABILITY");
  });

  it("the same profile with all-MID activation persists NEITHER code — the defect, reproduced", async () => {
    const { captured } = await run({
      A1: "A1_C", // MID
      A2: "A2_C",
      A3: "A3_C",
      A4: "A4_C", // MID
      Q21: "Q21_A",
      Q22: "Q22_A",
    });
    const codes = captured.tensions.map((t) => t.tension_code as string);
    console.log("  all-MID persisted tensions:", JSON.stringify(codes));
    expect(codes).not.toContain("HIGH_FEAR_HIGH_ACTIVATION");
    expect(codes).not.toContain("SUPPORT_OPENNESS_AGENCY_VULNERABILITY");
  });

  it("a capacity-OVERRIDDEN signal still matches rules — the ladder state drives them", async () => {
    // THE DISCRIMINATING CASE, verified by probe before being asserted.
    //
    // Q11_A is a capacity override: it excludes Q11 from the DIRECT mean and
    // puts DIRECT in the special state DIRECT_CAPACITY_LIMITED. This profile
    // computes DIRECT value 5 with:
    //     state        = "S5"                       <- the ladder position
    //     displayState = "DIRECT_CAPACITY_LIMITED"  <- what the report renders
    //
    // HIGH_ACTIVITY_LOW_DIRECTION requires DIRECT state_in [S4, S5] AND AIM
    // state_in [S1, S2]. Feeding displayState (the sibling defect) means DIRECT
    // reads "DIRECT_CAPACITY_LIMITED", which is not S4/S5, so the rule matched
    // NOTHING — even though the participant's Agency is genuinely high.
    //
    // This is why the assertion is meaningful: the two states differ, and only
    // one of them satisfies the rule.
    const { captured } = await run({
      Q10: "Q10_E",
      Q11: "Q11_A", // capacity override -> DIRECT_CAPACITY_LIMITED
      Q12: "Q12_E",
      Q17: "Q17_A",
      Q18: "Q18_C",
      Q19: "Q19_A",
    });
    const codes = captured.tensions.map((t) => t.tension_code as string);
    const direct = captured.computedSignals.find((s) => s.signal_id === "DIRECT");
    console.log("  DIRECT persisted:", JSON.stringify(direct));
    console.log("  overrides persisted:", JSON.stringify(captured.overrides));
    console.log("  capacity-constrained tensions:", JSON.stringify(codes));

    // Precondition: the override really did fire, or the test is vacuous.
    //
    // The off-ladder state lands in the OVERRIDES table, not on
    // computed_signals — §22.3 gives that table no column for it. Asserting it
    // here rather than on the signal row is what the schema requires, and an
    // earlier version of this test asserted `direct.special_state`, a column
    // that does not exist.
    const overrideCodes = captured.overrides.map((o) => o.override_code as string);
    expect(overrideCodes).toContain("DIRECT_CAPACITY_LIMITED");
    expect(overrideCodes).toContain("Q11_CAPACITY_OVERRIDE");
    const directOverride = captured.overrides.find(
      (o) => o.override_code === "DIRECT_CAPACITY_LIMITED",
    );
    expect((directOverride?.payload as { signal?: string })?.signal).toBe("DIRECT");

    expect(direct?.state).toBe("S5");
    expect(direct).not.toHaveProperty("special_state");
    expect(codes).toContain("HIGH_ACTIVITY_LOW_DIRECTION");

    // AND the confidence tier must reflect the override. This signal has
    // value 5 and state S5 — the strongest possible reading — but the config's
    // LIMITED band covers "override-constrained" evidence, so the tier must NOT
    // be high. Asserting this is what makes the test detect the hardcoded
    // placeholder: a blanket "high" satisfies a membership check but fails here.
    console.log("  DIRECT evidence_confidence:", direct?.evidence_confidence);
    expect(direct?.evidence_confidence).toBe("limited");
  });

  it("writes all six signals with a lowercased evidence_confidence the DB accepts", async () => {
    const { captured } = await run({ Q4: "Q4_E", Q5: "Q5_E", Q6: "Q6_E" });
    const signals = captured.computedSignals.map((s) => s.signal_id as string);
    console.log(
      "  signals:",
      JSON.stringify(
        captured.computedSignals.map((s) => [s.signal_id, s.evidence_confidence]),
      ),
    );
    expect(signals.sort()).toEqual(
      ["AIM", "DIRECT", "MOVE", "PREPARE", "ROOM", "SEE"].sort(),
    );

    // The DB CHECK constraint accepts ONLY these three lowercase strings.
    const schema = readFileSync(
      resolve(repo, "supabase/migrations/20260930000001_initial_schema.sql"),
      "utf8",
    );
    const allowed = schema
      .match(/evidence_confidence IN \(([^)]*)\)/)![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(allowed).toEqual(["high", "moderate", "limited"]);

    for (const s of captured.computedSignals) {
      expect(allowed, `confidence ${String(s.evidence_confidence)} must be writable`)
        .toContain(s.evidence_confidence);
    }
  });

  it("a strongly corroborated extreme signal persists confidence 'high'", async () => {
    // The other end of the derivation. SEE is fed by Q4/Q5/Q6; all three at the
    // top of the scale gives value 5, state S5, and 3 corroborating items — the
    // config's HIGH band ("extreme signal state S1/S5 with 2+ corroborating
    // items"). Without this assertion the suite could not distinguish a real
    // derivation from a blanket literal, since 'high' is also a legal value.
    const { captured } = await run({ Q4: "Q4_E", Q5: "Q5_E", Q6: "Q6_E" });
    const see = captured.computedSignals.find((s) => s.signal_id === "SEE");
    console.log("  SEE persisted:", JSON.stringify(see));
    expect(see?.state).toBe("S5");
    expect(see?.evidence_confidence).toBe("high");
  });

  it("the same signal with ONE item answered caps below 'high'", async () => {
    // Corroboration must matter: a single strong item is not "strong
    // corroborated evidence" (which requires 2+). Q4 alone reaches SEE... but
    // SEE needs all three items present for a value, so this profile instead
    // uses a signal whose evidence is genuinely thin.
    //
    // ROOM draws on Q7/Q8 only; with Q7 strong and Q8 present but mixed the
    // state is no longer extreme, so it cannot be HIGH.
    const { captured } = await run({ Q7: "Q7_E", Q8: "Q8_C" });
    const room = captured.computedSignals.find((s) => s.signal_id === "ROOM");
    console.log("  ROOM persisted:", JSON.stringify(room));
    expect(room?.evidence_confidence).not.toBe("high");
  });

  it("marks the session completed only after scoring persisted", async () => {
    const { captured } = await run({});
    console.log("  session update:", JSON.stringify(captured.sessionUpdate));
    expect(captured.sessionUpdate?.status).toBe("completed");
    expect(typeof captured.sessionUpdate?.completed_at).toBe("string");
    expect(captured.computedSignals.length).toBe(6);
  });

  it("does NOT complete or score when an item is missing", async () => {
    const rows = storedRows({}).filter((r) => r.item_id !== "Q25");
    const { db, captured } = fakeDb(rows);
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);

    const result = await completeSession("11111111-2222-3333-4444-555555555555");
    console.log("  incomplete:", JSON.stringify(result));
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["Q25"]);
    // The server-authority gate (PRD §23.5): nothing is written.
    expect(captured.computedSignals).toEqual([]);
    expect(captured.sessionUpdate).toBeNull();
  });
});

describe("Snapshot payload is persisted at completion (Addendum 01 §3, §5)", () => {
  it("writes a snapshot row carrying the assembled payload", async () => {
    const { captured } = await run({ Q11: "Q11_A" });
    const snap = captured.snapshot as Record<string, unknown> | null;
    console.log("  snapshot columns:", JSON.stringify(Object.keys(snap ?? {})));
    expect(snap).not.toBeNull();
    expect(snap!.payload_json).toBeTruthy();
    // Both columns must hold the SAME object, or the two names drift.
    expect(snap!.payload_json).toEqual(snap!.rendered_payload_json);
    // Version pinning (§3).
    expect(snap!.report_version).toBe("1.0");
    expect(snap!.assessment_version).toBe("1.0");
    expect(snap!.question_bank_version).toBe("1.0");
    expect(snap!.scoring_config_version).toBe("1.0");
    expect(snap!.narrative_version).toBe("1.0");
    // §3.1's sixth pin. Asserted on the ROW, not just the payload — the two are
    // written from the same call, and a column that silently stopped being
    // populated would otherwise go unnoticed because the payload still had it.
    expect(snap!.interstitial_version).toBe("1.0");

    // And the payload must agree with the column, or the two names drift.
    const payload = snap!.payload_json as { versions: Record<string, string> };
    expect(payload.versions.interstitial).toBe(snap!.interstitial_version);
    console.log("  interstitial pin:", snap!.interstitial_version,
      "| payload agrees:", payload.versions.interstitial === snap!.interstitial_version);
  });

  it("the payload carries all six signals with resolvable narrative keys", async () => {
    const { captured } = await run({});
    const payload = captured.snapshot!.payload_json as {
      signals: Array<{ signal: string; narrativeKey: string | null }>;
    };
    console.log("  payload signals:", JSON.stringify(payload.signals.map((s) => [s.signal, s.narrativeKey])));
    expect(payload.signals).toHaveLength(6);
    for (const s of payload.signals) {
      expect(s.narrativeKey, `${s.signal} must carry a key`).toBeTruthy();
      const ok = s.narrativeKey!.startsWith("special_signal_states.")
        || /^signal_states\.[A-Z]+\.[S][1-5]$/.test(s.narrativeKey!);
      expect(ok, `bad key shape: ${s.narrativeKey}`).toBe(true);
    }
  });

  it("a capacity override reaches the payload as a special state", async () => {
    const { captured } = await run({ Q11: "Q11_A" });
    const payload = captured.snapshot!.payload_json as {
      signals: Array<{ signal: string; specialState: string | null; narrativeKey: string | null }>;
      bigPicture: { template: string };
    };
    const direct = payload.signals.find((s) => s.signal === "DIRECT")!;
    console.log("  DIRECT in payload:", JSON.stringify(direct));
    expect(direct.specialState).toBe("DIRECT_CAPACITY_LIMITED");
    expect(direct.narrativeKey).toBe("special_signal_states.DIRECT_CAPACITY_LIMITED");
    // §12.2: capacity context precedes agency criticism.
    expect(payload.bigPicture.template).toBe("CAPACITY_FIRST");
  });

  it("activation is four separate dimensions with no aggregate (§11, §17)", async () => {
    const { captured } = await run({ A1: "A1_D", A2: "A2_C", A3: "A3_E", A4: "A4_A" });
    const payload = captured.snapshot!.payload_json as {
      activation: Record<string, string>;
    };
    console.log("  payload activation:", JSON.stringify(payload.activation));
    expect(Object.keys(payload.activation).sort()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(payload.activation).not.toHaveProperty("score");
    expect(payload.activation).not.toHaveProperty("average");
    expect(payload.activation.A1).toBe("HIGH");
    expect(payload.activation.A4).toBe("LOW");
  });

  it("the payload is written BEFORE the session flips to completed", async () => {
    // ORDER IS LOAD-BEARING. The immutability triggers fire on completion, so a
    // payload written afterwards would be rejected — leaving a completed
    // session with no stored Snapshot, which is exactly the state §5 forbids.
    const { captured } = await run({});
    const w = captured.writes;
    console.log("  write order:", JSON.stringify(w));
    expect(w.indexOf("snapshots")).toBeGreaterThan(-1);
    expect(w.indexOf("snapshots")).toBeLessThan(w.indexOf("assessment_sessions"));
  });

  it("does NOT complete when the snapshot write fails", async () => {
    // A half-completed session is worse than a failed one: the participant
    // would have a 'completed' assessment with no stored interpretation.
    const { db, captured } = (() => {
      const rows = storedRows({});
      const base = fakeDb(rows);
      const realFrom = base.db.from.bind(base.db);
      base.db.from = ((t: string) => {
        if (t === "snapshots") {
          return { insert: () => Promise.resolve({ error: { message: "boom" } }) };
        }
        return realFrom(t);
      }) as never;
      return base;
    })();
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);
    await expect(
      completeSession("11111111-2222-3333-4444-555555555555"),
    ).rejects.toThrow(/snapshot/);
    // The session must NOT have been marked complete.
    expect(captured.sessionUpdate).toBeNull();
  });
});

describe("F-08 — an abandoned session resumes before it completes", () => {
  it("(a) an abandoned session with all 31 responses COMPLETES: resume precedes scoring and snapshot", async () => {
    // The session row says `abandoned` while the responses table holds all 31 —
    // the direct-to-reveal path that used to 500. The app allows `abandoned`
    // (it is inside the resumable window), so completeSession must RESUME it
    // back to in_progress BEFORE the Snapshot insert, or the database trigger
    // (`refuse_snapshot_for_terminal_session`) refuses the insert and throws.
    const { result, captured } = await runWithStatus(storedRows({}), "abandoned");
    console.log("  complete:", JSON.stringify(result));
    console.log("  write order:", JSON.stringify(captured.writes));
    console.log("  session updates:", JSON.stringify(captured.sessionUpdates));

    expect(result.complete).toBe(true);
    // A Snapshot row is written — the terminal symptom the trigger used to deny.
    expect(captured.snapshot).not.toBeNull();
    expect(captured.writes).toContain("snapshots");

    // ORDER IS LOAD-BEARING. The resume (an assessment_sessions update to
    // in_progress) must be the FIRST write — before computed_signals, before
    // overrides/tensions, and before the snapshot insert — so a failure later
    // cannot leave scoring artifacts on a session the trigger still refuses.
    expect(captured.writes[0], "the resume must be the very first write").toBe(
      "assessment_sessions",
    );
    expect(
      captured.writes.indexOf("assessment_sessions"),
      "resume must precede scoring",
    ).toBeLessThan(captured.writes.indexOf("computed_signals"));
    expect(
      captured.writes.indexOf("assessment_sessions"),
      "resume must precede the snapshot insert",
    ).toBeLessThan(captured.writes.indexOf("snapshots"));

    // The resume carries the SAME transition decideResponseWrite performs:
    // status -> in_progress, with lifecycle_changed_at stamped.
    expect(captured.sessionUpdates[0]?.status).toBe("in_progress");
    expect(typeof captured.sessionUpdates[0]?.lifecycle_changed_at).toBe("string");
    // And the terminal write still flips to completed.
    expect(captured.sessionUpdates[captured.sessionUpdates.length - 1]?.status).toBe(
      "completed",
    );
    expect(captured.sessionUpdate?.status).toBe("completed");
  });

  it("(b) an abandoned session with a MISSING response completes nothing and writes nothing", async () => {
    // The resume happens only after the completeness check. An abandoned
    // session that is still short one answer must NOT resume and must NOT
    // score: answering a question is what resumes it, not completion.
    const rows = storedRows({}).filter((r) => r.item_id !== "Q25");
    const { result, captured } = await runWithStatus(rows, "abandoned");
    console.log("  incomplete:", JSON.stringify(result));
    console.log("  writes:", JSON.stringify(captured.writes));

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["Q25"]);
    // Nothing written: no resume, no scoring, no snapshot.
    expect(captured.writes).toEqual([]);
    expect(captured.sessionUpdates).toEqual([]);
    expect(captured.sessionUpdate).toBeNull();
    expect(captured.computedSignals).toEqual([]);
    expect(captured.snapshot).toBeNull();
  });

  it("(c) an EXPIRED session still refuses and writes nothing", async () => {
    const { result, captured } = await runWithStatus(storedRows({}), "expired");
    console.log("  expired:", JSON.stringify(result));

    expect(result.complete).toBe(false);
    expect(typeof result.refusal).toBe("string");
    expect(result.refusal).toMatch(/expired/i);

    expect(captured.writes).toEqual([]);
    expect(captured.sessionUpdates).toEqual([]);
    expect(captured.sessionUpdate).toBeNull();
    expect(captured.computedSignals).toEqual([]);
    expect(captured.snapshot).toBeNull();
  });

  it("(c2) the resume is GUARDED: if the sweep expires the session first, §3 still holds", async () => {
    // THE RACE THIS GUARDS. completeSession reads the status, then the sweep
    // expires the session before the resume write lands. An UNGUARDED resume
    // would force the row back to in_progress and the Snapshot insert would
    // then SUCCEED — producing exactly the "current Financial Snapshot" that
    // operator decision §3 says an expired assessment "must never subsequently
    // produce". The DB trigger cannot catch it, because by then the status
    // really is in_progress. This is the guard that keeps §3 true.
    //
    // Mutation that must fail this test: drop the `.eq("status", "abandoned")`
    // from the resume, which makes the update match regardless.
    const { db, captured } = fakeDb(storedRows({}), "abandoned", { sweepWinsRace: true });
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);

    const result = await completeSession("11111111-2222-3333-4444-555555555555");
    console.log("  race ->", JSON.stringify(result));
    console.log("  writes:", JSON.stringify(captured.writes));

    // It must NOT complete, and must NOT write a Snapshot or any scoring.
    expect(result.complete).toBe(false);
    expect(typeof result.refusal).toBe("string");
    expect(result.refusal).toMatch(/expired/i);
    expect(captured.snapshot, "§3: an expired session must never produce a Snapshot").toBeNull();
    expect(captured.computedSignals).toEqual([]);
    expect(captured.writes).not.toContain("snapshots");
  });

  it("(d) a COMPLETED session still refuses a second completion and writes nothing", async () => {
    // Completion is a one-time transition (§22.5): no second Snapshot.
    const { result, captured } = await runWithStatus(storedRows({}), "completed");
    console.log("  already-complete:", JSON.stringify(result));

    expect(result.complete).toBe(false);
    expect(typeof result.refusal).toBe("string");
    expect(result.refusal).toMatch(/already complete/i);

    expect(captured.writes).toEqual([]);
    expect(captured.sessionUpdates).toEqual([]);
    expect(captured.sessionUpdate).toBeNull();
    expect(captured.computedSignals).toEqual([]);
    expect(captured.snapshot).toBeNull();
  });

  it("(e) NO PARTIAL WRITES in every refusal case — scoring, overrides, tensions and snapshot all untouched", async () => {
    // The defect's worst symptom: scoring artifacts committed to a session with
    // no Snapshot. Every refusal path must leave ALL four tables untouched.
    const cases: Array<{
      name: string;
      status: string;
      rows: Array<{ item_id: string; option_code: string }>;
    }> = [
      { name: "expired", status: "expired", rows: storedRows({}) },
      { name: "completed (second completion)", status: "completed", rows: storedRows({}) },
      {
        name: "abandoned with a missing response",
        status: "abandoned",
        rows: storedRows({}).filter((r) => r.item_id !== "Q25"),
      },
    ];

    for (const c of cases) {
      const { result, captured } = await runWithStatus(c.rows, c.status);
      console.log(`  ${c.name}: complete=${result.complete} writes=${JSON.stringify(captured.writes)}`);
      expect(result.complete, c.name).toBe(false);
      expect(captured.writes, `${c.name}: no write may occur`).toEqual([]);
      expect(captured.computedSignals, `${c.name}: no computed_signals`).toEqual([]);
      expect(captured.overrides, `${c.name}: no overrides`).toEqual([]);
      expect(captured.tensions, `${c.name}: no tensions`).toEqual([]);
      expect(captured.snapshot, `${c.name}: no snapshot`).toBeNull();
      expect(captured.sessionUpdates, `${c.name}: no resume/complete`).toEqual([]);
    }
  });
});
