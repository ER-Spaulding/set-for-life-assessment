-- ============================================================================
-- Emulate the Supabase `storage` schema so migrations that provision private
-- buckets can be executed and verified on a plain PostgreSQL instance
-- (scripts/verify-migrations.sh).
--
-- WHY THIS EXISTS.
--
-- supabase/migrations/20261001000013_snapshot_documents_storage.sql inserts the
-- private `snapshot-documents` bucket INSIDE a guard:
--
--     IF EXISTS (SELECT 1 FROM information_schema.schemata
--                WHERE schema_name = 'storage') THEN ... INSERT ... END IF;
--
-- The guard exists so the chain applies cleanly on a plain Postgres where the
-- Supabase `storage` schema is absent — but that same guard means the bucket
-- branch NEVER EXERCISES there, and the PDF generation failed in the live
-- environment because the bucket did not exist. This stub creates the minimal
-- `storage` schema (and only the `storage.buckets` columns the migration
-- inserts into) so the chain actually runs the bucket INSERT instead of
-- silently skipping it.
--
-- The real Supabase `storage.buckets` table has more columns (owner,
-- created_at, updated_at, file_size_limit, allowed_mime_types, ...); only
-- `id`, `name`, `public` are needed here, plus a primary key so the migration's
-- `ON CONFLICT (id) DO NOTHING` resolves. No storage.objects table is needed:
-- the migration deliberately creates NO policy on storage.objects, so nothing
-- here needs to stand in for it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false
);
