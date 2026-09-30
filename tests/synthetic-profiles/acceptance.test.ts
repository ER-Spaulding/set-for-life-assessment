import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";

const scoringCfg = JSON.parse(readFileSync(resolve(__dirname,"../../config/scoring-v1.0.json"),"utf8"));
const tables = loadScoringTables(scoringCfg);
const S="E", W="A", M="C";
const base: Record<string,string> = { OPEN_A:"A",OPEN_B:"C",Q1:"A",Q2:"C",Q3:"C",Q4:M,Q5:M,Q6:M,
 Q7:M,Q8:M,Q9:"K",Q10:M,Q11:"C",Q12:"C",Q13:M,Q14:M,Q15:M,Q16:"A",
 Q17:M,Q18:M,Q19:M,Q20:"C",Q21:"H",Q22:"C",Q23:M,Q24:M,Q25:M,A1:"C",A2:"C",A3:"C",A4:"C" };
const run = (o: Record<string,string>) => scoreAssessment({...base,...o}, tables);

/**
 * Engine acceptance tests — PRD §29, executed end to end.
 *
 * Each test builds a synthetic 31-item profile, runs it through the real
 * deterministic engine, and asserts on the computed output. These are not
 * existence checks: the assertions below fail if the engine's arithmetic or
 * its override handling changes.
 *
 * The central one is TEST 10. PRD §29: given strong Visibility and constrained
 * Capacity, the engine "must not convert Capacity into low Agency without
 * Agency evidence." That is the product-integrity rule this engine exists to
 * protect — a capacity constraint is not a character judgement.
 */
describe("PRD §29 acceptance — end-to-end engine", () => {
  it("TEST 10: strong Visibility + weak Capacity must not drag DIRECT low", () => {
    const r = run({ Q4:S,Q5:S,Q6:S, Q7:W,Q8:W });
    console.log("  SEE:", r.signals.SEE.value, r.signals.SEE.displayState);
    console.log("  ROOM:", r.signals.ROOM.value, r.signals.ROOM.displayState);
    console.log("  DIRECT:", r.signals.DIRECT.value, r.signals.DIRECT.displayState);
    expect(r.signals.SEE.value!).toBeGreaterThanOrEqual(4);
    expect(r.signals.ROOM.value!).toBeLessThanOrEqual(2);
    expect(r.signals.DIRECT.value!, "DIRECT must not be dragged low by weak ROOM").toBeGreaterThan(2.5);
  });

  it("TEST 4: Q11_A + Q12_F -> DIRECT from Q10 only, LIMITED_DUE_TO_CAPACITY_CONTEXT", () => {
    const r = run({ Q10:S, Q11:"A", Q12:"F" });
    console.log("  DIRECT:", r.signals.DIRECT.value, "special:", r.directSpecial);
    console.log("  flags:", JSON.stringify(r.overrideFlags));
    expect(r.overrideFlags.Q11_CAPACITY_OVERRIDE).toBe(true);
    expect(r.overrideFlags.Q12_CAPACITY_OVERRIDE).toBe(true);
    expect(r.overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT).toBe(true);
    expect(r.directSpecial).toBe("DIRECT_LIMITED_EVIDENCE_CAPACITY");
    expect(r.signals.DIRECT.value).toBe(5); // Q10 alone = E = 5
  });

  it("TEST 2: Q11_A alone -> DIRECT from Q10+Q12, DIRECT_CAPACITY_LIMITED", () => {
    const r = run({ Q10:S, Q11:"A", Q12:S });
    console.log("  DIRECT:", r.signals.DIRECT.value, "special:", r.directSpecial);
    expect(r.overrideFlags.Q11_CAPACITY_OVERRIDE).toBe(true);
    expect(r.directSpecial).toBe("DIRECT_CAPACITY_LIMITED");
    expect(r.signals.DIRECT.value).toBe(5);
  });

  it("ACTIVATION SEPARATION: changing only A1-A4 leaves signals identical", () => {
    const a = run({ A1:"A",A2:"A",A3:"A",A4:"A" });
    const b = run({ A1:"E",A2:"E",A3:"E",A4:"E" });
    for (const k of ["SEE","ROOM","DIRECT","PREPARE","AIM","MOVE"] as const) {
      expect(b.signals[k].value, `${k} must not change with activation`).toBe(a.signals[k].value);
    }
  });

  it("MOVE subsignals preserved separately", () => {
    const r = run({ Q23:S, Q24:S, Q25:W });
    console.log("  MOVE:", r.signals.MOVE.value, "subsignals:", JSON.stringify(r.moveSubsignals));
    expect(r.moveSubsignals).toBeDefined();
    expect(r.signals.MOVE.value).toBeLessThan(5);
  });
});
