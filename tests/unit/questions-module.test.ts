import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadQuestionBank,
  questionsInExternalOrder,
  requiredItems,
  checkSelection,
  applySelection,
  maxSelections,
  exclusiveCodes,
  externalOrderOf,
  QuestionBankError,
} from "@/lib/assessment/questions";

/**
 * Instrument loader guards (PRD §8, §9, §14, §34).
 *
 * The bank loader is the gate between the approved config and every downstream
 * computation. If a malformed instrument can load, the engine will happily
 * score it — so these tests assert it THROWS rather than degrading.
 */

const raw = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);

const clone = () => JSON.parse(JSON.stringify(raw));
const bank = loadQuestionBank(raw);

describe("loadQuestionBank — PRD §8 required model", () => {
  it("loads the real instrument and yields exactly 31 required items", () => {
    expect(requiredItems(bank)).toHaveLength(31);
    expect(bank.opening).toHaveLength(2);
    expect(bank.questions).toHaveLength(25);
    expect(bank.activation).toHaveLength(4);
  });

  it("excludes demographics from the 31", () => {
    const ids = requiredItems(bank).map((q) => q.internal_id);
    for (const d of ["D1", "D2", "D3"]) {
      expect(ids).not.toContain(d);
    }
  });
});

describe("loadQuestionBank — rejects a malformed instrument", () => {
  it("throws when a required question is missing", () => {
    const broken = clone();
    broken.questions.pop();
    expect(() => loadQuestionBank(broken)).toThrow(QuestionBankError);
    expect(() => loadQuestionBank(broken)).toThrow(/expected 25 questions/);
  });

  it("throws on a duplicate internal_id", () => {
    const broken = clone();
    broken.questions[1].internal_id = broken.questions[0].internal_id;
    expect(() => loadQuestionBank(broken)).toThrow(/duplicate internal_id/);
  });

  it("throws when the external order is not exactly 1–25", () => {
    const broken = clone();
    broken.questions[0].external_order = 99;
    expect(() => loadQuestionBank(broken)).toThrow(/external_order must be exactly 1\.\.25/);
  });

  it("throws on a duplicated external order", () => {
    const broken = clone();
    broken.questions[1].external_order = broken.questions[0].external_order;
    expect(() => loadQuestionBank(broken)).toThrow(/external_order/);
  });

  it("throws on an unknown response type", () => {
    const broken = clone();
    broken.questions[0].type = "select_all_the_things";
    expect(() => loadQuestionBank(broken)).toThrow(/unknown type/);
  });

  it("throws on an empty prompt", () => {
    const broken = clone();
    broken.questions[0].prompt = "   ";
    expect(() => loadQuestionBank(broken)).toThrow(/empty prompt/);
  });

  it("throws on an option with an empty code", () => {
    const broken = clone();
    broken.questions[0].options[0].code = "";
    expect(() => loadQuestionBank(broken)).toThrow(/empty code/);
  });

  it("throws on duplicate option codes within a question", () => {
    const broken = clone();
    broken.questions[0].options[1].code = broken.questions[0].options[0].code;
    expect(() => loadQuestionBank(broken)).toThrow(/duplicate option codes/);
  });
});

describe("external order — PRD §9", () => {
  it("returns the 25 questions in participant-facing order", () => {
    const ordered = questionsInExternalOrder(bank);
    expect(ordered.map((q) => q.external_order)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it("maps the approved positions to the approved internal ids", () => {
    // Spot-checks the least intuitive positions from PRD §9.
    expect(externalOrderOf(bank, "Q4")).toBe(1);
    expect(externalOrderOf(bank, "Q1")).toBe(2);
    expect(externalOrderOf(bank, "Q9")).toBe(23);
    expect(externalOrderOf(bank, "Q21")).toBe(21);
    expect(externalOrderOf(bank, "Q16")).toBe(25);
  });

  it("throws for an unknown internal id", () => {
    expect(() => externalOrderOf(bank, "Q99")).toThrow(/unknown internal_id/);
  });
});

describe("selection rules — PRD §9 types, §14 exclusivity", () => {
  const q9 = requiredItems(bank).find((q) => q.internal_id === "Q9")!;
  const q21 = requiredItems(bank).find((q) => q.internal_id === "Q21")!;

  it("derives the selection limit from the approved type", () => {
    expect(maxSelections(q9)).toBe(3); // multi_select_max_3_exclusive_no_pressure
    expect(maxSelections(q21)).toBe(2); // multi_select_max_2_exclusive_none
    expect(maxSelections(requiredItems(bank).find((q) => q.internal_id === "Q4")!)).toBe(1);
  });

  it("identifies the exclusive options (and only those)", () => {
    expect(exclusiveCodes(q9)).toEqual(["Q9_L"]);
    expect(exclusiveCodes(q21)).toEqual(["Q21_G"]);
  });

  it("accepts an exclusive option selected alone", () => {
    expect(checkSelection(q9, ["Q9_L"]).ok).toBe(true);
    expect(checkSelection(q21, ["Q21_G"]).ok).toBe(true);
  });

  it("rejects an exclusive option coexisting with another (§29 tests 5–6)", () => {
    const r = checkSelection(q9, ["Q9_L", "Q9_A"]);
    expect(r.ok).toBe(false);
    expect(r.normalized).toEqual(["Q9_L"]);
    expect(checkSelection(q21, ["Q21_G", "Q21_A"]).ok).toBe(false);
  });

  it("rejects exceeding the selection limit", () => {
    const r = checkSelection(q9, ["Q9_A", "Q9_B", "Q9_C", "Q9_D"]);
    expect(r.ok).toBe(false);
    expect(r.normalized).toHaveLength(3);
  });

  it("rejects an unknown option code", () => {
    const r = checkSelection(q9, ["Q99"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown option code/);
  });

  it("clears other selections when an exclusive option is turned on", () => {
    const next = applySelection(q9, ["Q9_A", "Q9_B"], "Q9_L", true);
    expect(next).toEqual(["Q9_L"]);
  });

  it("clears an exclusive choice when a normal option is turned on", () => {
    const next = applySelection(q9, ["Q9_L"], "Q9_A", true);
    expect(next).toEqual(["Q9_A"]);
  });

  it("is deterministic — same input yields the same output", () => {
    const a = applySelection(q9, ["Q9_A", "Q9_B"], "Q9_C", true);
    const b = applySelection(q9, ["Q9_A", "Q9_B"], "Q9_C", true);
    expect(a).toEqual(b);
  });
});
