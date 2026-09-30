// PRD §5.4, §23.2, §24 — safe participant state for resume.
//
// PRD §23.2: "returns safe participant state for resume; never expose internal
// scoring before completion."
//
// "Safe" is doing real work in that sentence. This returns the answers and the
// position so the participant can pick up where they left off — and nothing
// else. No signals, no states, no classifier tags, no tensions, no evidence.
// A participant who is 20 questions in cannot learn from this endpoint how
// they are scoring, because the response contains no scoring at all.
//
// Even after completion the diagnostic surface stays out: this route does not
// become an audit endpoint once the session is done. The Snapshot has its own
// route with its own approved-copy shape.

import { NextResponse } from "next/server";
import { isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { loadResumeState } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let state;
  try {
    state = await loadResumeState(sessionId);
  } catch {
    return NextResponse.json(errorBody("DB_ERROR", "Could not load the session."), {
      status: 500,
    });
  }

  if (!state) {
    return NextResponse.json(errorBody("UNKNOWN_SESSION", "No such session."), {
      status: 404,
    });
  }

  // Answers and position only. See the header: no diagnostic fields exist on
  // this shape, so none can leak by accident.
  return NextResponse.json({
    sessionId: state.sessionId,
    status: state.status,
    currentPosition: state.currentPosition,
    responses: state.responses,
  });
}
