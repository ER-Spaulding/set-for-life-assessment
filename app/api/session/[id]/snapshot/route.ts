// PRD §23.2, §24 — the participant-facing Snapshot.
//
// PRD §23.2: "returns participant-facing Snapshot only after successful
// completion."
//
// PRD §24: "Do not expose internal classifier tags or diagnostic machinery to
// participants."
//
// So this route returns and nothing else: narrative KEYS resolved against the
// approved libraries, plus the selected attention area. No classifier tags, no
// signals numeric values, no evidence-chain payload, no tension machinery
// beyond the codes that select approved copy. A mid-assessment session gets
// 403 — never a partial or provisional report.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { loadSnapshot } from "@/lib/session/service";
import { recordEventInBackground } from "@/lib/analytics/write";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let snapshot;
  try {
    snapshot = await loadSnapshot(sessionId);
  } catch {
    return NextResponse.json(
      errorBody("SNAPSHOT_FAILED", "Could not load the Snapshot."),
      { status: 500 },
    );
  }

  if (!snapshot) {
    // Either the session does not exist or it is not complete. The same
    // response for both: telling a caller which would leak session existence.
    return NextResponse.json(
      errorBody(
        "NOT_AVAILABLE",
        "A Snapshot is available only after the assessment is complete.",
      ),
      { status: 403 },
    );
  }

  // §16: a completed Snapshot was served. Recorded HERE, after the 403 branch,
  // so the count means "reports actually delivered" rather than "requests that
  // arrived" — a mid-assessment session hitting this route is not a view.
  recordEventInBackground({ eventName: "snapshot_viewed", sessionId });

  // §24: build the participant-facing view EXPLICITLY. `loadSnapshot` already
  // returns only flat fields, but this whitelist is the serialization boundary:
  // if a future change ever puts the raw payload (or any new internal field)
  // back on the service return, it still does NOT reach the browser unless it
  // is added to this list on purpose. Exposure requires an explicit decision.
  return NextResponse.json({
    snapshotId: snapshot.snapshotId,
    reportVersion: snapshot.reportVersion,
    generatedAt: snapshot.generatedAt,
    signals: snapshot.signals,
    tensionCodes: snapshot.tensionCodes,
    connectionKeys: snapshot.connectionKeys,
    attentionArea: snapshot.attentionArea,
    attentionAreas: snapshot.attentionAreas,
  });
}
