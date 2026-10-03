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
import { recordEventInBackground } from "@/lib/analytics/write";

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

  // THE LIFECYCLE-AWARE LOOKUP.
  //
  // Operator decision 2026-10-01. Previously this asked for `status =
  // 'in_progress'` and nothing else — so a session the sweep had just classified
  // `abandoned` would VANISH from the participant's view, and they would be sent
  // to "start a new assessment" despite having a session that is explicitly
  // resumable. That is the bug this widening fixes.
  //
  // `abandoned` is included because the operator was explicit: abandonment "does
  // not mean the participant record or responses are deleted", and returning
  // before expiration resumes the SAME session. `expired` is excluded here and
  // handled below, because it must NOT resume — it needs a new session.
  const { data, error } = await db
    .from("assessment_sessions")
    .select("session_id, status, current_position, last_activity_at")
    .eq("participant_id", participantId)
    .in("status", ["in_progress", "abandoned"])
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
  //
  // But "no RESUMABLE session" is not the same as "no session at all": there may
  // be an EXPIRED one, which changes what the participant is told.
  if (!data) {
    const expired = await mostRecentExpiredSession(db, participantId);
    return NextResponse.json({
      resumable: null,
      firstName,
      // Operator instruction #3: after expiration the participant is told
      // plainly that they are starting fresh, and why. `expired: true` is what
      // lets the greeting say that rather than showing the generic welcome —
      // a participant whose work expired and was told nothing would reasonably
      // think their assessment had been lost.
      expired: Boolean(expired),
    });
  }

  // A session the participant is returning to AFTER it was classified abandoned.
  //
  // The operator asked for a specific treatment here (instruction #2), and it
  // differs from the ordinary welcome: the participant is told time has passed
  // and that they can revise earlier answers, with ONE call to action — no
  // "Start over vs. Continue" decision, because that would ask them to make a
  // choice the product can make for them.
  const returningAfterAbandonment = data.status === "abandoned";
  // Declared outside the block so the response below can report what ACTUALLY
  // happened rather than what was attempted.
  let resumed = false;

  if (returningAfterAbandonment) {
    // RESUME: return the session to active. `RESUMED` is deliberately NOT a
    // status (operator instruction #6) — the session goes back to `in_progress`
    // and the fact that it had been abandoned lives in the event history.
    //
    // Reaching here means the participant arrived through a verified link, which
    // is what makes this a resume rather than an unauthenticated poke.
    // `last_activity_at` IS BUMPED HERE, and leaving it out was a live bug.
    //
    // Resuming set `status` alone, so the session returned to `in_progress`
    // still carrying its old activity timestamp — 10 days stale in the case that
    // exposed this. The very next sweep classified it abandoned again and
    // recorded a SECOND `assessment_abandoned` event for one abandonment. The
    // participant's return is activity; the column that measures activity has to
    // say so, or the state machine and the clock disagree about the same session.
    const nowIso = new Date().toISOString();
    const { error: resumeErr } = await db
      .from("assessment_sessions")
      .update({
        status: "in_progress",
        lifecycle_changed_at: nowIso,
        last_activity_at: nowIso,
      })
      .eq("session_id", data.session_id)
      // Guard against a concurrent sweep: only resume a session that is still
      // abandoned. If the sweep expired it between the read and this write, the
      // update matches nothing and the session correctly stays expired.
      .eq("status", "abandoned");

    resumed = !resumeErr;
    if (resumed) {
      // The distinct event name is what makes "saved -> abandoned -> resumed ->
      // completed" countable apart from "saved -> completed" (instruction #8).
      void recordEventInBackground({
        eventName: "assessment_resumed_after_abandonment",
        participantId,
        sessionId: data.session_id,
        payload: { position: data.current_position, saved: true },
      });
    }
  }

  return NextResponse.json({
    resumable: {
      sessionId: data.session_id,
      // Report the status the participant is ACTUALLY in after the resume
      // above, not the stale value read moments ago.
      status: resumed ? "in_progress" : data.status,
      currentPosition: data.current_position,
      lastActivityAt: data.last_activity_at,
    },
    firstName,
    // Drives the instruction-#2 copy: "It's been a little while since you
    // started your assessment. A few things may have changed since then."
    resumedAfterAbandonment: resumed,
  });
}

/**
 * The participant's most recent EXPIRED session, if any.
 *
 * Used only to tell them WHY they are starting fresh. The expired session itself
 * is never returned as resumable — operator instruction #3: it "may no longer be
 * resumed as the participant's current assessment".
 */
async function mostRecentExpiredSession(
  db: ReturnType<typeof serviceClient>,
  participantId: string,
): Promise<{ session_id: string } | null> {
  try {
    const { data } = await db
      .from("assessment_sessions")
      .select("session_id")
      .eq("participant_id", participantId)
      .eq("status", "expired")
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { session_id: string } | null) ?? null;
  } catch {
    // Failing to find an expired session must not break resume. Reporting
    // `expired: false` shows the ordinary welcome, which is the safe default:
    // it never claims an assessment expired when it did not.
    return null;
  }
}
