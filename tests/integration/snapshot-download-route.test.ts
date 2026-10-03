import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Signed download route — Addendum 01 v1.1 §8, §11, §14 step 7.
 *
 * Asserts the route's AUTHORIZATION + ENUMERATION posture, which is the part
 * that must be right regardless of what the PDF generator does:
 *
 *   - an unsigned request 403s;
 *   - an expired/forged token 403s (verifyDownloadToken -> null);
 *   - a token minted for a DIFFERENT session 403s (sid mismatch);
 *   - a token whose document has no succeeded artifact 403s (bytes -> null);
 *   - every denial returns the SAME opaque body (no existence oracle);
 *   - a valid request streams `application/pdf`.
 *
 * The token and storage layers are mocked at their module boundary, so these
 * tests exercise the route's own decisions, not the HMAC or the bucket. The
 * real HMAC (expiry, tamper, purpose) is covered in
 * snapshot-download-token.test.ts; the real generation/upsert column shape is
 * covered in snapshot-document-storage.test.ts.
 */

vi.mock("server-only", () => ({}));

const isDbConfigured = vi.fn(() => true);
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => isDbConfigured(),
  isDatabaseConfigured: () => isDbConfigured(),
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

const ensureSnapshotDocument = vi.fn();
const loadSnapshotDocumentBytes = vi.fn();
vi.mock("@/lib/snapshot/document", () => ({
  ensureSnapshotDocument: (...a: unknown[]) => ensureSnapshotDocument(...a),
  loadSnapshotDocumentBytes: (...a: unknown[]) => loadSnapshotDocumentBytes(...a),
}));

const signDownloadToken = vi.fn();
const verifyDownloadToken = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  signDownloadToken: (...a: unknown[]) => signDownloadToken(...a),
  verifyDownloadToken: (...a: unknown[]) => verifyDownloadToken(...a),
}));

const recordEventInBackground = vi.fn();
vi.mock("@/lib/analytics/write", () => ({
  recordEventInBackground: (...a: unknown[]) => recordEventInBackground(...a),
}));

type RouteModule = typeof import("@/app/api/snapshot/[sessionId]/download/route");
let route: RouteModule | undefined;
async function getRoute(): Promise<RouteModule> {
  if (!route) route = await import("@/app/api/snapshot/[sessionId]/download/route");
  return route;
}

const ctx = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
const urlFor = (sessionId: string, token?: string) =>
  new Request(
    `http://x/api/snapshot/${sessionId}/download${token ? `?t=${token}` : ""}`,
  );

const DENIED_BODY = { error: { code: "DOWNLOAD_UNAVAILABLE", message: "The download is unavailable." } };

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("GET /api/snapshot/[sessionId]/download", () => {
  it("refuses an unsigned request with the uniform 403 body", async () => {
    const { GET } = await getRoute();
    const res = await GET(urlFor("s-1"), ctx("s-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED_BODY);
    expect(verifyDownloadToken).not.toHaveBeenCalled();
  });

  it("refuses an expired/forged token (verify -> null) with the same 403 body", async () => {
    verifyDownloadToken.mockReturnValue(null);
    const { GET } = await getRoute();
    const res = await GET(urlFor("s-1", "forged"), ctx("s-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED_BODY);
    expect(loadSnapshotDocumentBytes).not.toHaveBeenCalled();
  });

  it("refuses a token minted for a DIFFERENT session (wrong participant)", async () => {
    // A participant who owns s-2 replays their own valid token against s-1.
    verifyDownloadToken.mockReturnValue({ sid: "s-2", doc: "doc-2" });
    const { GET } = await getRoute();
    const res = await GET(urlFor("s-1", "token-for-s-2"), ctx("s-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED_BODY);
    expect(loadSnapshotDocumentBytes).not.toHaveBeenCalled();
  });

  it("refuses when the session has no succeeded document (bytes -> null)", async () => {
    verifyDownloadToken.mockReturnValue({ sid: "s-1", doc: "doc-1" });
    loadSnapshotDocumentBytes.mockResolvedValue(null);
    const { GET } = await getRoute();
    const res = await GET(urlFor("s-1", "token"), ctx("s-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED_BODY);
  });

  it("streams application/pdf for a valid, session-bound token", async () => {
    verifyDownloadToken.mockReturnValue({ sid: "s-1", doc: "doc-1" });
    loadSnapshotDocumentBytes.mockResolvedValue({
      bytes: Buffer.from("%PDF-1.3 fake"),
      generatedAt: "2026-10-02T15:30:00.000Z",
    });
    const { GET } = await getRoute();
    const res = await GET(urlFor("s-1", "token"), ctx("s-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Set-for-Life-Financial-Snapshot-2026-10-02.pdf"',
    );
    expect(loadSnapshotDocumentBytes).toHaveBeenCalledWith("s-1", "doc-1");
  });
});

describe("POST /api/snapshot/[sessionId]/download", () => {
  it("403s when the session is not completed (ensure -> null)", async () => {
    ensureSnapshotDocument.mockResolvedValue(null);
    const { POST } = await getRoute();
    const res = await POST(urlFor("s-1"), ctx("s-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED_BODY);
  });

  it("500s (retryable) when generation fails", async () => {
    ensureSnapshotDocument.mockRejectedValue(new Error("upload failed"));
    const { POST } = await getRoute();
    const res = await POST(urlFor("s-1"), ctx("s-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("GENERATION_FAILED");
  });

  it("returns a signed download URL for a completed session", async () => {
    ensureSnapshotDocument.mockResolvedValue({
      documentId: "doc-1",
      storageObjectKey: "snapshots/doc-1.pdf",
      checksum: "abc",
      reportVersion: "1.0",
      generatedAt: null,
      generated: true,
    });
    signDownloadToken.mockReturnValue("signed-token");
    const { POST } = await getRoute();
    const res = await POST(urlFor("s-1"), ctx("s-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("/api/snapshot/s-1/download?t=signed-token");
    expect(signDownloadToken).toHaveBeenCalledWith("s-1", "doc-1");
    expect(recordEventInBackground).toHaveBeenCalledWith({
      eventName: "snapshot_pdf_generated",
      sessionId: "s-1",
    });
  });
});
