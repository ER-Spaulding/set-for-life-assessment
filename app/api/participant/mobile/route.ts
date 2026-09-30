// PRD §23.3, §24, UIUX §27A — store a mobile number after the Snapshot.
//
// PRD §23.3: "stores normalized mobile number after the Snapshot experience."
//
// Collected AFTER the Snapshot, never before: PRD §30D notes a first-time
// participant who has only a verified email is email-reminder eligible, so a
// mobile number is a post-completion convenience rather than a gate.
//
// Storing a number is NOT consent to be messaged. This route writes no consent
// row — SMS consent is recorded separately via /api/participant/consent, and
// the two must never be conflated (UIUX §22A). A number on file with no
// granted SMS consent is simply a number nobody may text.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { normaliseMobile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  let raw = "";
  try {
    const body = (await request.json()) as { participantId?: unknown; mobile?: unknown };
    if (typeof body.participantId === "string") participantId = body.participantId;
    if (typeof body.mobile === "string") raw = body.mobile;
  } catch {
    return NextResponse.json(errorBody("INVALID_BODY", "Malformed request body."), {
      status: 400,
    });
  }

  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A verified participant id is required."),
      { status: 400 },
    );
  }

  const mobile = normaliseMobile(raw);
  if (!mobile) {
    // UIUX §27A lists "mobile number invalid" as a required system state, so
    // this is a first-class outcome with its own code, not a generic 400.
    return NextResponse.json(
      errorBody("INVALID_MOBILE", "That mobile number does not look valid."),
      { status: 422 },
    );
  }

  const db = serviceClient();
  const { error } = await db.from("participant_contacts").insert({
    participant_id: participantId,
    contact_type: "mobile",
    normalized_value: mobile,
  });

  if (error) {
    // A unique-constraint violation means this number is already recorded for
    // this participant — an idempotent success, not a failure.
    if (error.code === "23505") {
      return NextResponse.json({ stored: true, alreadyPresent: true });
    }
    return NextResponse.json(errorBody("DB_ERROR", "Could not save the number."), {
      status: 500,
    });
  }

  // Note deliberately absent: no consent row is written here. See the header.
  return NextResponse.json({ stored: true, alreadyPresent: false }, { status: 201 });
}
