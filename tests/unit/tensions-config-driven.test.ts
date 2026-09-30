import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTensions } from "@/lib/assessment/tensions";

/**
 * Tension engine must be CONFIG-DRIVEN — PRD §15.
 *
 * PRD §15: "Implement thresholds as configuration, not hard-coded literals."
 *
 * An earlier version of `tensions.ts` imported no config at all: it defined 17
 * hand-written predicate functions with the state literals and thresholds baked
 * in, and referenced the config only in a comment claiming the logic "mirrors"
 * it. That is precisely the drift PRD §15 exists to prevent — recalibrating the
 * config would have changed nothing, silently.
 *
 * These tests assert the property directly: mutate a threshold in an in-memory
 * copy of the config and require the engine's OUTPUT to change. A test that
 * merely checked `import scoringDefaults from '.../scoring-v1.0.json'` would
 * pass on a module that imports the config and then ignores it.
 */

const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
);

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;

const itemsAt = (overrides: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 1; i <= 25; i++) out[`Q${i}`] = overrides[`Q${i}`] ?? 3;
  return out;
};

/**
 * Build a complete TensionInputs. `items` is a REQUIRED field of TensionInputs
 * — omitting it makes the evaluator throw a TypeError rather than return false,
 * so it is always supplied here.
 */
const baseInputs = (items: Record<string, number>) => ({
  signalStates: Object.fromEntries(SIGNALS.map((s) => [s, "S3"])) as never,
  items,
  activation: { A1: "MID", A2: "MID", A3: "MID", A4: "MID" } as never,
  tags: [] as string[],
  fearPresent: false,
});

const clone = () => JSON.parse(JSON.stringify(cfg));

describe("PRD §15 — thresholds are configuration, not literals", () => {
  it("changes behaviour when a threshold changes in config", () => {
    // All items mid (3). Under item_low "<= 2" nothing is low, so no friction
    // tension can fire. Widen the threshold to "<= 3" and mid counts as low.
    const items = itemsAt({});

    const before = evaluateTensions(baseInputs(items) as never, clone());

    const mutated = clone();
    mutated.tension_thresholds.item_low.value = "<= 3";
    const after = evaluateTensions(baseInputs(items) as never, mutated);

    expect(before).toEqual(["NO_MEANINGFUL_FRICTION_IDENTIFIED"]);
    expect(after).not.toEqual(before);
    expect(after).toContain("INFORMATION_OVERLOAD_PATTERN");
  });

  it("changes behaviour when a state band changes in config", () => {
    // HIGH_VISIBILITY_LOW_CAPACITY needs SEE in S4–S5 and ROOM in S1–S2.
    // Supply SEE=S4/ROOM=S1; it must fire. Then widen ROOM's trigger to accept
    // S3 and confirm the config is what decides.
    const items = itemsAt({});
    const inputs = {
      ...baseInputs(items),
      signalStates: { SEE: "S4", ROOM: "S1", DIRECT: "S3", PREPARE: "S3", AIM: "S3", MOVE: "S3" } as never,
    };
    expect(evaluateTensions(inputs as never, clone())).toContain(
      "HIGH_VISIBILITY_LOW_CAPACITY",
    );

    const mutated = clone();
    mutated.tensions.HIGH_VISIBILITY_LOW_CAPACITY.trigger.all[1].state_in = ["S3"];
    const widened = evaluateTensions(
      {
        ...baseInputs(items),
        signalStates: { SEE: "S4", ROOM: "S3", DIRECT: "S3", PREPARE: "S3", AIM: "S3", MOVE: "S3" } as never,
      } as never,
      mutated,
    );
    expect(widened).toContain("HIGH_VISIBILITY_LOW_CAPACITY");
  });

  it("throws when a referenced threshold is unresolvable — never silently defaults", () => {
    // A missing threshold must stop the engine, not pick a number. Guessing
    // here would change which participants receive which narrative.
    const broken = clone();
    delete broken.tension_thresholds.item_low;
    expect(() =>
      evaluateTensions(baseInputs(itemsAt({ Q23: 1, Q24: 1, Q25: 1 })) as never, broken),
    ).toThrow();
  });

  it("throws when the .tensions block is absent rather than returning empty", () => {
    // Returning [] would read as "no friction" — a silent, wrong success.
    const broken = clone();
    delete broken.tensions;
    expect(() => evaluateTensions(baseInputs(itemsAt({})) as never, broken)).toThrow(
      /tensions/,
    );
  });

  it("emits only codes present in the config's tension block", () => {
    // Guards against a code being emitted that the approved libraries cannot
    // render, which would reach a participant as an empty statement.
    const approved = new Set(Object.keys(cfg.tensions).filter((k) => !k.startsWith("_")));
    const probes: Array<Record<string, number>> = [
      { Q4: 5, Q5: 1 },
      { Q17: 5, Q19: 1 },
      { Q23: 5, Q24: 5, Q25: 1 },
      { Q20: 1, Q6: 5, Q22: 5 },
    ];
    for (const items of probes) {
      for (const code of evaluateTensions(baseInputs(itemsAt(items)) as never, clone())) {
        expect(approved.has(code), `emitted unapproved code "${code}"`).toBe(true);
      }
    }
  });
});
