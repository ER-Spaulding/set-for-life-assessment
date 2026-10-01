-- ============================================================================
-- First-party analytics events (Addendum 02 v1.1 §16).
--
-- OPERATOR DECISION 2026-10-01: first-party in Supabase. No third-party vendor.
-- "The purpose is product/operational measurement, not collection of participant
-- financial content."
--
-- WHAT §16 ASKS FOR. The addendum names the events (opening_first_time_selected,
-- save_progress_offered, money_moment_viewed, abandonment point, completion
-- time, …) and sets one hard constraint:
--
--   "Do not send raw financial answers to third-party analytics."
--
-- It does NOT specify a destination, a retention period, or an access model.
-- This migration supplies the destination AND makes the retention question
-- explicit rather than silently inventing an answer — see below.
--
-- WHY A TABLE RATHER THAN A VENDOR, beyond the operator's instruction: the §16
-- events are a small fixed set answering questions about THIS product's funnel
-- (does removing the identity wall improve starts? where do people volunteer to
-- save?). That is first-party product measurement, not behavioural analytics a
-- vendor earns its keep on — and keeping it in-project makes "no raw answers to
-- third parties" true by construction rather than by configuration review.
--
-- ---------------------------------------------------------------------------
-- THE PAYLOAD CONSTRAINT IS ENFORCED, NOT DOCUMENTED.
--
-- The requirement forbids raw answers, free-text financial content, Snapshot
-- narrative, financial amounts, and household income from event payloads. A
-- policy note cannot enforce that; the next developer adding an event will not
-- read it. So:
--
--   1. The event NAME is constrained to a closed list. A new event requires a
--      migration, which is a review point rather than a silent addition.
--   2. The payload is validated for shape: flat, scalars only, bounded key
--      count and value length. No nested objects, no arrays — which rules out
--      smuggling a response blob into a "metadata" field.
--   3. The forbidden keys are named explicitly and rejected by name.
--
-- This is defence in depth for a data-minimisation rule. It cannot know whether
-- an arbitrary string CONTAINS financial content, but it makes the obvious paths
-- impossible and makes the rest a deliberate act.
-- ---------------------------------------------------------------------------
--
-- RETENTION — DELIBERATELY NOT DECIDED HERE.
--
-- The governing specification provides no retention period, and the operator was
-- explicit: "Do not silently invent a permanent retention period if the
-- governing specification does not provide one; surface that as a privacy/product
-- decision."
--
-- So this table has NO automatic expiry and NO TTL. It records `retain_until` as
-- NULL and a companion view lists what is being kept indefinitely, so the
-- decision is visible rather than implicit. Choosing a period is a privacy
-- decision awaiting the operator — recorded in docs/ANALYTICS.md.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The closed event vocabulary (§16). A CHECK rather than an enum so adding one
  -- is a migration — a review point, not a silent write.
  event_name   TEXT NOT NULL CHECK (event_name IN (
    'assessment_started',
    'assessment_resumed',
    'assessment_completed',
    'assessment_abandoned',
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
  )),

  -- Correlators. Present so a funnel can be reconstructed; NOT a place to put
  -- participant content. Nullable because some events (a system error, a page
  -- view before a session exists) legitimately have neither.
  participant_id UUID REFERENCES participants(participant_id) ON DELETE CASCADE,
  session_id     UUID REFERENCES assessment_sessions(session_id) ON DELETE CASCADE,

  -- Flat scalar detail ONLY: e.g. {"position": 12, "moment": "MM03"}.
  -- Constrained by analytics_payload_is_safe() below.
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Coarse bucketing happens at write time so no finer-grained locator is
  -- stored than the measurement needs.
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- See RETENTION above: NULL means "no expiry decided", which is the honest
  -- state rather than a fabricated default.
  retain_until   TIMESTAMPTZ
);

COMMENT ON TABLE analytics_events IS
  'Addendum 02 v1.1 §16: first-party product/operational measurement. NEVER carries raw answers, free-text financial content, narrative, amounts, or household income — payload shape is enforced by CHECK. Retention is UNDECIDED (retain_until NULL); see docs/ANALYTICS.md.';

COMMENT ON COLUMN analytics_events.retain_until IS
  'NULL = no retention period has been decided. Deliberately not defaulted: the governing spec provides none, and inventing one silently would be a privacy decision made by accident.';

-- ----------------------------------------------------------------------------
-- Payload validation.
--
-- A function rather than an inline CHECK because the rule is structural, and a
-- CHECK cannot loop. Returns TRUE only for a flat object of scalars.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_payload_is_safe(p JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  k TEXT;
  v JSONB;
BEGIN
  IF p IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN FALSE; END IF;

  -- Bounded size: a "payload" with 50 keys is not a measurement, it is a record.
  IF (SELECT count(*) FROM jsonb_object_keys(p)) > 12 THEN RETURN FALSE; END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(p) LOOP
    -- Nested structures are refused outright. An object or array is the
    -- obvious way a response blob could be smuggled into "metadata".
    IF jsonb_typeof(v) NOT IN ('string', 'number', 'boolean') THEN RETURN FALSE; END IF;
    -- Bounded value length, so a free-text answer cannot ride in as a string.
    IF jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 64 THEN RETURN FALSE; END IF;

    -- ---------------------------------------------------------------------
    -- ALLOW-LIST, NOT DENY-LIST. This started as a deny-list of forbidden key
    -- names and it FAILED: {"q1":"Q1_A"} was accepted, because "q1" is not a
    -- forbidden word — the KEY was innocuous and the VALUE was an option code.
    -- A deny-list can only ever reject the leaks someone thought of.
    --
    -- An allow-list inverts that. A key must be one of these known-neutral
    -- measurement fields, so an answer cannot arrive under an unanticipated
    -- name. Adding a field is a migration, which is the review point.
    --
    -- These names are deliberately structural (where, which, how many), never
    -- substantive (what did they answer).
    -- ---------------------------------------------------------------------
    IF lower(k) NOT IN (
      'position',        -- progress index, e.g. 12
      'step',            -- named stage, e.g. "profile"
      'moment',          -- Money Moment id, e.g. "MM03"
      'decision',        -- "used" | "skipped" | "offered"
      'outcome',         -- "completed" | "abandoned" | "failed"
      'channel',         -- "email" | "mobile"
      'ok',              -- boolean result of an operation
      'retry',           -- retry count
      'count',           -- a count
      'duration_ms',     -- elapsed time
      'code',            -- a SYSTEM error code, never a response code
      'surface',         -- "web" | "pdf"
      'stage'            -- funnel stage label
    ) THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION analytics_payload_is_safe(JSONB) IS
  'Addendum 02 v1.1 §16: refuses nested structures, oversized payloads, and named sensitive fields. Enforces data minimisation at the database, because a policy note does not stop the next developer.';

ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_payload_safe;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_payload_safe CHECK (analytics_payload_is_safe(payload));

-- ----------------------------------------------------------------------------
-- RLS: same posture as every other participant-adjacent table.
--
-- service_role only. No anon or authenticated policy exists, which is what makes
-- "enforce appropriate access controls" true at the database rather than at the
-- application layer — a client holding an anon key can read nothing here.
-- ----------------------------------------------------------------------------
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS server_full_access_analytics_events ON analytics_events;
CREATE POLICY server_full_access_analytics_events
  ON analytics_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes for the funnel questions §16 actually asks. Ordered by time within a
-- session (reconstructing a journey) and by name (counting occurrences).
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_time
  ON analytics_events(session_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time
  ON analytics_events(event_name, occurred_at);

-- ----------------------------------------------------------------------------
-- The retention decision, made visible.
--
-- A view rather than a comment, so an operator can SEE how much is being held
-- with no expiry. If this ever returns a large row count, that is the signal to
-- decide the period — not a surprise discovered during a privacy review.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics_retention_status AS
SELECT
  count(*) FILTER (WHERE retain_until IS NULL) AS events_with_no_retention_decided,
  count(*) FILTER (WHERE retain_until IS NOT NULL AND retain_until < now())
                                               AS events_past_retention,
  count(*)                                     AS events_total,
  min(occurred_at)                             AS oldest_event,
  max(occurred_at)                             AS newest_event
FROM analytics_events;

COMMENT ON VIEW analytics_retention_status IS
  'Addendum 02 v1.1 §16 / operator 2026-10-01: surfaces the UNDECIDED retention policy. "Do not silently invent a permanent retention period" — so the state of the decision is queryable rather than assumed.';
