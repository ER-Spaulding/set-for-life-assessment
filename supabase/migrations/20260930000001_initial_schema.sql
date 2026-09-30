-- ============================================================================
-- Set for Life Financial Assessment — Initial Schema
-- PRD: Set_for_Life_Assessment_MASTER_PRD_Technical_Spec_FINAL_v1.0.md
-- Governs: §22 (Data Architecture), §23 (API), §24 (Privacy/Consent),
--          §26 (Pilot Mode), §30B (Environments), §30C (GHL Data Contract),
--          §30D (Reminder Logic)
--
-- Target: Supabase PostgreSQL. Portable SQL; only pgcrypto for gen_random_uuid.
-- No secrets are committed in any migration. Service-role keys, GHL
-- credentials, and connection strings live in protected env vars only (§30B).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- participants — PRD §22.3, §22.2 (Identity separation), §4.2 (no auto-merge)
-- participant_id is a RANDOM UUID and is NEVER the email address.
-- No columns exist here (or anywhere) to auto-merge identities on name,
-- phone, demographics, IP, or device fingerprint. Such merging is out of
-- scope per §4.2 and must be an explicit, audited human/operator action.
-- ============================================================================
CREATE TABLE participants (
  participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'deleted_requested', 'deleted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE participants IS 'PRD §22.3/§22.2: permanent internal identity. participant_id is a random UUID, never the email. No auto-merge affordances (§4.2).';

-- ============================================================================
-- participant_contacts — PRD §22.3, §22.4, §24, §30D
-- Email/phone live HERE, separate from participant_id. contact_type covers
-- email + mobile; mobile collected at END of experience (§24), so a
-- first-time incomplete participant is email-reminder eligible only (§30D.5).
-- ============================================================================
CREATE TABLE participant_contacts (
  contact_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   UUID NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  contact_type     TEXT NOT NULL CHECK (contact_type IN ('email', 'mobile')),
  normalized_value TEXT NOT NULL,
  verified_at      TIMESTAMPTZ,
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_type, normalized_value)
);
COMMENT ON TABLE participant_contacts IS 'PRD §22.3/§24/§30D: auth/contact attributes (email, mobile) kept separate from participant_id. normalized_value e.g. lowercased email, E.164 phone.';
CREATE INDEX idx_contacts_participant ON participant_contacts(participant_id);

-- ============================================================================
-- communication_consents — PRD §22.3, §24, UIUX §22A, §30C
-- HARD PRODUCT RULE: consent is explicit, timestamped, revocable.
-- "Consent must never be pre-checked and A4 readiness must never imply
--  consent." Enforced: NO DEFAULT on status; the application layer must pass
--  an explicit status on every insert. Phone entry does NOT create consent
--  (§23.3); A4 does NOT create consent (§29 support-readiness test).
-- ============================================================================
CREATE TABLE communication_consents (
  consent_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     UUID NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  channel            TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  purpose            TEXT NOT NULL CHECK (purpose IN ('operational', 'marketing', 'reminder')),
  -- No DEFAULT: explicit consent status required on insert. Never pre-check.
  status             TEXT NOT NULL CHECK (status IN ('granted', 'revoked', 'expired')),
  consent_text_version TEXT NOT NULL,
  source             TEXT NOT NULL,
  granted_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'granted' AND granted_at IS NOT NULL AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL) OR
    (status = 'expired')
  )
);
COMMENT ON TABLE communication_consents IS 'PRD §24/UIUX §22A: explicit, timestamped, revocable consent. HARD RULE: never pre-checked; A4 readiness never implies consent. status has NO DEFAULT so the app must always pass it explicitly.';
COMMENT ON COLUMN communication_consents.status IS 'No DEFAULT by design. A future developer must not add DEFAULT granted — consent must never be pre-checked.';
CREATE INDEX idx_consents_participant ON communication_consents(participant_id);

-- ============================================================================
-- assessment_versions — PRD §22.3, §22.6, §29 (version pinning test)
-- Every completed session pins the versions used at completion time, so a
-- later published version never rewrites history.
-- ============================================================================
CREATE TABLE assessment_versions (
  version_id            TEXT PRIMARY KEY,
  label                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'archived')),
  question_bank_version TEXT NOT NULL,
  scoring_config_version TEXT NOT NULL,
  narrative_version     TEXT NOT NULL,
  report_version        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE assessment_versions IS 'PRD §22.3/§22.6/§29: versioned assessment/question-bank/scoring/narrative/report configs. Sessions pin version_id at creation; completed assessments retain versions used at completion.';

-- ============================================================================
-- assessment_sessions — PRD §22.3, §22.4, §22.7, §26, §30D
-- status=in_progress drives reminder eligibility (§30D). assessment_number
-- supports longitudinal reassessment under one Participant ID (§22.7, §7.4).
-- pilot_mode is a per-session feature flag snapshot (§26).
-- ============================================================================
CREATE TABLE assessment_sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  assessment_version TEXT NOT NULL REFERENCES assessment_versions(version_id),
  assessment_number INTEGER NOT NULL DEFAULT 1 CHECK (assessment_number >= 1),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'abandoned', 'expired')),
  current_position  INTEGER NOT NULL DEFAULT 0,
  pilot_mode        BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (participant_id, assessment_number),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status IN ('in_progress', 'abandoned', 'expired'))
  )
);
COMMENT ON TABLE assessment_sessions IS 'PRD §22.3/§22.7/§26/§30D: one row per assessment attempt. status=in_progress = reminder-eligible. Multiple completed assessments per participant supported (longitudinal readiness; MVP exposes no history portal).';
CREATE INDEX idx_sessions_participant ON assessment_sessions(participant_id);
CREATE INDEX idx_sessions_status_activity ON assessment_sessions(status, last_activity_at)
  WHERE status = 'in_progress';

-- ============================================================================
-- responses — PRD §22.3, §22.4, §22.5 (immutability), §8 (31 required items)
-- One row per answered item per session. option_code stores codes like
-- Q4_C, Q1_A, OPEN_B_D, A4_E, D1_H. open_text holds "Something else" fills
-- and D2 self-describe text. changed_at supports pre-completion edits via
-- Back navigation (§6); AFTER completion the set is frozen by trigger
-- (see 20260930000002_immutability.sql). Immutability enforced in DB, not
-- just convention.
-- ============================================================================
CREATE TABLE responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  option_code TEXT NOT NULL,
  open_text   TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at  TIMESTAMPTZ,
  UNIQUE (session_id, item_id, option_code)
);
COMMENT ON TABLE responses IS 'PRD §22.3/§22.5/§8: raw submitted answers (31 required: OPEN_A/B + Q1-Q25 + A1-A4; demographics stored separately in demographics table). Frozen after session completion via immutability trigger — DB-enforced, not convention.';
CREATE INDEX idx_responses_session ON responses(session_id);

-- ============================================================================
-- computed_signals — PRD §22.3, §13 (six signals + contextual subsignals)
-- signal_id examples: VISIBILITY, CAPACITY, AGENCY, PREPAREDNESS, DIRECTION,
-- INFORMATION, plus contextual subsignals (e.g. CONVERSATION_OPENNESS,
-- BELIEF_AWARENESS, OPENNESS, PROFESSIONAL_AGENCY, CONSUMPTION/ANALYSIS/ACTION).
-- raw_value is the internal 1–5 directional value (§13.1), never shown raw.
-- ============================================================================
CREATE TABLE computed_signals (
  session_id          UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  signal_id           TEXT NOT NULL,
  raw_value           NUMERIC,
  state               TEXT,
  evidence_confidence TEXT CHECK (evidence_confidence IS NULL OR evidence_confidence IN ('high', 'moderate', 'limited')),
  calculation_version TEXT NOT NULL,
  PRIMARY KEY (session_id, signal_id)
);
COMMENT ON TABLE computed_signals IS 'PRD §22.3/§13: deterministic scoring output — six operating signals + contextual subsignals. Internal-only; never expose raw 1–5 values to participants (§20).';

-- ============================================================================
-- classifier_tags — PRD §22.3, §14 (classifier dictionary)
-- tag_code examples: OPEN_MONEY_ENVIRONMENT, DEBT_PRESSURE,
-- NO_SIGNIFICANT_PRESSURE, TRUTH_AVOIDANCE, PEACE_REDUCED_STRESS.
-- Never exposed to participants (§24).
-- ============================================================================
CREATE TABLE classifier_tags (
  session_id     UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL,
  tag_code       TEXT NOT NULL,
  PRIMARY KEY (session_id, source_item_id, tag_code)
);
COMMENT ON TABLE classifier_tags IS 'PRD §22.3/§14: Q1/Q9/Q16/Q21 classifier output. Internal diagnostic machinery — never expose to participants (§24).';

-- ============================================================================
-- overrides — PRD §22.3, §13.4–§13.6 (capacity overrides)
-- override_code examples: Q11_CAPACITY_OVERRIDE, Q12_CAPACITY_OVERRIDE,
-- AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT,
-- CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT (§13.7).
-- ============================================================================
CREATE TABLE overrides (
  session_id       UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  override_code    TEXT NOT NULL,
  source_item_ids  TEXT[] NOT NULL DEFAULT '{}',
  payload          JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (session_id, override_code)
);
COMMENT ON TABLE overrides IS 'PRD §22.3/§13.4-§13.7: capacity overrides (Q11/Q12) and modifiers (Q18). Acceptance tests §29 pin this behavior.';

-- ============================================================================
-- tensions — PRD §22.3, §15 (cross-domain tension engine)
-- tension_code examples: HIGH_ACTIVITY_LOW_DIRECTION,
-- INFORMATION_EXECUTION_BOTTLENECK, HEALTHY_PRIVACY_BOUNDARY.
-- Thresholds for high/low live in scoring config, not here (§15).
-- ============================================================================
CREATE TABLE tensions (
  session_id       UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  tension_code     TEXT NOT NULL,
  evidence_payload JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (session_id, tension_code)
);
COMMENT ON TABLE tensions IS 'PRD §22.3/§15: cross-domain tension findings with evidence payloads. High/low thresholds are scoring-config, not schema.';

-- ============================================================================
-- insights — PRD §22.3, §19.2 (no orphan insights)
-- Every participant-facing personalized statement must have an insight_id
-- with source questions, evidence, confidence, and narrative key.
-- insight_type distinguishes strength / friction / connection / attention.
-- ============================================================================
CREATE TABLE insights (
  session_id           UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  insight_id           TEXT NOT NULL,
  insight_type         TEXT NOT NULL CHECK (insight_type IN ('strength', 'friction', 'connection', 'attention_area', 'perception_gap', 'activation')),
  confidence           TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'moderate', 'limited')),
  source_evidence_json JSONB NOT NULL DEFAULT '{}',
  narrative_key        TEXT NOT NULL,
  PRIMARY KEY (session_id, insight_id)
);
COMMENT ON TABLE insights IS 'PRD §22.3/§19.2: no orphan insights — every personalized claim traces to source evidence via source_evidence_json + narrative_key into the approved deterministic narrative library (§19).';

-- ============================================================================
-- snapshots — PRD §22.3, §22.4, §22.5, §20 (Financial Snapshot)
-- rendered_payload_json is the participant-facing Snapshot payload, generated
-- deterministically from narrative keys. Completed session → 1+ versioned
-- snapshots; historical snapshots are never silently rewritten (§22.5).
-- ============================================================================
CREATE TABLE snapshots (
  snapshot_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  report_version        TEXT NOT NULL,
  rendered_payload_json JSONB NOT NULL,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE snapshots IS 'PRD §22.3/§22.5/§20: versioned participant-facing Financial Snapshot payloads. Separate record from raw responses and computed interpretation (§22.4). Append-only history.';
CREATE INDEX idx_snapshots_session ON snapshots(session_id);

-- ============================================================================
-- demographics — PRD §22.3, §12, §3 (demographics never score)
-- "No demographic response changes the diagnostic score" (§3). Prefer not to
-- say is a valid completed response and must never trigger avoidance/secrecy/
-- trust/openness logic (§12). Stored in its own table, keyed 1:1 to session.
-- ============================================================================
CREATE TABLE demographics (
  session_id           UUID PRIMARY KEY REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  age_range            TEXT,
  gender               TEXT,
  gender_self_describe TEXT,
  household_income     TEXT
);
COMMENT ON TABLE demographics IS 'PRD §22.3/§12/§3: D1-D3 answers incl. Prefer not to say. NEVER a diagnostic signal — scoring engine must not read this table.';

-- ============================================================================
-- pilot_feedback — PRD §22.3, §26 (pilot validation survey)
-- Presented only after Snapshot viewed and only when pilot_mode enabled.
-- felt_judged_or_pressured maps to §26 safety question; comprehension_text
-- maps to "describe in your own words the primary pattern" (§26).
-- ============================================================================
CREATE TABLE pilot_feedback (
  session_id              UUID PRIMARY KEY REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  accuracy_rating         INTEGER CHECK (accuracy_rating IS NULL OR (accuracy_rating BETWEEN 1 AND 5)),
  synthesis_value_rating  INTEGER CHECK (synthesis_value_rating IS NULL OR (synthesis_value_rating BETWEEN 1 AND 5)),
  felt_judged_or_pressured BOOLEAN,
  inaccurate_text         TEXT,
  useful_text             TEXT,
  comprehension_text      TEXT,
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE pilot_feedback IS 'PRD §22.3/§26: post-Snapshot pilot validation survey. Only collected when pilot_mode is on.';

-- ============================================================================
-- crm_links — PRD §22.3, §30C (GHL minimum data contract)
-- Holds ONLY the minimum contract: GHL contact id + sync state. The narrow
-- field subset synced (name/email/mobile/dates/attention area/continuation
-- path/tags) is a runtime sync concern; this table records the link, never
-- full responses, classifier tags, demographics, or evidence chains (§30C).
-- Idempotency: one row per participant (PK) — repeat syncs update in place.
-- ============================================================================
CREATE TABLE crm_links (
  participant_id UUID PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
  ghl_contact_id TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  sync_status    TEXT NOT NULL DEFAULT 'pending'
                 CHECK (sync_status IN ('pending', 'synced', 'failed'))
);
COMMENT ON TABLE crm_links IS 'PRD §22.3/§30C: GHL contact link. Minimum-data contract only — never full responses, fear/classifier tags, demographics, or evidence chains. Idempotent: one row per participant (PK), updated in place.';

-- ============================================================================
-- integration_events — PRD §22.3, §23.4, §30C
-- CRM sync is server-only + idempotent (§23.4). Idempotency key: the UNIQUE
-- constraint on (destination, event_type, participant_id, session_id) —
-- retries of the same logical sync update the same row (bump attempt_count)
-- instead of creating duplicates. Failed syncs never roll back assessments.
-- ============================================================================
CREATE TABLE integration_events (
  event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID REFERENCES participants(participant_id) ON DELETE CASCADE,
  session_id     UUID REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,
  destination    TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'in_progress', 'succeeded', 'failed')),
  attempt_count  INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (destination, event_type, participant_id, session_id)
);
COMMENT ON TABLE integration_events IS 'PRD §22.3/§23.4/§30C: server-only idempotent sync ledger. UNIQUE(destination,event_type,participant_id,session_id) makes retries idempotent. Failures retry here; never roll back a completed assessment.';
CREATE INDEX idx_integration_status ON integration_events(status, created_at)
  WHERE status IN ('queued', 'failed');

-- ============================================================================
-- audit_events — PRD §22.3, §23.5, §24
-- Append-only (enforced by trigger in 20260930000002_immutability.sql).
-- Must cover completion, consent changes, and integration events.
-- metadata_json carries context (e.g. consent status transitions, sync ids).
-- Never store raw sensitive response values in metadata_json (§24: do not log
-- raw sensitive responses to public client logs or third-party analytics).
-- ============================================================================
CREATE TABLE audit_events (
  audit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID REFERENCES participants(participant_id) ON DELETE SET NULL,
  session_id    UUID REFERENCES assessment_sessions(session_id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  item_id       TEXT,
  event_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json JSONB NOT NULL DEFAULT '{}'
);
COMMENT ON TABLE audit_events IS 'PRD §22.3/§23.5/§24: append-only audit trail (completion, consent changes, integration events). UPDATE/DELETE blocked by trigger. Never log raw sensitive responses here.';
CREATE INDEX idx_audit_participant ON audit_events(participant_id, event_at);
CREATE INDEX idx_audit_session ON audit_events(session_id, event_at);

-- updated_at maintenance for participants
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_participants_updated_at
  BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
