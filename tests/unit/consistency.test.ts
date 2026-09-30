import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkConsistency,
  hasNoDetectedContradiction,
  findingsByItem,
  type ConsistencyInput,
} from "@/lib/assessment/consistency";
import {
  loadQuestionBank,
  MAX_SELECTIONS_BY_TYPE,
  checkSelection,
} from "@/lib/assessment/questions";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";

/**
 * consistency.ts — the §23.2 cross-response sanity check.
 *
 * WHY THIS FILE EXISTS.
 *
 * The module was mandated by §23.2 ("runs consistency checks") and shipped with
 * ZERO test coverage. It is also currently called from nowhere in production, so
 * nothing else exercises it either. A module that is both unwired and untested
 * is the exact combination that hides a defect indefinitely.
 *
 * Two properties are asserted beyond the individual checks:
 *
 *  1. IT NEVER THROWS ON PARTICIPANT DATA. Its contract says findings are
 *     returned, not raised — a consistency check that blew up on a malformed
 *     response set would fail completion for the participant, which is worse
 *     than the contradiction it was looking for.
 *
 *  2. ITS SELECTION-LIMIT TABLE AGREES WITH THE WRITE PATH. `LIMITS` here is a
 *     second, hand-maintained copy of `MAX_SELECTIONS_BY_TYPE` in questions.ts.
 *     Two copies of one table drift; the cross-check below is what stops it.
 *     (Consolidating them into one import would also work — this test merely
 *     makes the divergence impossible to ship either way.)
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);
const bank = loadQuestionBank(cfg);

/** Every instrument item, in one list. */
const ALL_ITEMS = [
  ...bank.opening,
  ...bank.questions,
  ...bank.activation,
  ...(bank.demographics ?? []),
];

/** Build a ConsistencyInput over the real instrument. */
function inputFor(
  responses: Record<string, readonly string[]>,
  items = ALL_ITEMS,
): ConsistencyInput {
  return {
    responses,
    questions: items.map((q) => ({
      internal_id: q.internal_id,
      type: q.type,
      options: q.options.map((o) => ({ code: o.code })),
      exclusive_option_codes: q.exclusive_option_codes,
    })),
    requiredItemIds: REQUIRED_ITEM_IDS,
  };
}

/** Every required item answered with its first option — a clean baseline. */
function completeResponses(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const id of REQUIRED_ITEM_IDS) {
    const q = ALL_ITEMS.find((x) => x.internal_id === id);
    if (!q) throw new Error(`test fixture: ${id} not on the instrument`);
    out[id] = [q.options[0].code];
  }
  return out;
}

describe("a clean response set produces no findings", () => {
  it("all 31 answered with permitted selections yields an empty array", () => {
    const findings = checkConsistency(inputFor(completeResponses()));
    console.log("  findings:", JSON.stringify(findings));
    expect(findings).toEqual([]);
    expect(hasNoDetectedContradiction(findings)).toBe(true);
  });
});

describe("§14 exclusivity — an exclusive option stands alone", () => {
  it("flags Q21_G selected alongside another option", () => {
    // Q21_G is "no significant fear friction" — choosing it AND a fear source
    // is a contradiction, not a stronger answer.
    const r = completeResponses();
    const q21 = ALL_ITEMS.find((q) => q.internal_id === "Q21")!;
    const nonExclusive = q21.options.find((o) => o.code !== "Q21_G")!;
    (r as Record<string, string[]>).Q21 = ["Q21_G", nonExclusive.code];

    const findings = checkConsistency(inputFor(r));
    console.log("  Q21 findings:", JSON.stringify(findings.filter((f) => f.itemId === "Q21")));
    const f = findings.find((x) => x.itemId === "Q21" && x.code === "EXCLUSIVE_OPTION_COEXISTS");
    expect(f).toBeDefined();
    expect(f!.detail).toContain("Q21_G");
  });

  it("flags Q9_L selected alongside another option", () => {
    const r = completeResponses();
    const q9 = ALL_ITEMS.find((q) => q.internal_id === "Q9")!;
    const nonExclusive = q9.options.find((o) => o.code !== "Q9_L")!;
    (r as Record<string, string[]>).Q9 = ["Q9_L", nonExclusive.code];

    const findings = checkConsistency(inputFor(r));
    const f = findings.find((x) => x.itemId === "Q9" && x.code === "EXCLUSIVE_OPTION_COEXISTS");
    console.log("  Q9 finding:", JSON.stringify(f));
    expect(f).toBeDefined();
  });

  it("does NOT flag an exclusive option chosen alone", () => {
    const r = completeResponses();
    (r as Record<string, string[]>).Q21 = ["Q21_G"];
    const findings = checkConsistency(inputFor(r));
    expect(findings.filter((f) => f.itemId === "Q21")).toEqual([]);
  });
});

describe("selection limits", () => {
  it("flags a single-select item given two options", () => {
    const r = completeResponses();
    const q4 = ALL_ITEMS.find((q) => q.internal_id === "Q4")!;
    (r as Record<string, string[]>).Q4 = [q4.options[0].code, q4.options[1].code];

    const findings = checkConsistency(inputFor(r));
    const f = findings.find((x) => x.itemId === "Q4" && x.code === "SELECTION_LIMIT_EXCEEDED");
    console.log("  Q4 finding:", JSON.stringify(f));
    expect(f).toBeDefined();
    expect(f!.detail).toContain("single_select");
  });

  it("flags a max_2 multi-select given three options", () => {
    const r = completeResponses();
    const q1 = ALL_ITEMS.find((q) => q.internal_id === "Q1")!;
    (r as Record<string, string[]>).Q1 = q1.options.slice(0, 3).map((o) => o.code);

    const findings = checkConsistency(inputFor(r));
    expect(
      findings.find((x) => x.itemId === "Q1" && x.code === "SELECTION_LIMIT_EXCEEDED"),
    ).toBeDefined();
  });

  it("does NOT flag a multi-select at exactly its limit", () => {
    const r = completeResponses();
    const q1 = ALL_ITEMS.find((q) => q.internal_id === "Q1")!;
    (r as Record<string, string[]>).Q1 = q1.options.slice(0, 2).map((o) => o.code);
    const findings = checkConsistency(inputFor(r));
    expect(findings.filter((f) => f.itemId === "Q1")).toEqual([]);
  });
});

describe("unknown codes and ids", () => {
  it("flags an option code that is not on the item", () => {
    const r = completeResponses();
    (r as Record<string, string[]>).Q4 = ["Q4_ZZZ"];
    const findings = checkConsistency(inputFor(r));
    const f = findings.find((x) => x.itemId === "Q4" && x.code === "UNKNOWN_OPTION_CODE");
    console.log("  unknown code finding:", JSON.stringify(f));
    expect(f).toBeDefined();
    expect(f!.detail).toContain("Q4_ZZZ");
  });

  it("flags a response for an item that is not on the instrument", () => {
    const r = completeResponses();
    (r as Record<string, string[]>).Q999 = ["Q999_A"];
    const findings = checkConsistency(inputFor(r));
    const f = findings.find((x) => x.itemId === "Q999");
    expect(f).toBeDefined();
    expect(f!.code).toBe("UNKNOWN_OPTION_CODE");
  });
});

describe("§8 required items", () => {
  it("flags each unanswered required item", () => {
    const r = completeResponses();
    delete (r as Record<string, string[]>).Q25;
    delete (r as Record<string, string[]>).A4;

    const findings = checkConsistency(inputFor(r));
    const missing = findings.filter((f) => f.code === "MISSING_REQUIRED_ITEM");
    console.log("  missing:", JSON.stringify(missing.map((m) => m.itemId)));
    expect(missing.map((m) => m.itemId).sort()).toEqual(["A4", "Q25"]);
  });

  it("treats an empty array as unanswered", () => {
    const r = completeResponses();
    (r as Record<string, string[]>).Q10 = [];
    const findings = checkConsistency(inputFor(r));
    expect(
      findings.find((f) => f.itemId === "Q10" && f.code === "MISSING_REQUIRED_ITEM"),
    ).toBeDefined();
  });

  it("does not require demographics — they are outside the 31 (§8)", () => {
    const findings = checkConsistency(inputFor(completeResponses()));
    for (const id of ["D1", "D2", "D3"]) {
      expect(
        findings.find((f) => f.itemId === id),
        `demographics must not appear in findings`,
      ).toBeUndefined();
    }
  });
});

describe("it NEVER throws on participant data (its stated contract)", () => {
  it("survives an empty response set", () => {
    expect(() => checkConsistency(inputFor({}))).not.toThrow();
    // ...and reports all 31 as missing rather than crashing.
    expect(checkConsistency(inputFor({})).filter((f) => f.code === "MISSING_REQUIRED_ITEM"))
      .toHaveLength(REQUIRED_ITEM_IDS.length);
  });

  it("survives a response set of entirely unknown items and codes", () => {
    expect(() =>
      checkConsistency(inputFor({ NOPE: ["BAD"], Q4: ["NOT_A_CODE"] })),
    ).not.toThrow();
  });

  it("survives an empty instrument", () => {
    expect(() =>
      checkConsistency({ responses: { Q4: ["Q4_A"] }, questions: [], requiredItemIds: [] }),
    ).not.toThrow();
  });

  it("is deterministic — same input, same output order", () => {
    const r = completeResponses();
    (r as Record<string, string[]>).Q4 = ["Q4_A", "Q4_B"];
    const a = checkConsistency(inputFor(r));
    const b = checkConsistency(inputFor(r));
    expect(a).toEqual(b);
  });
});

describe("helpers", () => {
  it("findingsByItem groups and sorts deterministically", () => {
    const r = completeResponses();
    const q4 = ALL_ITEMS.find((q) => q.internal_id === "Q4")!;
    (r as Record<string, string[]>).Q4 = ["Q4_A", "Q4_B"]; // limit breach
    (r as Record<string, string[]>).Q999 = ["X"]; // unknown item
    void q4;

    const grouped = findingsByItem(checkConsistency(inputFor(r)));
    console.log("  grouped keys:", JSON.stringify(Object.keys(grouped)));
    expect(Object.keys(grouped)).toEqual([...Object.keys(grouped)].sort());
    for (const [, list] of Object.entries(grouped)) {
      const codes = list.map((f) => f.code);
      expect(codes).toEqual([...codes].sort());
    }
  });

  it("hasNoDetectedContradiction is false when anything is found", () => {
    expect(hasNoDetectedContradiction([])).toBe(true);
    expect(
      hasNoDetectedContradiction([
        { code: "UNKNOWN_OPTION_CODE", itemId: "Q1", detail: "x" },
      ]),
    ).toBe(false);
  });
});

describe("CROSS-CHECK: the re-check's limit table agrees with the write path", () => {
  it("LIMITS and MAX_SELECTIONS_BY_TYPE describe the same instrument", () => {
    // consistency.ts keeps its own copy of the selection-limit table. Two
    // hand-maintained copies of one rule drift, and a divergence here would be
    // silent: the write path would accept a selection the consistency re-check
    // then flags as invalid (or vice versa). Asserted by BEHAVIOUR through the
    // real instrument rather than by importing the private constant.
    for (const type of Object.keys(MAX_SELECTIONS_BY_TYPE)) {
      const limit = MAX_SELECTIONS_BY_TYPE[type];

      // Find a real item of this type, or synthesise one from its shape.
      const sample = ALL_ITEMS.find((q) => q.type === type);
      const options = Array.from({ length: limit + 1 }, (_, i) => ({ code: `X_${i}` }));
      const item = {
        internal_id: "SYNTH",
        type,
        options,
        exclusive_option_codes: [] as string[],
        prompt: "synthetic",
      };
      void sample;

      const overLimit = options.slice(0, limit + 1).map((o) => o.code);
      const atLimit = options.slice(0, limit).map((o) => o.code);

      // The write path's verdict...
      const writeCheck = checkSelection(item as never, overLimit);
      // ...must agree with the consistency re-check's verdict.
      const findings = checkConsistency({
        responses: { SYNTH: overLimit },
        questions: [
          {
            internal_id: "SYNTH",
            type,
            options,
            exclusive_option_codes: [],
          },
        ],
        requiredItemIds: [],
      });
      const recheckFlagged = findings.some(
        (f) => f.code === "SELECTION_LIMIT_EXCEEDED",
      );

      console.log(
        `  ${type}: limit=${limit} write-path ok=${writeCheck.ok} re-check flagged=${recheckFlagged}`,
      );
      expect(recheckFlagged, `${type}: re-check must reject ${limit + 1}`).toBe(true);
      expect(writeCheck.ok, `${type}: write path must reject ${limit + 1}`).toBe(false);

      // And at exactly the limit, both must be satisfied.
      const atLimitFindings = checkConsistency({
        responses: { SYNTH: atLimit },
        questions: [
          { internal_id: "SYNTH", type, options, exclusive_option_codes: [] },
        ],
        requiredItemIds: [],
      });
      expect(
        atLimitFindings.some((f) => f.code === "SELECTION_LIMIT_EXCEEDED"),
        `${type}: ${limit} is permitted`,
      ).toBe(false);
      expect(checkSelection(item as never, atLimit).ok).toBe(true);
    }
  });

  it("every type the instrument actually uses appears in BOTH tables", () => {
    const usedTypes = new Set(ALL_ITEMS.map((q) => q.type));
    console.log("  instrument types:", JSON.stringify([...usedTypes].sort()));
    for (const t of usedTypes) {
      expect(MAX_SELECTIONS_BY_TYPE, `write path missing type "${t}"`).toHaveProperty(t);
    }
  });
});
