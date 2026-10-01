import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANALYTICS_EVENTS,
  ALLOWED_PAYLOAD_KEYS,
  CLIENT_REPORTABLE_EVENTS,
  EVENT_KIND,
  MAX_PAYLOAD_KEYS,
  MAX_PAYLOAD_STRING,
  isClientReportable,
  isPayloadSafe,
  sanitizePayload,
} from "@/lib/analytics/events";

/**
 * First-party analytics — Addendum 02 v1.1 §16.
 *
 * OPERATOR REQUIREMENTS (2026-10-01):
 *   * first-party in Supabase, no third-party vendor;
 *   * "Do not place raw assessment answers, free-text participant financial
 *      content, Snapshot narrative, financial amounts, household income
 *      response, or other unnecessary sensitive participant data inside
 *      analytics event payloads";
 *   * "Do not silently invent a permanent retention period."
 *
 * THE PAIRING TEST IS THE IMPORTANT ONE. The allow-list exists twice: as a TS
 * constant that a developer sees at build time, and as a SQL function that the
 * database enforces at write time. Two copies of one rule drift — and the drift
 * here is silent in the worst direction: a key the TS list accepts but SQL
 * rejects means an event the app thinks it recorded never lands, and nobody
 * notices until someone asks why the funnel has a hole.
 *
 * The payload-shape cases below are also run against a real Postgres in the
 * migration's verification block, so the SQL half is proven, not assumed.
 */

const repo = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(repo, "supabase/migrations/20261001000008_analytics_events.sql"),
  "utf8",
);

describe("the event vocabulary is closed and matches the database", () => {
  it("every TS event name is accepted by the SQL CHECK", () => {
    const sqlNames = [...migration.matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((n) => n.includes("_"));
    const missing = ANALYTICS_EVENTS.filter((e) => !sqlNames.includes(e));
    console.log(`  TS events: ${ANALYTICS_EVENTS.length}`);
    expect(missing, `events in TS but not in the SQL CHECK: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers every category the operator permitted", () => {
    // Named categories from the instruction, mapped to event names.
    const required = [
      "assessment_started",
      "assessment_resumed",
      "assessment_completed",
      "assessment_abandoned",
      "question_position_reached",
      "money_moment_displayed",
      "save_progress_offered",
      "save_progress_used",
      "save_progress_skipped",
      "returning_flow_started",
      "returning_flow_completed",
      "snapshot_generated",
      "snapshot_viewed",
      "snapshot_pdf_generated",
      "snapshot_pdf_downloaded",
      "system_error",
    ];
    for (const e of required) {
      expect(ANALYTICS_EVENTS as readonly string[], `missing event: ${e}`).toContain(e);
    }
    console.log("  permitted categories covered:", required.length);
  });

  it("is a closed list — an unknown event name cannot be recorded", () => {
    expect(ANALYTICS_EVENTS as readonly string[]).not.toContain("arbitrary_event");
  });
});

describe("the client/server split is enforced, not documented", () => {
  // THE BUG THIS PREVENTS. The first implementation imported the server writer
  // into four client components and the build failed with "'server-only' cannot
  // be imported from a Client Component module". Nothing leaked, because
  // `server-only` held — but the only thing standing between the service-role
  // key and a browser bundle was a build error, and a build error is a poor
  // thing to find out about at deploy time. These tests make the boundary a
  // fact about the source rather than a habit.

  const repoRoot = resolve(__dirname, "../..");

  /**
   * Strip comments before matching.
   *
   * NOT COSMETIC — this test was written the naive way first and was a false
   * green because of it. `lib/db/client.ts` carries a comment explaining the
   * guard that contains the literal text `import "server-only"` inside
   * backticks. A regex over the raw file matched that PROSE, so deleting the
   * real guard on line 20 left the test passing — the exact farce of a guard
   * that only checks the documentation.
   *
   * Comments are not code. Match against code.
   */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/^\s*\/\/.*$/gm, "") // whole-line comments
      .replace(/\s\/\/[^"'\n]*$/gm, ""); // trailing comments
  }

  /** Every .ts/.tsx under the given roots, excluding tests and node_modules. */
  function sourceFiles(...roots: string[]): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          out.push(full);
        }
      }
    };
    for (const r of roots) walk(resolve(repoRoot, r));
    return out;
  }

  it("no client component imports the server-only writer", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app", "components", "lib")) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (!/^["']use client["']/m.test(code)) continue;
      if (/from\s+["']@\/lib\/analytics\/write["']/.test(code)) {
        offenders.push(file.replace(`${repoRoot}/`, ""));
      }
    }
    console.log(`  scanned client components for the server writer`);
    expect(
      offenders,
      `these client components import the server-only analytics writer: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the server writer really is server-guarded", () => {
    // If someone deletes the service client's import in write.ts, the test above
    // becomes vacuous without failing. This asserts the guard the other test
    // depends on actually exists — in CODE, with comments stripped. The
    // comment-stripping is load-bearing: this file's own header comment quotes
    // the guard, and matching that prose is how the first version of this test
    // passed while the guard was deleted.
    const dbClient = stripComments(readFileSync(resolve(repoRoot, "lib/db/client.ts"), "utf8"));
    expect(dbClient, "the server-only guard is missing from lib/db/client.ts").toMatch(
      /import\s+["']server-only["'];?/,
    );
    const writer = stripComments(
      readFileSync(resolve(repoRoot, "lib/analytics/write.ts"), "utf8"),
    );
    expect(writer, "lib/analytics/write.ts no longer imports the service client").toMatch(
      /from\s+["']\.\.\/db\/client["']/,
    );
  });

  it("comment-stripping works — the check above is not vacuous", () => {
    // A helper that stripped everything would also make the guard test pass.
    // This pins the helper's behaviour so it cannot silently become a no-op.
    const guarded = 'import "server-only";\nconst x = 1;';
    const prose = '// import "server-only";\nconst x = 1;';
    expect(stripComments(guarded)).toMatch(/import\s+["']server-only["'];?/);
    expect(stripComments(prose)).not.toMatch(/import\s+["']server-only["'];?/);
    // And it must not eat real code.
    expect(stripComments(guarded)).toMatch(/const x = 1;/);
  });

  it("the client route accepts only client-origin events", () => {
    expect(CLIENT_REPORTABLE_EVENTS.length).toBeGreaterThan(0);
    expect(CLIENT_REPORTABLE_EVENTS.length).toBeLessThan(ANALYTICS_EVENTS.length);

    for (const e of CLIENT_REPORTABLE_EVENTS) {
      expect(EVENT_KIND[e], `${e} is in the client list but not marked client`).toBe("client");
    }
    // The server-origin events must be refused by the client path. These are the
    // ones a browser could otherwise fabricate.
    for (const e of ["assessment_started", "assessment_completed", "snapshot_viewed"] as const) {
      expect(isClientReportable(e), `${e} must NOT be client-reportable`).toBe(false);
    }
    console.log(`  client-reportable: ${CLIENT_REPORTABLE_EVENTS.join(", ")}`);
  });

  it("every declared event has a recorded origin", () => {
    // A new event added without a kind would silently become unreportable from
    // either path, which reads in a funnel as "it never happens".
    const missing = ANALYTICS_EVENTS.filter((e) => !(e in EVENT_KIND));
    expect(missing, `events with no declared origin: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("the payload allow-list matches the SQL function exactly", () => {
  it("every TS key appears in analytics_payload_is_safe()", () => {
    // Extract the SQL allow-list literal.
    const block = migration.match(/IF lower\(k\) NOT IN \(([\s\S]*?)\) THEN/)?.[1] ?? "";
    const sqlKeys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    console.log(`  SQL keys: ${sqlKeys.length} | TS keys: ${ALLOWED_PAYLOAD_KEYS.length}`);

    const missingInSql = ALLOWED_PAYLOAD_KEYS.filter((k) => !sqlKeys.includes(k));
    const missingInTs = sqlKeys.filter((k) => !(ALLOWED_PAYLOAD_KEYS as readonly string[]).includes(k));

    expect(missingInSql, `TS allows but SQL rejects: ${missingInSql.join(", ")}`).toEqual([]);
    expect(missingInTs, `SQL allows but TS rejects: ${missingInTs.join(", ")}`).toEqual([]);
  });

  it("contains no key that could carry an answer", () => {
    // The list is structural (where/which/how many), never substantive.
    const banned = /answer|option|response|narrative|text|comment|income|amount|balance|debt|salary|state|email|phone|name/i;
    const offenders = ALLOWED_PAYLOAD_KEYS.filter((k) => banned.test(k));
    console.log("  allow-list:", ALLOWED_PAYLOAD_KEYS.join(", "));
    expect(offenders, `substantive key in the allow-list: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("forbidden content is refused", () => {
  const FORBIDDEN: Array<[string, unknown]> = [
    ["a raw answer object", { answers: { Q1: "A" } }],
    ["an option code under an innocuous name", { q1: "Q1_A" }],
    ["household income", { income: 75000 }],
    ["snapshot narrative", { narrative: "Your responses show..." }],
    ["free-text financial content", { comment: "I am worried about money" }],
    ["an email", { email: "a@b.com" }],
    ["a state code", { state: "CA" }],
    ["an array", [1, 2, 3]],
    ["a string long enough to be prose", { note: "A".repeat(200) }],
    ["a nested object", { step: { deep: 1 } }],
  ];

  for (const [label, payload] of FORBIDDEN) {
    it(`refuses ${label}`, () => {
      expect(isPayloadSafe(payload)).toBe(false);
    });
  }

  it("sanitizePayload strips rather than throws", () => {
    // A dropped measurement is a gap in a chart; a thrown error here would be a
    // broken Save My Progress.
    const dirty = { position: 12, q1: "Q1_A", income: 75000 } as never;
    const clean = sanitizePayload(dirty);
    console.log("  sanitized:", JSON.stringify(clean));
    expect(clean).toEqual({ position: 12 });
  });
});

describe("legitimate measurement payloads are accepted", () => {
  const OK: Array<[string, unknown]> = [
    ["empty", {}],
    ["a progress position", { position: 12 }],
    ["a Money Moment id", { moment: "MM03" }],
    ["a save decision", { decision: "skipped" }],
    ["an operation result", { ok: true, retry: 1 }],
    ["a system error code", { code: "DB_ERROR", ok: false }],
  ];

  for (const [label, payload] of OK) {
    it(`accepts ${label}`, () => {
      expect(isPayloadSafe(payload)).toBe(true);
    });
  }

  it("bounds are enforced at the edges", () => {
    expect(isPayloadSafe({ moment: "M".repeat(MAX_PAYLOAD_STRING) })).toBe(true);
    expect(isPayloadSafe({ moment: "M".repeat(MAX_PAYLOAD_STRING + 1) })).toBe(false);

    const many: Record<string, number> = {};
    const keys = ALLOWED_PAYLOAD_KEYS as readonly string[];
    for (let i = 0; i < MAX_PAYLOAD_KEYS; i++) many[keys[i % keys.length]] = i;
    // Duplicate keys collapse, so build one that genuinely exceeds the cap.
    const over: Record<string, number> = { position: 1 };
    for (const k of keys) over[k] = 1;
    // 13 allowed keys exist and the cap is 12, so using them all must fail.
    expect(Object.keys(over).length).toBeGreaterThan(MAX_PAYLOAD_KEYS);
    expect(isPayloadSafe(over)).toBe(false);
    void many;
  });
});

describe("access control and retention are explicit, not assumed", () => {
  it("RLS is enabled and only service_role has a policy", () => {
    expect(migration).toMatch(/ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/TO service_role/);
    // No anon or authenticated grant anywhere in this migration.
    expect(migration).not.toMatch(/TO anon/);
    expect(migration).not.toMatch(/TO authenticated/);
  });

  it("participants cascade-delete their events", () => {
    // §24: an erasure must take the participant's data with it. Analytics rows
    // are keyed by participant, so they must not survive an erasure.
    expect(migration).toMatch(/REFERENCES participants\(participant_id\) ON DELETE CASCADE/);
    expect(migration).toMatch(/REFERENCES assessment_sessions\(session_id\) ON DELETE CASCADE/);
  });

  it("retention is NOT decided, and the schema says so", () => {
    // "Do not silently invent a permanent retention period."
    expect(migration).toMatch(/retain_until\s+TIMESTAMPTZ/);
    expect(migration).not.toMatch(/retain_until[^,]*DEFAULT/);
    expect(migration).toMatch(/no retention period has been decided/i);
    // And the undecided state is queryable, so it cannot hide.
    expect(migration).toMatch(/CREATE OR REPLACE VIEW analytics_retention_status/);
    expect(migration).toMatch(/events_with_no_retention_decided/);
  });

  it("the payload rule is enforced by the database, not only by convention", () => {
    expect(migration).toMatch(/analytics_events_payload_safe CHECK/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION analytics_payload_is_safe/);
    // The allow-list, not a deny-list — the deny-list failed on {"q1":"Q1_A"}.
    expect(migration).toMatch(/ALLOW-LIST, NOT DENY-LIST/i);
  });
});
