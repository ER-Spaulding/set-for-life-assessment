-- ============================================================================
-- Persisted Snapshot payload + PDF document records.
--
-- Governs: PRD Addendum 01 §3 (persist once at completion), §5 (ONE payload,
--          TWO renderers), §7 (server-generated, privately stored PDF),
--          §15 (storage & data requirements).
--
-- WHY THIS EXISTS.
--
-- `snapshots` was defined but NEVER WRITTEN. `loadSnapshot` recomputed the
-- payload from computed_signals + tensions on every read. Addendum §5 makes
-- that a correctness problem, not an inefficiency:
--
--   "The web results and PDF must use the same completed, immutable
--    snapshot_payload. The application must not rescore for PDF ... or generate
--    different conclusions for web and PDF."
--
-- A payload recomputed on read cannot satisfy that: a config recalibration
-- between two reads would silently change what a participant's Snapshot says,
-- and the PDF could disagree with the page it was downloaded from. The payload
-- must be computed ONCE, at completion, and stored.
--
-- §3: "The PDF is an artifact of this Snapshot. The PDF is not the source of
-- truth." So the payload is the durable object and the PDF row only points at it.
--
-- NO DATA LOSS. The existing `rendered_payload_json` column is kept as-is and
-- the new `payload_json` is populated alongside it; nothing is dropped, because
-- the append-only trigger means any row already written cannot be migrated in
-- place. New rows write both, so either name resolves.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- snapshots — the version fields Addendum §3 requires the payload to preserve.
--
-- §3 lists: snapshot_id, participant_id, assessment/session_id,
-- assessment_version, question_bank_version, scoring_engine/config_version,
-- narrative_version, report_version, completion timestamp, complete payload.
--
-- participant_id is reached via session_id (NOT duplicated here) — a second
-- copy could drift from the session's, and §22.2 makes the session the record
-- of who this belongs to.
-- ----------------------------------------------------------------------------

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS payload_json           JSONB,
  ADD COLUMN IF NOT EXISTS assessment_version     TEXT,
  ADD COLUMN IF NOT EXISTS question_bank_version  TEXT,
  ADD COLUMN IF NOT EXISTS scoring_config_version TEXT,
  ADD COLUMN IF NOT EXISTS narrative_version      TEXT;

COMMENT ON COLUMN snapshots.payload_json IS
  'Addendum 01 §5/§15: the ONE immutable completed Snapshot payload. Both the web results experience and the PDF render from this — never from a live rescore. NULL only for rows written before this migration.';
COMMENT ON COLUMN snapshots.report_version IS
  'Addendum 01 §7.1: report version, surfaced in the PDF footer and metadata.';
COMMENT ON COLUMN snapshots.rendered_payload_json IS
  'Superseded by payload_json. Retained so pre-migration rows remain readable; new writes populate BOTH with the same object.';

-- One Snapshot per completion. §3 treats the completed Snapshot as the
-- immutable historical output, so a second row for the same session would mean
-- two "truths" for one assessment. `session_id` alone is the key (not
-- session+version): a new report_version is a re-render of the SAME payload,
-- which is what snapshot_documents is for.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_session_unique
  ON snapshots(session_id);

-- ----------------------------------------------------------------------------
-- snapshot_documents — the generated PDF artifacts (Addendum §15).
--
-- §7/§15: "The PDF is an artifact of the Snapshot, not the source of truth."
-- So this table holds ONLY generation metadata and a storage pointer — never
-- interpretation, never a second copy of the payload. Regenerating the PDF
-- updates this row; it can never change what the Snapshot says.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS snapshot_documents (
  document_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id         UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  format              TEXT NOT NULL CHECK (format IN ('pdf')),
  storage_object_key  TEXT,
  generation_status   TEXT NOT NULL CHECK (generation_status IN ('pending', 'succeeded', 'failed')),
  generated_at        TIMESTAMPTZ,
  checksum            TEXT,
  error_code          TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One document per snapshot per format: a retry UPDATES this row rather than
  -- appending a second artifact, so "the PDF for this Snapshot" stays a
  -- single-valued fact.
  UNIQUE (snapshot_id, format)
);

COMMENT ON TABLE snapshot_documents IS
  'PRD Addendum 01 §7/§15: generated PDF artifacts. Artifact metadata + private storage pointer ONLY — never interpretation and never a copy of the payload. The Snapshot payload is the source of truth; this table records that a render of it exists and where.';

CREATE INDEX IF NOT EXISTS idx_snapshot_documents_snapshot
  ON snapshot_documents(snapshot_id);

-- ----------------------------------------------------------------------------
-- Generation status transitions, guarded at the database.
--
-- §7.3: "If PDF generation fails ... the completed assessment remains complete;
-- the web Snapshot remains available; the payload remains stored." Those
-- guarantees live in the FEATURE, but the row must not be able to claim a
-- success it has no artifact for — a 'succeeded' row with no storage key or no
-- checksum is a lie the download CTA would act on.
-- ----------------------------------------------------------------------------
ALTER TABLE snapshot_documents
  DROP CONSTRAINT IF EXISTS snapshot_documents_succeeded_has_artifact;

ALTER TABLE snapshot_documents
  ADD CONSTRAINT snapshot_documents_succeeded_has_artifact CHECK (
    generation_status <> 'succeeded'
    OR (storage_object_key IS NOT NULL AND generated_at IS NOT NULL AND checksum IS NOT NULL)
  );

COMMENT ON CONSTRAINT snapshot_documents_succeeded_has_artifact ON snapshot_documents IS
  'Addendum 01 §14/§7.3: a row may only claim generation succeeded if it actually holds an artifact — storage key, timestamp and checksum. Without this, the download CTA could offer a file that does not exist.';

-- RLS: private by default, same posture as every participant table
-- (migration ...0003 grants no anon/authenticated policy anywhere).
ALTER TABLE snapshot_documents ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance, matching trg_participants_updated_at's pattern.
CREATE OR REPLACE FUNCTION touch_snapshot_document_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_documents_updated_at ON snapshot_documents;
CREATE TRIGGER trg_snapshot_documents_updated_at
  BEFORE UPDATE ON snapshot_documents
  FOR EACH ROW EXECUTE FUNCTION touch_snapshot_document_updated_at();
