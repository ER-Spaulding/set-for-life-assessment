import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import {
  resolveSnapshotSections,
  type SnapshotSection,
} from "@/lib/render/snapshot-sections";
import {
  snapshotPdfSections,
  renderSnapshotPdf,
} from "@/lib/render/snapshot-pdf";
import { extractPdfText, squash, expectedPdfText } from "./pdf-text";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";

/**
 * THE PDF-PARITY GUARD — Addendum 01 v1.1 §5 (the PDF half).
 *
 * §5: "The web results and PDF must use the same completed immutable
 * snapshot_payload." The web renderer is `components/snapshot/results-view.tsx`,
 * fed by `resolveSnapshotContent(payload)` at the page. The PDF renderer is
 * `lib/render/snapshot-pdf.tsx`, fed by the SAME `resolveSnapshotContent`. Both
 * build from the SHARED content/section model
 * (`lib/render/snapshot-sections.ts`). This file proves that relationship
 * STRUCTURALLY, not coincidentally:
 *
 *   1. SOURCE GUARD — the PDF module imports ONLY `@react-pdf/renderer`, the
 *      `SnapshotSection`/`SnapshotBlock` TYPES, and the fixed document-furniture
 *      module. It must not import scoring/tensions/classifiers/db/session/config,
 *      must never reference `SnapshotPayload` or `ResolvedSnapshotView`, and must
 *      never call a resolver — because its sole interpretive input is the shared
 *      section model.
 *   2. SUBSET GUARD — for representative payloads, the text DECODED FROM THE
 *      REAL RENDERED BUFFER equals the sequence DERIVED from the shared section
 *      model + furniture. The PDF is a reordering/subset of shared content,
 *      never new prose — measured over the bytes, not a mirror of the JSX.
 *   3. MULTISET GUARD — for a fully-populated profile, every model string is
 *      present in the rendered bytes (no omission), and the §9 page order holds.
 *   4. §24 GUARD — no internal diagnostic machinery (dotted keys, special-state
 *      codes, tension codes) reaches the rendered bytes.
 *   5. MODULE 8 GUARD — the Perception Gap (deferred) never appears in the
 *      rendered bytes: no section, no placeholder, no gap, even when the payload
 *      carries a finalized gap.
 *   6. RENDER SMOKE — `renderSnapshotPdf` produces a real PDF buffer from the
 *      shared section model (the @react-pdf/renderer integration actually works).
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Remove `//` and `/* *​/` comments so source guards read code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Fixtures (same keys the web + PDF consumers read).
// ---------------------------------------------------------------------------

function signal(
  signal: string,
  state: PayloadSignal["state"],
  narrativeKey: string | null,
  specialState: string | null = null,
): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState,
    displayState: specialState ?? state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function basePayload(): SnapshotPayload {
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
      signal("DIRECT", "S3", "special_signal_states.DIRECT_CAPACITY_LIMITED", "DIRECT_CAPACITY_LIMITED"),
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
    context: [{ code: "OPEN_MONEY_ENVIRONMENT", narrativeKey: "context_narratives.OPEN_MONEY_ENVIRONMENT" }],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
  };
}

/** A fully-populated profile where every module the web renders is present. */
function fullProfile(): SnapshotPayload {
  return basePayload();
}

/** The null-finding profile: no friction, no connection. */
function nullFindingProfile(): SnapshotPayload {
  return {
    ...basePayload(),
    nullFinding: true,
    frictions: [],
    connections: [],
    strengths: [],
    attentionAreas: ["KEEP_OBSERVING"],
    bigPicture: { template: "NO_MEANINGFUL_FRICTION", parts: [] },
    context: [],
  };
}

// ---------------------------------------------------------------------------
// The shared section model's full string set — the universe a renderer may draw
// on, and (for a full profile) exactly what both renderers emit.
// ---------------------------------------------------------------------------

/**
 * EVERY string the shared section model carries FOR THE PDF (kicker + label +
 * body + paragraphs). Section intro/outro are web-only by renderer decision —
 * recorded in snapshot-pdf.tsx and asserted below — so they are deliberately
 * NOT in this universe.
 */
function sectionBlockStrings(sections: SnapshotSection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.kicker) out.push(block.kicker);
      if (block.label) out.push(block.label);
      out.push(block.body);
      for (const p of block.paragraphs ?? []) out.push(p);
    }
  }
  // Empty bodies are model-legal (a headline-only connection block during
  // scaffolding) but emit no PDF text — a "" in the expected sequence would
  // make a byte-equality comparison vacuous rather than stricter.
  return out.filter((x) => x.length > 0);
}

/** Render + decode the real bytes for a payload (the byte-level substrate). */
async function renderedText(
  payload: SnapshotPayload,
  firstName: string | null = null,
): Promise<string> {
  const sections = resolveSnapshotSections(resolveSnapshotView(payload));
  const bytes = await renderSnapshotPdf(sections, {
    firstName,
    generatedAt: "2026-10-02T00:00:00.000Z",
    reportVersion: "1.0",
  });
  return extractPdfText(bytes);
}

describe("property 1 — the PDF module has one interpretive input, the shared section model", () => {
  it("imports only @react-pdf/renderer and the SnapshotSection type", () => {
    const src = stripComments(read("lib/render/snapshot-pdf.tsx"));
    expect(src).toContain("@react-pdf/renderer");
    expect(src).toMatch(/SnapshotSection/);

    for (const forbidden of [
      "assessment/scoring",
      "assessment/tensions",
      "assessment/classifiers",
      "assessment/snapshot-payload",
      "assessment/interpretation",
      "db/client",
      "db/index",
      "db/http",
      "session/service",
      "config/",
    ]) {
      expect(src, `snapshot-pdf.tsx must not import ${forbidden}`).not.toContain(forbidden);
    }

    // It must never see the raw payload or the raw resolved view — only the
    // shared section model.
    expect(src, "snapshot-pdf.tsx must not reference SnapshotPayload").not.toMatch(/\bSnapshotPayload\b/);
    expect(src, "snapshot-pdf.tsx must not reference ResolvedSnapshotView").not.toMatch(/\bResolvedSnapshotView\b/);
    // It must not call any resolver — the section model is its only input.
    expect(src, "snapshot-pdf.tsx must not call a resolver").not.toMatch(
      /resolveSnapshotView|resolveSnapshotSections|resolveSnapshotContent/,
    );
    // Pure: no live recompute, no clock/randomness in the layout layer.
    expect(src).not.toMatch(/\bscoreAssessment\b|\bevaluateTensions\b/);
    expect(src).not.toMatch(/Date\.now|Math\.random/);
  });
});

describe("property 2 — every string the PDF emits is a member of the shared section model", () => {
  const profiles: Array<[string, SnapshotPayload]> = [
    ["full", fullProfile()],
    ["null-finding", nullFindingProfile()],
    [
      "finalized-gap (module 8 deferred)",
      { ...basePayload(), perceptionGapStatus: "finalized", perceptionGap: { code: "PERCEPTION_ALIGNED", narrativeKey: "perception_gap.PERCEPTION_ALIGNED" } },
    ],
    [
      "no-destination",
      { ...basePayload(), q16Selections: [] },
    ],
  ];

  for (const [name, payload] of profiles) {
    it(`${name}: the rendered bytes carry exactly the model-derived sequence (no minted prose)`, async () => {
      const view = resolveSnapshotView(payload);
      const sections = resolveSnapshotSections(view);
      const text = await renderedText(payload);
      // Byte-level subset: the character sequence the renderer emitted EQUALS
      // the sequence DERIVED from the shared model + furniture. A string the
      // renderer mints in its JSX adds characters the derived sequence lacks.
      expect(squash(text), `PDF emitted text outside the shared model (${name})`).toBe(
        squash(expectedPdfText(sections, null)),
      );
    });
  }
});

describe("property 3 — for a full profile the PDF emits exactly the shared model's strings", () => {
  it("every model string is present in the rendered bytes (no omission)", async () => {
    const view = resolveSnapshotView(fullProfile());
    const sections = resolveSnapshotSections(view);
    const text = await renderedText(fullProfile());
    const squashed = squash(text);
    for (const s of sectionBlockStrings(sections)) {
      expect(squashed, `PDF omitted a model string: ${JSON.stringify(s)}`).toContain(squash(s));
    }
  });

  it("the §9 page order places the primary connection beside the big picture", () => {
    const view = resolveSnapshotView(fullProfile());
    const sections = resolveSnapshotSections(view);
    const pdfSections = snapshotPdfSections(sections);
    const ids = pdfSections.map((s) => s.id);
    expect(ids[0]).toBe("big-picture");
    // primary connection block is pulled up beside the big-picture section (§9).
    // Its label is the Connection headline (plan D5 decoupled it from the
    // friction title), so pair it with connectionHeadline, not headline.
    const bp = pdfSections[0].blocks.map((b) => b.label ?? b.body);
    expect(bp).toContain(view.connections[0].connectionHeadline);
    // the secondary connection is NOT in the big-picture section
    const connectionSection = pdfSections.find((s) => s.id === "connection");
    expect(connectionSection?.blocks.some((b) => b.label === view.connections[1].connectionHeadline)).toBe(true);
  });
});

describe("property 4 — §24: no internal diagnostic machinery reaches the PDF", () => {
  it("no dotted key, special-state code, or tension code appears in the rendered bytes", async () => {
    const narratives = JSON.parse(read("config/narratives-v1.0.json"));
    const connection = JSON.parse(read("config/connection-statements-v1.0.json"));
    const specials = Object.keys(narratives.special_signal_states);
    const tensions = Object.keys(connection).filter(
      (k) => !["version", "_version_note", "_prd_section", "_notes"].includes(k),
    );
    const forbidden = [
      "signal_states.",
      "special_signal_states.",
      "connection_statements.",
      "context_narratives.",
      "perception_gap.",
      "attention_areas.",
      "activation.",
      ...specials,
      ...tensions,
    ];

    const text = await renderedText(fullProfile());
    const offenders = forbidden.filter((token) => text.includes(token));
    expect(offenders).toEqual([]);
  });
});

describe("property 5 — Module 8 (Perception Gap) must not appear in the PDF", () => {
  it("no section, placeholder, or gap string even when a finalized gap is present", async () => {
    const payload: SnapshotPayload = {
      ...basePayload(),
      perceptionGapStatus: "finalized",
      perceptionGap: {
        code: "PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE",
        narrativeKey: "perception_gap.PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE",
      },
    };
    const view = resolveSnapshotView(payload);
    // The resolver DOES produce a gap here (it is a valid, finalized payload)…
    expect(view.perceptionGap).not.toBeNull();

    // …but the shared section model omits it, and the PDF layout must not emit
    // it, carrying no gap section.
    const sections = resolveSnapshotSections(view);
    expect(sections.map((s) => s.id)).not.toContain("perception-gap");
    const pdfSections = snapshotPdfSections(sections);
    expect(pdfSections.map((s) => s.id)).not.toContain("perception-gap");
    // Byte-level: neither the gap's conclusion body nor its title may reach the
    // rendered bytes, nor the "Perception Gap" module title.
    const text = await renderedText(payload);
    expect(text).not.toContain(view.perceptionGap!.body);
    expect(text).not.toContain(view.perceptionGap!.label);
    expect(squash(text).toLowerCase()).not.toContain("perceptiongap");
  });
});

describe("property 6 — renderSnapshotPdf produces a real PDF from the shared section model", () => {
  it("returns a %PDF buffer for the full profile", async () => {
    const sections = resolveSnapshotSections(resolveSnapshotView(fullProfile()));
    const buf = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: "2026-10-02T00:00:00.000Z",
      reportVersion: "1.0",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("returns a %PDF buffer for the null-finding profile", async () => {
    const sections = resolveSnapshotSections(resolveSnapshotView(nullFindingProfile()));
    const buf = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: null,
      reportVersion: null,
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
