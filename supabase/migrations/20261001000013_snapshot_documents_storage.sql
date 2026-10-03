-- ============================================================================
-- Private storage for generated Snapshot PDFs (Addendum 01 §7, §8, §11, §15).
--
-- Governs: PRD Addendum 01 §7 (server-generated, privately stored PDF),
--          §8 (signed/time-limited download), §11 (storage & security),
--          §15 (storage & data requirements).
--
-- §11: "A participant may not retrieve another participant's Snapshot or PDF."
-- The bucket below is PRIVATE (`public = false`) and — crucially — NO public
-- read policy is granted on `storage.objects`. Supabase Storage enables RLS on
-- `storage.objects` by default with no anon/authenticated policy, so only the
-- service role (used by lib/snapshot/document.ts, server-only) can upload or
-- download an object. The participant-facing download route streams bytes
-- server-side and never exposes an object URL or a storage_object_key, so there
-- is nothing for a participant to enumerate or guess.
--
-- The object key is `snapshots/{document_id}.pdf` — `document_id` is the random
-- UUID primary key of `snapshot_documents` (migration ...0001), so the key is
-- unguessable even to the service role before the row exists.
--
-- Idempotent: safe to re-run. Wrapped in a schema-existence guard so the
-- migration chain still applies cleanly on a plain Postgres (scripts/
-- verify-migrations.sh) where the Supabase `storage` schema is absent.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('snapshot-documents', 'snapshot-documents', false)
    ON CONFLICT (id) DO NOTHING;

    -- No storage.objects policy is created for this bucket. Private by default:
    -- service_role only. This comment is the load-bearing statement that the
    -- absence of a policy is deliberate, not an omission.
  END IF;
END $$;
