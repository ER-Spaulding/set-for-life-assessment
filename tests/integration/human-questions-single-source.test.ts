import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { HUMAN_QUESTIONS } from "@/lib/ui/human-questions";

/**
 * Architecture guard: the six §2.4 human questions have ONE maintained copy.
 *
 * WHY THIS EXISTS.
 *
 * The owner resolved the casing decision: the authoritative participant-facing
 * wording is §2.4's FULL CAPS treatment, and those exact strings live once, in
 * lib/ui/human-questions.ts. Every consumer (narratives' signalLabel,
 * reveal-copy's SIX_HUMAN_QUESTIONS, the Snapshot screen, the SynthesisReveal)
 * must derive from that module — never restate the words. A second hardcoded
 * copy is exactly the drift that silently forked the wording across three files
 * before, and it will happen again the next time someone annotates a grid slot
 * or writes a fixture and copies a question in by hand.
 *
 * So this test reads the six canonical strings and scans the application source
 * (app/, components/, lib/, config/) for any OTHER file that contains one of
 * them as a literal — comment or code — and fails listing every offender. It
 * deliberately scans raw text (not an AST), because a comment restating the
 * string is as much a maintained copy as a string literal and would drift the
 * same way.
 *
 * MATCHING IS CASE-INSENSITIVE, and that is load-bearing. The prohibited
 * re-fork is not only a copy in CAPS: the owner forbade "maintaining six
 * separate sentence-case strings", and Addendum 03 §14's sentence case is the
 * presentation a future interface will reach for. A case-sensitive scan of the
 * caps strings misses a sentence-case copy outright, and — because the words
 * are identical apart from case — such a copy is invisible to the derived-copy
 * tests too (reveal-copy's SIX_HUMAN_QUESTIONS maps q.question raw, so its
 * output already equals the canonical caps string; narrative/config assertions
 * say nothing about the words). Matching case-insensitively catches both. It
 * cannot false-positive on ordinary prose: the strings are full sentences with
 * their punctuation, not fragments, so a sentence-case copy is caught while a
 * legitimate prose mention would have to restate the whole question word for
 * word — which is itself a copy worth failing on.
 *
 * A guard that cannot fail is worthless: the commit that added it first planted
 * a copy, watched it fail and name the offender, then removed the plant.
 */

const repo = resolve(__dirname, "../..");
const SCAN_ROOTS = ["app", "components", "lib", "config"].map((d) => resolve(repo, d));
const CANONICAL = resolve(repo, "lib/ui/human-questions.ts");
const SELF = resolve(__filename);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe("the six §2.4 questions have exactly one maintained copy", () => {
  it("no other source file under app/components/lib/config hardcodes a question", () => {
    const questions = HUMAN_QUESTIONS.map((q) => q.question);
    // Six distinct canonical strings — a copy-paste collapse here would make
    // the scan silently cover only five words.
    expect(new Set(questions).size).toBe(6);

    const offenders: Array<{ file: string; question: string }> = [];
    let scanned = 0;

    for (const root of SCAN_ROOTS) {
      if (!existsSync(root)) continue;
      for (const file of walk(root)) {
        if (file === CANONICAL || file === SELF) continue;
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch {
          continue; // a non-text asset cannot hold a copied string
        }
        scanned += 1;
        const lower = text.toLowerCase();
        for (const q of questions) {
          if (lower.includes(q.toLowerCase())) {
            offenders.push({ file: relative(repo, file), question: q });
          }
        }
      }
    }

    console.log(`  scanned ${scanned} source files for a second copy`);
    expect(
      offenders,
      `a second maintained copy of a §2.4 question string exists — derive from ` +
        `lib/ui/human-questions.ts instead:\n` +
        offenders
          .map((o) => `  ${o.file}: "${o.question}"`)
          .join("\n"),
    ).toEqual([]);
  });
});
