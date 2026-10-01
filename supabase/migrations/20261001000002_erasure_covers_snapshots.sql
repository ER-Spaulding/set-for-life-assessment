-- ============================================================================
-- Erasure must be able to remove a completed participant's Snapshot.
--
-- Governs: PRD §22.5 (assessment immutability), §24 (retention/deletion),
--          §22.2 (identity separation).
--
-- SUPERSEDES a claim made in ...0006_authorized_erasure.sql. That migration's
-- header states the cascade removes "sessions, responses, computed signals,
-- tensions, overrides, snapshots, consents and contacts". Every one of those was
-- true EXCEPT `snapshots` — and it was true only because no snapshot row had
-- ever existed when it was written. §28 note: where two statements conflict, the
-- newest wins; the earlier prose is left unedited as applied history.
--
-- THE DEFECT, reproduced against a real Postgres on a database built from zero.
--
-- `snapshots_append_only()` raised on DELETE and UPDATE UNCONDITIONALLY:
--
--     BEGIN
--       RAISE EXCEPTION 'PRD §22.5: snapshots are append-only; ...';
--       RETURN NULL;
--     END;
--
-- `snapshots.session_id` is a FK to assessment_sessions ON DELETE CASCADE, so
-- deleting a participant fires:
--
--     DELETE FROM ONLY "public"."snapshots" WHERE session_id = $1
--
-- which hits that guard and aborts the whole erasure:
--
--     ERROR: PRD §22.5: snapshots are append-only; new versions INSERT, history
--            is never rewritten
--     CONTEXT: PL/pgSQL function snapshots_append_only() line 3 at RAISE
--              SQL statement "DELETE FROM ONLY "public"."snapshots" ..."
--              SQL statement "DELETE FROM participants WHERE ..."
--
--     BEFORE: participants=1, erasure_log=0
--     AFTER:  participants=1, erasure_log=0     <- nothing erased, clean rollback
--
-- This was LATENT until Snapshot persistence shipped (...0001). While
-- `completeSession` never wrote a snapshot row there was nothing to delete, and
-- the path appeared to work. The moment a participant COMPLETED they became
-- permanently un-erasable — and the participants who complete are precisely the
-- ones holding results. A §24 erasure request from any real participant would
-- have failed.
--
-- It is the same conflict class ...0006 already resolved for `audit_events`: an
-- unconditional immutability guard on a table a sanctioned erasure must reach.
-- That migration solved it with a transaction-local flag PLUS a required
-- participant-scoped erasure_log row, "so neither a stray flag nor a stale audit
-- row can erase anything on its own". This migration reuses that mechanism
-- exactly, so there is still ONE convention.
--
-- WHY THE SECOND CONDITION IS NOT OPTIONAL HERE. The first draft of this
-- migration argued the flag alone was sufficient, on the reasoning that a
-- snapshot DELETE could only ever come from the routine or the cascade. That
-- reasoning was tested and FALSIFIED:
--
--     begin; set_config('app.erasure_authorized','on',true);
--     delete from snapshots where ...;   -->  DELETE 1
--
-- A stray flag — set by application code, a future migration, or a copy-pasted
-- snippet with no erasure_log row in sight — deleted a completed participant's
-- Snapshot outright. That is the exact hole ...0006 exists to prevent, so the
-- participant-scoped condition is required, not decorative.
--
-- WHAT IS PRESERVED.
--
-- §22.5 protects the historical Snapshot from being silently REWRITTEN. An
-- erasure is not silent rewriting: it is explicit, authorized, reason-bearing,
-- and itself recorded in erasure_log — the correction process §24 requires. The
-- asymmetry below is the actual guarantee:
--
--     UPDATE  -> still refused, UNCONDITIONALLY. History is never rewritten.
--     DELETE  -> refused unless BOTH (a) the flag is on AND (b) a recent
--                erasure_log row exists for the participant who owns the
--                snapshot's session.
--
-- An erasure REMOVES personal data; it never edits a stored Snapshot. A
-- `DELETE FROM snapshots` from application code still raises exactly as before.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- snapshots — default deny, with one fully-qualified authorized deletion path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshots_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Condition 1: transaction-local authorization, set only by
    -- erase_participant(). Cannot leak past COMMIT, cannot be set by another
    -- session.
    IF current_setting('app.erasure_authorized', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'PRD §22.5: snapshots are append-only; history is never deleted'
        USING HINT =
          'If this is an authorized participant erasure, call erase_participant(uuid, text, text) — do not delete snapshots directly.';
    END IF;

    -- Condition 2: a recent erasure_log row FOR THIS PARTICIPANT. Mirrors
    -- audit_events_append_only's predicate, including resolving the session to
    -- its participant — `snapshots` carries session_id, not participant_id.
    -- Deliberately evaluated against the session row rather than the cascade's
    -- transient state: this runs BEFORE the participant DELETE, so the session
    -- is still present and the lookup is well-defined. (A guard that depended on
    -- cascade order is what blocked every erasure in ...0006; see its lines
    -- 134-143.)
    IF NOT EXISTS (
      SELECT 1
      FROM erasure_log el
      WHERE el.erased_at > now() - interval '5 minutes'
        AND el.participant_id = (
          SELECT s.participant_id
          FROM assessment_sessions s
          WHERE s.session_id = OLD.session_id
        )
    ) THEN
      RAISE EXCEPTION
        'PRD §24: deleting a snapshot requires a recent erasure_log row FOR THIS PARTICIPANT (within 5 minutes)';
    END IF;

    RETURN OLD;
  END IF;

  -- UPDATE stays unconditional. §22.5: "new versions INSERT, history is never
  -- rewritten." An erasure removes the row; it has no update path at all.
  RAISE EXCEPTION 'PRD §22.5: snapshots are append-only; new versions INSERT, history is never rewritten';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION snapshots_append_only() IS
  'PRD §22.5/§24: snapshots are never UPDATEd. DELETE requires app.erasure_authorized = ''on'' AND a recent erasure_log row for the owning participant.';

-- ----------------------------------------------------------------------------
-- snapshot_documents — same authorization, or the guard is trivially bypassed.
--
-- Verified leak before this existed: with snapshots guarded but its artifact
-- records not, a plain `DELETE FROM snapshot_documents` removed a completed
-- participant's generated-PDF record with no authorization at all. Guarding one
-- and not the other protects nothing — the cascade deletes child-first, so an
-- open child is an open door.
--
-- DELETE only. UPDATE is a designed path on this table — generation status moves
-- pending -> succeeded/failed via the app (and trg_snapshot_documents_updated_at
-- touches updated_at) — so freezing UPDATE here would break PDF generation.
--
-- The participant is reached via snapshot -> session, since this table carries
-- neither participant_id nor session_id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshot_documents_frozen()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.erasure_authorized', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'PRD §22.5/§24: snapshot_documents rows are removed only by an authorized erasure'
      USING HINT =
        'If this is an authorized participant erasure, call erase_participant(uuid, text, text).';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM erasure_log el
    WHERE el.erased_at > now() - interval '5 minutes'
      AND el.participant_id = (
        SELECT s.participant_id
        FROM snapshots sn
        JOIN assessment_sessions s ON s.session_id = sn.session_id
        WHERE sn.snapshot_id = OLD.snapshot_id
      )
  ) THEN
    RAISE EXCEPTION
      'PRD §24: deleting a snapshot document requires a recent erasure_log row FOR THIS PARTICIPANT (within 5 minutes)';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_documents_frozen ON snapshot_documents;
CREATE TRIGGER trg_snapshot_documents_frozen
  BEFORE DELETE ON snapshot_documents
  FOR EACH ROW EXECUTE FUNCTION snapshot_documents_frozen();

COMMENT ON FUNCTION snapshot_documents_frozen() IS
  'PRD §22.5/§24: snapshot_documents rows may only be deleted inside an authorized erasure. UPDATE is left open — generation status transitions are a designed path.';

-- ----------------------------------------------------------------------------
-- The routine: remove the Snapshot EXPLICITLY, while the session still exists.
--
-- Replaces the ...0006 body with one addition — a deliberate DELETE of the
-- participant's snapshots before the participant row goes. The FK cascade would
-- otherwise be the thing deleting them, and it is the cascade's implicit
-- `DELETE FROM ONLY snapshots` that hit the guard. Doing it here makes the
-- removal an explicit, greppable step rather than an invisible side effect of a
-- foreign key — which is how the earlier migration's prose came to claim
-- coverage it did not have.
--
-- snapshot_documents cascades from snapshots; it is now guarded too, and this
-- runs after the flag is armed and the log row inserted, so both conditions hold.
--
-- ORDERING IS LOAD-BEARING: the erasure_log INSERT comes before the flag is
-- armed, which comes before any guarded DELETE. Both authorization conditions
-- are satisfied for the whole of the destructive section.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erase_participant(
  p_participant_id UUID,
  p_reason         TEXT,
  p_requested_by   TEXT
) RETURNS TABLE (erased_sessions INT, audit_rows_retained INT) AS $$
DECLARE
  v_sessions INT;
  v_audit    INT;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'erasure requires a non-empty reason (§24: record why)';
  END IF;
  IF p_requested_by IS NULL OR length(btrim(p_requested_by)) = 0 THEN
    RAISE EXCEPTION 'erasure requires a non-empty requested_by (§24: record who)';
  END IF;

  SELECT count(*) INTO v_sessions
    FROM assessment_sessions WHERE participant_id = p_participant_id;
  SELECT count(*) INTO v_audit
    FROM audit_events WHERE participant_id = p_participant_id;

  -- Condition 2 of every guard: the log row must exist BEFORE anything guarded
  -- is touched.
  INSERT INTO erasure_log (participant_id, reason, requested_by, audit_rows_retained)
  VALUES (p_participant_id, btrim(p_reason), btrim(p_requested_by), v_audit);

  -- Condition 1: transaction-local, so it cannot leak past COMMIT and cannot be
  -- set by another session.
  PERFORM set_config('app.erasure_authorized', 'on', true);

  -- Sever the identity link EXPLICITLY, here, while the participant id is still
  -- known — rather than relying on the cascade's FK actions. (Rationale in
  -- ...0006: Postgres nulls cascade FKs in an unspecified order, so a scoped
  -- predicate in the audit guard would match nothing and blocked every erasure.)
  UPDATE audit_events
     SET participant_id = NULL, session_id = NULL
   WHERE session_id IN (
           SELECT session_id FROM assessment_sessions WHERE participant_id = p_participant_id
         )
      OR participant_id = p_participant_id;

  -- §24: remove the participant's completed Snapshot(s). Without this the FK
  -- cascade's DELETE hits snapshots_append_only() and the entire erasure aborts,
  -- making every participant who completed permanently un-erasable.
  -- Resolved via the session, because snapshots carries session_id, not
  -- participant_id (the same reason the audit update above matches on either).
  --
  -- CHILD FIRST, AND EXPLICITLY — this order is load-bearing, and an earlier
  -- draft of this migration got it wrong in a way that reproduced the very trap
  -- ...0006 documents at lines 134-143.
  --
  -- `snapshot_documents_frozen` resolves the participant through
  -- snapshot -> session. If the cascade were left to delete the documents, it
  -- fires AFTER the parent snapshot row is gone (Postgres removes children
  -- first), the join finds nothing, and the guard raises:
  --
  --     ERROR: PRD §24: deleting a snapshot document requires a recent
  --            erasure_log row FOR THIS PARTICIPANT (within 5 minutes)
  --
  -- ...on a perfectly authorized erasure. Deleting the documents here, while
  -- `snapshots` and `assessment_sessions` are both still present, means the
  -- guard's lookup resolves normally and the later snapshot DELETE cascades
  -- into an already-empty child table.
  --
  -- This is the same principle as the audit update above, and the reason both
  -- live in the routine: a guard must never depend on the transient state of a
  -- cascade to decide whether an authorized operation is authorized.
  DELETE FROM snapshot_documents
   WHERE snapshot_id IN (
           SELECT sn.snapshot_id
           FROM snapshots sn
           JOIN assessment_sessions s ON s.session_id = sn.session_id
           WHERE s.participant_id = p_participant_id
         );

  DELETE FROM snapshots
   WHERE session_id IN (
           SELECT session_id FROM assessment_sessions WHERE participant_id = p_participant_id
         );

  DELETE FROM participants WHERE participant_id = p_participant_id;

  -- Disarm immediately; the cascade is done. Belt-and-braces — the setting is
  -- local to this transaction either way.
  PERFORM set_config('app.erasure_authorized', 'off', true);

  RETURN QUERY SELECT v_sessions, v_audit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION erase_participant(UUID, TEXT, TEXT) IS
  'PRD §22.5/§24: the ONLY sanctioned participant erasure. Removes responses, derived artifacts, snapshots and contacts; retains the audit trail with nulled references; logs the erasure. Records why and by whom.';

-- SECURITY DEFINER so the routine runs as its owner: the participant tables are
-- RLS-protected and grant nothing to anon/authenticated, so the erase must not
-- depend on the caller's row visibility. It is NOT granted to anon or
-- authenticated — only the service role may invoke it.
REVOKE ALL ON FUNCTION erase_participant(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION erase_participant(UUID, TEXT, TEXT) FROM anon, authenticated;
