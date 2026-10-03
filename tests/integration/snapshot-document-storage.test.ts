import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

import {
  SNAPSHOT_DOCUMENTS_BUCKET,
  snapshotDocumentObjectKey,
  succeededDocumentRow,
  failedDocumentRow,
} from "@/lib/snapshot/document";

/**
 * Private storage cross-check — Addendum 01 v1.1 §7, §11, §15.
 *
 * The "stub DB can't enforce schema" lesson: a faked database accepts ANY
 * column name, so a green suite can hide a write path that names a column the
 * migration never defined (that exact defect failed every completion once).
 * Storage has NO fake in this suite, so this file asserts the write path
 * AGAINST THE MIGRATION ITSELF — the exact column names, the
 * succeeded-has-artifact CHECK, and the private-bucket posture — so the two can
 * never drift.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

const DOCUMENTS_MIGRATION = read("supabase/migrations/20261001000001_snapshot_payload_and_documents.sql");
const STORAGE_MIGRATION = read("supabase/migrations/20261001000013_snapshot_documents_storage.sql");

describe("the snapshot_documents table matches the write path's column names", () => {
  const requiredColumns = [
    "document_id",
    "snapshot_id",
    "format",
    "storage_object_key",
    "generation_status",
    "generated_at",
    "checksum",
    "error_code",
    "retry_count",
    "created_at",
    "updated_at",
  ];

  it("defines every column the write path names, in the CREATE TABLE", () => {
    for (const col of requiredColumns) {
      expect(DOCUMENTS_MIGRATION, `snapshot_documents must define ${col}`).toMatch(
        new RegExp(`\\b${col}\\b`),
      );
    }
  });

  it("the succeeded write names exactly the artifact columns", () => {
    const row = succeededDocumentRow({
      storageObjectKey: "snapshots/doc.pdf",
      checksum: "abc",
      generatedAt: "2026-10-02T00:00:00Z",
    });
    expect(Object.keys(row).sort()).toEqual(
      ["checksum", "generated_at", "generation_status", "storage_object_key"].sort(),
    );
    expect(row.generation_status).toBe("succeeded");
  });

  it("the failed write names exactly the failure columns", () => {
    const row = failedDocumentRow({ errorCode: "generation_failed", retryCount: 1 });
    expect(Object.keys(row).sort()).toEqual(
      ["error_code", "generation_status", "retry_count"].sort(),
    );
    expect(row.generation_status).toBe("failed");
  });

  it("a succeeded row must have an artifact (the CHECK constraint exists)", () => {
    expect(DOCUMENTS_MIGRATION).toContain("snapshot_documents_succeeded_has_artifact");
    expect(DOCUMENTS_MIGRATION).toContain("generation_status <> 'succeeded'");
    expect(DOCUMENTS_MIGRATION).toContain("storage_object_key IS NOT NULL");
  });

  it("a retry updates the same row — UNIQUE(snapshot_id, format)", () => {
    expect(DOCUMENTS_MIGRATION).toContain("UNIQUE (snapshot_id, format)");
  });
});

describe("the storage bucket is private and unenumerable", () => {
  it("creates a snapshot-documents bucket that is NOT public", () => {
    expect(STORAGE_MIGRATION).toContain("snapshot-documents");
    expect(STORAGE_MIGRATION).toMatch(/public\s*\)\s*VALUES\s*\([^)]*snapshot-documents[^)]*false/);
  });

  it("grants NO public read policy (private by default, service role only)", () => {
    // The whole point: no storage.objects policy for anon/authenticated, so a
    // participant cannot list or read another participant's object.
    expect(STORAGE_MIGRATION).not.toMatch(/CREATE\s+POLICY/i);
    expect(STORAGE_MIGRATION).not.toMatch(/USING\s*\(/i);
  });

  it("the object key is the row's random UUID — unguessable, stable", () => {
    expect(SNAPSHOT_DOCUMENTS_BUCKET).toBe("snapshot-documents");
    expect(snapshotDocumentObjectKey("11111111-2222-3333-4444-555555555555")).toBe(
      "snapshots/11111111-2222-3333-4444-555555555555.pdf",
    );
  });
});
