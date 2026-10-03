#!/usr/bin/env node
// Deployment/integration guard — Addendum 01 §7, §8, §11, §15.
//
// Fails loudly when the private PDF storage bucket is missing or public in the
// REAL Supabase project. This is the guard the shipped bug lacked: every test
// mocked storage, so the bucket's absence was invisible until the first real
// PDF generation 500'd. This script talks to the real Storage REST API with the
// service-role key — the SAME API surface lib/snapshot/document.ts uses at
// runtime (`db.storage.from(bucket).upload/download`) — so a pass here means
// upload/download has a bucket to land in.
//
// USAGE (run before a pilot deploy):
//   node scripts/verify-storage-bucket.mjs
//   node scripts/verify-storage-bucket.mjs --bucket missing-name   # mutation check
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// NEXT_PUBLIC_SUPABASE_ANON_KEY from the environment or .env.local.
// Never prints a credential.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---- env loading (never echoes secrets) ----
function loadDotEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    // .env.local is optional when env vars are already exported.
  }
}
loadDotEnvLocal();

let bucket = process.env.SFL_STORAGE_BUCKET ?? "snapshot-documents";
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--bucket") {
    const value = process.argv[i + 1];
    // A missing value must NOT fall back to the default bucket. `--bucket` with
    // nothing after it is a truncated command, and silently checking the
    // DEFAULT bucket would print PASS while the operator believed they were
    // probing a missing one — a false green in the one script whose whole job
    // is to fail loudly rather than skip. Same class as a flag that is parsed
    // but ignored.
    if (value === undefined || value.startsWith("--")) {
      console.error("FAIL: --bucket requires a value (e.g. --bucket=snapshot-documents).");
      console.error("      Refusing to fall back to the default bucket: a truncated command must not report PASS.");
      process.exit(2);
    }
    bucket = value;
    i++;
  } else if (arg.startsWith("--bucket=")) {
    const value = arg.slice("--bucket=".length);
    if (!value) {
      console.error("FAIL: --bucket= requires a value (e.g. --bucket=snapshot-documents).");
      process.exit(2);
    }
    bucket = value;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("FAIL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (set in env or .env.local).");
  process.exit(2);
}

const serviceClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-application-name": "set-for-life-assessment" } },
});

// 1. The bucket must exist and be private, reachable via the service role —
//    the same principal that uploads/downloads PDFs at runtime.
const { data, error } = await serviceClient.storage.getBucket(bucket);

if (error || !data) {
  console.error(`FAIL: storage bucket "${bucket}" is absent or unreachable via the service role.`);
  console.error(`      lib/snapshot/document.ts writes to this bucket; without it every PDF generation 500s.`);
  console.error(`      Fix: apply supabase/migrations/20261001000013_snapshot_documents_storage.sql to the target project.`);
  console.error(`      detail: ${error?.message ?? "bucket not found"}`);
  process.exit(1);
}

if (data.public !== false) {
  console.error(`FAIL: storage bucket "${bucket}" exists but is PUBLIC (public=${String(data.public)}).`);
  console.error(`      Owner requirement (Addendum 01 §11): the PDF bucket stays PRIVATE. Do not make it public.`);
  process.exit(1);
}

console.log(`PASS: storage bucket "${bucket}" exists and is private (public=false).`);

// 2. Privacy cross-check (§11 "a participant may not retrieve another
//    participant's Snapshot or PDF"): a private bucket never appears in an
//    anonymous client's bucket list, so a participant cannot even learn the
//    bucket name by enumeration.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (anonKey) {
  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: anonBuckets, error: anonErr } = await anonClient.storage.listBuckets();
  if (anonErr) {
    // Failing to list at all is at least as private as listing nothing — not a
    // failure of the guard, but worth surfacing.
    console.log(`NOTE: anonymous bucket listing was refused (${anonErr.message}) — cannot be enumerated.`);
  } else {
    const visible = (anonBuckets ?? []).some((b) => b.name === bucket);
    if (visible) {
      console.error(`FAIL: storage bucket "${bucket}" is visible to an anonymous client — it is enumerable and NOT private.`);
      process.exit(1);
    }
    console.log(`PASS: bucket "${bucket}" is not visible to anonymous clients (§11 no enumeration).`);
  }
} else {
  console.log("NOTE: NEXT_PUBLIC_SUPABASE_ANON_KEY not set — skipped the anonymous-visibility cross-check.");
}

console.log(`OK: private PDF storage is ready. Signed, time-limited downloads (lib/snapshot/document.ts) can proceed.`);
process.exit(0);
