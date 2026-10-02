import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Dead and duplicated config entries — an inventory that fails when it changes.
 *
 * WHY THIS EXISTS. Tracing the ~46 "configurable values" against their actual
 * readers found that several are not configurable at all: some are never loaded,
 * some are loaded and never referenced, and some have hardcoded twins in
 * TypeScript so editing the config does nothing.
 *
 * That is not a defect to fix silently — it is a fact the operator needs before
 * being asked to calibrate any of it. `docs/SPEC-TRACE-46.md` reports it, and
 * this test is what keeps the report true. Without it, someone wires up
 * `item_mid` next week and the document quietly becomes wrong in the direction
 * that matters least visibly.
 *
 * So the assertions below pin the CURRENT state. When one fails, the failure is
 * not "the test is stale" — it is "the inventory changed, so the document the
 * operator is deciding from changed too". Update both.
 *
 * The alternative was a comment saying "these are dead". Comments do not fail.
 */

const repo = resolve(__dirname, "../..");
const config = JSON.parse(
  readFileSync(resolve(repo, "config/scoring-v1.0.json"), "utf8"),
) as Record<string, unknown>;

/** Every file that could read a scoring-config key. */
const PRODUCTION = [
  "lib/assessment/scoring.ts",
  "lib/assessment/tensions.ts",
  "lib/assessment/overrides.ts",
  "lib/assessment/evidence-chain.ts",
  "lib/assessment/activation.ts",
  "lib/assessment/interpretation.ts",
  "lib/session/service.ts",
];

function source(rel: string): string {
  return readFileSync(resolve(repo, rel), "utf8");
}

function allProductionSource(): string {
  return PRODUCTION.map(source).join("\n");
}

describe("dead config entries stay declared as dead", () => {
  it("no threshold_ref names capacity_low or item_mid", () => {
    // Both have a `value` string, so loadTensionThresholds parses them into the
    // threshold map — and then `thresholdForRef` can never resolve them, because
    // it only resolves keys a trigger names. Loaded, then unreachable.
    const refs: string[] = [];
    (function walk(node: unknown) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "threshold_ref") refs.push(String(v));
          else walk(v);
        }
      }
    })(config);

    console.log(`  threshold_ref uses: ${refs.length}`);
    const distinct = [...new Set(refs)].sort();
    console.log(`  keys ever named: ${distinct.join(", ")}`);

    expect(
      refs.some((r) => r.includes("capacity_low")),
      "capacity_low is now referenced — SPEC-TRACE-46.md §2b and docs/CORRECTION-capacity-low.md say it is dead and must be updated",
    ).toBe(false);
    expect(
      refs.some((r) => r.includes("item_mid")),
      "item_mid is now referenced — update SPEC-TRACE-46.md §2b",
    ).toBe(false);
  });

  it("signal_high and signal_low still have no .value, so they are never loaded", () => {
    // Not the same as the two above: these lack a `value` string entirely, so
    // `if (typeof value !== 'string') continue` skips them BEFORE parsing.
    const tt = config.tension_thresholds as Record<string, Record<string, unknown>>;
    for (const key of ["signal_high", "signal_low"]) {
      expect(
        typeof tt[key]?.value,
        `${key} now has a .value, so it IS loaded — update the two-bucket distinction in SPEC-TRACE-46.md §2b`,
      ).not.toBe("string");
    }
    // And the contrast case, so this cannot pass by the map being empty.
    expect(typeof tt.item_high?.value).toBe("string");
  });

  it("capacity_low has exactly one production reader, and it is the override", () => {
    const hits = PRODUCTION.filter((f) => source(f).includes("capacity_low"));
    console.log(`  files reading capacity_low: ${hits.join(", ") || "(none)"}`);
    expect(
      hits,
      "capacity_low gained or lost a reader — the 'one live reader' claim is the whole correction",
    ).toEqual(["lib/assessment/overrides.ts"]);
  });

  it("the capacity tensions gate on signal states, not the threshold", () => {
    // This is why the "two loader" story was impossible: the tension side cannot
    // read a threshold it never references.
    const tensions = config.tensions as Record<string, { trigger?: unknown; condition?: unknown }>;
    for (const name of ["HIGH_DIRECTION_LOW_CAPACITY", "HIGH_VISIBILITY_LOW_CAPACITY"]) {
      const t = tensions[name];
      expect(t, `${name} is missing`).toBeTruthy();
      const shape = JSON.stringify(t.trigger ?? t.condition);
      expect(shape, `${name} no longer gates on state_in`).toContain("state_in");
      expect(shape, `${name} now uses threshold_ref — the correction is obsolete`).not.toContain(
        "threshold_ref",
      );
    }
  });
});

describe("config values with hardcoded twins are declared as such", () => {
  it("activation.level_bands is now WIRED, not shadowed", () => {
    // This test used to assert that activation.ts hardcoded the bands and never
    // read config — i.e. it documented the inert config rather than failing on
    // it. The operator's instruction was that "configuration must either
    // genuinely control behavior or cease pretending to be configurable", so the
    // key was wired instead. The old assertion would now fail, correctly.
    const act = source("lib/assessment/activation.ts").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    ).replace(/^\s*\/\/.*$/gm, "");

    // The default remains (callers without config still work) ...
    expect(act, "the default bands must exist for config-less callers").toMatch(
      /DEFAULT_LEVEL_BANDS/,
    );
    // ... but the resolver exists, and production passes config into it.
    expect(act, "resolveLevelBands is gone — the config would be inert again").toMatch(
      /export function resolveLevelBands/,
    );
    const service = source("lib/session/service.ts");
    expect(
      service,
      "service.ts no longer passes config bands — activation.level_bands would be inert again",
    ).toMatch(/resolveLevelBands\(/);

    // And the default must equal the shipped config, or config-less callers
    // would score differently from production.
    const bands = (config.activation as { level_bands: Record<string, string[]> }).level_bands;
    expect(bands.LOW).toEqual(["A", "B"]);
    expect(bands.MID).toEqual(["C"]);
    expect(bands.HIGH).toEqual(["D", "E"]);
  });

  it("LETTER_VALUES is GONE — the divergence was fixed, not documented", () => {
    // This test used to assert that LETTER_VALUES and profile_1_5 agreed on
    // shared letters, and that F was code-only. It was describing a LATENT TRAP
    // and passing — which is exactly what a test should not do with a defect.
    //
    // Investigating it properly showed the trap was live, not latent: the config
    // maps the capacity-override options to null to EXCLUDE them, and the
    // hardcoded map scored Q12_F as 5 — the highest agency value — for an answer
    // that says money lacks flexibility. The fix removed the twin entirely.
    //
    // So this now asserts the FIX. The old assertion would fail, correctly,
    // because the thing it described no longer exists.
    const src = source("lib/session/service.ts");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(
      code,
      "LETTER_VALUES is back — see docs/SPEC-TRACE-46.md §4 for why it was removed",
    ).not.toMatch(/LETTER_VALUES\s*[:=]/);

    // The scale now comes from config, through the extracted pure module.
    expect(code).toMatch(/numericItems\(letters,\s*tables\.values\)/);
    const optionValues = source("lib/assessment/option-values.ts");
    expect(optionValues, "the resolution logic moved to a pure, testable module").toMatch(
      /export function numericItems/,
    );
  });
});

describe("Group 1 rows describe work that does not exist yet", () => {
  it("there is still no PDF renderer, dependency, or storage call", () => {
    // Six rows in DECISIONS-REQUIRED.md's Group 1 are PDF/storage choices with no
    // implementation. If that work lands, those rows become real decisions and
    // the register must say so.
    const pkg = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      deps.filter((d) => /pdf/i.test(d)),
      "a PDF dependency appeared — the Group 1 rows are no longer hypothetical",
    ).toEqual([]);

    const prod = allProductionSource();
    expect(prod, "a signed-URL call appeared").not.toMatch(/createSignedUrl/);
  });
});
