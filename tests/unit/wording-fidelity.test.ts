import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * STRICT byte-fidelity guard for participant-facing wording — PRD §34.
 *
 * PRD §34: "Preserve exact approved participant question wording and external
 * order." PRD §32: "Do not silently redesign the instrument while coding."
 *
 * WHY STRICT COMPARISON, DELIBERATELY.
 *
 * An earlier verification pass compared the config against the spec after
 * Unicode-normalising and folding quote variants. That pass reported zero
 * mismatches — and it was wrong. A real one-codepoint drift sat in the config
 * (Q16_J used U+2019 RIGHT SINGLE QUOTATION MARK where the spec has U+0027
 * APOSTROPHE) and normalisation hid it.
 *
 * The spec is unambiguous on this point: across the question sections it uses
 * U+0027 exactly 69 times and U+2019 zero times. Every apostrophe in the
 * instrument is straight. So this test compares RAW CODE POINTS and fails on
 * any difference — including a difference a human would read as identical.
 *
 * That strictness is the entire point. A wording change that is invisible to
 * the eye is exactly the failure mode that would ship unnoticed.
 */

import { existsSync } from "node:fs";

/**
 * The PRD is an external authority document — it lives outside the repo and is
 * never committed (it is not source code, and §30B keeps the repository free of
 * anything but the build). Override the location with ASSESSMENT_SPEC_PATH.
 * When it is absent, the spec-comparison test skips rather than fails, while
 * the self-contained assertions still run.
 */
const PRD_PATH =
  process.env.ASSESSMENT_SPEC_PATH ??
  resolve(__dirname, "../../../../Downloads/Set_for_Life_Assessment_MASTER_PRD_Technical_Spec_FINAL_v1.0.md");
const SPEC_PRESENT = existsSync(PRD_PATH);

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
) as {
  questions: Array<{
    internal_id: string;
    options?: Array<{ code: string; label: string }>;
  }>;
};

const prd = SPEC_PRESENT ? readFileSync(PRD_PATH, "utf8") : "";

/**
 * Pull a spec option label out of a line of the form:
 *   - `Q16_J` — I'm still figuring out what “Set for Life” means to me
 * Returns the raw substring after the em dash, trimmed — NO normalisation.
 */
function specLabel(code: string): string | null {
  const re = new RegExp("^\\s*-\\s*`" + code + "`\\s*—\\s*(.+?)\\s*$", "m");
  const m = prd.match(re);
  return m ? m[1] : null;
}

describe("PRD §34 — strict byte fidelity of option labels", () => {
  it.skipIf(!SPEC_PRESENT)("preserves every option label as RAW code points (no normalisation)", () => {
    const drift: string[] = [];
    let compared = 0;

    for (const q of cfg.questions) {
      for (const opt of q.options ?? []) {
        const spec = specLabel(opt.code);
        if (spec === null) continue; // option not enumerated in §9 as a plain line
        compared++;
        if (spec !== opt.label) {
          const at = [...spec].findIndex((c, i) => c !== opt.label[i]);
          drift.push(
            `${opt.code} differs at index ${at}: ` +
              `spec U+${(spec.codePointAt(at) ?? 0).toString(16).toUpperCase().padStart(4, "0")} ` +
              `vs config U+${(opt.label.codePointAt(at) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
          );
        }
      }
    }

    // Guard against the test silently comparing nothing.
    expect(compared, "labels actually compared").toBeGreaterThan(100);
    expect(drift, `byte-level drift:\n${drift.join("\n")}`).toEqual([]);
  });

  it("uses no U+2019 right-single-quotation-mark anywhere in the instrument", () => {
    // The spec uses U+0027 exclusively (69 occurrences, 0 of U+2019) in the
    // question sections. A stray U+2019 is therefore always a drift.
    const offenders: string[] = [];
    for (const q of cfg.questions) {
      for (const opt of q.options ?? []) {
        if (opt.label.includes("’")) offenders.push(opt.code);
      }
    }
    expect(offenders, `labels containing U+2019: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the curly double quotes around “Set for Life” (U+201C/U+201D)", () => {
    // The instrument DOES use curly double quotes, so a straight-quote
    // "cleanup" would be a drift in the opposite direction.
    const withPhrase = cfg.questions.flatMap((q) =>
      (q.options ?? []).filter((o) => o.label.includes("Set for Life")),
    );
    expect(withPhrase.length).toBeGreaterThan(0);
    for (const opt of withPhrase) {
      expect(opt.label, `${opt.code} curly quotes`).toContain("“Set for Life”");
    }
  });
});
