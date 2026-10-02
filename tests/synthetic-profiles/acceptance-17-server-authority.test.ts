import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `lib/session/service.ts` is server-only (it throws on bare import outside
// react-server). Mock the marker so the pure/server-structure surface can be
// exercised under Vitest; the DB-bound paths are asserted structurally.
vi.mock("server-only", () => ({}));

import {
  pinnedVersion,
  toResponseMap,
} from "@/lib/session/service";
import {
  validateCompleteness,
  REQUIRED_ITEM_IDS,
} from "@/lib/assessment/validation";

const serviceSrc = readFileSync(
  resolve(__dirname, "../../lib/session/service.ts"),
  "utf8",
);
const scoringCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);
const assessmentCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);
const reportCfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/report-v1.0.json"), "utf8"),
);

const full31 = (answer = "C"): Record<string, unknown> =>
  Object.fromEntries(REQUIRED_ITEM_IDS.map((id) => [id, answer]));

/**
 * PRD §29 TEST 17 — server authority (PRD §23.5, §24).
 *
 * "Never trust client-side completion, identity ownership, scoring, or
 * consent state. Required-item validation and final scoring run server-side."
 *
 * This supersedes the skip note in acceptance-2.test.ts: the API layer it
 * was waiting on (lib/session/service.ts) now exists, so the test is written
 * here instead of as a vacuous stub. DB-bound paths (completeSession,
 * loadSnapshot round-trips) are asserted structurally against the service
 * source; everything behaviorally assertable without a database is executed
 * for real (completeness gate, response flattening, version constant).
 */

describe("PRD §29 TEST 17 — completion is computed server-side from stored responses; no client flag can bypass the gate", () => {
  it("an incomplete set stays incomplete even with client-supplied complete/consent flags", () => {
    const { Q25: _q25, A4: _a4, ...rest } = full31();
    void _q25;
    void _a4;
    const withClientFlags = {
      ...rest,
      complete: true,
      status: "completed",
      consent: true,
    };
    const v = validateCompleteness(withClientFlags);
    console.log("  missing:", JSON.stringify(v.missing), "present:", v.present);
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(["Q25", "A4"]);
    expect(v.present).toBe(29);
    expect(v.required).toBe(31);
  });

  it("the full 31 completes; demographics (D1–D3) never affect the gate either way", () => {
    expect(validateCompleteness(full31()).complete).toBe(true);
    const withDemographics = { ...full31(), D1: "D1_A", D2: "D2_B", D3: "D3_C" };
    expect(validateCompleteness(withDemographics).complete).toBe(true);
    const { Q25: _q25, ...rest } = full31();
    void _q25;
    expect(validateCompleteness({ ...rest, D1: "D1_H" }).complete).toBe(false);
  });

  it("toResponseMap flattens stored rows; multi-selects keep stored order", () => {
    const map = toResponseMap([
      { item_id: "Q4", option_code: "Q4_E" },
      { item_id: "Q21", option_code: "Q21_A" },
      { item_id: "Q21", option_code: "Q21_C" },
      { item_id: "Q1", option_code: "Q1_B" },
      { item_id: "Q1", option_code: "Q1_D" },
    ]);
    console.log("  map:", JSON.stringify(map));
    expect(map).toEqual({
      Q4: "Q4_E",
      Q21: ["Q21_A", "Q21_C"],
      Q1: ["Q1_B", "Q1_D"],
    });
  });
});

describe("PRD §29 TEST 17 — completeSession takes a session id and nothing else; validation and scoring run inside it", () => {
  it("signature admits no client completeness, scoring, or consent parameter", () => {
    const m = serviceSrc.match(/export async function completeSession\(([^)]*)\)/);
    console.log("  completeSession params:", m?.[1]);
    expect(m?.[1].trim()).toBe("sessionId: string");
  });

  it("the gate and the scorer both run server-side at completion", () => {
    expect(serviceSrc).toContain("validateCompleteness(responseMap)");
    expect(serviceSrc).toContain("scoreAssessment(letters, tables, cutoffs)");
    // Scoring inputs derive from persisted rows only — never a client body.
    expect(serviceSrc).toContain("toResponseMap((rows ?? [])");
  });
});

describe("PRD §29 TEST 17 — mid-assessment participants receive answers and position, never diagnostics (§23.2, §24)", () => {
  it("resume reads answers/position only and returns no scoring output", () => {
    const body = serviceSrc.slice(
      serviceSrc.indexOf("export async function loadResumeState"),
      serviceSrc.indexOf("export function toResponseMap"),
    );
    expect(body).toContain('.select("session_id, status, current_position")');
    expect(body).toContain('.select("item_id, option_code")');
    for (const forbidden of [
      "computed_signals",
      "tensions",
      "evidence",
      "classifier",
      "attentionArea",
      "narrativeKey",
    ]) {
      expect(body, `resume must not touch ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the Snapshot is gated on completion — mid-assessment yields nothing", () => {
    expect(serviceSrc).toMatch(
      /if\s*\(!session \|\| session\.status !== "completed"\) return null/,
    );
  });
});

describe("PRD §29 TEST 17 — the server pins the v1.0 asset version (binds TEST 18 to the API layer)", () => {
  it("the session pin is READ from config, so it cannot claim a version the config does not", () => {
    // This test used to assert `PINNED_VERSION === "1.0"`. That was true and
    // useless: a constant always equals itself, and it kept claiming "1.0" no
    // matter what the configs said. The defect was that it was a CONSTANT — so
    // the assertion that matters is that the value TRACKS the config.
    const pinned = pinnedVersion();
    console.log(
      "  pinned:",
      pinned,
      "configs:",
      assessmentCfg.version,
      scoringCfg.version,
      reportCfg.version,
    );
    expect(pinned).toBe(assessmentCfg.version);
    // The three configs agree with each other today; if one is revised alone,
    // this fails and the divergence becomes a decision rather than a drift.
    expect(scoringCfg.version).toBe(assessmentCfg.version);
    expect(reportCfg.version).toBe(assessmentCfg.version);
  });
});
