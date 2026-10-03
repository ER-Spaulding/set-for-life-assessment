import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import {
  resolveSnapshotContent,
  resolveSnapshotSections,
} from "@/lib/render/snapshot-sections";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";

/**
 * THE SECTION-MODEL SINGLE-SOURCE GUARD — the structural half of §5 the seam is
 * removed for.
 *
 * Before this change, BOTH renderers re-decided module existence, headings, and
 * block membership independently: the web (`results-view.tsx`) gated and titled
 * sections from config/report-v1.0.json, and the PDF (`snapshot-pdf.tsx`)
 * rebuilt the same sections from the resolved view. A divergence was therefore a
 * change to ONE renderer's local code, and only the byte-exact seam guard caught
 * it. That is the avoidable production seam.
 *
 * Now there is ONE shared resolved content/section model
 * (`lib/render/snapshot-sections.ts`) produced by `resolveSnapshotContent`, and
 * BOTH renderers build FROM it. This file pins that structure:
 *
 *   1. ONE MODEL MODULE — `resolveSnapshotContent`/`resolveSnapshotSections`
 *      live in `lib/render/snapshot-sections.ts`, which imports `resolveSnapshotView`
 *      from the shared resolver (the only copy-resolution path) and the report
 *      config (the only heading source), and nothing scoring/tension/db/session.
 *   2. BOTH RENDERERS BUILD FROM THE MODEL — `results-view.tsx` and
 *      `snapshot-pdf.tsx` import the `SnapshotSection` type and NEVER import a
 *      resolver function or `snapshot-view`; they receive the model, they cannot
 *      re-resolve or re-derive.
 *   3. ONE PRODUCTION ENTRY POINT — the web page and the PDF document both call
 *      `resolveSnapshotContent(payload)`, so the content they consume is produced
 *      by ONE shared code path.
 *   4. BEHAVIOUR — for a full profile, the model carries exactly the eight content
 *      modules (no Perception Gap), each heading equals the report config title
 *      (uppercased), and the primary/secondary selections are marked explicitly.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Remove `//` and `/* *​/` comments so source guards read code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PAGE = "app/(public)/snapshot/[sessionId]/page.tsx";
const DOCUMENT = "lib/snapshot/document.ts";
const SECTIONS = "lib/render/snapshot-sections.ts";
const WEB = "components/snapshot/results-view.tsx";
const PDF = "lib/render/snapshot-pdf.tsx";

describe("property 1 — the shared section model lives in one module, on the shared resolver", () => {
  it("resolveSnapshotContent/resolveSnapshotSections live in lib/render/snapshot-sections.ts", () => {
    const src = stripComments(read(SECTIONS));
    expect(src).toContain("export function resolveSnapshotContent");
    expect(src).toContain("export function resolveSnapshotSections");
  });

  it("the model module imports the shared resolver and the report config — and nothing scoring-side", () => {
    const src = stripComments(read(SECTIONS));
    expect(src).toMatch(/from\s+"\.\/snapshot-view"/);
    expect(src).toMatch(/report-v1\.0\.json/);
    for (const forbidden of [
      "assessment/scoring",
      "assessment/tensions",
      "assessment/classifiers",
      "assessment/interpretation",
      "session/service",
      "db/client",
      "db/index",
      "db/http",
    ]) {
      expect(src, `${SECTIONS} must not import ${forbidden}`).not.toContain(forbidden);
    }
    expect(src).not.toMatch(/\bscoreAssessment\b|\bevaluateTensions\b/);
    expect(src).not.toMatch(/Date\.now|Math\.random/);
  });
});

describe("property 2 — both renderers build from the model, and cannot re-resolve", () => {
  for (const [rel, code] of [
    [WEB, stripComments(read(WEB))],
    [PDF, stripComments(read(PDF))],
  ] as const) {
    it(`${rel} imports the SnapshotSection type and never a resolver function`, () => {
      expect(code, `${rel} must import SnapshotSection`).toMatch(/SnapshotSection/);
      expect(code, `${rel} must not import the raw snapshot-view`).not.toMatch(
        /(?:@\/lib\/render\/snapshot-view|\.\/snapshot-view)/,
      );
      expect(code, `${rel} must never call a resolver`).not.toMatch(
        /resolveSnapshotView|resolveSnapshotContent|resolveSnapshotSections/,
      );
    });
  }
});

describe("property 3 — one production entry point feeds both renderers", () => {
  it("the web page resolves through resolveSnapshotContent", () => {
    expect(stripComments(read(PAGE))).toMatch(/resolveSnapshotContent\(/);
  });

  it("the PDF document resolves through resolveSnapshotContent", () => {
    expect(stripComments(read(DOCUMENT))).toMatch(/resolveSnapshotContent\(/);
  });
});

// ---------------------------------------------------------------------------
// A fully-populated payload.
// ---------------------------------------------------------------------------

function signal(
  signal: string,
  state: PayloadSignal["state"],
  narrativeKey: string | null,
): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState: null,
    displayState: state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function fullPayload(): SnapshotPayload {
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
      signal("SEE", "S2", "signal_states.SEE.S2"),
      signal("ROOM", "S1", "signal_states.ROOM.S1"),
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
      { code: "HIGH_ACTIVITY_LOW_DIRECTION", narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION" },
      { code: "HIGH_INFORMATION_LOW_ACTION", narrativeKey: "connection_statements.HIGH_INFORMATION_LOW_ACTION" },
    ],
    context: [],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY", "CREATE_MORE_ROOM"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
  };
}

describe("property 4 — the model carries the eight content modules, headings, and selections", () => {
  it("the eight modules are present, in report-config order, with no Perception Gap", () => {
    const sections = resolveSnapshotContent(fullPayload());
    expect(sections.map((s) => s.id)).toEqual([
      "big-picture",
      "money-picture",
      "strengths",
      "friction",
      "connection",
      "destination",
      "readiness",
      "attention",
    ]);
  });

  it("each heading equals the report config title uppercased (single heading source)", () => {
    const report = JSON.parse(read("config/report-v1.0.json")) as {
      screens: Array<{ id: string; title: string }>;
    };
    const title = (id: string) =>
      report.screens.find((s) => s.id === id)?.title ?? "";
    const screenFor: Record<string, string> = {
      "big-picture": "big-picture",
      "money-picture": "operating-profile",
      strengths: "strengths",
      friction: "friction",
      connection: "connection",
      destination: "destination-meaning",
      readiness: "readiness",
      attention: "attention-area",
    };

    const sections = resolveSnapshotContent(fullPayload());
    for (const section of sections) {
      expect(section.heading, `${section.id} heading must match report config`).toBe(
        title(screenFor[section.id]).toUpperCase(),
      );
    }
  });

  it("the primary/secondary selections are marked explicitly (connection + attention)", () => {
    const sections = resolveSnapshotContent(fullPayload());
    const connection = sections.find((s) => s.id === "connection")!;
    expect(connection.blocks.map((b) => b.variant)).toEqual(["primary", "secondary"]);

    const attention = sections.find((s) => s.id === "attention")!;
    expect(attention.blocks.map((b) => b.variant)).toEqual(["primary", "secondary"]);
  });

  it("a finalized Perception Gap is resolved by the view but absent from the model", () => {
    const payload: SnapshotPayload = {
      ...fullPayload(),
      perceptionGapStatus: "finalized",
      perceptionGap: {
        code: "PERCEPTION_ALIGNED",
        narrativeKey: "perception_gap.PERCEPTION_ALIGNED",
      },
    };
    const view = resolveSnapshotView(payload);
    expect(view.perceptionGap).not.toBeNull();
    const sections = resolveSnapshotSections(view);
    expect(sections.map((s) => s.id)).not.toContain("perception-gap");
    // And no block string equals the gap copy.
    const strings = sections.flatMap((s) =>
      s.blocks.flatMap((b) => [b.kicker, b.label, b.body].filter((x): x is string => !!x)),
    );
    expect(strings).not.toContain(view.perceptionGap!.label);
    expect(strings).not.toContain(view.perceptionGap!.body);
  });
});
