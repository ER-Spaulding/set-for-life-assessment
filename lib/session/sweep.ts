// The lifecycle sweep — server-side, forward-only, idempotent.
//
// Operator instruction #7:
//   "Use the previously proposed server-side Supabase sweep, not browser unload
//    behavior, to evaluate incomplete sessions. The sweep should use
//    last_activity_at and the participant/session lifecycle state.
//      < 7 full days inactive   -> remain current/resumable
//      >= 7 and < 30 days       -> ABANDONED / resumable
//      >= 30 full days          -> EXPIRED / not resumable"
//
// WHY NOT A BEACON, recorded because it is the obvious alternative: unload and
// visibility events fire on every tab switch, phone call and app backgrounding,
// so they report abandonment for merely-interrupted participants and bias
// hardest against mobile users — the population a 320px-first product is built
// for. A window computed server-side from stored data cannot fire spuriously,
// costs nothing at the moment of abandonment, and still works when the browser
// never gets the chance to send anything, which is what actually happens when
// someone closes a tab.
//
// FORWARD-ONLY. The sweep transitions in_progress -> abandoned -> expired. It
// never moves a session backwards: a resumed session returns to in_progress
// because the PARTICIPANT acted, not because the sweep decided to undo itself.
// If the sweep could move a session backwards, a sweep running concurrently with
// a resume could undo it.
//
// IDEMPOTENT. Each transition is guarded by the current status, so a second run
// finds nothing to do. That matters because this runs on a schedule and may be
// retried.

import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serviceClient } from "../db/client";
import {
  planTransitions,
  resolveThresholds,
  type IncompleteSession,
  type LifecycleThresholds,
} from "./lifecycle";
import { stageForPosition } from "./stage";
import { recordEvent } from "../analytics/write";

/** Read the lifecycle config once. Falls back to documented defaults. */
let cachedConfig: unknown = null;
function lifecycleConfig(): unknown {
  if (cachedConfig === null) {
    try {
      cachedConfig = JSON.parse(
        readFileSync(resolve(process.cwd(), "config/lifecycle-v1.0.json"), "utf8"),
      );
    } catch {
      cachedConfig = {};
    }
  }
  return cachedConfig;
}

export function lifecycleThresholds(): LifecycleThresholds {
  return resolveThresholds(lifecycleConfig());
}

/**
 * The instrument's administered order, for stage derivation.
 *
 * Read here rather than imported from the question bank so the sweep does not
 * depend on the assessment module graph — it only needs the ORDER, and a sweep
 * that failed because scoring config was mid-deploy would stop classifying
 * sessions for no reason.
 */
let cachedOrder: string[] | null = null;
function sequenceOrder(): string[] {
  if (cachedOrder !== null) return cachedOrder;
  try {
    const bank = JSON.parse(
      readFileSync(resolve(process.cwd(), "config/assessment-v1.0.json"), "utf8"),
    ) as {
      opening?: Array<{ internal_id: string }>;
      questions?: Array<{ internal_id: string; external_order?: number }>;
      activation?: Array<{ internal_id: string }>;
    };
    const opening = (bank.opening ?? []).map((q) => q.internal_id);
    const diagnostic = [...(bank.questions ?? [])]
      .sort((a, b) => (a.external_order ?? 0) - (b.external_order ?? 0))
      .map((q) => q.internal_id);
    const activation = (bank.activation ?? []).map((q) => q.internal_id);
    cachedOrder = [...opening, ...diagnostic, ...activation];
  } catch {
    cachedOrder = [];
  }
  return cachedOrder;
}

export interface SweepResult {
  /** Sessions that moved in_progress -> abandoned. */
  abandoned: number;
  /** Sessions that moved abandoned -> expired, plus in_progress -> expired in one step. */
  expired: number;
  /** Sessions examined but left alone. */
  untouched: number;
  /** The thresholds in force, echoed so a run is self-describing in logs. */
  thresholds: LifecycleThresholds;
}

/**
 * Run the sweep. Safe to call repeatedly.
 *
 * Returns counts rather than throwing on individual failures: one unclassifiable
 * session must not stop the rest, and the caller (a cron job) has nothing useful
 * to do with an exception.
 */
export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const thresholds = lifecycleThresholds();
  const db = serviceClient();

  const { data, error } = await db
    .from("assessment_sessions")
    // `completed` is excluded in the QUERY as well as the plan: the operator was
    // explicit that completed assessments are untouched by this feature, and
    // filtering twice means a bug in the planner cannot reach them.
    .select("session_id, participant_id, status, last_activity_at, current_position")
    .in("status", ["in_progress", "abandoned"]);

  if (error) throw new Error(`sweep: ${error.message}`);

  const sessions = (data ?? []) as IncompleteSession[];
  const plan = planTransitions(sessions, now, thresholds);
  const order = sequenceOrder();

  let abandoned = 0;
  let expired = 0;

  for (const { session, to, from } of plan) {
    const { error: upErr } = await db
      .from("assessment_sessions")
      .update({ status: to, lifecycle_changed_at: now.toISOString() })
      .eq("session_id", session.session_id)
      // Guard the transition against a concurrent write (a participant resuming
      // while the sweep runs). If the status moved under us, the update matches
      // nothing and the session is left to the resume that won.
      .eq("status", from);

    if (upErr) continue; // next session; one failure must not stop the sweep

    if (to === 'abandoned') abandoned++;
    else expired++;

    // THE STAGE IDENTIFIER — a position-derived label, never a response value.
    // `stageForPosition` receives an integer and the instrument order; there is
    // no parameter through which an answer could arrive.
    const stage =
      order.length > 0
        ? stageForPosition(session.current_position, {
            sequence: order,
            moments: [],
            activationStartIndex: order.length - 4,
          })
        : undefined;

    // Operator instruction #8: preserve whether the participant had
    // INTENTIONALLY SAVED, so saved abandonment and unsaved abandonment stay
    // countable apart. Derived from the verified contact — the durable record of
    // the save — rather than from a second flag.
    const saved = await participantHasVerifiedContact(session.participant_id);

    await recordEvent({
      eventName: to === 'abandoned' ? 'assessment_abandoned' : 'assessment_expired',
      participantId: session.participant_id,
      sessionId: session.session_id,
      payload: {
        position: session.current_position,
        ...(stage ? { stage } : {}),
        saved,
      },
    });
  }

  return { abandoned, expired, untouched: sessions.length - plan.length, thresholds };
}

/** Did this participant use Save My Progress? The verified contact IS the flag. */
async function participantHasVerifiedContact(participantId: string): Promise<boolean> {
  try {
    const db = serviceClient();
    const { data } = await db
      .from('participant_contacts')
      .select('verified_at')
      .eq('participant_id', participantId)
      .not('verified_at', 'is', null)
      .maybeSingle();
    return Boolean(data);
  } catch {
    // A failed lookup must not fail the transition. `false` under-reports saved
    // abandonment rather than over-reporting it, which is the safer direction:
    // it cannot manufacture evidence that Save My Progress works.
    return false;
  }
}
