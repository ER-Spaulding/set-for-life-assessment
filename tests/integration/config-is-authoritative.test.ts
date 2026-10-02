import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadScoringTables } from "@/lib/assessment/scoring";
import { numericItems } from "@/lib/assessment/option-values";
import {
  DEFAULT_LEVEL_BANDS,
  levelForOption,
  resolveLevelBands,
} from "@/lib/assessment/activation";

/**
 * CONFIG IS AUTHORITATIVE — a change to configuration must reach every consumer.
 *
 * THE DEFECT THAT PROMPTED THIS FILE. `lib/session/service.ts` carried
 * `LETTER_VALUES = { A:1, B:2, C:3, D:4, E:5, F:5 }` while `scoring.ts` read
 * `option_value_maps.profile_1_5` from the config. Two sources for one scale,
 * and they disagreed: the config maps the capacity-override options to `null`
 * to EXCLUDE them (`Q11_A: null`, `Q12_F: null`), while the hardcoded map
 * invented `F: 5` — the highest value — for an option the config says carries no
 * numeric evidence at all.
 *
 * The damage was in corroboration. `confidenceFor()` counts a signal's
 * contributing items with `items[q] !== undefined`, and its own comment claimed
 * an item that "maps to null … is correctly absent from `items`, so it cannot
 * corroborate". That was false for `Q12_F`. A participant answering "there
 * usually isn't enough flexibility in my finances" had that answer counted as
 * numeric DIRECT evidence — and corroboration count selects the HIGH / MODERATE
 * / LIMITED verb of participant-facing sentences.
 *
 * WHAT THESE TESTS ASSERT is not "the numbers are right today" — that is what
 * the old tests already said, while the bug was live. They assert the WIRE: that
 * the config is the single source, and that editing it changes every path that
 * consumes it. A test that cannot fail on a config edit cannot prove that.
 */

const repo = resolve(__dirname, "../..");
const configPath = resolve(repo, "config/scoring-v1.0.json");

function loadConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

describe("the option-letter scale has exactly one source", () => {
  it("the hardcoded LETTER_VALUES twin is gone", () => {
    // Its absence is the fix. If it comes back, the split comes back with it.
    const src = readFileSync(resolve(repo, "lib/session/service.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "LETTER_VALUES is back — the hardcoded twin of option_value_maps must not be reintroduced",
    ).not.toMatch(/LETTER_VALUES\s*[:=]/);
  });

  it("numericItems reads from the loaded tables, not a literal", () => {
    const src = readFileSync(resolve(repo, "lib/session/service.ts"), "utf8");
    expect(src).toMatch(/numericItems\(letters,\s*tables\.values\)/);
  });

  it("an override option the config excludes stays OUT of the items map", () => {
    // The behaviour the corroboration comment always claimed.
    //
    // NOTE the key: `loadScoringTables` normalises "Q12_F" to the bare letter
    // "F" (it splits on "_" and takes the last segment). Asserting on "Q12_F"
    // would pass vacuously against `undefined` while proving nothing — which is
    // how the first version of this test got it wrong.
    const tables = loadScoringTables(loadConfig());
    expect(tables.values.q12?.["F"], "Q12_F is null in the config: excluded").toBe(null);
    expect(tables.values.q11?.["A"], "Q11_A is null in the config: excluded").toBe(null);
    // And the contrast, so this cannot pass on an empty map.
    expect(tables.values.q12?.["C"]).toBe(3);
    expect(tables.values.q11?.["B"]).toBe(2);
  });
});

describe("editing the config propagates to every consumer", () => {
  it("a changed profile scale changes the loaded tables", () => {
    // Proves the load path is live rather than shadowed.
    const cfg = loadConfig();
    const baseline = loadScoringTables(cfg);
    expect(baseline.values.profile["A"]).toBe(1);

    const mutated = loadConfig();
    (mutated.option_value_maps as Record<string, Record<string, unknown>>).profile_1_5 = {
      A: 2, B: 3, C: 4, D: 5, E: 5,
    };
    const after = loadScoringTables(mutated);

    expect(after.values.profile["A"], "config edit did not reach the loader").toBe(2);
    expect(after.values.profile["E"]).toBe(5);
    console.log(`  profile A: 1 -> ${after.values.profile["A"]} after config edit`);
  });

  it("an override re-added to the config brings the item back into numericItems", () => {
    // The inverse direction: the exclusion is config-driven, not hardcoded.
    // If someone decides Q12_F SHOULD carry a value, one config edit must be
    // enough — and this asserts the mechanism honours that.
    const cfg = loadConfig();
    const q12 = (cfg.option_value_maps as Record<string, Record<string, unknown>>)
      .Q12_capacity_override_last_else_1_5 as Record<string, unknown>;
    expect(q12["Q12_F"], "precondition: the config excludes Q12_F").toBe(null);

    // Simulate the config change the test is about.
    const mutated = loadConfig();
    (mutated.option_value_maps as Record<string, Record<string, unknown>>)
      .Q12_capacity_override_last_else_1_5 = { ...q12, Q12_F: 1 };
    const tables = loadScoringTables(mutated);

    // Normalised to the bare letter by the loader — see the note above.
    expect(
      tables.values.q12["F"],
      "the loader ignored a numeric Q12_F — the exclusion would be unremovable",
    ).toBe(1);
    console.log(`  Q12_F null -> ${tables.values.q12["F"]} after config edit`);
  });

  it("numericItems CONSUMES the tables it is given", () => {
    // THE TEST THAT WAS MISSING, and its absence was a false green.
    //
    // An earlier version of this file passed all ten tests while
    // `numericItems` had been mutated to ignore its `values` argument and use a
    // literal instead. Every other test here checks the SOURCE TEXT or the
    // LOADER — neither of which notices that the consumer threw the config away.
    //
    // So this calls the function directly with a fabricated scale. If the
    // implementation reads its argument, a fabricated value comes back out. If
    // it reads a literal, the fabrication is invisible.
    const fabricated = {
      profile: { A: 9, B: 9, C: 9, D: 9, E: 9 },
      q11: { A: null, B: 8, C: 8, D: 8, E: 8 },
      q12: { A: 7, B: 7, C: 7, D: 7, E: 7, F: null },
      q18: { A: 6, B: 6, C: 6, D: 6, E: 6 },
    } as unknown as Parameters<typeof numericItems>[1];

    const out = numericItems(
      { Q10: "A", Q11: "A", Q12: "F", Q18: "A", Q13: "B" },
      fabricated,
    );
    console.log(`  fabricated scales -> ${JSON.stringify(out)}`);

    // Values come from the fabricated tables, not from any literal.
    expect(out.Q10, "Q10 used the profile scale it was given").toBe(9);
    expect(out.Q18, "Q18 used its own scale").toBe(6);
    expect(out.Q13).toBe(9);
    // Excluded options stay out.
    expect(out.Q11, "Q11_A is null in the fabricated q11 map").toBeUndefined();
    expect(out.Q12, "Q12_F is null in the fabricated q12 map").toBeUndefined();
    // And the routing is real: Q18 did NOT fall through to `profile`.
    expect(out.Q18, "Q18 fell through to the profile scale").not.toBe(9);
  });

  it("the letter scale and the per-item maps are BOTH honoured", () => {
    // numericItems picks a scale per item: q11/q12/q18 have their own, the rest
    // use profile. This pins that routing, because applying `profile` to Q11/Q12
    // is exactly how Q11_A came to score 1.
    const tables = loadScoringTables(loadConfig());
    expect(tables.values.q11, "Q11 has its own map").toBeTruthy();
    expect(tables.values.q12, "Q12 has its own map").toBeTruthy();
    expect(tables.values.q18, "Q18 has its own map").toBeTruthy();
    // And they are genuinely different objects, not the same map three times.
    expect(tables.values.q11).not.toBe(tables.values.profile);
    expect(tables.values.q12).not.toBe(tables.values.profile);
  });
});

describe("activation bands are now driven by config, not a hardcoded twin", () => {
  it("activation.ts carries a DEFAULT that matches the shipped config", () => {
    // The bands used to be three frozen literals (LOW_LETTERS / MID_LETTERS /
    // HIGH_LETTERS) with `config.activation.level_bands` sitting unread beside
    // them. Now the config is passed in and the literals are only a fallback,
    // so a config edit actually moves the levels.
    //
    // The default must still equal the shipped config, or a caller that omits
    // bands (the pure tests, the acceptance harness) would score differently
    // from production.
    const cfg = loadConfig();
    const bands = (cfg.activation as { level_bands: Record<string, string[]> }).level_bands;

    expect(DEFAULT_LEVEL_BANDS.LOW).toEqual(bands.LOW);
    expect(DEFAULT_LEVEL_BANDS.MID).toEqual(bands.MID);
    expect(DEFAULT_LEVEL_BANDS.HIGH).toEqual(bands.HIGH);
    console.log(`  default == config: ${JSON.stringify(DEFAULT_LEVEL_BANDS)}`);
  });

  it("a CHANGED config band changes the resolved activation level", () => {
    // THE POINT OF THE WHOLE CHANGE. Under the old code this was impossible:
    // editing `level_bands` changed nothing, because a literal decided.
    const shipped = resolveLevelBands(undefined);
    expect(levelForOption("C", shipped), "precondition: C is MID").toBe("MID");

    // Move C into the HIGH band, as a calibration edit might.
    //
    // NOTE: MID is deliberately given a real value rather than an empty array.
    // An empty band is treated as malformed and falls back to the default
    // `["C"]` (see the next test), so `{MID: []}` would leave C as MID and this
    // assertion would fail for a reason that has nothing to do with the wiring.
    // The first version of this test made exactly that mistake.
    const edited = resolveLevelBands({ LOW: ["A"], MID: ["B"], HIGH: ["C", "D", "E"] });
    console.log(`  edited bands: ${JSON.stringify(edited)}`);
    expect(
      levelForOption("C", edited),
      "the config band was ignored — levelForOption is not consuming its argument",
    ).toBe("HIGH");
    expect(levelForOption("B", edited)).toBe("MID");
    expect(levelForOption("A", edited)).toBe("LOW");
  });

  it("an empty or malformed config band falls back rather than collapsing", () => {
    // A config that omits MID must not silently make C unclassifiable and throw
    // for every participant who answered C.
    const degraded = resolveLevelBands({ LOW: [], MID: undefined, HIGH: ["Z"] });
    console.log(`  degraded -> ${JSON.stringify(degraded)}`);
    expect(degraded.MID, "an empty MID band must fall back, not vanish").toEqual(["C"]);
    expect(levelForOption("C", degraded)).toBe("MID");
    // And a valid band is still honoured alongside the fallback.
    expect(degraded.HIGH).toEqual(["Z"]);
  });

  it("production callers pass the config bands through", () => {
    // The wiring half. A resolver that nothing calls is the same dead config in
    // a new costume.
    const service = readFileSync(resolve(repo, "lib/session/service.ts"), "utf8");
    const payload = readFileSync(resolve(repo, "lib/assessment/snapshot-payload.ts"), "utf8");
    console.log(
      `  service.ts calls resolveLevelBands: ${/resolveLevelBands\(/.test(service)}`,
    );
    console.log(
      `  snapshot-payload.ts calls resolveLevelBands: ${/resolveLevelBands\(/.test(payload)}`,
    );
    expect(service, "lib/session/service.ts does not resolve config bands").toMatch(
      /resolveLevelBands\(/,
    );
    expect(payload, "snapshot-payload.ts does not resolve config bands").toMatch(
      /resolveLevelBands\(/,
    );
  });
});

describe("no participant-facing behaviour changed for ordinary answers", () => {
  it("the old and new items maps agree on every A–E answer", () => {
    // THE BEHAVIOUR-PRESERVATION PROOF. The fix must change ONLY the override
    // options. For every letter a non-override item can produce, the outcome
    // must be byte-identical to the old hardcoded behaviour.
    const tables = loadScoringTables(loadConfig());
    const OLD = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };

    const resolveNew = (item: string, letter: string): number | undefined => {
      const scale =
        item === "Q11" ? tables.values.q11
        : item === "Q12" ? tables.values.q12
        : item === "Q18" ? tables.values.q18
        : tables.values.profile;
      const raw = scale?.[letter] ?? scale?.[`${item}_${letter}`];
      return typeof raw === "number" ? raw : undefined;
    };

    const divergences: string[] = [];
    for (const item of ["Q10", "Q13", "Q14", "Q17", "Q19", "Q20", "Q22", "Q23", "Q24", "Q25", "Q4", "Q5", "Q6", "Q18"]) {
      for (const letter of ["A", "B", "C", "D", "E"]) {
        const oldV = OLD[letter as keyof typeof OLD];
        const newV = resolveNew(item, letter);
        if (oldV !== newV) divergences.push(`${item}_${letter}: old=${oldV} new=${newV}`);
      }
    }
    console.log(`  checked 14 items x A-E against the old behaviour`);
    expect(
      divergences,
      `non-override answers changed meaning:\n${divergences.join("\n")}`,
    ).toEqual([]);
  });

  it("only the two override options behave differently, and both now exclude", () => {
    const tables = loadScoringTables(loadConfig());
    const OLD = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };

    const resolveNew = (item: string, letter: string): number | undefined => {
      const scale =
        item === "Q11" ? tables.values.q11
        : item === "Q12" ? tables.values.q12
        : tables.values.profile;
      const raw = scale?.[letter] ?? scale?.[`${item}_${letter}`];
      return typeof raw === "number" ? raw : undefined;
    };

    // Q11_A used to score 1 (the LOWEST agency) for a capacity answer.
    expect(OLD["A"], "precondition: the old map scored Q11_A as 1").toBe(1);
    expect(
      resolveNew("Q11", "A"),
      "Q11_A is a capacity answer and must carry no numeric agency evidence",
    ).toBeUndefined();

    // Q12_F used to score 5 (the HIGHEST agency) for a capacity answer.
    expect(OLD["F"], "precondition: the old map scored Q12_F as 5").toBe(5);
    expect(
      resolveNew("Q12", "F"),
      "Q12_F is a capacity answer and must carry no numeric agency evidence",
    ).toBeUndefined();

    // And the ordinary letters still resolve.
    expect(resolveNew("Q11", "B")).toBe(2);
    expect(resolveNew("Q12", "C")).toBe(3);
  });
});
