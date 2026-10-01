// First-party analytics — the write path.
//
// Addendum 02 v1.1 §16. Server-side only: this imports the service client, and
// the migration grants `analytics_events` to `service_role` alone (no anon or
// authenticated policy exists), so a browser cannot write or read a single row.
//
// FIRE-AND-FORGET BY DESIGN. Every call site is a participant action — saving
// progress, completing an assessment. Measurement must never be able to break
// one of those. So this never throws and never rejects: a failed analytics write
// is a gap in a funnel chart, and a thrown error here would be a broken Save My
// Progress. The trade is deliberate and stated rather than accidental.

import { serviceClient } from "../db/client";
import {
  sanitizePayload,
  type AnalyticsEvent,
  type AnalyticsPayload,
} from "./events";

/**
 * Record one event. Never throws, never rejects.
 *
 * Returns whether the write landed, so a test or a diagnostic can observe it —
 * call sites should ignore the result.
 */
export async function recordEvent(args: {
  eventName: AnalyticsEvent;
  participantId?: string | null;
  sessionId?: string | null;
  payload?: AnalyticsPayload;
}): Promise<boolean> {
  try {
    const db = serviceClient();
    const { error } = await db.from("analytics_events").insert({
      event_name: args.eventName,
      // Correlators are optional: a system error or a pre-session page view has
      // neither, and a foreign key would reject a fabricated placeholder.
      participant_id: args.participantId ?? null,
      session_id: args.sessionId ?? null,
      payload: sanitizePayload(args.payload),
      // `retain_until` is deliberately NOT set. The governing spec provides no
      // retention period and the operator asked that one not be invented, so the
      // column stays NULL and the state of the decision is visible in
      // analytics_retention_status rather than assumed here.
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Record an event without awaiting it.
 *
 * For call sites inside a request that must not be delayed — a route handler
 * returning to the participant should not wait on a measurement write. The
 * promise is intentionally not returned; failures are already swallowed.
 */
export function recordEventInBackground(args: {
  eventName: AnalyticsEvent;
  participantId?: string | null;
  sessionId?: string | null;
  payload?: AnalyticsPayload;
}): void {
  void recordEvent(args);
}

/**
 * Count events by name over a window — the shape §16's pilot questions need.
 *
 * e.g. "does removing the identity wall improve assessment starts?" is
 * `assessment_started` before vs after. Returns plain numbers and no participant
 * data, so this is safe to surface in an operator view.
 */
export async function eventCounts(sinceIso?: string): Promise<Record<string, number>> {
  try {
    const db = serviceClient();
    let q = db.from("analytics_events").select("event_name");
    if (sinceIso) q = q.gte("occurred_at", sinceIso);
    const { data, error } = await q;
    if (error || !data) return {};
    const out: Record<string, number> = {};
    for (const row of data as Array<{ event_name: string }>) {
      out[row.event_name] = (out[row.event_name] ?? 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}
