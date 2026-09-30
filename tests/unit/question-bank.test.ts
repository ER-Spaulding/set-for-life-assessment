import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Locked-instrument regression guard — PRD §8, §9, §34.
 *
 * PRD §34: "Preserve exact approved participant question wording and external
 * order." PRD §32: "Do not silently redesign the instrument while coding."
 *
 * A reordered instrument is a silent product failure: every scored signal would
 * still compute, every Snapshot would still render, and nothing would look
 * broken — but the assessment would no longer be the validated one. These tests
 * exist to make that failure loud.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
) as {
  opening: Array<{ internal_id: string; prompt: string }>;
  questions: Array<{
    internal_id: string;
    external_order: number;
    prompt: string;
    type: string;
    options?: Array<{ code: string; label: string; exclusive?: boolean }>;
  }>;
  activation: Array<{ internal_id: string; prompt: string }>;
  demographics: Array<{ internal_id?: string; options?: Array<{ label: string }> }>;
};

/**
 * The approved external order, transcribed from PRD §9. Internal IDs are never
 * shown to participants; this mapping is the whole point of §9.
 */
const APPROVED_EXTERNAL_ORDER: Record<number, string> = {
  1: "Q4", 2: "Q1", 3: "Q7", 4: "Q17", 5: "Q5",
  6: "Q2", 7: "Q13", 8: "Q23", 9: "Q10", 10: "Q3",
  11: "Q8", 12: "Q24", 13: "Q14", 14: "Q20", 15: "Q11",
  16: "Q18", 17: "Q6", 18: "Q15", 19: "Q25", 20: "Q12",
  21: "Q21", 22: "Q19", 23: "Q9", 24: "Q22", 25: "Q16",
};

const VALID_TYPES = new Set([
  "single_select",
  "multi_select_max_2",
  "multi_select_max_3",
  "multi_select_max_2_exclusive_none",
  "multi_select_max_3_exclusive_no_pressure",
]);

describe("PRD §8 — required completion model", () => {
  it("has exactly 31 required items (Opening A + Opening B + Q1–Q25 + A1–A4)", () => {
    expect(cfg.opening).toHaveLength(2);
    expect(cfg.questions).toHaveLength(25);
    expect(cfg.activation).toHaveLength(4);
    expect(cfg.opening.length + cfg.questions.length + cfg.activation.length).toBe(31);
  });

  it("keeps demographics OUT of the 31 diagnostic items", () => {
    // PRD §8: "Demographics are separate from diagnostic completion."
    expect(cfg.demographics).toHaveLength(3);
    const diagnostic =
      cfg.opening.length + cfg.questions.length + cfg.activation.length;
    expect(diagnostic).not.toBe(31 - cfg.demographics.length);
  });
});

describe("PRD §9 — external question order", () => {
  it("is exactly 1–25 with no gaps and no duplicates", () => {
    const orders = cfg.questions.map((q) => q.external_order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("maps every external position to its approved internal question", () => {
    // The single most important assertion in this file.
    const actual = Object.fromEntries(
      cfg.questions.map((q) => [q.external_order, q.internal_id]),
    );
    expect(actual).toEqual(APPROVED_EXTERNAL_ORDER);
  });
});

describe("instrument integrity", () => {
  it("has no duplicate internal_id across all required items", () => {
    const ids = [
      ...cfg.opening.map((q) => q.internal_id),
      ...cfg.questions.map((q) => q.internal_id),
      ...cfg.activation.map((q) => q.internal_id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every required item a non-empty prompt", () => {
    const all = [...cfg.opening, ...cfg.questions, ...cfg.activation];
    for (const item of all) {
      expect(item.prompt, `${item.internal_id} prompt`).toBeTruthy();
      expect(item.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every question a valid response type", () => {
    for (const q of cfg.questions) {
      expect(VALID_TYPES.has(q.type), `${q.internal_id} type=${q.type}`).toBe(true);
    }
  });

  it("gives every question options with non-empty code and label", () => {
    for (const q of cfg.questions) {
      expect(q.options, `${q.internal_id} has options`).toBeTruthy();
      expect(q.options!.length).toBeGreaterThan(0);
      for (const o of q.options!) {
        expect(o.code, `${q.internal_id} option code`).toBeTruthy();
        expect(o.label, `${q.internal_id}/${o.code} label`).toBeTruthy();
      }
    }
  });

  it("has unique option codes within each question", () => {
    for (const q of cfg.questions) {
      const codes = (q.options ?? []).map((o) => o.code);
      expect(new Set(codes).size, `${q.internal_id} duplicate codes`).toBe(codes.length);
    }
  });
});
