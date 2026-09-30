-- ============================================================================
-- Assign assessment_number per participant.
--
-- Governs: PRD §22.3 / §22.4 (participant 1→many assessment_sessions).
--
-- THE DEFECT, reproduced by execution before this was written.
--
-- `assessment_sessions.assessment_number` was declared `NOT NULL DEFAULT 1`
-- with `UNIQUE (participant_id, assessment_number)`. The default means the
-- first session for a participant gets 1 — and every LATER session also
-- defaults to 1, which the unique constraint then rejects:
--
--     ERROR: duplicate key value violates unique constraint
--            "assessment_sessions_participant_id_assessment_number_key"
--
-- So a returning participant could never start a second assessment. PRD §22.4
-- states the intended cardinality explicitly — "participant 1→many
-- assessment_sessions" — so the column is meant to distinguish repeat
-- assessments, not to be a constant. There was no code writing it: the route
-- omits the column entirely and inherited the default.
--
-- FIX: the column becomes SYSTEM-MANAGED. A BEFORE INSERT trigger assigns the
-- next number for that participant, ignoring any supplied value. Doing this in
-- the database rather than in the route follows the same reasoning as the
-- immutability triggers in migration ...002: a rule the app happens to follow
-- is a convention, and conventions get bypassed by the next caller (an import,
-- a backfill, a test harness). Here the rule holds for every writer.
--
-- CONCURRENCY: two simultaneous inserts for one participant could both compute
-- the same next number; the UNIQUE constraint rejects the loser. That is the
-- correct failure — loud and retryable — rather than silent duplication. The
-- app's route surfaces it as a 500 and the caller can retry.
--
-- ORDERING NOTE: numbers are assigned by arrival, so a deleted or abandoned
-- session leaves a gap. That is intentional — renumbering would rewrite
-- history, and §22.5 keeps completed sessions immutable.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- The default is what produced the collision; the trigger replaces it.
ALTER TABLE assessment_sessions ALTER COLUMN assessment_number DROP DEFAULT;

CREATE OR REPLACE FUNCTION assign_assessment_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Always computed, never trusted from the caller: a client-supplied value
  -- could collide, skip, or impersonate another assessment's number.
  SELECT COALESCE(MAX(assessment_number), 0) + 1
    INTO NEW.assessment_number
    FROM assessment_sessions
   WHERE participant_id = NEW.participant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_assessment_number ON assessment_sessions;
CREATE TRIGGER trg_assign_assessment_number
  BEFORE INSERT ON assessment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION assign_assessment_number();

COMMENT ON COLUMN assessment_sessions.assessment_number IS
  'PRD §22.3/§22.4: 1-based sequence of this participant''s assessments. System-managed by trg_assign_assessment_number — never supplied by a caller. Gaps are expected when a session is abandoned or deleted.';
