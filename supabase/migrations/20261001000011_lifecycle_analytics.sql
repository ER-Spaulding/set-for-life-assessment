-- ============================================================================
-- Set for Life Financial Assessment
-- Analytics vocabulary for the assessment lifecycle.
--
-- Governs: operator decision 2026-10-01, instruction #8.
--
-- WHY THIS IS A MIGRATION AND NOT A SILENT WRITE. `event_name` carries a CHECK
-- constraint, so adding an event is a review point rather than something a code
-- change can do on its own. That is the property the original design intended and
-- this migration preserves it — the three new names are added deliberately, with
-- their reasons recorded here.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Three new event names.
--
--   assessment_expired
--     The third lifecycle transition. Separate from assessment_abandoned
--     because the consequences differ: abandoned is RESUMABLE, expired is not.
--     One name for both would make "did the participant come back" unanswerable.
--
--   assessment_resumed_after_abandonment
--     Operator instruction #8 requires distinguishing
--       saved -> completed
--       saved -> abandoned -> resumed -> completed
--       abandoned -> resumed -> completed
--     A distinct name is what makes the middle path countable on its own.
--
--   assessment_restarted_after_expiration
--     An expired participant returns and gets a NEW session. That is a distinct
--     funnel entry, not a resume — the old session is historical and will never
--     produce a Snapshot.
-- ----------------------------------------------------------------------------
ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
    'assessment_started',
    'assessment_resumed',
    'assessment_completed',
    'assessment_abandoned',
    'assessment_expired',
    'assessment_resumed_after_abandonment',
    'assessment_restarted_after_expiration',
    'question_position_reached',
    'money_moment_displayed',
    'money_moment_continued',
    'save_progress_offered',
    'save_progress_used',
    'save_progress_skipped',
    'returning_flow_started',
    'returning_flow_completed',
    'snapshot_generated',
    'snapshot_viewed',
    'snapshot_pdf_generated',
    'snapshot_pdf_downloaded',
    'system_error'
  ));

-- ----------------------------------------------------------------------------
-- `saved` joins the payload allow-list.
--
-- OPERATOR INSTRUCTION #8, verbatim:
--   "A participant who used Save My Progress and later crossed the 7-day
--    threshold may be counted as abandoned, but analytics must preserve that the
--    participant had previously intentionally saved so we can distinguish:
--    saved abandonment from unsaved abandonment."
--
-- `saved` is a BOOLEAN about whether the participant had a verified contact at
-- the moment of the transition. It says whether they had intentionally saved —
-- never what they answered.
--
-- WHY THE ALLOW-LIST IS EXTENDED RATHER THAN REUSED. The existing keys are all
-- structural (position, moment, stage, ok…). A boolean named `saved` fits that
-- class exactly: it describes a STATE of the flow, not content from it. Adding it
-- here keeps the allow-list the single enforcement point rather than turning this
-- one field into an exception.
-- ----------------------------------------------------------------------------
-- ORDER MATTERS. The CHECK constraint depends on this function, so the
-- constraint has to come off before the function can be replaced and go back on
-- after. Postgres also refuses to rename an input parameter via CREATE OR
-- REPLACE (the original declared `p`), so this is a replacement, not an edit.
--
-- The window where the guard is absent is inside one transaction, and nothing
-- writes to this table in a migration. The constraint is restored before COMMIT,
-- so no row can be inserted unguarded.
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_payload_safe;
DROP FUNCTION IF EXISTS analytics_payload_is_safe(JSONB);

CREATE OR REPLACE FUNCTION analytics_payload_is_safe(payload JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  k TEXT;
  v JSONB;
  n INTEGER := 0;
BEGIN
  IF payload IS NULL THEN RETURN TRUE; END IF;

  IF jsonb_typeof(payload) <> 'object' THEN
    RETURN FALSE;
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(payload) LOOP
    n := n + 1;
    IF n > 12 THEN RETURN FALSE; END IF;

    -- ALLOW-LIST, NOT DENY-LIST.
    --
    -- A deny-list was tried first and failed against a real database:
    -- {"q1":"Q1_A"} was ACCEPTED, because `q1` is not a forbidden word and the
    -- leak was in the VALUE, not the key. A deny-list can only reject the leaks
    -- someone thought of. This inverts it: a key must be one of these names, so
    -- an answer cannot arrive under an unanticipated one.
    IF lower(k) NOT IN (
      'position', 'step', 'moment', 'decision', 'outcome', 'channel',
      'ok', 'retry', 'count', 'duration_ms', 'code', 'surface', 'stage',
      -- Operator decision 2026-10-01: the saved-vs-unsaved distinction.
      'saved'
    ) THEN
      RETURN FALSE;
    END IF;

    -- Scalars only. No nested objects, no arrays, nothing that could carry
    -- structured participant content past the key check.
    IF jsonb_typeof(v) NOT IN ('string', 'number', 'boolean') THEN
      RETURN FALSE;
    END IF;

    -- Prose cannot hide in a short string.
    IF jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 64 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION analytics_payload_is_safe(JSONB) IS
  'Operator decision 2026-10-01: allow-list of structural payload keys. Extended with `saved` for the saved-vs-unsaved abandonment distinction. Never a container for answers.';

-- Restore the guard the drop above removed.
ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_payload_safe CHECK (analytics_payload_is_safe(payload));

-- ----------------------------------------------------------------------------
-- VERIFY INSIDE THE TRANSACTION. If the restored constraint somehow does not
-- bite, this migration must fail rather than leave the guard silently absent —
-- the failure mode would be a table accepting participant content with nothing
-- reporting it.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  leaks TEXT[] := ARRAY[
    '{"q1":"Q1_A"}',
    '{"answers":{"Q1":"A"}}',
    '{"income":75000}',
    '{"narrative":"Your responses show..."}',
    '{"state":"CA"}',
    '{"note":"' || repeat('A', 200) || '"}',
    '{"step":{"deep":1}}',
    '[1,2,3]'
  ];
  leak TEXT;
  ok_payloads TEXT[] := ARRAY[
    '{}',
    '{"position":12}',
    '{"moment":"MM03"}',
    '{"stage":"Q17"}',
    '{"saved":true}',
    '{"ok":true,"retry":1}'
  ];
  p TEXT;
BEGIN
  FOREACH leak IN ARRAY leaks LOOP
    IF analytics_payload_is_safe(leak::jsonb) THEN
      RAISE EXCEPTION 'payload guard REGRESSED: % was accepted', leak;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ok_payloads LOOP
    IF NOT analytics_payload_is_safe(p::jsonb) THEN
      RAISE EXCEPTION 'payload guard is too strict: % was refused', p;
    END IF;
  END LOOP;
  RAISE NOTICE 'payload guard verified: 8 refused, 6 accepted, including saved';
END $$;

COMMIT;
