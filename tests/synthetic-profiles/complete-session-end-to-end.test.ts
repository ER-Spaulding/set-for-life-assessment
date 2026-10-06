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
  opts: {
    sweepWinsRace?: boolean;
    /**
     * OWNER RULING ITEM 3 — make the ATOMIC CALL fail, so a test can assert
     * that nothing derived was left behind.
     *
     * This models the real function raising inside its transaction (a trigger,
     * the unique index, a transient error). The fake stages writes and discards
     * them on failure, which is what a rollback IS — a fake that wrote and then
     * "cleaned up" would model the very pattern the ruling forbids.
     */
    transactionFails?: boolean;
  } = {},
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

  /**
   * The real `complete_session_atomic`, modelled faithfully enough to test the
   * guarantee: it re-reads the status UNDER LOCK, refuses without writing,
   * resumes an abandoned session, and commits every write together or none.
   *
   * It is deliberately NOT a pass-through. A fake that just recorded "the rpc
   * was called and returned ok" would make every atomicity test vacuous — the
   * suite would pass on a client that never called the function at all.
   */
  async function completeSessionAtomic(params: Record<string, unknown>) {
    // ---- LOCK AND RE-READ ----
    //
    // The race, modelled the way the LOCK actually resolves it. A sweep that
    // lands BEFORE this function takes the row lock has already committed, so
    // the re-read sees `expired` and the call refuses with nothing written. A
    // sweep that lands AFTER blocks on the lock and waits. Either way an
    // expired session cannot produce a Snapshot — which is the guarantee the
    // old detect-after-the-fact guard could not give, because the scoring
    // writes that followed it were still separate transactions.
    let status = sessionStatus;
    if (opts.sweepWinsRace && !raceFired) {
      raceFired = true;
      sessionStatus = "expired";
      status = "expired";
    }

    // A lifecycle refusal returns DATA and writes NOTHING. Note the ordering:
    // the refusal is decided BEFORE the first staged write, which is the
    // structural property the owner asked for (validate first, then persist).
    if (status !== "in_progress" && status !== "abandoned") {
      return { data: { ok: false, state: status }, error: null };
    }

    // ---- STAGE. Nothing below is observable until the commit at the end. ----
    const staged = {
      computedSignals: (params.p_signals as Array<Record<string, unknown>>) ?? [],
      overrides: (params.p_overrides as Array<Record<string, unknown>>) ?? [],
      tensions: (params.p_tensions as Array<Record<string, unknown>>) ?? [],
      snapshot: params.p_snapshot as Record<string, unknown>,
      resumed: status === "abandoned",
    };

    // A failure inside the transaction DISCARDS the staged writes. This is the
    // whole point: the old code had four separate round-trips, so a failure at
    // the snapshot insert left the scoring rows committed.
    if (opts.transactionFails) {
      return { data: null, error: { message: "forced transaction failure" } };
    }

    // ---- COMMIT ----
    if (staged.resumed) {
      sessionStatus = "in_progress";
      captured.writes.push("assessment_sessions");
      // The real function performs the SAME transition decideResponseWrite
      // does: status -> in_progress with `lifecycle_changed_at` stamped (so the
      // abandonment->resume stays attributable) and `last_activity_at` bumped
      // (so the next sweep does not re-abandon a session just returned to).
      const resumePayload = {
        status: "in_progress",
        lifecycle_changed_at: (params.p_now as string) ?? "",
        last_activity_at: (params.p_now as string) ?? "",
      };
      captured.sessionUpdate = resumePayload;
      captured.sessionUpdates.push(resumePayload);
    }
    captured.computedSignals = staged.computedSignals;
    if (staged.computedSignals.length) captured.writes.push("computed_signals");
    captured.overrides = staged.overrides;
    if (staged.overrides.length) captured.writes.push("overrides");
    captured.tensions = staged.tensions;
    if (staged.tensions.length) captured.writes.push("tensions");
    captured.snapshot = staged.snapshot;
    captured.writes.push("snapshots");
    sessionStatus = "completed";
    const donePayload = { status: "completed", completed_at: params.p_now ?? "" };
    captured.sessionUpdate = donePayload;
    captured.sessionUpdates.push(donePayload);
    captured.writes.push("assessment_sessions");

    return { data: { ok: true }, error: null };
  }

  const db = {
    /**
     * OWNER RULING 2026-10-03 ITEM 3 — the atomic boundary.
     *
     * `completeSession` no longer writes the derived tables one round-trip at a
     * time; it hands every row to this function, which the real database runs
     * in ONE transaction. So the fake must provide it — a fake without `rpc`
     * would crash, and the tempting shortcut (leave the JS writes in place)
     * would remove the transaction the ruling requires.
     */
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name !== "complete_session_atomic") {
        throw new Error(`fakeDb: unexpected rpc ${name}`);
      }
      return completeSessionAtomic(params);
    },
    from(table: string) {
      if (table === "responses") {
        const q = {
          select: () => q,
          eq: () => Promise.resolve({ data: rows, error: null }),
        };
        return q;
      }
      // The derived tables are NO LONGER written from here (item 3). They are
      // reached only through `complete_session_atomic`, which is modelled
      // above. If a future edit reintroduces a direct write, this fake throws
      // rather than silently accepting it — a fake that served both paths would
      // let the transaction quietly disappear while every test stayed green.
      if (
        table === "computed_signals" ||
        table === "tensions" ||
        table === "overrides" ||
        table === "snapshots"
      ) {
        throw new Error(
          `fakeDb: ${table} must be written through complete_session_atomic, not directly`,
        );
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
    // Read from the artifact rather than hardcoded: the narrative library was
    // re-issued (1.0 -> 1.0.1) for a copy-only patch, and a literal here would
    // have to be edited on every future re-issue — the same "asserted from a
    // constant" problem versions.ts exists to prevent. The property under test
    // is that the row RECORDS the config's declared version, not that the
    // version is any particular value.
    expect(snap!.narrative_version).toBe(
      JSON.parse(readFileSync(resolve(__dirname, "../../config/narratives-v1.0.json"), "utf8")).version,
    );
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

  it("the payload and the status flip commit TOGETHER, with the payload first", async () => {
    // ORDER IS STILL LOAD-BEARING INSIDE THE TRANSACTION. The immutability
    // triggers fire on completion, so a payload written after the status flip
    // would be rejected — and under the OLD code that rejection left the
    // session completed with no stored Snapshot, the state §5 forbids.
    //
    // The guarantee is now stronger than ordering: both writes are in ONE
    // transaction, so there is no observable state in which one exists without
    // the other. The order assertion is retained because it is still what makes
    // the trigger fire on a legal sequence rather than an illegal one.
    const { captured } = await run({});
    const w = captured.writes;
    console.log("  write order:", JSON.stringify(w));
    expect(w.indexOf("snapshots")).toBeGreaterThan(-1);
    expect(w.indexOf("snapshots")).toBeLessThan(w.indexOf("assessment_sessions"));
    // The Snapshot is persisted in the same transaction that flips the status —
    // a completed session with no Snapshot is now unreachable, not merely
    // unlikely.
    expect(captured.sessionUpdate?.status).toBe("completed");
  });

  it("does NOT complete when the snapshot write fails, and leaves NO derived rows behind", async () => {
    // A half-completed session is worse than a failed one: the participant
    // would have a 'completed' assessment with no stored interpretation.
    //
    // OWNER RULING ITEM 3 RAISES THE BAR. It is not enough that the session is
    // not marked complete — the SCORING ROWS must not survive either. Before
    // the atomic boundary, a failure at this point left computed_signals,
    // overrides and tensions committed (four separate round-trips, each its own
    // transaction), on a session with no Snapshot. That is the state the ruling
    // forbids, and this test is what proves it can no longer happen.
    const { db, captured } = fakeDb(storedRows({}), "in_progress", {
      transactionFails: true,
    });
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);
    await expect(
      completeSession("11111111-2222-3333-4444-555555555555"),
    ).rejects.toThrow(/complete/);

    // Nothing derived survived the rollback.
    expect(captured.sessionUpdate).toBeNull();
    expect(captured.writes).toEqual([]);
    expect(captured.computedSignals).toEqual([]);
    expect(captured.overrides).toEqual([]);
    expect(captured.tensions).toEqual([]);
    expect(captured.snapshot).toBeNull();
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
    // overrides/tensions, and before the snapshot insert — or the database
    // trigger (`refuse_snapshot_for_terminal_session`) refuses the insert.
    //
    // Item 3 moved this INSIDE the transaction, so the order is now preserved
    // there rather than by four separate round-trips — and the resume is taken
    // under the row lock that also made the sweep race impossible.
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

  it("(c2) the sweep race is CLOSED BY THE LOCK: if the sweep expires the session first, §3 still holds", async () => {
    // THE RACE THIS GUARDS. completeSession reads the status, then the sweep
    // expires the session before completion lands. An unguarded resume would
    // force the row back to in_progress and the Snapshot insert would then
    // SUCCEED — producing exactly the "current Financial Snapshot" that
    // operator decision §3 says an expired assessment "must never subsequently
    // produce", with the DB trigger unable to catch it because by then the
    // status really is in_progress.
    //
    // HOW IT IS CLOSED NOW. Not by re-checking after the fact and hoping the
    // window is small: `complete_session_atomic` takes a row lock and re-reads
    // the status UNDER that lock, so a sweep that lands first is seen before
    // the first staged write, and a sweep that lands second waits for the lock
    // and is therefore seen by nobody (the completion has already committed).
    //
    // Mutation that must fail this test: move the status re-read ABOVE the lock
    // (or drop the lock), which restores exactly the stale-read window.
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
    expect(captured.overrides).toEqual([]);
    expect(captured.tensions).toEqual([]);
    expect(captured.writes).not.toContain("snapshots");
    // The session must not have been dragged back to in_progress on the way to
    // a refusal — that was the §3 violation the old guarded resume existed to
    // prevent, and it must still be prevented.
    expect(captured.sessionUpdates).toEqual([]);
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

describe("OWNER RULING 2026-10-03 item 3 — refusal leaves no scoring artifacts", () => {
  /**
   * The owner's required coverage list, asserted explicitly rather than left to
   * be inferred from the cases above. Six of the seven were already reachable;
   * they are restated here so a future refactor that quietly drops one shows up
   * as a failing test with the owner's own wording on it, not as a gap.
   */
  const REFUSAL_CASES = [
    { n: 1, name: "incomplete session attempts completion", status: "in_progress", drop: "Q25" },
    { n: 2, name: "abandoned-but-resumable session, still missing an answer", status: "abandoned", drop: "Q25" },
    { n: 3, name: "expired session", status: "expired", drop: null },
    { n: 4, name: "already-completed session", status: "completed", drop: null },
  ] as const;

  for (const c of REFUSAL_CASES) {
    it(`(${c.n}) ${c.name} — zero derived rows, zero Snapshot`, async () => {
      const rows = c.drop ? storedRows({}).filter((r) => r.item_id !== c.drop) : storedRows({});
      const { result, captured } = await runWithStatus(rows, c.status);
      console.log(`  ${c.name}: ${JSON.stringify(result)}`);
      console.log(`  writes: ${JSON.stringify(captured.writes)}`);

      expect(result.complete).toBe(false);
      // ZERO new scoring/derived/Snapshot rows. This is the invariant, stated
      // as one assertion a reader can check against the ruling's sentence.
      expect(captured.computedSignals).toEqual([]);
      expect(captured.overrides).toEqual([]);
      expect(captured.tensions).toEqual([]);
      expect(captured.snapshot).toBeNull();
      expect(captured.writes).toEqual([]);
    });
  }

  it("(5) a valid session completing normally still writes all of them", async () => {
    // The counterweight. An invariant that held by writing nothing at all would
    // pass every refusal case above while breaking completion entirely — the
    // false-green this suite exists to avoid.
    const { result, captured } = await runWithStatus(storedRows({}), "in_progress");
    expect(result.complete).toBe(true);
    expect(captured.computedSignals.length).toBe(6);
    expect(captured.snapshot).not.toBeNull();
    expect(captured.writes).toContain("snapshots");
    expect(captured.sessionUpdate?.status).toBe("completed");
  });

  it("(6) a FAILED transaction leaves zero derived rows — the four-round-trips defect", async () => {
    // The case the old code could not survive. Four independent PostgREST
    // round-trips meant the scoring rows committed before the Snapshot insert
    // could fail, so a 500 left artifacts on a session with no Snapshot. In one
    // transaction the staged writes are discarded together.
    const { db, captured } = fakeDb(storedRows({}), "in_progress", { transactionFails: true });
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);

    await expect(
      completeSession("11111111-2222-3333-4444-555555555555"),
    ).rejects.toThrow(/complete/);

    expect(captured.computedSignals).toEqual([]);
    expect(captured.overrides).toEqual([]);
    expect(captured.tensions).toEqual([]);
    expect(captured.snapshot).toBeNull();
    expect(captured.sessionUpdates).toEqual([]);
    expect(captured.writes).toEqual([]);
  });

  it("(7) a RETRY after a refusal cannot inherit stale scoring artifacts", async () => {
    // THE CASE THE OWNER NAMED THAT WAS NOT OTHERWISE COVERED.
    //
    // A refusal must leave the session exactly as completable as it was before
    // the attempt. If any scoring row survived, the retry would either write
    // against a session already carrying half-derived state, or — worse — the
    // participant would eventually complete and receive a Snapshot assembled
    // from a mixture of two attempts.
    //
    // Modelled as one session across two calls: the first refused (expired
    // mid-flight, the sweep race), the second a normal completion. The second
    // call must produce a CLEAN, complete set — six signals, and a Snapshot —
    // with nothing carried over from the first.
    const { db, captured } = fakeDb(storedRows({}), "abandoned", { sweepWinsRace: true });
    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);

    const refused = await completeSession("11111111-2222-3333-4444-555555555555");
    expect(refused.complete, "the first attempt must be refused").toBe(false);
    expect(captured.computedSignals, "the refusal left no scoring behind").toEqual([]);
    expect(captured.snapshot).toBeNull();

    // The participant resumes (the sweep's expiry is superseded by a real
    // return to the assessment, which is what the resume route performs), then
    // completes. The retry starts from a clean slate.
    const clean = fakeDb(storedRows({}), "in_progress");
    vi.mocked(serviceClient).mockReturnValue(clean.db as never);
    const retried = await completeSession("11111111-2222-3333-4444-555555555555");

    expect(retried.complete, "the retry must complete normally").toBe(true);
    // A FULL set, not a partial one assembled over two attempts.
    expect(clean.captured.computedSignals.length).toBe(6);
    expect(clean.captured.snapshot).not.toBeNull();
    // And the retry inherited nothing from the refused attempt.
    expect(captured.computedSignals).toEqual([]);
    expect(captured.snapshot).toBeNull();
  });
});
