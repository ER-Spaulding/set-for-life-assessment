import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Exclusive-option guards (PRD §14; PRD §29 acceptance tests 5 and 6).
 *
 * Q9_L ("I don't usually feel financially stretched") and Q21_G ("None of
 * these usually stop me from moving forward") must stand alone: selecting
 * one alongside any other option would corrupt the classifier tags, so every
 * other option on those items must NOT be exclusive.
 */
interface Option {
  code: string;
  label: string;
  exclusive?: boolean;
}
interface Question {
  internal_id: string;
  type: string;
  options: Option[];
  exclusive_option_codes?: string[];
}
interface QuestionBank {
  questions: Question[];
}

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
) as QuestionBank;

const byId = new Map<string, Question>(
  cfg.questions.map((q) => [q.internal_id, q]),
);

/** Fail loudly at collection time rather than with a confusing `unknown` error. */
const requireQ = (id: string): Question => {
  const found = byId.get(id);
  if (!found) throw new Error(`question ${id} missing from config`);
  return found;
};

const q9 = requireQ("Q9");
const q21 = requireQ("Q21");

describe("exclusive options (PRD §14, §29 tests 5–6)", () => {
  it("types Q9/Q21 as the exclusive multi-select types (PRD §14)", () => {
    expect(q9.type).toBe("multi_select_max_3_exclusive_no_pressure");
    expect(q21.type).toBe("multi_select_max_2_exclusive_none");
  });

  it("marks only Q9_L exclusive on Q9 (§29 test 5)", () => {
    for (const o of q9.options) {
      if (o.code === "Q9_L") {
        expect(o.exclusive).toBe(true);
      } else {
        expect(o.exclusive).not.toBe(true);
      }
    }
    expect(q9.exclusive_option_codes).toEqual(["Q9_L"]);
  });

  it("marks only Q21_G exclusive on Q21 (§29 test 6)", () => {
    for (const o of q21.options) {
      if (o.code === "Q21_G") {
        expect(o.exclusive).toBe(true);
      } else {
        expect(o.exclusive).not.toBe(true);
      }
    }
    expect(q21.exclusive_option_codes).toEqual(["Q21_G"]);
  });

  it("keeps the approved exclusive wording character for character (PRD §14)", () => {
    const q9l = q9.options.find((o) => o.code === "Q9_L");
    const q21g = q21.options.find((o) => o.code === "Q21_G");
    expect(q9l, "Q9_L present").toBeDefined();
    expect(q21g, "Q21_G present").toBeDefined();
    expect(q9l!.label).toBe("I don't usually feel financially stretched.");
    expect(q21g!.label).toBe("None of these usually stop me from moving forward.");
  });
});
