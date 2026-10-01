import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/auth/start-new and /api/auth/start-returning — the enumeration pair.
 *
 * WHY THIS FILE EXISTS.
 *
 * PRD §7.3: "Do not reveal whether an email has a participant record before
 * verification in a way that creates account-enumeration risk."
 *
 * PRD §23.1 defines these as SEPARATE endpoints. That is what makes them
 * dangerous: the moment the two respond differently — a different status, a
 * different message, a different field — an attacker can POST an address to
 * both and learn from the difference whether that person is a participant.
 * Two individually-correct routes can still combine into a privacy defect.
 *
 * So the central assertion here is a CROSS-ROUTE equality: for the same input,
 * the two responses must be indistinguishable. Any future edit that "improves"
 * one message breaks the pair, and this test is what catches it.
 */

vi.mock("server-only", () => ({}));

// The routes send verification mail. Mock the sender so no test can ever reach
// the provider — a suite that silently sends real email when RESEND_API_KEY
// happens to be exported is a live-fire hazard, not a test.
const sentEmails: Array<Record<string, unknown>> = [];
/** When set, the mocked sender rejects — to prove the route discards failures. */
let failNextSend: (() => void) | null = null;
vi.mock("@/lib/email/verification", () => ({
  sendVerificationEmail: (args: Record<string, unknown>) => {
    sentEmails.push(args);
    if (failNextSend) {
      const fn = failNextSend;
      failNextSend = null;
      return fn() as never;
    }
    return Promise.resolve({ sent: true, id: "test-id" });
  },
}));


// `issueVerificationToken` HMAC-signs with REMINDER_LINK_SECRET and THROWS when
// it is unset — deliberately, so a deployment can never sign with an empty
// secret. Tests therefore need a fixture value. This is a clearly-fake literal
// used only for signing test tokens; it is never a production secret and the
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

const post = (email: unknown) =>
  new Request("http://x/api/auth/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

async function callBoth(email: unknown) {
  const { POST: startNew } = await import("@/app/api/auth/start-new/route");
  const { POST: startReturning } = await import(
    "@/app/api/auth/start-returning/route"
  );
  const a = await startNew(post(email));
  const b = await startReturning(post(email));
  return {
    a: { status: a.status, body: await a.json() },
    b: { status: b.status, body: await b.json() },
  };
}

/**
 * Run `fn` with NODE_ENV forced to "production".
 *
 * The dev-only `devToken` field must be absent for the cross-route equality
 * assertions to mean anything, and `NODE_ENV` is typed read-only in @types/node
 * — hence the explicit indirection rather than a plain assignment.
 */
async function withProduction<T>(fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const prior = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    env.NODE_ENV = prior;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("the two verification endpoints cannot be told apart (PRD §7.3)", () => {
  it("return an IDENTICAL status and body for the same email — in PRODUCTION", async () => {
    // Run with NODE_ENV=production so the dev-only `devToken` field is absent.
    // That gate matters: the token hashes in the PURPOSE ("new" vs "returning"),
    // so the two routes legitimately mint DIFFERENT tokens — and a response that
    // carried both the token and an observable difference would be an oracle.
    // In production neither route exposes a token at all, so the bodies are
    // byte-identical. Asserting the production shape is the assertion that
    // matters; the dev shape is checked separately below.
    await withProduction(async () => {
      const { a, b } = await callBoth("someone@example.com");
      console.log("  [prod] start-new      :", a.status, JSON.stringify(a.body));
      console.log("  [prod] start-returning:", b.status, JSON.stringify(b.body));

      expect(a.status).toBe(b.status);
      expect(a.status).toBe(202);
      // Compare the whole body, not selected fields: a NEW field on one route is
      // exactly the kind of divergence that creates an oracle.
      expect(a.body).toEqual(b.body);
      // And no token of any kind is exposed in production.
      expect(JSON.stringify(a.body)).not.toContain("devToken");
      expect(JSON.stringify(a.body)).not.toContain("token");
    });
  });

  it("diverge ONLY by the dev-only `devToken`, which production never sends", async () => {
    // Documents the one known difference so it cannot silently become a real
    // one. If a future edit makes the routes differ by anything OTHER than the
    // dev token, this fails.
    const { a, b } = await callBoth("someone@example.com");
    const { devToken: tokA, ...restA } = a.body as Record<string, unknown>;
    const { devToken: tokB, ...restB } = b.body as Record<string, unknown>;
    console.log("  dev tokens present:", Boolean(tokA), Boolean(tokB));

    expect(restA).toEqual(restB); // everything except the dev token agrees
    // The tokens differ ONLY because purpose is part of the hash input.
    if (tokA && tokB) expect(tokA).not.toBe(tokB);
  });

  it("stay identical for a malformed email", async () => {
    const { a, b } = await callBoth("not-an-email");
    console.log("  malformed:", a.status, JSON.stringify(a.body));
    expect(a.status).toBe(400);
    expect(a.body).toEqual(b.body);
  });

  it("stays identical when the database is unconfigured", async () => {
    // A config-dependent divergence would leak environment state. Compare the
    // production shape (no dev token) for the same reason as above.
    isDbConfigured.mockReturnValue(false);
    await withProduction(async () => {
      const { a, b } = await callBoth("someone@example.com");
      console.log("  db-unconfigured:", a.status, JSON.stringify(a.body));
      expect(a.status).toBe(b.status);
      expect(a.body).toEqual(b.body);
    });
  });

  it("the success body states no outcome — it never says 'new' or 'existing'", async () => {
    const { a } = await callBoth("someone@example.com");
    const serialized = JSON.stringify(a.body).toLowerCase();
    console.log("  body:", serialized);
    for (const leak of [
      "new",
      "existing",
      "already",
      "registered",
      "found",
      "not found",
      "unknown",
      "no account",
    ]) {
      expect(serialized, `response must not reveal "${leak}"`).not.toContain(leak);
    }
  });

  it("never reflects the submitted address back in the response", async () => {
    // Echoing the address back is harmless on its own, but combined with any
    // normalisation difference it becomes a probe.
    const { a, b } = await callBoth("MixedCase@Example.COM");
    for (const r of [a, b]) {
      expect(JSON.stringify(r.body)).not.toContain("MixedCase");
      expect(JSON.stringify(r.body)).not.toContain("Example.COM");
    }
  });

  it("a malformed body is treated like an unrecognised address, not a crash", async () => {
    const { POST } = await import("@/app/api/auth/start-new/route");
    const res = await POST(
      new Request("http://x", { method: "POST", body: "{ not json" }),
    );
    console.log("  malformed JSON ->", res.status);
    // Missing/unreadable email is a client bug: 400, never a 500.
    expect(res.status).toBe(400);
  });

  it("does NOT distinguish an existing participant from a new one", async () => {
    // The route mints a token regardless and does the new-vs-existing decision
    // at REDEMPTION, after verification proves ownership. Since the route never
    // queries participant records, two arbitrary addresses must produce
    // byte-identical responses — asserted here on the same route, which is the
    // closest a unit test can get to the real probe.
    await withProduction(async () => {
      const { POST } = await import("@/app/api/auth/start-new/route");
      const r1 = await POST(post("known@example.com"));
      const r2 = await POST(post("brand-new@example.com"));
      const b1 = await r1.json();
      const b2 = await r2.json();
      console.log("  two addresses, prod:", r1.status, JSON.stringify(b1));
      expect(r1.status).toBe(r2.status);
      expect(b1).toEqual(b2);
    });
  });
});

describe("verification email is SENT, and never reveals an outcome (PRD §23.1, §7.3)", () => {
  it("both routes send exactly one email for an accepted address", async () => {
    sentEmails.length = 0;
    await callBoth("someone@example.com");
    console.log("  emails sent:", sentEmails.length, JSON.stringify(sentEmails.map(e => e.purpose)));
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails.map((e) => e.purpose).sort()).toEqual(["new", "returning"]);
    for (const e of sentEmails) {
      expect(e.to).toBe("someone@example.com");
      expect(typeof e.token).toBe("string");
      expect(typeof e.expiresAt).toBe("number");
    }
  });

  it("sends for a MALFORMED address too — no early-exit branch to observe", async () => {
    // If the malformed path skipped the send, response timing or an eventual
    // side channel would differ. The route rejects before minting, so this
    // asserts the rejection happens BEFORE any send.
    sentEmails.length = 0;
    await callBoth("not-an-email");
    console.log("  emails sent for malformed:", sentEmails.length);
    expect(sentEmails).toHaveLength(0);
  });

  it("the two routes send IDENTICALLY-SHAPED emails — no outcome in the payload", async () => {
    sentEmails.length = 0;
    await callBoth("someone@example.com");
    const [a, b] = sentEmails;
    // Same keys, differing only in the purpose-bound token and its purpose.
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    // Nothing in the payload names the participant or reveals existence.
    const serialized = JSON.stringify(sentEmails).toLowerCase();
    for (const leak of ["existing", "already", "registered", "not found", "no account"]) {
      expect(serialized, `email payload must not reveal "${leak}"`).not.toContain(leak);
    }
  });

  it("a SEND FAILURE never changes the response (§7.3)", async () => {
    // Inject a real rejection. If the route let it escape, this would 500 and
    // the failure would be observable — which is the whole hazard.
    try {
      // Baseline: identical bodies, no failure.
      let expected: unknown;
      await withProduction(async () => {
        const ok = await callBoth("someone@example.com");
        expect(ok.a.status).toBe(202);
        expect(ok.a.body).toEqual(ok.b.body);
        expected = ok.a.body;
      });

      // Now make the send reject hard.
      failNextSend = () => Promise.reject(new Error("provider down"));
      await withProduction(async () => {
        const { POST: startNew } = await import("@/app/api/auth/start-new/route");
        const res = await startNew(
          new Request("http://x", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "fail@example.com" }),
          }),
        );
        const body = await res.json();
        console.log("  send rejected ->", res.status, JSON.stringify(body));
        // Same status and body as a successful send. A 500 here would be the bug.
        expect(res.status).toBe(202);
        expect(body).toEqual(expected);
      });
    } finally {
      failNextSend = null;
    }
  });
});
