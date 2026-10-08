import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import {
  ACTIVATION_LABELS,
  ACTIVATION_ITEMS,
  activationLabel,
} from "@/lib/ui/snapshot-activation";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import { snapshotPdfSections, renderSnapshotPdf } from "@/lib/render/snapshot-pdf";
import { extractPdfText } from "./pdf-text";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";

/**
 * THE ACTIVATION-LABEL SINGLE-SOURCE GUARD — owner ruling 2026-10-02.
 *
 * The four participant-facing Activation labels (Urgency / Readiness /
 * Commitment / Support Readiness) were previously a PARITY DEFECT: the web
 * renderer hardcoded them in `components/snapshot/results-view.tsx` while the
 * PDF renderer OMITTED them. This file pins the fixed structure:
 *
 *   1. ONE SOURCE — the four DIMENSION names live in
 *      `lib/ui/snapshot-activation.ts` and nowhere else. Both renderers consume
 *      them THROUGH the shared resolver (`resolveSnapshotView` attaches
 *      `activation[].dimension`; the band's STATE label — "No Manufactured
 *      Emergency" etc. — rides `activation[].label` from the governed config),
 *      so a divergence requires changing SHARED code, never one renderer's.
 *   2. FOUR SEPARATE MEASURES — no lead score, no composite, no average. The
 *      source exports four labels keyed A1–A4 and no combined value.
 *   3. NO SECOND COPY — neither renderer, nor any file under the rendering
 *      surfaces (components/snapshot/, lib/render/), may contain the label
 *      literals; the resolver imports the ONE source rather than re-stating it.
 *   4. BEHAVIOUR — the resolved view, the PDF strings, and the rendered web
 *      markup all carry the four labels from the same source.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Remove `//` and `/* *​/` comments so source guards read code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CANONICAL_LABELS = ["Urgency", "Readiness", "Commitment", "Support Readiness"] as const;

// ---------------------------------------------------------------------------
// 1. One source: the four labels, verbatim, in canonical order.
// ---------------------------------------------------------------------------


/**
 * EVERY FILE IN THE WEB RENDER LAYER, concatenated.
 *
 * The render layer used to be one file (`components/snapshot/results-view.tsx`);
 * it is now a directory of focused components. These source-level guards assert
 * properties of "the render layer", so they must read the WHOLE layer — scanning
 * only results-view.tsx would silently stop checking the other twelve files, and
 * the guard would pass for the wrong reason. Concatenating is safe because every
 * assertion below is a negative (must-not-contain) or a whole-layer presence
 * check; a per-file loop would be weaker for the presence checks.
 */
function renderLayerSource(ext: string[] = [".tsx", ".ts"]): string {
  const dir = resolve(repo, "components/snapshot");
  return readdirSync(dir)
    .filter((f) => ext.some((e) => f.endsWith(e)))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .join("\n");
}


describe("the activation labels have one verbatim source", () => {
  it("ACTIVATION_LABELS holds exactly the four owner-approved labels, keyed A1–A4", () => {
    expect(ACTIVATION_LABELS).toEqual({
      A1: "Urgency",
      A2: "Readiness",
      A3: "Commitment",
      A4: "Support Readiness",
    });
    expect(Object.keys(ACTIVATION_LABELS).sort()).toEqual(["A1", "A2", "A3", "A4"]);
  });

  it("ACTIVATION_ITEMS is the canonical A1–A4 order", () => {
    expect([...ACTIVATION_ITEMS]).toEqual(["A1", "A2", "A3", "A4"]);
  });

  it("activationLabel resolves A1–A4 and omits (empty string) unknown keys", () => {
    expect(activationLabel("A1")).toBe("Urgency");
    expect(activationLabel("A4")).toBe("Support Readiness");
    expect(activationLabel("A9")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. Four separate measures — no composite, no lead score, no average.
// ---------------------------------------------------------------------------

describe("the four measures remain separate — never combined", () => {
  it("the source module defines no scalar, average, or composite", () => {
    const code = stripComments(read("lib/ui/snapshot-activation.ts"));
    expect(code).not.toMatch(/\b(score|average|composite|combined|leadScore|motivation)\b/i);
  });

  it("the resolver produces four separate dimensions, each carrying its name and state", () => {
    const view = resolveSnapshotView(payload());
    expect(view.activation).toHaveLength(4);
    expect(view.activation.map((a) => a.item)).toEqual(["A1", "A2", "A3", "A4"]);
    for (const a of view.activation) {
      // The canonical DIMENSION name (the ruling's subject) rides `dimension`,
      // still sourced from the ONE shared map.
      expect(a.dimension).toBe(ACTIVATION_LABELS[a.item]);
      // The band's STATE label comes from the governed narrative config.
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.paragraphs.length).toBeGreaterThan(0);
    }
    // Four distinct dimension names — no collapsed scalar field.
    expect(new Set(view.activation.map((a) => a.dimension)).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. No second copy — both renderers read the ONE source through the resolver.
// ---------------------------------------------------------------------------

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/** Every source file under a rendering surface, comments stripped. */
function renderSurfaceSources(...dirs: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of dirs) {
    for (const p of walk(resolve(repo, dir))) {
      out.push([relative(repo, p).replaceAll("\\", "/"), stripComments(readFileSync(p, "utf8"))]);
    }
  }
  return out;
}

describe("no second independent copy of the labels exists in a renderer", () => {
  it("neither components/snapshot/ nor lib/render/ hardcodes any of the four labels", () => {
    for (const [rel, code] of renderSurfaceSources("components/snapshot", "lib/render")) {
      for (const label of CANONICAL_LABELS) {
        expect(
          code.includes(`"${label}"`) || code.includes(`'${label}'`) || code.includes(`\`${label}\``),
          `${rel} hardcodes the activation label ${JSON.stringify(label)} — it must read the resolved activation[].label`,
        ).toBe(false);
      }
    }
  });

  it("the web results view renders the model's resolved label, not a local map", () => {
    // The whole render layer: the readiness module is now its own component, and
    // a local label map must not be able to hide in any file under
    // components/snapshot/.
    const code = stripComments(renderLayerSource());
    expect(code).toContain("block.label");
    // No local ACTIVATION_LABELS map of its own.
    expect(code).not.toMatch(/\bACTIVATION_LABELS\b/);
  });

  it("the PDF renderer emits the model's resolved label, not a local map", () => {
    const code = stripComments(read("lib/render/snapshot-pdf.tsx"));
    expect(code).toContain("block.label");
    expect(code).not.toMatch(/\bACTIVATION_LABELS\b/);
  });

  it("the resolver imports the ONE source and attaches it as activation[].label", () => {
    const code = stripComments(read("lib/render/snapshot-view.ts"));
    expect(code).toMatch(/from\s+"\.\.\/ui\/snapshot-activation"/);
    expect(code).toContain("dimension: ACTIVATION_LABELS[item]");
  });
});

// ---------------------------------------------------------------------------
// 4. Behaviour — the labels reach both renderers from the shared source.
// ---------------------------------------------------------------------------

describe("the resolved labels reach the web and PDF outputs", () => {
  it("the PDF's readiness section carries a label block per dimension, in order", () => {
    const sections = resolveSnapshotContent(payload());
    const readiness = snapshotPdfSections(sections).find((s) => s.id === "readiness");
    expect(readiness).toBeDefined();
    // The dimension NAME is the block kicker; the band's state label is `label`.
    expect(readiness!.blocks.map((b) => b.kicker)).toEqual([...CANONICAL_LABELS]);
    for (const b of readiness!.blocks) expect((b.label ?? "").length).toBeGreaterThan(0);
  });

  it("the rendered PDF bytes carry all four labels from the shared source", async () => {
    const sections = resolveSnapshotContent(payload());
    const bytes = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: "2026-10-02T00:00:00.000Z",
      reportVersion: "1.0",
    });
    const text = extractPdfText(bytes);
    for (const label of CANONICAL_LABELS) {
      expect(text).toContain(label);
    }
  });

  it("the web results view renders all four labels into the participant HTML", async () => {
    // Rendered through the REAL component, fed the REAL shared section model, so
    // a renderer that dropped or aliased a label would fail here — not just at a
    // source-scan level.
    const React = (await import("react")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SnapshotResults } = await import("@/components/snapshot/results-view");
    const html = renderToStaticMarkup(
      React.createElement(SnapshotResults, { sections: resolveSnapshotContent(payload()) }),
    );
    for (const label of CANONICAL_LABELS) {
      expect(html).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture — a fully-populated payload (activation A1–A4 all set).
// ---------------------------------------------------------------------------

function payload(): SnapshotPayload {
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
      { signal: "SEE", state: "S2", specialState: null, displayState: "S2", narrativeKey: "signal_states.SEE.S2", evidence: { confidence: "high", limitedReason: null } },
      { signal: "ROOM", state: "S1", specialState: null, displayState: "S1", narrativeKey: "signal_states.ROOM.S1", evidence: { confidence: "high", limitedReason: null } },
      { signal: "DIRECT", state: "S3", specialState: null, displayState: "S3", narrativeKey: "signal_states.DIRECT.S3", evidence: { confidence: "high", limitedReason: null } },
      { signal: "PREPARE", state: "S4", specialState: null, displayState: "S4", narrativeKey: "signal_states.PREPARE.S4", evidence: { confidence: "high", limitedReason: null } },
      { signal: "AIM", state: "S3", specialState: null, displayState: "S3", narrativeKey: "signal_states.AIM.S3", evidence: { confidence: "high", limitedReason: null } },
      { signal: "MOVE", state: "S5", specialState: null, displayState: "S5", narrativeKey: "signal_states.MOVE.S5", evidence: { confidence: "high", limitedReason: null } },
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: ["signal_states.MOVE.S5", "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION"],
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
    ],
    context: [],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A"],
    openingB: null,
  };
}
