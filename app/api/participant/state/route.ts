// Optional participant State — contextual/profile data ONLY.
//
// Operator requirement (2026-10-01): "It must have zero effect on diagnostic
// scoring, the six Money Picture signals, friction determination, Perception
// Gap, Activation, or Snapshot interpretation. Declining to answer must never
// generate a diagnostic inference."
//
// That is why this route writes `participants.state_code` and touches nothing
// else. It does not write `demographics` — that table is FROZEN on completion
// (`trg_demographics_immutable`) because it is adjacent to interpretation, and
// State is explicitly not. It writes no response row, so it cannot affect the
// 31-item count, and it writes no consent row, so it cannot imply permission to
// be contacted (UIUX §22A: consent is separate and never inferred).
//
// IDENTITY COMES FROM THE REQUEST AND IS VALIDATED. This is the pilot build's
// existing pattern: the client holds a participant id it obtained from a
// verified flow. The value is checked for shape here and the write is scoped to
// it, so a caller cannot address another participant's row without already
// knowing its UUID — and §22.2 makes that UUID the identity, never the email.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { normalizeJurisdiction } from "@/lib/profile/jurisdiction";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  let rawState: unknown;
  try {
    const body = (await request.json()) as {
      participantId?: unknown;
      state?: unknown;
    };
    if (typeof body.participantId === "string") participantId = body.participantId;
    rawState = body.state;
  } catch {
    /* falls through to the validation error below */
  }

  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A verified participant id is required."),
      { status: 400 },
    );
  }

  // Normalise BEFORE the write. The DB enforces the controlled list with a
  // foreign key, so "  ca  " would be REJECTED rather than cleaned — a valid
  // answer from a participant typing a lowercase code would fail the write.
  // `undefined` means "not a jurisdiction and not a refusal": a typo, which must
  // be reported rather than silently stored as a decline.
  const normalized = normalizeJurisdiction(rawState);
  if (normalized === undefined) {
    return NextResponse.json(
      errorBody("INVALID_STATE", "That is not a recognised state or jurisdiction."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  // Confirm the participant exists so an unknown id is a clear 404 rather than a
  // silent no-op update that reports success.
  const { data: existing, error: pErr } = await db
    .from("participants")
    .select("participant_id")
    .eq("participant_id", participantId)
    .maybeSingle();
  if (pErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not save your state."), {
      status: 500,
    });
  }
  if (!existing) {
    return NextResponse.json(
      errorBody("UNKNOWN_PARTICIPANT", "No such participant."),
      { status: 404 },
    );
  }

  const { error } = await db
    .from("participants")
    .update({ state_code: normalized })
    .eq("participant_id", participantId);
  if (error) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not save your state."), {
      status: 500,
    });
  }

  // Echo the STORED value, not the submitted one, so the client renders what is
  // actually on the record rather than what it hoped to write.
  return NextResponse.json({ state: normalized }, { status: 200 });
}
