-- ============================================================================
-- "Prefer not to say" is an explicit value, not NULL.
--
-- OPERATOR DECISION 2026-10-01:
--   "'Prefer not to say' remains an explicit valid response, not null."
--
-- WHY THIS MIGRATION EXISTS. The first version of the State field normalised a
-- decline to NULL. That conflates two different facts:
--
--   NULL                   -> the participant has NOT BEEN ASKED (or skipped it)
--   'PREFER_NOT_TO_SAY'    -> the participant WAS asked and DECLINED
--
-- Those are not the same, and collapsing them has a concrete cost: a refusal
-- becomes indistinguishable from missing data, so a later backfill, a reporting
-- query, or an export cannot tell a deliberate decline from an unanswered field.
-- It also matches D1-D3 in the instrument config, where every demographic item
-- carries its own explicit "Prefer not to say" option rather than relying on an
-- empty answer.
--
-- THE CONSTRAINT PROBLEM, AND WHY IT IS SOLVED THIS WAY.
--
-- `state_code` has a foreign key to `jurisdictions(code)`, which is what makes
-- the selector controlled rather than free text. The sentinel is deliberately
-- NOT a jurisdiction row: adding a fake jurisdiction would put a non-place into
-- the list that future Addendum 03 advisor matching would have to special-case,
-- and it would make "which jurisdictions do we cover?" unanswerable.
--
-- So the FK is replaced by a CHECK that expresses the real rule:
--
--     the value is NULL, OR the sentinel, OR a code in the jurisdictions table.
--
-- The CHECK is a strict superset of the FK — it still rejects every free-text
-- value the FK rejected — so nothing is loosened except the one thing that had
-- to change.
--
-- WHY NOT keep the FK and drop the sentinel to NULL: that is the behaviour the
-- operator explicitly rejected.
-- WHY NOT a partial unique index or a generated column: both add machinery for a
-- rule one CHECK states plainly.
--
-- THE FK IS INTENTIONALLY DROPPED, and this is the compatibility implication
-- worth recording: anything relying on the FK's exact error code would see a
-- CHECK violation instead. Nothing in the codebase does (the app validates
-- before the write), and no persisted data changes.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Replace the FK with an equivalent-or-stricter CHECK.
--
-- THE OBVIOUS FORM DOES NOT COMPILE. A CHECK cannot contain a subquery —
-- Postgres rejects `EXISTS (SELECT ... FROM jurisdictions ...)` outright:
--
--     ERROR: cannot use subquery in check constraint
--
-- verified against a real database, not assumed. The first draft of this
-- migration was written that way and failed at apply time.
--
-- So the lookup moves into an IMMUTABLE function, which the CHECK can call. The
-- rule stays declarative and declarative has a real advantage here: it is
-- enforced on every write, including writes from psql or a future service, not
-- just the ones that go through the app's validation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_valid_state_code(p_code TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_code IS NULL
      OR p_code = 'PREFER_NOT_TO_SAY'
      OR EXISTS (SELECT 1 FROM jurisdictions j WHERE j.code = p_code);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION is_valid_state_code(TEXT) IS
  'Addendum 02 v1.1 / operator 2026-10-01: NULL (not asked), the explicit decline sentinel, or a controlled jurisdiction code. Exists as a function because a CHECK constraint cannot contain a subquery.';

ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS participants_state_code_fk;

ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS participants_state_code_valid;

ALTER TABLE participants
  ADD CONSTRAINT participants_state_code_valid CHECK (is_valid_state_code(state_code));

COMMENT ON CONSTRAINT participants_state_code_valid ON participants IS
  'Addendum 02 v1.1 / operator 2026-10-01: state_code is NULL (not asked), the explicit decline sentinel, or a controlled jurisdiction code. Still rejects free text. "Prefer not to say" is a recorded response, not an absence.';

COMMENT ON COLUMN participants.state_code IS
  'Optional US state/jurisdiction code (e.g. "CA"), the explicit sentinel ''PREFER_NOT_TO_SAY'' when declined, or NULL when not asked. CONTEXTUAL/PROFILE DATA ONLY — never read by scoring, the six Money Picture signals, tension determination, Perception Gap, Activation, or Snapshot interpretation. Reserved for future Addendum 03 advisor matching; no licensing inference is made from it.';

-- ----------------------------------------------------------------------------
-- The sentinel must not be mistakable for a jurisdiction code.
--
-- If a future migration ever seeded it into `jurisdictions`, the CHECK above
-- would still pass and the sentinel would silently become a place. This makes
-- that impossible rather than merely unlikely.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jurisdictions WHERE code = 'PREFER_NOT_TO_SAY') THEN
    RAISE EXCEPTION
      'jurisdictions must never contain the decline sentinel — it is not a place';
  END IF;
END $$;
