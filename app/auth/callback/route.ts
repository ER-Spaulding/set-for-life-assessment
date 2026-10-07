// PRD §7.3, §22.2, §23.1 — email-verification callback (redemption).
//
// The start-new / start-returning routes mint a verification token and (in
// production) email it as a link to THIS endpoint. This route redeems it:
//   1. recompute the HMAC over the link params and compare timing-safe;
//   2. refuse expired links (410) — verification links are short-lived;
//   3. resolve the verified email to a participant WITHOUT duplicating:
//      an existing email contact reuses its participant; a new email creates
//      exactly one participant + one verified contact. A UNIQUE-race (double-
//      clicked link) collapses onto the winner's row and the orphan participant
//      is deleted, so no duplicate participant record survives.
//
// Anti-enumeration (§7.3) applies BEFORE verification, at the start routes.
// This endpoint is reachable only with an unguessable per-email token, so
// returning the resolved participant_id here reveals nothing to a prober.
//
// LINK CONTRACT (for the future email sender — must match issueVerificationToken
// in lib/auth/index.ts): ?purpose=new|returning&contactType=email&contact=<addr>
// &expiresAt=<epoch ms>&token=<hex sha256(purpose:contactType:contact:expiresAt:secret)>
// Optional &firstName= &lastName= (S00A collects real names later; empty when absent).

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  serviceClient,
  isDatabaseConfigured,
  errorBody,
} from "@/lib/db/client";
import { normaliseEmail, isVerificationFresh } from "@/lib/auth";
import { signParticipantToken, signRecoveryToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * The participant id is kept in an httpOnly cookie so the assessment flow can
 * create a session without the id living in client-readable storage or in the
 * URL. Set ONLY here, as the result of redeeming a verified link.
 *
 * `sameSite: "lax"` so it survives the top-level navigation from the email
 * client; `secure` in production only, because localhost is http.
 */
const PID_COOKIE = "sfl_pid";
const PID_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** The signed participant-session cookie, read by `getParticipantIdFromRequest`. */
const SESSION_COOKIE_NAME = "sfl_session";
/** The signed recovery token, read by POST /api/participant/recover. */
const RECOVERY_COOKIE = "sfl_recovery";

function cookieAttrs(maxAge: number): string {
  return (
    `Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "")
  );
}

/** The verified participant's session, signed — the actor for /api/participant/recover. */
function participantCookie(participantId: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signParticipantToken(participantId, ""),
  )}; ${cookieAttrs(PID_COOKIE_MAX_AGE)}`;
}

/** Binds (participant, provisional sitting) so the browser cannot re-point it. */
function recoveryCookie(participantId: string, provisionalSessionId: string): string {
  return `${RECOVERY_COOKIE}=${encodeURIComponent(
    signRecoveryToken(participantId, provisionalSessionId),
  )}; ${cookieAttrs(60 * 30)}`;
}

/**
 * Respond to a successful redemption.
 *
 * A BROWSER CLICKING THE EMAIL LINK must land on a page, not on raw JSON —
 * that was the behaviour before, and a participant clicking a verification
 * link and seeing `{"verified":true,...}` reads as a broken product. An API
 * caller that asks for JSON still gets JSON.
 *
 * The cookie is set in BOTH cases: the redirect needs it, and a JSON consumer
 * driving the flow benefits from it too.
 */
function redemptionResponse(request: Request, participantId: string, isNew: boolean) {
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const cookieName = PID_COOKIE;
  const cookieValue =
    `${cookieName}=${participantId}; Path=/; Max-Age=${PID_COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "");

  if (wantsJson) {
    const res = NextResponse.json(
      { verified: true, participantId, newParticipant: isNew },
      { status: isNew ? 201 : 200 },
    );
    res.headers.append("set-cookie", cookieValue);
    return res;
  }

  const res = NextResponse.redirect(
    new URL(`/auth/verified?participantId=${encodeURIComponent(participantId)}`, request.url),
    303,
  );
  res.headers.append("set-cookie", cookieValue);
  return res;
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      errorBody("NOT_CONFIGURED", "Database is not configured."),
      { status: 503 },
    );
  }

  const q = new URL(request.url).searchParams;
  const purpose = q.get("purpose");
  const contactType = q.get("contactType");
  const expiresAtRaw = q.get("expiresAt");
  const token = q.get("token") ?? "";

  if (
    (purpose !== "new" && purpose !== "returning") ||
    contactType !== "email" ||
    !q.get("contact") ||
    !expiresAtRaw ||
    !token
  ) {
    return NextResponse.json(
      errorBody("INVALID_LINK", "This verification link is incomplete."),
      { status: 400 },
    );
  }
  const contact = normaliseEmail(q.get("contact") as string);
  const expiresAt = Number(expiresAtRaw);
  if (!contact || !contact.includes("@") || !Number.isFinite(expiresAt)) {
    return NextResponse.json(
      errorBody("INVALID_LINK", "This verification link is incomplete."),
      { status: 400 },
    );
  }

  // Recompute the token. Formula pinned to issueVerificationToken in
  // lib/auth/index.ts: sha256(purpose:contactType:contact:expiresAt:secret).
  // `purpose` is hashed in, so a new↔returning flip invalidates the link.
  const secret = process.env.REMINDER_LINK_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      errorBody("VERIFICATION_UNAVAILABLE", "Verification is unavailable."),
      { status: 503 },
    );
  }
  const expected = createHash("sha256")
    .update(`${purpose}:${contactType}:${contact}:${expiresAt}:${secret}`)
    .digest("hex");
  if (!tokensEqual(token, expected)) {
    return NextResponse.json(
      errorBody("INVALID_TOKEN", "This verification link is not valid."),
      { status: 401 },
    );
  }
  if (
    !isVerificationFresh({ contactType: "email", contact, expiresAt })
  ) {
    return NextResponse.json(
      errorBody(
        "LINK_EXPIRED",
        "This verification link has expired. Please request a new one.",
      ),
      { status: 410 },
    );
  }

  const firstName = (q.get("firstName") ?? "").trim().slice(0, 120);
  const lastName = (q.get("lastName") ?? "").trim().slice(0, 120);
  const nowIso = new Date().toISOString();
  const db = serviceClient();

  // ---- Save My Progress: CLAIM the provisional participant (§14) ----
  //
  // Checked BEFORE the create-new branch below, and that ordering is the whole
  // point. A participant who answered five questions anonymously and then chose
  // Save My Progress has a provisional row holding their session and every
  // response so far. Without this branch the email would be unknown, the code
  // below would create a SECOND participant, and the provisional row — with all
  // their answers — would be orphaned. §14: "attach/claim the current
  // provisional participant/session WITHOUT duplicating responses."
  //
  // The claim id says WHICH row; the token check above is what proves the
  // requester may claim it, so possessing the id alone grants nothing.
  const claimId = (q.get("claimParticipantId") ?? "").trim();
  if (claimId && /^[0-9a-f-]{36}$/i.test(claimId)) {
    const { claimProvisionalParticipant } = await import("@/lib/session/provisional");
    const result = await claimProvisionalParticipant({
      participantId: claimId,
      firstName,
      lastName,
      email: contact,
    });

    // A conflict is NOT merged — but it no longer dead-ends.
    //
    // §5 still forbids automatic merging, and nothing here merges: no
    // participant_id is rewritten, no contact moves, no row changes owner. What
    // changed (Owner policy 2026-10-06) is that the participant is no longer
    // told to "use a different email" and left with stranded answers. They have
    // just PROVEN they own this address, so they are routed into their own
    // record and offered a choice about what to do with today's sitting.
    //
    // WHY THE DECISION IS NOT MADE HERE. This is a redirect target — a mail
    // client or a scanner can PREFETCH it. Creating a session or copying
    // answers on a prefetch would act before the participant ever clicked.
    // So this branch only VERIFIES and ROUTES; the write happens on a screen
    // the participant actually presses.
    if (!result.claimed) {
      // RESOLVE THE SESSION FROM THE PARTICIPANT — do not assume they are the
      // same id. `claimId` is a PARTICIPANT id (the client stores the one it was
      // given at creation); the recovery flow needs the SESSION id that holds
      // the sitting's answers. Passing one where the other is expected was a real
      // defect: the carry-forward 409'd on every genuine recovery, and the only
      // values that "worked" were the ones an attacker could not have obtained
      // legitimately.
      const { data: provSession } = await db
        .from("assessment_sessions")
        .select("session_id")
        .eq("participant_id", claimId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const provisionalSessionId = (provSession as { session_id: string } | null)?.session_id;
      if (!provisionalSessionId) {
        // Nothing to carry. Route to the welcome screen, which handles a
        // participant with no resumable session correctly.
        return redemptionResponse(request, result.ownerId, false);
      }

      const res = NextResponse.redirect(
        new URL(`/auth/recover?src=${encodeURIComponent(provisionalSessionId)}`, request.url),
        303,
      );
      // The verified participant's own session, so the recovery screen can act
      // as them without trusting anything the browser might send back.
      res.headers.append("set-cookie", participantCookie(result.ownerId));
      // WHICH provisional sitting is in play, SIGNED — see signRecoveryToken
      // for why an unsigned value here would be a cross-participant read.
      res.headers.append("set-cookie", recoveryCookie(result.ownerId, provisionalSessionId));
      return res;
    }

    // Stamp the contact verified — the click just proved ownership of it.
    await db
      .from("participant_contacts")
      .update({ verified_at: nowIso })
      .eq("contact_type", "email")
      .eq("normalized_value", contact);

    return redemptionResponse(request, claimId, false);
  }

  // Existing email contact → reuse its participant (never a duplicate).
  // Refresh verified_at: the click just proved current ownership of the address.
  const { data: existing, error: lErr } = await db
    .from("participant_contacts")
    .select("contact_id, participant_id")
    .eq("contact_type", "email")
    .eq("normalized_value", contact)
    .maybeSingle();
  if (lErr) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }
  if (existing) {
    // Corroboration, not the gate: verification already succeeded above, so a
    // stamp failure must not fail the redemption.
    await db
      .from("participant_contacts")
      .update({ verified_at: nowIso })
      .eq("contact_id", (existing as { contact_id: string }).contact_id);
    return redemptionResponse(
      request,
      (existing as { participant_id: string }).participant_id,
      false,
    );
  }

  // New email → exactly one participant + one verified contact.
  const { data: participant, error: pErr } = await db
    .from("participants")
    .insert({ first_name: firstName, last_name: lastName })
    .select("participant_id")
    .single();
  if (pErr || !participant) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }
  const pid = (participant as { participant_id: string }).participant_id;

  const { error: cErr } = await db.from("participant_contacts").insert({
    participant_id: pid,
    contact_type: "email",
    normalized_value: contact,
    verified_at: nowIso,
    is_primary: true,
  });
  if (cErr) {
    if ((cErr as { code?: string }).code === "23505") {
      // Lost a race with another redemption of the same link (double click):
      // drop the orphan participant and collapse onto the winner's row, so no
      // duplicate participant record survives (§23.1: no duplicates).
      await db.from("participants").delete().eq("participant_id", pid);
      const { data: winner } = await db
        .from("participant_contacts")
        .select("contact_id, participant_id")
        .eq("contact_type", "email")
        .eq("normalized_value", contact)
        .maybeSingle();
      if (winner) {
        return redemptionResponse(
          request,
          (winner as { participant_id: string }).participant_id,
          false,
        );
      }
    }
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }

  return redemptionResponse(request, pid, true);
}
