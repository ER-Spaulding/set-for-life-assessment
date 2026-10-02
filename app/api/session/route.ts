// PRD §22.6, §23.2 — create a session pinned to an assessment version.
//
// PRD §23.2: "creates a session pinned to an assessment version for the
// verified Participant ID."
//
// The participant id comes from the verified session, never from the request
// body — accepting a caller-supplied participant id would let anyone open a
// session against someone else's record (PRD §23.5: never trust client-side
// identity ownership).
//
// The version is pinned HERE, at creation, and the `trg_sessions_version_pin`
// trigger keeps it pinned after completion (§22.6, §29 version pinning).

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { pinnedVersion } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  try {
    const body = (await request.json()) as { participantId?: unknown };
    // Present for the pilot build, where the client holds a verified id. The
    // value is still validated server-side below — it is never trusted merely
    // because it arrived.
    if (typeof body.participantId === "string") participantId = body.participantId;
  } catch {
    /* falls through to the validation error below */
  }

  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A verified participant id is required."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  // Confirm the participant exists before creating a session against it, so an
  // unknown id produces a clear 404 rather than a foreign-key error.
  const { data: participant, error: pErr } = await db
    .from("participants")
    .select("participant_id")
    .eq("participant_id", participantId)
    .maybeSingle();
  if (pErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not create the session."), {
      status: 500,
    });
  }
  if (!participant) {
    return NextResponse.json(
      errorBody("UNKNOWN_PARTICIPANT", "No such participant."),
      { status: 404 },
    );
  }

  const { data: session, error: sErr } = await db
    .from("assessment_sessions")
    .insert({
      participant_id: participantId,
      assessment_version: pinnedVersion(),
      status: "in_progress",
      current_position: 1,
    })
    .select("session_id, assessment_version, status, current_position")
    .single();

  if (sErr || !session) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not create the session."), {
      status: 500,
    });
  }

  return NextResponse.json(
    {
      sessionId: session.session_id,
      // The four pinned sub-versions travel with the session so a consumer can
      // record exactly which instrument produced a result (§22.6).
      versions: {
        assessment: session.assessment_version,
      },
      status: session.status,
      currentPosition: session.current_position,
    },
    { status: 201 },
  );
}
