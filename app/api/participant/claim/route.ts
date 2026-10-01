// Save My Progress — claim a provisional participant with a verified identity.
//
// Addendum 02 v1.1 §14:
//   "If a participant chooses Save My Progress:
//      - collect first name + email;
//      - verify as required;
//      - attach/claim the current provisional participant/session WITHOUT
//        duplicating responses;
//      - continue at the correct location."
//
// WHY THIS IS A TWO-STEP FLOW AND NOT ONE WRITE. Verification is an email round
// trip, so the claim cannot complete here — this route records the intent and
// sends the link. The identity is attached by the CALLBACK when the participant
// clicks, which is the moment ownership of the address is actually proven.
//
// THE PROVISIONAL ID TRAVELS IN THE LINK. That is the whole mechanism that makes
// "without duplicating responses" true. Without it the callback would see an
// unknown email and CREATE A SECOND participant — orphaning the provisional row
// and every answer already stored against it, which is precisely what §14
// forbids. The id is carried in the verification link so the callback claims the
// existing participant instead.
//
// WHY THE ID IS SAFE IN A LINK. It is a random UUID that identifies a row, and
// the link is delivered only to the address being verified. Possessing it grants
// nothing on its own: the callback still requires a valid, unexpired,
// signature-matching token before it will claim. The id says WHICH row to claim;
// the token proves the requester is entitled to claim it.
//
// THE EMAIL IS COLLECTED HERE, NOT TAKEN FROM THE REQUEST'S CLAIM ABOUT IT. It is
// normalised and checked for shape, then verified by round trip — the route never
// treats a submitted address as proven.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { normaliseEmail, issueVerificationToken, verificationStartedBody } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email/verification";
import { queryIfEmailBelongsToAnother } from "@/lib/session/provisional";
import { recordEventInBackground } from "@/lib/analytics/write";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  let firstName = "";
  let email = "";
  try {
    const body = (await request.json()) as {
      participantId?: unknown;
      firstName?: unknown;
      email?: unknown;
    };
    if (typeof body.participantId === "string") participantId = body.participantId;
    if (typeof body.firstName === "string") firstName = body.firstName.trim().slice(0, 120);
    if (typeof body.email === "string") email = normaliseEmail(body.email);
  } catch {
    /* falls through to validation */
  }

  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A participant is required."),
      { status: 400 },
    );
  }
  if (!firstName) {
    return NextResponse.json(
      errorBody("INVALID_NAME", "A first name is required to save your progress."),
      { status: 400 },
    );
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      errorBody("INVALID_EMAIL", "A valid email address is required."),
      { status: 400 },
    );
  }

  // If this address already belongs to a DIFFERENT participant, refuse rather
  // than merge. §5 of the Master PRD forbids automatic merging, and silently
  // folding two people's records together because they typed the same address is
  // exactly the identity error that rule exists to prevent. The participant is
  // told plainly and can use a different address.
  const belongsToAnother = await queryIfEmailBelongsToAnother(participantId, email).catch(
    () => false,
  );
  if (belongsToAnother) {
    return NextResponse.json(
      errorBody(
        "EMAIL_IN_USE",
        "That email is already connected to a different Set for Life record. Please use a different email, or continue without saving.",
      ),
      { status: 409 },
    );
  }

  const { token, payload } = issueVerificationToken(email, "email", "new");

  await sendVerificationEmail({
    to: email,
    purpose: "new",
    contact: email,
    contactType: "email",
    expiresAt: payload.expiresAt,
    token,
    firstName,
    // The claim id rides in the link so the callback attaches to THIS
    // participant rather than creating a second one (§14).
    claimParticipantId: participantId,
    // Best-effort, exactly like start-new: a send failure must not change the
    // response shape, and the participant can retry from the same screen.
  }).catch(() => {
    /* never surfaces */
  });

  // §16: the participant chose Save My Progress and a verification link was
  // sent. Recorded HERE because this route is what sent it — the browser only
  // asked. No name, no email, no participant-entered content: the event says
  // "the prompt was used", nothing about who used it or what they typed.
  recordEventInBackground({
    eventName: "save_progress_used",
    participantId,
  });

  return NextResponse.json(
    {
      ...verificationStartedBody(),
      ...(process.env.NODE_ENV !== "production" ? { devToken: token } : {}),
    },
    { status: 202 },
  );
}
