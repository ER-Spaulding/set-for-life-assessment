import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tension trigger shape guards — PRD §15.
 *
 * These encode defects found by adversarial QC against the PRD text, so they
 * cannot silently regress.
 */

const scoring = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
) as {
  tensions: Record<string, { trigger?: unknown; connection_key?: string }>;
  comparator_semantics?: Record<string, string>;
  tension_precedence?: {
    when_identical?: string[];
    preferred_for_display?: string;
    _calibration_status?: string;
  };
  null_finding?: Record<string, unknown>;
};

const triggerOf = (code: string) =>
  scoring.tensions[code]?.trigger as Record<string, unknown[]> | undefined;

describe("PRD §15 — INFORMATION_OVERLOAD_PATTERN quantifier", () => {
  it("requires ALL THREE items weak, or the tag — not a single weak item", () => {
    // PRD §15 verbatim: "Q23 weak, Q24 weak, Q25 weak and/or Q21
    // information-overload tag."
    //
    // The original encoding put the three-item list inside the OUTER `any`.
    // With ALL semantics inside that list this would still have been correct,
    // but the shape made the intended grouping ambiguous and was read by QC as
    // firing on one weak item. The nesting is now explicit: the three-item
    // clause sits in its own `all` branch.
    const t = triggerOf("INFORMATION_OVERLOAD_PATTERN")!;
    expect(t.any, "top level is an any (three-weak OR tag)").toBeDefined();
    expect(t.any).toHaveLength(2);

    const [first, second] = t.any as Array<Record<string, unknown>>;
    expect(first.all, "first branch groups the three items under `all`").toBeDefined();

    const itemClause = (first.all as Array<Record<string, unknown[]>>)[0];
    expect(itemClause.item_lte).toEqual(["Q23", "Q24", "Q25"]);
    expect(second.tag_present).toEqual(["INFORMATION_OVERLOAD"]);
  });
});

describe("PRD §15 — comparator semantics are specified", () => {
  it("defines every condition type the triggers use", () => {
    // Six triggers depend on whether a list means ALL or ANY. Leaving that
    // undefined left the engine implementer to guess.
    const sem = scoring.comparator_semantics;
    expect(sem, "comparator_semantics block present").toBeDefined();
    for (const k of [
      "item_gte",
      "item_lte",
      "avg_lte",
      "signal",
      "tag_present",
      "tag_absent",
      "any_tag_present",
      "fear_present",
      "activation_high",
      "any_activation_high",
      "all",
      "any",
    ]) {
      expect(sem![k], `semantics for ${k}`).toBeTruthy();
    }
  });

  it("states ALL semantics for item_gte and item_lte", () => {
    // The engine implements these with Array.every(); the config must agree.
    expect(scoring.comparator_semantics!.item_gte).toMatch(/\bALL\b/);
    expect(scoring.comparator_semantics!.item_lte).toMatch(/\bALL\b/);
  });
});

describe("PRD §15 — identical-trigger precedence", () => {
  it("declares a tie-break for the byte-identical pair", () => {
    const a = JSON.stringify(triggerOf("HIGH_INFORMATION_LOW_ACTION"));
    const b = JSON.stringify(triggerOf("INFORMATION_EXECUTION_BOTTLENECK"));
    // The PRD defines these two near-identically, so they will co-fire.
    expect(a).toBe(b);

    const prec = scoring.tension_precedence;
    expect(prec, "tension_precedence block present").toBeDefined();
    expect(prec!.when_identical).toContain("HIGH_INFORMATION_LOW_ACTION");
    expect(prec!.when_identical).toContain("INFORMATION_EXECUTION_BOTTLENECK");
    expect(prec!.preferred_for_display).toBe("INFORMATION_EXECUTION_BOTTLENECK");
    // Must be flagged as an assumption, not presented as spec text.
    expect(prec!._calibration_status).toBe("ASSUMED_PENDING_OPERATOR_REVIEW");
  });
});

describe("PRD §18.3 — null finding links to its attention area", () => {
  it("points KEEP_OBSERVING at the null finding", () => {
    expect(scoring.null_finding?.attention_area).toBe("KEEP_OBSERVING");
  });
});
