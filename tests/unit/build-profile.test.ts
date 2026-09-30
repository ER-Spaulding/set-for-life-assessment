import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadQuestionBank, requiredItems } from "@/lib/assessment/questions";
import { REQUIRED_ITEM_IDS } from "@/lib/assessment/validation";
import {
  buildProfile,
  buildAllStrong,
  buildAllWeak,
  assertComplete,
  scoringInput,
} from "../synthetic-profiles/build-profile";

/**
 * Builder-shape guards — PRD §8 required model, §9 option inventory.
 *
 * This test pins the synthetic-profile builder to the REAL instrument: every
 * default the builder emits (letters and classifier codes) must exist in
 * config/assessment-v1.0.json, and the builder must cover exactly the 31
 * required items. The point is that option-letter direction is verified from
 * the config here, once — so the acceptance tests can reason about
 * "strong = E, weak = A" without re-verifying the inventory in every test.
 */

const raw = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
);
const bank = loadQuestionBank(raw);
const byId = new Map(requiredItems(bank).map((q) => [q.internal_id, q]));

describe("build-profile — covers exactly the 31 required items (PRD §8)", () => {
  it("REQUIRED_ITEM_IDS is OPEN_A + OPEN_B + Q1–Q25 + A1–A4", () => {
    expect(REQUIRED_ITEM_IDS).toHaveLength(31);
    expect(new Set(REQUIRED_ITEM_IDS).size).toBe(31);
    expect(REQUIRED_ITEM_IDS.slice(0, 2)).toEqual(["OPEN_A", "OPEN_B"]);
    expect(REQUIRED_ITEM_IDS.slice(-4)).toEqual(["A1", "A2", "A3", "A4"]);
    for (let n = 1; n <= 25; n++) {
      expect(REQUIRED_ITEM_IDS).toContain(`Q${n}`);
    }
  });

  it("a default profile answers all 31 and matches the bank's item set", () => {
    const p = buildProfile();
    expect(Object.keys(p.answers)).toHaveLength(31);
    expect(new Set(Object.keys(p.answers))).toEqual(new Set(REQUIRED_ITEM_IDS));
    expect(() => assertComplete(p)).not.toThrow();
    const bankIds = new Set(requiredItems(bank).map((q) => q.internal_id));
    expect(new Set([...bankIds])).toEqual(new Set(REQUIRED_ITEM_IDS));
  });
});

describe("build-profile — every default exists in the real bank (PRD §9)", () => {
  it("every default single-select letter is a real option in the config", () => {
    const p = buildProfile();
    for (const [id, q] of byId) {
      if (["Q1", "Q9", "Q16", "Q21"].includes(id)) continue;
      const letter = p.answers[id] as string;
      const bare = (code: string) =>
        code.includes("_") ? code.split("_").pop()! : code;
      const letters = q.options.map((o) => bare(o.code));
      expect(letters, `${id} must offer "${letter}"`).toContain(letter);
    }
  });

  it("every default classifier code is a real option code in the config", () => {
    const p = buildProfile();
    for (const id of ["Q1", "Q9", "Q16", "Q21"]) {
      const codes = (p.answers[id] as string[]).slice().sort();
      const real = byId
        .get(id)!
        .options.map((o) => o.code)
        .sort();
      for (const c of codes) {
        expect(real, `${id} must offer "${c}"`).toContain(c);
      }
    }
  });

  it("verified inventory: Q11 is A–E (A=override), Q12 is A–F (F=override)", () => {
    const bare = (code: string) =>
      code.includes("_") ? code.split("_").pop()! : code;
    expect(
      byId.get("Q11")!.options.map((o) => bare(o.code)).sort(),
    ).toEqual(["A", "B", "C", "D", "E"]);
    expect(
      byId.get("Q12")!.options.map((o) => bare(o.code)).sort(),
    ).toEqual(["A", "B", "C", "D", "E", "F"]);
    const q11a = byId.get("Q11")!.options.find((o) => o.code === "Q11_A")!;
    const q12f = byId.get("Q12")!.options.find((o) => o.code === "Q12_F")!;
    expect([q11a.label, q12f.label].join(" ")).toMatch(
      /isn'?t.*(money|flexibility)|enough/i,
    );
  });

  it("buildAllStrong / buildAllWeak emit only real options, with no overrides", () => {
    for (const p of [buildAllStrong(), buildAllWeak()]) {
      expect(() => assertComplete(p)).not.toThrow();
      for (const [id, v] of Object.entries(p.answers)) {
        if (["Q1", "Q9", "Q16", "Q21"].includes(id)) {
          const real = byId.get(id)!.options.map((o) => o.code);
          for (const c of v as string[]) expect(real).toContain(c);
        } else {
          const bare = (code: string) =>
            code.includes("_") ? code.split("_").pop()! : code;
          const letters = byId.get(id)!.options.map((o) => bare(o.code));
          expect(letters).toContain(v as string);
        }
      }
      // Neither convenience profile may select a capacity override.
      expect(p.answers.Q11).not.toBe("A");
      expect(p.answers.Q12).not.toBe("F");
    }
  });
});

describe("build-profile — malformed fixtures fail loudly", () => {
  it("throws on an unknown item id", () => {
    expect(() => buildProfile({ Q99: "A" })).toThrow(/unknown item id/);
  });

  it("throws when a single-select gets a classifier-style array", () => {
    expect(() => buildProfile({ Q4: ["Q4_A"] as never })).toThrow(
      /single bare option letter/,
    );
  });

  it("throws when a classifier gets a bare letter", () => {
    expect(() => buildProfile({ Q21: "G" })).toThrow(/full option codes/);
  });

  it("throws on an out-of-range letter", () => {
    expect(() => buildProfile({ Q4: "Z" })).toThrow(/single bare option letter/);
  });

  it("assertComplete throws when a required item is missing", () => {
    const p = buildProfile();
    delete (p.answers as Record<string, unknown>).Q4;
    expect(() => assertComplete(p)).toThrow(/missing required item\(s\): Q4/);
  });

  it("scoringInput drops classifiers and keeps only letter answers", () => {
    const p = buildProfile({ Q4: "E", Q21: ["Q21_G"] });
    const input = scoringInput(p);
    expect(input.Q4).toBe("E");
    for (const id of ["Q1", "Q9", "Q16", "Q21"]) {
      expect(input).not.toHaveProperty(id);
    }
  });
});
