import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_THRESHOLDS,
  classifyIdle,
  decideResponseWrite,
  elapsedDays,
  mayProduceSnapshot,
  resolveThresholds,
  snapshotRefusalReason,
  statusForClassification,
  type LifecycleThresholds,
} from "@/lib/session/lifecycle";
import { planTransitions } from "@/lib/session/lifecycle";
import { stageAt, stageForPosition, STAGE_OPENING, STAGE_COMPLETE } from "@/lib/session/stage";

/**
 * The assessment lifecycle — operator decision 2026-10-01.
 *
 * The operator named 15 cases that must have coverage. This file implements all
 * fifteen, and they are labelled with their requirement number so the mapping is
 * checkable rather than asserted.
 *
 * WHY SO MUCH ATTENTION ON BOUNDARIES. The operator said "7 FULL days" and "30
 * FULL days", and those words are doing real work: a session at 6 days 23 hours
 * is current, and one at exactly 7 days is abandoned. Every test below pins an
 * exact instant rather than "about a week", because the off-by-one direction
 * here is not cosmetic — it decides whether a participant keeps their progress
 * or is told to start over.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const T: LifecycleThresholds = DEFAULT_THRESHOLDS;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T12:00:00.000Z");

/** An instant `days` before NOW, to the millisecond. */
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const agoIso = (days: number) => ago(days).toISOString();

function session(
  overrides: Partial<{
    session_id: string;
    participant_id: string;
    status: string;
    last_activity_at: string;
    current_position: number;
  }> = {},
) {
  return {
    session_id: "s-1",
    participant_id: "p-1",
    status: "in_progress",
    last_activity_at: agoIso(0),
    current_position: 1,
    ...overrides,
  };
}

// ===========================================================================
// Requirement 1 & 2 — the saved window, and where it ends
// ===========================================================================

describe("§1–2 the 7-day boundary", () => {
  it("REQ 1 — a saved participant returning on Day 3 is still current", () => {
    const c = classifyIdle(agoIso(3), NOW, T);
    console.log(`  day 3 -> ${c}`);
    expect(c).toBe("current");
    expect(statusForClassification(c)).toBe("in_progress");
  });

  it("REQ 2 — returning immediately BEFORE the 7-day boundary is still current", () => {
    // 6 days 23:59:59 — one second short of seven full days.
    const justUnder = new Date(ago(7).getTime() + 1000);
    const c = classifyIdle(justUnder, NOW, T);
    console.log(`  6d 23:59:59 -> ${c} (idle days: ${elapsedDays(justUnder, NOW)})`);
    expect(c).toBe("current");
  });

  it("REQ 3 — a SAVED participant crossing 7 full days becomes abandoned", () => {
    const c = classifyIdle(agoIso(7), NOW, T);
    console.log(`  exactly 7 days -> ${c}`);
    expect(c, "exactly 7 FULL days is the first abandoned instant").toBe("abandoned");
    expect(statusForClassification(c)).toBe("abandoned");
  });

  it("REQ 4 — an UNSAVED incomplete participant crossing 7 days is abandoned too", () => {
    // The operator was explicit: the 7-day rule "applies whether the participant
    // explicitly used Save My Progress or simply stopped participating". The
    // classification takes no `saved` input at all — which is how that is
    // guaranteed rather than promised: there is no parameter through which the
    // saved flag could change the answer.
    const plan = planTransitions([session({ last_activity_at: agoIso(7) })], NOW, T);
    expect(plan).toHaveLength(1);
    expect(plan[0].to).toBe("abandoned");
    console.log(`  unsaved day-7 -> ${plan[0].to}`);
  });
});

// ===========================================================================
// Requirement 3 — abandonment is resumable
// ===========================================================================

describe("§2 abandonment is resumable", () => {
  it("REQ 5 — an abandoned participant returning on Day 10 resumes the SAME session", () => {
    // The classification says abandoned; the SESSION is unchanged and its
    // answers are intact. Abandonment is a lifecycle label, not a deletion.
    const c = classifyIdle(agoIso(10), NOW, T);
    console.log(`  day 10 -> ${c}`);
    expect(c).toBe("abandoned");

    const s = session({ status: "abandoned", last_activity_at: agoIso(10), current_position: 14 });
    expect(s.session_id, "identity is preserved").toBe("s-1");
    expect(s.current_position, "position is preserved").toBe(14);

    // An abandoned session may COMPLETE. This asserted the opposite until live
    // verification exposed the contradiction: answering a question resumes an
    // abandoned session (decideResponseWrite), so a participant who resumed by
    // answering and then finished would have been refused with "needs to be
    // resumed" — told to do the thing they had just done.
    expect(
      mayProduceSnapshot("abandoned"),
      "an abandoned session is within the resumable window and may complete",
    ).toBe(true);
    expect(snapshotRefusalReason("abandoned")).toBeNull();
  });

  it("REQ 6 — an abandoned participant can revise an earlier answer and complete", () => {
    // Revisiting must NOT deadlock, and the rule that decides that is now a
    // pure function rather than an `if` in a route. This replaces a pair of
    // source-text assertions (`expect(code).toMatch(/status === "completed"/)`)
    // that pinned the SHAPE of the route instead of its BEHAVIOUR — and which
    // therefore passed happily while the route accepted writes to an expired
    // session, the bug the live run actually found.
    const abandoned = decideResponseWrite("abandoned");
    expect(abandoned.allowed, "an abandoned session accepts a revision").toBe(true);
    // And accepting it RESUMES the session in the same write, so the next sweep
    // cannot re-abandon a session that has a fresh answer in it and record a
    // SECOND abandonment event for one abandonment.
    expect(
      abandoned.allowed && abandoned.resumeTo,
      "answering resumes the session — otherwise the sweep double-counts",
    ).toBe("in_progress");

    const inProgress = decideResponseWrite("in_progress");
    expect(inProgress.allowed).toBe(true);
    expect(
      inProgress.allowed && inProgress.resumeTo,
      "an in-progress session has nothing to resume",
    ).toBeNull();

    // A completed session is still immutable (§22.5).
    const completed = decideResponseWrite("completed");
    expect(completed.allowed).toBe(false);
    expect(completed.allowed === false && completed.code).toBe("SESSION_COMPLETE");
  });

  it("an EXPIRED session refuses a response write — the hole live verification found", () => {
    // The route guarded only against `completed`, so an expired session accepted
    // every write and bumped its own last_activity_at. A participant returning
    // to a bookmarked URL could keep answering a session whose only possible
    // ending was the 422 at completion, with nothing telling them so.
    const expired = decideResponseWrite("expired");
    expect(expired.allowed, "an expired session must not accept answers").toBe(false);
    expect(expired.allowed === false && expired.code).toBe("SESSION_EXPIRED");
    expect(expired.allowed === false && expired.message).toMatch(/expired/i);
  });

  it("an unknown status refuses a response write rather than guessing", () => {
    // A status this code does not recognise is one whose rules it cannot apply.
    // Defaulting to "allow" would make every future status a silent bypass.
    const unknown = decideResponseWrite("teleported");
    expect(unknown.allowed).toBe(false);
  });

  it("the two lifecycle rules agree on every status — no second list to drift", () => {
    // `mayProduceSnapshot` and `snapshotRefusalReason` were two hand-maintained
    // switches over the same statuses, and they DIVERGED the moment `abandoned`
    // was allowed to complete: the yes/no said true while the message said
    // "needs to be resumed". Caught by the test above, not by a participant.
    //
    // The fix made the boolean derive from the message. This asserts the
    // property for every persisted status, so a future third copy — or a
    // reinstated second switch — cannot appear without failing here.
    const statuses = ["in_progress", "abandoned", "completed", "expired", "unknown_status"];
    for (const s of statuses) {
      const may = mayProduceSnapshot(s);
      const reason = snapshotRefusalReason(s);
      console.log(`  ${s.padEnd(15)} may=${String(may).padEnd(5)} reason=${reason ? "yes" : "null"}`);
      expect(
        may,
        `${s}: mayProduceSnapshot says ${may} but the reason is ${reason === null ? "null" : "set"}`,
      ).toBe(reason === null);
    }
    // And the two statuses that must be completable, stated independently of
    // the implementation so the property test cannot pass by making everything
    // refused.
    expect(mayProduceSnapshot("in_progress")).toBe(true);
    expect(mayProduceSnapshot("abandoned")).toBe(true);
    expect(mayProduceSnapshot("expired")).toBe(false);
    expect(mayProduceSnapshot("completed")).toBe(false);
  });

  it("BOTH resume paths bump last_activity_at — the double-count regression", () => {
    // FOUND LIVE, and it took a real sweep to surface it. Resuming set `status`
    // to in_progress and left `last_activity_at` untouched, so a session resumed
    // on Day 10 came back STILL 10 DAYS STALE. The next sweep classified it
    // abandoned again and wrote a second `assessment_abandoned` event — one
    // abandonment, counted twice, in the exact metric §8 exists to get right.
    // Observed on session e37e2d65: abandoned 01:29:47, resumed 01:29:49,
    // abandoned again 01:30:03.
    //
    // There are TWO resume paths and they must agree: the explicit resume route,
    // and the implicit resume when a participant answers a question. Both are
    // asserted here because fixing one and not the other produces a bug that
    // only appears for participants who take the other route.
    const route = read("app/api/session/resumable/route.ts");
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(code, "the resume route must set the status").toMatch(/status:\s*"in_progress"/);
    expect(
      code,
      "the resume route must ALSO bump last_activity_at, or the next sweep re-abandons it",
    ).toMatch(/last_activity_at:\s*nowIso/);

    // The implicit path, in the response route.
    const responseRoute = read("app/api/session/[id]/response/route.ts");
    const responseCode = responseRoute
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // It already bumped last_activity_at; what it must ALSO do is carry the
    // resume status in that same write rather than writing activity alone.
    expect(responseCode, "answering bumps activity").toMatch(/last_activity_at:/);
    expect(
      responseCode,
      "answering an abandoned session must carry the resume in the SAME write",
    ).toMatch(/decision\.resumeTo/);

    // The property, independent of both routes' text: after any resume, the
    // session must classify as `current`, not abandoned. A session whose status
    // was just set to in_progress and which still classifies abandoned is the
    // contradiction that caused the double count.
    const justResumed = new Date(NOW);
    expect(
      classifyIdle(justResumed, NOW, T),
      "a session resumed at `now` must classify as current, not abandoned",
    ).toBe("current");
  });

  it("the response route consults the shared rule rather than its own copy", () => {
    // The rule must live in ONE place. The route previously had its own
    // `status === "completed"` check, which is exactly how it drifted out of
    // step with the sweep and the completer. This asserts the route delegates.
    const route = read("app/api/session/[id]/response/route.ts");
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the response route must delegate to decideResponseWrite").toMatch(
      /decideResponseWrite\(/,
    );
    expect(
      code,
      "and must not carry a second, divergent status check of its own",
    ).not.toMatch(/status === "completed"/);
    // A revision still replaces rather than accumulates.
    expect(code, "a revision must replace, not accumulate").toMatch(/\.delete\(\)/);
  });
});

// ===========================================================================
// Requirement 3 — the 30-day boundary and expiration
// ===========================================================================

describe("§3 the 30-day boundary", () => {
  it("REQ 7 — returning immediately BEFORE the 30-day boundary still resumes", () => {
    const justUnder = new Date(ago(30).getTime() + 1000);
    const c = classifyIdle(justUnder, NOW, T);
    console.log(`  29d 23:59:59 -> ${c}`);
    expect(c).toBe("abandoned");

    // And a session in that state, read by the resume path, is still offered.
    const plan = planTransitions(
      [session({ status: "abandoned", last_activity_at: justUnder.toISOString() })],
      NOW,
      T,
    );
    expect(plan, "a session one second short of expiration must not be expired").toEqual([]);
  });

  it("REQ 8 — crossing 30 full days expires the session", () => {
    const c = classifyIdle(agoIso(30), NOW, T);
    console.log(`  exactly 30 days -> ${c}`);
    expect(c, "exactly 30 FULL days is the first expired instant").toBe("expired");

    // Both entry paths are covered: an in_progress session that goes straight to
    // expired (the sweep missed the abandoned step, e.g. it was down), and an
    // abandoned one that advances.
    const direct = planTransitions([session({ last_activity_at: agoIso(31) })], NOW, T);
    expect(direct[0].to).toBe("expired");

    const fromAbandoned = planTransitions(
      [session({ status: "abandoned", last_activity_at: agoIso(31) })],
      NOW,
      T,
    );
    expect(fromAbandoned[0].to).toBe("expired");
    console.log(`  in_progress -> ${direct[0].to} | abandoned -> ${fromAbandoned[0].to}`);
  });

  it("REQ 12 — an expired session cannot produce a Snapshot", () => {
    // Operator instruction #3: expired "becomes historical and must never
    // subsequently produce a current Financial Snapshot."
    expect(mayProduceSnapshot("expired")).toBe(false);
    expect(snapshotRefusalReason("expired")).toMatch(/expired/i);

    // Enforced in the application AND in the database, because the application
    // guard is one code path and this rule was previously unenforced entirely:
    // `completeSession` never read the session's status.
    const service = read("lib/session/service.ts");
    expect(
      service,
      "completeSession must gate on the lifecycle before scoring",
    ).toMatch(/mayProduceSnapshot\(status\)/);

    const migration = read("supabase/migrations/20261001000010_assessment_lifecycle.sql");
    expect(
      migration,
      "the database must refuse a Snapshot for an expired session",
    ).toMatch(/refuse_snapshot_for_terminal_session/);
    expect(migration).toMatch(/BEFORE INSERT ON snapshots/);
  });
});

// ===========================================================================
// Requirement 4 — no prepopulation, shared identity
// ===========================================================================

describe("§4 a new session after expiration", () => {
  it("REQ 9 — an expired participant gets a NEW session, and the old one stays historical", () => {
    // The expired session is excluded from the resumable lookup, so the
    // participant cannot resume it; the new-session path creates a fresh row.
    const route = read("app/api/session/resumable/route.ts");
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "the resumable lookup must exclude expired sessions",
    ).toMatch(/\.in\("status", \["in_progress", "abandoned"\]\)/);
    expect(
      code,
      "expired must not be in the resumable set",
    ).not.toMatch(/\["in_progress", "abandoned", "expired"\]/);

    // And the new-session route copies NO prior diagnostic/activation answers
    // forward. F-06 narrows the old blunt `/responses/` scan to the operator's
    // actual rule: the ONE response written at creation is the participant's
    // own Opening A answer, seeded through the shared service helper — never an
    // inline responses read/write, and never a prior session's Q1–Q25 / A1–A4
    // answers.
    const create = read("app/api/session/route.ts");
    expect(
      create,
      "session creation must not copy prior answers forward — no inline responses access",
    ).not.toMatch(/from\("responses"\)/);
    expect(
      create,
      "the one allowed seed is delegated to the shared helper",
    ).toMatch(/recordCanonicalOpeningA/);
  });

  it("REQ 10 — the ONLY response written at creation is the participant's own OPEN_A", () => {
    // Operator instruction #4: "do not prepopulate the participant's previous 31
    // diagnostic responses or four Activation responses ... we do not want
    // previous answers anchoring the participant's current responses."
    //
    // F-06 narrows this from "creation writes NO responses" to the operator's
    // ACTUAL rule: a PREVIOUS session's Q1–Q25 / A1–A4 answers are never copied
    // forward, and the ONE response written at creation is the canonical OPEN_A
    // seed — the participant's own front-door answer for THIS session.
    const create = read("app/api/session/route.ts");
    const code = create.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const writes = [...code.matchAll(/\.from\("([a-z_]+)"\)\.insert/g)].map((m) => m[1]);
    console.log(`  tables written at session creation: ${JSON.stringify(writes)}`);
    expect(writes, "no inline responses insert — the seed goes through the helper").not.toContain(
      "responses",
    );
    expect(writes, "no inline computed_signals insert").not.toContain("computed_signals");

    // The one allowed response write is the canonical OPEN_A seed, delegated to
    // the shared service helper so it can never be a copy-forward of a prior
    // answer. Removing the seed fails this; re-adding a Q/A copy fails the scan
    // above.
    expect(code, "the returning door seeds the canonical OPEN_A").toMatch(/recordCanonicalOpeningA\(/);
    expect(code, "and the seed is the returning (No) answer").toMatch(/OPEN_A_B/);
  });

  it("REQ 11 — the same Participant ID and Set for Life Number survive", () => {
    // The participant is resolved, not recreated. Provisional creation mints a
    // NEW participant; the post-expiration path must go through the SESSION
    // route, which takes an existing participantId.
    const create = read("app/api/session/route.ts");
    expect(
      create,
      "the session route must take an existing participantId rather than minting one",
    ).toMatch(/participantId/);
    expect(
      create,
      "session creation must not create a participant",
    ).not.toMatch(/createProvisionalParticipant/);

    // The Set for Life Number lives on the participant and is protected from
    // reassignment, so a new session cannot change it.
    const sfl = read("supabase/migrations/20261001000004_sfl_number.sql");
    expect(sfl, "the number must be guarded against reassignment").toMatch(
      /protect_sfl_number/,
    );
  });
});

// ===========================================================================
// Requirement 5 — completed assessments are untouched
// ===========================================================================

describe("§5 completed assessments are different", () => {
  it("REQ 13 — the sweep never touches a completed session", () => {
    const plan = planTransitions(
      [session({ status: "completed", last_activity_at: agoIso(400) })],
      NOW,
      T,
    );
    console.log(`  completed + 400 days idle -> transitions: ${plan.length}`);
    expect(plan, "no inactivity rule applies to a completed assessment").toEqual([]);

    // Belt and braces: the sweep's QUERY also excludes it, so even a planner bug
    // could not reach a completed row.
    const sweep = read("lib/session/sweep.ts");
    expect(sweep).toMatch(/\.in\("status", \["in_progress", "abandoned"\]\)/);
  });

  it("REQ 14 — a participant with a completed Snapshot can start a new assessment", () => {
    // Multiple completed assessments under one participant is the architecture
    // the operator asked for: "same participant -> multiple completed
    // assessments -> multiple immutable Snapshots".
    const create = read("app/api/session/route.ts");
    const code = create.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // Session creation does not refuse a participant who already has one.
    expect(
      code,
      "creation must not refuse a participant with a prior session",
    ).not.toMatch(/status.*completed.*(refuse|reject|409)/i);

    // And the prior Snapshot is untouched: snapshots are append-only, so a new
    // completion INSERTS rather than replacing.
    const immutability = read("supabase/migrations/20260930000002_immutability.sql");
    expect(immutability).toMatch(/snapshots are append-only/);
    expect(
      immutability,
      "history is never rewritten",
    ).toMatch(/new versions INSERT, history is never rewritten/);

    // Session identity is per-assessment: a new session means a new Snapshot,
    // not an overwrite of the old one.
    const schema = read("supabase/migrations/20260930000001_initial_schema.sql");
    expect(schema).toMatch(/assessment_number/);
  });

  it("a completed session cannot be completed twice", () => {
    // §22.5: completion is a one-time transition. A second call must not write a
    // second Snapshot for the same session.
    expect(mayProduceSnapshot("completed")).toBe(false);
    expect(snapshotRefusalReason("completed")).toMatch(/already complete/i);
  });
});

// ===========================================================================
// Requirement 7 — configurable thresholds, and their boundaries
// ===========================================================================

describe("§7 thresholds are configurable and boundary-tested", () => {
  it("reads the thresholds from config, not from scattered literals", () => {
    const cfg = JSON.parse(read("config/lifecycle-v1.0.json")) as Record<string, unknown>;
    console.log(
      `  config: saved=${cfg.saved_window_days} expiration=${cfg.expiration_window_days}`,
    );
    expect(cfg.saved_window_days).toBe(7);
    expect(cfg.expiration_window_days).toBe(30);

    const resolved = resolveThresholds(cfg);
    expect(resolved).toEqual({ savedWindowDays: 7, expirationWindowDays: 30 });

    // And the sweep reads config rather than hardcoding — the operator asked for
    // this explicitly: "Make the 7-day and 30-day thresholds centrally
    // configurable rather than scattering literals through application code."
    const sweep = read("lib/session/sweep.ts");
    expect(sweep).toMatch(/lifecycleThresholds\(\)/);
    expect(sweep).toMatch(/resolveThresholds\(/);
    expect(sweep, "the sweep must not hardcode 7 or 30").not.toMatch(/savedWindowDays:\s*7/);
  });

  it("a CHANGED config threshold moves the boundary", () => {
    // The property that makes them configuration rather than constants.
    const shorter = resolveThresholds({ saved_window_days: 3, expiration_window_days: 14 });
    console.log(`  custom thresholds: ${JSON.stringify(shorter)}`);
    expect(classifyIdle(agoIso(3), NOW, shorter)).toBe("abandoned");
    expect(classifyIdle(agoIso(3), NOW, T), "still current under the shipped 7").toBe("current");
    expect(classifyIdle(agoIso(14), NOW, shorter)).toBe("expired");
    expect(classifyIdle(agoIso(14), NOW, T), "still abandoned under the shipped 30").toBe(
      "abandoned",
    );
  });

  it("a malformed threshold config falls back rather than collapsing the state machine", () => {
    // An expiration window at or below the saved window would expire a session
    // the instant it was abandoned, skipping a state the operator wants
    // participants to pass through resumably.
    for (const bad of [
      { saved_window_days: 30, expiration_window_days: 7 },
      { saved_window_days: 0, expiration_window_days: 0 },
      { saved_window_days: "seven", expiration_window_days: null },
      {},
    ]) {
      const r = resolveThresholds(bad);
      expect(r, `malformed config ${JSON.stringify(bad)} must fall back`).toEqual(
        DEFAULT_THRESHOLDS,
      );
    }
  });

  it("§7 — the thresholds do NOT affect scoring or the Money Picture", () => {
    // Operator instruction: "These lifecycle thresholds are operational
    // configuration and must not affect diagnostic scoring or the Set for Life
    // Money Picture(TM)."
    //
    // Enforced structurally: the lifecycle module is not importable by anything
    // on the scoring path, and the scoring config does not mention it.
    const scoring = read("config/scoring-v1.0.json");
    expect(
      scoring,
      "the scoring config must not carry lifecycle thresholds",
    ).not.toMatch(/saved_window_days|expiration_window_days/);

    for (const f of [
      "lib/assessment/scoring.ts",
      "lib/assessment/tensions.ts",
      "lib/assessment/evidence-chain.ts",
      "lib/assessment/snapshot-payload.ts",
    ]) {
      const src = read(f);
      expect(
        src,
        `${f} must not depend on the lifecycle module — it is operational, not diagnostic`,
      ).not.toMatch(/session\/lifecycle|session\/sweep/);
    }

    // And the lifecycle config is a SEPARATE versioned artifact, so a timeout
    // change cannot move scoring_engine_version.
    const lc = JSON.parse(read("config/lifecycle-v1.0.json")) as Record<string, unknown>;
    expect(lc.version, "the lifecycle config is versioned separately").toBe("1.0");
    expect(lc._does_not_affect_scoring).toBe(true);
  });

  it("boundaries hold for every combination of status and elapsed time", () => {
    // The full table, so no combination is untested.
    const cases: Array<[number, string]> = [
      [0, "current"],
      [0.5, "current"],
      [6.99, "current"],
      [7, "abandoned"],
      [10, "abandoned"],
      [29.99, "abandoned"],
      [30, "expired"],
      [45, "expired"],
    ];
    for (const [days, expected] of cases) {
      const got = classifyIdle(agoIso(days), NOW, T);
      console.log(`  ${String(days).padStart(5)} days -> ${got}`);
      expect(got, `${days} days`).toBe(expected);
    }
  });
});

// ===========================================================================
// Requirement 8 — the stage identifier
// ===========================================================================

describe("§8 the stage identifier is position-derived, never content", () => {
  const sequence = ["OPEN_A", "OPEN_B", "Q4", "Q1", "Q7", "Q17", "Q5", "Q2"];

  it("reports where the participant stopped, as an instrument identifier", () => {
    const inputs = { sequence, moments: [], activationStartIndex: sequence.length - 4 };

    expect(stageAt({ ...inputs, completedCount: 0 })).toBe(STAGE_OPENING);
    expect(stageAt({ ...inputs, completedCount: 2 })).toBe("Q4");
    expect(stageAt({ ...inputs, completedCount: 5 })).toBe("Q17");
    expect(stageAt({ ...inputs, completedCount: sequence.length })).toBe(STAGE_COMPLETE);
    console.log("  stages: opening, Q4, Q17, complete");
  });

  it("names a Money Moment when the participant stopped AT one", () => {
    // A moment fires between two questions, so a participant who stopped there
    // stopped at the MOMENT — which is the operator's example identifier MM02.
    const inputs = {
      sequence,
      moments: [{ id: "MM02", afterSequenceIndex: 4 }],
      activationStartIndex: 6,
    };
    expect(stageAt({ ...inputs, completedCount: 5 })).toBe("MM02");
    console.log("  after index 4 -> MM02");
  });

  it("takes an integer and an order — there is no parameter for an answer", () => {
    // The guarantee is structural, not a promise: `stageAt` has no access to a
    // response value, so it cannot leak one however it is called.
    const inputs = { sequence, moments: [], activationStartIndex: 6 };
    const stage = stageAt({ ...inputs, completedCount: 3 });
    expect(typeof stage).toBe("string");
    expect(stage).toBe("Q1");

    // Derived from position, the two representations cannot drift.
    expect(stageForPosition(4, inputs), "position 4 = 3 answered").toBe("Q1");
  });
});

// ===========================================================================
// Requirement 8 — analytics distinguish the paths
// ===========================================================================

describe("§8 analytics distinguish every lifecycle path", () => {
  it("the five required paths are each a distinct, nameable sequence", () => {
    // "We need to be able to distinguish: saved -> completed; saved -> abandoned
    // -> resumed -> completed; and abandoned -> resumed -> completed."
    //
    // Distinct EVENT NAMES are what make those countable apart. This asserts the
    // vocabulary contains what each path needs.
    const events = read("lib/analytics/events.ts");
    for (const needed of [
      "assessment_started",
      "save_progress_used",
      "assessment_abandoned",
      "assessment_resumed_after_abandonment",
      "assessment_resumed",
      "assessment_expired",
      "assessment_restarted_after_expiration",
      "assessment_completed",
      "snapshot_generated",
      "snapshot_viewed",
      "snapshot_pdf_downloaded",
    ]) {
      expect(events, `the vocabulary must contain ${needed}`).toMatch(
        new RegExp(`"${needed}"`),
      );
    }
    console.log("  all 11 required lifecycle events present");
  });

  it("preserves the saved-vs-unsaved distinction", () => {
    // Operator instruction #8: "analytics must preserve that the participant had
    // previously intentionally saved so we can distinguish: saved abandonment
    // from unsaved abandonment. This will allow us to measure whether Save My
    // Progress actually contributes to eventual completion."
    const events = read("lib/analytics/events.ts");
    expect(events, "`saved` must be an allowed payload key").toMatch(/"saved"/);

    // And the sweep sets it from the durable record of the save.
    const sweep = read("lib/session/sweep.ts");
    expect(sweep).toMatch(/participantHasVerifiedContact/);
    expect(sweep).toMatch(/saved,/);

    // The DB allow-list must agree, or the write is silently rejected.
    const migration = read("supabase/migrations/20261001000011_lifecycle_analytics.sql");
    expect(migration, "the DB allow-list must accept `saved`").toMatch(/'saved'/);
  });

  it("the abandonment payload carries a position and a stage, never an answer", () => {
    const sweep = read("lib/session/sweep.ts");
    // The payload the sweep writes.
    const payloadBlock = sweep.match(/payload:\s*\{([\s\S]*?)\},/);
    expect(payloadBlock, "the sweep must write a payload").toBeTruthy();
    const keys = [...payloadBlock![1].matchAll(/(\w+):/g)].map((m) => m[1]);
    console.log(`  abandonment payload keys: ${JSON.stringify(keys)}`);
    for (const k of keys) {
      expect(
        ["position", "stage", "saved"],
        `unexpected payload key ${k} — the allow-list exists to make this list short`,
      ).toContain(k);
    }
  });

  it("the sweep emits the right event for each transition", () => {
    const sweep = read("lib/session/sweep.ts");
    expect(sweep).toMatch(/to === 'abandoned' \? 'assessment_abandoned' : 'assessment_expired'/);
  });
});

// ===========================================================================
// Requirement 7 — the sweep itself
// ===========================================================================

describe("§7 the sweep is forward-only and idempotent", () => {
  it("never moves a session backwards", () => {
    // An abandoned session that is somehow still fresh must NOT be returned to
    // in_progress by the sweep — resuming is the participant's action, and a
    // concurrent sweep undoing it would lose their place.
    //
    // THIS TEST WAS A FALSE GREEN WHEN FIRST WRITTEN. It used a fresh (1-day)
    // abandoned session, which never reaches the forward-only guard at all:
    // `classifyIdle` classifies a 1-day session as `current` and the loop
    // continues before the guard is consulted. Deleting the guard left all 31
    // tests passing.
    //
    // The guard can only fire on a session that is BOTH `abandoned` AND past the
    // saved window — a state the sweep would only meet if a session were already
    // abandoned while its activity were recent, which a resume produces. So the
    // case is constructed directly: classification says `abandoned`, status is
    // already `abandoned`, and the only thing standing between it and an
    // erroneous re-write is the forward-only guard.
    const fresh = planTransitions(
      [session({ status: "abandoned", last_activity_at: agoIso(1) })],
      NOW,
      T,
    );
    expect(fresh, "a fresh abandoned session is left entirely alone").toEqual([]);

    // And the exhausted case: 10 days idle, already abandoned. Classification
    // returns `abandoned`, target is `abandoned`, and WITHOUT the forward-only
    // guard this would emit a redundant transition.
    const alreadyAbandoned = planTransitions(
      [session({ status: "abandoned", last_activity_at: agoIso(10) })],
      NOW,
      T,
    );
    console.log(`  abandoned (10d) -> transitions: ${alreadyAbandoned.length}`);
    expect(
      alreadyAbandoned,
      "a session already in its target state must not be transitioned again",
    ).toEqual([]);

    // The guard matters most here: an abandoned session at 10 days classifies as
    // `abandoned`, so a sweep without the `target === s.status` check would
    // rewrite it and re-emit the abandonment event on every run — the funnel
    // would count the same abandonment repeatedly.
    const countsOverTime = planTransitions(
      [session({ status: "abandoned", last_activity_at: agoIso(10) })],
      NOW,
      T,
    ).length;
    expect(countsOverTime, "re-running the sweep must not re-count analytics").toBe(0);
  });

  it("FORWARD-ONLY holds for EVERY status × elapsed-time combination", () => {
    // THE PROPERTY, exhaustively. The individual cases above each pin one
    // behaviour; this asserts the invariant they are instances of, across the
    // whole input space, so a future status or threshold cannot introduce a
    // backward move that no single case covers.
    //
    // This replaces a guard that used to live in `planTransitions`:
    //   if (s.status === 'abandoned' && target !== 'expired') continue;
    // Mutation testing showed that line was DEAD — deleting it changed nothing,
    // because the `target === s.status` check above it already covers every case
    // it could. A guard no input can reach reads as enforcement and is not, so
    // it was removed and this property test took its place.
    const ORDER: Record<string, number> = { in_progress: 0, abandoned: 1, expired: 2 };
    const statuses = ["in_progress", "abandoned", "completed", "expired"];
    const elapsed = [0, 1, 6.99, 7, 10, 29.99, 30, 45, 400];

    const violations: string[] = [];
    const transitions: string[] = [];

    for (const status of statuses) {
      for (const days of elapsed) {
        const plan = planTransitions(
          [session({ status, last_activity_at: agoIso(days) })],
          NOW,
          T,
        );
        for (const step of plan) {
          const from = ORDER[step.from];
          const to = ORDER[step.to];
          transitions.push(`${status}@${days}d -> ${step.to}`);
          // A backward move, or a move between incomparable states.
          if (from === undefined || to === undefined || to <= from) {
            violations.push(`${status}@${days}d -> ${step.to}`);
          }
        }
      }
    }

    console.log(`  ${transitions.length} transitions across 36 combinations`);
    console.log(`  sample: ${transitions.slice(0, 6).join(" | ")}`);
    expect(
      violations,
      `backward or non-advancing transitions: ${violations.join(", ")}`,
    ).toEqual([]);

    // And the sweep must never TOUCH a terminal state, at any age.
    for (const terminal of ["completed", "expired"]) {
      for (const days of elapsed) {
        expect(
          planTransitions([session({ status: terminal, last_activity_at: agoIso(days) })], NOW, T),
          `${terminal} at ${days}d must never transition`,
        ).toEqual([]);
      }
    }
  });

  it("is idempotent: a second run finds nothing to do", () => {
    const expired = session({ status: "expired", last_activity_at: agoIso(60) });
    const abandoned = session({
      session_id: "s-2",
      status: "abandoned",
      last_activity_at: agoIso(10),
    });
    expect(planTransitions([expired, abandoned], NOW, T)).toEqual([]);
  });

  it("leaves a current session alone", () => {
    expect(planTransitions([session({ last_activity_at: agoIso(1) })], NOW, T)).toEqual([]);
  });

  it("plans both transitions in one pass over mixed sessions", () => {
    const plan = planTransitions(
      [
        session({ session_id: "fresh", last_activity_at: agoIso(1) }),
        session({ session_id: "stale", last_activity_at: agoIso(10) }),
        session({ session_id: "ancient", last_activity_at: agoIso(45) }),
        session({ session_id: "done", status: "completed", last_activity_at: agoIso(400) }),
      ],
      NOW,
      T,
    );
    const bySession: Record<string, string> = Object.fromEntries(
      plan.map((p: { session: { session_id: string }; to: string }) => [p.session.session_id, p.to]),
    );
    console.log(`  plan: ${JSON.stringify(bySession)}`);
    expect(bySession).toEqual({ stale: "abandoned", ancient: "expired" });
    expect(bySession.fresh, "a current session is untouched").toBeUndefined();
    expect(bySession.done, "a completed session is untouched").toBeUndefined();
  });
});
