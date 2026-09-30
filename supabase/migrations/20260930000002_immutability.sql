-- ============================================================================
-- Set for Life Financial Assessment — Immutability & Versioning enforcement
-- PRD §22.5 (Assessment immutability), §22.6 (Version fields), §23.5, §24
--
-- Rule: after an assessment_sessions row reaches status='completed', the
-- submitted response set and all derived artifacts for that session are
-- FROZEN. Later engine changes may create a NEW interpretation/report
-- version only through an explicit reprocessing process — never by silently
-- rewriting history. Enforced here with triggers, not convention.
-- audit_events is append-only: INSERT allowed, UPDATE/DELETE blocked.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: is a session completed (locked)?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION session_is_completed(p_session_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM assessment_sessions
    WHERE session_id = p_session_id AND status = 'completed'
  );
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- Freeze responses once the parent session is completed (§22.5).
-- Pre-completion edits (Back navigation, §6) remain allowed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freeze_completed_responses()
RETURNS TRIGGER AS $$
BEGIN
  IF session_is_completed(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END
  ) THEN
    RAISE EXCEPTION 'PRD §22.5: responses for completed session % are immutable',
      CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_responses_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON responses
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_responses();

-- ----------------------------------------------------------------------------
-- Freeze derived artifacts (computed_signals, classifier_tags, overrides,
-- tensions, insights) once the session is completed. New engine versions
-- reprocess via explicit reprocessing, which must first transition the
-- session out of 'completed' through an audited operator action — it cannot
-- silently rewrite these rows.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION freeze_completed_derived()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
BEGIN
  v_session_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
  IF session_is_completed(v_session_id) THEN
    RAISE EXCEPTION 'PRD §22.5: derived artifacts for completed session % are immutable; use explicit reprocessing', v_session_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_computed_signals_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON computed_signals
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

CREATE TRIGGER trg_classifier_tags_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON classifier_tags
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

CREATE TRIGGER trg_overrides_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON overrides
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

CREATE TRIGGER trg_tensions_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON tensions
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

CREATE TRIGGER trg_insights_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON insights
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

-- ----------------------------------------------------------------------------
-- Freeze demographics + pilot_feedback once the session is completed.
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_demographics_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON demographics
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

CREATE TRIGGER trg_pilot_feedback_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON pilot_feedback
  FOR EACH ROW EXECUTE FUNCTION freeze_completed_derived();

-- ----------------------------------------------------------------------------
-- Snapshots are append-only history: never UPDATE or DELETE (§22.5 — never
-- silently rewrite the historical Snapshot). New report versions INSERT.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshots_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PRD §22.5: snapshots are append-only; new versions INSERT, history is never rewritten';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_snapshots_append_only
  BEFORE UPDATE OR DELETE ON snapshots
  FOR EACH ROW EXECUTE FUNCTION snapshots_append_only();

-- ----------------------------------------------------------------------------
-- audit_events is append-only (§23.5, §24): INSERT allowed; UPDATE/DELETE
-- blocked for all roles including service_role (trigger-level, no bypass).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PRD §23.5/§24: audit_events is append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- ----------------------------------------------------------------------------
-- Version pinning guard (§22.6, §29): a session's assessment_version may not
-- be changed after completion. The completed assessment retains the
-- versions used at completion even after a later version is published.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_session_version_pin()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'completed' AND NEW.assessment_version IS DISTINCT FROM OLD.assessment_version THEN
    RAISE EXCEPTION 'PRD §22.6/§29: assessment_version is pinned after completion (version pinning acceptance test)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_version_pin
  BEFORE UPDATE ON assessment_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_session_version_pin();

-- ----------------------------------------------------------------------------
-- Completion guard (§8, §23.2): the application completes sessions via
-- POST /api/session/:id/complete with server-side validation of all 31
-- required items. As defense-in-depth, this trigger stamps completed_at
-- whenever status flips to completed, so direct writes stay consistent.
-- NOTE: full 31-item validation lives server-side (§23.2) because the
-- required-item list is config-driven (assessment_versions); the DB cannot
-- enumerate it without duplicating config. See OPEN QUESTION below.
-- ----------------------------------------------------------------------------
-- OPEN QUESTION: Should completion validation ALSO be a DB trigger reading a
-- required-items table seeded from config/assessment-v1.0.json, so that even
-- direct SQL completion cannot bypass the 31-item gate? Currently the gate is
-- server-side only per §23.2, with this trigger stamping completed_at.
CREATE OR REPLACE FUNCTION stamp_session_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
    NEW.last_activity_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_stamp_completed
  BEFORE UPDATE ON assessment_sessions
  FOR EACH ROW EXECUTE FUNCTION stamp_session_completed_at();
