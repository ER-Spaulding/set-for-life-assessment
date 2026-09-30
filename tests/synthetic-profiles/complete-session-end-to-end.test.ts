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

/** Minimal in-memory stand-in for the Supabase service client. */
interface Captured {
  computedSignals: Array<Record<string, unknown>>;
  tensions: Array<Record<string, unknown>>;
  sessionUpdate: Record<string, unknown> | null;
}

function fakeDb(rows: Array<{ item_id: string; option_code: string }>) {
  const captured: Captured = {
    computedSignals: [],
    tensions: [],
    sessionUpdate: null,
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
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "tensions") {
        return {
          upsert: (payload: Array<Record<string, unknown>>) => {
            captured.tensions = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "assessment_sessions") {
        const q = {
          update: (payload: Record<string, unknown>) => {
            captured.sessionUpdate = payload;
            return q;
          },
          eq: () => Promise.resolve({ error: null }),
        };
        return q;
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
    const direct = captured.computedSignals.find((s) => s.signal === "DIRECT");
    console.log("  DIRECT persisted:", JSON.stringify(direct));
    console.log("  capacity-constrained tensions:", JSON.stringify(codes));

    // Precondition: the override really did fire, or the test is vacuous.
    expect(direct?.special_state).toBe("DIRECT_CAPACITY_LIMITED");
    expect(direct?.state).toBe("S5");
    expect(codes).toContain("HIGH_ACTIVITY_LOW_DIRECTION");
  });

  it("writes all six signals with a lowercased evidence_confidence the DB accepts", async () => {
    const { captured } = await run({ Q4: "Q4_E", Q5: "Q5_E", Q6: "Q6_E" });
    const signals = captured.computedSignals.map((s) => s.signal as string);
    console.log(
      "  signals:",
      JSON.stringify(
        captured.computedSignals.map((s) => [s.signal, s.evidence_confidence]),
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
