-- ============================================================================
-- Set for Life Financial Assessment — Seed: pinned assessment version 1.0
-- PRD §29 "version pinning" acceptance test: a session must record which
-- assessment version scored it. Version 1.0 is the active MVP build; sessions
-- pin assessment_version='1.0' at creation and retain it after completion
-- even after later versions publish (enforced by trg_sessions_version_pin).
--
-- The four sub-versions are independent from Git tags (§30B): Git tag
-- mvp-v1.0.0 tracks code releases; these columns track instrument content.
-- Run with: psql $DATABASE_URL -f supabase/seed/001_assessment_v1.sql
-- Idempotent: safe to re-run (INSERT ... ON CONFLICT DO NOTHING).
-- ============================================================================

INSERT INTO assessment_versions (
  version_id, label, status,
  question_bank_version, scoring_config_version,
  narrative_version, report_version
) VALUES (
  '1.0', 'MVP v1.0 — initial pilot build', 'active',
  '1.0', '1.0',
  '1.0', '1.0'
)
ON CONFLICT (version_id) DO NOTHING;
