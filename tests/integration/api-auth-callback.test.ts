import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

/**
 * GET /auth/callback — verification redemption.
 *
 * WHY THIS FILE EXISTS.
 *
 * The two start routes are the anti-enumeration pair; THIS route is where the
 * new-vs-existing decision actually happens — after verification proves email
 * ownership, so an unguessable per-email token gates every response (no oracle).
 * Two failure modes matter and neither is visible elsewhere:
 *   - TAMPER/EXPIRY: a forged or expired link must not verify. The token
 *     formula is pinned here to lib/auth's issueVerificationToken, so a drift
 *     between mint and check fails loudly instead of breaking redemption.
 *   - DUPLICATES: PRD §23.1 — an existing email must reuse its participant,
 *     and a double-clicked link (UNIQUE race) must collapse onto one row.
 */

vi.mock("server-only", () => ({}));

// Same fixture secret the auth-pair tests use. Clearly fake, test-only; the
// real value lives only in the environment (PRD §30B).
process.env.REMINDER_LINK_SECRET = "test-only-not-a-real-secret";

const isDbConfigured = vi.fn(() => true);
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => isDbConfigured(),
  isDatabaseConfigured: () => isDbConfigured(),
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

const SECRET = "test-only-not-a-real-secret";

/** Token built by the SAME formula the route checks (see route header). */
function realToken(purpose: string, contact: string, expiresAt: number): string {
  return createHash("sha256")
    .update(`${purpose}:email:${contact}:${expiresAt}:${SECRET}`)
    .digest("hex");
}

/**
 * A redemption request.
 *
 * `asJson` mirrors what a non-browser caller sends. The route now REDIRECTS a
 * browser (a participant clicking the emailed link must land on a page, not on
 * raw JSON) and returns JSON only when the caller asks for it — so tests that
 * assert on the body must opt in, exactly as an API client would.
 */
function link(params: Record<string, string>, asJson = true): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://x/auth/callback?${qs}`, {
    headers: asJson ? { accept: "application/json" } : {},
  });
}

const FUTURE = Date.now() + 10 * 60 * 1000;
const EMAIL = "ada@example.com";

interface CallOpts {
  /** Sequential results for the participant_contacts lookups (first, re-lookup). */
  contactRows?: Array<Record<string, unknown> | null>;
  insertContactError?: { code?: string } | null;
  /** Ask for JSON (API caller). Default true; false exercises the browser path. */
  asJson?: boolean;
}

async function call(params: Record<string, string>, opts: CallOpts = {}) {
  const written: Array<{ table: string; payload: Record<string, unknown> }> = [];
  let orphanDeleted: string | null = null;
  let lookups = 0;
  const rows = opts.contactRows ?? [null];

  const contactChain: Record<string, unknown> = {};
  contactChain.select = () => contactChain;
  contactChain.eq = () => contactChain;
  contactChain.maybeSingle = () => {
    const data = rows[Math.min(lookups, rows.length - 1)] ?? null;
    lookups += 1;
    return Promise.resolve({ data, error: null });
  };
  contactChain.update = () => ({
    eq: () => Promise.resolve({ error: null }),
  });

  const db = {
    from(table: string) {
      if (table === "participant_contacts") {
        return {
          ...contactChain,
          insert: (payload: Record<string, unknown>) => {
            written.push({ table, payload });
            if (opts.insertContactError) {
              return Promise.resolve({ error: opts.insertContactError });
            }
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "participants") {
        return {
          insert: (payload: Record<string, unknown>) => {
            written.push({ table, payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { participant_id: "new-pid" },
                    error: null,
                  }),
              }),
            };
          },
          delete: () => ({
            eq: (_c: string, v: string) => {
              orphanDeleted = v;
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };

  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const { GET } = await import("@/app/auth/callback/route");
  const res = await GET(link(params, opts.asJson ?? true));
  return {
    res,
    body: await res.json().catch(() => null),
    written,
    orphanDeleted,
  };
}

const goodParams = (purpose = "new") => ({
  purpose,
  contactType: "email",
  contact: EMAIL,
  expiresAt: String(FUTURE),
  token: realToken(purpose, EMAIL, FUTURE),
});

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("link integrity — forged and stale links do not verify", () => {
  it("rejects a token minted for the OTHER purpose (new↔returning flip)", async () => {
    const { res, body, written } = await call({
      ...goodParams("new"),
      purpose: "returning", // token was minted for "new"
    });
    console.log("  purpose-flip ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("INVALID_TOKEN");
    expect(written).toHaveLength(0);
  });

  it("rejects a token minted for a different address", async () => {
    const { res, body, written } = await call({
      ...goodParams("new"),
      contact: "mallory@example.com",
    });
    console.log("  wrong-address ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(401);
    expect(written).toHaveLength(0);
  });

  it("rejects an expired link with 410, not a verification", async () => {
    const past = Date.now() - 1000;
    const { res, body, written } = await call({
      purpose: "new",
      contactType: "email",
      contact: EMAIL,
      expiresAt: String(past),
      token: realToken("new", EMAIL, past),
    });
    console.log("  expired ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(410);
    expect(body.error.code).toBe("LINK_EXPIRED");
    expect(written).toHaveLength(0); // nothing is written for a stale link
  });

  it("rejects an incomplete link with 400", async () => {
    const { res } = await call({ purpose: "new", contactType: "email" });
    expect(res.status).toBe(400);
  });

  it("returns 503 without verifying when the database is unconfigured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { res } = await call(goodParams("new"));
    expect(res.status).toBe(503);
  });
});

describe("no duplicate participant records (PRD §23.1)", () => {
  it("an existing email reuses its participant and writes no new rows", async () => {
    const { res, body, written } = await call(goodParams("returning"), {
      contactRows: [{ contact_id: "c-1", participant_id: "existing-pid" }],
    });
    console.log("  existing ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body).toEqual({
      verified: true,
      participantId: "existing-pid",
      newParticipant: false,
    });
    expect(written).toHaveLength(0);
    // The participant id must also be handed to the browser as a cookie, so
    // the flow can create a session without the id in client-readable storage.
    expect(res.headers.get("set-cookie") ?? "").toContain("sfl_pid=existing-pid");
  });

  it("a new email creates exactly one participant + one verified contact", async () => {
    const { res, body, written } = await call(goodParams("new"), {
      contactRows: [null],
    });
    console.log("  new ->", res.status, JSON.stringify(body));
    console.log("  writes:", JSON.stringify(written));
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie") ?? "").toContain("sfl_pid=new-pid");
    expect(body).toEqual({
      verified: true,
      participantId: "new-pid",
      newParticipant: true,
    });
    expect(written).toHaveLength(2);
    expect(written[0].table).toBe("participants");
    expect(written[1]).toMatchObject({
      table: "participant_contacts",
      payload: {
        participant_id: "new-pid",
        contact_type: "email",
        normalized_value: EMAIL,
        is_primary: true,
      },
    });
    expect(typeof written[1].payload.verified_at).toBe("string");
  });

  it("a double-clicked link collapses the UNIQUE race onto the winner's row", async () => {
    // First lookup: no contact. Insert loses the race (23505). Re-lookup finds
    // the winner. The orphan participant is deleted — no duplicate survives.
    const { res, body, orphanDeleted } = await call(goodParams("new"), {
      contactRows: [null, { contact_id: "c-w", participant_id: "winner-pid" }],
      insertContactError: { code: "23505" },
    });
    console.log("  race ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body).toEqual({
      verified: true,
      participantId: "winner-pid",
      newParticipant: false,
    });
    expect(orphanDeleted).toBe("new-pid");
  });
});

describe("a BROWSER clicking the emailed link lands on a page, not on JSON", () => {
  it("redirects (303) to the verified page and sets the participant cookie", async () => {
    // Before this, clicking a verification link showed the participant
    // `{"verified":true,...}` — which reads as a broken product. The redirect
    // preserves the guarantee that the id is only ever issued as a result of
    // redeeming a server-verified link.
    const { res } = await call(goodParams("new"), { contactRows: [null], asJson: false });
    const location = res.headers.get("location") ?? "";
    console.log("  browser ->", res.status, location);
    expect(res.status).toBe(303);
    expect(location).toContain("/auth/verified");
    expect(location).toContain("participantId=");
    expect(res.headers.get("set-cookie") ?? "").toContain("sfl_pid=");
  });

  it("an EXPIRED link still refuses in both modes (410)", async () => {
    // The redirect must not become a way around expiry. Asserted for the
    // browser path specifically, since that is the new branch.
    const params = goodParams("new");
    params.expiresAt = String(Date.now() - 1000);
    params.token = realToken("new", EMAIL, Number(params.expiresAt));
    const { res } = await call(params, { contactRows: [null], asJson: false });
    console.log("  expired browser ->", res.status);
    expect(res.status).toBe(410);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
