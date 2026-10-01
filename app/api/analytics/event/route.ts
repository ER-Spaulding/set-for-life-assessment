// First-party analytics — the browser-reportable subset. Addendum 02 v1.1 §16.
//
// This route exists for the events that have NO server moment: a Money Moment
// rendering on screen, a participant tapping past one, a participant declining
// Save My Progress. Everything else is recorded where the server actually does
// the thing, because the server is the only honest witness to it.
//
// WHAT THIS ROUTE REFUSES, AND WHY THAT IS THE POINT:
//
//   1. Any event whose origin is `server` (EVENT_KIND in lib/analytics/events).
//      "assessment_started" posted here would be a claim that an assessment
//      started, made by a browser, with nothing having started. The allow-list
//      is derived from that map, not hand-maintained, so a new server event
//      cannot accidentally become client-reportable.
//
//   2. Any participant id from the request body. The participant is resolved
//      from the SESSION ROW instead. A client that could name the participant
//      could attribute its own events to another person's record.
//
//   3. Any payload key outside the allow-list — enforced twice, by
//      `isPayloadSafe` here and again by the CHECK constraint in the database.
//
// HONEST LIMITATION. This endpoint is unauthenticated, because a participant
// part-way through an anonymous assessment has nothing to authenticate WITH —
// that is the whole point of §2's entry flow. So a determined caller could POST
// these four event names and inflate their counts. They are funnel-shape
// measurements, not financial records, and the write path rejects anything that
// is not a structural scalar; but the exposure is real and belongs in the
// record rather than in an assumption that nobody would bother. Rate limiting
// per IP and per session is the fix, and it is not implemented here.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured } from "@/lib/db/client";
import { isClientReportable, sanitizePayload } from "@/lib/analytics/events";
import { recordEventInBackground } from "@/lib/analytics/write";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  // Unconfigured is not an error here. Measurement is never load-bearing, so an
  // absent database means "drop the measurement", not "fail the request".
  if (!isDatabaseConfigured()) return new NextResponse(null, { status: 204 });

  let eventName: unknown;
  let sessionId: unknown;
  let payload: unknown;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    eventName = body.eventName;
    sessionId = body.sessionId;
    payload = body.payload;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (typeof eventName !== "string" || !isClientReportable(eventName)) {
    // 204 rather than 4xx: this endpoint's contract is "never surfaces to a
    // participant". A rejected measurement is a gap in a chart, and the client
    // has already moved on by the time this is decided.
    return new NextResponse(null, { status: 204 });
  }

  let participantId: string | null = null;
  if (typeof sessionId === "string" && UUID_RE.test(sessionId)) {
    // The participant comes from the ROW, never from the body — see (2) above.
    // A malformed or unknown session simply leaves the correlator null; the
    // event is still counted, which is the right trade for funnel measurement.
    try {
      const db = serviceClient();
      const { data } = await db
        .from("assessment_sessions")
        .select("participant_id")
        .eq("session_id", sessionId)
        .maybeSingle();
      participantId =
        (data as { participant_id?: string } | null)?.participant_id ?? null;
    } catch {
      /* leave null */
    }
  }

  recordEventInBackground({
    eventName,
    participantId,
    sessionId: typeof sessionId === "string" && UUID_RE.test(sessionId) ? sessionId : null,
    payload: sanitizePayload(
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as never)
        : undefined,
    ),
  });

  return new NextResponse(null, { status: 204 });
}
