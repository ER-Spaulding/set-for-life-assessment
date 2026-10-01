// PRD §23.1, §30B — transactional email, server-only.
//
// THIS MODULE IS SERVER-ONLY. The Resend key is read from process.env with no
// NEXT_PUBLIC_ prefix, so it is never inlined into a client bundle (§24).
//
// FAIL-CLOSED. Every function here returns a result rather than throwing at the
// call site, and an unconfigured key produces `{ sent: false, reason:
// "not_configured" }` — never a crash and never a silent success. Callers must
// treat "not configured" as "did not send", because the alternative is telling
// a participant to check an inbox that will never receive anything.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   - It does not log addresses, tokens, or message bodies. A verification
//     token in a log is a credential (§24: "Do not log raw sensitive
//     responses to public client logs").
//   - It does not retry. A send failure at verification time must not change
//     the HTTP response, or response timing would leak whether an address is
//     already known (§7.3, anti-enumeration).

import "server-only";

/** The default sender. Operator decision 2026-09-30 (apex domain). */
export const DEFAULT_FROM = "Set for Life <hello@setforlifelive.com>";

export interface SendResult {
  sent: boolean;
  /** Present when sent === false. Never contains participant data. */
  reason?: "not_configured" | "rejected" | "transport_error";
  /** Provider message id when sent === true. */
  id?: string;
}

/**
 * True when the server can send mail at all.
 *
 * Mirrors `isDbConfigured()` in lib/db/client.ts: callers check this before
 * asking for a send, so an unconfigured environment degrades visibly rather
 * than throwing at the first participant.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function fromAddress(): string {
  return process.env.EMAIL_FROM || DEFAULT_FROM;
}

/** Absolute base URL for links in email. No trailing slash. */
export function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * The verification link. MUST match the contract documented in
 * app/auth/callback/route.ts — that route recomputes the digest from these
 * exact params, so a change here without a matching change there breaks every
 * verification link in flight.
 */
export function verificationUrl(args: {
  purpose: "new" | "returning";
  contact: string;
  expiresAt: number;
  token: string;
  firstName?: string;
  lastName?: string;
}): string {
  const q = new URLSearchParams({
    purpose: args.purpose,
    contactType: "email",
    contact: args.contact,
    expiresAt: String(args.expiresAt),
    token: args.token,
  });
  if (args.firstName) q.set("firstName", args.firstName);
  if (args.lastName) q.set("lastName", args.lastName);
  return `${appUrl()}/auth/callback?${q.toString()}`;
}

/**
 * Send one email via Resend.
 *
 * Returns a result; never throws. A caller in an anti-enumeration path must be
 * able to ignore the outcome entirely.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "not_configured" };

  try {
    // Imported lazily so an unconfigured deployment never even loads the SDK.
    const { Resend } = await import("resend");
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      // The provider's message can echo the recipient; it is NOT logged or
      // returned verbatim. The reason code is enough for the caller.
      return { sent: false, reason: "rejected" };
    }
    return { sent: true, id: data?.id };
  } catch {
    return { sent: false, reason: "transport_error" };
  }
}
