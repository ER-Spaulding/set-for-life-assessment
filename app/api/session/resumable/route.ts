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
import { verifiedFirstNameForParticipant } from "@/lib/session/service";

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

  // The §4.1 greeting name, on the SAME request that resolves the session.
  //
  // §4.1: "the first-name welcome is required". It is returned here rather than
  // from a second endpoint because this route is already called on the exact
  // screen that renders the greeting, and this caller reached it by consuming a
  // verification token — so the name is gated on `verifiedFirstNameForParticipant`,
  // the same evidence the completion path uses. §15: "Do not use a name before it
  // has been reliably associated with the participant." An unverified participant
  // gets null, and the greeting must then say something that is not a name.
  const firstName = await verifiedFirstNameForParticipant(db, participantId).catch(() => null);

  // No resumable session is a normal outcome, not an error. The name is still
  // returned: a verified participant with no session in progress is exactly the
  // §4.1 "Ready to see what has changed?" case.
  if (!data) return NextResponse.json({ resumable: null, firstName });

  return NextResponse.json({
    resumable: {
      sessionId: data.session_id,
      status: data.status,
      currentPosition: data.current_position,
      lastActivityAt: data.last_activity_at,
    },
    firstName,
  });
}
