-- ============================================================================
-- Set for Life Financial Assessment
-- The four immutable version identifiers on a Snapshot.
--
-- Governs: PRD §22.6 (version fields), Addendum 01 §3.1 (version pinning),
--          operator decision 2026-10-01.
--
-- WHAT THE OPERATOR ASKED FOR, verbatim:
--
--   "Implement separate immutable version identifiers for:
--      - instrument_version — assessment/question/response structure;
--      - scoring_engine_version — scoring, override, tension and synthesis logic;
--      - narrative_library_version — approved participant-facing narrative library;
--      - snapshot_schema_version — structure/version of the persisted snapshot_payload.
--    Every newly completed Snapshot must persist all four identifiers at creation.
--    Those identifiers become part of the immutable historical Snapshot record."
--
-- WHY FOUR SEPARATE COLUMNS rather than one JSON blob. The existing
-- `snapshots` row already carries five version columns (assessment_version,
-- question_bank_version, scoring_config_version, narrative_version,
-- interstitial_version). What it does NOT carry is the fourth identifier —
-- snapshot_schema_version — and that is the one the requirement turns on: the
-- other three describe what PRODUCED the content, none describes how the content
-- is STRUCTURED. Change the payload's shape while instrument, engine and
-- narrative all stand still, and without a schema marker a reader applies
-- new-shape parsing to an old-shape object and is confidently wrong.
--
-- The four new columns are deliberately NOT backfilled with invented values.
--
-- BACKFILL CONSEQUENCE, stated before it is applied — the operator's instruction
-- was "backfill only versions that can be truthfully established ... Do not
-- manufacture precision. If an historical version cannot be established with
-- confidence, surface that before migration rather than inventing a value."
--
--   VERIFIED BEFORE WRITING THIS: `SELECT count(*) FROM snapshots` returns 0.
--   The table is empty. Four sessions are marked completed, but none has a
--   Snapshot row — established during the version-semantics trace, where I ran a
--   real completion end-to-end to prove the write path works (it produced
--   exactly one row, with all six existing version pins set).
--
--   So this migration touches ZERO rows and backfills nothing. That is the
--   honest outcome, not a shortcut: there is no historical Snapshot whose
--   versions could be established, and therefore nothing to establish.
--
--   The four completed sessions that HAVE no Snapshot are a separate, pre-existing
--   matter. They completed before the snapshot-write code was deployed, so their
--   payloads cannot be reconstructed without recomputing under today's config —
--   which would stamp today's engine with "1.0" and be exactly the silent
--   relabelling this whole exercise forbids. They are left as they are, and the
--   gap is recorded rather than papered over.
--
-- BACKWARD COMPATIBILITY. Every column is nullable with NO DEFAULT. A default
-- would label rows by accident — the failure mode the old hardcoded
-- PINNED_VERSION already demonstrated, where a value kept claiming "1.0" after
-- the config moved. Absence is meaningful and is read as "written by the 1.0
-- assembler" in code, which is historically accurate rather than convenient.
--
-- NOTHING ELSE CHANGES. No existing column is altered, renamed or retyped. No
-- participant answer, scoring result, narrative or Snapshot payload is touched.
-- ADD COLUMN on an empty table takes no lock of consequence.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- The four identifiers, as queryable columns.
--
-- Mirrored inside the payload at versions.instrument / .scoringEngine /
-- .narrativeLibrary / .snapshotSchema — the same dual-write the interstitial pin
-- already uses, so a reader can find them without parsing JSONB and a SQL query
-- can filter on them without knowing the payload shape.
-- ----------------------------------------------------------------------------
ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS instrument_version        TEXT,
  ADD COLUMN IF NOT EXISTS scoring_engine_version    TEXT,
  ADD COLUMN IF NOT EXISTS narrative_library_version TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_schema_version   TEXT;

COMMENT ON COLUMN snapshots.instrument_version IS
  'Operator decision 2026-10-01: assessment/question/response structure version, read from config/assessment-v1.0.json at completion. Immutable once written.';
COMMENT ON COLUMN snapshots.scoring_engine_version IS
  'Operator decision 2026-10-01: scoring, override, tension and synthesis logic version, read from config/scoring-v1.0.json at completion. Immutable once written.';
COMMENT ON COLUMN snapshots.narrative_library_version IS
  'Operator decision 2026-10-01: approved participant-facing narrative library version, read from config/narratives-v1.0.json at completion. Immutable once written.';
COMMENT ON COLUMN snapshots.snapshot_schema_version IS
  'Operator decision 2026-10-01: STRUCTURE version of the persisted snapshot_payload. The one identifier not derivable from the others: it changes when the payload SHAPE changes, even if instrument, engine and narrative library all stand still. A reader that does not recognise this value must refuse to interpret the payload rather than guess. NULL only for rows written before this migration, which are read as the implicit 1.0 assembler.';

-- ----------------------------------------------------------------------------
-- A view answering "how many Snapshots predate the four identifiers?"
--
-- Same purpose as analytics_retention_status: the undecided or unattributed
-- state is QUERYABLE, so a version review sees a number rather than discovering
-- the gap later. After this migration the answer is trivially zero (the table is
-- empty), and it should STAY zero — a non-zero count means something wrote a
-- Snapshot without the four identifiers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW snapshot_version_coverage AS
SELECT
  count(*)                                                  AS snapshots_total,
  count(*) FILTER (WHERE instrument_version        IS NULL) AS missing_instrument,
  count(*) FILTER (WHERE scoring_engine_version    IS NULL) AS missing_scoring_engine,
  count(*) FILTER (WHERE narrative_library_version IS NULL) AS missing_narrative_library,
  count(*) FILTER (WHERE snapshot_schema_version   IS NULL) AS missing_snapshot_schema,
  count(DISTINCT snapshot_schema_version)                   AS distinct_schemas
FROM snapshots;

COMMENT ON VIEW snapshot_version_coverage IS
  'Operator decision 2026-10-01: how many Snapshots carry each of the four required version identifiers. A non-zero missing_* after the writer change means something persisted a Snapshot without recording its provenance.';

-- ----------------------------------------------------------------------------
-- Backfill: DELIBERATELY NONE.
--
-- Recording the decision rather than leaving its absence to be inferred. There
-- is nothing to backfill (the table is empty), and if there were, the four
-- completed-but-payload-less sessions show why inventing values is wrong: their
-- payloads would have to be recomputed under today's config, and the result
-- would carry today's identifiers while claiming to be the historical artifact.
-- That is the silent relabelling the operator forbade.
--
-- If a future migration finds non-empty `snapshots` with NULL schema versions,
-- the correct action is to READ them as the implicit legacy schema (which
-- lib/assessment/versions.ts already does) and NOT to stamp a value.
-- ----------------------------------------------------------------------------

COMMIT;
