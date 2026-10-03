// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE RENDER-LEVEL GUARD — Addendum 01 v1.1 §5 (differential half).
 *
 * `snapshot-resolution-single-source.test.ts` asserts on IMPORT PATHS and on the
 * shared module's SOURCE; `snapshot-source-of-truth.test.ts` asserts the page
 * reads the stored payload. Neither sees what the VIEW actually RENDERS, so an
 * inline copy map (a second resolution path that bypasses
 * `lib/render/snapshot-view.ts`) passes the source scans while the rendered
 * participant HTML silently changes.
 *
 * This file closes that hole by RENDERING the real results view
 * (`components/snapshot/results-view.tsx`) against a view RESOLVED by the real
 * resolver (`resolveSnapshotView`), and asserting that the RESULTING STRINGS are
 * exactly the strings the PINNED CONFIG libraries produce for the SAME payload.
 * The expected strings are derived here from the pinned config — NOT from
 * lib/render/snapshot-view.ts — so the resolver is measured against the config
 * it is supposed to read, not against itself.
 *
 * The page is now a server component that reads the DB; it is NOT mounted here
 * (that would pull in the service client). The presentational view it renders —
 * `SnapshotResults` — is pure and is rendered directly, which is the layer that
 * carries every participant-facing string.
 */

import { SnapshotResults } from "@/components/snapshot/results-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";
import { HUMAN_QUESTIONS } from "@/lib/ui/human-questions";

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

// ---------------------------------------------------------------------------
// THE INDEPENDENT ORACLE — expectations derived from the pinned config and the
// human-question bank, NOT from lib/render/snapshot-view.ts.
// ---------------------------------------------------------------------------

const narratives = JSON.parse(read("config/narratives-v1.0.json")) as {
  signal_states: Record<string, Record<string, { label: string; copy: string }>>;
  special_signal_states: Record<string, { label: string; copy: string }>;
  attention_areas: Record<string, { label: string; body: string }>;
};

const connectionStatements = JSON.parse(
  read("config/connection-statements-v1.0.json"),
) as Record<string, { headline: string; body: string }>;

const questionFor = Object.fromEntries(
  HUMAN_QUESTIONS.map((q) => [q.signal, q.question]),
);

// Canonical section titles, sourced from the report config (single source) —
// the guard asserts the RENDERED headings equal these, never a hardcoded copy.
const reportScreens = (JSON.parse(read("config/report-v1.0.json")) as {
  screens: Array<{ id: string; title: string }>;
}).screens;
const reportTitle = (id: string) => reportScreens.find((s) => s.id === id)?.title ?? "";
const RENDERED_SECTION_IDS = [
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

function expectedSignal(signal: string, narrativeKey: string): {
  question: string;
  label: string;
  copy: string;
} {
  const parts = narrativeKey.split(".");
  const entry =
    parts[0] === "signal_states"
      ? narratives.signal_states[parts[1]]?.[parts[2]]
      : parts[0] === "special_signal_states"
        ? narratives.special_signal_states[parts[1]]
        : null;
  if (!entry) throw new Error(`unexpected narrative key: ${narrativeKey}`);
  if (typeof entry.label !== "string" || typeof entry.copy !== "string") {
    throw new Error(`malformed narrative entry: ${narrativeKey}`);
  }
  const question = questionFor[signal];
  if (typeof question !== "string") throw new Error(`unknown signal: ${signal}`);
  return { question, label: entry.label, copy: entry.copy };
}

function expectedConnection(code: string): { headline: string; body: string } {
  const entry = connectionStatements[code];
  if (!entry || typeof entry.headline !== "string" || typeof entry.body !== "string") {
    throw new Error(`unexpected connection code: ${code}`);
  }
  return { headline: entry.headline, body: entry.body };
}

function expectedAttention(key: string): { label: string; body: string } {
  const entry = narratives.attention_areas[key];
  if (!entry || typeof entry.label !== "string" || typeof entry.body !== "string") {
    throw new Error(`unexpected attention area: ${key}`);
  }
  return { label: entry.label, body: entry.body };
}

// ---------------------------------------------------------------------------
// Fixtures — every key the config defines, and a representative full profile.
// ---------------------------------------------------------------------------

const ladderSignals = Object.entries(narratives.signal_states).flatMap(
  ([signal, states]) =>
    Object.keys(states).map((state) => ({
      signal,
      state,
      narrativeKey: `signal_states.${signal}.${state}`,
    })),
);

const specialSignals = Object.keys(narratives.special_signal_states).map((key) => ({
  signal: key.split("_")[0],
  state: "CAPACITY",
  narrativeKey: `special_signal_states.${key}`,
}));

const connectionCodes = Object.keys(connectionStatements).filter(
  (k) => !["version", "_version_note"].includes(k),
);

function signalEntry(s: { signal: string; state: string; narrativeKey: string }) {
  return {
    signal: s.signal,
    state: s.state === "CAPACITY" ? null : s.state,
    specialState: s.state === "CAPACITY" ? s.narrativeKey.split(".")[1] : null,
    displayState: s.state === "CAPACITY" ? s.narrativeKey.split(".")[1] : s.state,
    narrativeKey: s.narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  } as SnapshotPayload["signals"][number];
}

/** Every config key in the signal/connection space, one instance each. */
function keySpacePayload(): SnapshotPayload {
  return {
    versions: { assessment: "1.0", questionBank: "1.0", scoring: "1.0", narrative: "1.0", report: "1.0", interstitial: "1.0", instrument: "1.0", scoringEngine: "1.0", narrativeLibrary: "1.0", snapshotSchema: "1.1" },
    signals: [...ladderSignals, ...specialSignals].map(signalEntry),
    bigPicture: { template: "PRIMARY_FRICTION", parts: [] },
    strengths: [],
    frictions: [],
    connections: connectionCodes.map((code) => ({ code, narrativeKey: `connection_statements.${code}` })),
    context: [],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "LOW", A2: "LOW", A3: "LOW", A4: "LOW" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: [],
    openingB: null,
  };
}

/** A representative fully-populated profile (all modules). */
function fullPayload(): SnapshotPayload {
  return {
    versions: { assessment: "1.0", questionBank: "1.0", scoring: "1.0", narrative: "1.0", report: "1.0", interstitial: "1.0", instrument: "1.0", scoringEngine: "1.0", narrativeLibrary: "1.0", snapshotSchema: "1.1" },
    signals: [
      { signal: "SEE", state: "S3", specialState: null, displayState: "S3", narrativeKey: "signal_states.SEE.S3", evidence: { confidence: "high", limitedReason: null } },
      { signal: "ROOM", state: "S2", specialState: null, displayState: "S2", narrativeKey: "signal_states.ROOM.S2", evidence: { confidence: "high", limitedReason: null } },
      { signal: "DIRECT", state: "S3", specialState: null, displayState: "S3", narrativeKey: "signal_states.DIRECT.S3", evidence: { confidence: "high", limitedReason: null } },
      { signal: "PREPARE", state: "S4", specialState: null, displayState: "S4", narrativeKey: "signal_states.PREPARE.S4", evidence: { confidence: "high", limitedReason: null } },
      { signal: "AIM", state: "S3", specialState: null, displayState: "S3", narrativeKey: "signal_states.AIM.S3", evidence: { confidence: "high", limitedReason: null } },
      { signal: "MOVE", state: "S5", specialState: null, displayState: "S5", narrativeKey: "signal_states.MOVE.S5", evidence: { confidence: "high", limitedReason: null } },
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

function renderHtml(payload: SnapshotPayload): string {
  const sections = resolveSnapshotContent(payload);
  return renderToStaticMarkup(React.createElement(SnapshotResults, { sections }));
}

function parse(html: string): HTMLElement {
  const c = document.createElement("div");
  c.innerHTML = html;
  return c;
}

function sectionByHeading(container: HTMLElement, heading: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("section")).find(
    (s) => (s.querySelector("h2")?.textContent ?? "").toUpperCase() === heading,
  );
}

describe("the rendered view and the pinned config agree, element for element", () => {
  it("every signal article pairs the right question, label and body — nothing extra", () => {
    const html = renderHtml(keySpacePayload());
    const container = parse(html);
    const moneyPicture = sectionByHeading(container, "YOUR SET FOR LIFE MONEY PICTURE")!;
    const articles = Array.from(moneyPicture.querySelectorAll("article"));

    expect(articles.length).toBe(ladderSignals.length + specialSignals.length);

    [...ladderSignals, ...specialSignals].forEach((s, i) => {
      const article = articles[i];
      const expected = expectedSignal(s.signal, s.narrativeKey);

      expect(article.children.length, `${s.narrativeKey} article has extra children`).toBe(3);

      const heading = article.querySelector("h3");
      expect(heading, `${s.narrativeKey} must have one <h3>`).not.toBeNull();
      expect(heading!.textContent, `${s.narrativeKey} heading mismatch`).toBe(expected.label);

      const paragraphs = article.querySelectorAll("p");
      expect(paragraphs.length, `${s.narrativeKey} body/paragraph count`).toBe(2);
      expect(paragraphs[0].textContent, `${s.narrativeKey} question mismatch`).toBe(
        expected.question,
      );
      expect(paragraphs[1].textContent, `${s.narrativeKey} body mismatch`).toBe(
        expected.copy,
      );
    });
  });

  it("every connection article pairs the right headline and body — nothing extra", () => {
    const html = renderHtml(keySpacePayload());
    const container = parse(html);
    const connection = sectionByHeading(container, reportTitle("connection").toUpperCase())!;
    const articles = Array.from(connection.querySelectorAll("article"));

    expect(articles.length).toBe(connectionCodes.length);

    connectionCodes.forEach((code, i) => {
      const article = articles[i];
      const expected = expectedConnection(code);

      expect(article.children.length, `${code} article has extra children`).toBe(2);

      const heading = article.querySelector("h3");
      expect(heading, `${code} must have one <h3>`).not.toBeNull();
      expect(heading!.textContent, `${code} headline mismatch`).toBe(expected.headline);

      const paragraphs = article.querySelectorAll("p");
      expect(paragraphs.length, `${code} body/paragraph count`).toBe(1);
      expect(paragraphs[0].textContent, `${code} body mismatch`).toBe(expected.body);
    });
  });

  it("EVERY attention-area key renders its label and body verbatim, nothing extra", () => {
    for (const key of Object.keys(narratives.attention_areas)) {
      const payload = { ...keySpacePayload(), attentionAreas: [key] };
      const html = renderHtml(payload);
      const container = parse(html);
      const expected = expectedAttention(key);

      const section = sectionByHeading(container, "ONE AREA WORTH EXAMINING NEXT");
      expect(section, `${key}: attention section missing`).toBeDefined();

      const heading = section!.querySelector("h3");
      expect(heading, `${key}: attention label heading missing`).not.toBeNull();
      expect(heading!.textContent, `${key}: attention label mismatch`).toBe(expected.label);

      const paragraphs = section!.querySelectorAll("p");
      expect(paragraphs.length, `${key}: attention body paragraph count`).toBe(1);
      expect(paragraphs[0].textContent, `${key}: attention body mismatch`).toBe(expected.body);
    }
  });

  it("the section headings are exactly the approved modules, in report-config order", () => {
    const html = renderHtml(fullPayload());
    const container = parse(html);
    const renderedSections = Array.from(container.querySelectorAll("h2")).map(
      (n) => n.textContent ?? "",
    );
    expect(renderedSections).toEqual(
      RENDERED_SECTION_IDS.map((id) => reportTitle(id).toUpperCase()),
    );
  });

  it("no internal vocabulary reaches the rendered prose (§24)", () => {
    const html = renderHtml(fullPayload());
    const container = parse(html);
    const text = container.textContent ?? "";

    // Note: the bare signal ids (SEE / ROOM / PREPARE / …) are NOT listed — they
    // are English words that legitimately appear inside the approved human
    // questions ("HOW MUCH ROOM DO YOU HAVE?"). What must never reach prose is
    // the dotted key prefixes, the special-state CODES, and the tension CODES.
    const specials = Object.keys(narratives.special_signal_states);
    const forbidden = [
      "signal_states.",
      "special_signal_states.",
      "connection_statements.",
      "context_narratives.",
      "perception_gap.",
      "attention_areas.",
      "activation.",
      ...specials,
      ...connectionCodes,
    ];
    for (const token of forbidden) {
      expect(text, `internal vocabulary "${token}" leaked into the render`).not.toContain(token);
    }
  });
});
