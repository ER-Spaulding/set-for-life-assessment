// D-1 RECOVERY — carry today's provisional answers forward, or resume the
// participant's own saved assessment.
//
// TWO ACTIONS, ONE ROUTE, because they are two answers to one question the
// participant was just asked ("You already have a saved assessment. Which would
// you like to continue?"). Splitting them would let a client reach one without
// the other having been offered, and the offer is the point.
//
// THE SECURITY MODEL, STATED PLAINLY. Every id this route acts on comes from a
// token the SERVER signed, never from the request body:
//
//   - the participant is taken from `sfl_session` (HttpOnly, HMAC-signed,
//     set only by /auth/callback on a successful redemption). A request body
//     cannot name a participant at all — there is no field for it.
//   - the provisional session comes from that same signed token's `src` claim.
//
// So possession of the emailed link is what grants recovery, exactly as it is
// what grants redemption. A caller who does not hold the link cannot name
// someone else's provisional sitting, and cannot act as another participant.
//
// WHY THIS IS A POST AND NOT PART OF THE CALLBACK. A verification link can be
// PREFETCHED by a mail client or a security scanner. If the callback created a
// session, a prefetched link would mint one before the participant ever
// clicked. The callback therefore only VERIFIES and ROUTES; the participant
// presses a button here, and only that press performs the write.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { getParticipantIdFromRequest, verifyRecoveryToken } from "@/lib/auth/session";
import {
  carryForwardProvisionalAnswers,
  readSessionAnswers,
} from "@/lib/session/recovery";

export const dynamic = "force-dynamic";

/**
 * The provisional sitting rides in a SIGNED token (`sfl_recovery`), minted by
 * /auth/callback and verified here. `verifyRecoveryToken` returns BOTH the
 * participant and the sitting, and the two are checked against each other, so
 * the browser cannot re-point the token at a different sitting: the signature
 * covers the pair.
 */
const RECOVERY_COOKIE = "sfl_recovery";

function clearRecovery(response: NextResponse, secure: boolean): NextResponse {
  response.headers.append(
    "set-cookie",
    `${RECOVERY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
  return response;
}

/** Read the recovery token from the request's cookies. */
function readRecoveryToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${RECOVERY_COOKIE}=`))
    ?.slice(RECOVERY_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Confirm the named session is a legitimate provisional sitting — unclaimed,
 * contactless, and still owned by the participant who started it.
 *
 * THIS IS THE CHECK THAT MAKES THE PENDING COOKIE SAFE TO TRUST. The cookie
 * says WHICH session; this says the session is the kind of thing that may be
 * carried forward at all. A claimed participant's session is refused: those
 * answers belong to an identity that already exists, and copying them into
 * another record would be the merge §5 forbids.
 */
async function assertProvisionalSitting(sessionId: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const db = serviceClient();
  const { data: session } = await db
    .from("assessment_sessions")
    .select("session_id, participant_id, status")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, why: "unknown session" };

  const pid = (session as { participant_id: string }).participant_id;
  const { data: participant } = await db
    .from("participants")
    .select("claimed_at")
    .eq("participant_id", pid)
    .maybeSingle();
  if (!participant) return { ok: false, why: "unknown participant" };
  if ((participant as { claimed_at: string | null }).claimed_at) {
    return { ok: false, why: "session already belongs to a claimed identity" };
  }

  // An EXPIRED session is historical: §3 says its answers may not be edited, and
  // carrying them into a live session would put expired material into a report
  // the participant is about to be scored on.
  if ((session as { status: string }).status === "expired") {
    return { ok: false, why: "session expired" };
  }
  return { ok: true };
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  // The ACTOR is the signed cookie — never the body.
  const participantId = getParticipantIdFromRequest(request);
  if (!participantId) {
    return NextResponse.json(
      errorBody("UNAUTHORIZED", "Please verify your email to continue."),
      { status: 401 },
    );
  }

  let action: string | undefined;
  try {
    const body = (await request.json()) as { action?: unknown };
    if (typeof body.action === "string") action = body.action;
  } catch {
    /* falls through to the validation error below */
  }
  if (action !== "resume" && action !== "carry_forward") {
    return NextResponse.json(
      errorBody("INVALID_ACTION", "Choose how you would like to continue."),
      { status: 400 },
    );
  }

  // The sitting comes from the SIGNED token, and its `pid` claim must match the
  // authenticated participant — a token minted for someone else is refused here
  // even if it is presented with a valid session cookie.
  const claims = (() => {
    const raw = readRecoveryToken(request);
    return raw ? verifyRecoveryToken(raw) : null;
  })();
  const pending = claims && claims.pid === participantId ? claims.src : null;

  const secure = process.env.NODE_ENV === "production";

  // ---- RESUME: continue the participant's OWN existing saved session ----
  //
  // This writes nothing. It is a routing decision, and it deliberately does not
  // touch the provisional sitting OR the saved one — the participant asked for
  // their saved assessment, so that is exactly what they get.
  if (action === "resume") {
    const db = serviceClient();
    const { data: saved } = await db
      .from("assessment_sessions")
      .select("session_id")
      .eq("participant_id", participantId)
      .in("status", ["in_progress", "abandoned"])
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!saved) {
      return NextResponse.json(
        errorBody("NO_SAVED_SESSION", "There is no saved assessment to resume."),
        { status: 404 },
      );
    }
    const res = NextResponse.json(
      { sessionId: (saved as { session_id: string }).session_id, carried: false },
      { status: 200 },
    );
    return clearRecovery(res, secure);
  }

  // ---- CARRY FORWARD: fresh session holding today's answers ----
  if (!pending || !/^[0-9a-f-]{36}$/i.test(pending)) {
    return NextResponse.json(
      errorBody("NO_PENDING_SITTING", "There are no answers to carry forward."),
      { status: 404 },
    );
  }

  const check = await assertProvisionalSitting(pending);
  if (!check.ok) {
    const res = NextResponse.json(
      errorBody("NOT_CARRYABLE", "Those answers can no longer be carried forward."),
      { status: 409 },
    );
    return clearRecovery(res, secure);
  }

  let result;
  try {
    result = await carryForwardProvisionalAnswers({
      verifiedParticipantId: participantId,
      provisionalSessionId: pending,
    });
  } catch (e) {
    // §7.3 posture: a failure here is retryable and says nothing about whether
    // the provisional sitting exists. The participant keeps their saved session
    // and can choose Resume instead.
    return NextResponse.json(
      errorBody("CARRY_FORWARD_FAILED", "We could not bring those answers forward."),
      { status: 500 },
    );
  }

  // NO ANALYTICS EVENT IS EMITTED HERE, DELIBERATELY.
  //
  // The event vocabulary in lib/analytics/events.ts is a CLOSED union, and
  // adding a name to it is a governed change rather than an implementation
  // detail — the same discipline the narrative keys are held to. This flow is
  // already visible without one: `save_progress_used` is emitted by the claim
  // route that starts it, and the destination session's own creation is
  // observable in the data. Flagged for the owner as a follow-up decision.
  const res = NextResponse.json(
    { sessionId: result.sessionId, carried: true, carriedItems: result.carriedItems },
    { status: 201 },
  );
  return clearRecovery(res, secure);
}

/**
 * What the recovery screen needs to render its choice — read-only.
 *
 * Returns whether a saved session exists and how many answers are waiting to be
 * carried, so the participant can be told the FACTS of their two options rather
 * than asked to choose blind.
 */
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }
  const participantId = getParticipantIdFromRequest(request);
  if (!participantId) {
    return NextResponse.json(
      errorBody("UNAUTHORIZED", "Please verify your email to continue."),
      { status: 401 },
    );
  }

  const db = serviceClient();
  const { data: saved } = await db
    .from("assessment_sessions")
    .select("session_id, current_position, last_activity_at")
    .eq("participant_id", participantId)
    .in("status", ["in_progress", "abandoned"])
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // How much is waiting to be carried. Read from the SIGNED token's sitting, and
  // only when it passes the same provisional check the POST enforces — so the
  // count shown can never come from a session that could not be carried.
  const claims = (() => {
    const raw = readRecoveryToken(request);
    return raw ? verifyRecoveryToken(raw) : null;
  })();
  const pending = claims && claims.pid === participantId ? claims.src : null;

  let pendingAnswers = 0;
  if (pending) {
    const ok = await assertProvisionalSitting(pending).catch(() => ({ ok: false as const, why: "error" }));
    if (ok.ok) {
      const answers = await readSessionAnswers(pending).catch(() => ({}));
      pendingAnswers = Object.keys(answers).length;
    }
  }

  return NextResponse.json({
    hasSavedSession: Boolean(saved),
    savedSessionId: saved ? (saved as { session_id: string }).session_id : null,
    pendingAnswers,
  });
}
