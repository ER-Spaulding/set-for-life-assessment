import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";
import {
  AnswerPlanError,
  EXPECTED_RESPONSE_COUNT,
  assertPlanIsComplete,
  buildAnswerPlan,
  toRequestBody,
  type PlannedAnswer,
} from "../live/answer-plan";

/**
 * The live-QA answer plan — the Q24/Q25 defect, closed.
 *
 * OPERATOR FINDING (2026-10-01):
 *   "Treat the discovered slice(0,31) issue as a real test-harness defect.
 *    Verify that the authoritative assessment plan explicitly identifies the
 *    exact 31 required responses rather than relying on positional slicing of a
 *    larger collection. The test should fail if:
 *      - a required question is missing;
 *      - a non-required entry is substituted;
 *      - the count happens to equal 31 while the membership is wrong;
 *      - ordering changes cause required questions to disappear.
 *    Prefer validation by required question IDs/keys over array position alone."
 *
 * So this file does not assert that the plan is "31 long". It mutates the plan
 * into each of those four shapes and asserts the guard REFUSES it. A guard that
 * has never been seen to fail is a guard nobody has tested — the pattern this
 * repo has been bitten by repeatedly, most recently by a lifecycle test that
 * passed against a route with the gate removed.
 */

const repo = resolve(__dirname, "../..");
const planSource = readFileSync(resolve(repo, "tests/live/answer-plan.ts"), "utf8");

describe("the plan is derived from the application's own required list", () => {
  it("answers exactly the 31 items REQUIRED_ITEM_IDS names", () => {
    const plan = buildAnswerPlan();
    const ids = plan.map((p) => p.itemId);
    console.log(`  plan covers ${ids.length} items`);
    expect(new Set(ids)).toEqual(new Set(REQUIRED_ITEM_IDS));
    expect(plan).toHaveLength(EXPECTED_RESPONSE_COUNT);
  });

  it("Q24 and Q25 are present — the items the slice(0,31) defect dropped", () => {
    // Named explicitly because a count-only assertion would not have caught it:
    // the /tmp plan had 33 entries and sliced to 31, and the two it dropped were
    // Q24 and Q25. Asserting the specific ids is the point.
    const ids = buildAnswerPlan().map((p) => p.itemId);
    expect(ids).toContain("Q24");
    expect(ids).toContain("Q25");
  });

  it("does not carry the demographics that are excluded from the 31", () => {
    const ids = buildAnswerPlan().map((p) => p.itemId);
    for (const d of ["D1", "D2", "D3"]) {
      expect(ids, `${d} is excluded from completeness and must not be in the plan`).not.toContain(d);
    }
  });

  it("order follows REQUIRED_ITEM_IDS, so an instrument reorder cannot drop an item", () => {
    // The plan is built by WALKING the application's list rather than zipping
    // two independently ordered arrays. That is what makes the fourth failure
    // mode (ordering changes) structurally impossible rather than merely
    // currently-absent.
    const ids = buildAnswerPlan().map((p) => p.itemId);
    expect(ids).toEqual([...REQUIRED_ITEM_IDS]);
    // And it sources the list rather than restating it.
    expect(planSource, "the plan must import the application's required list").toMatch(
      /import\s*\{[^}]*REQUIRED_ITEM_IDS[^}]*\}\s*from\s*"@\/lib\/assessment\/validation"/,
    );
  });

  it("contains no positional slicing", () => {
    // The defect, named. A `slice` over an answers collection is how the count
    // and the membership came apart in the first place.
    const code = planSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the plan must not slice a larger collection positionally").not.toMatch(
      /\.slice\(\s*0\s*,\s*EXPECTED/,
    );
    expect(code).not.toMatch(/\.slice\(0,\s*31\)/);
  });
});

// ---------------------------------------------------------------------------

describe("the guard refuses every shape the operator named", () => {
  const good = buildAnswerPlan();

  it("FAILS when a required question is missing", () => {
    const mutated = good.filter((p) => p.itemId !== "Q24");
    console.log(`  dropped Q24 -> ${mutated.length} entries`);
    expect(() => assertPlanIsComplete(mutated)).toThrow(AnswerPlanError);
    expect(() => assertPlanIsComplete(mutated)).toThrow(/missing required item\(s\): Q24/);
  });

  it("FAILS when a non-required entry is substituted", () => {
    // Swap Q25 out for a demographic. The count is still 31 and Q25 is gone —
    // exactly the trade a count check cannot see.
    const mutated: PlannedAnswer[] = good
      .filter((p) => p.itemId !== "Q25")
      .concat([{ itemId: "D1", optionCodes: ["D1_A"] }]);
    console.log(`  Q25 -> D1, count still ${mutated.length}`);
    expect(mutated).toHaveLength(31);
    expect(() => assertPlanIsComplete(mutated)).toThrow(AnswerPlanError);
  });

  it("FAILS when the count is right but the membership is wrong", () => {
    // 31 entries, one duplicated, one missing. No count check can see this.
    const mutated: PlannedAnswer[] = good
      .filter((p) => p.itemId !== "Q24")
      .concat([{ itemId: "Q23", optionCodes: ["Q23_C"] }]);
    console.log(`  Q24 -> duplicate Q23, count still ${mutated.length}`);
    expect(mutated).toHaveLength(31);
    expect(() => assertPlanIsComplete(mutated)).toThrow(AnswerPlanError);
    expect(() => assertPlanIsComplete(mutated)).toThrow(/duplicate/i);
  });

  it("FAILS when duplicates give 31 entries over only 30 distinct items", () => {
    const mutated: PlannedAnswer[] = good.concat([
      { itemId: "Q1", optionCodes: ["Q1_B"] },
    ]).slice(1); // 31 entries, Q1 twice, OPEN_A dropped
    expect(mutated).toHaveLength(31);
    expect(() => assertPlanIsComplete(mutated)).toThrow(AnswerPlanError);
  });

  it("ACCEPTS the real plan — the guard is not simply always-throwing", () => {
    // The mutation-test counterpart. Every assertion above would also pass if
    // `assertPlanIsComplete` threw unconditionally, so this pins the other side.
    expect(() => assertPlanIsComplete(good)).not.toThrow();
    expect(() => buildAnswerPlan()).not.toThrow();
  });

  it("rejects an override for an item that is not required", () => {
    expect(() => buildAnswerPlan({ D1: ["D1_A"] })).toThrow(/not a required item/);
    expect(() => buildAnswerPlan({ Q99: ["Q99_A"] })).toThrow(/not a required item/);
  });

  it("rejects an empty override rather than posting nothing for an item", () => {
    expect(() => buildAnswerPlan({ Q1: [] })).toThrow(/non-empty option-code array/);
  });
});

// ---------------------------------------------------------------------------

describe("the planned answers are in the shape the response route accepts", () => {
  it("sends full option codes, never bare letters", () => {
    // THE BUG IN THE ORIGINAL HARNESS. It posted `optionCode: "Q1_C"` for some
    // items and a bare letter for others. `checkSelection` compares against
    // `q.options[].code`, so a bare "C" is an unknown code and the write is
    // refused with a 422 — a failure that looks like an application defect and
    // is not one.
    const plan = buildAnswerPlan();
    for (const answer of plan) {
      expect(Array.isArray(answer.optionCodes)).toBe(true);
      expect(answer.optionCodes.length).toBeGreaterThan(0);
      for (const code of answer.optionCodes) {
        expect(code, `${answer.itemId}: "${code}" must be a full option code`).toMatch(
          /^[A-Z0-9_]+_[A-Z]$/,
        );
      }
    }
  });

  it("the request body matches the route's contract", () => {
    const body = toRequestBody({ itemId: "Q1", optionCodes: ["Q1_B"] });
    expect(body).toEqual({ itemId: "Q1", optionCodes: ["Q1_B"] });
  });

  it("every planned code exists on its item in the REAL question bank", () => {
    // The end-to-end check that matters: a plausible-looking letter that is not
    // an option on its item would be refused by the route at run time. Loading
    // the real bank here makes the plan's validity a build-time fact.
    const cfg = JSON.parse(
      readFileSync(resolve(repo, "config/assessment-v1.0.json"), "utf8"),
    ) as {
      opening?: Array<{ internal_id: string; options?: Array<{ code: string }> }>;
      questions?: Array<{ internal_id: string; options?: Array<{ code: string }> }>;
      activation?: Array<{ internal_id: string; options?: Array<{ code: string }> }>;
    };
    const items = [...(cfg.opening ?? []), ...(cfg.questions ?? []), ...(cfg.activation ?? [])];
    const codesFor = new Map(items.map((q) => [q.internal_id, new Set((q.options ?? []).map((o) => o.code))]));

    const bad: string[] = [];
    for (const answer of buildAnswerPlan()) {
      const known = codesFor.get(answer.itemId);
      if (!known) {
        bad.push(`${answer.itemId}: item not in the bank`);
        continue;
      }
      for (const code of answer.optionCodes) {
        if (!known.has(code)) bad.push(`${answer.itemId}: "${code}" is not an option on this item`);
      }
    }
    console.log(`  checked ${buildAnswerPlan().length} planned answers against the bank`);
    expect(bad, `planned answers not present in the bank: ${bad.join("; ")}`).toEqual([]);
  });
});
