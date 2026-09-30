// PRD §30C, §23.4 — GoHighLevel sync payload (server-only).
//
// MINIMUM DATA CONTRACT — the ONLY participant fields that may leave the
// system toward GHL: Participant ID, first/last name, email, mobile when
// supplied, communication-consent state, GHL contact ID, assessment started
// date, completed date/status, primary attention area, participant-selected
// continuation path, approved workflow tags.
//
// NEVER sent: the 31 responses, fear/classifier tags, raw demographics,
// evidence chains, or scoring machinery (signals, values, overrides).

export interface GhlSyncInput {
  participantId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string | null;
  /** Latest communication-consent state per channel/purpose. */
  consentState: Array<{ channel: string; purpose: string; status: string }>;
  ghlContactId: string | null;
  assessmentStartedAt: string | null;
  assessmentCompletedAt: string | null;
  assessmentStatus: string;
  /** Approved attention-area key only — never scores or tags. */
  primaryAttentionArea: string | null;
  participantContinuationPath: string | null;
  /** Approved workflow tags only (derived from the attention area). */
  workflowTags: string[];
}

export interface GhlContactPayload {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  tags: string[];
  customFields: Record<string, string | null>;
}

export class GhlNotConfiguredError extends Error {
  readonly status = 502;
  constructor() {
    super("ghl_not_configured: GHL_PRIVATE_TOKEN / GHL_LOCATION_ID missing");
    this.name = "GhlNotConfiguredError";
  }
}

export class GhlUpstreamError extends Error {
  readonly status = 502;
  constructor(detail: string) {
    super(`ghl_upstream_error: ${detail}`);
    this.name = "GhlUpstreamError";
  }
}

/** Build the minimum-contract payload. Nothing outside the contract is read. */
export function buildGhlPayload(input: GhlSyncInput): GhlContactPayload {
  const customFields: Record<string, string | null> = {
    set_for_life_participant_id: input.participantId,
    set_for_life_assessment_started: input.assessmentStartedAt,
    set_for_life_assessment_completed: input.assessmentCompletedAt,
    set_for_life_assessment_status: input.assessmentStatus,
    set_for_life_attention_area: input.primaryAttentionArea,
    set_for_life_continuation_path: input.participantContinuationPath,
    set_for_life_consent_state: JSON.stringify(input.consentState),
  };
  if (input.ghlContactId) {
    customFields.set_for_life_ghl_contact_id = input.ghlContactId;
  }
  const payload: GhlContactPayload = {
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    tags: input.workflowTags,
    customFields,
  };
  if (input.mobile) payload.phone = input.mobile;
  return payload;
}

/**
 * Upsert the contact in GHL (server-only fetch — the private token never
 * leaves the server). Returns the GHL contact id. Throws GhlNotConfiguredError
 * when credentials are absent, GhlUpstreamError on HTTP failure.
 */
export async function postToGhl(payload: GhlContactPayload): Promise<string> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new GhlNotConfiguredError();
  let res: Response;
  try {
    res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, locationId }),
    });
  } catch (e) {
    throw new GhlUpstreamError(e instanceof Error ? e.message : "network failure");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GhlUpstreamError(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  try {
    const data = (await res.json()) as { contact?: { id?: string }; id?: string };
    const id = data.contact?.id ?? data.id;
    if (typeof id !== "string" || id === "") {
      throw new GhlUpstreamError("no contact id in response");
    }
    return id;
  } catch (e) {
    if (e instanceof GhlUpstreamError) throw e;
    throw new GhlUpstreamError("unparseable response");
  }
}
