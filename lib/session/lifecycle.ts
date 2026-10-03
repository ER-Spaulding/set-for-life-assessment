// The assessment lifecycle — saved, abandoned, expired.
//
// Operator decision 2026-10-01. The governing principle, verbatim:
//
//   "The Set for Life Financial Assessment is intended to reflect where the
//    participant is financially today. We want to respect intentionally saved
//    progress without allowing sufficiently old answers to become the basis for
//    a current Financial Snapshot."
//
// THE STATE MODEL IS DELIBERATELY SMALL. The operator asked for it explicitly:
//
//   "Do not create unnecessary permanent lifecycle states merely because we can
//    measure inactivity. ... The meaningful persisted assessment lifecycle should
//    remain conceptually simple: IN_PROGRESS → SAVED → ABANDONED → EXPIRED, with
//    COMPLETED as the terminal successful state. RESUMED should normally be
//    recorded as an event rather than becoming another permanent lifecycle
//    status."
//
// So `RESUMED` is NOT a status here. A resumed session goes back to
// `in_progress`, and the fact that it had been abandoned lives in the event
// history. Adding a status would make "where is this session now" and "what has
// this session been" the same question, and they are not.
//
// SAVED is also not a separate status, for the same reason: it is `in_progress`
// + a verified contact, which is a fact about the participant rather than a
// phase of the session. The operator's list is conceptual; the schema expresses
// it more precisely with fewer states.
//
// PURE. No I/O, no clock reads — `now` is always passed in, so the boundaries
// are testable at an exact instant rather than approximately.

/** The persisted lifecycle status of an assessment session. */
export type LifecycleStatus = 'in_progress' | 'completed' | 'abandoned' | 'expired';

/**
 * What an incomplete session IS, right now, given how long it has been idle.
 *
 * `current`     — within the saved window. Resumable, not abandoned.
 * `abandoned`   — past the saved window. Resumable, but classified abandoned.
 * `expired`     — past the expiration window. NOT resumable; needs a new session.
 *
 * `completed` is reported separately by the caller: it is terminal and no
 * inactivity rule applies to it.
 */
export type IdleClassification = 'current' | 'abandoned' | 'expired';

/**
 * The lifecycle thresholds, as OPERATIONAL configuration.
 *
 * Operator instruction #7: "Make the 7-day and 30-day thresholds centrally
 * configurable rather than scattering literals through application code. These
 * lifecycle thresholds are operational configuration and must not affect
 * diagnostic scoring or the Set for Life Money Picture™."
 *
 * That last sentence is why these live in their own config file rather than in
 * `scoring-v1.0.json`: putting an operational timeout in the scoring config
 * would tie it to `scoring_engine_version`, and a change to a housekeeping
 * number would then look like a change to the engine that produced a
 * participant's report. They are deliberately separate artifacts.
 */
export interface LifecycleThresholds {
  /** Days of inactivity before an incomplete assessment is classified abandoned. */
  savedWindowDays: number;
  /** Days of inactivity after which an incomplete assessment may not be resumed. */
  expirationWindowDays: number;
}

/** Fallback thresholds, used only if the config cannot be read. */
export const DEFAULT_THRESHOLDS: LifecycleThresholds = {
  savedWindowDays: 7,
  expirationWindowDays: 30,
};

/**
 * Validate a config-supplied thresholds object.
 *
 * Falls back per-field rather than throwing: a session-classification query
 * failing outright would take down resume for every participant, which is a far
 * worse outcome than using the documented default. The malformed case is
 * surfaced by `tests/integration/assessment-lifecycle.test.ts` rather than at
 * runtime.
 *
 * Ordering is enforced. An expiration window at or below the saved window would
 * make a session expire the instant it was abandoned, skipping a state the
 * operator explicitly wants participants to pass through resumably.
 */
export function resolveThresholds(cfg: unknown): LifecycleThresholds {
  const c = cfg as { saved_window_days?: unknown; expiration_window_days?: unknown } | null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

  const savedWindowDays = num(c?.saved_window_days, DEFAULT_THRESHOLDS.savedWindowDays);
  const expirationWindowDays = num(
    c?.expiration_window_days,
    DEFAULT_THRESHOLDS.expirationWindowDays,
  );

  // Enforce the ordering the state machine depends on.
  if (expirationWindowDays <= savedWindowDays) {
    return { ...DEFAULT_THRESHOLDS };
  }
  return { savedWindowDays, expirationWindowDays };
}

/** Whole days between two instants, floored. */
export function elapsedDays(lastActivity: Date | string, now: Date): number {
  const then = typeof lastActivity === 'string' ? new Date(lastActivity) : lastActivity;
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Classify an INCOMPLETE session by how long it has been idle.
 *
 * BOUNDARY SEMANTICS, and they are the whole point of this function:
 *
 *   "< 7 full days inactive"                  → current
 *   ">= 7 days and < 30 days inactive"        → abandoned
 *   ">= 30 full days inactive"                → expired
 *
 * The operator said "7 FULL days" and "30 FULL days", and `elapsedDays` floors —
 * so exactly 7.0 days of inactivity classifies as `abandoned`, not `current`.
 * A session at 6 days 23 hours is still `current`. That is the difference
 * between "7 days" meaning seven full days and meaning seven-ish, and the
 * boundary tests pin it to the millisecond.
 */
export function classifyIdle(
  lastActivity: Date | string,
  now: Date,
  thresholds: LifecycleThresholds = DEFAULT_THRESHOLDS,
): IdleClassification {
  const days = elapsedDays(lastActivity, now);
  if (days >= thresholds.expirationWindowDays) return 'expired';
  if (days >= thresholds.savedWindowDays) return 'abandoned';
  return 'current';
}

/**
 * The status an incomplete session should hold, given its idleness.
 *
 * `current` maps to `in_progress`: within the saved window the session is simply
 * in progress, whether or not the participant used Save My Progress — the
 * operator was explicit that the 7-day rule "applies whether the participant
 * explicitly used Save My Progress or simply stopped participating".
 */
export function statusForClassification(classification: IdleClassification): LifecycleStatus {
  switch (classification) {
    case 'expired':
      return 'expired';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'in_progress';
  }
}

/**
 * MAY THIS SESSION PRODUCE A CURRENT SNAPSHOT?
 *
 * Operator instruction #3: an expired incomplete assessment "becomes historical
 * and must never subsequently produce a current Financial Snapshot."
 *
 * This is the guard that makes that true, and it exists because it was NOT true
 * before: `completeSession` read the response set and proceeded without ever
 * reading the session row's status. An expired session with 31 stored responses
 * would have completed and written a Snapshot — breaking the exact rule the
 * operator set, silently.
 *
 * A `completed` session is also refused: the Snapshot already exists, and
 * completion is a one-time transition (§22.5 — history is never rewritten).
 */
export function mayProduceSnapshot(status: string): boolean {
  // DERIVED from the refusal reason, never a second list of statuses.
  //
  // `abandoned` MAY complete, and this was `status === 'in_progress'` until the
  // response route gained its auto-resume. The two rules have to agree: if
  // answering a question resumes an abandoned session (decideResponseWrite
  // above), then a participant who resumes by answering and immediately
  // finishes arrives here with a status the sweep has not yet caught up with —
  // and refusing them with "needs to be resumed" would be telling them to do
  // the thing they just did.
  //
  // The window makes this safe: a session only stays `abandoned` while it is
  // under the expiration threshold, so completing one means answers at most
  // 30 days old — which is exactly what §2 promises is still resumable.
  return snapshotRefusalReason(status) === null;
}

/**
 * MAY THIS SESSION ACCEPT A NEW RESPONSE, AND DOES THAT RESUME IT?
 *
 * THE BUG THIS EXISTS TO FIX, found by live verification rather than by test:
 * `response/route.ts` guarded only against `completed`. It then wrote
 * `last_activity_at` WITHOUT touching `status`. So for a session the sweep had
 * classified abandoned, a participant landing straight on the assessment URL —
 * without passing through the resume route — could answer questions forever
 * while the session row still said `abandoned`, and the NEXT sweep would
 * re-abandon it, recording a second `assessment_abandoned` event for one
 * abandonment. Observed live: session e37e2d65, one abandonment counted twice.
 *
 * `expired` was worse. Those writes SUCCEEDED, bumping `last_activity_at` on a
 * session the operator's §3 says may never become a current assessment again.
 * A participant returning to a bookmarked URL could keep depositing answers
 * into a session whose only possible end is the 422 refusal — with no
 * indication anything was wrong.
 *
 * Answering a question IS resuming. Requiring a separate resume call first
 * would mean a participant who returns from a bookmark silently loses the
 * answer they just gave, which is the opposite of respecting saved progress.
 * So `abandoned` is allowed AND transitions back to `in_progress` in the same
 * write. `expired` is refused as `expired`, for the reason above.
 */
export type ResponseWriteDecision =
  | { allowed: true; resumeTo: 'in_progress' | null }
  | { allowed: false; code: 'SESSION_COMPLETE' | 'SESSION_EXPIRED'; message: string };

export function decideResponseWrite(status: string): ResponseWriteDecision {
  switch (status) {
    case 'in_progress':
      return { allowed: true, resumeTo: null };
    case 'abandoned':
      // Resumed by the act of answering. The sweep's re-abandonment is correct
      // behaviour ONLY once this returns the session to in_progress.
      return { allowed: true, resumeTo: 'in_progress' };
    case 'completed':
      return {
        allowed: false,
        code: 'SESSION_COMPLETE',
        message: 'This assessment is complete and can no longer be edited.',
      };
    case 'expired':
      return {
        allowed: false,
        code: 'SESSION_EXPIRED',
        message:
          'This assessment expired after a long period of inactivity and can no longer be edited. ' +
          'Begin a current assessment so your Money Picture reflects where you are today.',
      };
    default:
      // Unknown status: refuse rather than write. A status this code does not
      // recognise is one whose rules it cannot apply.
      return {
        allowed: false,
        code: 'SESSION_COMPLETE',
        message: `This assessment cannot be edited in its current state (${status}).`,
      };
  }
}

/**
 * Why a session may not complete, for an actionable error rather than a bare false.
 *
 * THE ALLOWED CASE IS DERIVED, NOT RE-ENUMERATED. This function is now the ONLY
 * place that answers "may this complete", and `mayProduceSnapshot` delegates to
 * it. Before that, the two were separate `switch` statements over the same
 * statuses, and they diverged the moment `abandoned` was allowed — the yes/no
 * said true while the message said "needs to be resumed". Two hand-maintained
 * copies of one rule is precisely the split the operator had removed from
 * LETTER_VALUES, recurring in the lifecycle; the fix is the same shape. A test
 * asserts the two agree across every status, so a future third copy cannot
 * appear unnoticed.
 */
export function snapshotRefusalReason(status: string): string | null {
  switch (status) {
    case 'in_progress':
    case 'abandoned':
      // Both are inside the resumable window. Nothing to refuse.
      return null;
    case 'completed':
      return 'This assessment is already complete. Its Snapshot is an immutable historical record.';
    case 'expired':
      // §3, the operator's own words: the expired session "must never
      // subsequently produce a current Financial Snapshot."
      return (
        'This assessment expired after a long period of inactivity and can no longer be completed. ' +
        'Begin a current assessment so your Money Picture reflects where you are today.'
      );
    default:
      return `This assessment cannot be completed in its current state (${status}).`;
  }
}


// ---------------------------------------------------------------------------
// Sweep planning — PURE, so it is testable without a database or a server.
//
// This lived in sweep.ts, which begins with `import "server-only"`. That is
// correct for that file — it holds the service client — but it made the
// DECISION logic unimportable by a plain test, so the state machine could
// not be exercised at the boundaries. Same extraction as option-values.ts,
// for the same reason: the part that decides belongs somewhere testable.
// ---------------------------------------------------------------------------

export interface IncompleteSession {
  session_id: string;
  participant_id: string;
  status: string;
  last_activity_at: string;
  current_position: number;
}

/**
 * Classify every incomplete session. Transitions are the caller's job.
 *
 * Separated from `runSweep` so the decision is testable without a database, and
 * so a dry run is the same code path with the writes skipped.
 */
export function planTransitions(
  sessions: IncompleteSession[],
  now: Date,
  thresholds: LifecycleThresholds,
): Array<{ session: IncompleteSession; to: 'abandoned' | 'expired'; from: string }> {
  const plan: Array<{ session: IncompleteSession; to: 'abandoned' | 'expired'; from: string }> = [];
  for (const s of sessions) {
    // Only in_progress and abandoned are eligible. `completed` is terminal and
    // the operator was explicit that no inactivity rule applies to it
    // (instruction #5). `expired` is already where it needs to be.
    if (s.status !== 'in_progress' && s.status !== 'abandoned') continue;

    const classification = classifyIdle(s.last_activity_at, now, thresholds);

    // Forward only. `current` means no change at all.
    if (classification === 'current') continue;

    // Narrow to the two transitions this sweep performs. `statusForClassification`
    // is typed to the full lifecycle because it also answers for `current`
    // (which maps to `in_progress`); here that case has already returned.
    const target: 'abandoned' | 'expired' =
      classification === 'expired' ? 'expired' : 'abandoned';

    if (target === s.status) continue;

    // NO FURTHER GUARD IS NEEDED, and that is a property of the type rather than
    // an accident. Entry statuses are only {in_progress, abandoned} (the check
    // above), and `target` is only ever {'abandoned', 'expired'}. Under the
    // ordering in_progress < abandoned < expired — which is the lifecycle's own
    // order — every reachable pair is a forward or equal move, and the equal
    // case is the `continue` immediately above.
    //
    // A defensive `if (s.status === 'abandoned' && target !== 'expired') continue`
    // was written here first. MUTATION TESTING SHOWED IT WAS DEAD: deleting it
    // left every test passing, because no input can reach it. It was removed
    // rather than kept as reassurance — an unreachable guard reads as a rule
    // being enforced and is not one, and the next person to add a status would
    // trust it to catch a case it never could.
    //
    // The forward-only property is therefore guaranteed by the TARGET SET, and
    // `assessment-lifecycle.test.ts` asserts it directly.

    plan.push({ session: s, to: target, from: s.status });
  }
  return plan;
}

