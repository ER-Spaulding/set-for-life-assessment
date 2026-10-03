// Analytics must DISTINGUISH the lifecycle paths — behaviour, not a name-existence check.
//
// WHY THIS FILE EXISTS. The operator's instruction #8 requires analytics to tell
// apart: started, Save My Progress used, incomplete-within-7-days, abandoned,
// abandoned-resumed, saved-resumed, expired, completed, and Snapshot
// generated/viewed/downloaded — AND to distinguish SAVED abandonment from UNSAVED
// abandonment. The existing coverage (`tests/unit/analytics.test.ts` and
// `tests/integration/assessment-lifecycle.test.ts` §8) proves those event NAMES
// exist and that `saved` is an allowed key — by regex over source text. It does
// not prove that each path actually EMITS a different, correct sequence, nor
// that the emitted payload is exactly {position, stage, saved} with a
// position-derived stage and a two-valued `saved`.
//
// This file closes that gap by running the REAL sweep against a stubbed Supabase
// client and the REAL `recordEvent` writer (mocked to capture, not to fake the
// payload construction), and asserting the emitted events and payloads. That is
// the cross-check the false-green lessons demand: exercise the PRODUCER, never a
// fixture that encodes the consumer's assumptions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The sweep imports `server-only`, `serviceClient`, and `recordEvent`. Mock all
// three so the REAL `runSweep` runs offline, exactly like the existing suite.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/write", () => ({
  recordEvent: vi.fn(),
  recordEventInBackground: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  serviceClient: vi.fn(),
  isDatabaseConfigured: () => true,
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

import { runSweep } from "@/lib/session/sweep";
import { stageForPosition, STAGE_OPENING, STAGE_COMPLETE } from "@/lib/session/stage";
import type { IncompleteSession } from "@/lib/session/lifecycle";
import { recordEvent } from "@/lib/analytics/write";
import { serviceClient } from "@/lib/db/client";
import {
  ANALYTICS_EVENTS,
  ALLOWED_PAYLOAD_KEYS,
  isPayloadSafe,
  sanitizePayload,
  type AnalyticsEvent,
} from "@/lib/analytics/events";

const repo = resolve(__dirname, "../..");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const agoIso = (days: number) => ago(days).toISOString();

function session(overrides: Partial<IncompleteSession> = {}): IncompleteSession {
  return {
    session_id: "s-1",
    participant_id: "p-1",
    status: "in_progress",
    last_activity_at: agoIso(0),
    current_position: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The instrument's administered order, read the same way the sweep reads it.
//
// This mirrors `sequenceOrder()` in lib/session/sweep.ts so the test can assert
// the emitted `stage` is the position-derived identifier the sweep computed,
// without hand-maintaining a second copy of the order. The option-code set is
// the FULL set of response values in the bank (every section, demographics
// included) — a stage identifier must never collide with any of them.
// ---------------------------------------------------------------------------
interface BankItem {
  internal_id: string;
  external_order?: number;
  options?: Array<{ code: string }>;
}
function instrument(): { sequence: string[]; optionCodes: Set<string> } {
  const bank = JSON.parse(
    readFileSync(resolve(repo, "config/assessment-v1.0.json"), "utf8"),
  ) as {
    opening?: BankItem[];
    questions?: BankItem[];
    activation?: BankItem[];
    demographics?: BankItem[];
  };
  const opening = (bank.opening ?? []).map((q) => q.internal_id);
  const diagnostic = [...(bank.questions ?? [])]
    .sort((a, b) => (a.external_order ?? 0) - (b.external_order ?? 0))
    .map((q) => q.internal_id);
  const activation = (bank.activation ?? []).map((q) => q.internal_id);
  const sequence = [...opening, ...diagnostic, ...activation];

  const optionCodes = new Set<string>();
  for (const q of [
    ...(bank.opening ?? []),
    ...(bank.questions ?? []),
    ...(bank.activation ?? []),
    ...(bank.demographics ?? []),
  ]) {
    for (const o of q.options ?? []) optionCodes.add(o.code);
  }
  return { sequence, optionCodes };
}

const { sequence: ORDER, optionCodes: OPTION_CODES } = instrument();
const STAGE_INPUTS = {
  sequence: ORDER,
  moments: [],
  activationStartIndex: ORDER.length - 4,
};
/** The closed set of identifiers a stage may ever be: instrument ids + phases. */
const CLOSED_STAGE_SET = new Set<string>([...ORDER, STAGE_OPENING, STAGE_COMPLETE, "ACTIVATION"]);

// ---------------------------------------------------------------------------
// A minimal in-memory stand-in for the Supabase service client.
//
// Same stated limitation as the other stubbed-DB tests: it has no schema, so it
// cannot catch a column mismatch. It serves the three queries the sweep makes —
// the incomplete-session read, the guarded transition update, and the
// verified-contact lookup — and nothing else, so a sweep that started touching
// a table it should not would throw here.
// ---------------------------------------------------------------------------
function makeDb(
  sessions: IncompleteSession[],
  savedParticipants: Set<string>,
  opts: { readError?: { message: string }; contactLookupError?: { message: string } } = {},
) {
  return {
    from(table: string) {
      if (table === "assessment_sessions") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve(
                opts.readError
                  ? { data: null, error: opts.readError }
                  : { data: sessions, error: null },
              ),
          }),
          update: (payload: { status: string }) => ({
            eq: (_k: string, _v: string) => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      if (table === "participant_contacts") {
        return {
          select: () => ({
            eq: (_k: string, participantId: string) => ({
              not: () => ({
                // `contactLookupError` makes the lookup THROW, which is the case
                // the producer's `catch` exists for. A returned `{error}` would
                // not exercise it: the producer reads only `data`, so a returned
                // error yields `Boolean(null)` on its own and the catch's own
                // return value would go untested.
                maybeSingle: () =>
                  opts.contactLookupError
                    ? Promise.reject(new Error(opts.contactLookupError.message))
                    : Promise.resolve({
                        data: savedParticipants.has(participantId)
                          ? { verified_at: "2026-01-01T00:00:00.000Z" }
                          : null,
                        error: null,
                      }),
              }),
            }),
          }),
        };
      }
      throw new Error(`fakeDb: unexpected table "${table}"`);
    },
  };
}

interface RecordedEvent {
  eventName: string;
  participantId: string | null | undefined;
  sessionId: string | null | undefined;
  payload: Record<string, unknown>;
}
const recorded: RecordedEvent[] = [];

async function sweepCapture(
  sessions: IncompleteSession[],
  savedParticipants: Set<string>,
  opts: { readError?: { message: string }; contactLookupError?: { message: string } } = {},
): Promise<{ result: Awaited<ReturnType<typeof runSweep>>; events: RecordedEvent[] }> {
  recorded.length = 0;
  const db = makeDb(sessions, savedParticipants, opts);
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await runSweep(NOW);
  return { result, events: recorded.map((e) => ({ ...e, payload: { ...e.payload } })) };
}

/**
 * Run the sweep expecting it to REJECT, and capture the thrown error.
 *
 * `runSweep` returns counts rather than throwing on individual session failures,
 * but a failed LIST read is a different case: the sweep has not classified
 * anything, so its counts would be a fabricated "0 abandoned, 0 expired" that a
 * cron log or a monitoring check would read as a healthy run. This helper exists
 * so that behaviour is asserted rather than assumed.
 */
async function sweepRejects(
  sessions: IncompleteSession[],
  savedParticipants: Set<string>,
  opts: { readError?: { message: string }; contactLookupError?: { message: string } },
): Promise<unknown> {
  recorded.length = 0;
  const db = makeDb(sessions, savedParticipants, opts);
  vi.mocked(serviceClient).mockReturnValue(db as never);
  try {
    await runSweep(NOW);
  } catch (err) {
    return err;
  }
  throw new Error("runSweep did not reject; it returned a result for a failed read");
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  vi.mocked(recordEvent).mockImplementation(
    async (args: {
      eventName: AnalyticsEvent;
      participantId?: string | null;
      sessionId?: string | null;
      payload?: Record<string, unknown>;
    }) => {
      recorded.push({
        eventName: args.eventName,
        participantId: args.participantId,
        sessionId: args.sessionId,
        payload: { ...(args.payload ?? {}) },
      });
      return true;
    },
  );
});

// ===========================================================================
// The sweep emits a DISTINCT event per transition, with a closed payload.
// ===========================================================================

describe("the sweep emits a distinct, correctly-shaped event per lifecycle transition", () => {
  it("an abandoned session emits assessment_abandoned with exactly {position, stage, saved}", async () => {
    // 10 full days idle: past the 7-day window, inside the 30-day window.
    const { result, events } = await sweepCapture(
      [session({ session_id: "s-1", participant_id: "p-1", last_activity_at: agoIso(10), current_position: 6 })],
      new Set(),
    );

    expect(result.abandoned).toBe(1);
    expect(result.expired).toBe(0);
    expect(events).toHaveLength(1);

    const ev = events[0];
    expect(ev.eventName).toBe("assessment_abandoned");
    expect(ev.sessionId).toBe("s-1");

    // The payload key set is EXACTLY the three structural keys, nothing more.
    expect(Object.keys(ev.payload).sort()).toEqual(["position", "saved", "stage"]);
    // position is the number the sweep read, passed through untouched.
    expect(ev.payload.position).toBe(6);
    // saved is a boolean (unsaved here), not a string or a lookup artifact.
    expect(ev.payload.saved).toBe(false);
  });

  it("saved abandonment is countable apart: saved=true when a verified contact exists", async () => {
    const unsaved = await sweepCapture(
      [session({ participant_id: "p-unsaved", last_activity_at: agoIso(10) })],
      new Set(),
    );
    const saved = await sweepCapture(
      [session({ participant_id: "p-saved", last_activity_at: agoIso(10) })],
      new Set(["p-saved"]),
    );

    // Both emit the SAME event name — the saved/unsaved distinction is the flag.
    expect(unsaved.events[0].eventName).toBe("assessment_abandoned");
    expect(saved.events[0].eventName).toBe("assessment_abandoned");

    expect(unsaved.events[0].payload.saved).toBe(false);
    expect(saved.events[0].payload.saved).toBe(true);
    // The two payloads genuinely differ — this is what makes the funnel countable.
    expect(saved.events[0].payload).not.toEqual(unsaved.events[0].payload);
  });

  it("an expired session emits assessment_expired — a DIFFERENT name from assessment_abandoned", async () => {
    // 31 full days idle: past the 30-day window. Fed as in_progress, the sweep
    // advances it straight to expired (the missed-the-abandoned-step case).
    const { result, events } = await sweepCapture(
      [session({ session_id: "s-2", last_activity_at: agoIso(31), current_position: 4 })],
      new Set(),
    );

    expect(result.expired).toBe(1);
    expect(result.abandoned).toBe(0);
    expect(events).toHaveLength(1);

    const ev = events[0];
    expect(ev.eventName).toBe("assessment_expired");
    // The same structural payload shape — the distinction is the EVENT NAME.
    expect(Object.keys(ev.payload).sort()).toEqual(["position", "saved", "stage"]);
    expect(ev.payload.position).toBe(4);
    expect(ev.payload.saved).toBe(false);
  });

  it("one sweep over a mixed population emits BOTH names, never one name for two transitions", async () => {
    const { result, events } = await sweepCapture(
      [
        session({ session_id: "stale", participant_id: "p-a", last_activity_at: agoIso(10) }),
        session({ session_id: "ancient", participant_id: "p-b", last_activity_at: agoIso(31) }),
        session({ session_id: "fresh", participant_id: "p-c", last_activity_at: agoIso(1) }),
      ],
      new Set(),
    );

    expect(result.abandoned).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.untouched).toBe(1);

    const names = events.map((e) => e.eventName).sort();
    console.log(`  emitted: ${names.join(", ")}`);
    expect(names).toEqual(["assessment_abandoned", "assessment_expired"]);

    // Both events carry the same three structural keys and a position number.
    for (const ev of events) {
      expect(Object.keys(ev.payload).sort()).toEqual(["position", "saved", "stage"]);
      expect(typeof ev.payload.position).toBe("number");
      expect(typeof ev.payload.saved).toBe("boolean");
      expect(typeof ev.payload.stage).toBe("string");
    }
  });

  // The sweep runs over a WHOLE population in one pass, so the unit of
  // correctness is the per-session event, not the per-run multiset. A sweep that
  // resolved saved/position/stage/correlators ONCE — from the first planned
  // session, or from a variable hoisted out of the loop — would emit a
  // correct-looking multiset (one abandoned, one expired, the right keys) while
  // attributing every value to the wrong participant. The funnel would be
  // silently mis-attributed. Mutation testing found exactly that gap here: with
  // values taken from `plan[0]`, every test in this file still passed.
  //
  // Each session below carries a DISTINCT position and a distinct saved state,
  // each pair is asserted independently, and the four sentinels are asserted
  // jointly so that even a swap between two sessions is caught.
  it("attributes each field to ITS OWN session — no value bleeds across the population", async () => {
    const { result, events } = await sweepCapture(
      [
        // First planned session: saved (verified contact), position 6, mid-window.
        session({
          session_id: "sa",
          participant_id: "pa",
          last_activity_at: agoIso(10),
          current_position: 6,
        }),
        // Second planned session: NOT saved, position 4, expired.
        session({
          session_id: "sb",
          participant_id: "pb",
          last_activity_at: agoIso(31),
          current_position: 4,
        }),
        // Third planned session: saved, position 12, abandoned.
        session({
          session_id: "sc",
          participant_id: "pc",
          last_activity_at: agoIso(8),
          current_position: 12,
        }),
      ],
      new Set(["pa", "pc"]),
    );

    expect(result.abandoned).toBe(2);
    expect(result.expired).toBe(1);
    expect(events).toHaveLength(3);

    const bySession = new Map(events.map((e) => [e.sessionId, e]));

    const sa = bySession.get("sa");
    expect(sa, "the saved session's event carries ITS session id").toBeDefined();
    expect(sa!.eventName).toBe("assessment_abandoned");
    expect(sa!.participantId).toBe("pa");
    expect(sa!.payload.position).toBe(6);
    expect(sa!.payload.stage).toBe(stageForPosition(6, STAGE_INPUTS));
    expect(sa!.payload.saved).toBe(true);

    const sb = bySession.get("sb");
    expect(sb, "the expired session's event carries ITS session id").toBeDefined();
    expect(sb!.eventName).toBe("assessment_expired");
    expect(sb!.participantId).toBe("pb");
    expect(sb!.payload.position).toBe(4);
    expect(sb!.payload.stage).toBe(stageForPosition(4, STAGE_INPUTS));
    expect(sb!.payload.saved).toBe(false);

    const sc = bySession.get("sc");
    expect(sc, "the second abandoned session's event carries ITS session id").toBeDefined();
    expect(sc!.eventName).toBe("assessment_abandoned");
    expect(sc!.participantId).toBe("pc");
    expect(sc!.payload.position).toBe(12);
    expect(sc!.payload.stage).toBe(stageForPosition(12, STAGE_INPUTS));
    expect(sc!.payload.saved).toBe(true);

    // Jointly: all four sentinels present, and none of them from the same
    // session as each other. A hoisted value would repeat one of these.
    expect(events.map((e) => e.sessionId).sort()).toEqual(["sa", "sb", "sc"]);
    expect(events.map((e) => e.payload.position).sort((a, b) => (a as number) - (b as number))).toEqual([4, 6, 12]);
    expect(events.filter((e) => e.payload.saved === true)).toHaveLength(2);
    expect(new Set(events.map((e) => e.payload.stage)).size).toBe(3);
  });
});

// ===========================================================================
// The four lifecycle paths are pairwise-distinct event-name multisets.
// ===========================================================================

describe("the four lifecycle paths are each a distinct, expressible event sequence", () => {
  // The event names each path needs. These are the TRANSITION events that
  // distinguish the paths; every name is taken from the closed vocabulary.
  const START = "assessment_started";
  const SAVE = "save_progress_used";
  const ABANDON = "assessment_abandoned";
  const EXPIRE = "assessment_expired";
  const RESUME = "assessment_resumed_after_abandonment";
  const COMPLETE = "assessment_completed";
  const SNAPSHOT = "snapshot_generated";

  const PATHS: Array<[string, string[]]> = [
    ["start -> complete", [START, COMPLETE, SNAPSHOT]],
    ["start -> abandon -> expire", [START, ABANDON, EXPIRE]],
    ["start -> abandon -> resume -> complete", [START, ABANDON, RESUME, COMPLETE, SNAPSHOT]],
    ["start -> save -> abandon -> resume -> complete", [START, SAVE, ABANDON, RESUME, COMPLETE, SNAPSHOT]],
  ];

  const multiset = (names: string[]) => [...names].sort().join("|");

  it("every event name a path needs exists in the closed vocabulary", () => {
    const all = new Set<string>(ANALYTICS_EVENTS as readonly string[]);
    for (const [label, names] of PATHS) {
      for (const n of names) {
        expect(all, `${label} needs ${n}, missing from ANALYTICS_EVENTS`).toContain(n);
      }
    }
  });

  it("no two paths share an event-name multiset", () => {
    for (let i = 0; i < PATHS.length; i++) {
      for (let j = i + 1; j < PATHS.length; j++) {
        const [labelA, namesA] = PATHS[i];
        const [labelB, namesB] = PATHS[j];
        expect(
          multiset(namesA),
          `"${labelA}" and "${labelB}" must be countable apart`,
        ).not.toBe(multiset(namesB));
      }
    }
    console.log("  all 6 path pairs are distinct");
  });

  it("the vocabulary itself is duplicate-free, so distinct names are distinct signals", () => {
    const names = ANALYTICS_EVENTS as readonly string[];
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);

    // And the specific pair that a collapse would break: a plain resume and a
    // resume-after-abandonment are two DIFFERENT names, not one reused.
    expect(names).toContain("assessment_resumed");
    expect(names).toContain("assessment_resumed_after_abandonment");
    expect("assessment_resumed").not.toBe("assessment_resumed_after_abandonment");
  });

  it("the abandoned/expired names the sweep emits are the ones the path table uses", async () => {
    // Cross-check, not an assumption: the names in PATHS for abandon/expire are
    // verified against what the sweep ACTUALLY emits (the describe block above),
    // so a change that collapses the two transitions fails there, not here.
    const { events } = await sweepCapture(
      [
        session({ session_id: "s-1", last_activity_at: agoIso(10) }),
        session({ session_id: "s-2", last_activity_at: agoIso(31) }),
      ],
      new Set(),
    );
    const emitted = events.map((e) => e.eventName).sort();
    expect(emitted).toEqual(["assessment_abandoned", "assessment_expired"]);
  });
});

// ===========================================================================
// The payload can never carry participant content.
// ===========================================================================

describe("the payload is structural, never substantive — answers cannot reach it", () => {
  it("the sweep payload keys are exactly the allow-list, cross-checked", async () => {
    const { events } = await sweepCapture(
      [session({ last_activity_at: agoIso(10), current_position: 19 })],
      new Set(["p-1"]),
    );
    const payload = events[0].payload;

    // Every key the sweep wrote is on the allow-list…
    for (const k of Object.keys(payload)) {
      expect(ALLOWED_PAYLOAD_KEYS as readonly string[], `key "${k}" is not allow-listed`).toContain(k);
    }
    // …and every key is structural (where/which/state), never a container for content.
    const banned = /answer|option|response|narrative|text|comment|income|amount|balance|debt|salary|state|email|phone|name/i;
    for (const k of Object.keys(payload)) {
      expect(banned.test(k), `substantive key "${k}" must not exist`).toBe(false);
    }
  });

  it("no option code, answer, or financial value can appear in an emitted payload", async () => {
    const { events } = await sweepCapture(
      [
        session({ session_id: "s-1", participant_id: "p-1", last_activity_at: agoIso(10), current_position: 19 }),
        session({ session_id: "s-2", participant_id: "p-1", last_activity_at: agoIso(31), current_position: 6 }),
      ],
      new Set(["p-1"]),
    );

    for (const ev of events) {
      for (const v of Object.values(ev.payload)) {
        if (typeof v === "string") {
          // A response value is an option code like "Q6_C" or "OPEN_A_A"; a stage
          // identifier is "Q6" or "OPENING". No emitted string may be an option code.
          expect(OPTION_CODES, `payload value "${v}" is a bank option code`).not.toContain(v);
        }
        // Scalar only — numbers (position), booleans (saved), short strings (stage).
        expect(["string", "number", "boolean"]).toContain(typeof v);
      }
    }
    console.log(`  checked ${events.length} payloads against ${OPTION_CODES.size} option codes`);
  });

  it("the payload guard still refuses substantive content at the boundary", () => {
    // The positive form of the operator's security rule: raw answers, financial
    // amounts, free text, and narrative are refused — not stored, not stripped-to-pass.
    const FORBIDDEN: Array<[string, Record<string, unknown>]> = [
      ["raw answers", { answers: { Q1: "Q1_B" } }],
      ["an option code under an innocuous name", { stage: { code: "Q6_C" } }],
      ["household income", { income: 75000 }],
      ["snapshot narrative", { narrative: "Your responses show..." }],
      ["free-text financial content", { comment: "I am worried about money" }],
      ["a nested object", { step: { deep: 1 } }],
      ["an array", { position: [1, 2, 3] }],
    ];
    for (const [label, payload] of FORBIDDEN) {
      expect(isPayloadSafe(payload), `must refuse ${label}`).toBe(false);
    }

    // And the sanitizer STRIPS rather than passes: the dirty keys disappear, the
    // structural one survives.
    const dirty = { position: 6, income: 75000, narrative: "You said...", answers: { Q1: "A" } };
    expect(sanitizePayload(dirty as never)).toEqual({ position: 6 });
  });

  it("a failed saved-lookup UNDER-reports: saved falls to false, never true", async () => {
    // The lookup's `catch` direction is a privacy/measurement decision, not an
    // arbitrary default: reporting `true` on failure would MANUFACTURE evidence
    // that Save My Progress works, inflating the very comparison the flag
    // exists to make. So the failure path must land on false.
    //
    // Mutation testing found this untested: flipping the catch's `return false`
    // to `return true` left both this file and the sibling lifecycle suite green.
    const { result, events } = await sweepCapture(
      [session({ session_id: "sl", participant_id: "pl", last_activity_at: agoIso(10) })],
      new Set(),
      { contactLookupError: { message: "contacts unavailable" } },
    );

    expect(result.abandoned).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("assessment_abandoned");
    // Under-reports rather than over-reports.
    expect(events[0].payload.saved).toBe(false);
  });

  it("a failed sessions read REJECTS — it never reports a cheerful empty sweep", async () => {
    // A sweep that swallowed the read error would return `{abandoned: 0,
    // expired: 0}` — indistinguishable, to a cron log or a monitoring check,
    // from "nothing needed doing". The transitions silently stop happening and
    // every session's classification freezes. The sweep must fail loudly
    // instead, so the failure is visible where the schedule runs.
    //
    // Mutation testing found this untested: deleting the `if (error) throw`
    // line left both this file and the sibling lifecycle suite green.
    const err = await sweepRejects(
      [session({ last_activity_at: agoIso(10) })],
      new Set(),
      { readError: { message: "connection refused" } },
    );

    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain("sweep");
    expect(String((err as Error).message)).toContain("connection refused");
    // And NO event was emitted off the back of a failed read.
    expect(recorded).toHaveLength(0);
  });
});

// ===========================================================================
// The stage is position-derived, never a response value.
// ===========================================================================

describe("the stage identifier is position-derived — a response value cannot surface", () => {
  it("position 1 is OPENING, and a mid-position maps to the item the participant is AT", () => {
    expect(stageForPosition(1, STAGE_INPUTS)).toBe(STAGE_OPENING);
    // Position 19 = 18 answered = the participant is looking at ORDER[18] (Q6 in
    // the shipped bank). The stage is the ITEM ID, not an option code.
    const mid = stageForPosition(19, STAGE_INPUTS);
    expect(mid).toBe(ORDER[18]);
    expect(OPTION_CODES, `stage "${mid}" is an option code, not a position`).not.toContain(mid);
  });

  it("the emitted stage is exactly the position-derived identifier", async () => {
    const { events } = await sweepCapture(
      [session({ session_id: "s-1", last_activity_at: agoIso(10), current_position: 19 })],
      new Set(),
    );
    const stage = events[0].payload.stage;
    // What the sweep put in the payload is precisely what position-derivation
    // produces for that position — no answer content slipped in between.
    expect(stage).toBe(stageForPosition(19, STAGE_INPUTS));
    expect(stage).toBe("Q6");
  });

  it("a response-shaped value fed as a position can never come back out as the stage", () => {
    // The guarantee is structural: stageForPosition takes an integer and an order.
    // Even if a response value is forced through where a position belongs, the
    // result is a CLOSED-SET identifier, never the response itself.
    for (const code of ["Q6_C", "OPEN_A_A", "A1_D", "75000"]) {
      const stage = stageForPosition(code as unknown as number, STAGE_INPUTS);
      expect(stage, `response-shaped "${code}" must not surface`).not.toBe(code);
      expect(CLOSED_STAGE_SET, `stage "${stage}" is outside the closed set`).toContain(stage);
    }
  });

  it("every position yields a closed-set identifier, disjoint from every option code", () => {
    // The property across the whole instrument: no position maps to an answer.
    for (let pos = 1; pos <= ORDER.length + 1; pos++) {
      const stage = stageForPosition(pos, STAGE_INPUTS);
      expect(CLOSED_STAGE_SET, `position ${pos} -> "${stage}" is not a controlled identifier`).toContain(stage);
      expect(OPTION_CODES, `position ${pos} -> "${stage}" collides with a bank option code`).not.toContain(stage);
    }
    console.log(`  ${ORDER.length + 1} positions -> closed-set identifiers, ${OPTION_CODES.size} option codes excluded`);
  });
});
