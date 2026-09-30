// PRD §5.4, §23.2 — the participant's resumable session.
//
// PRD §23.2: "returns the participant's current resumable session, if any."
//
// The lookup is by participant id supplied by the caller (the pilot build holds
// a verified id client-side). It returns only the session's existence, id and
// position — NOT the answers. Answers come from GET /api/session/:id, which is
// scoped to one session, so this endpoint cannot be used to dump a response set
// without knowing the session id.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  const participantId = new URL(request.url).searchParams.get("participantId");
  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A verified participant id is required."),
      { status: 400 },
    );
  }

  const db = serviceClient();
  const { data, error } = await db
    .from("assessment_sessions")
    .select("session_id, status, current_position, last_activity_at")
    .eq("participant_id", participantId)
    .eq("status", "in_progress")
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not check for a session."), {
      status: 500,
    });
  }

  // No resumable session is a normal outcome, not an error.
  if (!data) return NextResponse.json({ resumable: null });

  return NextResponse.json({
    resumable: {
      sessionId: data.session_id,
      status: data.status,
      currentPosition: data.current_position,
      lastActivityAt: data.last_activity_at,
    },
  });
}
