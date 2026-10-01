import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * API route boundary tests — the layer that had ZERO execution coverage.
 *
 * WHY THIS FILE EXISTS.
 *
 * All 14 routes under `app/api/` were untested by execution. An earlier grep
 * made it look like several were covered, but verifying properly showed the
 * "hits" were coincidental word matches inside narrative strings — nothing
 * imported a route handler or issued a request. The activation defect lived in
 * exactly this class of blind spot: the untested layer is where the bug was.
 *
 * These tests exercise the REAL exported handlers with the database stubbed,
 * and assert on the HTTP contract a caller actually sees:
 *   - status codes
 *   - what the response body does and does NOT contain
 *   - that no privileged or diagnostic field reaches the client (PRD §24)
 *   - that client input cannot assert server-owned state (PRD §23.5)
 *
 * The rule most worth defending here: PRD §23.5 — "Never trust client-side
 * completion, identity ownership, scoring, or consent state." A route that
 * accepted a `complete: true` field would pass every engine test and still
 * violate the spec.
 */

vi.mock("server-only", () => ({}));

const isDbConfigured = vi.fn(() => true);
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => isDbConfigured(),
  isDatabaseConfigured: () => isDbConfigured(),
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

const completeSession = vi.fn();
const loadSnapshot = vi.fn();
const loadResumeState = vi.fn();
vi.mock("@/lib/session/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session/service")>();
  return {
    ...actual,
    completeSession: (...a: unknown[]) => completeSession(...a),
    loadSnapshot: (...a: unknown[]) => loadSnapshot(...a),
    loadResumeState: (...a: unknown[]) => loadResumeState(...a),
  };
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("POST /api/session/[id]/complete — server owns completion (PRD §23.5)", () => {
  it("returns 422 with the missing items when the assessment is unfinished", async () => {
    completeSession.mockResolvedValue({
      sessionId: "s-1",
      complete: false,
      missing: ["Q25", "A4"],
      present: 29,
      required: 31,
    });
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s-1"));
    const body = await res.json();

    console.log("  422 body:", JSON.stringify(body));
    expect(res.status).toBe(422);
    expect(body.complete).toBe(false);
    expect(body.missing).toEqual(["Q25", "A4"]);
    expect(body.present).toBe(29);
  });

  it("IGNORES a client-supplied completeness claim entirely", async () => {
    // The heart of §23.5. A caller posting {"complete": true} must not be able
    // to influence the outcome: the handler takes no body at all.
    completeSession.mockResolvedValue({
      sessionId: "s-1",
      complete: false,
      missing: ["Q25"],
      present: 30,
      required: 31,
    });
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ complete: true, status: "completed", consent: true }),
      }),
      ctx("s-1"),
    );
    const body = await res.json();

    console.log("  forged-complete body:", JSON.stringify(body));
    expect(res.status).toBe(422);
    expect(body.complete).toBe(false);
    // It passes ONLY the session id through to the service.
    expect(completeSession).toHaveBeenCalledWith("s-1");
  });

  it("returns 200 with the session id on genuine completion", async () => {
    completeSession.mockResolvedValue({ sessionId: "s-1", complete: true });
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // `firstName` is part of the response because the synthesis reveal renders
    // its approved completion line with it (Addendum 02 v1.1 §3.2/§15). An
    // undefined name must surface as an explicit null rather than vanishing,
    // so the client can tell "no verified identity" from a malformed payload.
    expect(body).toEqual({ complete: true, sessionId: "s-1", firstName: null });
  });

  it("passes a verified first name through to the reveal", async () => {
    // The positive case. Without this, the assertion above would pass on a
    // route that hardcoded null and the reveal would never personalize.
    completeSession.mockResolvedValue({
      sessionId: "s-1",
      complete: true,
      firstName: "Avery",
    });
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.firstName).toBe("Avery");
  });

  it("returns 503 when the database is not configured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s-1"));
    expect(res.status).toBe(503);
    expect(completeSession).not.toHaveBeenCalled();
  });

  it("never leaks an internal error message to the caller", async () => {
    completeSession.mockRejectedValue(
      new Error("duplicate key value violates unique constraint \"tensions_pkey\""),
    );
    const { POST } = await import("@/app/api/session/[id]/complete/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s-1"));
    const text = await res.text();

    console.log("  500 body:", text);
    expect(res.status).toBe(500);
    expect(text).not.toContain("constraint");
    expect(text).not.toContain("tensions_pkey");
    expect(text).not.toContain("duplicate key");
  });
});

describe("GET /api/session/[id]/snapshot — no diagnostics reach the participant (PRD §24)", () => {
  it("returns 403 mid-assessment, and the same 403 when the session does not exist", async () => {
    // Identical response for "not complete" and "not found": telling a caller
    // which one it is would leak session existence.
    loadSnapshot.mockResolvedValue(null);
    const { GET } = await import("@/app/api/session/[id]/snapshot/route");
    const res = await GET(new Request("http://x"), ctx("missing"));
    const body = await res.json();

    console.log("  403 body:", JSON.stringify(body));
    expect(res.status).toBe(403);
    expect(body.error.code).toBe("NOT_AVAILABLE");
  });

  it("returns the snapshot when complete — and carries NO scoring internals", async () => {
    loadSnapshot.mockResolvedValue({
      sessionId: "s-1",
      signals: [
        { signal: "SEE", state: "S5", narrativeKey: "signal_states.SEE.S5" },
      ],
      tensionCodes: ["HIGH_ACTIVITY_LOW_DIRECTION"],
      connectionKeys: ["HIGH_ACTIVITY_LOW_DIRECTION"],
      attentionArea: "DIRECTION",
    });
    const { GET } = await import("@/app/api/session/[id]/snapshot/route");
    const res = await GET(new Request("http://x"), ctx("s-1"));
    const body = await res.json();

    console.log("  200 body keys:", JSON.stringify(Object.keys(body)));
    expect(res.status).toBe(200);
    expect(body.attentionArea).toBe("DIRECTION");

    // PRD §24: no raw numeric scores, no evidence-chain payload, no classifier
    // tags. Assert on the serialized body so a nested field cannot slip past.
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "evidence_confidence",
      "evidenceConfidence",
      "classifier",
      "rawValue",
      "raw_value",
    ]) {
      expect(serialized, `snapshot must not expose ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("returns 503 when the database is not configured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { GET } = await import("@/app/api/session/[id]/snapshot/route");
    const res = await GET(new Request("http://x"), ctx("s-1"));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/session/[id] — resume state carries answers only, never diagnostics", () => {
  it("returns status, position and answers", async () => {
    loadResumeState.mockResolvedValue({
      sessionId: "s-1",
      status: "in_progress",
      currentPosition: 12,
      responses: { Q4: "Q4_C", Q21: ["Q21_A", "Q21_B"] },
    });
    const { GET } = await import("@/app/api/session/[id]/route");
    const res = await GET(new Request("http://x"), ctx("s-1"));
    const body = await res.json();

    console.log("  resume body keys:", JSON.stringify(Object.keys(body)));
    expect(res.status).toBe(200);
    expect(body.currentPosition).toBe(12);
    // Mid-assessment the participant sees their answers and position, and
    // PRD §23.2 forbids showing scoring output before completion.
    const serialized = JSON.stringify(body);
    for (const forbidden of ["signals", "tensionCodes", "attentionArea", "evidence"]) {
      expect(serialized, `resume must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});
