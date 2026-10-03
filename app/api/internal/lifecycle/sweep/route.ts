// The lifecycle sweep entry point. PROTECTED.
//
// Operator instruction #7 was explicit that the 7/30-day evaluation must run
// SERVER-SIDE rather than as a browser unload beacon, and that it must be
// driven by `last_activity_at` rather than by anything the client reports.
//
// WHY THIS ROUTE EXISTS AT ALL. `runSweep` was written, unit-tested and
// integration-tested against a real database — and had NO CALLER. Nothing
// invoked it. A sweep nobody runs is not a sweep: every session would have sat
// at `in_progress` forever, no participant would ever have been classified
// abandoned, and the 30-day rule that §3 rests on would have been theoretical
// while its tests were green. Integration tests proved the LOGIC worked; they
// could not prove it was REACHABLE. That is exactly the class of gap this
// repository has been bitten by before, so it gets an entry point and a test
// that asserts the entry point calls the sweep.
//
// A SCHEDULE IS NOT CONFIGURED HERE, DELIBERATELY. The operator approved the
// sweep's DEFINITION and its thresholds; they did not approve a deployment
// cadence, and Vercel cron entries are a deployment decision this repo has no
// standing to invent. So this exposes the operation and leaves the trigger to
// the owner — `vercel.json` with a `crons` entry, an external scheduler, or a
// manual call during the pilot. Documented in config/lifecycle-v1.0.json.
//
// Gated the same way as the internal audit route: bearer token from the server
// environment, 404 when that token is unconfigured, so an unconfigured
// deployment does not advertise the endpoint. POST, because it writes.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { runSweep } from "@/lib/session/sweep";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_HARNESS_TOKEN;
  if (!expected) {
    return NextResponse.json(errorBody("NOT_FOUND", "Not found."), { status: 404 });
  }
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied || supplied !== expected) {
    return NextResponse.json(errorBody("UNAUTHORIZED", "Unauthorized."), { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  // `now` is injectable so a verification run can drive the boundaries without
  // waiting 30 days. It is NOT read from the request in production paths that
  // matter: a caller who could set `now` could expire every session on demand,
  // so this is behind the same token as everything else here and is documented
  // as a verification affordance rather than a participant-facing parameter.
  const nowParam = new URL(request.url).searchParams.get("now");
  let now = new Date();
  if (nowParam) {
    const parsed = new Date(nowParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(errorBody("BAD_REQUEST", "`now` is not a valid timestamp."), {
        status: 400,
      });
    }
    now = parsed;
  }

  try {
    const result = await runSweep(now);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      errorBody("SWEEP_FAILED", e instanceof Error ? e.message : "Sweep failed."),
      { status: 500 },
    );
  }
}
