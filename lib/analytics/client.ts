// First-party analytics — the browser-side reporter.
//
// Addendum 02 v1.1 §16.
//
// WHY THIS FILE EXISTS AT ALL. `lib/analytics/write.ts` imports the service
// client, which imports `server-only` — correctly, because the service-role key
// bypasses Row Level Security and must never reach a bundle. So a client
// component cannot call the writer directly. It posts here instead, this module
// posts to `/api/analytics/event`, and the route uses the writer.
//
// THE FIRST ATTEMPT GOT THIS WRONG, and the failure is worth recording because
// the guard that caught it is the one that must never be removed: four client
// components imported `recordEventInBackground` from `write.ts` directly. The
// build refused with "'server-only' cannot be imported from a Client Component
// module". Nothing leaked — but only because that line held. The rule this file
// encodes: CLIENT COMPONENTS IMPORT FROM HERE, NEVER FROM ./write.
//
// ONLY THE BROWSER-ONLY EVENTS COME THROUGH HERE. Everything with a server
// moment is recorded server-side, at the moment the server does the thing
// (`EVENT_KIND` in ./events). So this path carries four events, not seventeen.
//
// PURELY ADDITIVE, NEVER LOAD-BEARING: it never throws, never rejects, and
// never returns a promise a caller has to await. Measurement must not be able to
// break a participant action.

import { isPayloadSafe, type AnalyticsEvent, type AnalyticsPayload } from "./events";

/**
 * Report a browser-only event. Fire-and-forget; never throws, never rejects.
 *
 * `keepalive` is deliberate: the Money Moment events fire as the participant
 * moves to the next screen, and a plain fetch is cancelled by that navigation.
 * A cancelled beacon is a silent hole in the funnel, which is the exact failure
 * this system exists to avoid.
 */
export function reportEvent(args: {
  eventName: AnalyticsEvent;
  sessionId?: string | null;
  payload?: AnalyticsPayload;
}): void {
  try {
    // Guarded HERE rather than trusting the route: a payload this client refuses
    // to send is one fewer rejected request, and the rule stays in one place
    // (the same allow-list the database enforces).
    const payload = args.payload && isPayloadSafe(args.payload) ? args.payload : undefined;

    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventName: args.eventName,
        // The participant is NOT sent from here. The route resolves it from the
        // session row, so a client cannot attribute an event to someone else's
        // record by editing a request. The session id is already in the URL the
        // participant is looking at, so it discloses nothing new.
        sessionId: args.sessionId ?? null,
        payload: payload ?? {},
      }),
      keepalive: true,
      // The response is never read. A failed measurement is a gap in a chart.
    }).catch(() => {
      /* offline, blocked, or aborted — never surfaces */
    });
  } catch {
    /* JSON.stringify failure or a torn-down page — never surfaces */
  }
}
