// PRD §7.3, §22.2 — participant identity helpers (server-only).
//
// participant_id is a random UUID, never the email. There is deliberately NO
// identity auto-merge on name, phone, demographics, IP, or device (§4.2).
//
// Email verification + participant sessions are stateless HMAC-signed tokens
// (node:crypto, no extra tables): token = base64url(payload).base64url(sig).
// Secret from process.env (AUTH_TOKEN_SECRET, falling back to
// REMINDER_LINK_SECRET) — never a literal, never NEXT_PUBLIC_.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "sfl_session";
export const VERIFY_TTL_MS = 30 * 60 * 1000; // 30 min verification links
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 day participant session
/** Minimum response time for start-new/start-returning so timing is identical. */
export const AUTH_MIN_RESPONSE_MS = 400;

function getSecret(): string {
  const s = process.env.AUTH_TOKEN_SECRET ?? process.env.REMINDER_LINK_SECRET;
  if (!s) {
    throw new Error("auth: AUTH_TOKEN_SECRET / REMINDER_LINK_SECRET missing");
  }
  return s;
}

function b64urlEncode(raw: string | Buffer): string {
  return Buffer.from(raw).toString("base64url");
}

function sign(payload: Record<string, unknown>): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

// Constraint is `object` rather than `Record<string, unknown>`: an interface
// like VerifyToken has no index signature and so does not satisfy the stricter
// form, even though every field it declares is a valid JSON value.
function verify<T extends object>(
  token: string,
  purpose: string,
): (T & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as T & { exp: number; purpose: string };
    if (payload.purpose !== purpose) return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface VerifyToken {
  email: string;
  /** participant_id — null when the address has no record (returning flow). */
  pid: string | null;
}

/** Issue an email-verification token. pid=null keeps the returning-flow oracle-free. */
export function signVerifyToken(email: string, pid: string | null): string {
  return sign({
    purpose: "verify",
    email,
    pid,
    exp: Date.now() + VERIFY_TTL_MS,
  });
}

export function verifyVerifyToken(token: string): VerifyToken | null {
  const p = verify<VerifyToken>(token, "verify");
  if (!p || typeof p.email !== "string") return null;
  return { email: p.email, pid: typeof p.pid === "string" ? p.pid : null };
}

/** Issue a participant session token after successful verification. */
export function signParticipantToken(pid: string, email: string): string {
  return sign({
    purpose: "session",
    pid,
    email,
    exp: Date.now() + SESSION_TTL_MS,
  });
}

export function verifyParticipantToken(token: string): string | null {
  const p = verify<{ pid: string }>(token, "session");
  if (!p || typeof p.pid !== "string" || p.pid === "") return null;
  return p.pid;
}

/** Normalize an email for lookup/storage: trim + lowercase. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "" || v.length > 254 || !v.includes("@")) return null;
  return v;
}

/**
 * Extract the verified participant_id from the request: HttpOnly cookie
 * `sfl_session` first, then `Authorization: Bearer`. Returns null when absent
 * or invalid — callers return 401.
 */
export function getParticipantIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((part) => {
      const idx = part.indexOf("=");
      if (idx < 0) return ["", ""];
      return [
        part.slice(0, idx).trim(),
        decodeURIComponent(part.slice(idx + 1).trim()),
      ];
    }),
  );
  const fromCookie = cookies[SESSION_COOKIE];
  if (fromCookie) {
    const pid = verifyParticipantToken(fromCookie);
    if (pid) return pid;
  }
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const pid = verifyParticipantToken(auth.slice("Bearer ".length).trim());
    if (pid) return pid;
  }
  return null;
}

/** Set the participant session cookie on a response (HttpOnly, never JS-readable). */
export function setParticipantCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Constant-time string comparison for API keys (length-mismatch safe). */
export function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== b.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Pad an auth response to a minimum duration (identical timing profile). */
export async function padToMinimum(startedAt: number, minMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) {
    await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  }
}
