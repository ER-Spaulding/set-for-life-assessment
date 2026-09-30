// PRD §7, §22.2, §23.1 — participant identity and verification.
//
// THIS MODULE IS SERVER-ONLY.
//
// PRD §22.2, verbatim:
//   "The permanent internal participant_id is a random UUID and is never the
//    email address."
//   "Do not auto-merge identities based on name, phone, demographics, IP
//    address, device fingerprint, or similar inference."
//
// PRD §7.3, verbatim:
//   "Do not reveal whether an email has a participant record before
//    verification in a way that creates account-enumeration risk."
//
// There is deliberately NO function here that merges two participants, and no
// column anywhere that could key such a merge. Where the product needs to
// recognise a returning participant, it does so by matching a VERIFIED
// contact — never by name, demographics, or device signal.

import "server-only";
import { randomUUID, createHash } from "node:crypto";

/**
 * Generate a participant id. A random UUID, never derived from the email.
 * Kept as a function (not an inline `randomUUID()` call) so the invariant has
 * one home and can be asserted in tests.
 */
export function newParticipantId(): string {
  return randomUUID();
}

/**
 * Normalise an email for storage and comparison.
 *
 * Lowercases and trims only. Deliberately does NOT strip dots or `+tags`:
 * Gmail's dot-insensitivity is a provider-specific behaviour, and applying it
 * globally would silently merge two genuinely different addresses — exactly
 * the inference-based merging PRD §22.2 forbids.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Normalise a mobile number to E.164-ish digits.
 *
 * Keeps a leading `+` and digits, strips separators. Returns null when the
 * result cannot be a phone number, so a malformed number is rejected rather
 * than stored in a form that later fails to send (UIUX §27A lists
 * "mobile number invalid" as a required system state).
 */
export function normaliseMobile(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

/**
 * A stable, non-reversible handle for a contact, used only for idempotent
 * lookups within a single purpose. Never used as an identity key and never
 * exposed to a participant.
 */
export function contactFingerprint(contactType: "email" | "mobile", value: string): string {
  return createHash("sha256")
    .update(`${contactType}:${value}`)
    .digest("hex");
}

/**
 * The response body for BOTH verification-start endpoints.
 *
 * PRD §7.3 requires that starting verification reveals nothing about whether a
 * participant record exists. Both `start-new` and `start-returning` return
 * exactly this shape, so the two are indistinguishable to a caller probing for
 * registered emails. Timing is equalised at the route layer by doing the same
 * work on both paths.
 */
export function verificationStartedBody() {
  return {
    status: "verification_started" as const,
    message:
      "If that email can be used with the assessment, a verification link is on its way.",
  };
}

/** Shape of a verification token. Opaque to the client. */
export interface VerificationToken {
  contactType: "email" | "mobile";
  /** The normalised contact the token was issued for. */
  contact: string;
  /** Epoch milliseconds. Expiry is enforced on redemption. */
  expiresAt: number;
}

/** How long a verification link stays valid. */
export const VERIFICATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Issue a verification token. The `purpose` is bound into the digest so a token
 * minted for one flow cannot be replayed in another.
 */
export function issueVerificationToken(
  contact: string,
  contactType: "email" | "mobile",
  purpose: "new" | "returning",
  now: number = Date.now(),
): { token: string; payload: VerificationToken } {
  const payload: VerificationToken = {
    contactType,
    contact,
    expiresAt: now + VERIFICATION_TTL_MS,
  };
  const secret = process.env.REMINDER_LINK_SECRET ?? "";
  if (!secret) {
    throw new Error("auth: REMINDER_LINK_SECRET is not set");
  }
  const token = createHash("sha256")
    .update(`${purpose}:${contactType}:${contact}:${payload.expiresAt}:${secret}`)
    .digest("hex");
  return { token, payload };
}

/** True when a verification token has not yet expired. */
export function isVerificationFresh(
  payload: VerificationToken,
  now: number = Date.now(),
): boolean {
  return Number.isFinite(payload.expiresAt) && payload.expiresAt > now;
}
