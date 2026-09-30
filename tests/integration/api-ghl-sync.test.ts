import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/integrations/ghl/sync — the §30C minimum data contract.
 *
 * WHY THIS FILE EXISTS.
 *
 * This is the only route that sends participant data to a THIRD PARTY. PRD §30C
 * is unusually explicit about the boundary, so the rule is testable rather than
 * a matter of judgement:
 *
 *   "Do not send the full 31-response dataset, internal fear/classifier tags,
 *    raw demographics, evidence-chain payload, or detailed scoring machinery
 *    to GHL by default."
 *
 * Two failure modes matter and neither is visible to the engine tests:
 *   - OVER-SENDING: one added field quietly ships the whole assessment to a
 *     CRM that was never meant to hold it. So the assertion is on the exact
 *     KEY SET of the payload, not on a few forbidden names — a new field must
 *     fail this test, not slip through.
 *   - DUPLICATES: §23.4 requires idempotency. A re-sync must update one row,
 *     never create a second contact.
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

/** The §30C field list, transcribed from the spec comment at the route head. */
const S30C_FIELDS = [
  "participant_id",
  "first_name",
  "last_name",
  "email",
  "mobile",
  "consent",
  "ghl_contact_id",
  "started_at",
  "completed_at",
  "assessment_status",
  "primary_attention_area",
  "continuation_path",
  "workflow_tags",
].sort();

interface Captured {
  eventsInserted: Array<Record<string, unknown>>;
  eventsUpdated: Array<Record<string, unknown>>;
}

function fakeDb(opts: { existingEvent?: Record<string, unknown> | null } = {}) {
  const captured: Captured = { eventsInserted: [], eventsUpdated: [] };

  const tableData: Record<string, unknown> = {
    participants: { first_name: "Ada", last_name: "Lovelace" },
    participant_contacts: [
      { contact_type: "email", normalized_value: "ada@example.com" },
      { contact_type: "mobile", normalized_value: "+15551234567" },
    ],
    communication_consents: [
      { channel: "email", purpose: "operational", status: "granted" },
    ],
    crm_links: { ghl_contact_id: "ghl-123" },
    assessment_sessions: {
      started_at: "2026-09-01T00:00:00Z",
      completed_at: "2026-09-02T00:00:00Z",
      status: "completed",
    },
    tensions: [{ tension_code: "HIGH_ACTIVITY_LOW_DIRECTION" }],
  };

  const makeSelect = (table: string) => {
    let isMaybeSingle = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      match: () => chain,
      maybeSingle: () => {
        isMaybeSingle = true;
        if (table === "integration_events") {
          return Promise.resolve({
            data: opts.existingEvent === undefined ? null : opts.existingEvent,
            error: null,
          });
        }
        return Promise.resolve({ data: tableData[table] ?? null, error: null });
      },
      // Awaiting the chain without maybeSingle() resolves the array form.
      then: (resolve: (v: unknown) => unknown) => {
        if (isMaybeSingle) return undefined;
        const d = tableData[table];
        return Promise.resolve({
          data: Array.isArray(d) ? d : d ? [d] : [],
          error: null,
        }).then(resolve);
      },
    };
    return chain;
  };

  const db = {
    from(table: string) {
      if (table === "integration_events") {
        return {
          ...makeSelect(table),
          insert: (payload: Record<string, unknown>) => {
            captured.eventsInserted.push(payload);
            return Promise.resolve({ error: null });
          },
          update: (payload: Record<string, unknown>) => {
            captured.eventsUpdated.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return makeSelect(table);
    },
  };
  return { db, captured };
}

const PID = "11111111-2222-3333-4444-555555555555";

async function sync(
  body: Record<string, unknown>,
  opts: { existingEvent?: Record<string, unknown> | null } = {},
) {
  const { db, captured } = fakeDb(opts);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const { POST } = await import("@/app/api/integrations/ghl/sync/route");
  const res = await POST(
    new Request("http://x/api/integrations/ghl/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: await res.json().catch(() => null), captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
});

describe("the payload contains EXACTLY the §30C fields — nothing more (PRD §30C)", () => {
  it("sends precisely the contracted key set", async () => {
    const { res, body } = await sync({ participantId: PID, sessionId: "s-1" });
    console.log("  status:", res.status);
    console.log("  payload keys:", JSON.stringify(Object.keys(body.payload ?? {}).sort()));

    expect(res.status).toBe(200);
    // Asserting the exact SET, not a blacklist: a newly added field fails here
    // rather than being silently transmitted to the CRM.
    expect(Object.keys(body.payload).sort()).toEqual(S30C_FIELDS);
  });

  it("omits every category §30C forbids", async () => {
    const { body } = await sync({ participantId: PID, sessionId: "s-1" });
    const payload = body.payload as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    // The named exclusions, plus the names of the machinery that would carry
    // them if a future edit wired the engine output straight through.
    //
    // NOTE: "tags" is deliberately NOT in this list. §30C permits "Approved
    // workflow tags/statuses" and the payload carries `workflow_tags`. What the
    // spec forbids is INTERNAL CLASSIFIER tags (Q1/Q9/Q16/Q21 output), which is
    // a different field — so the classifier-derived names are named explicitly
    // and `workflow_tags`' own contents are checked separately below.
    for (const forbidden of [
      "responses",
      "option_code",
      "classifier",
      "fear",
      "demographics",
      "evidence",
      "raw",
      "score",
    ]) {
      expect(serialized, `payload must not carry "${forbidden}"`).not.toContain(forbidden);
    }
    // No raw signal state (S1–S5) anywhere — the payload has no "signal" key,
    // so an S-state could only arrive via a leak.
    expect(serialized).not.toMatch(/\bS[1-5]\b/);
    expect(Object.keys(payload)).not.toContain("items");
  });

  it("workflow_tags carries the APPROVED connection codes, not classifier tags", async () => {
    // §30C: "Approved workflow tags/statuses" are permitted; internal
    // classifier tags are not. The two are NOT distinguishable by shape — both
    // are SCREAMING_SNAKE, e.g. the connection code HIGH_ACTIVITY_LOW_DIRECTION
    // and the classifier tag TRUTH_AVOIDANCE. So the distinction is the SOURCE:
    // these must come from the tensions table, never from classifyAll.
    const { body } = await sync({ participantId: PID, sessionId: "s-1" });
    const tags = body.payload.workflow_tags as string[];
    console.log("  workflow_tags:", JSON.stringify(tags));
    expect(tags).toEqual(["HIGH_ACTIVITY_LOW_DIRECTION"]);

    // Every emitted tag must be a member of the APPROVED tension-code set.
    // A classifier tag reaching this field would fail here.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const cfg = JSON.parse(
      readFileSync(resolve(process.cwd(), "config/scoring-v1.0.json"), "utf8"),
    );
    const tensionCodes = new Set(
      Object.keys(cfg.tensions).filter((k) => !k.startsWith("_")),
    );
    // Config shape: classifiers.<Q>.tags maps option code -> tag string.
    const classifierTags = new Set(
      Object.keys(cfg.classifiers)
        .filter((k) => !k.startsWith("_"))
        .flatMap((k) => {
          const tags = (cfg.classifiers[k] as { tags?: Record<string, string> })
            .tags;
          return tags ? Object.values(tags) : [];
        }),
    );
    console.log(
      "  tension codes:",
      tensionCodes.size,
      "| classifier tags:",
      classifierTags.size,
    );
    for (const t of tags) {
      expect(tensionCodes, `"${t}" must be an approved tension code`).toContain(t);
      expect(classifierTags, `"${t}" must not be a classifier tag`).not.toContain(t);
    }
  });

  it("carries the participant id verbatim and never an email as the key", async () => {
    // §22.2: the permanent participant_id is a random UUID, never the email.
    const { body } = await sync({ participantId: PID, sessionId: "s-1" });
    expect(body.payload.participant_id).toBe(PID);
    expect(body.payload.participant_id).not.toContain("@");
  });

  it("sends consent state, but only channel/purpose/status", async () => {
    const { body } = await sync({ participantId: PID, sessionId: "s-1" });
    const consent = body.payload.consent as Array<Record<string, unknown>>;
    console.log("  consent:", JSON.stringify(consent));
    for (const c of consent) {
      expect(Object.keys(c).sort()).toEqual(["channel", "purpose", "status"]);
    }
  });

  it("reports null for fields with no column rather than inventing a value", async () => {
    // §30C names "primary attention area" and "participant-selected
    // continuation path"; neither has a column yet (ledger F4). The route must
    // report null, not guess from the tensions it happened to load.
    const { body } = await sync({ participantId: PID, sessionId: "s-1" });
    console.log("  attention area:", body.payload.primary_attention_area);
    console.log("  continuation:", body.payload.continuation_path);
    expect(body.payload.primary_attention_area).toBeNull();
    expect(body.payload.continuation_path).toBeNull();
  });
});

describe("the sync is idempotent (PRD §23.4)", () => {
  it("an already-succeeded sync is a no-op that does not re-send", async () => {
    const { res, body, captured } = await sync(
      { participantId: PID, sessionId: "s-1" },
      { existingEvent: { event_id: "e-1", status: "succeeded", attempt_count: 1 } },
    );
    console.log("  already synced ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(body).toEqual({ synced: true, alreadySynced: true });
    expect(captured.eventsInserted).toHaveLength(0);
    expect(captured.eventsUpdated).toHaveLength(0);
  });

  it("a retry UPDATES the one row and increments attempt_count", async () => {
    const { captured } = await sync(
      { participantId: PID, sessionId: "s-1" },
      { existingEvent: { event_id: "e-1", status: "pending", attempt_count: 2 } },
    );
    console.log("  retry update:", JSON.stringify(captured.eventsUpdated));
    // Idempotency mechanism: the UNIQUE(destination, event_type,
    // participant_id, session_id) constraint means a retry lands on the same
    // row. Update, never insert a second.
    expect(captured.eventsInserted).toHaveLength(0);
    expect(captured.eventsUpdated).toHaveLength(1);
    expect(captured.eventsUpdated[0].attempt_count).toBe(3);
  });

  it("the event key is the idempotency tuple, not a fresh id", async () => {
    const { captured } = await sync({ participantId: PID, sessionId: "s-1" });
    console.log("  inserted event:", JSON.stringify(captured.eventsInserted[0]));
    expect(captured.eventsInserted[0]).toMatchObject({
      destination: "ghl",
      event_type: "contact_sync",
      participant_id: PID,
      session_id: "s-1",
    });
  });
});

describe("input validation and failure modes", () => {
  it("rejects an unverified participant id", async () => {
    for (const bad of ["", "not-a-uuid", undefined]) {
      const { res } = await sync({ participantId: bad });
      expect(res.status, `participantId=${String(bad)}`).toBe(400);
    }
  });

  it("returns 503 without touching the database when unconfigured", async () => {
    isDbConfigured.mockReturnValue(false);
    const { res, captured } = await sync({ participantId: PID });
    expect(res.status).toBe(503);
    expect(captured.eventsInserted).toHaveLength(0);
  });

  it("never surfaces a sync failure to the participant (§27A)", async () => {
    // A CRM outage must not become a visible error in the assessment flow.
    const { db } = fakeDb();
    // Force the insert to fail with a non-duplicate error.
    const realFrom = db.from.bind(db);
    db.from = ((t: string) => {
      const base = realFrom(t) as Record<string, unknown>;
      if (t === "integration_events") {
        return {
          ...base,
          insert: () => Promise.resolve({ error: { code: "08006" } }),
        };
      }
      return base;
    }) as never;

    const { serviceClient } = await import("@/lib/db/client");
    vi.mocked(serviceClient).mockReturnValue(db as never);
    const { POST } = await import("@/app/api/integrations/ghl/sync/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId: PID }),
      }),
    );
    const body = await res.json();
    console.log("  sync failure ->", res.status, JSON.stringify(body));
    expect(res.status).toBe(202);
    expect(body).toEqual({ synced: false, queued: true });
  });
});
