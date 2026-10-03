// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MODULE 11 — the optional subordinate secondary attention area (§6.11).
 *
 * §6.10/§6.11 render ONE primary attention area with visual priority and, when
 * the stored payload carries a second, INDEPENDENT area, an optional subordinate
 * secondary (§12.4). The secondary is part of the SAME "One Area Worth Examining
 * Next" module — it renders UNDER the primary, never as a separate top-level
 * section (§7.2 forbids presenting it as a numbered/ranked sibling).
 *
 * This test proves two things the §5 contract demands:
 *   1. RENDERS FROM THE STORED PAYLOAD. The secondary comes from
 *      `attentionAreas[1]` — resolved to copy by the shared resolver from the
 *      frozen payload. It is never re-derived from live tensions.
 *   2. NO RECOMPUTE IN THE RENDER PATH. The page and the results view import no
 *      scoring/tension/classifier/interpretation machinery — the only input to
 *      the render is the resolved view produced from the stored payload.
 */

import { SnapshotResults } from "@/components/snapshot/results-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

const narratives = JSON.parse(read("config/narratives-v1.0.json")) as {
  attention_areas: Record<string, { label: string; body: string }>;
};

const PRIMARY = "SEE_IT_MORE_CLEARLY";
const SECONDARY = "CREATE_MORE_ROOM";

function payloadWith(attentionAreas: string[]): SnapshotPayload {
  return {
    versions: { assessment: "1.0", questionBank: "1.0", scoring: "1.0", narrative: "1.0", report: "1.0", interstitial: "1.0", instrument: "1.0", scoringEngine: "1.0", narrativeLibrary: "1.0", snapshotSchema: "1.1" },
    signals: [],
    bigPicture: { template: "PRIMARY_FRICTION", parts: [] },
    strengths: [],
    frictions: [],
    connections: [],
    context: [],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "LOW", A2: "LOW", A3: "LOW", A4: "LOW" },
    activationPatterns: [],
    attentionAreas,
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: [],
    openingB: null,
  };
}

function renderHtml(attentionAreas: string[]): string {
  const sections = resolveSnapshotContent(payloadWith(attentionAreas));
  return renderToStaticMarkup(React.createElement(SnapshotResults, { sections }));
}

function attentionSection(html: string): HTMLElement | undefined {
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.querySelectorAll("section")).find(
    (s) => (s.querySelector("h2")?.textContent ?? "").toUpperCase() ===
      "ONE AREA WORTH EXAMINING NEXT",
  );
}

describe("module 11 — the subordinate secondary attention area renders from the payload", () => {
  it("renders the primary, then the subordinate secondary, each verbatim from config", () => {
    const html = renderHtml([PRIMARY, SECONDARY]);

    const primary = narratives.attention_areas[PRIMARY];
    const secondary = narratives.attention_areas[SECONDARY];

    const section = attentionSection(html);
    expect(section, "attention section missing").toBeDefined();

    // Primary heading is an <h3>; the subordinate secondary is an <h4> under it.
    const h3 = section!.querySelector("h3");
    expect(h3?.textContent).toBe(primary.label);

    const h4 = section!.querySelector("h4");
    expect(h4?.textContent, "secondary attention label missing").toBe(secondary.label);

    // Both bodies render, in order: primary body before secondary body.
    const paragraphs = Array.from(section!.querySelectorAll("p")).map(
      (p) => p.textContent ?? "",
    );
    expect(paragraphs).toContain(primary.body);
    expect(paragraphs).toContain(secondary.body);
    expect(paragraphs.indexOf(primary.body)).toBeLessThan(
      paragraphs.indexOf(secondary.body),
    );
  });

  it("does NOT render a separate top-level section for the secondary", () => {
    const container = document.createElement("div");
    container.innerHTML = renderHtml([PRIMARY, SECONDARY]);

    const h2s = Array.from(container.querySelectorAll("h2")).map(
      (n) => n.textContent ?? "",
    );
    expect(h2s.filter((t) => t.toUpperCase() === "ONE AREA WORTH EXAMINING NEXT")).toHaveLength(1);
  });

  it("renders nothing for the secondary when the payload has no second area", () => {
    const html = renderHtml([PRIMARY]);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("h4")).toBeNull();
  });

  it("renders nothing for the secondary when attentionAreas is empty", () => {
    const html = renderHtml([]);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("h4")).toBeNull();
  });
});

describe("module 11 render path recomputes nothing", () => {
  it("the page and results view import no scoring/tension/classifier/interpretation machinery", () => {
    // The page is now a SERVER component that reads the stored payload through
    // lib/session/service — that import is the point of the conversion, not a
    // recompute. What must remain absent from BOTH the page and the view is any
    // scoring / tension / classifier / interpretation import: the attention area
    // comes from the payload, never re-derived.
    for (const file of [
      "app/(public)/snapshot/[sessionId]/page.tsx",
      "components/snapshot/results-view.tsx",
    ]) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of [
        "assessment/scoring",
        "assessment/tensions",
        "assessment/classifiers",
        "assessment/interpretation",
      ]) {
        expect(code, `${file} must not import ${forbidden}`).not.toContain(forbidden);
      }
    }
    // The attention areas resolve through the shared section model only.
    expect(
      read("app/(public)/snapshot/[sessionId]/page.tsx"),
    ).toMatch(/from\s+"@\/lib\/render\/snapshot-sections"/);
  });
});
