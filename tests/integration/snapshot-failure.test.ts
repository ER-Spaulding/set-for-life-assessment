import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Snapshot failure-state copy — PRD §24 + the interrupted-write case.
 *
 * THE FALSEHOOD THIS GUARDS. The web results page had ONE failure branch, and
 * it rendered "It is prepared once every question has an answer" for ANY failed
 * load. That sentence is TRUE only for a 403 — a session that is genuinely not
 * complete. But a COMPLETED session whose Snapshot payload write was
 * interrupted surfaces as a 500 (the service throws, the route catches), and
 * telling that participant to finish their questions sends them back to a form
 * they already finished. The two states must not collapse.
 *
 * Two layers are locked, because each can break independently:
 *   1. the ROUTE must report the interrupted-write case as a server error
 *      (500), never "not available" (403) — a route that re-labels it 403
 *      would push the falsehood back into the page;
 *   2. the PAGE copy for a server error must never claim questions are
 *      unanswered, and must leak no internal code or identifier (§24).
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

const loadSnapshot = vi.fn();
vi.mock("@/lib/session/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session/service")>();
  return {
    ...actual,
    loadSnapshot: (...a: unknown[]) => loadSnapshot(...a),
  };
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

import {
  statusForFailedResponse,
  SERVER_ERROR_COPY,
  UNAVAILABLE_COPY,
} from "@/lib/ui/snapshot-failure";

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("GET /api/session/[id]/snapshot — a completed session with no stored payload", () => {
  it("is a server error (500), never 'not available' (403)", async () => {
    // A COMPLETED session whose payload write was interrupted: the service
    // throws rather than returning null. null is the ONLY value that means
    // "not complete yet", so a throw must surface as a server problem.
    loadSnapshot.mockRejectedValue(
      new Error("session: completed session s-1 has no stored Snapshot payload"),
    );
    const { GET } = await import("@/app/api/session/[id]/snapshot/route");
    const res = await GET(new Request("http://x"), ctx("s-1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("SNAPSHOT_FAILED");
    expect(body.error.code).not.toBe("NOT_AVAILABLE");
  });
});

describe("the page's failure copy distinguishes the two states", () => {
  it("a server error never claims questions are unanswered", () => {
    expect(statusForFailedResponse(500)).toBe("error");
    expect(SERVER_ERROR_COPY.headline).not.toContain("not available");
    expect(SERVER_ERROR_COPY.body).not.toContain("every question has an answer");
    expect(SERVER_ERROR_COPY.body).not.toMatch(/question/i);
  });

  it("a genuine 403 keeps the 'finish your questions' copy", () => {
    expect(statusForFailedResponse(403)).toBe("unavailable");
    expect(UNAVAILABLE_COPY.body).toBe(
      "Your Snapshot is prepared once all required assessment questions are complete.",
    );
  });

  it("leaks no internal code or identifier to the participant", () => {
    for (const s of [
      SERVER_ERROR_COPY.headline,
      SERVER_ERROR_COPY.body,
      UNAVAILABLE_COPY.headline,
      UNAVAILABLE_COPY.body,
    ]) {
      expect(s).not.toMatch(/SNAPSHOT_FAILED|NOT_AVAILABLE|snapshot_id|session_id|s-\d/i);
    }
  });

  it("the page actually routes through this copy — not a hardcoded false sentence", () => {
    // Guards against a reversion that inlines the old copy in the page and
    // leaves the module as dead code. Source-level, like money-picture-naming:
    // there is no DOM renderer in this suite.
    const page = readFileSync(
      resolve(__dirname, "../../app/(public)/snapshot/[sessionId]/page.tsx"),
      "utf8",
    );
    // Server-side render: a null payload is the "unavailable" state, a thrown
    // read is the "error" state — the page must route BOTH through the shared
    // copy, never inline a false sentence.
    expect(page).toMatch(/loadSnapshotPayload\(/);
    expect(page).toMatch(/SERVER_ERROR_COPY\.headline/);
    expect(page).toMatch(/SERVER_ERROR_COPY\.body/);
    expect(page).toMatch(/UNAVAILABLE_COPY\.headline/);
    expect(page).toMatch(/UNAVAILABLE_COPY\.body/);
  });
});
