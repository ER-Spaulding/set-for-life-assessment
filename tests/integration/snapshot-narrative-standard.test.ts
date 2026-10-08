import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";

// OWNER NARRATIVE-STANDARD GUARDS (plan §Test & guard plan) — §17's seven
// validation profiles, measured against the brief's rules:
//
//   * WORD BUDGETS as 2× CEILINGS ONLY — no minimums. A ceiling catches
//     runaway copy; a floor would punish honest short states (the sample
//     itself has one-line paragraphs), and the Owner's rule is "every
//     additional sentence must earn its place", not "fill the quota".
//     Brief budgets → ceilings: Big Picture 120–180→360, Money dimension
//     45–80→160, Friction finding 55–90→180, Connection 120–190→380,
//     Readiness dimension 35–65→130, primary Attention 90–150→300,
//     secondary Attention 20–45→90.
//
//   * EVIDENCE-STEM DISCIPLINE (Owner decision 1): the legacy stem
//     "Your responses suggest/show" appears at most once per profile, and no
//     single configured opener phrase may open more than three paragraphs in
//     one profile — natural variation with evidence discipline, never one
//     repeated phrase.
//
//   * NO REPEATED 4-WORD OPENER on consecutive paragraphs (section order).
//
//   * LIBRARY COMPLETENESS: every family the resolvers read is fully
//     populated — including guardrail 2's theme_clauses for all 11 Q16 codes.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

import { sectionsFor } from "../synthetic-profiles/profile-runner";
import { STANDARD_PROFILES } from "../synthetic-profiles/narrative-standard-profiles";
import { GOLDEN_OVERRIDES } from "../synthetic-profiles/golden-overrides";
import type { SnapshotSection, SnapshotBlock } from "@/lib/render/snapshot-sections";

const ALL_PROFILES = [
  { id: "golden-walkthrough", overrides: GOLDEN_OVERRIDES },
  ...STANDARD_PROFILES.map((p) => ({ id: p.id, overrides: p.overrides })),
];

const narratives = JSON.parse(
  readFileSync("config/narratives-v1.0.json", "utf8"),
) as Record<string, any>;

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** Paragraph-level strings of a section, in render order. */
function paragraphsOf(section: SnapshotSection): string[] {
  return [
    ...(section.intro ?? []),
    ...section.blocks.flatMap((b) => [b.body, ...(b.paragraphs ?? [])]),
    ...(section.outro ?? []),
  ].filter((s) => s && s.trim().length > 0);
}

const blockWords = (b: SnapshotBlock): number =>
  words([b.body, ...(b.paragraphs ?? [])].join(" "));

/** Every paragraph, in section order, tagged with its section. */
function paragraphStream(sections: SnapshotSection[]): Array<{ section: string; text: string }> {
  return sections.flatMap((s) => paragraphsOf(s).map((text) => ({ section: s.id, text })));
}

const OPENERS: string[] = [
  ...(narratives.evidence_openers?.high ?? []),
  ...(narratives.evidence_openers?.moderate ?? []),
  ...(narratives.evidence_openers?.limited ?? []),
];

const firstWords = (s: string, n: number): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, n).join(" ");

const SECTIONS: SnapshotSection[][] = [];

beforeAll(async () => {
  for (const p of ALL_PROFILES) {
    const { sections } = await sectionsFor(p.overrides);
    SECTIONS.push(sections);
  }
});

describe.each(ALL_PROFILES.map((p, i) => ({ ...p, index: i })))(
  "narrative standard — $id",
  ({ index }) => {
    const sections = (): SnapshotSection[] => SECTIONS[index];

    it("stays within the 2× word ceilings", () => {
      const over: string[] = [];
      for (const s of sections()) {
        const all = paragraphsOf(s);
        if (s.id === "big-picture" && words(all.join(" ")) > 360) {
          over.push(`big-picture ${words(all.join(" "))} > 360`);
        }
        if (s.id === "connection" && words(all.join(" ")) > 380) {
          over.push(`connection ${words(all.join(" "))} > 380`);
        }
        if (s.id === "money-picture") {
          s.blocks.forEach((b, i) => {
            if (blockWords(b) > 160) over.push(`money dimension ${i} ${blockWords(b)} > 160`);
          });
        }
        if (s.id === "friction") {
          s.blocks.forEach((b, i) => {
            if (blockWords(b) > 180) over.push(`friction ${i} ${blockWords(b)} > 180`);
          });
        }
        if (s.id === "readiness") {
          s.blocks.forEach((b, i) => {
            if (blockWords(b) > 130) over.push(`readiness ${i} ${blockWords(b)} > 130`);
          });
        }
        if (s.id === "attention") {
          s.blocks.forEach((b, i) => {
            const ceiling = b.variant === "primary" ? 300 : 90;
            if (blockWords(b) > ceiling) {
              over.push(`attention ${i} (${b.variant}) ${blockWords(b)} > ${ceiling}`);
            }
          });
        }
      }
      expect(over).toEqual([]);
    });

    it("keeps evidence stems rare and never repeats one phrase", () => {
      const stream = paragraphStream(sections());
      // 1. The legacy stem is retired to at most ONE use per profile.
      const legacy = stream.filter((p) =>
        /^your responses (suggest|shows?|indicate)\b/i.test(p.text.trim()),
      );
      expect(
        legacy.length,
        `legacy stem used ${legacy.length}×: ${legacy.map((p) => p.text.slice(0, 50)).join(" | ")}`,
      ).toBeLessThanOrEqual(1);

      // 2. No single configured OPENER PHRASE may open more than three
      //    paragraphs. One- and two-word openers ("You have", "You are") are
      //    grammar, not voice — the repetition rule applies to configured
      //    phrases of three words or more.
      const counts = new Map<string, number>();
      for (const p of stream) {
        const t = p.text.trim().toLowerCase();
        for (const opener of OPENERS) {
          if (opener.trim().split(/\s+/).length < 3) continue;
          if (t.startsWith(opener.toLowerCase())) {
            const key = opener.toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
      const repeated = [...counts.entries()].filter(([, n]) => n > 3);
      expect(
        repeated.map(([k, n]) => `${k} ×${n}`),
        "an opener phrase is doing all the work (Owner decision 1)",
      ).toEqual([]);
    });

    it("never repeats a 4-word opener on consecutive paragraphs", () => {
      const stream = paragraphStream(sections());
      const offenders: string[] = [];
      for (let i = 1; i < stream.length; i += 1) {
        const a = firstWords(stream[i - 1].text, 4);
        const b = firstWords(stream[i].text, 4);
        if (a && a === b) offenders.push(`…${a}… twice in a row (${stream[i].section})`);
      }
      expect(offenders).toEqual([]);
    });
  },
);

describe("library completeness — every family the resolvers read is fully populated", () => {
  it("evidence_openers: ≥3 distinct openers per level", () => {
    for (const level of ["high", "moderate", "limited"] as const) {
      const pool = narratives.evidence_openers?.[level] ?? [];
      expect(new Set(pool).size, `${level} opener pool`).toBeGreaterThanOrEqual(3);
      expect(pool.length).toBe(pool.length); // non-vacuous: array exists
      expect(pool.length).toBeGreaterThan(0);
    }
  });

  it("signal states: the three confidence voices are not all one opener, and limited never mirrors moderate", () => {
    const bad: string[] = [];
    for (const sig of ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"]) {
      for (const st of ["S1", "S2", "S3", "S4", "S5"]) {
        const copy = narratives.signal_states[sig][st].copy;
        const o = (lvl: string): string => firstWords(copy[lvl], 4);
        if (o("high") === o("moderate") && o("moderate") === o("limited")) {
          bad.push(`${sig}.${st}: all three openers identical`);
        }
        if (o("moderate") === o("limited")) {
          bad.push(`${sig}.${st}: limited mirrors moderate (claim strength would drift)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("big_picture: every template keeps a default, every authored node is complete", () => {
    const bp = narratives.big_picture;
    const bad: string[] = [];
    for (const [tpl, areas] of Object.entries<Record<string, any>>(bp)) {
      if (!areas.default) bad.push(`${tpl}: missing default`);
      for (const [area, node] of Object.entries<Record<string, any>>(areas)) {
        if (typeof node?.headline !== "string" || !node.headline) bad.push(`${tpl}.${area}: headline`);
        if (!Array.isArray(node?.body) || node.body.length === 0) bad.push(`${tpl}.${area}: body`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("destination: theme_clauses covers all 11 Q16 codes with framing + outcome", () => {
    const clauses = narratives.destination?.theme_clauses ?? {};
    const codes = ["Q16_A","Q16_B","Q16_C","Q16_D","Q16_E","Q16_F","Q16_G","Q16_H","Q16_I","Q16_J","Q16_K"];
    const bad = codes.filter((c) => {
      const n = clauses[c];
      return typeof n?.framing !== "string" || !n.framing || typeof n?.outcome !== "string" || !n.outcome;
    });
    expect(bad).toEqual([]);
    expect(Object.keys(clauses).sort()).toEqual([...codes].sort());
    expect(typeof narratives.destination?.lede?.contrast).toBe("string");
    expect(typeof narratives.destination?.lede?.plain).toBe("string");
    expect(typeof narratives.destination?.tail).toBe("string");
    expect(narratives.destination?._default).toBeTruthy(); // true-fallback documented
  });

  it("attention areas: label, short_label and paragraph body on every area", () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries<Record<string, any>>(narratives.attention_areas)) {
      if (typeof entry.label !== "string" || !entry.label) bad.push(`${key}: label`);
      if (typeof entry.short_label !== "string" || !entry.short_label) bad.push(`${key}: short_label`);
      if (!Array.isArray(entry.body) || entry.body.length === 0) bad.push(`${key}: body`);
    }
    expect(bad).toEqual([]);
  });

  it("all 18 connection codes carry a friction title/body plus connection headline/framing", () => {
    const entries = narratives.connection_statements;
    const codes = Object.keys(entries).filter((k) => !k.startsWith("_") && k !== "version");
    expect(codes).toHaveLength(18);
    const bad: string[] = [];
    for (const code of codes) {
      const e = entries[code];
      if (typeof e.headline !== "string" || !e.headline) bad.push(`${code}: headline`);
      if (typeof e.body !== "string" || !e.body) bad.push(`${code}: body`);
      if (typeof e.connection?.headline !== "string" || !e.connection.headline) bad.push(`${code}: connection.headline`);
      if (!Array.isArray(e.connection?.framing) || e.connection.framing.length === 0) bad.push(`${code}: connection.framing`);
    }
    expect(bad).toEqual([]);
  });

  it("activation bands: stateLabel + non-empty body on all 12 bands", () => {
    const bad: string[] = [];
    for (const item of ["A1", "A2", "A3", "A4"]) {
      for (const band of ["LOW", "MID", "HIGH"]) {
        const n = narratives.activation?.[item]?.[band];
        if (typeof n?.stateLabel !== "string" || !n.stateLabel) bad.push(`${item}.${band}: stateLabel`);
        if (!Array.isArray(n?.body) || n.body.length === 0) bad.push(`${item}.${band}: body`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("section_intros: paragraph arrays, no retired draft text", () => {
    const intros = narratives.section_intros ?? {};
    expect(Object.keys(intros).sort()).toEqual(
      ["friction", "money-picture", "readiness", "strengths"].sort(),
    );
    for (const [id, paras] of Object.entries<unknown>(intros)) {
      expect(Array.isArray(paras) && (paras as string[]).length > 0, id).toBe(true);
      expect(JSON.stringify(paras)).not.toMatch(/DRAFT|NEEDS OWNER/i);
    }
  });
});
