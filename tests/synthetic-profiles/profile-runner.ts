import { vi } from "vitest";

// SHARED PROFILE RUNNER — drive a synthetic profile through the REAL
// `completeSession` (real scoring, classifier tags, tension evaluation, evidence
// derivation, atomic write) against an in-memory fake db, and hand back the
// persisted Snapshot payload.
//
// WHY THIS EXISTS. The narrative-standard validation (Owner §17) needs SEVEN
// payloads (the golden walkthrough profile plus six materially different
// synthetic profiles), each rendered through the real resolver/section model.
// Copying the fake-db harness into seven test files would give seven things to
// drift; this is the one implementation, documented the same way
// complete-session-end-to-end.test.ts documents its own: the fake accepts any
// column name (that class of defect is schema-column-contract.test.ts's job);
// here it exists so the REAL producer runs end to end and its payload is
// asserted.
//
// NOTE: `server-only` and `@/lib/db/client` must be vi.mock'd by the CALLING
// test file BEFORE this module is imported through a test (vitest hoists mocks
// per file). Import this module from a test that declares those mocks, or from
// another module loaded after them.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

import { completeSession } from "@/lib/session/service";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import type { ProfileOverrides } from "./build-profile";
import { buildProfile } from "./build-profile";

const SESSION_ID = "33333333-4444-4333-8333-333333333333";

/** Response rows for the fake db — full option codes, one row per selection. */
function rowsFor(overrides: ProfileOverrides): Array<{ item_id: string; option_code: string }> {
  const profile = buildProfile(overrides);
  const rows: Array<{ item_id: string; option_code: string }> = [];
  for (const [item, value] of Object.entries(profile.answers)) {
    if (Array.isArray(value)) {
      for (const v of value) rows.push({ item_id: item, option_code: v });
    } else {
      rows.push({ item_id: item, option_code: `${item}_${value}` });
    }
  }
  return rows;
}

/**
 * Minimal in-memory stand-in for the Supabase service client, modelled on the
 * golden-profile test's harness: reads resolve from the fixture rows, the
 * atomic `complete_session_atomic` rpc stages and commits the payload.
 */
function fakeDb(overrides: ProfileOverrides) {
  const captured: {
    snapshot: Record<string, unknown> | null;
    tensions: Array<Record<string, unknown>>;
    computedSignals: Array<Record<string, unknown>>;
  } = { snapshot: null, tensions: [], computedSignals: [] };

  const rows = rowsFor(overrides);
  let sessionStatus = "in_progress";

  const chain = () => {
    const c: Record<string, unknown> = {};
    const self = new Proxy(c, {
      get(_t, prop: string) {
        if (prop === "then") return undefined; // never thenable unless awaited via explicit fn
        if (
          prop === "select" ||
          prop === "eq" ||
          prop === "in" ||
          prop === "order" ||
          prop === "limit"
        ) {
          return () => self;
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: null, error: null });
        }
        if (prop === "insert" || prop === "upsert") {
          return () => self;
        }
        if (prop === "update") {
          return () => self;
        }
        if (prop === "delete") {
          return () => self;
        }
        return () => self;
      },
    });
    return self;
  };

  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        const c: Record<string, unknown> = {};
        const self = new Proxy(c, {
          get(_t, prop: string) {
            if (prop === "select" || prop === "eq" || prop === "in" || prop === "order" || prop === "limit") {
              return () => self;
            }
            if (prop === "maybeSingle" || prop === "single") {
              return async () => ({
                data: { session_id: SESSION_ID, status: sessionStatus },
                error: null,
              });
            }
            if (prop === "update") {
              return (payload: Record<string, unknown>) => {
                if (typeof payload.status === "string") sessionStatus = payload.status;
                const b: Record<string, unknown> = {};
                const bs = new Proxy(b, {
                  get(_bt, bp: string) {
                    if (bp === "eq" || bp === "select") return () => bs;
                    if (bp === "maybeSingle" || bp === "single") {
                      return async () => ({ data: payload, error: null });
                    }
                    return () => bs;
                  },
                });
                return bs;
              };
            }
            return () => self;
          },
        });
        return self;
      }
      if (table === "responses") {
        // The completion read is `.select(...).eq(session_id)` awaited — model
        // it as a thenable chain resolving to the fixture rows.
        const c: Record<string, unknown> = {};
        const self = new Proxy(c, {
          get(_t, prop: string) {
            if (prop === "select") return () => self;
            if (prop === "eq") return () => self;
            if (prop === "in" || prop === "order" || prop === "limit") return () => self;
            if (prop === "then") {
              return (
                onFulfilled: (v: { data: unknown; error: null }) => unknown,
                onRejected?: (e: unknown) => unknown,
              ) =>
                Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
            }
            if (prop === "maybeSingle" || prop === "single") {
              return async () => ({ data: rows[0] ?? null, error: null });
            }
            return () => self;
          },
        });
        return self;
      }
      return chain();
    },
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      const signals = (params.p_signals as Array<Record<string, unknown>>) ?? [];
      const tensions = (params.p_tensions as Array<Record<string, unknown>>) ?? [];
      const snapshot = params.p_snapshot as Record<string, unknown> | undefined;
      if (signals.length) captured.computedSignals.push(...signals);
      if (tensions.length) captured.tensions.push(...tensions);
      if (snapshot) captured.snapshot = snapshot;
      return { data: { ok: true }, error: null };
    },
  };

  return { db, captured };
}

/** Run the real completion and return the persisted payload (or throw). */
export async function completeProfile(overrides: ProfileOverrides): Promise<SnapshotPayload> {
  const { db, captured } = fakeDb(overrides);
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await completeSession(SESSION_ID);
  if (!result.complete) {
    throw new Error(`completeProfile: completion refused: ${JSON.stringify(result)}`);
  }
  const row = captured.snapshot as { payload_json?: SnapshotPayload } | null;
  const payload = row?.payload_json;
  if (!payload) throw new Error("completeProfile: no payload captured");
  return payload;
}

/** Run the completion and resolve the shared section model in one step. */
export async function sectionsFor(
  overrides: ProfileOverrides,
): Promise<{ payload: SnapshotPayload; sections: SnapshotSection[] }> {
  const payload = await completeProfile(overrides);
  return { payload, sections: resolveSnapshotContent(payload) };
}
