// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MODULE 8 (PERCEPTION GAP) IS DEFERRED FOR THE PILOT — and that absence is
 * INTENTIONAL and GUARDED, not an accident.
 *
 * Owner decision 2026-10-02: Module 8 does NOT ship in the pilot. This is a
 * deliberate product deferral pending pilot evidence — not authorization to
 * delete the underlying data or concept, and not a request to build anything.
 * The participant-facing Money Picture must read as COMPLETE, with no "coming
 * soon", no "not enough information", no empty Module 8 container, and no
 * error/placeholder where a withheld module would obviously sit.
 *
 * This file is the regression guard for that decision. It fails on three
 * distinct ways the deferral could silently be undone:
 *
 *   1. CONFIG — if the perception-gap screen entry is deleted or its `_deferred`
 *      marker is dropped, the reserved entry is no longer clearly reserved.
 *   2. RENDER — if the results view starts rendering a Perception Gap section,
 *      a placeholder, or a "coming soon" notice, the Money Picture stops reading
 *      as complete.
 *   3. PAYLOAD — if the write path ever records `perceptionGapStatus: 'finalized'`
 *      (a fabricated diagnosis) while the comparison method is still unapproved,
 *      the append-only Snapshot would carry a result that cannot be taken back.
 *
 * A green run here means the omission is intentional and will stay intentional.
 */

import { SnapshotResults } from "@/components/snapshot/results-view";
import {
  resolvePerceptionGap,
  PERCEPTION_GAP_METHOD_APPROVED_CONFIG_VALUES,
} from "@/lib/assessment/snapshot-payload";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";

const repo = resolve(__dirname, "../..");
const readJson = (p: string) => JSON.parse(readFileSync(resolve(repo, p), "utf8"));

// Canonical section titles + cover lead, sourced from the report config — the
// guard asserts the RENDERED headings equal these, never a hardcoded copy.
const REPORT = readJson("config/report-v1.0.json");
const REPORT_SCREENS = REPORT.screens as Array<{ id: string; title: string; lead?: string }>;
const reportTitle = (id: string) => REPORT_SCREENS.find((s) => s.id === id)?.title ?? "";
const REPORT_COVER_LEAD = REPORT_SCREENS.find((s) => s.id === "cover")?.lead ?? "";
const RENDERED_SCREEN_IDS = [
  "big-picture",
  "operating-profile",
  "strengths",
  "friction",
  "connection",
  "destination-meaning",
  "readiness",
  "attention-area",
  "continuation",
];
const EXPECTED_HEADINGS = RENDERED_SCREEN_IDS.map((id) => reportTitle(id).toUpperCase());

// ---------------------------------------------------------------------------
// 1. CONFIG — the entry is reserved, not deleted, and clearly deferred
// ---------------------------------------------------------------------------

describe("the report config defers Module 8 intentionally", () => {
  const report = readJson("config/report-v1.0.json");
  const screens = report.screens as Array<Record<string, unknown>>;
  const pg = screens.find((s) => s.id === "perception-gap");

  it("keeps the perception-gap screen entry — the deferral is not a deletion", () => {
    // Deleting the entry would strand the reserved concept and make the
    // absence read as accidental. The entry must remain, reserved.
    expect(pg, "perception-gap screen entry is missing — was it deleted?").toBeDefined();
  });

  it("marks the screen DEFERRED FOR PILOT via a `_deferred` note", () => {
    const note = pg?._deferred;
    expect(typeof note, "_deferred must be a string").toBe("string");
    expect(note).toMatch(/DEFERRED FOR PILOT/i);
    expect(note).toMatch(/reserved/i);
  });

  it("the scoring config still has no approved comparison method", () => {
    const scoring = readJson("config/scoring-v1.0.json");
    expect(scoring.perception_gap?.comparison_method).toBe("TBD_PENDING_OPERATOR_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// 2. PAYLOAD — the write path never records a finalized Perception Gap
// ---------------------------------------------------------------------------

describe("the resolved view never finalizes the Perception Gap while unapproved", () => {
  const scoring = readJson("config/scoring-v1.0.json");

  it("the approved-method allowlist is empty (the container fails closed)", () => {
    expect(PERCEPTION_GAP_METHOD_APPROVED_CONFIG_VALUES).toEqual([]);
  });

  it("resolvePerceptionGap never returns 'finalized' under the real config", () => {
    const answered = resolvePerceptionGap({
      openingB: 3,
      q16Selections: ["Q16_A"],
      signalMeans: { SEE: 3, ROOM: 3, DIRECT: 3, PREPARE: 3, AIM: 3, MOVE: 3 },
      perceptionGapConfig: scoring.perception_gap,
    } as never);
    expect(answered.perceptionGapStatus).not.toBe("finalized");
    expect(answered.perceptionGap).toBeNull();

    const unanswered = resolvePerceptionGap({
      openingB: 3,
      q16Selections: [],
      signalMeans: {},
      perceptionGapConfig: scoring.perception_gap,
    } as never);
    expect(unanswered.perceptionGapStatus).toBe("not_ready");
    expect(unanswered.perceptionGap).toBeNull();
  });

  it("resolveSnapshotView reflects a non-finalized status and a null gap", () => {
    const view = resolveSnapshotView(fullPayload());
    expect(view.perceptionGapStatus).not.toBe("finalized");
    expect(view.perceptionGap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. RENDER — the view shows no Module 8, no placeholder, no hole
// ---------------------------------------------------------------------------

/**
 * A representative payload that populates EVERY approved module, so the section
 * sequence below is the complete pilot results architecture (with Module 8
 * deliberately absent). Rendered through the real resolver + view.
 */
function fullPayload(): SnapshotPayload {
  const signal = (
    signal: string,
    state: string | null,
    narrativeKey: string | null,
    specialState: string | null = null,
  ): SnapshotPayload["signals"][number] =>
    ({
      signal,
      state,
      specialState,
      displayState: specialState ?? state,
      narrativeKey,
      evidence: { confidence: "high", limitedReason: null },
    }) as SnapshotPayload["signals"][number];

  return {
    versions: {
      assessment: "1.0",
      questionBank: "1.0",
      scoring: "1.0",
      narrative: "1.0",
      report: "1.0",
      interstitial: "1.0",
      instrument: "1.0",
      scoringEngine: "1.0",
      narrativeLibrary: "1.0",
      snapshotSchema: "1.1",
    },
    signals: [
      signal("SEE", "S3", "signal_states.SEE.S3"),
      signal("ROOM", "S2", "signal_states.ROOM.S2"),
      signal("DIRECT", "S3", "signal_states.DIRECT.S3"),
      signal("PREPARE", "S4", "signal_states.PREPARE.S4"),
      signal("AIM", "S3", "signal_states.AIM.S3"),
      signal("MOVE", "S5", "signal_states.MOVE.S5"),
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: [
        "signal_states.MOVE.S5",
        "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
        "attention_areas.SEE_IT_MORE_CLEARLY",
      ],
    },
    strengths: [{ source: "signal", code: "MOVE", narrativeKey: "signal_states.MOVE.S5" }],
    frictions: [
      {
        source: "tension",
        code: "HIGH_ACTIVITY_LOW_DIRECTION",
        narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
      },
    ],
    connections: [
      {
        code: "HIGH_ACTIVITY_LOW_DIRECTION",
        narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
      },
    ],
    context: [],
    perceptionGap: null,
    perceptionGapStatus: "method_pending",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
  };
}

function renderHtml(): string {
  const sections = resolveSnapshotContent(fullPayload());
  return renderToStaticMarkup(React.createElement(SnapshotResults, { sections }));
}

function headings(html: string): string[] {
  const c = document.createElement("div");
  c.innerHTML = html;
  return Array.from(c.querySelectorAll("h2")).map((n) => n.textContent ?? "");
}

describe("the results view closes naturally around supported modules", () => {
  it("renders the ready state (the Money Picture actually resolves)", () => {
    const html = renderHtml();
    expect(html).toContain(REPORT_COVER_LEAD);
    expect(html).toContain("YOUR SET FOR LIFE MONEY PICTURE");
  });

  it("renders NO Perception Gap section and NO placeholder prose", async () => {
    const html = renderHtml();

    const forbidden = [
      "Perception Gap",
      "PERCEPTION GAP",
      "coming soon",
      "Coming soon",
      "not enough information",
      "Not enough information",
    ];
    for (const f of forbidden) {
      expect(html, `page must not contain "${f}"`).not.toContain(f);
    }

    // No section heading may name a withheld module — the structural
    // "no empty container" check.
    const hs = headings(html);
    expect(
      hs.filter((h) => h.toLowerCase().includes("perception")),
      "a section heading names the withheld Perception Gap module",
    ).toEqual([]);
  });

  it("the section headings are exactly the supported modules — no gap in the sequence", () => {
    // The Money Picture must read as COMPLETE. Module 8 is deferred and its
    // absence must not create a hole: the rendered sequence is the full pilot
    // architecture minus Module 8, in report-config order, with no placeholder.
    // (Owner: update this LIST as modules are added — never delete the guard.)
    expect(headings(renderHtml())).toEqual(EXPECTED_HEADINGS);
  });
});
