import { describe, it, expect, vi } from "vitest";

// OWNER §14 — CROSS-SECTION DUPLICATION AUDIT.
//
// "For each synthetic/QA profile used during validation, compare Big Picture /
// Money Picture / Strengths / Friction / Connection / Attention. Flag any two
// paragraphs that communicate substantially the same conclusion without adding
// a new implication, relationship or priority. Fix the duplication at the
// narrative/source level — not by merely hiding text in the renderer."
//
// This runs over ALL SEVEN validation profiles (the golden walkthrough fixture
// plus the six §17 synthetic profiles). Paragraph-level prose means section
// intros, block bodies, block paragraphs and outros; structural labels
// (headings, kickers, state labels, headlines) are excluded — they identify,
// they do not conclude. Pairs are CROSS-SECTION only; within-section
// uniqueness is snapshot-paragraph-duplication.test.ts's job.
//
// SIMILARITY, DOCUMENTED: token-set containment — |A∩B| / min(|A|,|B|) over
// lowercased word sets — with a threshold of 0.6. Exact duplicates score 1.0;
// a paraphrase that keeps most tokens (the same conclusion reworded) clears
// 0.6; two genuinely different paragraphs sharing vocabulary do not. There is
// NO ALLOWLIST: a real overlap must be fixed in the governed source, which is
// the point.
//
// FRAGMENT FLOOR, DOCUMENTED: containment divides by the SMALLER set, so on a
// fragment (< 8 unique tokens) one shared idiom scores like a duplicated
// conclusion — the sample's own four-word payoff ("More room creates more
// choices.") scores 0.75 against any paragraph that mentions room/more/
// choices. A fragment cannot carry a conclusion for §14 to flag; fragments
// therefore fail only near-verbatim (≥ 0.9). This is a property of the
// metric, not an exemption of any string: an exact four-word duplicate still
// scores 1.0 and fails the audit. Long paragraphs keep the 0.6 threshold
// unchanged.

import { GOLDEN_OVERRIDES } from "../synthetic-profiles/golden-overrides";
import { STANDARD_PROFILES } from "../synthetic-profiles/narrative-standard-profiles";
import { sectionsFor } from "../synthetic-profiles/profile-runner";
import type { SnapshotSection } from "@/lib/render/snapshot-sections";

const ALL_PROFILES = [
  { id: "golden-walkthrough", overrides: GOLDEN_OVERRIDES },
  ...STANDARD_PROFILES.map((p) => ({ id: p.id, overrides: p.overrides })),
];

const THRESHOLD = 0.6;
/** A set below this size is a fragment — see FRAGMENT FLOOR in the header. */
const FRAGMENT_FLOOR = 8;
/** Near-verbatim bar for fragments (still catches exact repeats). */
const FRAGMENT_VERBATIM = 0.9;

/** Every paragraph-level string in a section, in render order. */
function paragraphsOf(section: SnapshotSection): string[] {
  return [
    ...(section.intro ?? []),
    ...section.blocks.flatMap((b) => [b.body, ...(b.paragraphs ?? [])]),
    ...(section.outro ?? []),
  ].filter((s) => s.trim().length > 0);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** |A∩B| / min(|A|,|B|) — the documented similarity metric. */
function containment(ta: Set<string>, tb: Set<string>): number {
  const min = Math.min(ta.size, tb.size);
  if (min === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / min;
}

/** The six §14 modules (destination/readiness are participant language by
 *  design and are outside the comparison the Owner named). */
const COMPARED = new Set([
  "big-picture",
  "money-picture",
  "strengths",
  "friction",
  "connection",
  "attention",
]);

describe.each(ALL_PROFILES)("§14 cross-section duplication — $id", ({ id, overrides }) => {
  it("no two paragraphs in different compared sections state the same conclusion", async () => {
    const { sections } = await sectionsFor(overrides);
    const compared = sections.filter((s) => COMPARED.has(s.id));

    const rows: Array<{ section: string; text: string }> = [];
    for (const s of compared) {
      for (const text of paragraphsOf(s)) rows.push({ section: s.id, text });
    }

    const offenders: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.section === b.section) continue; // cross-section only
        const ta = tokens(a.text);
        const tb = tokens(b.text);
        const min = Math.min(ta.size, tb.size);
        const score = containment(ta, tb);
        const limit = min < FRAGMENT_FLOOR ? FRAGMENT_VERBATIM : THRESHOLD;
        if (score >= limit) {
          offenders.push(
            `${a.section} ↔ ${b.section} (containment ${score.toFixed(2)}${
              min < FRAGMENT_FLOOR ? ", fragment" : ""
            }):\n` +
              `    A: ${a.text.slice(0, 110)}…\n` +
              `    B: ${b.text.slice(0, 110)}…`,
          );
        }
      }
    }

    expect(offenders, `§14 cross-section duplication in profile ${id}`).toEqual([]);
  });
});
