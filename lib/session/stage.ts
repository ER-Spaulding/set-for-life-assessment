// Where did the participant stop? A controlled stage identifier, from POSITION.
//
// Operator instruction #8:
//   "Preserve the last meaningful assessment position for funnel analysis using
//    controlled identifiers such as: Q08, MM02, Q17, ACTIVATION, DEMOGRAPHICS.
//    Do not copy actual answers or sensitive financial response content into
//    analytics events."
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: a stage identifier is derived from HOW
// FAR the participant got, never from WHAT they said. It is computed from a
// position integer and the instrument's own ordering, and it has no access to a
// response value — there is no parameter through which an answer could arrive,
// which is a stronger guarantee than promising not to look at one.
//
// The identifiers are a CLOSED SET drawn from the instrument itself: question
// ids, Money Moment ids, and the two non-question phases. That is what makes
// them safe to put in an analytics payload — a closed vocabulary cannot smuggle
// content, the same reason the payload allow-list is an allow-list.
//
// PURE. No I/O. The instrument order is passed in by the caller so this module
// has no config dependency and can be tested against a synthetic instrument.

/** A controlled stage identifier. Closed by construction — see `stageAt`. */
export type StageIdentifier = string;

/** One Money Moment's placement, in the same coordinates as `sequenceIndex`. */
export interface MomentPlacement {
  id: string;
  /** The sequence index this moment fires AFTER. */
  afterSequenceIndex: number;
}

export interface StageInputs {
  /** The full administered sequence of item ids, in presentation order. */
  sequence: readonly string[];
  /** How many required items the participant has completed. */
  completedCount: number;
  /** Money Moments, positioned in sequence coordinates. */
  moments: readonly MomentPlacement[];
  /** Index at which the activation block begins, if the participant reached it. */
  activationStartIndex: number;
}

/**
 * The label for a participant who has answered nothing yet.
 *
 * Not an empty string: "they opened the assessment and stopped before the first
 * question" is a real funnel stage, and collapsing it into `undefined` would make
 * it indistinguishable from "we do not know".
 */
export const STAGE_OPENING = 'OPENING';

/** The label once every required item is answered but the Snapshot is not yet written. */
export const STAGE_COMPLETE = 'COMPLETE';

/**
 * The stage a participant is AT, given how far they got.
 *
 * Returns the identifier of the item they are ABOUT to answer — i.e. where they
 * stopped. A participant who answered through index 4 is "at" index 5, because
 * the next thing they would see is that item. That is the useful framing for
 * funnel analysis: "where do they stop" means "what were they looking at".
 *
 * The Money Moment check comes FIRST, because a moment fires between two
 * questions — a participant who stopped at a moment stopped at the moment, not
 * at the question after it.
 */
export function stageAt(input: StageInputs): StageIdentifier {
  const { sequence, completedCount, moments, activationStartIndex } = input;

  if (completedCount <= 0) return STAGE_OPENING;
  if (completedCount >= sequence.length) return STAGE_COMPLETE;

  // A Money Moment immediately before the next item is what they were viewing.
  const nextIndex = completedCount;
  const momentHere = moments.find((m) => m.afterSequenceIndex === completedCount - 1);
  if (momentHere) return momentHere.id;

  // The activation block is a phase, not a question — labelled as such so the
  // funnel distinguishes "stopped mid-diagnostics" from "reached activation".
  if (nextIndex === activationStartIndex) return 'ACTIVATION';

  // Otherwise the next item's own id: Q08, Q17, OPEN_A, and so on. These are
  // instrument identifiers, which the participant already sees in the URL-free
  // question flow — they name a POSITION, not a response.
  return sequence[nextIndex] ?? STAGE_COMPLETE;
}

/**
 * The stage identifier for a stored session, given its `current_position`.
 *
 * `current_position` is 1-based and counts required items ANSWERED (it starts at
 * 1 for a fresh session). This converts to the 0-based completed count that
 * `stageAt` expects, so the two representations cannot drift.
 */
export function stageForPosition(
  currentPosition: number,
  inputs: Omit<StageInputs, 'completedCount'>,
): StageIdentifier {
  const completed = Math.max(0, currentPosition - 1);
  return stageAt({ ...inputs, completedCount: completed });
}
