import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Demographics / Participant Profile step must not touch the assessment.
 *
 * GOVERNING REQUIREMENTS (operator, 2026-10-01):
 *   * "State/Jurisdiction remains optional contextual/profile data and must have
 *      zero effect on scoring, interpretation, friction findings, Activation,
 *      Perception Gap, or the Set for Life Money Picture™."
 *   * "The Demographics / Participant Profile screen must not change the
 *      requirement of 31 required assessment responses before the Financial
 *      Snapshot."
 *   * "Preserve all previously approved Prefer not to say behavior and the
 *      established distinction between demographic/profile information and
 *      diagnostic responses."
 *
 * WHY THESE ARE STRUCTURAL ASSERTIONS. "It has no effect on scoring" is exactly
 * the kind of claim that quietly stops being true — someone adds a convenient
 * parameter, a config gains a field, and nothing reports the change. So these
 * read the engine's own source and the instrument config and prove the isolation,
 * rather than trusting that it was true when written.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

const bank = JSON.parse(read("config/assessment-v1.0.json")) as {
  opening: unknown[];
  questions: unknown[];
  activation: unknown[];
  demographics: Array<Record<string, unknown>>;
};

describe("the 31 required responses are unchanged", () => {
  it("completion still requires exactly the scored groups", () => {
    const required = bank.opening.length + bank.questions.length + bank.activation.length;
    console.log("  required:", required, "| demographics:", bank.demographics.length);
    expect(required).toBe(31);
    // And demographics is genuinely separate — not folded into the count.
    expect(required + bank.demographics.length).not.toBe(31);
  });

  it("no demographics item is required for completion", () => {
    // If one ever became required, the 31 would silently become 35 and a
    // participant could be blocked from their Snapshot by an optional question.
    for (const d of bank.demographics) {
      expect(d["required_for_completion"], `${d["internal_id"]} must not gate completion`).toBe(
        false,
      );
      expect(d["diagnostic"], `${d["internal_id"]} must not be diagnostic`).toBe(false);
      expect(d["internal_construct"]).toBeNull();
      expect(d["feeds"]).toBeNull();
      expect(d["scoring_behavior"]).toBe("no_diagnostic_effect");
    }
  });

  it("completion validation reads responses, not demographics", () => {
    // Assert the BEHAVIOUR, not the vocabulary. An earlier version of this test
    // required the word "demographic" to be absent from validation.ts — but that
    // file mentions demographics precisely to say they are EXCLUDED ("Demographics
    // (D1-D3) are NOT part of the 31 and must not affect..."), so the check
    // failed on the comment asserting the very property it was testing for.
    const validation = read("lib/assessment/validation.ts");

    // The required set is a literal list of the instrument's own ids plus an
    // explicit exclusion list naming the demographics — which is stronger
    // evidence than deriving it from groups. Read the ACTUAL export.
    const requiredBlock =
      validation.match(/REQUIRED_ITEM_IDS[\s\S]*?\]\);/)?.[0] ?? "";
    console.log(
      "  REQUIRED_ITEM_IDS:",
      JSON.stringify(requiredBlock.replace(/\s+/g, " ").slice(0, 100)),
    );
    expect(requiredBlock).toMatch(/OPEN_A/);
    expect(requiredBlock).toMatch(/OPEN_B/);
    expect(requiredBlock).toMatch(/A1/);
    // 25 diagnostic questions, expressed as a range rather than listed.
    expect(requiredBlock).toMatch(/length: 25/);
    // And no demographics id can be in it.
    expect(requiredBlock).not.toMatch(/'D\d/);

    // The exclusion is explicit, not merely absent — someone wrote down that
    // these exist on the instrument and are NOT counted.
    const excluded = validation.match(/EXCLUDED_FROM_COMPLETENESS[\s\S]*?\]\);/)?.[0] ?? "";
    console.log("  EXCLUDED_FROM_COMPLETENESS:", JSON.stringify(excluded.replace(/\s+/g, " ").slice(0, 80)));
    expect(excluded).toMatch(/'D1'/);

    // And the completion gate itself is the instrument one.
    const sessionService = read("lib/session/service.ts");
    expect(sessionService).toMatch(/validateCompleteness/);
  });
});

describe("ZERO EFFECT on the engine — asserted against the source", () => {
  it("no SCORING module consumes profile data", () => {
    // The modules that actually decide anything about a participant. Checked
    // individually rather than by scanning every file for a word, because two
    // engine files legitimately mention demographics:
    //
    //   lib/assessment/questions.ts — PROJECTS them as a separate group, which
    //     is the mechanism that keeps them out of the diagnostic set;
    //   lib/assessment/validation.ts — a comment stating they are excluded.
    //
    // Matching the word would fail on both while proving nothing about whether
    // profile data can influence an outcome. These files are the ones where a
    // leak would actually change a result.
    const scoringModules = [
      "lib/assessment/scoring.ts",
      "lib/assessment/tensions.ts",
      "lib/assessment/evidence-chain.ts",
      "lib/assessment/classifiers.ts",
      "lib/assessment/interpretation.ts",
      "lib/assessment/overrides.ts",
      "lib/assessment/activation.ts",
      "lib/assessment/perception-gap.ts",
      "lib/assessment/snapshot-payload.ts",
      "lib/session/service.ts",
    ];

    const offenders: string[] = [];
    for (const f of scoringModules) {
      const src = read(f);
      const hit = src.match(
        /demographic|state_code|jurisdiction|age_range|household_income|gender_self/i,
      );
      if (hit) offenders.push(`${f} (${hit[0]})`);
    }

    console.log("  scoring modules scanned:", scoringModules.length);
    expect(
      offenders,
      `profile data must not reach a scoring module: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("demographics are projected as a group SEPARATE from the diagnostic set", () => {
    // The positive half: it is not enough that scoring ignores them — the
    // projection must keep them out of the sequence the 31 is counted from.
    const projection = read("lib/assessment/questions.ts");
    expect(projection).toMatch(/demographics\??:/);
    const uiProjection = read("lib/ui/questions.ts");
    console.log("  QUESTION_SEQUENCE built from:", "opening + questions + activation");
    expect(uiProjection).toMatch(/QUESTION_BANK\.opening/);
    expect(uiProjection).toMatch(/QUESTION_BANK\.questions/);
    expect(uiProjection).toMatch(/QUESTION_BANK\.activation/);
    expect(uiProjection).not.toMatch(/QUESTION_BANK\.demographics/);
  });

  it("the Snapshot payload has no field that could carry profile data", () => {
    const payload = read("lib/assessment/snapshot-payload.ts");
    for (const banned of [
      "demographic",
      "state_code",
      "jurisdiction",
      "ageRange",
      "householdIncome",
      "gender",
    ]) {
      expect(payload, `payload must not carry ${banned}`).not.toContain(banned);
    }
  });

  it("the profile route writes no response row", () => {
    // A response row would make demographics part of the instrument and change
    // the 31 — the exact thing the requirement forbids.
    const route = read("app/api/participant/demographics/route.ts");
    expect(route).not.toMatch(/from\("responses"\)/);
    // It writes the profile table and the participant's state, nothing else.
    expect(route).toMatch(/from\("demographics"\)/);
    expect(route).toMatch(/from\("participants"\)/);
  });
});

describe("Prefer not to say is preserved on every question", () => {
  it("D1-D3 each offer it as an option", () => {
    for (const d of bank.demographics) {
      if (d["options_source"] === "jurisdictions") continue; // D4 checked below
      const opts = d["options"] as Array<{ label: string }>;
      const has =
        opts.some((o) => o.label.toLowerCase() === "prefer not to say") ||
        opts.some((o) => o.label.toLowerCase().startsWith("prefer to self-describe"));
      expect(has, `${d["internal_id"]} must offer a decline`).toBe(true);
    }
  });

  it("D4 offers it via the controlled list's sentinel, not an absence", () => {
    const d4 = bank.demographics.find((d) => d["internal_id"] === "D4")!;
    expect(d4["options_source"]).toBe("jurisdictions");
    const opts = d4["options"] as Array<{ code: string; label: string }>;
    expect(opts.some((o) => o.code === "D4_PREFER_NOT_TO_SAY")).toBe(true);
  });

  it("the screen renders a decline for every question it shows", () => {
    const screen = read("components/profile/DemographicsScreen.tsx");
    // D1-D3 render their config options directly...
    expect(screen).toMatch(/item\.options/);
    // ...and D4 appends the sentinel to the jurisdiction list.
    expect(screen).toMatch(/PREFER_NOT_TO_SAY/);
  });
});

describe("the profile step does not gate the Snapshot", () => {
  it("the screen always offers a path onward", () => {
    const screen = read("components/profile/DemographicsScreen.tsx");
    // A skip control that is always enabled — never disabled behind an answer.
    expect(screen).toMatch(/onSkip/);
    expect(screen).toMatch(/Skip for now/);
  });

  it("a save failure does not trap the participant", () => {
    // Losing an optional answer is not worth blocking results, and the error
    // copy says so.
    const page = read("app/(public)/assessment/[sessionId]/profile/page.tsx");
    expect(page).toMatch(/they are optional/);
  });

  it("the step sits before completion, because demographics freezes on it", () => {
    // trg_demographics_immutable fires on INSERT/UPDATE/DELETE once the session
    // is complete, so a profile write after completion would be refused.
    const immutability = read("supabase/migrations/20260930000002_immutability.sql");
    expect(immutability).toMatch(/trg_demographics_immutable/);
    expect(immutability).toMatch(/freeze_completed_derived/);

    const route = read("app/api/participant/demographics/route.ts");
    expect(route).toMatch(/status === "completed"/);
  });
});
