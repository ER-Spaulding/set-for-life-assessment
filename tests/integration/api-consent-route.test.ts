import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/participant/consent — the consent gate.
 *
 * WHY THIS FILE EXISTS.
 *
 * Consent is the one place where a DEFAULT is the defect. UIUX §22A: "Do not
 * pre-check consent." PRD §23.5: "Never trust client-side ... consent state."
 * A route that treated a missing `granted` field as an implicit yes would pass
 * every engine test in this repo and still be the single worst bug in it.
 *
 * These tests exercise the real handler with the database stubbed and assert
 * the refusals, which is where the safety lives:
 *   - omitting `granted` is 400, never a silent grant
 *   - a non-boolean `granted` is refused, not coerced
 *   - the record must state which consent text was shown (§23.3)
 *   - revoking something never granted does not invent a record
 *   - consent is read from the request ONLY — never derived from activation,
 *     responses, or the Snapshot
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

interface Captured {
  inserted: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
}

function fakeDb(opts: { existing?: Record<string, unknown> | null } = {}) {
  const captured: Captured = { inserted: null, updated: null };

  const selectChain = {
    select: () => selectChain,
    eq: () => selectChain,
    maybeSingle: () =>
      Promise.resolve({ data: opts.existing ?? null, error: null }),
  };

  const db = {
    from(table: string) {
      if (table !== "communication_consents") {
        throw new Error(`fakeDb: unexpected table ${table}`);
      }
      return {
        ...selectChain,
        insert: (payload: Record<string, unknown>) => {
          captured.inserted = payload;
          return Promise.resolve({ error: null });
        },
        update: (payload: Record<string, unknown>) => {
          captured.updated = payload;
          const chain = {
            eq: () => Promise.resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { db, captured };
}

const PID = "11111111-2222-3333-4444-555555555555";

function post(body: unknown) {
  return new Request("http://x/api/participant/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(
  body: unknown,
  opts: { existing?: Record<string, unknown> | null } = {},
) {
  const { db, captured } = fakeDb(opts);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const { POST } = await import("@/app/api/participant/consent/route");
  const res = await POST(post(body));
  return { res, body: await res.json().catch(() => null), captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("consent is never assumed (UIUX §22A, PRD §23.5)", () => {
  it("OMITTING `granted` is 400 — never a silent grant", async () => {
    // The pre-checked-box failure mode: a client that says nothing must not be
    // recorded as having agreed.
    const { res, body, captured } = await call({
      participantId: PID,
      channel: "email",
      purpose: "marketing",
      consentTextVersion: "v1.0",
    });
    console.log("  omitted granted ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CONSENT_NOT_STATED");
    expect(captured.inserted).toBeNull();
  });

  it("a non-boolean `granted` is refused, not coerced", async () => {
    // "true" (string), 1, and {} are all truthy-ish. None may become consent.
    for (const bad of ["true", 1, {}, [], "yes"]) {
      const { res, captured } = await call({
        participantId: PID,
        channel: "email",
        purpose: "marketing",
        granted: bad,
        consentTextVersion: "v1.0",
      });
      console.log(`  granted=${JSON.stringify(bad)} ->`, res.status);
      expect(res.status, `granted=${JSON.stringify(bad)}`).toBe(400);
      expect(captured.inserted).toBeNull();
    }
  });

  it("requires the consent-text version — the record must say what was agreed to (§23.3)", async () => {
    const { res, body, captured } = await call({
      participantId: PID,
      channel: "email",
      purpose: "marketing",
      granted: true,
    });
    console.log("  missing version ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("MISSING_CONSENT_VERSION");
    expect(captured.inserted).toBeNull();
  });

  it("rejects an unverified participant id", async () => {
    for (const bad of ["", "not-a-uuid", "12345", undefined]) {
      const { res, captured } = await call({
        participantId: bad,
        channel: "email",
        purpose: "marketing",
        granted: true,
        consentTextVersion: "v1.0",
      });
      expect(res.status, `participantId=${String(bad)}`).toBe(400);
      expect(captured.inserted).toBeNull();
    }
  });

  it("rejects an unknown channel or purpose rather than storing it", async () => {
    const { res: r1 } = await call({
      participantId: PID,
      channel: "carrier-pigeon",
      purpose: "marketing",
      granted: true,
      consentTextVersion: "v1.0",
    });
    expect(r1.status).toBe(400);

    const { res: r2 } = await call({
      participantId: PID,
      channel: "email",
      purpose: "whatever",
      granted: true,
      consentTextVersion: "v1.0",
    });
    expect(r2.status).toBe(400);
  });
});

describe("consent is read from the request only — never derived from anything else", () => {
  it("an explicit true grants, stamped with a timestamp and the text version", async () => {
    const { res, body, captured } = await call({
      participantId: PID,
      channel: "email",
      purpose: "marketing",
      granted: true,
      consentTextVersion: "v1.0",
    });
    console.log("  granted ->", res.status, JSON.stringify(body));
    console.log("  inserted:", JSON.stringify(captured.inserted));
    expect(res.status).toBe(201);
    expect(captured.inserted).toMatchObject({
      participant_id: PID,
      channel: "email",
      purpose: "marketing",
      status: "granted",
      consent_text_version: "v1.0",
      source: "participant_ui",
    });
    expect(typeof captured.inserted!.granted_at).toBe("string");
  });

  it("extra fields that might imply consent are IGNORED", async () => {
    // The route reads exactly channel/purpose/granted/version/participantId.
    // Fields that look like they could imply permission must not leak in.
    const { captured } = await call({
      participantId: PID,
      channel: "email",
      purpose: "marketing",
      granted: true,
      consentTextVersion: "v1.0",
      // things that must NOT end up in the row:
      A4: "A4_E",
      activationLevel: "HIGH",
      supportReadiness: true,
      snapshotConsent: true,
    });
    const inserted = captured.inserted!;
    console.log("  inserted keys:", JSON.stringify(Object.keys(inserted)));
    for (const forbidden of ["A4", "activationLevel", "supportReadiness", "snapshotConsent"]) {
      expect(inserted, `row must not carry ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });
});

describe("revocation references a real grant", () => {
  it("revoking with no active grant reports no_active_consent and writes nothing", async () => {
    // Rule 3: never invent a record for a revocation of something that was
    // never granted.
    const { res, body, captured } = await call(
      {
        participantId: PID,
        channel: "email",
        purpose: "marketing",
        granted: false,
        consentTextVersion: "v1.0",
      },
      { existing: null },
    );
    console.log("  revoke-nonexistent ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body).toEqual({ recorded: false, reason: "no_active_consent" });
    expect(captured.updated).toBeNull();
    expect(captured.inserted).toBeNull();
  });

  it("revoking an existing grant updates it with a revocation timestamp", async () => {
    const { res, body, captured } = await call(
      {
        participantId: PID,
        channel: "email",
        purpose: "marketing",
        granted: false,
        consentTextVersion: "v1.0",
      },
      { existing: { consent_id: "c-1", status: "granted" } },
    );
    console.log("  revoke ->", res.status, JSON.stringify(body));
    console.log("  updated:", JSON.stringify(captured.updated));
    expect(res.status).toBe(200);
    expect(body).toEqual({ recorded: true, status: "revoked" });
    expect(captured.updated).toMatchObject({ status: "revoked" });
    expect(typeof captured.updated!.revoked_at).toBe("string");
  });
});

describe("infrastructure failures are opaque", () => {
  it("returns 503 without reading the body when the database is unconfigured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { res } = await call({ granted: true });
    expect(res.status).toBe(503);
  });
});
