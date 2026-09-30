-- ============================================================================
-- Authorized erasure — reconcile the audit guard with participant deletion.
--
-- Governs: PRD §22.5 (assessment immutability), §24 (retention/deletion),
--          §22.2 (identity separation).
--
-- THE CONFLICT, reproduced by execution before this was written.
--
-- Every child table cascades from `participants` / `assessment_sessions`, EXCEPT
-- `audit_events`, whose FKs are `ON DELETE SET NULL`. So deleting a participant
-- cascade-nulls `audit_events.session_id`, `trg_audit_events_append_only` raises
-- on that UPDATE, and the entire delete fails:
--
--     ERROR: PRD §23.5/§24: audit_events is append-only
--     CONTEXT: ... UPDATE ONLY "public"."audit_events" SET "session_id" = NULL ...
--
-- A participant could therefore NEVER be deleted once any audit row existed —
-- blocking every erasure request, not just test cleanup.
--
-- WHY BOTH RULES CAN HOLD AT ONCE.
--
-- §22.5 forbids SILENTLY rewriting history: "never silently rewrite the
-- historical Snapshot". Erasure that is explicit, authorized, and itself
-- recorded is not silent rewriting — it is the correction process §24 requires
-- ("Define retention/deletion and participant access/correction processes").
-- Note §22.5 scopes the freeze to the submitted response set and the derived
-- artifacts; it does not mention audit_events at all, and the phrase
-- "append-only" does not appear anywhere in the spec. The audit guard is a
-- sound engineering choice, not a spec mandate — but it is a GOOD choice, so
-- this migration keeps it and adds the missing sanctioned path instead of
-- weakening it.
--
-- THE MECHANISM reuses the pattern already established in migration
-- ...0004 for reprocessing, rather than inventing a second convention:
-- transaction-local authorization + a required audit row written in the same
-- transaction. Two independent conditions, so neither a stray flag nor a stale
-- audit row can erase anything on its own.
--
-- WHAT ERASURE DOES AND DOES NOT REMOVE.
--
-- Deleting the participant cascades to sessions, responses, computed signals,
-- tensions, overrides, snapshots, consents and contacts — the participant's
-- personal data (§22.2 identity separation: the UUID is the identity, so
-- removing it removes the link to the person).
--
-- The audit trail SURVIVES, deliberately. Its session/participant references
-- are nulled but the event rows remain, so there is a permanent record that an
-- erasure happened, when, and under what event type. That is what makes the
-- erasure auditable rather than silent — the property §22.5 actually protects.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The audited-erasures table.
--
-- This is NOT audit_events: it must be writable while the append-only trigger
-- is disarmed, and it exists specifically so an erasure leaves a durable,
-- self-describing trace that does not depend on a nulled foreign key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erasure_log (
  erasure_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL,
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  requested_by   TEXT NOT NULL CHECK (length(btrim(requested_by)) > 0),
  erased_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_rows_retained INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE erasure_log IS
  'PRD §22.5/§24: durable record of an authorized participant erasure. Deliberately NOT a foreign-key child of participants — it must outlive the row it describes, which is what makes the erasure auditable rather than silent.';

-- Intentionally has NO foreign key to participants. A record of the erasure
-- cannot itself be erased by the erasure.

ALTER TABLE erasure_log ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (BYPASSRLS) may read or write it, matching
-- every other participant table (migration ...0003 grants no anon/authenticated
-- policy).

-- Append-only for the same reason audit_events is: an erasure record that can
-- be edited is not a record.
CREATE OR REPLACE FUNCTION erasure_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PRD §22.5/§24: erasure_log is append-only (an erasure record cannot be edited or removed)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_erasure_log_append_only ON erasure_log;
CREATE TRIGGER trg_erasure_log_append_only
  BEFORE UPDATE OR DELETE ON erasure_log
  FOR EACH ROW EXECUTE FUNCTION erasure_log_append_only();

-- ----------------------------------------------------------------------------
-- Widen the audit guard: default deny, with one authorized exception.
--
-- The trigger currently raises unconditionally. It now permits an UPDATE ONLY
-- when BOTH hold inside the same transaction:
--   1. app.erasure_authorized = 'on'  (transaction-local, cannot leak)
--   2. an erasure_log row exists for the affected participant within 5 minutes
--
-- Deleting is still forbidden outright — audit rows are never removed, only
-- their participant/session references may be nulled as part of an authorized
-- erasure. That keeps the trail intact while unblocking the cascade.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  -- A DELETE is never permitted, authorized or not: the trail is permanent.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRD §22.5/§24: audit_events is append-only — rows are never deleted';
  END IF;

  -- An UPDATE is permitted ONLY as part of an authorized erasure.
  IF current_setting('app.erasure_authorized', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'PRD §22.5/§24: audit_events is append-only'
      USING HINT =
        'If this is an authorized erasure, call erase_participant(uuid, text, text) — do not update audit_events directly.';
  END IF;

  -- SCOPING. The predicate is deliberately strict and does NOT try to survive
  -- the cascade — because it never has to. `erase_participant` nulls the audit
  -- references EXPLICITLY, while it still knows which participant it is
  -- erasing, so by the time the DELETE runs the rows no longer reference
  -- anything and the FK actions are no-ops. This trigger therefore only ever
  -- sees a deliberate, participant-scoped update.
  --
  -- Two earlier formulations were tried and both failed against a real
  -- cascade, which is why this note is long:
  --
  --   1. "log row for OLD.participant_id" alone — blocked EVERY erasure.
  --      Instrumented, the trigger saw OLD.participant_id = NULL with the
  --      session row already gone: Postgres nulls cascade FKs in an
  --      unspecified order, so the audit row has no reachable link back to the
  --      participant by the time the trigger fires.
  --   2. A bare timestamp OR — let person A's erasure authorize edits to person
  --      B's audit rows.
  --
  -- Keeping the update explicit in the routine avoids both: the guard stays
  -- participant-scoped, and the cascade is never the thing doing the nulling.
  --
  -- MATCHING ON BOTH REFERENCES. Audit rows written by the session-status
  -- trigger carry `session_id` but NOT `participant_id` (verified: a real
  -- completed session produced participant_id=NULL, session_id=<uuid>). So a
  -- predicate keyed only on participant_id silently matches nothing and blocks
  -- every erasure. The session is resolved to its participant for the
  -- comparison.
  IF NOT EXISTS (
    SELECT 1
    FROM erasure_log el
    WHERE el.erased_at > now() - interval '5 minutes'
      AND (
        el.participant_id = OLD.participant_id
        OR el.participant_id = (
          SELECT s.participant_id
          FROM assessment_sessions s
          WHERE s.session_id = OLD.session_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      'PRD §24: erasure authorization requires a recent erasure_log row FOR THIS PARTICIPANT (within 5 minutes)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_events_append_only() IS
  'PRD §22.5/§24: audit_events is never DELETEd. UPDATE is permitted only within an authorized, logged erasure (app.erasure_authorized + a recent erasure_log row).';

-- ----------------------------------------------------------------------------
-- The sanctioned erasure routine.
--
-- This is the ONLY supported way to erase a participant. It exists so the
-- multi-step dance (log, arm, delete, disarm) is one atomic call rather than a
-- procedure an operator has to remember correctly under pressure.
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

  -- Condition 2 of the guard: the log row must exist BEFORE any audit update.
  INSERT INTO erasure_log (participant_id, reason, requested_by, audit_rows_retained)
  VALUES (p_participant_id, btrim(p_reason), btrim(p_requested_by), v_audit);

  -- Condition 1 of the guard: transaction-local, so it cannot leak past COMMIT
  -- and cannot be set by another session.
  PERFORM set_config('app.erasure_authorized', 'on', true);

  -- Sever the identity link EXPLICITLY, here, while the participant id is still
  -- known — rather than relying on the cascade's FK actions. This is the step
  -- that lets the guard keep a strict participant-scoped predicate: when the
  -- DELETE below runs, these rows no longer reference the participant or its
  -- sessions, so the FK actions have nothing to null and this trigger is never
  -- invoked by the cascade.
  --
  -- Both references are cleared: `participant_id` identifies the person and
  -- `session_id` points at their assessment, and §22.2 makes the UUID the
  -- identity — nulling both is what de-identifies the retained trail.
  --
  -- Matched on EITHER reference. Audit rows written by the session-status
  -- trigger carry only `session_id`, so matching on `participant_id` alone
  -- updates zero rows and the guard then blocks the delete (verified).
  UPDATE audit_events
     SET participant_id = NULL, session_id = NULL
   WHERE session_id IN (
           SELECT session_id FROM assessment_sessions WHERE participant_id = p_participant_id
         )
      OR participant_id = p_participant_id;

  DELETE FROM participants WHERE participant_id = p_participant_id;

  -- Disarm immediately; the cascade is done. Belt-and-braces — the setting is
  -- local to this transaction either way.
  PERFORM set_config('app.erasure_authorized', 'off', true);

  RETURN QUERY SELECT v_sessions, v_audit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION erase_participant(UUID, TEXT, TEXT) IS
  'PRD §22.5/§24: the ONLY sanctioned participant erasure. Cascades all personal data, retains the audit trail with nulled references, and logs the erasure to erasure_log. Records why and by whom.';

-- SECURITY DEFINER so the routine runs as its owner: the participant tables are
-- RLS-protected and grant nothing to anon/authenticated, so the erase must not
-- depend on the caller's row visibility. It is NOT granted to anon or
-- authenticated below — only the service role may invoke it.
REVOKE ALL ON FUNCTION erase_participant(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION erase_participant(UUID, TEXT, TEXT) FROM anon, authenticated;
