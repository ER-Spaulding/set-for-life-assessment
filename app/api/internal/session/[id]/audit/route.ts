// PRD §23.5, §24 — internal scoring/evidence audit. PROTECTED.
//
// PRD §23.5: "exposes internal scoring/evidence only to authorized admins."
//
// This is the ONE endpoint that returns the diagnostic machinery §24 keeps
// away from participants: signal values, classifier tags, tensions, and the
// audit trail. It is therefore gated the same way as the test harness —
// bearer token from the server environment — and returns 404 when that token
// is unconfigured, so an unconfigured deployment does not advertise it.
//
// Never call this from participant-facing code. The response deliberately
// carries internal scores that would be a corrective judgement if a
// participant ever saw them (UIUX §19).

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const { id: sessionId } = await ctx.params;
  const db = serviceClient();

  const { data: session } = await db
    .from("assessment_sessions")
    .select("session_id, participant_id, assessment_version, status, started_at, completed_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json(errorBody("UNKNOWN_SESSION", "No such session."), {
      status: 404,
    });
  }

  // Column names pinned to supabase/migrations/20260930000001_initial_schema.sql:
  // computed_signals carries signal_id / raw_value / state — there is no
  // `value` or `special_state` column (the off-ladder DIRECT/AIM states live
  // in the overrides table and the snapshot's narrative keys, not here).
  const { data: signals } = await db
    .from("computed_signals")
    .select("signal_id, raw_value, state, evidence_confidence")
    .eq("session_id", sessionId);

  const { data: tags } = await db
    .from("classifier_tags")
    .select("source_item_id, tag_code")
    .eq("session_id", sessionId);

  const { data: tensions } = await db
    .from("tensions")
    .select("tension_code")
    .eq("session_id", sessionId);

  const { data: overrides } = await db
    .from("overrides")
    .select("*")
    .eq("session_id", sessionId);

  const { data: audit } = await db
    .from("audit_events")
    .select("event_type, event_at, metadata_json")
    .eq("session_id", sessionId)
    .order("event_at", { ascending: true });

  return NextResponse.json({
    session,
    // Internal machinery — see the header note. Not participant-facing.
    signals: signals ?? [],
    classifierTags: (tags ?? []).map(
      (t: { source_item_id: string; tag_code: string }) => ({
        sourceItemId: t.source_item_id,
        tagCode: t.tag_code,
      }),
    ),
    tensions: (tensions ?? []).map((t: { tension_code: string }) => t.tension_code),
    overrides: overrides ?? [],
    auditTrail: audit ?? [],
  });
}
