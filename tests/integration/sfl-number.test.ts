import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "Your Set for Life Number" — the participant-facing lookup identifier.
 *
 * Governs: Addendum 02 v1.1 §4, §4.2, §5, §14.
 *
 * WHY THIS FILE EXISTS.
 *
 * §4.2 is the load-bearing constraint: "The Grease the Wheel number is a
 * lookup/routing identifier, NOT a password. A participant must never gain
 * access to another person's prior financial assessment or Snapshot solely by
 * entering a known/guessed number."
 *
 * That makes this identifier unusual: it must be easy for a human to read and
 * re-enter, and simultaneously must NOT be a credential. Both properties are
 * easy to break by accident — a sequential number would leak participant volume
 * and be trivially enumerable, and treating it as authentication would expose
 * one participant's financial data to anyone holding another's number.
 *
 * These are STATIC assertions (this suite has no database). The BEHAVIOUR was
 * verified by execution against a real Postgres built from zero migrations:
 * 10,000 generated numbers all well-formed and distinct with no confusable
 * characters; all six adjacent transpositions detected by the check character;
 * every reasonable rendering (lowercase, no dash, spaces, en-dash, surrounding
 * whitespace) normalizing to one value; O/0 and I/L confusion folding to the
 * same record; the number stable across three sessions; and a direct UPDATE
 * refused. See the verification block in the migration header.
 */

const repo = resolve(__dirname, "../..");
const MIGDIR = resolve(repo, "supabase/migrations");
const FILE = "20261001000004_sfl_number.sql";

const migrations = readdirSync(MIGDIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGDIR, f), "utf8") }));

const sql = migrations.find((m) => m.name === FILE)?.sql ?? "";

describe("the Set for Life Number migration is present and ordered", () => {
  it("exists and applies after the initial schema", () => {
    console.log("  migrations:", JSON.stringify(migrations.map((m) => m.name)));
    expect(sql).not.toBe("");
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(FILE)).toBeGreaterThan(
      names.indexOf("20260930000001_initial_schema.sql"),
    );
  });

  it("adds the column to participants, NOT to sessions", () => {
    // §5: the number identifies the PERSON and must survive every session and
    // future assessment. Column-on-sessions would issue a new number each time.
    expect(sql).toMatch(/ALTER TABLE participants\s+ADD COLUMN IF NOT EXISTS sfl_number/);
    expect(sql).not.toMatch(/ALTER TABLE assessment_sessions[\s\S]*ADD COLUMN[^;]*sfl_number/);
  });
});

describe("§4: the identifier is not a UUID, email, phone, or a counter", () => {
  it("is generated randomly, never sequentially", () => {
    // A sequential number leaks participant volume to anyone holding one, and
    // makes candidate records trivially enumerable.
    expect(sql).toMatch(/gen_random_bytes/);
    expect(sql).toMatch(/generate_sfl_number/);
    // No sequence object and no MAX+1 pattern in the generator.
    expect(sql).not.toMatch(/CREATE SEQUENCE[\s\S]*sfl_number/i);
    expect(sql).not.toMatch(/generate_sfl_number[\s\S]{0,600}max\(/i);
  });

  it("excludes confusable characters (Crockford Base32: no I, L, O, U)", () => {
    // Participants read this off a screen and re-enter it later, possibly over
    // the phone. 0/O and 1/I/L are the dominant transcription error.
    const alpha = sql.match(/SELECT '([0-9A-Z]{32})'/)?.[1];
    console.log("  alphabet:", alpha);
    expect(alpha).toBeTruthy();
    expect(alpha).toHaveLength(32);
    for (const bad of ["I", "L", "O", "U"]) {
      expect(alpha, `alphabet must exclude ${bad}`).not.toContain(bad);
    }
  });

  it("uses the full 32-symbol space so modulo is unbiased", () => {
    // 256 % 32 === 0, so `get_byte(...) % 32` is uniform. A non-power-of-two
    // alphabet would silently bias the distribution.
    expect(sql).toMatch(/get_byte\([^)]*\)\s*%\s*32/);
  });

  it("reserves one character as a check, not extra entropy", () => {
    // 7 data + 1 check. The check exists so a mistyped number is rejected as
    // MALFORMED rather than submitted as a lookup that returns "no record".
    expect(sql).toMatch(/gen_random_bytes\(7\)/);
    expect(sql).toMatch(/sfl_number_check/);
  });
});

describe("§4: the check character detects the errors people actually make", () => {
  it("is position-weighted so adjacent transpositions are caught", () => {
    // With weights 1..7, swapping characters at positions i and i+1 changes the
    // sum by exactly (b - a) — so it is detected unless the two are identical.
    expect(sql).toMatch(/strpos\(v_alpha, substr\(p_body, v_i, 1\)\)/);
    expect(sql).toMatch(/\*\s*v_i/);
  });

  it("fails loudly on an out-of-alphabet body instead of returning a check", () => {
    // strpos returns 0 for an unknown character, making the sum -1 and yielding
    // a plausible-looking check for an invalid body. That would be a silent
    // correctness hole.
    expect(sql).toMatch(/v_sum < 0/);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*outside the alphabet/);
  });

  it("exports a validity check distinguishing malformed from not-found", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION is_valid_sfl_number/);
  });
});

describe("§4: lookup normalization accepts every reasonable rendering", () => {
  it("strips separators and folds Crockford confusions", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION normalize_sfl_number/);
    expect(sql).toMatch(/regexp_replace\(v, '\[\^0-9A-Z\]', '', 'g'\)/);
    // O->0, I/L->1 — applied AFTER upper(), or lowercase input would not fold.
    expect(sql).toMatch(/translate\(v, 'OIL', '011'\)/);
    const upperAt = sql.indexOf("upper(btrim(p_input))");
    const foldAt = sql.indexOf("translate(v, 'OIL', '011')");
    expect(upperAt).toBeGreaterThan(-1);
    expect(foldAt).toBeGreaterThan(upperAt);
  });
});

describe("§5: the number is permanent", () => {
  it("is only assigned when absent, never overwritten on insert", () => {
    expect(sql).toMatch(/IF NEW\.sfl_number IS NOT NULL AND btrim\(NEW\.sfl_number\) <> '' THEN/);
  });

  it("has a separate UPDATE guard, because the INSERT trigger protects nothing post-insert", () => {
    // Verified against a real database: with only the BEFORE INSERT trigger, a
    // direct `UPDATE participants SET sfl_number = ...` SUCCEEDED and silently
    // changed the participant's number — breaking both §5 and the promise the
    // participant is shown ("Keep this number").
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION protect_sfl_number/);
    expect(sql).toMatch(/CREATE TRIGGER trg_protect_sfl_number\s+BEFORE UPDATE ON participants/);
    expect(sql).toMatch(/NEW\.sfl_number IS DISTINCT FROM OLD\.sfl_number/);
  });

  it("permits a no-op rewrite so ordinary updates do not start failing", () => {
    // IS DISTINCT FROM (not <>) is what makes a same-value rewrite a no-op
    // rather than a NULL-comparison surprise.
    expect(sql).toMatch(/IS DISTINCT FROM/);
    expect(sql).not.toMatch(/NEW\.sfl_number\s*<>\s*OLD\.sfl_number/);
  });
});

describe("§4: lookup only — the number is never a credential", () => {
  it("the migration says so, so the next reader cannot mistake it for one", () => {
    expect(sql).toMatch(/lookup\/routing identifier, not a password/i);
    expect(sql).toMatch(/never sufficient authentication/i);
  });

  it("the participant-facing label is 'Set for Life Number', not the internal term", () => {
    // Operator decision: GTW / Grease the Wheel stays an internal business term
    // and must not reach participant UI. This migration only defines the data
    // layer, so the check is that no participant-facing string was introduced.
    expect(sql).not.toMatch(/COMMENT ON COLUMN[^;]*Grease the Wheel number[^;]*participant-facing/i);
    expect(sql).toMatch(/"Set for Life Number"/);
  });
});

describe("column constraints match §4's uniqueness requirement", () => {
  it("is NOT NULL and UNIQUE", () => {
    expect(sql).toMatch(/ALTER COLUMN sfl_number SET NOT NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_sfl_number/);
  });

  it("backfills before enforcing NOT NULL", () => {
    // Order matters: SET NOT NULL before the backfill would fail on any
    // pre-existing row, and a migration that only works on an empty database is
    // not a migration.
    const backfill = sql.indexOf("FOR r IN SELECT participant_id FROM participants WHERE sfl_number IS NULL");
    const notNull = sql.indexOf("ALTER COLUMN sfl_number SET NOT NULL");
    expect(backfill).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(backfill);
  });

  it("retries on collision rather than failing the participant's signup", () => {
    expect(sql).toMatch(/EXIT WHEN NOT EXISTS/);
    expect(sql).toMatch(/v_attempts >= 20/);
  });
});
