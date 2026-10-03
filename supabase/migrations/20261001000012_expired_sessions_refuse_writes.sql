-- Operator decision 2026-10-01 §3 — an expired assessment accepts no further
-- answers, enforced at the database and not only in the route.
--
-- WHY THIS MIGRATION EXISTS. Live verification found the hole. The response
-- route guarded only against `completed`:
--
--     if (session.status === "completed") { ...409... }
--
-- so a write to an EXPIRED session succeeded and bumped that session's own
-- `last_activity_at`. A participant returning to a bookmarked URL could keep
-- answering a session whose only possible ending was the 422 at completion —
-- depositing work into a record the operator's §3 says "may never subsequently
-- produce a current Financial Snapshot", with nothing telling them so.
--
-- The route now refuses it (lib/session/lifecycle.ts, decideResponseWrite).
-- This is the backstop, for the same reason `trg_snapshots_refuse_terminal_session`
-- exists: an application check is a rule the NEXT code path has to remember, and
-- the schema is where a rule becomes true regardless.
--
-- WHY THE EXISTING TRIGGER DID NOT COVER IT. `freeze_completed_responses`
-- (migration ...0001) calls `session_is_completed`, which tests `status =
-- 'completed'` only. That was the whole of the immutability rule at the time:
-- `expired` did not exist as a status until ...00010, and the two were never
-- reconciled. Rather than widening `session_is_completed` — which other code
-- may rely on for its exact meaning — this adds a separate predicate, so
-- "completed is immutable" and "expired refuses writes" stay distinguishable
-- rules that can diverge deliberately rather than a single predicate quietly
-- meaning two things.
--
-- WHAT IS DELIBERATELY NOT CHANGED:
--   * `completed` behaviour is untouched. The new branch is additive.
--   * EXPIRATION IS NOT DELETION (§9). This refuses WRITES. It does not remove,
--     hide or anonymise a single row. The expired session and its answers remain
--     fully present and readable as historical record.
--   * No retention period is introduced. §9 leaves that as a separate Owner
--     decision and this migration does not pre-empt it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The predicate: is this session expired?
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION session_is_expired(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM assessment_sessions
    WHERE session_id = p_session_id AND status = 'expired'
  );
$function$;

COMMENT ON FUNCTION session_is_expired(uuid) IS
  'Operator decision 2026-10-01 §3: an expired assessment is historical and may not accept new answers. Distinct from session_is_completed, which answers the §22.5 immutability question.';

-- ---------------------------------------------------------------------------
-- 2. Extend the response freeze to expired sessions
-- ---------------------------------------------------------------------------
--
-- CREATE OR REPLACE, not a new trigger: the existing trigger keeps firing on
-- the same events, and the function it points at becomes stricter. A second
-- trigger would run in alphabetical order alongside this one and produce two
-- different error messages for one rule.

CREATE OR REPLACE FUNCTION freeze_completed_responses()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  v_session_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;

  -- §22.5 — a completed assessment's answers are immutable.
  IF session_is_completed(v_session_id) THEN
    RAISE EXCEPTION 'PRD §22.5: responses for completed session % are immutable', v_session_id;
  END IF;

  -- §3 — an expired assessment accepts no further answers. The participant is
  -- told to begin a current assessment instead; this makes that true even for a
  -- code path that never read the status.
  IF session_is_expired(v_session_id) THEN
    RAISE EXCEPTION
      'Operator decision 2026-10-01: session % expired after a long period of inactivity. Its answers are historical and may not be edited; begin a current assessment.',
      v_session_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Verify, in-transaction
-- ---------------------------------------------------------------------------
--
-- A migration that adds a backstop without proving it fires is the same class
-- of false confidence as a test that passes on broken code. These DO blocks
-- assert both directions against real rows and roll themselves back.

-- THE WHOLE BLOCK ROLLS ITSELF BACK, and that is deliberate.
--
-- The first draft cleaned up with `DELETE FROM participants`, which cascades to
-- `audit_events` — and `audit_events` is APPEND-ONLY (PRD §22.5/§24), so the
-- cascade was refused and the migration aborted. The database was right and the
-- cleanup was wrong: a verification must not need a privileged erasure path to
-- tidy up after itself.
--
-- So this runs as a subtransaction that always raises the ROLLBACK sentinel and
-- then swallows exactly that sentinel. Nothing it creates survives, it cannot
-- leave rows behind, and it exercises the real triggers rather than a
-- simulation of them.
DO $$
DECLARE
  v_pid uuid;
  v_expired uuid;
  v_live uuid;
  v_completed uuid;
  v_count int;
  ROLLBACK_SENTINEL constant text := 'ZZMIGRATIONVERIFY_ROLLBACK';
BEGIN
  BEGIN  -- subtransaction — rolled back by the sentinel below
  INSERT INTO participants (first_name) VALUES ('ZZMigrationVerify') RETURNING participant_id INTO v_pid;

  -- Created in_progress, given an answer, and only THEN expired. The realistic
  -- order matters for the DELETE check below: `freeze_completed_responses` is a
  -- row-level trigger, so a DELETE matching zero rows never fires it and would
  -- have "passed" a test that proved nothing. That is exactly what the first
  -- draft of this block did — it reported a DELETE being ACCEPTED, because
  -- there was no row to delete.
  INSERT INTO assessment_sessions (participant_id, assessment_version, status, current_position)
  SELECT v_pid, version_id, 'in_progress', 5 FROM assessment_versions LIMIT 1
  RETURNING session_id INTO v_expired;

  INSERT INTO assessment_sessions (participant_id, assessment_version, status, current_position)
  SELECT v_pid, version_id, 'in_progress', 5 FROM assessment_versions LIMIT 1
  RETURNING session_id INTO v_live;

  -- `assessment_sessions_check` requires completed_at whenever status is
  -- 'completed', so it is set here rather than left to a default that does not
  -- exist.
  INSERT INTO assessment_sessions (participant_id, assessment_version, status, current_position, completed_at)
  SELECT v_pid, version_id, 'completed', 5, now() FROM assessment_versions LIMIT 1
  RETURNING session_id INTO v_completed;

  -- The answer is stored FIRST, while the session is still live, so that the
  -- DELETE check below has a real row to attempt.
  INSERT INTO responses (session_id, item_id, option_code) VALUES (v_expired, 'Q1', 'Q1_A');

  -- Now expire it. Expiration is a status change; it removes nothing (§9).
  UPDATE assessment_sessions SET status = 'expired' WHERE session_id = v_expired;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: could not set the verification session to expired';
  END IF;
  -- §9, asserted rather than assumed: the answer written a moment ago is STILL
  -- THERE after expiration.
  SELECT count(*) INTO v_count FROM responses WHERE session_id = v_expired;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: expiring the session removed its answer (§9 says it must not) — found % rows', v_count;
  END IF;

  -- The predicate itself.
  IF NOT session_is_expired(v_expired) THEN
    RAISE EXCEPTION 'VERIFY FAILED: session_is_expired returned false for an expired session';
  END IF;
  IF session_is_expired(v_live) THEN
    RAISE EXCEPTION 'VERIFY FAILED: session_is_expired returned true for an in_progress session';
  END IF;
  -- The new rule must not have swallowed the old one's meaning.
  IF session_is_completed(v_expired) THEN
    RAISE EXCEPTION 'VERIFY FAILED: session_is_completed now reports true for an expired session';
  END IF;

  -- An INSERT into an expired session must be refused.
  BEGIN
    INSERT INTO responses (session_id, item_id, option_code)
    VALUES (v_expired, 'Q1', 'Q1_A');
    RAISE EXCEPTION 'VERIFY FAILED: a response INSERT into an EXPIRED session was ACCEPTED';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'VERIFY FAILED%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%expired after a long period of inactivity%' THEN
        RAISE EXCEPTION 'VERIFY FAILED: refused, but with the wrong message: %', SQLERRM;
      END IF;
  END;

  -- A DELETE from an expired session must be refused too: removing an answer is
  -- still editing the historical record.
  BEGIN
    DELETE FROM responses WHERE session_id = v_expired;
    RAISE EXCEPTION 'VERIFY FAILED: a response DELETE from an EXPIRED session was ACCEPTED';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'VERIFY FAILED%' THEN RAISE; END IF;
  END;

  -- And the rule must NOT have broken the paths that are supposed to work.
  INSERT INTO responses (session_id, item_id, option_code) VALUES (v_live, 'Q1', 'Q1_A');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: a response INSERT into an in_progress session was refused';
  END IF;

  BEGIN
    INSERT INTO responses (session_id, item_id, option_code) VALUES (v_completed, 'Q1', 'Q1_A');
    RAISE EXCEPTION 'VERIFY FAILED: a response INSERT into a COMPLETED session was ACCEPTED';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'VERIFY FAILED%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%immutable%' THEN
        RAISE EXCEPTION 'VERIFY FAILED: completed refused, but no longer with the §22.5 message: %', SQLERRM;
      END IF;
  END;

  -- Everything above passed. Undo it all and leave nothing behind.
  RAISE EXCEPTION '%', ROLLBACK_SENTINEL;
  END;  -- end of the verification subtransaction

EXCEPTION
  WHEN raise_exception THEN
    -- Swallow ONLY our own sentinel. A real failure inside the block propagates
    -- and aborts the migration with its message intact, which is the whole point
    -- of running these checks in the first place.
    IF SQLERRM <> ROLLBACK_SENTINEL THEN RAISE; END IF;
END $$;

-- Confirm the rollback actually left the table clean. If the subtransaction had
-- silently committed, this catches it rather than leaving stray verification
-- rows in a production database.
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM participants WHERE first_name = 'ZZMigrationVerify';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % verification participant(s) survived the rollback', v_left;
  END IF;
END $$;

COMMIT;
