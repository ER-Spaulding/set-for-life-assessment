import { describe, it, expect, vi, beforeEach } from "vitest";
import { signParticipantToken, signRecoveryToken } from "@/lib/auth/session";

/**
 * POST/GET /api/participant/recover — the SECURITY surface of D-1.
 *
 * The route decides whether to hand a participant a fresh session holding a
 * provisional sitting's answers. Every id it acts on must come from a token the
 * SERVER signed, so the tests that matter are the ones proving a caller cannot
 * substitute an id of their choosing:
 *
 *   - no session cookie            -> 401 (nothing to act as)
 *   - recovery token minted for a DIFFERENT participant -> refused
 *   - recovery token with a tampered signature          -> refused
 *   - a provisional sitting that has since been CLAIMED -> refused
 *
 * The last one is the merge guard: those answers belong to an identity that
 * already exists, and copying them elsewhere is what §5 forbids.
 */

const m = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  participant: null as Record<string, unknown> | null,
  saved: null as Record<string, unknown> | null,
  answers: [] as { item_id: string; option_code: string }[],
  carry: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
  serviceClient: () => ({
    from(table: string) {
      if (table === "assessment_sessions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: m.session, error: null }),
              // The "saved session" lookup chains .in().order().limit().maybeSingle()
              in: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: () => Promise.resolve({ data: m.saved, error: null }) }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "participants") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: m.participant, error: null }) }),
          }),
        };
      }
      if (table === "responses") {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: m.answers, error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/session/recovery", () => ({
  carryForwardProvisionalAnswers: m.carry,
  readSessionAnswers: async () => ({ Q7: ["Q7_C"] }),
}));

// A real secret so signRecoveryToken/verifyRecoveryToken round-trip honestly.
process.env.REMINDER_LINK_SECRET = "test-only-not-a-real-secret";

const PID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const PROV = "33333333-3333-3333-3333-333333333333";

function req(opts: { action?: string; cookies?: string[] } = {}) {
  const cookie = (opts.cookies ?? []).join("; ");
  return new Request("http://x/api/participant/recover", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ action: opts.action ?? "carry_forward" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session = { session_id: PROV, participant_id: OTHER, status: "in_progress" };
  m.participant = { claimed_at: null };
  m.saved = null;
  m.answers = [{ item_id: "Q7", option_code: "Q7_C" }];
  m.carry.mockResolvedValue({ sessionId: "new-session", carriedItems: 1 });
});

describe("the actor is the signed cookie, never the body", () => {
  it("401s when there is no participant session", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    const res = await POST(req({ cookies: [] }));
    expect(res.status).toBe(401);
    expect(m.carry).not.toHaveBeenCalled();
  });

  it("there is NO field in the body through which a participant could be named", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    // A body naming someone else changes nothing: the route never reads it.
    const res = await POST(
      new Request("http://x/api/participant/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "carry_forward", participantId: OTHER }),
      }),
    );
    expect(res.status, "still unauthenticated — the body grants nothing").toBe(401);
    expect(m.carry).not.toHaveBeenCalled();
  });

  it("400s on an unknown action", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    const res = await POST(
      req({ action: "merge_everything", cookies: [`sfl_session=${signParticipantToken(PID, "")}`] }),
    );
    expect(res.status).toBe(400);
    expect(m.carry).not.toHaveBeenCalled();
  });
});

describe("the provisional sitting is bound to the participant by SIGNATURE", () => {
  it("refuses a recovery token minted for a DIFFERENT participant", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    // The actor is PID, but the token was minted for OTHER. Substituting the
    // sitting this way must not work — this is the cross-participant read the
    // signature exists to prevent.
    const res = await POST(
      req({
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(signRecoveryToken(OTHER, PROV))}`,
        ],
      }),
    );
    expect(res.status).toBe(404);
    expect(m.carry, "nothing may be carried on a mismatched binding").not.toHaveBeenCalled();
  });

  it("refuses a recovery token whose signature was tampered with", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    const good = signRecoveryToken(PID, PROV);
    const tampered = good.slice(0, -4) + "AAAA";
    const res = await POST(
      req({
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(tampered)}`,
        ],
      }),
    );
    expect(res.status).toBe(404);
    expect(m.carry).not.toHaveBeenCalled();
  });

  it("carries forward when the binding is intact and the sitting is provisional", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    m.session = { session_id: PROV, participant_id: OTHER, status: "in_progress" };
    m.participant = { claimed_at: null };
    const res = await POST(
      req({
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(signRecoveryToken(PID, PROV))}`,
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ sessionId: "new-session", carried: true });
    // The verified participant is the ACTOR, never the sitting's owner.
    expect(m.carry).toHaveBeenCalledWith({
      verifiedParticipantId: PID,
      provisionalSessionId: PROV,
    });
  });
});

describe("only an unclaimed, live sitting may be carried", () => {
  it("refuses a sitting that already belongs to a CLAIMED identity", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    m.participant = { claimed_at: "2026-10-01T00:00:00.000Z" };
    const res = await POST(
      req({
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(signRecoveryToken(PID, PROV))}`,
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(m.carry).not.toHaveBeenCalled();
  });

  it("refuses an EXPIRED sitting — its answers are historical", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    m.session = { session_id: PROV, participant_id: OTHER, status: "expired" };
    const res = await POST(
      req({
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(signRecoveryToken(PID, PROV))}`,
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(m.carry).not.toHaveBeenCalled();
  });
});

describe("resume writes nothing", () => {
  it("returns the participant's own saved session and never calls carry", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    m.saved = { session_id: "their-own-saved-session" };
    const res = await POST(
      req({
        action: "resume",
        cookies: [
          `sfl_session=${signParticipantToken(PID, "")}`,
          `sfl_recovery=${encodeURIComponent(signRecoveryToken(PID, PROV))}`,
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sessionId: "their-own-saved-session", carried: false });
    // The whole point of RESUME: today's sitting is NOT blended in.
    expect(m.carry).not.toHaveBeenCalled();
  });

  it("404s when there is no saved session to resume", async () => {
    const { POST } = await import("@/app/api/participant/recover/route");
    m.saved = null;
    const res = await POST(
      req({ action: "resume", cookies: [`sfl_session=${signParticipantToken(PID, "")}`] }),
    );
    expect(res.status).toBe(404);
  });
});
