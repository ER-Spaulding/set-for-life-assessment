-- ============================================================================
-- Owner ruling 2026-10-03, item 3 — COMPLETION IS ATOMIC.
--
-- "Refused completion must leave no scoring artifacts ... Preferred invariant:
--  validate completion eligibility first -> only then score/derive/persist
--  Snapshot. If any of those operations must occur together, use an
--  atomic/transactional boundary so a refusal or failure rolls back the
--  derived writes. Do not rely on later cleanup as the normal path."
--
-- WHY THIS MIGRATION EXISTS. The eligibility checks already ran first
-- (the lifecycle gate, the completeness check, and the F-08 resume all precede
-- any write). What was NOT true is the second half of the ruling: the writes
-- themselves were four independent PostgREST round-trips —
--
--     computed_signals upsert   <- committed on its own
--     overrides upsert          <- committed on its own
--     tensions upsert           <- committed on its own
--     snapshots insert          <- can FAIL (trigger, unique index, transient)
--     assessment_sessions flip
--
-- — and PostgREST gives each one its own transaction. So a failure at the
-- Snapshot insert rolled back NOTHING: the scoring rows were already
-- committed, against a session that has no Snapshot. That is the
-- "scoring artifacts on a session that cannot complete" state the owner
-- forbids, and it is reachable today by exactly the race the F-08 comment
-- describes: the lifecycle gate reads `in_progress`, a sweep expires the
-- session while scoring runs, and the Snapshot trigger refuses the insert.
-- The F-08 resume guard does not cover that case — it only covers a session
-- that was ALREADY `abandoned` when the gate read it.
--
-- WHY NOT JUST WRITE THE SNAPSHOT FIRST. Reordering does not fix this; it only
-- changes which artifact is stranded. Snapshots are append-only
-- (`trg_snapshots_append_only` refuses UPDATE and DELETE), so a Snapshot
-- written before the scoring rows is the one artifact that CANNOT be undone
-- and cannot be cleaned up — and a Snapshot with no signals behind it is a
-- false record. Every ordering leaves a committed prefix. Only a real
-- transaction rolls the prefix back, which is what this function is.
--
-- WHAT THIS CHANGES, AND WHAT IT DOES NOT.
--   * Scoring, interpretation, narrative assembly and the payload itself are
--     UNCHANGED and still run in the application. Nothing is re-derived in SQL;
--     the deterministic engine stays in one place (PRD §19).
--   * The completeness check stays in the application, because the required
--     item list is config-driven and the schema deliberately does not
--     duplicate it (see the OPEN QUESTION in ...0002). The function re-checks
--     LIFECYCLE eligibility, which the schema genuinely can evaluate.
--   * The function takes a row lock on the session, so the sweep race above
--     becomes impossible rather than merely detected: the sweep's UPDATE
--     waits, and whichever runs first, the other sees the committed truth.
--
-- THE COLUMN-KEY GUARD IS LOAD-BEARING, NOT DECORATION.
-- `jsonb_populate_record` SILENTLY DROPS unknown keys. Verified by execution:
-- passing {"TOTALLY_BOGUS_COLUMN":1} produced a row with every real column
-- null and no error — the same silent-miswrite class that shipped
-- `column "signal" of relation "computed_signals" does not exist` past a green
-- suite (see the comment block in lib/session/service.ts). So every row is
-- checked against an explicit allow-list and required-list BEFORE it is
-- written, and an unknown key RAISES. That keeps the guarantee the
-- schema-column-contract test provided on the JS side.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The column-key guard.
--
-- An unknown key must FAIL, never be dropped. A missing required key must fail
-- at this boundary rather than several frames later as a NOT NULL violation
-- with no indication of which row caused it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_session_assert_keys(
  p_row      jsonb,
  p_allowed  text[],
  p_required text[],
  p_what     text
) RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  k text;
BEGIN
  IF jsonb_typeof(p_row) <> 'object' THEN
    RAISE EXCEPTION
      'complete_session_atomic: % must be a JSON object, got %', p_what, jsonb_typeof(p_row);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_row) LOOP
    IF NOT (k = ANY (p_allowed)) THEN
      RAISE EXCEPTION
        'complete_session_atomic: % carries column "%", which is not a column of this table. Refusing to write a row whose key would be silently dropped.',
        p_what, k;
    END IF;
  END LOOP;

  FOREACH k IN ARRAY p_required LOOP
    IF NOT (p_row ? k) THEN
      RAISE EXCEPTION 'complete_session_atomic: % is missing required key "%"', p_what, k;
    END IF;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION complete_session_assert_keys(jsonb, text[], text[], text) IS
  'Owner ruling 2026-10-03 item 3: rejects any column key that is not real. jsonb_populate_record silently drops unknown keys, which is the silent-miswrite class this repo has already shipped once.';

-- ----------------------------------------------------------------------------
-- 2. The atomic completion.
--
-- Returns jsonb, and REFUSALS ARE DATA, not exceptions:
--     {"ok": true}
--     {"ok": false, "state": "expired"|"completed"|"unknown"}
--
-- The refusal MESSAGE is deliberately not built here. `lib/session/lifecycle.ts`
-- is the single source of the may/may-not rule and of its wording, and a second
-- copy of that sentence in SQL is exactly the two-hand-maintained-copies defect
-- the codebase already removed from LETTER_VALUES. The application maps `state`
-- through `snapshotRefusalReason()`.
--
-- A genuine FAILURE (a trigger, a unique index, a transient error) still
-- raises, and the whole transaction rolls back — which is the point.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_session_atomic(
  p_session_id uuid,
  p_now        timestamptz,
  p_signals    jsonb,
  p_overrides  jsonb,
  p_tensions   jsonb,
  p_snapshot   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Hardening: a SECURITY DEFINER function resolves unqualified names through the
-- CALLER's search_path unless it is pinned, which is the classic way a
-- definer-rights routine is hijacked by a temp schema. Pinned explicitly.
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status   text;
  v_signal   jsonb;
  v_override jsonb;
  v_tension  jsonb;
BEGIN
  IF jsonb_typeof(p_signals) <> 'array' THEN
    RAISE EXCEPTION 'complete_session_atomic: p_signals must be a JSON array';
  END IF;
  IF jsonb_typeof(p_overrides) <> 'array' THEN
    RAISE EXCEPTION 'complete_session_atomic: p_overrides must be a JSON array';
  END IF;
  IF jsonb_typeof(p_tensions) <> 'array' THEN
    RAISE EXCEPTION 'complete_session_atomic: p_tensions must be a JSON array';
  END IF;

  -- ---- LOCK, THEN RE-READ. THE DECISION IS MADE UNDER THE LOCK. ----
  --
  -- Everything the application validated was read BEFORE this call and could be
  -- stale. Reading the status again here, under a row lock, is what makes the
  -- decision binding: no sweep can change this row until this transaction ends.
  SELECT status INTO v_status
  FROM assessment_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'unknown');
  END IF;

  -- `completed` and `expired` both refuse. Anything unrecognised refuses too:
  -- a status this function cannot reason about is one whose rules it cannot
  -- apply, and guessing would be the failure mode the ruling names.
  IF v_status NOT IN ('in_progress', 'abandoned') THEN
    RETURN jsonb_build_object('ok', false, 'state', v_status);
  END IF;

  -- ---- F-08: RESUME BEFORE ANY DERIVED WRITE. ----
  --
  -- `abandoned` is inside the resumable window and may complete, but
  -- `refuse_snapshot_for_terminal_session` will refuse a Snapshot while the row
  -- still says `abandoned`. Resuming here — in the same transaction, under the
  -- lock — is what lets a participant who resumed by answering and immediately
  -- finished actually complete. The transition is identical to the one
  -- decideResponseWrite performs: status -> in_progress, lifecycle_changed_at
  -- stamped, and last_activity_at bumped so the next sweep does not
  -- re-classify a session the participant just returned to.
  IF v_status = 'abandoned' THEN
    UPDATE assessment_sessions
       SET status               = 'in_progress',
           lifecycle_changed_at = p_now,
           last_activity_at     = p_now
     WHERE session_id = p_session_id;
  END IF;

  -- ---- derived row 1: computed_signals (§22.3) ----
  FOR v_signal IN SELECT * FROM jsonb_array_elements(p_signals) LOOP
    PERFORM complete_session_assert_keys(
      v_signal,
      ARRAY['signal_id', 'raw_value', 'state', 'evidence_confidence', 'calculation_version'],
      ARRAY['signal_id', 'raw_value', 'state', 'evidence_confidence', 'calculation_version'],
      'computed_signals row'
    );
    INSERT INTO computed_signals
      (session_id, signal_id, raw_value, state, evidence_confidence, calculation_version)
    VALUES (
      p_session_id,
      v_signal ->> 'signal_id',
      (v_signal ->> 'raw_value')::numeric,
      v_signal ->> 'state',
      v_signal ->> 'evidence_confidence',
      v_signal ->> 'calculation_version'
    )
    ON CONFLICT (session_id, signal_id) DO UPDATE
      SET raw_value           = EXCLUDED.raw_value,
          state               = EXCLUDED.state,
          evidence_confidence = EXCLUDED.evidence_confidence,
          calculation_version = EXCLUDED.calculation_version;
  END LOOP;

  -- ---- derived row 2: overrides (§13.4–§13.7) ----
  FOR v_override IN SELECT * FROM jsonb_array_elements(p_overrides) LOOP
    PERFORM complete_session_assert_keys(
      v_override,
      ARRAY['override_code', 'source_item_ids', 'payload'],
      ARRAY['override_code', 'source_item_ids', 'payload'],
      'overrides row'
    );
    INSERT INTO overrides (session_id, override_code, source_item_ids, payload)
    VALUES (
      p_session_id,
      v_override ->> 'override_code',
      COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(v_override -> 'source_item_ids') AS x),
        '{}'::text[]
      ),
      COALESCE(v_override -> 'payload', '{}'::jsonb)
    )
    ON CONFLICT (session_id, override_code) DO UPDATE
      SET source_item_ids = EXCLUDED.source_item_ids,
          payload         = EXCLUDED.payload;
  END LOOP;

  -- ---- derived row 3: tensions (§15) ----
  -- evidence_payload is not supplied by the application today; it defaults to
  -- '{}' exactly as the previous PostgREST insert did, so this migration does
  -- not change a single stored value.
  FOR v_tension IN SELECT * FROM jsonb_array_elements(p_tensions) LOOP
    PERFORM complete_session_assert_keys(
      v_tension, ARRAY['tension_code'], ARRAY['tension_code'], 'tensions row'
    );
    INSERT INTO tensions (session_id, tension_code)
    VALUES (p_session_id, v_tension ->> 'tension_code')
    ON CONFLICT (session_id, tension_code) DO NOTHING;
  END LOOP;

  -- ---- the Snapshot (Addendum 01 §3, §5) ----
  PERFORM complete_session_assert_keys(
    p_snapshot,
    ARRAY[
      'report_version', 'payload_json', 'rendered_payload_json',
      'assessment_version', 'question_bank_version', 'scoring_config_version',
      'narrative_version', 'interstitial_version', 'instrument_version',
      'scoring_engine_version', 'narrative_library_version', 'snapshot_schema_version'
    ],
    ARRAY[
      'report_version', 'payload_json', 'rendered_payload_json',
      'assessment_version', 'question_bank_version', 'scoring_config_version',
      'narrative_version', 'interstitial_version', 'instrument_version',
      'scoring_engine_version', 'narrative_library_version', 'snapshot_schema_version'
    ],
    'snapshot row'
  );

  -- The two payload columns carry the SAME object by contract; writing one and
  -- not the other is the drift this layer exists to prevent. Enforced here so a
  -- caller cannot introduce it.
  IF (p_snapshot -> 'payload_json') IS DISTINCT FROM (p_snapshot -> 'rendered_payload_json') THEN
    RAISE EXCEPTION
      'complete_session_atomic: payload_json and rendered_payload_json must carry the same object';
  END IF;

  INSERT INTO snapshots (
    session_id, report_version, payload_json, rendered_payload_json,
    assessment_version, question_bank_version, scoring_config_version,
    narrative_version, interstitial_version, instrument_version,
    scoring_engine_version, narrative_library_version, snapshot_schema_version
  ) VALUES (
    p_session_id,
    p_snapshot ->> 'report_version',
    p_snapshot -> 'payload_json',
    p_snapshot -> 'rendered_payload_json',
    p_snapshot ->> 'assessment_version',
    p_snapshot ->> 'question_bank_version',
    p_snapshot ->> 'scoring_config_version',
    p_snapshot ->> 'narrative_version',
    p_snapshot ->> 'interstitial_version',
    p_snapshot ->> 'instrument_version',
    p_snapshot ->> 'scoring_engine_version',
    p_snapshot ->> 'narrative_library_version',
    p_snapshot ->> 'snapshot_schema_version'
  );

  -- ---- the terminal transition, last, in the same transaction ----
  UPDATE assessment_sessions
     SET status       = 'completed',
         completed_at = p_now
   WHERE session_id = p_session_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

COMMENT ON FUNCTION complete_session_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) IS
  'Owner ruling 2026-10-03 item 3: the single atomic boundary for completion. Scoring rows, overrides, tensions, the Snapshot and the status flip commit together or not at all — so a refusal or failure can never leave derived rows on a session with no Snapshot. Refusals are returned as {"ok":false,"state":...}; genuine failures raise and roll back.';

-- Only the service role may invoke it, matching erase_participant's posture.
REVOKE ALL ON FUNCTION complete_session_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_session_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_session_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION complete_session_assert_keys(jsonb, text[], text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_session_assert_keys(jsonb, text[], text[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_session_assert_keys(jsonb, text[], text[], text) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Self-verification, on the pattern the other migrations use.
--
-- EXERCISES the guard rather than asserting it exists: the key check must
-- actually REFUSE an unknown column. A migration that only proves a function
-- was created proves nothing about whether it protects anything.
-- ----------------------------------------------------------------------------
-- EACH CASE MUST FAIL FOR ITS OWN REASON, AND THAT NEEDED FIXING.
--
-- The first version of this block paired its unknown-key case with a row that
-- was ALSO missing a required key — `{"bogus_column": 1}` against an allow-list
-- of `real_column` and a required-list of `real_column`. Both checks raise, so
-- the block reported "the unknown key was refused" when in fact the MISSING-key
-- check had done the refusing. Deleting the unknown-key loop entirely still
-- passed: verified by mutation, which is how this was found. This is the same
-- false-green shape as the stubbed DB that accepted any column name — the test
-- passed on the defect it was written to catch.
--
-- Each case below now isolates exactly one condition: the row carries EVERY
-- required key, and differs from the valid row in one way only. The control
-- case (4) exists so the block cannot pass by refusing everything.
DO $verify$
DECLARE
  v_refused_unknown boolean := false;
  v_refused_missing boolean := false;
  v_accepts_valid   boolean := false;
  v_msg             text;
BEGIN
  -- 1. KNOWN required keys + one UNKNOWN key -> only the unknown-key check can
  --    raise. `real_column` is present, so case 2's condition does not apply.
  BEGIN
    PERFORM complete_session_assert_keys(
      '{"real_column": 1, "bogus_column": 2}'::jsonb,
      ARRAY['real_column'], ARRAY['real_column'], 'self-test'
    );
  EXCEPTION WHEN others THEN
    v_refused_unknown := true;
    v_msg := SQLERRM;
  END;
  IF NOT v_refused_unknown THEN
    RAISE EXCEPTION
      'self-verification FAILED: the column-key guard ACCEPTED a row carrying an unknown key. jsonb_populate_record would silently drop it, which is the exact silent-miswrite this function exists to prevent.';
  END IF;
  -- ...and it must have failed ON THE UNKNOWN KEY, not incidentally.
  IF v_msg NOT LIKE '%bogus_column%' THEN
    RAISE EXCEPTION
      'self-verification FAILED: the unknown-key case raised, but not because of the unknown key (got: %). A case that fails for another reason cannot prove this guard works.',
      v_msg;
  END IF;

  -- 2. NO unknown keys, but a required key is ABSENT -> only the required-key
  --    check can raise.
  BEGIN
    PERFORM complete_session_assert_keys(
      '{"real_column": 1}'::jsonb,
      ARRAY['real_column', 'other'], ARRAY['real_column', 'other'], 'self-test'
    );
  EXCEPTION WHEN others THEN
    v_refused_missing := true;
    v_msg := SQLERRM;
  END;
  IF NOT v_refused_missing THEN
    RAISE EXCEPTION 'self-verification FAILED: the column-key guard accepted a row missing a required key';
  END IF;
  IF v_msg NOT LIKE '%other%' THEN
    RAISE EXCEPTION
      'self-verification FAILED: the missing-key case raised, but not because of the missing key (got: %)',
      v_msg;
  END IF;

  -- 3. A well-formed row must still be ACCEPTED — otherwise the guard above
  --    would pass by refusing everything, which is a false green.
  BEGIN
    PERFORM complete_session_assert_keys(
      '{"real_column": 1}'::jsonb, ARRAY['real_column'], ARRAY['real_column'], 'self-test'
    );
    v_accepts_valid := true;
  EXCEPTION WHEN others THEN
    v_accepts_valid := false;
  END;
  IF NOT v_accepts_valid THEN
    RAISE EXCEPTION 'self-verification FAILED: the column-key guard rejected a valid row';
  END IF;
END;
$verify$;

-- ----------------------------------------------------------------------------
-- 4. Tell PostgREST the new function exists.
--
-- NOT DECORATION — this is the difference between the fix working and the app
-- 500ing on a working database. supabase-js reaches plpgsql through PostgREST,
-- which caches the schema and does NOT notice a new function until told. Without
-- this, `.rpc("complete_session_atomic")` returns "function not found" until the
-- next unrelated reload — a deployment failure that no unit test can see,
-- because every test fakes the client. Same failure class as the storage bucket
-- that shipped missing while the suite was green.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;
