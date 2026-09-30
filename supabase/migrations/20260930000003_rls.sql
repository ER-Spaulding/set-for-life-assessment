-- ============================================================================
-- Set for Life Financial Assessment — Row Level Security
-- PRD §24 (Privacy, Consent & Data Handling), §30B (Environment Strategy)
--
-- SECURITY MODEL
-- ------------
-- All participant data access goes through server-side API routes that use
-- the Supabase SERVICE-ROLE key. Browser/client code talks to those routes;
-- it never touches Postgres directly with privileged credentials:
--
--   "Browser/client code must never receive database service-role secrets,
--    GHL private credentials, or other privileged keys."
--
-- RLS is enabled on every table that holds participant data, with a
-- DEFAULT-DENY posture: the only policies granted are to the `service_role`
-- role (i.e. the server). The `anon` and `authenticated` roles receive NO
-- permissive policies, so any direct client-to-database access with a
-- publishable/anon key is denied on every row of every table:
--
--   "Protect stored assessment data with Supabase Row Level Security and
--    server-side authorization."
--
-- Analytics, pilot aggregates, and internal assessment processing join on
-- participant_id / session_id — never on email, phone, or name — so
-- identity is not required where it is not needed:
--
--   "Use pseudonymous Participant IDs in analytics and internal assessment
--    processing where identity is not required."
--
-- assessment_versions holds no participant data (it is build config), but
-- RLS is enabled there too for uniformity; the server reads it via
-- service_role.
--
-- OPEN QUESTION: if a future release ever grants `authenticated` users
-- direct (non-server) database access — e.g. Supabase-JS reads with the
-- anon key — an explicit auth-identity → participant_id mapping will be
-- needed first (currently NO such column/table exists by design, per the
-- §4.2 no-auto-merge rule). Until that mapping is specified and reviewed,
-- keep default-deny: do NOT add permissive policies for anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable RLS on all 17 tables (§22.3)
-- ----------------------------------------------------------------------------
ALTER TABLE participants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_consents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE computed_signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifier_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE overrides               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tensions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights                ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE demographics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_feedback          ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_links               ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events            ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Server-side authorization: full access for service_role ONLY.
-- Supabase server clients (API routes, CRM sync workers, admin jobs) use the
-- service-role key, which these policies authorize. Application-level checks
-- (verified Participant ID owns the session, admin allow-list for internal
-- routes per §23.5) remain the API layer's job — RLS is the backstop, not
-- the whole authorization story.
-- No policies are created for `anon`, `authenticated`, or PUBLIC: with RLS
-- enabled and no applicable permissive policy, every such access is denied.
-- ----------------------------------------------------------------------------
CREATE POLICY server_full_access_participants
  ON participants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_participant_contacts
  ON participant_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_communication_consents
  ON communication_consents FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_assessment_versions
  ON assessment_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_assessment_sessions
  ON assessment_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_responses
  ON responses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_computed_signals
  ON computed_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_classifier_tags
  ON classifier_tags FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_overrides
  ON overrides FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_tensions
  ON tensions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_insights
  ON insights FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_snapshots
  ON snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_demographics
  ON demographics FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_pilot_feedback
  ON pilot_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_crm_links
  ON crm_links FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_integration_events
  ON integration_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY server_full_access_audit_events
  ON audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);
