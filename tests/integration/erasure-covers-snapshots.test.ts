import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Erasure must be able to remove a completed participant's Snapshot.
 *
 * WHY THIS FILE EXISTS.
 *
 * `snapshots_append_only()` raised on DELETE and UPDATE unconditionally. Since
 * `snapshots.session_id` cascades from `assessment_sessions`, deleting a
 * participant fired `DELETE FROM ONLY snapshots ...`, hit that guard, and
 * aborted the whole erasure:
 *
 *     BEFORE: participants=1, erasure_log=0
 *     AFTER:  participants=1, erasure_log=0
 *
 * Every participant who COMPLETED — the entire population holding results —
 * was permanently un-erasable.
 *
 * The defect was LATENT until Snapshot persistence shipped. While
 * `completeSession` wrote no snapshot row there was nothing to delete, and
 * `...0006`'s description of the cascade ("sessions, responses, computed
 * signals, tensions, overrides, snapshots, consents and contacts") read as
 * true. It was never true; it was untested. That is the write/read-convention
 * and wiring-half false-green pattern in one: the erasure path was verified
 * against a database state that could not exercise the code the moment it
 * mattered.
 *
 * These are STATIC assertions (this suite has no database). The BEHAVIOUR was
 * verified by execution against a real Postgres built from zero migrations —
 * 7/7 refusals holding, erasure cascading all tables, audit trail retained
 * de-identified, idempotent on re-run. See the verification block in the
 * migration header for the reproduction transcript.
 */

const repo = resolve(__dirname, "../..");
const MIGDIR = resolve(repo, "supabase/migrations");
const FIX_FILE = "20261001000002_erasure_covers_snapshots.sql";

const migrations = readdirSync(MIGDIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGDIR, f), "utf8") }));

const fix = migrations.find((m) => m.name === FIX_FILE)?.sql ?? "";

/** The body of `snapshots_append_only` as this migration defines it. */
const guard =
  fix.match(
    /CREATE OR REPLACE FUNCTION snapshots_append_only\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/,
  )?.[0] ?? "";

describe("the snapshots/erasure fix is present and ordered after the schema", () => {
  it("is a migration in the chain", () => {
    console.log("  migrations:", JSON.stringify(migrations.map((m) => m.name)));
    expect(fix).not.toBe("");
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(FIX_FILE)).toBeGreaterThan(
      names.indexOf("20260930000001_initial_schema.sql"),
    );
    // Must come after the erasure routine it replaces, or the old body wins.
    expect(names.indexOf(FIX_FILE)).toBeGreaterThan(
      names.indexOf("20260930000006_authorized_erasure.sql"),
    );
  });

  it("redefines the guard rather than dropping it", () => {
    // A DROP TRIGGER here would leave snapshots with no immutability at all —
    // trading an un-erasable participant for a mutable Snapshot.
    expect(guard).not.toBe("");
    expect(fix).not.toMatch(/DROP TRIGGER[^;]*trg_snapshots_append_only/i);
  });
});

describe("the snapshots guard keeps default-deny for ordinary deletes", () => {
  it("DELETE requires the transaction-local erasure flag", () => {
    // Mirrors the audit guard's condition 1. Without this the guard would
    // authorize a plain `DELETE FROM snapshots` from application code.
    expect(guard).toMatch(
      /current_setting\('app\.erasure_authorized',\s*true\)\s*IS DISTINCT FROM 'on'/,
    );
  });

  it("DELETE also requires a recent erasure_log row for THIS participant", () => {
    // Condition 2 is NOT decorative. A first draft of this fix argued the flag
    // alone was sufficient "because only the routine deletes snapshots" — and
    // that reasoning was falsified on a real Postgres:
    //
    //     begin; set_config('app.erasure_authorized','on',true);
    //     delete from snapshots where ...;   -->  DELETE 1
    //
    // A stray flag deleted a completed participant's Snapshot with no
    // erasure_log row in sight, which is exactly the hole ...0006 exists to
    // prevent ("neither a stray flag nor a stale audit row can erase anything
    // on its own").
    expect(guard).toMatch(/erasure_log/);
    expect(guard).toMatch(/el\.erased_at > now\(\) - interval '5 minutes'/);
    // Participant-scoped, and resolved through the session — `snapshots`
    // carries session_id, not participant_id, so a predicate keyed only on
    // participant_id would match nothing and block every erasure.
    expect(guard).toMatch(/el\.participant_id\s*=\s*\(/);
    expect(guard).toMatch(/FROM assessment_sessions s/);
    expect(guard).toMatch(/s\.session_id = OLD\.session_id/);
  });

  it("UPDATE is refused UNCONDITIONALLY — history is never rewritten", () => {
    // §22.5's actual guarantee. An erasure REMOVES personal data; it never
    // edits a stored Snapshot. The UPDATE branch must not be reachable by the
    // flag, or a "new report_version" could silently rewrite a completed
    // participant's results.
    //
    // Structural check, not a substring: strip comments, then require that the
    // UPDATE branch raises before any authorization test can precede it.
    const body = guard
      .replace(/--[^\n]*/g, "") // line comments
      .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
    // Everything after the DELETE branch's `END IF;` is the UPDATE path.
    const deleteBranchEnd = body.indexOf("RETURN OLD;");
    expect(deleteBranchEnd).toBeGreaterThan(-1);
    const updatePath = body.slice(deleteBranchEnd);
    expect(updatePath, "UPDATE path must raise").toMatch(/RAISE EXCEPTION/);
    expect(
      updatePath,
      "UPDATE path must not consult the erasure flag — it is never authorized",
    ).not.toMatch(/erasure_authorized/);
    expect(updatePath).not.toMatch(/erasure_log/);
  });
});

describe("snapshot_documents is guarded too, or the guard is bypassable", () => {
  it("is a leak that was verified, not a theoretical one", () => {
    // With snapshots guarded but its artifact records not, a plain
    // `DELETE FROM snapshot_documents` removed a completed participant's
    // generated-PDF record with no authorization at all. Guarding the parent
    // and not the child protects nothing: the cascade deletes child-first, so
    // an open child is an open door.
    expect(fix).toMatch(
      /CREATE TRIGGER trg_snapshot_documents_frozen[\s\S]*?BEFORE DELETE ON snapshot_documents/,
    );
    expect(fix).toMatch(/CREATE OR REPLACE FUNCTION snapshot_documents_frozen/);
  });

  it("does NOT freeze UPDATE — generation status transitions are a designed path", () => {
    // `snapshot_documents` moves pending -> succeeded/failed in the app, and
    // trg_snapshot_documents_updated_at touches updated_at. Freezing UPDATE
    // here would break PDF generation outright.
    const trigger = fix.match(
      /CREATE TRIGGER trg_snapshot_documents_frozen[\s\S]*?FUNCTION[^;]*;/,
    )?.[0];
    expect(trigger).toBeTruthy();
    expect(trigger).toMatch(/BEFORE DELETE/);
    expect(trigger, "must not fire on UPDATE").not.toMatch(/UPDATE/);
  });

  it("resolves the participant through snapshot -> session", () => {
    // This table carries neither participant_id nor session_id.
    expect(fix).toMatch(/FROM snapshots sn/);
    expect(fix).toMatch(/sn\.snapshot_id = OLD\.snapshot_id/);
  });
});

describe("erase_participant deletes the snapshot EXPLICITLY", () => {
  const routine =
    fix.match(
      /CREATE OR REPLACE FUNCTION erase_participant\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER;/,
    )?.[0] ?? "";

  it("removes snapshots before the participant row goes", () => {
    // Leaving this to the FK cascade is what broke erasure. Doing it in the
    // routine makes the removal an explicit, greppable step instead of an
    // invisible side effect of a foreign key — which is how ...0006's prose
    // came to claim coverage it did not have.
    expect(routine).not.toBe("");
    const deleteSnapshots = routine.search(/DELETE FROM snapshots/);
    const deleteDocuments = routine.search(/DELETE FROM snapshot_documents/);
    const deleteParticipants = routine.search(/DELETE FROM participants/);
    expect(deleteSnapshots).toBeGreaterThan(-1);
    expect(deleteSnapshots).toBeLessThan(deleteParticipants);
    expect(deleteDocuments).toBeGreaterThan(-1);
    expect(deleteDocuments).toBeLessThan(deleteParticipants);
  });

  it("deletes snapshot_documents BEFORE snapshots — cascade ordering is load-bearing", () => {
    // The child guard resolves the participant through
    // snapshot -> session. If the cascade were left to delete the documents it
    // fires BEFORE the parent snapshot row is gone... and the join finds
    // nothing and the guard raises on a perfectly authorized erasure. This was
    // observed on a real Postgres:
    //
    //     ERROR: PRD §24: deleting a snapshot document requires a recent
    //            erasure_log row FOR THIS PARTICIPANT (within 5 minutes)
    //
    // ...while erasing participant A with A's own erasure_log row present.
    //
    // This is the same trap ...0006 documents at lines 134-143: a guard must
    // never depend on the transient state of a cascade to decide whether an
    // authorized operation is authorized.
    const deleteDocuments = routine.search(/DELETE FROM snapshot_documents/);
    const deleteSnapshots = routine.search(/DELETE FROM snapshots/);
    expect(deleteDocuments).toBeGreaterThan(-1);
    expect(deleteSnapshots).toBeGreaterThan(-1);
    expect(deleteDocuments).toBeLessThan(deleteSnapshots);
  });

  it("inserts the erasure_log row BEFORE any guarded delete", () => {
    // Condition 2 of both guards. If the log row came after the deletes, every
    // guarded delete would raise and erasure would be impossible again.
    const logInsert = routine.search(/INSERT INTO erasure_log/);
    const armFlag = routine.search(/set_config\('app\.erasure_authorized',\s*'on'/);
    const deleteDocuments = routine.search(/DELETE FROM snapshot_documents/);
    expect(logInsert).toBeGreaterThan(-1);
    expect(armFlag).toBeGreaterThan(-1);
    expect(deleteDocuments).toBeGreaterThan(-1);
    expect(logInsert).toBeLessThan(deleteDocuments);
    expect(armFlag).toBeLessThan(deleteDocuments);
  });

  it("keeps its transaction-local flag, disarmed before return", () => {
    expect(routine).toMatch(/set_config\('app\.erasure_authorized',\s*'on',\s*true\)/);
    expect(routine).toMatch(/set_config\('app\.erasure_authorized',\s*'off',\s*true\)/);
    expect(routine).toMatch(/SECURITY DEFINER/);
  });

  it("keeps the reason/requested_by gates and the anon/authenticated revoke", () => {
    // §24: an erasure records why and by whom. The revokes keep the routine
    // off anon/authenticated — only the service role may call it.
    expect(routine).toMatch(/non-empty reason/);
    expect(routine).toMatch(/non-empty requested_by/);
    expect(fix).toMatch(
      /REVOKE ALL ON FUNCTION erase_participant\(UUID, TEXT, TEXT\) FROM anon, authenticated/,
    );
  });
});

describe("no later migration re-opens the hole", () => {
  it("nothing after the fix drops these guards or rewrites the guard function", () => {
    // The generalisation of ...0006's own check: the trap is a LATER migration
    // quietly restoring the unconditional raise, or dropping the child guard.
    const idx = migrations.findIndex((m) => m.name === FIX_FILE);
    for (const m of migrations.slice(idx + 1)) {
      expect(m.sql, `${m.name} must not drop the snapshots guard`).not.toMatch(
        /DROP TRIGGER[^;]*trg_snapshots_append_only/i,
      );
      expect(m.sql, `${m.name} must not drop the documents guard`).not.toMatch(
        /DROP TRIGGER[^;]*trg_snapshot_documents_frozen/i,
      );
      // A redefinition that reintroduces the unconditional raise on DELETE
      // would silently restore the defect, so the flag test must still be there.
      if (/CREATE OR REPLACE FUNCTION snapshots_append_only/i.test(m.sql)) {
        expect(
          m.sql,
          `${m.name} redefines snapshots_append_only() and must keep the authorization path`,
        ).toMatch(/erasure_authorized/);
      }
    }
  });

  it("the original ...0006 guard for audit_events is still intact", () => {
    // The fix must not have been achieved by weakening the neighbouring guard.
    const erasure = migrations.find(
      (m) => m.name === "20260930000006_authorized_erasure.sql",
    );
    expect(erasure?.sql).toMatch(/DELETE is never permitted/i);
  });
});
