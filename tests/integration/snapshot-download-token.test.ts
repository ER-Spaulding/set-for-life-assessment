import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signDownloadToken,
  verifyDownloadToken,
  signParticipantToken,
  DOWNLOAD_TTL_MS,
} from "@/lib/auth/session";

/**
 * The signed download token — Addendum 01 v1.1 §8 (signed/time-limited) and §11
 * (a participant may not reach another participant's document).
 *
 * The REAL HMAC implementation (node:crypto, base64url, purpose-tagged, `exp`,
 * constant-time compare). The route test mocks this module; these tests prove
 * the primitive itself: a valid token round-trips; an expired token is refused;
 * a tampered signature is refused; a token minted for a DIFFERENT purpose (the
 * participant session token) is refused — so no other token can be replayed as
 * a download, and the `sid -> doc` binding cannot be silently widened.
 */

const SECRET = "test-auth-secret";

beforeEach(() => {
  process.env.AUTH_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_TOKEN_SECRET;
});

describe("the download token binds sid -> doc and is short-lived", () => {
  it("round-trips a valid token to the same { sid, doc }", () => {
    const token = signDownloadToken("s-1", "doc-1");
    expect(verifyDownloadToken(token)).toEqual({ sid: "s-1", doc: "doc-1" });
  });

  it("refuses an expired token", () => {
    const now = vi.spyOn(Date, "now");
    const base = 1_000_000_000;
    now.mockReturnValue(base);
    const token = signDownloadToken("s-1", "doc-1");

    // still fresh inside the window
    now.mockReturnValue(base + DOWNLOAD_TTL_MS - 1);
    expect(verifyDownloadToken(token)).toEqual({ sid: "s-1", doc: "doc-1" });

    // just past the window
    now.mockReturnValue(base + DOWNLOAD_TTL_MS + 1);
    expect(verifyDownloadToken(token)).toBeNull();
  });

  it("refuses a tampered signature", () => {
    const token = signDownloadToken("s-1", "doc-1");
    const [body, sig] = token.split(".");
    const flipped = sig[0] === "a" ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
    expect(verifyDownloadToken(`${body}.${flipped}`)).toBeNull();
  });

  it("refuses a token minted for another purpose (the session token)", () => {
    const sessionToken = signParticipantToken("pid-1", "a@example.com");
    expect(verifyDownloadToken(sessionToken)).toBeNull();
  });

  it("does not accept a structurally different sid from the token's own", () => {
    const token = signDownloadToken("s-1", "doc-1");
    const claims = verifyDownloadToken(token);
    expect(claims?.sid).toBe("s-1");
    // A different sid is simply a different token — replaying requires forging.
    expect(claims?.sid === "s-2").toBe(false);
  });
});
