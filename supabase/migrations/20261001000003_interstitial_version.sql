-- ============================================================================
-- Pin the INTERSTITIAL version on the Snapshot (Addendum 01 v1.1 §3.1).
--
-- §3.1 requires completion to "pin assessment, question-bank, scoring/config,
-- narrative, INTERSTITIAL, and report versions."
--
-- The Step 1 payload pinned five of those six. The interstitial version was
-- missing — and it is not bookkeeping. The Money Moments (Addendum 02 v1.1 §9)
-- and the synthesis reveal (Addendum 01 v1.1 §4) are both interstitial content,
-- so without this pin a stored Snapshot cannot reproduce which pacing and which
-- reveal the participant actually saw. A cohort that completed under revised
-- interstitial copy would be indistinguishable from one that did not, which is
-- exactly the attribution the payload exists to provide.
--
-- NULLABLE, deliberately. Rows written before this migration have no
-- interstitial version and none can be invented for them — the same call the
-- payload migration made for `payload_json`. New writes always populate it, so
-- "NULL" unambiguously means "completed before the pin existed" rather than
-- "unknown".
--
-- Also mirrored INTO the payload's own `versions` object, which is where the
-- renderers read it from; this column exists so the version is queryable in SQL
-- without parsing JSONB.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS interstitial_version TEXT;

COMMENT ON COLUMN snapshots.interstitial_version IS
  'Addendum 01 v1.1 §3.1: the interstitial (Money Moments + synthesis reveal) version in force at completion. NULL only for rows written before this migration. Mirrors snapshots.payload_json -> versions.interstitial.';
