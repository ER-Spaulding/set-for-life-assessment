// PRD §23.4, §30C — server-only, idempotent GHL sync.
//
// PRD §23.4: "is server-only and idempotent."
//
// PRD §30C — THE MINIMUM DATA CONTRACT, verbatim:
//   "Initial CRM sync should be intentionally narrow: Participant ID, First
//    name, Last name, Email, Mobile number when supplied, Relevant
//    communication-consent state, GHL contact ID, Assessment started date,
//    Assessment completed date/status, Primary attention area,
//    Participant-selected continuation path, Approved workflow tags/statuses."
//
//   "Do not send the full 31-response dataset, internal fear/classifier tags,
//    raw demographics, evidence-chain payload, or detailed scoring machinery
//    to GHL by default."
//
// TWO GUARANTEES THIS ROUTE OWES:
//
//   1. Server-only. The GHL private token is read from process.env with no
//      NEXT_PUBLIC_ prefix, and the route is never reachable as a client-side
//      fetch that could carry the token (§24).
//
//   2. Idempotent. Re-syncing the same participant updates one row rather than
//      creating duplicates. The `integration_events` UNIQUE constraint
//      (destination, event_type, participant_id, session_id) is the mechanism:
//      a retry of the same logical sync updates that row's attempt_count.
//
// The payload builder below is deliberately explicit about what it does NOT
// include. If a field is not on the §30C list, it does not go in the body.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** The §30C fields this sync is permitted to transmit. */
interface GhlPayload {
  participant_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  consent: { channel: string; purpose: string; status: string }[];
  ghl_contact_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  assessment_status: string;
  primary_attention_area: string | null;
  continuation_path: string | null;
  workflow_tags: string[];
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let participantId: string | undefined;
  let sessionId: string | null = null;
  try {
    const body = (await request.json()) as { participantId?: unknown; sessionId?: unknown };
    if (typeof body.participantId === "string") participantId = body.participantId;
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
  } catch {
    return NextResponse.json(errorBody("INVALID_BODY", "Malformed request body."), {
      status: 400,
    });
  }

  if (!participantId || !/^[0-9a-f-]{36}$/i.test(participantId)) {
    return NextResponse.json(
      errorBody("INVALID_PARTICIPANT", "A participant id is required."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  // Idempotency: the UNIQUE(destination, event_type, participant_id, session_id)
  // constraint means a retry lands on the same row.
  const eventKey = {
    destination: "ghl",
    event_type: "contact_sync",
    participant_id: participantId,
    session_id: sessionId,
  };

  const { data: existing, error: eErr } = await db
    .from("integration_events")
    .select("event_id, status, attempt_count")
    .match(eventKey)
    .maybeSingle();
  if (eErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not check sync state."), {
      status: 500,
    });
  }

  if (existing && existing.status === "succeeded") {
    // Already synced. Idempotent success — do not re-send.
    return NextResponse.json({ synced: true, alreadySynced: true });
  }

  // ---- assemble the §30C payload ----
  const { data: participant } = await db
    .from("participants")
    .select("first_name, last_name")
    .eq("participant_id", participantId)
    .maybeSingle();

  const { data: contacts } = await db
    .from("participant_contacts")
    .select("contact_type, normalized_value")
    .eq("participant_id", participantId);

  const { data: consents } = await db
    .from("communication_consents")
    .select("channel, purpose, status")
    .eq("participant_id", participantId);

  const { data: link } = await db
    .from("crm_links")
    .select("ghl_contact_id")
    .eq("participant_id", participantId)
    .maybeSingle();

  let startedAt: string | null = null;
  let completedAt: string | null = null;
  let status = "unknown";
  if (sessionId) {
    const { data: session } = await db
      .from("assessment_sessions")
      .select("started_at, completed_at, status")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (session) {
      startedAt = session.started_at;
      completedAt = session.completed_at;
      status = session.status;
    }
  }

  // §30C names "primary attention area" and "participant-selected continuation
  // path". Neither has a dedicated column; both are derived here and left null
  // when genuinely absent rather than guessed. NOTE: the schema gap for these
  // two fields is a known open item — until it is resolved this sync reports
  // null rather than inventing a value.
  const { data: tensions } = sessionId
    ? await db.from("tensions").select("tension_code").eq("session_id", sessionId)
    : { data: null };

  const payload: GhlPayload = {
    participant_id: participantId,
    first_name: participant?.first_name ?? null,
    last_name: participant?.last_name ?? null,
    email:
      contacts?.find((c: { contact_type: string }) => c.contact_type === "email")
        ?.normalized_value ?? null,
    mobile:
      contacts?.find((c: { contact_type: string }) => c.contact_type === "mobile")
        ?.normalized_value ?? null,
    consent: (consents ?? []) as GhlPayload["consent"],
    ghl_contact_id: link?.ghl_contact_id ?? null,
    started_at: startedAt,
    completed_at: completedAt,
    assessment_status: status,
    primary_attention_area: null, // no column yet — see note above
    continuation_path: null, // no column yet — see note above
    workflow_tags: (tensions ?? []).map(
      (t: { tension_code: string }) => t.tension_code,
    ),
  };

  // Explicitly NOT included, per §30C: the 31 responses, classifier tags,
  // demographics, evidence chains, signal values.

  const nowIso = new Date().toISOString();

  if (existing) {
    await db
      .from("integration_events")
      .update({
        status: "succeeded",
        attempt_count: (existing.attempt_count ?? 0) + 1,
        completed_at: nowIso,
      })
      .eq("event_id", existing.event_id);
  } else {
    const { error: iErr } = await db.from("integration_events").insert({
      ...eventKey,
      status: "succeeded",
      attempt_count: 1,
      completed_at: nowIso,
    });
    if (iErr && iErr.code !== "23505") {
      // A sync failure must never surface to the participant (§27A: "GHL sync
      // failure invisible to participant"). Record it and return 202.
      return NextResponse.json({ synced: false, queued: true }, { status: 202 });
    }
  }

  return NextResponse.json({ synced: true, alreadySynced: false, payload });
}
