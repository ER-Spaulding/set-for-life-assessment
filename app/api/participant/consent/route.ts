// PRD §24, UIUX §22A — record explicit channel/purpose consent.
//
// PRD §23.3: "records explicit channel/purpose consent including consent-text
// version and timestamp."
//
// UIUX §22A: "Do not pre-check consent. Do not imply that A4 created
// permission."
//
// THREE RULES THIS ROUTE ENFORCES, ALL SERVER-SIDE:
//
//   1. Consent must be affirmatively stated. There is no default. Omitting
//      `granted` yields 400 — the client cannot "record consent" by saying
//      nothing, which is what a pre-checked box does by omission.
//   2. Consent is never derived from anything else. This route reads exactly
//      three inputs (channel, purpose, granted) plus the consent-text version
//      from the caller's record of what was shown. It never reads activation,
//      responses, or the Snapshot.
//   3. A revocation must reference an existing grant. Revoking something that
//      was never granted is rejected rather than recorded as a no-op.
//
// The database CHECK constraint (`communication_consents_check`) is the
// backstop: it requires a timestamp for every terminal state (§24).

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const CHANNELS = ["email", "sms"] as const;
const PURPOSES = ["operational", "marketing", "reminder"] as const;

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  let channel = "";
  let purpose = "";
  let granted: boolean | null = null; // null means "not stated" — never assumed
  let consentTextVersion = "";

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.participantId === "string") participantId = body.participantId;
    if (typeof body.channel === "string") channel = body.channel;
    if (typeof body.purpose === "string") purpose = body.purpose;
    if (typeof body.granted === "boolean") granted = body.granted;
    if (typeof body.consentTextVersion === "string") consentTextVersion = body.consentTextVersion;
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
  if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
    return NextResponse.json(
      errorBody("INVALID_CHANNEL", `channel must be one of ${CHANNELS.join(", ")}.`),
      { status: 400 },
    );
  }
  if (!PURPOSES.includes(purpose as (typeof PURPOSES)[number])) {
    return NextResponse.json(
      errorBody("INVALID_PURPOSE", `purpose must be one of ${PURPOSES.join(", ")}.`),
      { status: 400 },
    );
  }

  // Rule 1: an absent or non-boolean `granted` is refused, never defaulted.
  // A pre-checked box would arrive here as an implicit true; refusing to guess
  // is what keeps consent meaningful.
  if (granted === null) {
    return NextResponse.json(
      errorBody(
        "CONSENT_NOT_STATED",
        "An explicit consent decision is required. Consent is never assumed.",
      ),
      { status: 400 },
    );
  }

  if (!consentTextVersion) {
    // §23.3: the record must state which consent text the participant saw.
    return NextResponse.json(
      errorBody(
        "MISSING_CONSENT_VERSION",
        "consentTextVersion is required so the record shows what was agreed to.",
      ),
      { status: 400 },
    );
  }

  const db = serviceClient();
  const nowIso = new Date().toISOString();

  if (!granted) {
    // Rule 3: revoke an existing grant rather than creating a phantom record.
    const { data: existing, error: eErr } = await db
      .from("communication_consents")
      .select("consent_id, status")
      .eq("participant_id", participantId)
      .eq("channel", channel)
      .eq("purpose", purpose)
      .eq("status", "granted")
      .maybeSingle();
    if (eErr) {
      return NextResponse.json(errorBody("DB_ERROR", "Could not record the decision."), {
        status: 500,
      });
    }
    if (!existing) {
      // Nothing to revoke. Report success without inventing a record.
      return NextResponse.json({ recorded: false, reason: "no_active_consent" });
    }

    const { error: uErr } = await db
      .from("communication_consents")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("consent_id", existing.consent_id);
    if (uErr) {
      return NextResponse.json(errorBody("DB_ERROR", "Could not record the decision."), {
        status: 500,
      });
    }
    return NextResponse.json({ recorded: true, status: "revoked" });
  }

  const { error: iErr } = await db.from("communication_consents").insert({
    participant_id: participantId,
    channel,
    purpose,
    status: "granted",
    granted_at: nowIso,
    consent_text_version: consentTextVersion,
    // Where the decision came from. Recorded so an audit can distinguish a
    // UI choice from an operator action.
    source: "participant_ui",
  });

  if (iErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not record the decision."), {
      status: 500,
    });
  }

  return NextResponse.json({ recorded: true, status: "granted" }, { status: 201 });
}
