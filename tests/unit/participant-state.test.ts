import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  JURISDICTIONS,
  PREFER_NOT_TO_SAY,
  normalizeJurisdiction,
  jurisdictionName,
  isDeclined,
} from "@/lib/profile/jurisdiction";

/**
 * Optional participant State — contextual/profile data ONLY.
 *
 * GOVERNING REQUIREMENT (operator, 2026-10-01):
 *   "It must have zero effect on diagnostic scoring, the six Money Picture
 *    signals, friction determination, Perception Gap, Activation, or Snapshot
 *    interpretation. Declining to answer must never generate a diagnostic
 *    inference."
 *
 * THE ZERO-COUPLING TEST IS THE IMPORTANT ONE. Most of this file checks the list
 * and the normalisation, but the property that actually matters is that nothing
 * in the engine can see this field. That is asserted structurally — by reading
 * the engine's own source and proving no reference exists — rather than trusted,
 * because "it has no effect" is exactly the kind of claim that quietly stops
 * being true when someone adds a convenient parameter six months from now.
 */

const repo = resolve(__dirname, "../..");
const MIGDIR = resolve(repo, "supabase/migrations");
const MIGRATION = "20261001000006_participant_state.sql";

const migrations = readdirSync(MIGDIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGDIR, f), "utf8") }));

const sql = migrations.find((m) => m.name === MIGRATION)?.sql ?? "";

describe("the migration exists and is ordered", () => {
  it("is present and applies after the initial schema", () => {
    console.log("  migrations:", JSON.stringify(migrations.map((m) => m.name).slice(-4)));
    expect(sql).not.toBe("");
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(
      names.indexOf("20260930000001_initial_schema.sql"),
    );
  });
});

describe("ZERO EFFECT on the engine — asserted structurally, not promised", () => {
  it("no engine module references state_code or jurisdiction", () => {
    // The requirement is that State cannot influence scoring. If this fails,
    // someone has imported the jurisdiction module into the engine and the
    // zero-effect property is broken — which is a product decision, not a
    // refactor, so it should fail loudly rather than pass silently.
    const engineFiles = readdirSync(resolve(repo, "lib/assessment"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({
        name: `lib/assessment/${f}`,
        src: readFileSync(resolve(repo, "lib/assessment", f), "utf8"),
      }));
    engineFiles.push({
      name: "lib/session/service.ts",
      src: readFileSync(resolve(repo, "lib/session/service.ts"), "utf8"),
    });

    const offenders = engineFiles
      .filter((f) => /state_code|jurisdiction|lib\/profile/.test(f.src))
      .map((f) => f.name);

    console.log("  engine files scanned:", engineFiles.length);
    expect(offenders, `State data must not reach the engine: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the Snapshot payload has no field that could carry it", () => {
    const payload = readFileSync(resolve(repo, "lib/assessment/snapshot-payload.ts"), "utf8");
    expect(payload).not.toMatch(/state_code|jurisdiction/i);
  });

  it("State is NOT a demographics row — that table is frozen on completion", () => {
    // `demographics` is frozen by trg_demographics_immutable because it sits
    // adjacent to interpretation. State is explicitly not interpretation, so
    // putting it there would both misrepresent it and make later correction
    // impossible.
    expect(sql).toMatch(/ALTER TABLE participants[\s\S]*ADD COLUMN IF NOT EXISTS state_code/);
    expect(sql).not.toMatch(/ALTER TABLE demographics/);

    // Assert the property, not a phrasing. An earlier version of this test
    // required the literal string "FROZEN on session completion" and failed on
    // a migration that says the same thing in different words — the test was
    // wrong, not the migration. What matters is that the freeze it is avoiding
    // actually exists, so this checks the TRIGGER rather than a comment.
    const freeze = migrations
      .map((m) => m.sql)
      .join("\n")
      .match(/CREATE TRIGGER trg_demographics_immutable[\s\S]{0,120}/)?.[0];
    console.log("  demographics freeze:", JSON.stringify(freeze?.split("\n")[1]?.trim() ?? freeze));
    expect(freeze, "trg_demographics_immutable must exist for this reasoning to hold").toBeTruthy();
  });

  it("does not add an instrument item — the 31 is unchanged", () => {
    const assessment = JSON.parse(
      readFileSync(resolve(repo, "config/assessment-v1.0.json"), "utf8"),
    ) as {
      opening: unknown[];
      questions: unknown[];
      activation: unknown[];
      demographics: Array<Record<string, unknown>>;
    };
    const total =
      assessment.opening.length + assessment.questions.length + assessment.activation.length;
    console.log(
      "  instrument items:",
      total,
      "| demographics (separate step):",
      assessment.demographics.length,
    );
    expect(total).toBe(31);

    // The State item lives in `demographics`, which is a SEPARATE non-diagnostic
    // step and does not count toward the 31 — the same place D1-D3 live.
    const d4 = assessment.demographics.find((d) => d["internal_id"] === "D4");
    expect(d4, "D4 must exist in the demographics step").toBeTruthy();
    expect(d4!["diagnostic"]).toBe(false);
    expect(d4!["required"]).toBe(false);
    expect(d4!["required_for_completion"]).toBe(false);

    // It must not have become a scored instrument item. An earlier version of
    // this test scanned the WHOLE config for /state_code|jurisdiction/i, which
    // now trips on D4's own legitimate `options_source: "jurisdictions"` — the
    // check was too broad to distinguish a leak from the field itself. Scope is
    // the scored groups, which is where a leak would actually matter.
    const scored = JSON.stringify({
      opening: assessment.opening,
      questions: assessment.questions,
      activation: assessment.activation,
    });
    expect(scored).not.toMatch(/state_code|jurisdiction/i);
  });

  it("the route writes no response row and no consent row", () => {
    // A response row would change the 31 count; a consent row would imply
    // permission that was never given (UIUX §22A).
    const route = readFileSync(resolve(repo, "app/api/participant/state/route.ts"), "utf8");
    expect(route).not.toMatch(/from\("responses"\)/);
    expect(route).not.toMatch(/from\("communication_consents"\)/);
    expect(route).toMatch(/from\("participants"\)/);
  });
});

describe("declining never generates an inference", () => {
  it("normalises a decline to the SENTINEL, not null (operator 2026-10-01)", () => {
    // "'Prefer not to say' remains an explicit valid response, not null."
    // A refusal and an unanswered field are different facts; collapsing them
    // would make a decline indistinguishable from missing data.
    expect(normalizeJurisdiction(PREFER_NOT_TO_SAY)).toBe(PREFER_NOT_TO_SAY);
    expect(isDeclined(normalizeJurisdiction(PREFER_NOT_TO_SAY))).toBe(true);
  });

  it("keeps 'not asked' distinct from 'declined'", () => {
    // Empty / absent means the participant has not answered yet — which must not
    // be recorded as a refusal they never made.
    expect(normalizeJurisdiction("")).toBeNull();
    expect(normalizeJurisdiction("   ")).toBeNull();
    expect(normalizeJurisdiction(null)).toBeNull();
    expect(normalizeJurisdiction(undefined)).toBeNull();
    // ...and the two are genuinely different values.
    expect(normalizeJurisdiction("")).not.toBe(normalizeJurisdiction(PREFER_NOT_TO_SAY));
    expect(isDeclined(null)).toBe(false);
    expect(isDeclined(normalizeJurisdiction(""))).toBe(false);
  });

  it("null is a first-class value, not a gap the schema complains about", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS state_code TEXT/);
    // No NOT NULL, and no DEFAULT that would invent an answer.
    expect(sql).not.toMatch(/state_code TEXT NOT NULL/);
    expect(sql).not.toMatch(/state_code TEXT[^;]*DEFAULT/);
  });

  it("an unknown value is REJECTED, not silently recorded as a decline", () => {
    // The distinction that matters: returning null for a typo would store a
    // refusal the participant never made, corrupting the very data this field
    // exists to collect.
    expect(normalizeJurisdiction("California")).toBeUndefined();
    expect(normalizeJurisdiction("XX")).toBeUndefined();
    expect(normalizeJurisdiction("ZZ")).toBeUndefined();
    expect(normalizeJurisdiction(42)).toBeUndefined();
  });
});

describe("controlled selector, not free text", () => {
  it("normalises the renderings a participant might produce", () => {
    // The DB constraint rejects "  ca  " outright, so normalisation has to
    // happen before the write or a valid answer fails.
    for (const form of ["CA", "ca", "  CA  ", "\tCA\n"]) {
      expect(normalizeJurisdiction(form), `form: ${JSON.stringify(form)}`).toBe("CA");
    }
  });

  it("covers the 50 states plus DC", () => {
    const states = JURISDICTIONS.filter((j) => j.kind === "state");
    console.log("  states:", states.length, "| total jurisdictions:", JURISDICTIONS.length);
    expect(states).toHaveLength(50);
    expect(JURISDICTIONS.some((j) => j.code === "DC")).toBe(true);
  });

  it("includes territories, because 'jurisdiction' is broader than 'state'", () => {
    // Omitting them would silently make a Puerto Rico participant unable to
    // answer truthfully.
    const territories = JURISDICTIONS.filter((j) => j.kind === "territory").map((j) => j.code);
    console.log("  territories:", territories.join(", "));
    expect(territories).toEqual(expect.arrayContaining(["PR", "GU", "VI", "AS", "MP"]));
  });

  it("has no duplicate codes and no duplicate names", () => {
    const codes = JURISDICTIONS.map((j) => j.code);
    const names = JURISDICTIONS.map((j) => j.name);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
    // Every code is exactly two uppercase letters — what a licensing dataset
    // would key on.
    for (const c of codes) expect(c, `bad code: ${c}`).toMatch(/^[A-Z]{2}$/);
  });

  it("the TS list and the SQL seed agree exactly", () => {
    // Two sources of truth is a drift risk; this is the check that makes them
    // one. Parsed from the migration's seed rather than restated, so a change to
    // either side is caught.
    const seeded = [...sql.matchAll(/\('([A-Z]{2})','([^']+)','(state|district|territory)'/g)].map(
      (m) => ({ code: m[1], name: m[2], kind: m[3] }),
    );
    console.log("  seeded in SQL:", seeded.length, "| in TS:", JURISDICTIONS.length);
    expect(seeded).toHaveLength(JURISDICTIONS.length);
    expect(seeded.map((s) => s.code).sort()).toEqual(JURISDICTIONS.map((j) => j.code).sort());
    for (const s of seeded) {
      const ts = JURISDICTIONS.find((j) => j.code === s.code);
      expect(ts, `${s.code} missing from the TS list`).toBeTruthy();
      expect(ts!.name, `${s.code} name differs`).toBe(s.name);
      expect(ts!.kind, `${s.code} kind differs`).toBe(s.kind);
    }
  });

  it("enforces the list at the database, not only in the app", () => {
    expect(sql).toMatch(/ADD CONSTRAINT participants_state_code_fk/);
    expect(sql).toMatch(/FOREIGN KEY \(state_code\) REFERENCES jurisdictions\(code\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS jurisdictions/);
  });
});

describe("jurisdictionName", () => {
  it("resolves known codes and returns null otherwise", () => {
    expect(jurisdictionName("CA")).toBe("California");
    expect(jurisdictionName("PR")).toBe("Puerto Rico");
    expect(jurisdictionName("DC")).toBe("District of Columbia");
    expect(jurisdictionName(null)).toBeNull();
    expect(jurisdictionName("XX")).toBeNull();
  });
});

describe("the migration is idempotent and safe to re-apply", () => {
  it("guards every mutation", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/);
  });

  it("does not implement Addendum 03 assignment or licensing inference", () => {
    // Explicitly out of scope: the requirement says do not implement automatic
    // licensing-based assignment or infer legal eligibility from state.
    expect(sql).not.toMatch(/assign_agent|auto_assign|licensed_jurisdiction_of_participant/i);
    expect(sql).toMatch(/does NOT implement automatic licensing-based/i);
  });

  it("the migration file exists where the guard expects it", () => {
    expect(existsSync(resolve(MIGDIR, MIGRATION))).toBe(true);
  });
});
