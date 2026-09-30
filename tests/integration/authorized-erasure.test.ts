import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Authorized erasure — the audit guard and participant deletion, reconciled.
 *
 * WHY THIS FILE EXISTS.
 *
 * Every child table cascades from `participants` / `assessment_sessions`,
 * EXCEPT `audit_events`, whose FKs are `ON DELETE SET NULL`. So deleting a
 * participant cascade-nulls audit references, `trg_audit_events_append_only`
 * raises on that UPDATE, and the entire delete fails:
 *
 *     ERROR: PRD §23.5/§24: audit_events is append-only
 *
 * A participant could NEVER be deleted once any audit row existed — blocking
 * every erasure request. Confirmed against a real Postgres.
 *
 * TWO ATTEMPTS AT THE GUARD FAILED, and both are recorded here because each
 * failure is a trap a future edit could fall into again:
 *
 *   1. "recent erasure_log row exists" with a bare timestamp OR — let person
 *      A's erasure authorize an UPDATE to person B's audit rows. A
 *      cross-participant hole.
 *   2. A strictly participant-scoped predicate alone — blocked EVERY erasure.
 *      Instrumented on a real cascade, the trigger saw `OLD.participant_id =
 *      NULL` with the session row already gone: Postgres nulls cascade FKs in
 *      an unspecified order, so the audit row has no reachable link back to the
 *      participant by the time the trigger fires.
 *
 * The shipped design sidesteps both: `erase_participant` severs the audit
 * references EXPLICITLY while it still knows the participant, so the cascade
 * never nulls anything and the guard keeps a strict, participant-scoped
 * predicate.
 *
 * These are STATIC assertions (the suite has no database). The behaviour —
 * unauthenticated delete refused, authorized erase succeeding, cross-participant
 * tampering refused, audit trail surviving de-identified — was verified by
 * execution against a real Postgres and is recorded in the ledger.
 */

const repo = resolve(__dirname, "../..");
const MIGDIR = resolve(repo, "supabase/migrations");
const ERASURE_FILE = "20260930000006_authorized_erasure.sql";

const migrations = readdirSync(MIGDIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGDIR, f), "utf8") }));
const allSql = migrations.map((m) => m.sql).join("\n");
const erasure = migrations.find((m) => m.name === ERASURE_FILE)?.sql ?? "";

describe("the erasure migration exists and is ordered last", () => {
  it("is present and applies after the initial schema", () => {
    console.log("  migrations:", JSON.stringify(migrations.map((m) => m.name)));
    expect(erasure).not.toBe("");
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(ERASURE_FILE)).toBeGreaterThan(
      names.indexOf("20260930000001_initial_schema.sql"),
    );
  });
});

describe("the audit guard keeps its default-deny shape", () => {
  it("DELETE is never permitted, authorized or not", () => {
    // The trail is permanent. An earlier design allowed an authorized UPDATE;
    // DELETE must remain unconditional.
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION audit_events_append_only\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
    );
    expect(fn, "the guard function must be redefined here").not.toBeNull();
    console.log("  guard body present, length", fn![0].length);
    expect(fn![0]).toMatch(/IF TG_OP = 'DELETE' THEN\s*RAISE EXCEPTION/i);
  });

  it("UPDATE still requires the transaction-local authorization flag", () => {
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION audit_events_append_only\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
    )![0];
    expect(fn).toMatch(/current_setting\('app\.erasure_authorized', true\)/);
    expect(fn).toMatch(/IS DISTINCT FROM 'on'/);
  });

  it("the authorization is SCOPED to the participant, not just to time", () => {
    // The specific hole from attempt 1. The trap is subtle enough to be worth
    // spelling out, because the FIRST version of this test missed it:
    //
    //   hole:    WHERE el.erased_at > now() - interval '5 minutes'
    //              OR el.participant_id = OLD.participant_id
    //   safe:    WHERE el.erased_at > now() - interval '5 minutes'
    //              AND ( el.participant_id = ... OR ... )
    //
    // Both mention the participant and both mention the timestamp — a test
    // looking for those substrings passes either way. The distinguishing
    // property is STRUCTURAL: the timestamp must be conjunctive (an AND term),
    // never one arm of a top-level OR, because then ANY recent erasure
    // authorizes an update to ANY participant's rows.
    //
    // So: strip the parenthesised group, and require that no top-level OR
    // remains in the WHERE clause. Nested ORs (inside the participant group)
    // are fine and expected — the participant is matched on either reference.
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION audit_events_append_only\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
    )![0];
    const predicate = fn.match(/IF NOT EXISTS \(([\s\S]*?)\) THEN/);
    expect(predicate, "the guard must contain an existence check").not.toBeNull();
    const body = predicate![1];
    console.log("  predicate:", JSON.stringify(body.replace(/\s+/g, " ").trim().slice(0, 200)));

    // It must bind to the participant, directly or via the session.
    expect(body).toMatch(
      /el\.participant_id = OLD\.participant_id|erasure_log\.participant_id = OLD\.participant_id/,
    );
    expect(body).toMatch(/interval '5 minutes'/);

    // Structural check: remove balanced parenthesised groups, then require the
    // remaining WHERE clause to contain no OR. Any OR that survives at the top
    // level is the hole.
    let stripped = "";
    let depth = 0;
    for (const ch of body) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0) stripped += ch;
    }
    console.log("  top-level (parens stripped):", JSON.stringify(stripped.replace(/\s+/g, " ").trim().slice(0, 160)));
    expect(
      stripped,
      "the timestamp must be ANDed, not OR-ed at the top level — a top-level OR lets any recent erasure authorize any participant's rows",
    ).not.toMatch(/\bOR\b/i);
    expect(stripped, "the WHERE must still be conjunctive").toMatch(/\bAND\b/i);
  });

  it("the authorization is time-bounded", () => {
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION audit_events_append_only\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
    )![0];
    expect(fn).toMatch(/interval '5 minutes'/);
  });
});

describe("erase_participant is the only sanctioned path", () => {
  it("exists, takes (uuid, reason, requested_by), and returns a summary", () => {
    expect(erasure).toMatch(/CREATE OR REPLACE FUNCTION erase_participant\(/);
    expect(erasure).toMatch(/p_participant_id UUID/);
    expect(erasure).toMatch(/p_reason\s+TEXT/);
    expect(erasure).toMatch(/p_requested_by\s+TEXT/);
  });

  it("REQUIRES a reason and an actor — an anonymous erasure is not permitted", () => {
    // §24: record why and by whom. Asserted as guards in the function body.
    expect(erasure).toMatch(/p_reason IS NULL OR length\(btrim\(p_reason\)\) = 0/);
    expect(erasure).toMatch(
      /p_requested_by IS NULL OR length\(btrim\(p_requested_by\)\) = 0/,
    );
  });

  it("severs the audit references EXPLICITLY, before the delete", () => {
    // This ordering is what lets the guard keep a strict participant-scoped
    // predicate. If the explicit UPDATE were removed, the cascade would null
    // the columns in an unspecified order and block every erasure (attempt 2).
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION erase_participant\([\s\S]*?\$\$ LANGUAGE plpgsql/,
    )![0];
    const updateAt = fn.indexOf("UPDATE audit_events");
    const deleteAt = fn.indexOf("DELETE FROM participants");
    const logAt = fn.indexOf("INSERT INTO erasure_log");
    console.log("  order — log:", logAt, "audit update:", updateAt, "delete:", deleteAt);
    expect(logAt, "must log before authorizing").toBeGreaterThan(-1);
    expect(updateAt, "must sever audit refs explicitly").toBeGreaterThan(-1);
    expect(deleteAt, "must delete the participant").toBeGreaterThan(-1);
    expect(logAt).toBeLessThan(updateAt);
    expect(updateAt).toBeLessThan(deleteAt);
  });

  it("matches audit rows on EITHER reference", () => {
    // Rows written by the session-status trigger carry session_id but NOT
    // participant_id (verified against a real completed session), so matching
    // on participant_id alone updates zero rows and then blocks the delete.
    const fn = erasure.match(
      /CREATE OR REPLACE FUNCTION erase_participant\([\s\S]*?\$\$ LANGUAGE plpgsql/,
    )![0];
    const upd = fn.slice(fn.indexOf("UPDATE audit_events"), fn.indexOf("DELETE FROM participants"));
    expect(upd, "must match by session").toMatch(/session_id IN/);
    expect(upd, "must match by participant").toMatch(/participant_id = p_participant_id/);
  });
});

describe("the erasure record is durable and tamper-proof", () => {
  it("erasure_log has no foreign key to participants", () => {
    // A record of the erasure must outlive the row it describes, so it cannot
    // be a cascading child.
    const table = erasure.match(/CREATE TABLE IF NOT EXISTS erasure_log \(([\s\S]*?)\n\);/);
    expect(table, "erasure_log must be declared").not.toBeNull();
    console.log("  erasure_log columns:", JSON.stringify(
      table![1].split("\n").map((l) => l.trim().split(/\s/)[0]).filter(Boolean),
    ));
    expect(table![1]).not.toMatch(/REFERENCES\s+participants/);
    expect(table![1]).not.toMatch(/REFERENCES/);
    expect(table![1]).toMatch(/participant_id UUID NOT NULL/);
  });

  it("erasure_log is append-only", () => {
    expect(erasure).toMatch(/CREATE OR REPLACE FUNCTION erasure_log_append_only/);
    expect(erasure).toMatch(
      /CREATE TRIGGER trg_erasure_log_append_only[\s\S]*?BEFORE UPDATE OR DELETE ON erasure_log/,
    );
  });

  it("erasure_log has RLS enabled with no permissive policy", () => {
    expect(erasure).toMatch(/ALTER TABLE erasure_log ENABLE ROW LEVEL SECURITY/);
    // No CREATE POLICY for it anywhere — service role only, like every other
    // participant table (migration ...0003 grants no anon/authenticated policy).
    expect(allSql).not.toMatch(/CREATE POLICY[\s\S]{0,80}ON erasure_log/i);
  });
});

describe("the routine is not callable by participants", () => {
  it("revokes PUBLIC, anon and authenticated", () => {
    expect(erasure).toMatch(
      /REVOKE ALL ON FUNCTION erase_participant\(UUID, TEXT, TEXT\) FROM PUBLIC/,
    );
    expect(erasure).toMatch(
      /REVOKE ALL ON FUNCTION erase_participant\(UUID, TEXT, TEXT\) FROM anon, authenticated/,
    );
  });

  it("runs SECURITY DEFINER so RLS does not depend on the caller", () => {
    expect(erasure).toMatch(/\$\$ LANGUAGE plpgsql SECURITY DEFINER/);
  });
});

describe("no migration re-opens the hole", () => {
  it("no later migration drops the erasure guards", () => {
    const idx = migrations.findIndex((m) => m.name === ERASURE_FILE);
    for (const m of migrations.slice(idx + 1)) {
      expect(m.sql, `${m.name} must not drop the audit guard`).not.toMatch(
        /DROP TRIGGER[^;]*trg_audit_events_append_only/i,
      );
      expect(m.sql, `${m.name} must not drop the erasure log guard`).not.toMatch(
        /DROP TRIGGER[^;]*trg_erasure_log_append_only/i,
      );
    }
  });
});
