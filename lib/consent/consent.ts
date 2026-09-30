// PRD §24, UIUX §22A — consent + contact helpers (server-only).
//
// HARD RULES enforced here:
// - Consent is explicit, timestamped, revocable. status has NO default and is
//   REQUIRED on every call — never pre-checked, never default-true.
// - A4 activation readiness NEVER implies consent: no function here reads
//   activation values, and no code path outside the consent route writes a
//   consent row (phone entry does NOT create consent — see the mobile route).
// - Timestamps are stamped server-side (granted_at / revoked_at), never trusted
//   from the client.

export const CONSENT_CHANNELS = ["email", "sms"] as const;
export const CONSENT_PURPOSES = ["operational", "marketing", "reminder"] as const;
export const CONSENT_STATUSES = ["granted", "revoked", "expired"] as const;

export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export class ConsentValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ConsentValidationError";
  }
}

export interface ValidConsent {
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  /** Explicit only — the caller must supply it; there is no default. */
  status: ConsentStatus;
  consent_text_version: string;
  source: string;
}

/**
 * Validate explicit consent input. Throws ConsentValidationError (→400) when
 * status is missing/unknown, channel/purpose unknown, or the consent-text
 * version is absent. `status` is never defaulted.
 */
export function validateConsentInput(body: Record<string, unknown>): ValidConsent {
  const { channel, purpose, status, consent_text_version, source } = body;
  if (!isIn(channel, CONSENT_CHANNELS)) {
    throw new ConsentValidationError(
      `consent.channel must be one of ${CONSENT_CHANNELS.join(", ")}`,
    );
  }
  if (!isIn(purpose, CONSENT_PURPOSES)) {
    throw new ConsentValidationError(
      `consent.purpose must be one of ${CONSENT_PURPOSES.join(", ")}`,
    );
  }
  // Explicit status required — a missing status is a 400, never a default grant.
  if (status === undefined || status === null || status === "") {
    throw new ConsentValidationError(
      "consent.status is required and must be explicit (granted|revoked|expired); consent is never pre-checked",
    );
  }
  if (!isIn(status, CONSENT_STATUSES)) {
    throw new ConsentValidationError(
      `consent.status must be one of ${CONSENT_STATUSES.join(", ")}`,
    );
  }
  if (typeof consent_text_version !== "string" || consent_text_version.trim() === "") {
    throw new ConsentValidationError(
      "consent.consent_text_version is required (records which consent text was shown)",
    );
  }
  const src =
    typeof source === "string" && source.trim() !== ""
      ? source.trim()
      : "participant_portal";
  return {
    channel,
    purpose,
    status,
    consent_text_version: consent_text_version.trim(),
    source: src,
  };
}

function isIn<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export class MobileValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "MobileValidationError";
  }
}

/**
 * Normalize a mobile number to E.164-ish form ("+" + digits, 7–15 digits).
 * Throws MobileValidationError (→400) on anything else.
 */
export function normalizeMobile(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new MobileValidationError("mobile is required");
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new MobileValidationError(
      "mobile must contain 7–15 digits (E.164)",
    );
  }
  return `+${digits}`;
}
