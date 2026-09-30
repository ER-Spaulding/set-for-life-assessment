// PRD §22, §24, §30B — the server-side database client.
//
// THIS MODULE IS SERVER-ONLY.
//
// PRD §24: "Browser/client code must never receive database service-role
// secrets, GHL private credentials, or other privileged keys."
//
// The service-role key BYPASSES Row Level Security. Importing this module into
// anything that ships to a browser would hand every participant's data to
// anyone who opens devtools. Two things guard that:
//
//   1. `import "server-only"` — a BUILD-TIME failure if this is ever pulled
//      into a client bundle. This line is load-bearing; removing it silently
//      removes the only automatic guard.
//   2. The key is read from `process.env` with NO `NEXT_PUBLIC_` prefix, so it
//      is never inlined into client code even by accident.
//
// There is deliberately no export of the raw key.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** True when the server has everything it needs to talk to the database. */
export function isDbConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export class DbNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super(
      "db_not_configured: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
    );
    this.name = "DbNotConfiguredError";
  }
}

/**
 * Service-role client for server-side API routes. Throws DbNotConfiguredError.
 *
 * Throws rather than falling back to an anon client: a silent downgrade would
 * surface as confusing RLS denials at runtime instead of a clear configuration
 * error at first use.
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbNotConfiguredError();
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "set-for-life-assessment" } },
    });
  }
  return cached;
}

/* ---------------------------------------------------------------------------
 * Aliases. Two naming conventions exist in this codebase because the routes
 * were authored in two passes; both resolve to the same implementation so
 * neither set has to change. Prefer the canonical names above in new code.
 * ------------------------------------------------------------------------- */

/** @deprecated Use `getServiceClient`. */
export const serviceClient = getServiceClient;

/** @deprecated Use `isDbConfigured`. */
export const isDatabaseConfigured = isDbConfigured;

/**
 * Standard error body. Deliberately opaque: never leak a stack trace, a query,
 * or a constraint name to the caller (PRD §24).
 */
export function errorBody(code: string, message: string) {
  return { error: { code, message } } as const;
}
