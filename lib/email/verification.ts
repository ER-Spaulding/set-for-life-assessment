// PRD §23.1, §25 — the verification email.
//
// Server-only (delegates to lib/email/send.ts, which imports "server-only").
//
// TONE. §25 specifies "premium editorial rather than generic SaaS quiz". This
// is the participant's FIRST contact with the brand, so the copy is written to
// that standard: no exclamation marks, no "Click here!", no marketing pressure.
// It states what the link does and how long it lasts.
//
// WHY BOTH HTML AND TEXT. A text alternative is not optional — a text/plain
// part materially improves deliverability, and some clients render only it.
// The plain-text version carries the same information and the same link.
//
// NO PARTICIPANT DATA IN THE EMAIL BEYOND THE ADDRESS ITSELF. The link carries
// the token; the body carries no scores, no signals, no assessment content.

import { sendEmail, verificationUrl, type SendResult } from "./send";

/** Escape for safe interpolation into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface VerificationEmailArgs {
  to: string;
  purpose: "new" | "returning";
  contact: string;
  contactType: "email" | "mobile";
  expiresAt: number;
  token: string;
  firstName?: string;
  lastName?: string;
}

/** How long the link is good for, in whole minutes, for the copy. */
function ttlMinutes(expiresAt: number, now = Date.now()): number {
  return Math.max(1, Math.round((expiresAt - now) / 60000));
}

export function verificationEmailContent(args: VerificationEmailArgs) {
  const url = verificationUrl(args);
  const minutes = ttlMinutes(args.expiresAt);
  const greeting = args.firstName ? `Hello ${args.firstName},` : "Hello,";
  const returning = args.purpose === "returning";

  const lead = returning
    ? "You asked to pick up where you left off."
    : "You are one step from beginning your Financial Assessment.";

  const subject = returning
    ? "Your Set for Life link"
    : "Begin your Set for Life Assessment";

  const text = [
    greeting,
    "",
    lead,
    "",
    "Open this link to verify your email and continue:",
    url,
    "",
    `For your security, this link expires in ${minutes} minutes.`,
    "If you did not request it, you can ignore this email — nothing will change.",
    "",
    "— Set for Life",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f2e9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2e9;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;background:#ffffff;border-radius:2px;">
          <tr>
            <td style="padding:48px 40px;">
              <p style="margin:0 0 24px;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#28513f;">
                Set for Life
              </p>
              <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:29px;color:#28231f;">
                ${esc(greeting)}
              </p>
              <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:29px;color:#28231f;">
                ${esc(lead)}
              </p>
              <p style="margin:0 0 28px;">
                <a href="${esc(url)}"
                   style="display:inline-block;padding:16px 32px;background:#28513f;color:#f7f2e9;font-family:Georgia,serif;font-size:24px;font-weight:700;text-decoration:none;border-radius:2px;">
                  Verify and continue
                </a>
              </p>
              <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#93504f;">
                For your security, this link expires in ${minutes} minutes.
              </p>
              <p style="margin:0 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#93504f;">
                If you did not request it, you can ignore this email — nothing will change.
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#28231f;word-break:break-all;">
                If the button does not work, copy this link into your browser:<br>
                <span style="color:#93504f;">${esc(url)}</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * Send the verification email. Returns a result and never throws, so an
 * anti-enumeration caller can ignore the outcome (§7.3) — a send failure must
 * not change the response.
 */
export async function sendVerificationEmail(
  args: VerificationEmailArgs,
): Promise<SendResult> {
  const { subject, html, text } = verificationEmailContent(args);
  return sendEmail({ to: args.to, subject, html, text });
}
