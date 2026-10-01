import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Money Moment copy must match Addendum 02 v1.1 §9 EXACTLY.
 *
 * WHY THIS FILE EXISTS.
 *
 * §9 is titled "LOCKED MONEY MOMENT PLACEMENTS & COPY", and §18's acceptance
 * criteria include "exact approved copy is used" and "no historical copy
 * remains". These five screens sit between scored questions, so a drifted word
 * is a content defect in the middle of the instrument — and §8 makes it worse
 * than cosmetic: interstitial language that primes a later answer corrupts the
 * measurement rather than merely reading oddly.
 *
 * The config was generated from the source rather than typed, and this test
 * re-derives the expected strings from the document and compares them RAW. No
 * trimming, no case folding, no Unicode normalization.
 *
 * WHY RAW MATTERS HERE TOO: the CTAs are ASCII "->" (U+002D U+003E), not an
 * arrow glyph. A normalizing comparison would accept "→" and the copy would
 * differ from the approved text in a way no reviewer would catch by eye.
 */

const repo = resolve(__dirname, "../..");
const DOWNLOADS = "/Users/erspaulding/Downloads";
const STEM =
  "Set_for_Life_PRD_ADDENDUM_02_Assessment_Pacing_Entry_and_Money_Moments_FINAL_v1.1";

/**
 * Where the authoritative source may be found, in order of preference.
 *
 * The `(1)` variant is a real Finder-deduplicated copy that appears when the
 * document is restored or re-downloaded. Accepting it is safe because whichever
 * copy is read must still produce the exact strings the app ships.
 */
const CANDIDATES = [
  resolve(DOWNLOADS, `${STEM}.md`),
  resolve(DOWNLOADS, `${STEM} (1).md`),
  resolve("/Users/erspaulding/.Trash", `${STEM}.md`),
];

function addendum(): string {
  const found = CANDIDATES.filter((p) => existsSync(p));
  if (found.length === 0) {
    // Deliberately a failure, not a skip. A verbatim guard that silently passes
    // when it cannot find its source reports safety it did not check.
    throw new Error(
      `Addendum 02 v1.1 not found. Looked in:\n  ${CANDIDATES.join("\n  ")}\n` +
        `Restore the document (it may be in ~/.Trash) rather than deleting this test.`,
    );
  }
  return readFileSync(found[0], "utf8");
}

interface Moment {
  id: string;
  eyebrow: string;
  headline: string;
  body: string[];
  cta: string;
  placement: { afterDiagnosticIndex: number; afterItemId: string; beforeActivation: boolean };
  milestoneLabel: string;
}

function shipped(): Moment[] {
  const cfg = JSON.parse(
    readFileSync(resolve(repo, "config/interstitial-v1.0.json"), "utf8"),
  ) as { moneyMoments: Moment[] };
  return cfg.moneyMoments;
}

/** Re-derive all five moments from §9 of the source document. */
function fromSource(): Array<{ id: string; eyebrow: string; headline: string; body: string[]; cta: string }> {
  const src = addendum();
  const section = src
    .split("## 9. LOCKED MONEY MOMENT PLACEMENTS & COPY")[1]
    .split("## 10.")[0];

  const blocks = section.split(/### MONEY MOMENT (\d+) - .+?\n/);
  const out = [];
  for (let i = 1; i < blocks.length; i += 2) {
    const num = Number(blocks[i]);
    const body = blocks[i + 1];

    const eyebrow = body.match(/\*\*Eyebrow:\*\*\s*(.+)/)![1].trim();
    const cta = body.match(/\*\*CTA:\*\*\s*(.+)/)![1].trim();
    const headM = body.match(/^###\s+(.+)$/m)!;
    const headline = headM[1].trim();
    const lines = body
      .slice(headM.index! + headM[0].length)
      .split("**CTA:**")[0]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    out.push({ id: `MM${String(num).padStart(2, "0")}`, eyebrow, headline, body: lines, cta });
  }
  return out;
}

describe("Money Moment copy matches Addendum 02 v1.1 §9 verbatim", () => {
  it("all five moments are present and every string is identical to the source", () => {
    const got = shipped();
    const want = fromSource();

    console.log("  source moments:", want.map((m) => m.id).join(", "));
    expect(want).toHaveLength(5);
    expect(got).toHaveLength(5);

    const mismatches: string[] = [];
    for (let i = 0; i < want.length; i++) {
      const a = got[i];
      const b = want[i];
      if (a.id !== b.id) mismatches.push(`${b.id}: id is ${a.id}`);
      if (a.eyebrow !== b.eyebrow)
        mismatches.push(`${b.id} eyebrow\n      app: ${JSON.stringify(a.eyebrow)}\n      src: ${JSON.stringify(b.eyebrow)}`);
      if (a.headline !== b.headline)
        mismatches.push(`${b.id} headline\n      app: ${JSON.stringify(a.headline)}\n      src: ${JSON.stringify(b.headline)}`);
      if (a.cta !== b.cta)
        mismatches.push(`${b.id} cta\n      app: ${JSON.stringify(a.cta)}\n      src: ${JSON.stringify(b.cta)}`);
      if (JSON.stringify(a.body) !== JSON.stringify(b.body))
        mismatches.push(
          `${b.id} body\n      app: ${JSON.stringify(a.body)}\n      src: ${JSON.stringify(b.body)}`,
        );
    }
    expect(mismatches, `copy drift:\n  ${mismatches.join("\n  ")}`).toEqual([]);
    console.log("  checked 5 moments verbatim (eyebrow, headline, body, cta)");
  });

  it("the CTAs use the ASCII arrow from the source, not U+2192", () => {
    for (const m of shipped()) {
      expect(m.cta, `${m.id} cta`).not.toContain("→");
      expect(m.cta.endsWith(" ->"), `${m.id} cta must end in ASCII " ->"`).toBe(true);
    }
    console.log("  CTAs:", JSON.stringify([...new Set(shipped().map((m) => m.cta))]));
  });

  it("no locked string carries a curly apostrophe or other non-ASCII substitute", () => {
    // The source uses ASCII apostrophes ("don't", "You've"). A word processor
    // round-trip is exactly what would silently introduce curly ones.
    const offenders: string[] = [];
    for (const m of shipped()) {
      for (const s of [m.eyebrow, m.headline, m.cta, ...m.body]) {
        if (/[‘’“”–—…]/.test(s)) offenders.push(`${m.id}: ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the eyebrow carries the §11 progress marker, with its middle dot", () => {
    // §11: "small `MONEY MOMENT · 0X OF 05` eyebrow". U+00B7 is the approved
    // separator here, unlike the CTAs where ASCII is required.
    shipped().forEach((m, i) => {
      expect(m.eyebrow).toBe(`MONEY MOMENT · 0${i + 1} OF 05`);
    });
  });
});

describe("§6 / §17: no Money Moment is a question or a response", () => {
  it("none of them is scored, and none carries an answer key", () => {
    for (const m of shipped()) {
      expect(m).not.toHaveProperty("options");
      expect(m).not.toHaveProperty("scoring_behavior");
      expect(m).not.toHaveProperty("internal_id"); // questions have these
    }
  });

  it("the config is explicit that they add nothing to the 31 responses", () => {
    // A future edit could add moments and quietly push the required count.
    // §6: "do not increase the 31 required responses."
    expect(shipped()).toHaveLength(5);
  });
});

describe("§11 / §13: no prohibited visual or progress language", () => {
  it("the copy contains no gamification or streak language", () => {
    // §11 forbids "piggy banks, cartoon money, badges, bouncing coins,
    // confetti, streaks, points, or 'You're crushing it!' language".
    const banned = /crushing it|streak|badge|points|leaderboard|high score|well done!|great job/i;
    for (const m of shipped()) {
      for (const s of [m.headline, m.cta, ...m.body]) {
        expect(s, `${m.id}: ${s}`).not.toMatch(banned);
      }
    }
  });

  it("no milestone label calls a run a level, score, or diagnostic domain", () => {
    // §13: "Do not call the runs levels, scores, or diagnostic domains. Do not
    // expose internal signal names as section labels."
    //
    // THE `i` FLAG IS LOAD-BEARING, and it was missing. §13's own examples are
    // ALL UPPERCASE ("FIRST STRETCH COMPLETE", "FINAL FOUR"), so a
    // case-sensitive check against lowercase banned words can never fire on the
    // exact field it guards. Mutation testing caught it: substituting
    // "LEVEL 4 COMPLETE" passed this suite. The signal-name alternatives carry
    // the flag for the same reason.
    const banned =
      /\blevel\b|\bscore\b|\bdomain\b|\bSEE\b|\bROOM\b|\bDIRECT\b|\bPREPARE\b|\bAIM\b|\bMOVE\b/i;
    for (const m of shipped()) {
      expect(m.milestoneLabel, `${m.id} milestone`).not.toMatch(banned);
    }
    console.log("  milestones:", JSON.stringify(shipped().map((m) => m.milestoneLabel)));

    // Prove the guard is not vacuous: the pattern must reject a label that
    // violates §13, or it asserts nothing.
    expect("LEVEL 4 COMPLETE").toMatch(banned);
    expect("YOUR SEE SCORE").toMatch(banned);
  });

  it("no historical-lesson copy remains (§7: 'Historical lessons are removed')", () => {
    // §7 is emphatic that these are personal/reflective or philosophy moments
    // and must not read "like a history lesson" or a "financial-literacy lesson".
    const banned = /in \d{4}|historically|the history of|did you know|research shows|studies show/i;
    for (const m of shipped()) {
      for (const s of [m.headline, ...m.body]) {
        expect(s, `${m.id}: ${s}`).not.toMatch(banned);
      }
    }
  });
});

describe("§9 placement resolves consistently", () => {
  it("moments fire in order and MM05 is the one before activation", () => {
    const idx = shipped().map((m) => m.placement.afterDiagnosticIndex);
    console.log("  afterDiagnosticIndex:", JSON.stringify(idx));
    // Strictly increasing — otherwise a later moment would fire before an
    // earlier one, which is the contradiction that ruled out the rival reading
    // of §9's headers (Q20 is presented before Q15).
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i], "placement must be strictly increasing").toBeGreaterThan(idx[i - 1]);
    }
    expect(shipped()[4].placement.beforeActivation).toBe(true);
    expect(shipped().slice(0, 4).every((m) => m.placement.beforeActivation === false)).toBe(true);
  });

  it("MM05's copy agrees with its own placement", () => {
    // The decisive check: MM05 says "Just four more questions". Under this
    // placement exactly 4 remain (the A1-A4 activation set); under the rival
    // literal-item reading 10 would remain.
    const mm05 = shipped()[4];
    const body = mm05.body.join(" ");
    console.log("  MM05 says:", JSON.stringify(body.slice(0, 60) + "..."));
    expect(body).toMatch(/four more questions/i);
  });

  it("every moment lands on the item its own config names", () => {
    // `afterItemId` is DERIVED, not authoritative: `moneyMomentPlacements()`
    // reads `afterDiagnosticIndex` and resolves it against the administered
    // order (lib/ui/questions.ts:174). Nothing in app/, lib/ or components/
    // reads `afterItemId` at all.
    //
    // Because it is dead data, it can rot silently — and if a future reader
    // trusts it over the index, they will "fix" a placement that was never
    // broken. (It nearly caught me: MM02 declares afterItemId "Q3" for
    // position 10, which reads as an error until you know the instrument is
    // administered in a shuffled order.)
    //
    // This test makes the two fields agree, so the config cannot be read two
    // ways. If the instrument order changes, this fails and tells you which
    // label went stale.
    const bank = JSON.parse(
      readFileSync(resolve(repo, "config/assessment-v1.0.json"), "utf8"),
    ) as { questions: Array<{ internal_id: string; external_order?: number }> };

    const administered = [...bank.questions]
      .sort((a, b) => (a.external_order ?? 0) - (b.external_order ?? 0))
      .map((q) => q.internal_id);

    for (const m of shipped()) {
      const resolved = administered[m.placement.afterDiagnosticIndex - 1];
      console.log(
        `  ${m.id}: index ${m.placement.afterDiagnosticIndex} -> ${resolved} (config labels it ${m.placement.afterItemId})`,
      );
      expect(
        resolved,
        `${m.id}.placement.afterItemId (${m.placement.afterItemId}) does not match the item at index ${m.placement.afterDiagnosticIndex} (${resolved}) — one of the two is stale`,
      ).toBe(m.placement.afterItemId);
    }
  });
});
