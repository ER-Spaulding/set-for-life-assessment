import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Storage REPRODUCIBILITY cross-check — Addendum 01 §7, §8, §11, §15.
 *
 * WHY THIS FILE EXISTS.
 *
 * The PDF storage bucket shipped broken in the live environment because the
 * migration that creates it (supabase/migrations/20261001000013) inserts the
 * bucket ONLY inside a guard for the Supabase `storage` schema — a schema the
 * zero-state migration verifier (scripts/verify-migrations.sh) did not have, so
 * the branch never ran there. Every test mocked storage, so nothing caught it.
 *
 * The fix is three pieces of plumbing, and this file pins them against their own
 * drift so they cannot silently revert to "mocked storage, skipped bucket":
 *
 *   1. scripts/supabase-local-storage.sql — a minimal `storage.buckets` stub the
 *      verifier applies, so migration ...00013 EXERCISES the bucket branch.
 *   2. scripts/verify-migrations.sh — applies that stub, seeds the pinned
 *      assessment version (so the chain reaches ...00013 at all), and after the
 *      chain asserts the private bucket row was actually created.
 *   3. scripts/verify-storage-bucket.mjs — a deployment guard that talks to the
 *      REAL Supabase Storage API (service role + anon), and must NOT be mocked.
 *
 * These assertions read the scripts/migrations as text, exactly like
 * snapshot-document-storage.test.ts reads the migration files — the point is to
 * pin that the real-API guard and the bucket-exercising verifier exist and are
 * wired, not to re-run a live network call inside the test suite.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

const STORAGE_STUB = read("scripts/supabase-local-storage.sql");
const VERIFIER = read("scripts/verify-migrations.sh");
const GUARD = read("scripts/verify-storage-bucket.mjs");
const STORAGE_MIGRATION = read("supabase/migrations/20261001000013_snapshot_documents_storage.sql");

describe("the migration verifier EXERCISES the storage bucket branch", () => {
  it("provisions a storage.buckets stub with the columns the migration inserts", () => {
    expect(STORAGE_STUB).toMatch(/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+storage/i);
    expect(STORAGE_STUB).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+storage\.buckets/i);
    for (const col of ["id", "name", "public"]) {
      expect(STORAGE_STUB, `storage.buckets stub must define ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // The migration's ON CONFLICT (id) needs a unique id.
    expect(STORAGE_STUB).toMatch(/PRIMARY\s+KEY/i);
  });

  it("applies the stub and seeds the pinned version so the chain reaches ...00013", () => {
    // The stub must be applied before the migration loop.
    expect(VERIFIER).toMatch(/STORAGE_SQL=.*supabase-local-storage\.sql/);
    expect(VERIFIER).toMatch(/apply_sql "STUB "/);
    // The pinned assessment_versions seed must be wired after the initial schema,
    // or migration ...00012's self-verification aborts on an empty table and the
    // chain never reaches the storage migration.
    expect(VERIFIER).toMatch(/SEED_DIR=.*supabase\/seed/);
    expect(VERIFIER).toMatch(/20260930000001_initial_schema\.sql/);
    expect(VERIFIER).toMatch(/apply_sql "SEED "/);
  });

  it("asserts the private bucket row exists AFTER the chain (fails loudly if it skipped)", () => {
    // The post-chain check: if migration ...00013 skipped its INSERT (storage
    // schema absent), this must fail the verifier rather than pass silently.
    expect(VERIFIER).toMatch(/select public from storage\.buckets where id = 'snapshot-documents'/);
    expect(VERIFIER).toMatch(/FAIL: snapshot-documents bucket NOT created/);
    expect(VERIFIER).toMatch(/must be private/);
  });
});

describe("the deployment guard hits the REAL storage API, never a mock", () => {
  it("reads the bucket via the real service-role Storage API", () => {
    // The shipped bug was invisible because storage was mocked. The guard must
    // call the same API lib/snapshot/document.ts uses, not a stand-in.
    expect(GUARD).toMatch(/storage\.getBucket\(/);
    expect(GUARD).toMatch(/createClient\(/);
    expect(GUARD).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("fails loudly when the bucket is absent or public", () => {
    expect(GUARD).toMatch(/process\.exit\(1\)/);
    expect(GUARD).toMatch(/absent or unreachable/);
    expect(GUARD).toMatch(/is PUBLIC/);
  });

  it("does not mock storage", () => {
    expect(GUARD).not.toMatch(/vi\.mock/i);
    expect(GUARD).not.toMatch(/jest\.mock/i);
  });
});

describe("the migration keeps the bucket private with signed downloads", () => {
  it("creates the bucket NOT public, with no public read policy", () => {
    expect(STORAGE_MIGRATION).toContain("snapshot-documents");
    expect(STORAGE_MIGRATION).toMatch(/public\s*\)\s*VALUES\s*\([^)]*snapshot-documents[^)]*false/);
    expect(STORAGE_MIGRATION).not.toMatch(/CREATE\s+POLICY/i);
  });
});
