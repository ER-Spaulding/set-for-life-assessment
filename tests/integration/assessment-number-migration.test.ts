import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `assessment_number` must be SYSTEM-MANAGED, not defaulted.
 *
 * WHY THIS FILE EXISTS.
 *
 * The column was `NOT NULL DEFAULT 1` with `UNIQUE (participant_id,
 * assessment_number)`. The default gave the first session 1; every later
 * session also defaulted to 1 and the constraint rejected it:
 *
 *     ERROR: duplicate key value violates unique constraint
 *            "assessment_sessions_participant_id_assessment_number_key"
 *
 * So a returning participant could never start a second assessment. PRD §22.4
 * states the intended cardinality plainly — "participant 1→many
 * assessment_sessions" — so the column exists to distinguish repeat
 * assessments, and a constant default contradicts it.
 *
 * This is a STATIC test: it asserts the migration's shape, because the suite
 * has no database. The behaviour was verified by execution against a real
 * Postgres (three sessions numbered 1/2/3; a caller-supplied 99 stored as 4;
 * immutability of a completed session still enforced afterwards) and is
 * recorded in the ledger.
 *
 * Static assertions can rot into decoration, so each one below names the
 * specific way the fix could be undone.
 */

const repo = resolve(__dirname, "../..");
const MIGDIR = resolve(repo, "supabase/migrations");

const migrations = readdirSync(MIGDIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGDIR, f), "utf8") }));
const allSql = migrations.map((m) => m.sql).join("\n");

const FIX_FILE = "20260930000005_assessment_number_per_participant.sql";

describe("the assessment_number fix is present", () => {
  it("a migration exists for it, ordered after the initial schema", () => {
    const names = migrations.map((m) => m.name);
    console.log("  migrations:", JSON.stringify(names));
    expect(names).toContain(FIX_FILE);
    expect(names.indexOf(FIX_FILE)).toBeGreaterThan(
      names.indexOf("20260930000001_initial_schema.sql"),
    );
  });

  it("it REMOVES the default that caused the collision", () => {
    // The initial schema declares DEFAULT 1; the fix drops it. Both facts must
    // hold — if the schema never had the default, this test's premise is wrong;
    // if the fix never drops it, later sessions still collide.
    // INTEGER, not INT — and it carries a CHECK (>= 1) which the trigger must
    // keep satisfying (it assigns MAX+1, starting at 1).
    expect(allSql).toMatch(
      /assessment_number\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1/i,
    );
    const fix = migrations.find((m) => m.name === FIX_FILE)!.sql;
    expect(fix).toMatch(
      /ALTER TABLE assessment_sessions\s+ALTER COLUMN assessment_number DROP DEFAULT/i,
    );
  });

  it("the CHECK (assessment_number >= 1) still holds for what the trigger assigns", () => {
    // MAX(NULL->0) + 1 = 1 for a first session, so the floor is respected.
    // Asserted because a trigger assigning 0 would fail the CHECK at runtime —
    // and this static test is the only place that would notice without a DB.
    expect(allSql).toMatch(/CHECK \(assessment_number >= 1\)/i);
    const fix = migrations.find((m) => m.name === FIX_FILE)!.sql;
    expect(fix).toMatch(/COALESCE\(MAX\(assessment_number\),\s*0\)\s*\+\s*1/i);
  });

  it("it assigns the next per-participant number in a BEFORE INSERT trigger", () => {
    const fix = migrations.find((m) => m.name === FIX_FILE)!.sql;
    // BEFORE INSERT (so the value exists before the UNIQUE check).
    expect(fix).toMatch(/BEFORE INSERT ON assessment_sessions/i);
    expect(fix).toMatch(/CREATE TRIGGER trg_assign_assessment_number/i);
    // Scoped to ONE participant and monotonic.
    expect(fix).toMatch(/MAX\(assessment_number\)/i);
    expect(fix).toMatch(/WHERE participant_id = NEW\.participant_id/i);
    // Always recomputed, so a caller cannot supply a colliding or skipped value.
    expect(fix).toMatch(/INTO NEW\.assessment_number/i);
  });

  it("it is idempotent — re-running migrations must not fail", () => {
    const fix = migrations.find((m) => m.name === FIX_FILE)!.sql;
    // CREATE OR REPLACE for the function, DROP TRIGGER IF EXISTS for the trigger.
    expect(fix).toMatch(/CREATE OR REPLACE FUNCTION assign_assessment_number/i);
    expect(fix).toMatch(/DROP TRIGGER IF EXISTS trg_assign_assessment_number/i);
  });

  it("no migration RE-ADDS a default to assessment_number", () => {
    // The specific way this fix could silently be undone.
    const fixIdx = migrations.findIndex((m) => m.name === FIX_FILE);
    const later = migrations.slice(fixIdx + 1);
    for (const m of later) {
      expect(
        m.sql,
        `${m.name} must not re-add a default to assessment_number`,
      ).not.toMatch(/assessment_number[^;]*SET DEFAULT/i);
    }
  });
});

describe("the route does not supply the number (the trigger owns it)", () => {
  const routeSrc = readFileSync(resolve(repo, "app/api/session/route.ts"), "utf8");

  it("POST /api/session omits assessment_number entirely", () => {
    // If the route started sending one, it would bypass the trigger's
    // guarantee and could collide. The route's insert object is the place to
    // check.
    const insert = routeSrc.match(
      /from\("assessment_sessions"\)[\s\S]{0,400}?\.insert\(\{([\s\S]*?)\n\s*\}\)/,
    );
    expect(insert, "could not locate the session insert").not.toBeNull();
    console.log("  insert body:", JSON.stringify(insert![1].replace(/\s+/g, " ").trim()));
    expect(insert![1]).not.toMatch(/assessment_number/);
    // And it still sets the fields it should.
    for (const col of ["participant_id", "assessment_version", "status", "current_position"]) {
      expect(insert![1], `insert should set ${col}`).toContain(col);
    }
  });
});
