import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Schema-contract tests for the 1.1 Snapshot payload (Addendum 01 v1.1 §3.2).
 *
 * WHY THIS FILE EXISTS.
 *
 * The owner approved adding three field categories to the immutable
 * snapshot_payload — Q16 participant selections, per-signal evidence strength,
 * and the reserved Perception Gap inputs — in the pre-pilot window (the DB has
 * ZERO Snapshots, so nothing is stranded and no backfill is needed).
 *
 * The contract to pin down is: a NEWLY CREATED Snapshot contains every field
 * every approved results module requires, and a renderer can operate from
 * snapshot_payload ALONE (never by re-reading raw responses). Because the
 * payload is append-only and one-per-session, a field omitted at write time can
 * never be backfilled — so the contract must be proven at the PRODUCER, i.e. by
 * running the real `completeSession` and asserting on the object it persists.
 *
 * This exercises the WRITE PATH, not a fixture that encodes the consumer's
 * assumptions — the cross-check the write/read-convention false-green lesson
 * calls for.
 */

vi.mock("server-only", () => ({}));

import { completeSession } from "@/lib/session/service";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";
import { resolvePerceptionGap } from "@/lib/assessment/snapshot-payload";

const repo = resolve(__dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(repo, p), "utf8"));

vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

interface Captured {
  snapshot: Record<string, unknown> | null;
  computedSignals: Array<Record<string, unknown>>;
}

/**
 * Minimal in-memory stand-in — captures the snapshot + computed_signals writes.
 *
 * Since owner ruling item 3 these arrive through `complete_session_atomic`
 * rather than as direct table writes: the derived rows and the Snapshot are
 * handed to ONE function that the real database runs in one transaction. The
 * fake therefore serves `rpc` and refuses a direct write to those tables — a
 * fake that accepted both would let the transaction disappear while these
 * payload-shape assertions stayed green.
 */
function fakeDb(rows: Array<{ item_id: string; option_code: string }>) {
  const captured: Captured = { snapshot: null, computedSignals: [] };
  const db = {
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name !== "complete_session_atomic") {
        throw new Error(`fakeDb: unexpected rpc ${name}`);
      }
      captured.computedSignals = (params.p_signals as Array<Record<string, unknown>>) ?? [];
      captured.snapshot = params.p_snapshot as Record<string, unknown>;
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table: string) {
      if (table === "responses") {
        const q = { select: () => q, eq: () => Promise.resolve({ data: rows, error: null }) };
        return q;
      }
      if (table === "computed_signals" || table === "tensions" || table === "overrides" || table === "snapshots") {
        throw new Error(
          `fakeDb: ${table} must be written through complete_session_atomic, not directly`,
        );
      }
      if (table === "assessment_sessions") {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: () => Promise.resolve({ data: { status: "in_progress" }, error: null }),
          update: () => q,
        };
        return q;
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return { db, captured };
}

function storedRows(overrides: Record<string, string | string[]>) {
  const base: Record<string, string> = {};
  for (const id of REQUIRED_ITEM_IDS) base[id] = `${id}_C`;
  const merged = { ...base, ...overrides };
  const rows: Array<{ item_id: string; option_code: string }> = [];
  for (const [item, value] of Object.entries(merged)) {
    if (Array.isArray(value)) for (const v of value) rows.push({ item_id: item, option_code: v });
    else rows.push({ item_id: item, option_code: value });
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

beforeEach(() => vi.clearAllMocks());

/** The persisted payload, deep-cloned as though round-tripped through storage. */
function payloadOf(captured: Captured): any {
  return JSON.parse(JSON.stringify(captured.snapshot?.payload_json));
}

describe("a newly created Snapshot carries every field the approved results modules require", () => {
  it("covers all fields, keyed to report-v1.0.json's results screens", async () => {
    const { result, captured } = await run({});
    expect(result.complete).toBe(true);

    const payload = payloadOf(captured);

    // --- the version pinning every module depends on (§3) ---
    expect(payload.versions.snapshotSchema).toBe("1.1");
    for (const k of ["instrument", "scoringEngine", "narrativeLibrary"]) {
      expect(typeof payload.versions[k], `versions.${k}`).toBe("string");
    }

    // --- Big Picture / operating profile ---
    expect(payload.bigPicture).toBeTruthy();
    expect(Array.isArray(payload.bigPicture.parts)).toBe(true);

    // --- Money Picture: six signals, each with state + narrative + evidence ---
    expect(payload.signals).toHaveLength(6);
    for (const s of payload.signals) {
      expect(typeof s.signal, "signal id").toBe("string");
      expect(s).toHaveProperty("narrativeKey");
      expect(s).toHaveProperty("evidence");
      expect(["high", "moderate", "limited"]).toContain(s.evidence.confidence);
      expect(["CAPACITY_CONTEXT", "THIN_EVIDENCE", null]).toContain(s.evidence.limitedReason);
    }

    // --- What's Already Working / Where There's Friction / The Connection ---
    expect(Array.isArray(payload.strengths)).toBe(true);
    expect(Array.isArray(payload.frictions)).toBe(true);
    expect(Array.isArray(payload.connections)).toBe(true);
    expect(Array.isArray(payload.context)).toBe(true);

    // --- What Set for Life Means to You (destination-meaning, order 7) ---
    expect(Array.isArray(payload.q16Selections)).toBe(true);

    // --- Perception Gap (order 8) — the reserved CONTAINER, never a result ---
    expect(payload).toHaveProperty("perceptionGap");
    expect(payload).toHaveProperty("perceptionGapStatus");
    expect(payload.perceptionGap).toBeNull();
    expect(payload.perceptionGapStatus).not.toBe("finalized");

    // --- Your Readiness Right Now (order 9) ---
    expect(Object.keys(payload.activation).sort()).toEqual(["A1", "A2", "A3", "A4"]);

    // --- One Area Worth Examining Next (order 10) ---
    expect(Array.isArray(payload.attentionAreas)).toBe(true);

    // --- null finding / internal facts ---
    expect(typeof payload.nullFinding).toBe("boolean");
    expect(payload).toHaveProperty("moveSubsignals");
    expect(payload).toHaveProperty("openingB");
  });

  it("Q16 selections are the participant's ACTUAL codes, order and multiplicity preserved", async () => {
    const { captured } = await run({ Q16: ["Q16_A", "Q16_D"] });
    const payload = payloadOf(captured);
    console.log("  q16Selections:", JSON.stringify(payload.q16Selections));
    expect(payload.q16Selections).toEqual(["Q16_A", "Q16_D"]);
  });

  it("a capacity-overridden DIRECT carries CAPACITY_CONTEXT, distinct from thin evidence", async () => {
    // Addendum 01 v1.1 §10: AGENCY_EVIDENCE=LIMITED_DUE_TO_CAPACITY_CONTEXT must
    // remain distinguishable from genuinely weak Agency. This is the WRITE PATH,
    // so the distinction is proven to survive into the persisted payload, not
    // just in the derivation function.
    const { captured } = await run({ Q10: "Q10_E", Q11: "Q11_A", Q12: "Q12_E" });
    const payload = payloadOf(captured);
    const direct = payload.signals.find((s: any) => s.signal === "DIRECT");
    console.log("  DIRECT evidence:", JSON.stringify(direct.evidence));
    expect(direct.specialState).toBe("DIRECT_CAPACITY_LIMITED");
    expect(direct.evidence.confidence).toBe("limited");
    expect(direct.evidence.limitedReason).toBe("CAPACITY_CONTEXT");
    // The narrative key still comes from the special state — evidence is
    // metadata and does not override the margin-independent protection.
    expect(direct.narrativeKey).toBe("special_signal_states.DIRECT_CAPACITY_LIMITED");
  });

  it("evidence strength is METADATA — no aggregate evidence field, no score", async () => {
    const { captured } = await run({});
    const payload = payloadOf(captured);
    // No top-level aggregate exists; evidence lives ONLY on each signal.
    expect(payload).not.toHaveProperty("evidence");
    expect(payload).not.toHaveProperty("evidenceStrength");
    expect(payload).not.toHaveProperty("financialHealthRating");
    expect(payload).not.toHaveProperty("score");
  });
});

describe("a renderer operates from snapshot_payload ALONE — never raw responses", () => {
  // Labels resolve at render time from the pinned question bank (a config
  // artifact), NOT by re-reading the responses table. The immutable fact is the
  // CODE list in the payload.
  const resolveQ16Labels = (
    q16Selections: string[],
    assessment: { questions: Array<{ internal_id: string; options: Array<{ code: string; label: string }> }> },
  ): string[] => {
    const q16 = assessment.questions.find((q) => q.internal_id === "Q16");
    const byCode = new Map((q16?.options ?? []).map((o) => [o.code, o.label]));
    return q16Selections
      .map((code) => byCode.get(code) ?? null)
      .filter((x): x is string => x !== null);
  };

  it("Q16 labels resolve from the payload's codes against the question bank", async () => {
    const { captured } = await run({ Q16: ["Q16_A", "Q16_D"] });
    const payload = payloadOf(captured); // the ONLY thing the renderer gets
    const assessment = read("config/assessment-v1.0.json");

    const labels = resolveQ16Labels(payload.q16Selections, assessment);
    console.log("  resolved labels:", JSON.stringify(labels));
    expect(labels).toEqual([
      "Not constantly worrying about money",
      "Having savings and being prepared for the unexpected",
    ]);
  });

  it("the payload round-trips through storage with its 1.1 fields intact", async () => {
    // The renderer reads the JSON the DB stores. If any 1.1 field serialised
    // away, a renderer could not depend on it — so this asserts the persisted
    // object survives a JSON round-trip without losing q16Selections, openingB,
    // or evidence.
    const { captured } = await run({ Q16: ["Q16_B"] });
    const payload = payloadOf(captured);
    expect(Array.isArray(payload.q16Selections)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload, "openingB")).toBe(true);
    expect(payload.signals.every((s: any) => s.evidence !== undefined)).toBe(true);
  });
});

describe("the Perception Gap fields are CONTAINERS — nothing may populate a computed value", () => {
  it("every reachable assembly leaves perceptionGap null and never finalizes", async () => {
    // Q16 is a REQUIRED item, so completion never assembles a payload with Q16
    // unanswered — the only reachable profiles through the write path all have
    // Q16 answered, and while the method is TBD every one lands on the SAME
    // container state: null result, not 'finalized'. If any path fabricated a
    // value, this fails.
    const profiles: Array<Record<string, string | string[]>> = [
      {}, // Q16 neutral answer -> method_pending
      { Q16: ["Q16_A", "Q16_D"] }, // Q16 answered -> method_pending
      { Q11: "Q11_A" }, // capacity override, Q16 answered -> method_pending
    ];
    for (const profile of profiles) {
      const { captured } = await run(profile);
      const payload = payloadOf(captured);
      console.log(
        `  Q16=${JSON.stringify(profile.Q16)} -> status=${payload.perceptionGapStatus} gap=${JSON.stringify(payload.perceptionGap)}`,
      );
      expect(payload.perceptionGap).toBeNull();
      expect(payload.perceptionGapStatus).not.toBe("finalized");
    }
  });

  it("the 'not_ready' container state is recorded when Q16 is unanswered", () => {
    // The OTHER null container state. Unreachable via the write path (Q16 is
    // required, so an unanswered Q16 never completes), but the container itself
    // must still record the distinction rather than fabricating a value.
    const r = resolvePerceptionGap({
      openingB: 3,
      q16Selections: [],
      signalMeans: {},
      perceptionGapConfig: read("config/scoring-v1.0.json").perception_gap,
    } as never);
    expect(r.perceptionGap).toBeNull();
    expect(r.perceptionGapStatus).toBe("not_ready");
  });
});
