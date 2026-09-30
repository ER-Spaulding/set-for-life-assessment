// PRD §22, §24, §30B — the server-side database client.
//
// THIS MODULE IS SERVER-ONLY.
//
// PRD §24: "Browser/client code must never receive database service-role
// secrets, GHL private credentials, or other privileged keys."
// PRD §30B: "Production secrets live only in protected environment variables."
//
// The service-role key BYPASSES Row Level Security. Importing this module into
// any component that ships to a browser would hand every participant's data to
// anyone who opens devtools. Two things enforce that here:
//
//   1. `import 'server-only'` — a build-time failure if this is ever pulled
//      into a client bundle. This is the load-bearing guard; the rest is care.
//   2. The key is read from `process.env` with NO `NEXT_PUBLIC_` prefix, so it
//      is never inlined into client code even by accident.
//
// There is deliberately no export of the raw key.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client authenticated with the service-role key.
 *
 * Throws when the environment is incomplete rather than falling back to an
 * anon client — a silent downgrade would produce confusing RLS denials at
 * runtime instead of a clear configuration error at first use.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("db: NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!serviceKey) {
    throw new Error(
      "db: SUPABASE_SERVICE_ROLE_KEY is not set. It must be provided as a " +
        "server-side environment variable and must never carry a NEXT_PUBLIC_ prefix.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "set-for-life-assessment" } },
  });
}

/** True when the server has everything it needs to talk to the database. */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Standard error body. Deliberately opaque: never leak a stack trace, a query,
 * or a constraint name to the caller (PRD §24).
 */
export function errorBody(code: string, message: string) {
  return { error: { code, message } } as const;
}
