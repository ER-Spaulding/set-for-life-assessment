-- ============================================================================
-- Set for Life Financial Assessment
-- The assessment lifecycle: saved, abandoned, expired.
--
-- Governs: operator decision 2026-10-01 (ABANDONMENT, RESUME & EXPIRATION
--          LIFECYCLE).
--
-- GOVERNING PRINCIPLE, verbatim:
--   "The Set for Life Financial Assessment is intended to reflect where the
--    participant is financially today. We want to respect intentionally saved
--    progress without allowing sufficiently old answers to become the basis for
--    a current Financial Snapshot."
--
-- WHAT ALREADY EXISTED. `assessment_sessions.status` already permitted
-- 'in_progress', 'completed', 'abandoned' and 'expired' — two of which had never
-- been written. `last_activity_at` was already maintained on every response, and
-- `idx_sessions_status_activity ON (status, last_activity_at)` already existed,
-- with no purpose other than this sweep. The schema anticipated the feature; this
-- migration supplies the behaviour.
--
-- NO NEW STATUS VALUES. The operator asked to keep it simple:
--   "The meaningful persisted assessment lifecycle should remain conceptually
--    simple: IN_PROGRESS -> SAVED -> ABANDONED -> EXPIRED, with COMPLETED as the
--    terminal successful state. RESUMED should normally be recorded as an event
--    rather than becoming another permanent lifecycle status."
-- SAVED and RESUMED are not statuses: saved is in_progress + a verified contact,
-- and resumed is an event, with the session returning to in_progress.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- When this session entered its current lifecycle state.
--
-- WHY A COLUMN AND NOT JUST last_activity_at. `last_activity_at` answers "how
-- long since the participant did something", which drives the SWEEP. This
-- answers "when did we classify it this way", which drives ATTRIBUTION: an
-- analyst asking why a session was marked abandoned needs to know when the
-- decision was made, and recomputing it later from last_activity_at would give a
-- different answer because the sweep runs on a schedule, not at the boundary.
--
-- Nullable with no default: a session created before this migration has no
-- transition to record, and inventing `started_at` as the value would claim it
-- was classified at creation, which is false.
-- ----------------------------------------------------------------------------
ALTER TABLE assessment_sessions
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN assessment_sessions.lifecycle_changed_at IS
  'Operator decision 2026-10-01: when this session last entered its current lifecycle state (abandoned/expired/in_progress via resume). Distinct from last_activity_at, which records participant activity. NULL for sessions predating this migration — their transition time is not knowable and is not invented.';

-- ----------------------------------------------------------------------------
-- Index the transition time for lifecycle reporting.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle_changed
  ON assessment_sessions(lifecycle_changed_at)
  WHERE lifecycle_changed_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- WHICH PARTICIPANT USED SAVE MY PROGRESS — the saved-vs-unsaved distinction.
--
-- Operator instruction #8:
--   "A participant who used Save My Progress and later crossed the 7-day
--    threshold may be counted as abandoned, but analytics must preserve that the
--    participant had previously intentionally saved so we can distinguish: saved
--    abandonment from unsaved abandonment. This will allow us to measure whether
--    Save My Progress actually contributes to eventual completion."
--
-- This is DERIVED, not a new column: the act of saving IS the verified-contact
-- write, so `participant_contacts.verified_at IS NOT NULL` is the durable record
-- and it already exists. Storing a second flag would create two sources for one
-- fact — the failure mode that put Q12_F into the wrong scoring bucket.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW session_lifecycle AS
SELECT
  s.session_id,
  s.participant_id,
  s.status,
  s.last_activity_at,
  s.lifecycle_changed_at,
  s.completed_at,
  s.current_position,
  -- Whole days idle, floored: the sweep's own unit.
  floor(extract(epoch FROM (now() - s.last_activity_at)) / 86400)::int AS idle_days,
  -- Did this participant use Save My Progress? The verified contact IS the flag.
  EXISTS (
    SELECT 1 FROM participant_contacts c
    WHERE c.participant_id = s.participant_id
      AND c.verified_at IS NOT NULL
  ) AS saved_by_participant
FROM assessment_sessions s;

COMMENT ON VIEW session_lifecycle IS
  'Operator decision 2026-10-01: incomplete and complete sessions with their idle duration and whether the participant had used Save My Progress. `saved_by_participant` distinguishes saved abandonment from unsaved abandonment (operator instruction #8) without storing a second flag for a fact the contact table already holds.';

-- ----------------------------------------------------------------------------
-- NO BACKFILL, and no invented transitions.
--
-- The four existing sessions are all `completed`. No inactivity rule applies to
-- a completed session (operator instruction #5), so there is nothing to
-- transition and nothing to backfill. lifecycle_changed_at stays NULL for them,
-- which is accurate: they never underwent a lifecycle transition.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- SAFETY: an expired session must never produce a Snapshot.
--
-- Operator instruction #3: an expired incomplete assessment "becomes historical
-- and must never subsequently produce a current Financial Snapshot."
--
-- ENFORCED IN TWO PLACES, deliberately. The application guard
-- (`mayProduceSnapshot` in lib/session/lifecycle.ts) produces an actionable
-- error a participant can act on. THIS trigger is the backstop, because the
-- application guard is one code path and a future one could forget it — which is
-- exactly what happened before: `completeSession` read the response set and
-- proceeded without ever reading the session's status.
--
-- The trigger fires on INSERT into snapshots, so no code path can bypass it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_snapshot_for_terminal_session()
RETURNS TRIGGER AS $$
DECLARE
  session_status TEXT;
BEGIN
  SELECT status INTO session_status
  FROM assessment_sessions
  WHERE session_id = NEW.session_id;

  -- A missing session is a different problem (the FK will catch it).
  IF session_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF session_status = 'expired' THEN
    RAISE EXCEPTION
      'Operator decision 2026-10-01: an expired assessment may not produce a Snapshot. Session % expired after a long period of inactivity; its answers are historical and must not become the basis for a current Money Picture. Begin a new assessment session.',
      NEW.session_id;
  END IF;

  IF session_status = 'abandoned' THEN
    RAISE EXCEPTION
      'Operator decision 2026-10-01: session % is classified abandoned and must be resumed (returned to in_progress) before it can produce a Snapshot.',
      NEW.session_id;
  END IF;

  IF session_status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION
      'Session % has an unrecognised status (%) and may not produce a Snapshot.',
      NEW.session_id, session_status;
  END IF;

  -- `completed` is permitted: the completion path inserts the Snapshot BEFORE
  -- flipping the status, and the erasure/reprocessing paths may legitimately
  -- touch a completed session. Refusing it here would deadlock completion.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refuse_snapshot_for_terminal_session() IS
  'Operator decision 2026-10-01: the database-side backstop for "an expired assessment must never produce a current Snapshot". The application guard gives a better message; this one cannot be bypassed by a future code path that forgets to check.';

DROP TRIGGER IF EXISTS trg_snapshots_refuse_terminal_session ON snapshots;
CREATE TRIGGER trg_snapshots_refuse_terminal_session
  BEFORE INSERT ON snapshots
  FOR EACH ROW EXECUTE FUNCTION refuse_snapshot_for_terminal_session();

COMMIT;
