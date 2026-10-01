import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Locked-instrument guards (PRD §8–§9).
 *
 * Verifies the 31-item instrument in config/assessment-v1.0.json: exact
 * counts, demographics separation, the locked external (participant-facing)
 * order 1–25, the approved external→internal mapping, and option shape.
 * A reordered, added, or dropped item is a silent product failure, so the
 * order mapping below is the highest-value assertion in this file.
 */
const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);

const allRequired = [...cfg.opening, ...cfg.questions, ...cfg.activation];

// PRD §9: approved external order → internal question id. Locked sequence.
const APPROVED_EXTERNAL_ORDER: Array<[number, string]> = [
  [1, "Q4"],
  [2, "Q1"],
  [3, "Q7"],
  [4, "Q17"],
  [5, "Q5"],
  [6, "Q2"],
  [7, "Q13"],
  [8, "Q23"],
  [9, "Q10"],
  [10, "Q3"],
  [11, "Q8"],
  [12, "Q24"],
  [13, "Q14"],
  [14, "Q20"],
  [15, "Q11"],
  [16, "Q18"],
  [17, "Q6"],
  [18, "Q15"],
  [19, "Q25"],
  [20, "Q12"],
  [21, "Q21"],
  [22, "Q19"],
  [23, "Q9"],
  [24, "Q22"],
  [25, "Q16"],
];

// PRD §9: every type the locked bank uses. A new type string would mean an
// unapproved item shape reaching the renderer.
const VALID_TYPES = [
  "single_select",
  "multi_select_max_2",
  "multi_select_max_3",
  "multi_select_max_2_exclusive_none",
  "multi_select_max_3_exclusive_no_pressure",
];

describe("question bank (PRD §8–§9)", () => {
  it("contains exactly 31 required items: 2 opening + 25 questions + 4 activation", () => {
    expect(cfg.opening).toHaveLength(2);
    expect(cfg.questions).toHaveLength(25);
    expect(cfg.activation).toHaveLength(4);
    expect(
      cfg.opening.length + cfg.questions.length + cfg.activation.length,
    ).toBe(31);
  });

  it("keeps demographics separate from the 31 (PRD §8)", () => {
    // The COUNT is deliberately not asserted. What §8 requires is that the
    // demographics step is separate from diagnostic completion and does not
    // contribute to the 31 — a fixed length of 3 both overstated the rule and
    // broke when D4 (State/jurisdiction) was added to this step by operator
    // decision. Testing the separation is the point; testing the number was not.
    const required =
      cfg.opening.length + cfg.questions.length + cfg.activation.length;
    expect(required).toBe(31);
    expect(cfg.demographics.length).toBeGreaterThan(0);
    expect(required + cfg.demographics.length).not.toBe(31);
    // And none of them is a scored item.
    for (const d of cfg.demographics as Array<{
      required_for_completion: boolean;
      diagnostic: boolean;
    }>) {
      expect(d.required_for_completion).toBe(false);
      expect(d.diagnostic).toBe(false);
    }
  });

  it("uses each external_order 1–25 exactly once (PRD §9)", () => {
    const orders = cfg.questions
      .map((q: { external_order: number }) => q.external_order)
      .sort((a: number, b: number) => a - b);
    expect(orders).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("maps external order to the approved PRD §9 sequence exactly", () => {
    const byOrder = new Map(
      cfg.questions.map(
        (q: { external_order: number; internal_id: string }) =>
          [q.external_order, q.internal_id] as const,
      ),
    );
    for (const [order, id] of APPROVED_EXTERNAL_ORDER) {
      expect(byOrder.get(order)).toBe(id);
    }
    expect(byOrder.size).toBe(25);
  });

  it("gives every required item a non-empty prompt and a valid type (PRD §9)", () => {
    for (const q of allRequired) {
      expect(typeof q.prompt).toBe("string");
      expect(q.prompt.trim().length).toBeGreaterThan(0);
      expect(VALID_TYPES).toContain(q.type);
    }
  });

  it("gives every select-type item a non-empty options list (PRD §9)", () => {
    for (const q of allRequired) {
      // Every locked type implies options; a missing list silently breaks rendering.
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate internal_id across opening/questions/activation (PRD §8)", () => {
    const ids = allRequired.map(
      (q: { internal_id: string }) => q.internal_id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every option a non-empty code and label (PRD §9)", () => {
    for (const q of allRequired) {
      for (const o of q.options) {
        expect(typeof o.code).toBe("string");
        expect(o.code.trim().length).toBeGreaterThan(0);
        expect(typeof o.label).toBe("string");
        expect(o.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
