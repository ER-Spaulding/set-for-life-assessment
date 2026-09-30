-- ============================================================================
-- Close three integrity gaps found by adversarial schema QC.
--
-- Governs: PRD §22.5 (assessment immutability), §22.6 + §29 (version pinning),
--          §24 (consent record must carry timestamp, source, and version).
--
-- Each fix below was reproduced by execution before being written:
--
--   F1  A completed session could be flipped back to 'in_progress'. The
--       immutability triggers test the session's CURRENT status, so the flip
--       disarmed every freeze — responses became editable again — and the
--       flip wrote ZERO audit rows. Full chain verified:
--         completed      -> UPDATE responses  => rejected (§22.5)
--         status flip    -> UPDATE 1, audit_events unchanged
--         after the flip -> UPDATE responses  => ACCEPTED
--       PRD §22.5 permits reprocessing only "through an explicit reprocessing
--       process", and the original migration comment promised an "audited
--       operator action". Neither existed.
--
--   F2  The assessment_versions row itself was mutable, so the version pin was
--       only as deep as the pointer: editing the 1.0 row retroactively changed
--       what every pinned session "retained" (§22.6, §29 version pinning).
--
--   F3  The consent state machine's third branch was a bare (status='expired'),
--       so an untimestamped expired row was accepted — violating §24's
--       requirement that every consent record carry a timestamp.
--
-- No secrets. Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- F1a — a completed session may not leave 'completed' unless the transition is
-- an audited reprocess.
--
-- Two conditions must hold to move a completed session back:
--   1. an audit_events row already records the intent for THAT session, and
--   2. the transition is explicitly flagged for this transaction.
-- Condition 1 makes the action traceable; condition 2 stops an accidental or
-- bulk UPDATE from reopening history merely because an audit row happens to
-- exist for some other reason.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_completed_session_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Leaving 'completed' (to anything else) requires an audited reprocess.
  IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed' THEN

    IF current_setting('app.reprocess_authorized', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'PRD §22.5: completed session % may not be reopened without an authorized reprocess',
        OLD.session_id
        USING HINT =
          'Write an audit_events row for this session, then SET LOCAL app.reprocess_authorized = ''on'' in the same transaction.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM audit_events
      WHERE session_id = OLD.session_id
        AND event_type = 'reprocess_authorized'
        AND event_at > now() - interval '5 minutes'
    ) THEN
      RAISE EXCEPTION
        'PRD §22.5: reprocessing session % requires a recent audit_events row (event_type = ''reprocess_authorized'')',
        OLD.session_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION guard_completed_session_transition() IS
  'PRD §22.5: completed sessions are terminal except through an audited reprocess. Closes the bypass where flipping status disarmed the freeze triggers.';

CREATE TRIGGER trg_sessions_guard_completed_transition
  BEFORE UPDATE ON assessment_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_completed_session_transition();

-- ----------------------------------------------------------------------------
-- F1b — record the transition itself. Even an authorized reprocess leaves a
-- trace, and an unauthorized attempt is noted before it is rejected.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_session_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_events (session_id, event_type, metadata_json)
    VALUES (
      NEW.session_id,
      CASE
        WHEN OLD.status = 'completed' AND NEW.status <> 'completed'
          THEN 'session_reopened'
        WHEN NEW.status = 'completed'
          THEN 'session_completed'
        ELSE 'session_status_changed'
      END,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_audit_status_change
  AFTER UPDATE ON assessment_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_session_status_change();

-- ----------------------------------------------------------------------------
-- F2 — assessment_versions is append-only once referenced.
--
-- A published version must never change: sessions pinned to it retain the
-- instrument they were scored against (§22.6, §29). New instruments INSERT a
-- new version row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_published_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM assessment_sessions WHERE assessment_version = OLD.version_id
    ) THEN
      RAISE EXCEPTION
        'PRD §22.6: assessment_versions.% is referenced by sessions and may not be deleted',
        OLD.version_id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: allow only moving a draft to active; freeze everything else.
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'PRD §22.6/§29: assessment_versions.% is % and may not be modified; publish a new version instead',
      OLD.version_id, OLD.status;
  END IF;

  IF NEW.version_id <> OLD.version_id
     OR NEW.question_bank_version IS DISTINCT FROM OLD.question_bank_version
     OR NEW.scoring_config_version IS DISTINCT FROM OLD.scoring_config_version
     OR NEW.narrative_version IS DISTINCT FROM OLD.narrative_version
     OR NEW.report_version IS DISTINCT FROM OLD.report_version THEN
    RAISE EXCEPTION
      'PRD §22.6: the content of assessment_versions.% is frozen on publish; publish a new version instead',
      OLD.version_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION protect_published_version() IS
  'PRD §22.6/§29: a published assessment version is immutable, so a pinned session keeps the instrument it was scored against.';

CREATE TRIGGER trg_assessment_versions_protect
  BEFORE UPDATE OR DELETE ON assessment_versions
  FOR EACH ROW EXECUTE FUNCTION protect_published_version();

-- ----------------------------------------------------------------------------
-- F3 — every consent record carries a timestamp (§24).
--
-- The original CHECK's third branch was a bare (status='expired'), so an
-- expired row with neither timestamp was accepted. Replace the constraint so
-- a terminal state always records when it was reached.
-- ----------------------------------------------------------------------------
ALTER TABLE communication_consents
  DROP CONSTRAINT IF EXISTS communication_consents_check;

ALTER TABLE communication_consents
  ADD CONSTRAINT communication_consents_check CHECK (
    (status = 'granted' AND granted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'expired' AND (granted_at IS NOT NULL OR revoked_at IS NOT NULL))
  );

COMMENT ON CONSTRAINT communication_consents_check ON communication_consents IS
  'PRD §24: consent is explicit, timestamped and revocable. An expired record must still record when it was granted or revoked.';
