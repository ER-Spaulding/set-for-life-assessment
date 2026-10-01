// Issue a verification message to a participant found by Set for Life Number.
//
// Addendum 02 v1.1 §4.4: "perform the required secure verification step using the
// verified contact method associated with the participant."
//
// WHY THIS RESOLVES THE CONTACT ITSELF, and why that is the security property.
// The lookup route knows a PARTICIPANT ID and nothing else. The destination of
// the verification message is read from `participant_contacts` — the record —
// and is never accepted from the request. If a caller could name the address,
// then knowing a Set for Life Number would be enough to have the secure link
// delivered somewhere the caller controls, which is exactly the "known/guessed
// number" access §4.2 forbids.
//
// NO CONTACT, NO SEND. A provisional participant has no contact row at all: they
// began without an identity wall (§3), so there is nothing to verify against and
// nothing to send to. That is not an error — it is the correct outcome for a
// participant who never established a retrievable identity, and the caller
// treats it identically to "no match" so the response cannot be used to learn
// which numbers belong to claimed versus provisional records.

import { serviceClient } from "../db/client";
import { issueVerificationToken } from "./index";
import { sendVerificationEmail } from "../email/verification";

/**
 * Look up the participant's verified contact and send them a link.
 *
 * Returns nothing: the caller must NOT branch on the outcome, or the response
 * would leak whether a record exists (§7.3, §4.2).
 */
export async function issueReturningVerification(participantId: string): Promise<void> {
  const db = serviceClient();

  // Prefer a VERIFIED email: §4.4 says the secure step uses "the verified
  // contact method associated with the participant". A provisional row has
  // contacts only after claiming.
  const { data: contact } = await db
    .from("participant_contacts")
    .select("normalized_value, contact_type")
    .eq("participant_id", participantId)
    .eq("contact_type", "email")
    .maybeSingle();

  const email = (contact as { normalized_value?: string } | null)?.normalized_value;
  if (!email) return; // provisional, or no email on file — nothing to send

  const { token, payload } = issueVerificationToken(email, "email", "returning");

  await sendVerificationEmail({
    to: email,
    purpose: "returning",
    contact: email,
    contactType: "email",
    expiresAt: payload.expiresAt,
    token,
  }).catch(() => {
    /* A send failure must not change the caller's response — see the route. */
  });
}
