import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The synthesis reveal's copy must match Addendum 01 v1.1 EXACTLY.
 *
 * WHY THIS FILE EXISTS.
 *
 * The reveal is locked instrument copy. §12 requires the reveal to use
 * "ONE ANSWER IS A DETAIL. TOGETHER, THEY MAKE A PICTURE.", and a single
 * changed word is a content defect, not a typo.
 *
 * The strings in `lib/ui/reveal-copy.ts` were EXTRACTED from the addendum rather
 * than typed, precisely to avoid transcription drift — and that is exactly the
 * kind of guarantee that decays. Someone edits a headline for "flow"; the
 * addendum is revised to v1.2; a refactor re-wraps a string literal. Nothing
 * would notice, because the module still compiles and the reveal still renders.
 *
 * So this test re-derives the expected strings from the authoritative document
 * and compares them RAW. No trimming, no case folding, no Unicode
 * normalization, no collapsing whitespace.
 *
 * WHY RAW IS THE WHOLE POINT: three of these strings are separated from their
 * "correct-looking" alternative only by code points a normalizer would erase —
 *
 *   frame 3  ends in a period, and is ONE sentence (not "...FOCUS." + another)
 *   cta      is the ASCII pair "->" (U+002D U+003E), NOT an arrow glyph U+2192
 *   hold     is three ASCII full stops (U+002E x3), NOT an ellipsis U+2026
 *
 * A verbatim check that normalizes passes on exactly the drift it exists to
 * catch. Compare code points.
 */

const repo = resolve(__dirname, "../..");
const DOWNLOADS = "/Users/erspaulding/Downloads";
const STEM = "Set_for_Life_PRD_ADDENDUM_01_Results_Synthesis_and_Financial_Snapshot_FINAL_v1.1";

/**
 * Where the authoritative source may be found, in order of preference.
 *
 * `(1)` IS A REAL VARIANT THAT APPEARS HERE. Restoring or re-downloading this
 * document produces a Finder-deduplicated "…(1).md". Both copies have been
 * verified byte-identical (same sha256) to the file the reveal was built
 * against, so accepting either is safe — but if they ever DIVERGE, the first
 * match wins silently and a wrong string could pass. The equality check below
 * is what makes that impossible: whichever file is read, its content must
 * still produce the exact strings the reveal ships.
 */
const CANDIDATES = [
  resolve(DOWNLOADS, `${STEM}.md`),
  resolve(DOWNLOADS, `${STEM} (1).md`),
  resolve("/Users/erspaulding/.Trash", `${STEM}.md`),
];

/**
 * WHY THE .docx IS DELIBERATELY NOT A CANDIDATE HERE — though it IS the more
 * original artifact.
 *
 * The extraction patterns below are MARKDOWN patterns: they key on `**FRAME 1**`
 * and on copy following a heading on the next line. A .docx has no `**` markers,
 * and its text runs concatenate across section boundaries — the CTA extracts as
 * "SEE MY FINANCIAL PICTURE ->4.3 Motio", welded to the following heading. So
 * the docx is not reliably machine-extractable with these patterns.
 *
 * This was MEASURED, not assumed. A docx branch was written, wired in, and then
 * actually exercised by pointing the candidate list at the .docx alone — where
 * it failed 2 of 13 tests. A fallback that cannot run is worse than no fallback,
 * because it advertises coverage it does not provide. It was removed rather than
 * shipped green-by-absence.
 *
 * The docx WAS cross-checked by hand for the code points that matter (the ASCII
 * `->`, the three ASCII dots, frame 3's single sentence), and it agrees with the
 * .md. The .md is the extraction source; the docx is corroboration.
 */

/** Read the authoritative source, or fail loudly — never skip. */
function addendum(): string {
  const found = CANDIDATES.filter((p) => existsSync(p));
  if (found.length === 0) {
    // Deliberately a failure, not a skip. A verbatim guard that silently passes
    // when it cannot find its source is worse than no guard: it reports safety
    // it did not check. If this fires, restore the addendum rather than deleting
    // this test — it is the only thing checking locked copy against its source.
    throw new Error(
      `Addendum 01 v1.1 not found. Looked in:\n  ${CANDIDATES.join("\n  ")}\n` +
        `This guard verifies locked participant-facing copy against its ` +
        `authoritative source; it cannot run without it. The document may have ` +
        `been moved to ~/.Trash.`,
    );
  }
  return readFileSync(found[0], "utf8");
}

function extract(pattern: RegExp): string {
  const m = addendum().match(pattern);
  if (!m) throw new Error(`verbatim guard: source pattern not found: ${pattern}`);
  return m[1];
}

// Imported once so a failure lists every mismatched string, not just the first.
async function copy() {
  return import("@/lib/ui/reveal-copy");
}

describe("reveal copy matches Addendum 01 v1.1 code point for code point", () => {
  it("every locked string is identical to the source", async () => {
    const c = await copy();

    const expected: Array<[string, string, string]> = [
      [
        "FRAME_1",
        c.FRAME_1,
        extract(/\*\*FRAME 1\*\*\s*\n\*\*(.+?)\*\*/),
      ],
      [
        "FRAME_2",
        c.FRAME_2,
        extract(/\*\*FRAME 2\*\*\s*\n\*\*(.+?)\*\*/),
      ],
      [
        "FRAME_3",
        c.FRAME_3,
        extract(/\*\*FRAME 3\*\*\s*\n\*\*(.+?)\*\*/),
      ],
      [
        "FRAME_5_TEMPLATE",
        c.FRAME_5_TEMPLATE,
        extract(/\*\*FRAME 5\*\*\s*\n\*\*(.+?)\*\*/),
      ],
      ["REVEAL_CTA", c.REVEAL_CTA, extract(/CTA:\s*\*\*(.+?)\*\*/)],
      [
        "HOLD_STATE",
        c.HOLD_STATE,
        extract(/hold on an honest state such as:\s*\n\s*\*\*(.+?)\*\*/),
      ],
      [
        "CREATIVE_TERRITORY",
        c.CREATIVE_TERRITORY,
        extract(/### 4\.1 Creative territory\s*\n\s*\*\*(.+?)\*\*/),
      ],
      ["CORE_IDEA", c.CORE_IDEA, extract(/\*\*(ONE ANSWER IS A DETAIL[^*]+)\*\*/)],
      [
        "MONEY_PICTURE_CENTER",
        c.MONEY_PICTURE_CENTER,
        extract(/The visual center of the Money Picture is:\s*\n\s*\*\*(.+?)\*\*/),
      ],
    ];

    const mismatches: string[] = [];
    for (const [name, actual, want] of expected) {
      if (actual !== want) {
        mismatches.push(
          `${name}\n      code : ${JSON.stringify(actual)}\n` +
            `      src  : ${JSON.stringify(want)}\n` +
            `      diff : ${JSON.stringify(
              [...actual].filter((ch, i) => ch !== want[i]),
            )}`,
        );
      }
    }
    console.log(`  checked ${expected.length} locked strings verbatim`);
    expect(mismatches, `copy drift:\n  ${mismatches.join("\n  ")}`).toEqual([]);
  });

  it("the six human questions match §2.4 exactly", async () => {
    const c = await copy();
    const src = addendum();
    const section = src.split("### 2.4 Six human questions")[1].split("---")[0];
    const pairs = [...section.matchAll(/\d+\.\s+\*\*(.+?)\*\*\s*\n\s*(.+)/g)].map(
      (m) => ({ question: m[1], prompt: m[2].trim() }),
    );

    console.log(
      "  extracted questions:",
      JSON.stringify(pairs.map((p) => p.question)),
    );
    expect(pairs).toHaveLength(6);
    expect(c.SIX_HUMAN_QUESTIONS).toEqual(pairs);
  });
});

describe("the code points a normalizer would erase are preserved", () => {
  it("FRAME_3 is one sentence ending in a period", async () => {
    const { FRAME_3 } = await copy();
    // The retired v1.0 phrasing appended a second sentence; v1.1 does not.
    expect(FRAME_3.endsWith(".")).toBe(true);
    expect(FRAME_3).not.toMatch(/\.\s+\S+\.$/); // no second sentence
    expect(FRAME_3).not.toContain("…");
  });

  it("REVEAL_CTA uses the ASCII arrow from the source, not U+2192", async () => {
    const { REVEAL_CTA } = await copy();
    expect(REVEAL_CTA.endsWith(" ->")).toBe(true);
    expect(REVEAL_CTA).not.toContain("→");
    expect(REVEAL_CTA).not.toContain("➔");
  });

  it("HOLD_STATE uses three ASCII dots, not a U+2026 ellipsis", async () => {
    const { HOLD_STATE } = await copy();
    expect(HOLD_STATE.endsWith("...")).toBe(true);
    expect(HOLD_STATE).not.toContain("…");
  });

  it("no locked string carries a smart quote or other non-ASCII substitute", async () => {
    const c = await copy();
    const strings = [
      c.FRAME_1,
      c.FRAME_2,
      c.FRAME_3,
      c.FRAME_5_TEMPLATE,
      c.REVEAL_CTA,
      c.HOLD_STATE,
      c.CREATIVE_TERRITORY,
      c.CORE_IDEA,
      c.MONEY_PICTURE_CENTER,
      ...c.SIX_HUMAN_QUESTIONS.flatMap((q) => [q.question, q.prompt]),
    ];
    const offenders = strings.filter((s) => /[‘’“”–—…]/.test(s));
    expect(offenders).toEqual([]);
  });
});

describe("§2.1 / §2.3 participant-facing constraints hold", () => {
  it("the center of the Money Picture is YOU — not the logo, not a score", async () => {
    const { MONEY_PICTURE_CENTER } = await copy();
    expect(MONEY_PICTURE_CENTER).toBe("YOU");
  });

  it("the six human questions never use a retired signal label", async () => {
    // §2.3 retires SEE / ROOM / DIRECT / PREPARE / AIM / MOVE as the participant
    // facing framework. The six human questions are that framework's replacement
    // (§2.4), so this is where a leaked signal label would actually appear — and
    // where it would mean the old vocabulary had crept back in.
    //
    // The scope is deliberately ONLY the questions. A first draft of this test
    // also scanned the frame copy and flagged the APPROVED §4.2 CTA, "SEE MY
    // FINANCIAL PICTURE ->", because it contains the English word "SEE". That
    // was the test being wrong, not the copy: the frame strings are locked
    // verbatim and are already checked against the source above, so flagging
    // them here could only ever produce a false positive.
    const c = await copy();
    for (const q of c.SIX_HUMAN_QUESTIONS) {
      expect(
        q.question,
        `retired signal label in a human question: ${q.question}`,
      ).not.toMatch(/^\s*(SEE|ROOM|DIRECT|PREPARE|AIM|MOVE)\b/i);
      expect(
        q.question,
        `retired signal label in a human question: ${q.question}`,
      ).not.toMatch(/\b(SEE|ROOM|DIRECT|PREPARE|AIM|MOVE) SCORE\b/i);
    }
  });

  it("the six human questions are the §2.4 labels, not the internal constructs", async () => {
    // §2.2/§2.3 keep the internal constructs (Financial Visibility, Financial
    // Capacity, Financial Agency, Preparedness & Resilience, Financial
    // Direction, Information-to-Action) as the technical layer underneath. The
    // participant-facing layer is the human questions, and the two must not be
    // swapped.
    const c = await copy();
    const labels = c.SIX_HUMAN_QUESTIONS.map((q) => q.question).join(" | ");
    console.log("  human questions:", labels);
    expect(labels).toContain("WHAT CAN YOU SEE?");
    expect(labels).toContain("WHAT HAPPENS AFTER YOU KNOW?");
    for (const internal of [
      "Financial Visibility",
      "Financial Capacity",
      "Financial Agency",
      "Preparedness & Resilience",
      "Financial Direction",
      "Information-to-Action",
    ]) {
      expect(labels).not.toContain(internal);
    }
  });

  it("no overall score, percentage, or grade vocabulary leaks in", async () => {
    const c = await copy();
    const participantFacing = [
      c.FRAME_1,
      c.FRAME_2,
      c.FRAME_3,
      c.FRAME_5_TEMPLATE,
      c.HOLD_STATE,
      ...c.SIX_HUMAN_QUESTIONS.flatMap((q) => [q.question, q.prompt]),
    ];
    for (const s of participantFacing) {
      expect(s).not.toMatch(/\d+\s?%|score|grade|rating|points/i);
    }
  });

  it("claims about analyzing psychology are absent (§4.3)", async () => {
    const c = await copy();
    const mod = readFileSync(resolve(repo, "lib/ui/reveal-copy.ts"), "utf8");
    // §4.3 forbids "claims that the system is analyzing the participant's
    // psychology" — checked across the module, since this is a prohibition on
    // what the reveal may SAY, not on where it says it.
    expect(mod).not.toMatch(/analy[sz]ing your (psychology|mind|personality)/i);
    expect(c.FRAME_3).not.toMatch(/psycholog/i);
  });
});

describe("frame5() drops the name rather than inventing copy", () => {
  it("renders the approved sentence verbatim when identity IS known", async () => {
    const { frame5 } = await copy();
    console.log("  frame5('Avery'):", JSON.stringify(frame5("Avery")));
    expect(frame5("Avery")).toBe("Avery, your Financial Snapshot is ready.");
  });

  it("renders the same sentence WITHOUT the name when identity is unknown", async () => {
    // §12 requires the name "in the final reveal when identity is known";
    // Addendum 02 §3.2/§15 forbid a name before verification. The nameless case
    // is therefore the approved sentence minus its name prefix — no substitute
    // copy is authored, and no placeholder like "Friend" or "there" appears.
    const { frame5, FRAME_5_TEMPLATE } = await copy();
    const out = frame5(null);
    console.log("  frame5(null):", JSON.stringify(out));
    expect(out).toBe("your Financial Snapshot is ready.");
    expect(out).not.toContain("{First Name}");
    expect(out).not.toMatch(/friend|there|guest|valued/i);
    // The sentence itself is untouched apart from the dropped prefix.
    expect(FRAME_5_TEMPLATE.endsWith(out)).toBe(true);
  });
});
