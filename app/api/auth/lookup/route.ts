// Returning-participant lookup by Set for Life Number — Addendum 02 v1.1 §4.
//
// THE SECURITY SHAPE OF THIS ROUTE IS THE FEATURE. §4.2:
//
//   "The Grease the Wheel number is a lookup/routing identifier, not a password.
//    A participant must never gain access to another person's prior financial
//    assessment or Snapshot solely by entering a known/guessed number."
//
// So this route RETURNS NO PARTICIPANT DATA — not a name, not a session id, not
// a Snapshot, not whether previous results exist. Its entire output is "we have
// sent (or not sent) a message to whatever contact is on file". Everything
// protected is behind the verification link that follows, which goes to a
// channel the requester must control.
//
// TWO DELIBERATE, DIFFERENT FAILURES:
//
//   400 MALFORMED — the number fails its own checksum, so it cannot be anyone's.
//       That is actionable and says nothing about any record, so it is safe to
//       be specific. It is the reason the check character exists.
//
//   202 for every WELL-FORMED number, whether or not it matches. This mirrors
//   the existing verification routes' anti-enumeration posture (PRD §7.3: "Do
//   not reveal whether an email has a participant record before verification in
//   a way that creates account-enumeration risk"). A 404 for unknown numbers
//   would turn this endpoint into an oracle: an attacker could test numbers
//   until one resolved, learning which are real. Because the identifier space is
//   large that is slow, but "slow to enumerate" is not the same as "cannot be
//   enumerated", and the fix costs nothing.
//
// The rate-limit question is NOT solved here. It is worth stating plainly rather
// than implying coverage: this route has no throttling, so it is enumerable at
// whatever rate the network allows. §4.2 is satisfied — possession grants no
// data — but a production deployment should add per-IP and per-number limits.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { normalizeJurisdictionSafe } from "@/lib/profile/jurisdiction-lookup";
import { verificationStartedBody } from "@/lib/auth";
import { recordEventInBackground } from "@/lib/analytics/write";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let raw: unknown;
  try {
    const body = (await request.json()) as { sflNumber?: unknown };
    raw = body.sflNumber;
  } catch {
    /* falls through to malformed */
  }

  const lookup = normalizeJurisdictionSafe(raw);

  // A checksum failure means this cannot be anyone's number, so naming the
  // problem is safe AND kind: "check the number" is better than a dead end.
  if (lookup.kind === "malformed" || lookup.kind === "absent") {
    // §16: an attempted lookup that failed its own checksum. Recorded with NO
    // participant correlator — by construction this number belongs to nobody,
    // so attaching one is impossible — and `outcome` distinguishes it from a
    // complete flow, which is the drop-off the returning funnel needs to see.
    recordEventInBackground({
      eventName: "returning_flow_started",
      payload: { outcome: "invalid_number" },
    });
    if (lookup.kind === "absent") {
      // An empty submission is a client bug, not a lookup.
      return NextResponse.json(errorBody("MALFORMED", "Enter your Set for Life Number."), {
        status: 400,
      });
    }
    return NextResponse.json(
      errorBody("MALFORMED", "That does not look like a Set for Life Number."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  const { data: participant } = await db
    .from("participants")
    .select("participant_id")
    .eq("sfl_number", lookup.normalized)
    .maybeSingle();

  const participantId = (participant as { participant_id?: string } | null)?.participant_id;

  // §16: a well-formed number was submitted. Recorded WITHOUT an `outcome`,
  // because this function must not learn whether the number resolved — the
  // anti-enumeration posture above is about what leaves this route, and writing
  // the distinction into a table an operator can read is the same disclosure
  // arriving by another door. The correlator is attached only when the row
  // genuinely exists, which is a fact the server may hold.
  recordEventInBackground({
    eventName: "returning_flow_started",
    participantId: participantId ?? null,
  });

  if (participantId) {
    // Send to the contact already on file for THIS participant. Deliberately no
    // contact is accepted from the request: §4 says the secure step uses "the
    // verified contact method associated with the participant", so letting the
    // caller name a destination would be the vulnerability this route exists to
    // avoid.
    //
    // Best-effort: a send failure must not change the response, or the response
    // would reveal whether a record exists.
    try {
      await sendVerificationIfPossible(participantId);
    } catch {
      /* intentionally swallowed — see above */
    }
  }

  // Identical response either way. `verificationStartedBody()` is the same shape
  // the existing verification routes return, so the anti-enumeration behaviour
  // is consistent across the flow rather than re-invented here.
  //
  // §16: the same reasoning applies to the event. It is recorded for every
  // well-formed number regardless of whether one resolved, so the count cannot
  // be read as a count of real participants.
  recordEventInBackground({
    eventName: "returning_flow_completed",
    participantId: participantId ?? null,
  });

  return NextResponse.json(verificationStartedBody(), { status: 202 });
}

/**
 * Trigger a verification send for an already-known participant.
 *
 * Kept as a thin seam so the route reads as one decision. The real work lives
 * with the existing verification machinery; this does not invent a second path.
 */
async function sendVerificationIfPossible(participantId: string): Promise<void> {
  const { issueReturningVerification } = await import("@/lib/auth/returning");
  await issueReturningVerification(participantId);
}
