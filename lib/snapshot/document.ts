// Addendum 01 v1.1 §7, §8, §11, §14 step 7 — private PDF storage + retrieval.
//
// THIS MODULE IS SERVER-ONLY. It talks to Supabase Storage (private bucket) and
// the `snapshot_documents` table, using the service-role client. Nothing here
// reaches a browser.
//
// THE PDF IS AN ARTIFACT, NOT THE SOURCE OF TRUTH (§7/§15). This module writes a
// metadata + storage-pointer row and uploads bytes. It never writes a second
// copy of the payload, never interprets anything, and never changes what the
// Snapshot says. The immutable `snapshots.payload_json` remains the single
// source of truth; `snapshot_documents` records only that a render of it exists
// and where.
//
// §7.3: PDF generation/upload failure must NEVER invalidate a completed
// assessment or hide the web results. A failure here writes
// `generation_status = 'failed'` + `error_code` and surfaces as a RETRYABLE
// download (a 500 on the download POST), never as a failed completion, and
// never by blocking the web Snapshot.

import "server-only";
import { createHash } from "node:crypto";
import { serviceClient } from "../db/client";
import { loadSnapshotForDownload, verifiedFirstNameForParticipant } from "../session/service";
import { resolveSnapshotContent } from "../render/snapshot-sections";
import { logUnresolvedNarrativeKeys } from "../render/narrative-key-guard";
import { renderSnapshotPdf, type SnapshotPdfMeta } from "../render/snapshot-pdf";

/** The private bucket the PDF artifacts live in (migration ...00013). */
export const SNAPSHOT_DOCUMENTS_BUCKET = "snapshot-documents";

/** The storage object key for a document — unguessable (the row's random UUID). */
export function snapshotDocumentObjectKey(documentId: string): string {
  return `snapshots/${documentId}.pdf`;
}

/**
 * The exact `snapshot_documents` columns a SUCCEEDED write sets. Kept as a single
 * source so the write path and the cross-check regression can never drift to a
 * column name the migration does not define (see the "stub DB can't enforce
 * schema" lesson).
 */
export function succeededDocumentRow(args: {
  storageObjectKey: string;
  checksum: string;
  generatedAt: string;
}): Record<string, unknown> {
  return {
    storage_object_key: args.storageObjectKey,
    generation_status: "succeeded",
    generated_at: args.generatedAt,
    checksum: args.checksum,
  };
}

/** The exact `snapshot_documents` columns a FAILED write sets. */
export function failedDocumentRow(args: {
  errorCode: string;
  retryCount: number;
}): Record<string, unknown> {
  return {
    generation_status: "failed",
    error_code: args.errorCode,
    retry_count: args.retryCount,
  };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The PDF metadata channel, assembled server-side. Non-interpretive: the
 * verified first name (§3.2 gating), the snapshot's completion timestamp, and
 * the report version — never added to the resolver, never recomputed here.
 * Reuses the SAME verification gate the reveal uses, so there is ONE definition
 * of "verified first name".
 */
async function pdfMeta(
  db: ReturnType<typeof serviceClient>,
  generatedAt: string | null,
  reportVersion: string | null,
  participantId: string | null,
): Promise<SnapshotPdfMeta> {
  const firstName = participantId
    ? await verifiedFirstNameForParticipant(db, participantId).catch(() => null)
    : null;
  return { firstName, generatedAt, reportVersion };
}

/**
 * Ensure the PDF document for a completed session exists, generating + storing
 * it if it does not. Returns null only when the session is not completed (or
 * has no Snapshot) — the caller maps that to a uniform 403. Throws on a DB or
 * storage failure AFTER writing the failed row, so the caller surfaces a
 * retryable 500 (§7.3).
 */
export async function ensureSnapshotDocument(sessionId: string): Promise<{
  documentId: string;
  storageObjectKey: string;
  checksum: string;
  reportVersion: string | null;
  generatedAt: string | null;
  /** True only when this call actually generated + stored a fresh PDF. */
  generated: boolean;
} | null> {
  const stored = await loadSnapshotForDownload(sessionId);
  if (!stored) return null;

  const db = serviceClient();
  const { snapshotId, reportVersion, generatedAt, payload } = stored;

  // §C — the PDF half of the historical-read observation. Same reasoning as the
  // web page: log what the resolver had to omit, change nothing about the
  // render. `surface` distinguishes the two so an operator can tell a web read
  // from a download.
  logUnresolvedNarrativeKeys(payload, { sessionId, surface: "pdf" });

  // Reuse the SAME resolver + SAME shared section model as the web page — the
  // PDF cannot disagree because it starts from the identical resolved content
  // model (resolveSnapshotContent -> resolveSnapshotView -> resolveSnapshotSections).
  const sections = resolveSnapshotContent(payload);

  // A retry UPDATES the same row (UNIQUE(snapshot_id, format)) rather than
  // appending a second artifact.
  const { data: existing, error: readErr } = await db
    .from("snapshot_documents")
    .select("document_id, generation_status, storage_object_key, checksum, retry_count")
    .eq("snapshot_id", snapshotId)
    .eq("format", "pdf")
    .maybeSingle();
  if (readErr) throw new Error(`snapshot_document: ${readErr.message}`);

  if (existing && existing.generation_status === "succeeded") {
    return {
      documentId: existing.document_id as string,
      storageObjectKey: existing.storage_object_key as string,
      checksum: existing.checksum as string,
      reportVersion,
      generatedAt,
      generated: false,
    };
  }

  const retryCount = (existing?.retry_count as number | undefined) ?? 0;
  let documentId = existing?.document_id as string | undefined;

  // Create-or-recover the row and pin its id BEFORE generating, so the object
  // key (`snapshots/{document_id}.pdf`) is stable across a retry.
  if (!documentId) {
    const { data: row, error: upsertErr } = await db
      .from("snapshot_documents")
      .upsert(
        { snapshot_id: snapshotId, format: "pdf", generation_status: "pending" },
        { onConflict: "snapshot_id,format" },
      )
      .select("document_id")
      .single();
    if (upsertErr) throw new Error(`snapshot_document: ${upsertErr.message}`);
    documentId = row.document_id as string;
  }

  try {
    const participantId = await participantIdForSnapshot(db, snapshotId);
    const meta = await pdfMeta(db, generatedAt, reportVersion, participantId);
    const bytes = await renderSnapshotPdf(sections, meta);
    const checksum = sha256Hex(bytes);
    const objectKey = snapshotDocumentObjectKey(documentId);

    const { error: uploadErr } = await db.storage
      .from(SNAPSHOT_DOCUMENTS_BUCKET)
      .upload(objectKey, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw new Error(`snapshot_document: upload ${uploadErr.message}`);

    const { error: writeErr } = await db
      .from("snapshot_documents")
      .update(
        succeededDocumentRow({
          storageObjectKey: objectKey,
          checksum,
          generatedAt: new Date().toISOString(),
        }),
      )
      .eq("document_id", documentId);
    if (writeErr) throw new Error(`snapshot_document: ${writeErr.message}`);

    return {
      documentId,
      storageObjectKey: objectKey,
      checksum,
      reportVersion,
      generatedAt,
      generated: true,
    };
  } catch (err) {
    // §7.3: record the failure and the retry count; NEVER fail the completion.
    // Best-effort: a failed write of the failure marker must not mask the
    // original generation error.
    try {
      await db
        .from("snapshot_documents")
        .update(failedDocumentRow({ errorCode: "generation_failed", retryCount: retryCount + 1 }))
        .eq("document_id", documentId);
    } catch {
      // ignore — the original error is what the caller must see.
    }
    throw err;
  }
}

/** Resolve a snapshot to its owning participant — for the §3.2 name gate only. */
async function participantIdForSnapshot(
  db: ReturnType<typeof serviceClient>,
  snapshotId: string,
): Promise<string | null> {
  try {
    const { data: snapshot } = await db
      .from("snapshots")
      .select("session_id")
      .eq("snapshot_id", snapshotId)
      .maybeSingle();
    const sessionId = (snapshot as { session_id?: string } | null)?.session_id;
    if (!sessionId) return null;
    const { data: session } = await db
      .from("assessment_sessions")
      .select("participant_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    return (session as { participant_id?: string } | null)?.participant_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the PDF bytes for a session's SPECIFIC document — used by the signed
 * GET. It re-verifies, server-side, that the document belongs to THIS session's
 * Snapshot AND that its generation actually succeeded, before streaming — so
 * even a forged token's `doc` claim is cross-checked against the database, not
 * trusted.
 *
 * Returns null when the session is not completed, the document does not belong
 * to the session, or the document has no succeeded artifact (uniform 403).
 *
 * On success it returns the bytes AND the Snapshot's completion timestamp
 * (`snapshots.generated_at`) — read from the SAME `stored` record that just
 * verified the document belongs to this session, so the filename the route
 * builds from it is the authoritative completion date, never a client value.
 */
export async function loadSnapshotDocumentBytes(
  sessionId: string,
  documentId: string,
): Promise<{ bytes: Buffer; generatedAt: string | null } | null> {
  const stored = await loadSnapshotForDownload(sessionId);
  if (!stored) return null;

  const db = serviceClient();

  const { data: row, error } = await db
    .from("snapshot_documents")
    .select("storage_object_key, generation_status")
    .eq("document_id", documentId)
    .eq("snapshot_id", stored.snapshotId)
    .eq("generation_status", "succeeded")
    .maybeSingle();
  if (error) throw new Error(`snapshot_document: ${error.message}`);
  if (!row) return null;

  const { data: blob, error: dlErr } = await db.storage
    .from(SNAPSHOT_DOCUMENTS_BUCKET)
    .download(row.storage_object_key as string);
  if (dlErr || !blob) {
    throw new Error(`snapshot_document: download ${dlErr?.message ?? "empty"}`);
  }

  return {
    bytes: Buffer.from(await blob.arrayBuffer()),
    generatedAt: stored.generatedAt,
  };
}
