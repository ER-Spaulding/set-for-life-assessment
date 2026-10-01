// Demographics / Participant Profile — persist the optional profile answers.
//
// GOVERNING REQUIREMENTS (operator, 2026-10-01):
//   * profile data ONLY — "zero effect on scoring, interpretation, friction
//     findings, Activation, Perception Gap, or the Set for Life Money Picture";
//   * "must not change the requirement of 31 required assessment responses";
//   * "Prefer not to say" stays an explicit, valid response.
//
// WHY THIS WRITES NO RESPONSE ROWS. The 31 required responses live in
// `responses`, and completion is computed from them (`validateCompleteness`).
// Writing D1–D4 there would make the demographics step part of the instrument —
// changing the required count, which the requirement forbids. So this writes
// `demographics` (the profile table) and `participants.state_code`, and touches
// no response row. The 31 is untouched by construction, not by care.
//
// WHY STATE GOES TO A DIFFERENT TABLE. `demographics` is FROZEN on completion by
// trg_demographics_immutable, and State is explicitly not interpretation — it is
// durable profile data about the PERSON that may be corrected later. So it lives
// on `participants` beside `sfl_number`, and the rest of the profile lives in
// `demographics` where the spec puts it.
//
// ORDERING NOTE: `demographics` freezes once the session completes, so this must
// run BEFORE completion. The screen sits before the Snapshot for that reason, and
// a write after completion would be refused by the trigger rather than silently
// doing nothing.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { normalizeJurisdiction } from "@/lib/profile/jurisdiction";

export const dynamic = "force-dynamic";

/** Allowed codes, read from the instrument config so the route cannot drift. */
import bank from "../../../../config/assessment-v1.0.json";

interface Item {
  internal_id: string;
  options: Array<{ code: string }>;
}
const ITEMS = bank.demographics as Item[];

function allowedCodes(internalId: string): Set<string> {
  return new Set(
    (ITEMS.find((i) => i.internal_id === internalId)?.options ?? []).map((o) => o.code),
  );
}

/**
 * Accept a submitted code only if the instrument defines it.
 *
 * An unvalidated value would let a caller write anything into a profile column,
 * and a typo would be indistinguishable from a real answer later. `null` means
 * "not answered", which is a legitimate outcome for an optional question.
 */
function validate(internalId: string, raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return allowedCodes(internalId).has(trimmed) ? trimmed : undefined;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let sessionId: string | undefined;
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as Record<string, unknown>;
    body = parsed;
    if (typeof parsed.sessionId === "string") sessionId = parsed.sessionId;
  } catch {
    /* falls through */
  }

  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json(errorBody("INVALID_SESSION", "A session is required."), {
      status: 400,
    });
  }

  const ageRange = validate("D1", body.ageRange);
  const gender = validate("D2", body.gender);
  const householdIncome = validate("D3", body.householdIncome);

  // D4 uses the jurisdiction normaliser rather than the generic code check: the
  // selector's values come from the controlled list, and a decline is an
  // explicit sentinel rather than an absence.
  const stateRaw = normalizeJurisdiction(body.stateCode);
  if (stateRaw === undefined) {
    return NextResponse.json(
      errorBody("INVALID_STATE", "That is not a recognised state or jurisdiction."),
      { status: 400 },
    );
  }

  if (
    ageRange === undefined ||
    gender === undefined ||
    householdIncome === undefined
  ) {
    return NextResponse.json(
      errorBody("INVALID_ANSWER", "One of those answers was not recognised."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  const { data: session } = await db
    .from("assessment_sessions")
    .select("participant_id, status")
    .eq("session_id", sessionId)
    .maybeSingle();

  const row = session as { participant_id?: string; status?: string } | null;
  if (!row?.participant_id) {
    return NextResponse.json(errorBody("UNKNOWN_SESSION", "No such session."), {
      status: 404,
    });
  }
  if (row.status === "completed") {
    // The freeze trigger would refuse this anyway; failing here gives a clear
    // reason instead of a database error.
    return NextResponse.json(
      errorBody("SESSION_COMPLETE", "This assessment is already complete."),
      { status: 409 },
    );
  }

  const selfDescribe =
    gender === "D2_C" && typeof body.genderSelfDescribe === "string"
      ? body.genderSelfDescribe.trim().slice(0, 200) || null
      : null;

  // Upsert: the participant may revisit this step, and a second visit should
  // update rather than fail on the primary key.
  const { error: dErr } = await db.from("demographics").upsert(
    {
      session_id: sessionId,
      age_range: ageRange,
      gender,
      gender_self_describe: selfDescribe,
      household_income: householdIncome,
    },
    { onConflict: "session_id" },
  );
  if (dErr) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not save your answers."),
      { status: 500 },
    );
  }

  // State lives on the participant, not the session — see the header.
  const { error: sErr } = await db
    .from("participants")
    .update({ state_code: stateRaw })
    .eq("participant_id", row.participant_id);
  if (sErr) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not save your answers."),
      { status: 500 },
    );
  }

  // Echo what was stored, so the client renders the record rather than its hope.
  return NextResponse.json(
    { saved: true, ageRange, gender, householdIncome, stateCode: stateRaw },
    { status: 200 },
  );
}
