// PRD §30D — signed reminder links (server-only).
//
// "Reminder links must not function as permanent unauthenticated access to
// financial assessment data." Links are HMAC-signed with REMINDER_LINK_SECRET
// and carry an expiry (default 72h). An expired/tampered token verifies to
// null — never to access.

import { createHmac, timingSafeEqual } from "node:crypto";

export const REMINDER_TTL_MS = 72 * 3600 * 1000;

function getSecret(): string {
  const s = process.env.REMINDER_LINK_SECRET;
  if (!s) throw new Error("reminders: REMINDER_LINK_SECRET missing");
  return s;
}

/** Sign a time-limited reminder token bound to one session. */
export function signReminderLink(sessionId: string, ttlMs = REMINDER_TTL_MS): string {
  const payload = { sid: sessionId, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = Buffer.from(
    createHmac("sha256", getSecret()).update(body).digest(),
  ).toString("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a reminder token. Returns the bound session_id, or null when the
 * token is tampered, expired, or for a different session context.
 */
export function verifyReminderToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expected = Buffer.from(
      createHmac("sha256", getSecret()).update(body).digest(),
    ).toString("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sid?: unknown;
      exp?: unknown;
    };
    if (typeof payload.sid !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() > payload.exp) return null; // expired ≠ permanent access
    return payload.sid;
  } catch {
    return null;
  }
}
