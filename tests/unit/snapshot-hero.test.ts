import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HERO_ALT,
  HERO_IMAGE,
  HERO_INTRINSIC,
  heroVariantForGender,
} from "@/lib/ui/snapshot-hero";
import assessmentConfig from "@/config/assessment-v1.0.json";

/**
 * THE HERO-SELECTION GUARD — the participant's EXPLICIT demographic gender, and
 * nothing else.
 *
 * WHY THIS FILE EXISTS. The Section 1 hero is the only place in the application
 * where a participant-visible difference is driven by a demographic answer, so
 * the mapping is the one rule in this phase that can produce a discrimination
 * defect rather than a cosmetic one. It shipped with no test: a mutation run
 * during visual QA found that changing `D2_B` to also match `D2_C` — i.e.
 * silently inferring from a self-describe answer — broke nothing, because there
 * was no test for the mapping at all. This file closes that.
 *
 * THE SPEC'S RULE, which these tests encode literally:
 *   "Female → approved Black woman hero; Male → approved Black man hero;
 *    Prefer not to say / missing / unsupported → approved neutral image ...
 *    Never infer gender from name, email, photo, age, or other data."
 */

const repo = resolve(__dirname, "../..");

describe("hero selection uses ONLY the explicit gender response", () => {
  it("maps the woman code to the female hero and the man code to the male hero", () => {
    expect(heroVariantForGender("D2_A"), "D2_A (Woman) must select the female hero").toBe("female");
    expect(heroVariantForGender("D2_B"), "D2_B (Man) must select the male hero").toBe("male");
  });

  it("maps every non-binary-explicit answer to NEUTRAL — never to a guess", () => {
    // D2_C is "Prefer to self-describe" and D2_D is "Prefer not to say". Reading a
    // self-description and choosing one of two photographs would be exactly the
    // inference the spec forbids, so BOTH are neutral.
    expect(heroVariantForGender("D2_C"), "self-describe must be neutral, never inferred").toBe(
      "neutral",
    );
    expect(heroVariantForGender("D2_D"), "prefer-not-to-say must be neutral").toBe("neutral");
  });

  it("treats missing, blank, and unsupported values as neutral rather than throwing", () => {
    // The hero must never be able to break a completed participant's Snapshot.
    for (const value of [null, undefined, "", "   ", "D2_Z", "female", "woman", "F", "1", "D2"]) {
      expect(
        heroVariantForGender(value as string | null | undefined),
        `unexpected input ${JSON.stringify(value)} must resolve to the neutral hero`,
      ).toBe("neutral");
    }
  });

  it("is TOTAL — every input returns one of the three shipped variants", () => {
    const inputs = [null, undefined, "", "D2_A", "D2_B", "D2_C", "D2_D", "junk", "🎈"];
    for (const v of inputs) {
      expect(["female", "male", "neutral"]).toContain(
        heroVariantForGender(v as string | null | undefined),
      );
    }
  });

  it("the codes it matches are the PINNED assessment config's own D2 codes", () => {
    // D2 is a DEMOGRAPHICS question, so it is NOT in the 31-item instrument
    // sequence that `questionById` searches — reading it through that accessor
    // returns undefined. It lives in the pinned assessment config, which is what
    // this reads.
    //
    // The point of the assertion: if the instrument's gender options are ever
    // renumbered, the hero mapping must not silently start reading the wrong
    // answer. This binds the mapping's two literals to the pinned config.
    const nodes: Array<{ internal_id?: string; options?: Array<{ code: string; label: string }> }> = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        const rec = o as { internal_id?: string };
        if (rec.internal_id === "D2") nodes.push(rec as never);
        Object.values(o as Record<string, unknown>).forEach(walk);
      }
    };
    walk(assessmentConfig);

    expect(nodes.length, "exactly one D2 node must exist in the pinned config").toBe(1);
    const options = nodes[0].options ?? [];
    const labelFor = (code: string) => options.find((o) => o.code === code)?.label ?? "";

    expect(options.map((o) => o.code)).toContain("D2_A");
    expect(options.map((o) => o.code)).toContain("D2_B");
    expect(labelFor("D2_A"), "D2_A must be the Woman option the ruling maps to female").toMatch(
      /woman/i,
    );
    expect(labelFor("D2_B"), "D2_B must be the Man option the ruling maps to male").toMatch(/^man$/i);
  });

  it("reads NO gender-bearing signal other than the D2 code", () => {
    // The self-describe free text must never be consulted, so a future edit
    // cannot quietly start reading a participant's own words to choose their
    // photograph. COMMENTS ARE STRIPPED FIRST: the module's header explains at
    // length WHY it does not read the field, and a substring scan over raw source
    // would flag that explanation — a false positive that would push a future
    // author to delete the reasoning to satisfy the test.
    const src = readFileSync(resolve(repo, "lib/ui/snapshot-hero.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(src, "the hero module must never read the self-describe field").not.toMatch(
      /gender_self_describe|selfDescribe/,
    );

    // Nor may it reach for any other participant attribute. Matched as WHOLE
    // WORDS: a plain substring scan flags "age" inside "package" and "managed",
    // which would make this guard fail for reasons unrelated to participant data
    // and train the next author to weaken it.
    for (const forbidden of ["first_name", "firstName", "email", "age_range", "household_income"]) {
      expect(
        src,
        `the hero module must not consult ${forbidden}`,
      ).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

describe("the hero assets are the approved production files", () => {
  it("each variant resolves to its own approved filename", () => {
    expect(HERO_IMAGE.female).toBe("/images/snapshot/section-01-hero-female-v1.png");
    expect(HERO_IMAGE.male).toBe("/images/snapshot/section-01-hero-male-v1.png");
    expect(HERO_IMAGE.neutral).toBe("/images/snapshot/section-01-hero-neutral-v1.png");
  });

  it("the three variants are three DISTINCT images", () => {
    // A copy-paste that pointed two variants at one file would otherwise make one
    // group invisible in the design with no failing test.
    const paths = Object.values(HERO_IMAGE);
    expect(new Set(paths).size, "the three hero variants must be three distinct files").toBe(3);
  });

  it("the declared intrinsic size matches the approved 1122x1402 master", () => {
    expect(HERO_INTRINSIC.width).toBe(1122);
    expect(HERO_INTRINSIC.height).toBe(1402);
  });

  it("the alternative text is IDENTICAL across variants — it never discloses the choice", () => {
    // One constant, used for every variant. If the alt text varied, a screen
    // reader would announce which photograph was chosen, leaking the
    // participant's demographic answer aloud. That property is enforced by there
    // being exactly one string — asserted here so a per-variant alt cannot be
    // introduced without failing.
    expect(typeof HERO_ALT).toBe("string");
    expect(HERO_ALT.length).toBeGreaterThan(0);
    const src = readFileSync(resolve(repo, "lib/ui/snapshot-hero.ts"), "utf8");
    const altDecls = src.match(/HERO_ALT\s*=/g) ?? [];
    expect(altDecls.length, "there must be exactly ONE hero alt declaration").toBe(1);
  });
});
