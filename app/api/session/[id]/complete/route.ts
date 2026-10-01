// PRD §8, §23.2, §23.5 — complete an assessment.
//
// PRD §23.2: "validates all 31 required responses server-side, freezes the
// submission, runs deterministic scoring, runs consistency checks, stores
// evidence chains, and creates the Snapshot payload."
//
// PRD §23.5: "Never trust client-side completion... Required-item validation
// and final scoring run server-side."
//
// THIS ROUTE ACCEPTS NO COMPLETENESS CLAIM. There is no field in the request
// body that can assert the assessment is finished, because such a field is
// precisely what §23.5 forbids trusting. `completeSession(sessionId)` reads the
// persisted responses and decides for itself. Posting `{"complete": true}` to
// this endpoint has no effect whatsoever on the outcome.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { completeSession } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let result;
  try {
    result = await completeSession(sessionId);
  } catch {
    return NextResponse.json(
      errorBody("COMPLETION_FAILED", "Could not complete the assessment."),
      { status: 500 },
    );
  }

  if (!result.complete) {
    // A legitimate refusal, not an error: the assessment is simply unfinished.
    // The missing items are returned so the client can navigate to them.
    return NextResponse.json(
      {
        complete: false,
        missing: result.missing,
        present: result.present,
        required: result.required,
        message: "Some questions still need an answer before your Snapshot can be prepared.",
      },
      { status: 422 },
    );
  }

  // `firstName` is the participant's own name, returned only when their
  // identity is verified (Addendum 02 v1.1 §3.2/§15) so the synthesis reveal
  // can render its approved completion line. It is null far more often than
  // not, and the reveal drops the name rather than substituting anything.
  return NextResponse.json({
    complete: true,
    sessionId: result.sessionId,
    firstName: result.firstName ?? null,
  });
}
