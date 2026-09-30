import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Exclusive-option guard — PRD §14, and PRD §29 acceptance tests 5 and 6.
 *
 * Q9_L ("I don't usually feel financially stretched") and Q21_G ("None of these
 * usually stop me") are mutually exclusive with every other option in their
 * question. If either coexists with another selection, the capacity / fear
 * classifier would be computed from contradictory answers — e.g. "no financial
 * pressure" alongside four pressure sources — and every downstream tension,
 * friction statement and attention area would be built on nonsense.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
) as {
  questions: Array<{
    internal_id: string;
    type: string;
    options?: Array<{ code: string; label: string; exclusive?: boolean }>;
  }>;
};

const q = (id: string) => {
  const found = cfg.questions.find((x) => x.internal_id === id);
  if (!found) throw new Error(`question ${id} not found in config`);
  return found;
};

describe("PRD §14 / §29 tests 5–6 — exclusive options", () => {
  it("marks Q9_L exclusive and every other Q9 option non-exclusive", () => {
    const question = q("Q9");
    const exclusive = (question.options ?? []).filter((o) => o.exclusive);
    expect(exclusive.map((o) => o.code)).toEqual(["Q9_L"]);
  });

  it("marks Q21_G exclusive and every other Q21 option non-exclusive", () => {
    const question = q("Q21");
    const exclusive = (question.options ?? []).filter((o) => o.exclusive);
    expect(exclusive.map((o) => o.code)).toEqual(["Q21_G"]);
  });

  it("uses the response types that encode exclusivity", () => {
    expect(q("Q9").type).toBe("multi_select_max_3_exclusive_no_pressure");
    expect(q("Q21").type).toBe("multi_select_max_2_exclusive_none");
  });

  it("preserves the approved wording of the exclusive options verbatim", () => {
    // PRD §34: exact approved participant wording.
    const q9l = q("Q9").options?.find((o) => o.code === "Q9_L");
    const q21g = q("Q21").options?.find((o) => o.code === "Q21_G");
    expect(q9l?.label).toBe("I don't usually feel financially stretched.");
    expect(q21g?.label).toBe("None of these usually stop me from moving forward.");
  });
});
