// PRD §23.3, §26 — pilot feedback.
//
// PRD §23.3: "stores validation feedback when pilot mode is enabled."
// PRD §26 scopes pilot mode: feedback is collected only after a participant
// has seen their Snapshot, and only while the session is flagged as a pilot.
//
// Two gates, both enforced here:
//   1. the session must be COMPLETED — feedback before a Snapshot would ask
//      the participant to rate something they have not seen;
//   2. the session must be in pilot mode.
//
// Refusing with a clear 409 rather than silently storing is deliberate: a
// feedback row collected outside pilot mode would look like valid pilot data
// in analysis while coming from a different population.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let payload: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as Record<string, unknown>;
    payload = body ?? {};
  } catch {
    return NextResponse.json(errorBody("INVALID_BODY", "Malformed request body."), {
      status: 400,
    });
  }

  const db = serviceClient();
  const { data: session, error: sErr } = await db
    .from("assessment_sessions")
    .select("session_id, status, pilot_mode")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not record feedback."), {
      status: 500,
    });
  }
  if (!session) {
    return NextResponse.json(errorBody("UNKNOWN_SESSION", "No such session."), {
      status: 404,
    });
  }

  // Gate 1 (§26): feedback follows the Snapshot.
  if (session.status !== "completed") {
    return NextResponse.json(
      errorBody(
        "NOT_COMPLETE",
        "Feedback can be given once your Snapshot has been prepared.",
      ),
      { status: 409 },
    );
  }

  // Gate 2 (§26): only pilot sessions contribute pilot data.
  if (!session.pilot_mode) {
    return NextResponse.json(
      errorBody("NOT_PILOT", "This session is not part of the pilot."),
      { status: 409 },
    );
  }

  // Ratings are 1–5 where supplied; the CHECK constraints enforce the range,
  // so they are passed through and any violation surfaces as a clear 422.
  // Allow-list is exactly the pilot_feedback columns in
  // supabase/migrations/20260930000001_initial_schema.sql — anything else is
  // dropped so a client field can never reach a nonexistent column.
  const row: Record<string, unknown> = { session_id: sessionId };
  for (const key of [
    "accuracy_rating",
    "synthesis_value_rating",
    "felt_judged_or_pressured",
    "inaccurate_text",
    "useful_text",
    "comprehension_text",
  ]) {
    if (payload[key] !== undefined) row[key] = payload[key];
  }

  const { error: iErr } = await db.from("pilot_feedback").insert(row);
  if (iErr) {
    if (iErr.code === "23514") {
      return NextResponse.json(
        errorBody("INVALID_RATING", "Ratings must be between 1 and 5."),
        { status: 422 },
      );
    }
    return NextResponse.json(errorBody("DB_ERROR", "Could not record feedback."), {
      status: 500,
    });
  }

  return NextResponse.json({ recorded: true }, { status: 201 });
}
