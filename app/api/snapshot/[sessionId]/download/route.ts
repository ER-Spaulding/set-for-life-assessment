// Addendum 01 v1.1 §8, §11, §14 step 7 — signed, time-limited PDF download.
//
// TWO STEPS, TOKEN-GATED, NO PUBLIC OBJECT URL:
//
//   POST /api/snapshot/[sessionId]/download
//     Server-only: load the completed Snapshot payload, resolve it through the
//     SHARED resolver, generate + privately store the PDF if it does not already
//     exist, then mint a signed token and return the GET URL it unlocks.
//
//   GET  /api/snapshot/[sessionId]/download?t=<token>
//     Verify the token, then stream the bytes server-side from the private
//     bucket — never from a public object URL. The route never exposes
//     `storage_object_key`, and the document id comes ONLY from the token claim
//     (cross-checked against the session's Snapshot), never from the client.
//
// ENUMERATION PREVENTION (four layers, per §7.3):
//   (a) the PDF bytes live in a PRIVATE bucket with no public read policy —
//       there is no object URL to enumerate or guess;
//   (b) the token is HMAC-signed with a server secret and short-lived (15 min);
//   (c) the route accepts only sessionId + signed token; the document id is
//       bound to the session by the token AND re-verified against the DB;
//   (d) every denial — missing, not-completed, unauthorized, no-document,
//       expired, wrong participant — returns the SAME opaque 403 body, so the
//       route cannot be used to probe existence.
//
// AUTHORIZATION NUANCE (flagged): the web page trusts possession of the
// unguessable sessionId UUID (provisional participants have no `sfl_session`
// cookie). This route is deliberately NOT gated on that cookie, or provisional
// participants would be locked out; it is strictly STRONGER than the page
// (signing + expiry + document binding) on the same trust root. Optional
// hardening: when a session cookie IS present, additionally verify its pid.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { signDownloadToken, verifyDownloadToken } from "@/lib/auth/session";
import {
  ensureSnapshotDocument,
  loadSnapshotDocumentBytes,
} from "@/lib/snapshot/document";
import { snapshotDownloadDisposition } from "@/lib/snapshot/download-filename";
import { recordEventInBackground } from "@/lib/analytics/write";

export const dynamic = "force-dynamic";

/** The single, identical denial body for every 403 path (§7.3 enumeration). */
const DENIED = errorBody("DOWNLOAD_UNAVAILABLE", "The download is unavailable.");

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let doc;
  try {
    doc = await ensureSnapshotDocument(sessionId);
  } catch {
    // §7.3: a failed generation is a RETRYABLE download, never a failed
    // completion and never a hidden web result.
    return NextResponse.json(
      errorBody("GENERATION_FAILED", "The Snapshot could not be prepared."),
      { status: 500 },
    );
  }

  if (!doc) {
    // Not completed, or no Snapshot. Same response as every other denial.
    return NextResponse.json(DENIED, { status: 403 });
  }

  // §16: recorded only when a fresh PDF was actually generated (not on reuse).
  if (doc.generated) {
    recordEventInBackground({ eventName: "snapshot_pdf_generated", sessionId });
  }

  const token = signDownloadToken(sessionId, doc.documentId);
  return NextResponse.json({
    url: `/api/snapshot/${sessionId}/download?t=${encodeURIComponent(token)}`,
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  const claims = token ? verifyDownloadToken(token) : null;

  // The token binds sid -> doc. It must match THIS route's sessionId — a token
  // replayed against another session (or an expired/forged token) 403s here.
  if (!claims || claims.sid !== sessionId) {
    return NextResponse.json(DENIED, { status: 403 });
  }

  let result: { bytes: Buffer; generatedAt: string | null } | null;
  try {
    result = await loadSnapshotDocumentBytes(sessionId, claims.doc);
  } catch {
    return NextResponse.json(
      errorBody("DOWNLOAD_FAILED", "The download could not be prepared."),
      { status: 500 },
    );
  }

  if (!result) {
    // No succeeded artifact for this session's document — same opaque 403.
    return NextResponse.json(DENIED, { status: 403 });
  }

  recordEventInBackground({ eventName: "snapshot_pdf_downloaded", sessionId });

  // The approved filename (owner ruling 2026-10-02):
  // `Set-for-Life-Financial-Snapshot-YYYY-MM-DD.pdf`, where the date is the
  // Snapshot's completion date (`snapshots.generated_at`), carried through
  // `loadSnapshotDocumentBytes` from the SAME read that verified the document
  // belongs to this session. `snapshotDownloadDisposition` derives the date and
  // emits `attachment; filename="..."`; it contains no participant PII by
  // construction (see lib/snapshot/download-filename.ts).
  return new NextResponse(result.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": snapshotDownloadDisposition(result.generatedAt),
    },
  });
}
