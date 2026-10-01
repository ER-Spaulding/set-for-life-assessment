// First-party analytics — the event vocabulary and payload guard.
//
// Addendum 02 v1.1 §16. Operator decision 2026-10-01: first-party in Supabase,
// no third-party vendor, "product/operational measurement, not collection of
// participant financial content".
//
// THE ALLOW-LIST IS THE PRIVACY CONTROL. The database refuses nested structures,
// oversized payloads, and any key outside a known-neutral set. This module
// mirrors that set so a developer writing an event gets told at BUILD time
// rather than at write time — and so the two cannot drift, which
// tests/unit/analytics.test.ts asserts.
//
// PURE. No I/O here — `recordEvent` lives in ./write so this module stays
// importable from client components without pulling a service client into the
// bundle.

/** §16's event vocabulary, plus the operational events the operator allowed. */
export const ANALYTICS_EVENTS = [
  // Assessment lifecycle
  "assessment_started",
  "assessment_resumed",
  "assessment_completed",
  "assessment_abandoned",
  // Funnel position — a NUMBER, never an answer
  "question_position_reached",
  // Pacing
  "money_moment_displayed",
  "money_moment_continued",
  // Save My Progress (§3.4)
  "save_progress_offered",
  "save_progress_used",
  "save_progress_skipped",
  // Returning participant (§4)
  "returning_flow_started",
  "returning_flow_completed",
  // Snapshot
  "snapshot_generated",
  "snapshot_viewed",
  "snapshot_pdf_generated",
  "snapshot_pdf_downloaded",
  // Operational
  "system_error",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * WHERE each event's truth lives — and therefore who may record it.
 *
 * A browser cannot be trusted to report that an assessment started, that a
 * verification link was sent, or that a Snapshot was served: in each case the
 * claim is only true because the SERVER did something. Recording those from the
 * client would let anyone POST an event that never happened, inflating the
 * funnel the measurement exists to inform.
 *
 * So each event is recorded at the moment the server actually performs the
 * thing. `"client"` below is reserved for the genuinely browser-only events —
 * a Money Moment rendering, a participant tapping past it — which have no
 * server moment to hang off.
 *
 * This split is ALSO a security boundary: only `"client"` events are accepted by
 * the client-reportable route, and that route derives its correlators from the
 * session row rather than trusting the request body.
 */
export const EVENT_KIND: Record<AnalyticsEvent, "server" | "client"> = {
  assessment_started: "server",
  assessment_resumed: "server",
  assessment_completed: "server",
  assessment_abandoned: "server",
  question_position_reached: "server",
  money_moment_displayed: "client",
  money_moment_continued: "client",
  save_progress_offered: "client",
  // The claim route is what actually sends the verification link, so the server
  // is the only witness to this having happened.
  save_progress_used: "server",
  // The only browser-only decision in the §3.4 prompt: the participant declined.
  // Nothing happens server-side, so there is no server moment to record.
  save_progress_skipped: "client",
  returning_flow_started: "server",
  returning_flow_completed: "server",
  snapshot_generated: "server",
  snapshot_viewed: "server",
  snapshot_pdf_generated: "server",
  snapshot_pdf_downloaded: "server",
  system_error: "server",
};

/** Events a browser is permitted to report. Derived, never hand-maintained. */
export const CLIENT_REPORTABLE_EVENTS = ANALYTICS_EVENTS.filter(
  (e) => EVENT_KIND[e] === "client",
);

export function isClientReportable(eventName: string): eventName is AnalyticsEvent {
  return (CLIENT_REPORTABLE_EVENTS as readonly string[]).includes(eventName);
}

/**
 * Payload keys a caller may use.
 *
 * MUST match `analytics_payload_is_safe()` in migration ...0008. The database is
 * the enforcement point; this is the same rule surfaced early so a mistake is a
 * compile error or a failed test rather than a rejected write at runtime.
 *
 * DELIBERATELY STRUCTURAL, NEVER SUBSTANTIVE: where, which, how many. There is
 * no key here for what a participant answered, and that is the point — the
 * allow-list means an answer cannot arrive under an unanticipated name.
 */
export const ALLOWED_PAYLOAD_KEYS = [
  "position",
  "step",
  "moment",
  "decision",
  "outcome",
  "channel",
  "ok",
  "retry",
  "count",
  "duration_ms",
  "code",
  "surface",
  "stage",
] as const;

export type AnalyticsPayload = Partial<
  Record<(typeof ALLOWED_PAYLOAD_KEYS)[number], string | number | boolean>
>;

/** Longest string value the database accepts. */
export const MAX_PAYLOAD_STRING = 64;

/** Most keys the database accepts. */
export const MAX_PAYLOAD_KEYS = 12;

export interface AnalyticsEventInput {
  eventName: AnalyticsEvent;
  participantId?: string | null;
  sessionId?: string | null;
  payload?: AnalyticsPayload;
}

/**
 * Would this payload pass the database constraint?
 *
 * Used by the tests to prove the two implementations agree, and available at
 * runtime so a caller can drop a bad payload rather than have the whole write
 * fail — losing one measurement is better than failing the participant action
 * that triggered it.
 */
export function isPayloadSafe(payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== "object" || Array.isArray(payload)) return false;

  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length > MAX_PAYLOAD_KEYS) return false;

  for (const [k, v] of entries) {
    if (!(ALLOWED_PAYLOAD_KEYS as readonly string[]).includes(k)) return false;
    const t = typeof v;
    if (t !== "string" && t !== "number" && t !== "boolean") return false;
    if (t === "string" && (v as string).length > MAX_PAYLOAD_STRING) return false;
  }
  return true;
}

/**
 * Strip a payload down to what the database will accept.
 *
 * Returns `{}` rather than throwing: an analytics write must never break the
 * participant action that produced it. A dropped measurement is a gap in the
 * funnel; a thrown error here would be a broken Save My Progress.
 */
export function sanitizePayload(payload: AnalyticsPayload | undefined): AnalyticsPayload {
  if (!payload) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!(ALLOWED_PAYLOAD_KEYS as readonly string[]).includes(k)) continue;
    const t = typeof v;
    if (t !== "string" && t !== "number" && t !== "boolean") continue;
    out[k] = t === "string" ? (v as string).slice(0, MAX_PAYLOAD_STRING) : (v as never);
  }
  return out as AnalyticsPayload;
}
