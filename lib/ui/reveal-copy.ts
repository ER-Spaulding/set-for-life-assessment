// PRD Addendum 01 v1.1 §2.1, §2.4, §4 — the synthesis reveal's locked copy.
//
// GENERATED CONTENT, DO NOT HAND-EDIT THE STRINGS.
//
// Every string below was extracted programmatically from the authoritative
// Addendum 01 v1.1 source rather than typed, because this is locked instrument
// copy and a transcription slip is a content defect. Verified byte-for-byte
// against both the .md and the .docx:
//
//   frame3 is ONE string ending in a period (not "...FOCUS." + a second sentence)
//   cta uses ASCII hyphen-greater "->" as written in the source
//   hold uses three ASCII dots, NOT a U+2026 ellipsis
//
// The six §2.4 human questions are the one exception to "strings live here":
// they moved to lib/ui/human-questions.ts (single source of truth), and
// SIX_HUMAN_QUESTIONS below is DERIVED from them verbatim — the source stores
// them FULL CAPS (the resolved casing), so no casing transform is applied here.
// The prompts remain verbatim from §2.4.
//
// §2.3 retires SEE / ROOM / DIRECT / PREPARE / AIM / MOVE as the
// participant-facing presentation system. Nothing in this file may surface
// those tokens, and the reveal must not render the retired wheel.

import { HUMAN_QUESTIONS } from "./human-questions";

export interface HumanQuestion {
  /** The participant-facing question label, FULL CAPS, verbatim from §2.4. */
  question: string;
  /** The one-line elaboration shown beneath it. */
  prompt: string;
}

/**
 * §2.4 — the six human questions that organize the participant's Money Picture.
 *
 * The words are NOT duplicated here: this array is derived from the single
 * source of truth, lib/ui/human-questions.ts. The source stores the labels in
 * §2.4's FULL CAPS wording (the resolved casing), so the reveal presents them
 * verbatim — no casing transform. Addendum 03 §14's sentence case is a
 * presentation transform of these same words, not a competing canonical set.
 */
export const SIX_HUMAN_QUESTIONS: readonly HumanQuestion[] = HUMAN_QUESTIONS.map(
  (q) => ({ question: q.question, prompt: q.prompt }),
);

/** §4.1 — the creative territory. */
export const CREATIVE_TERRITORY = "THE PICTURE COMES INTO FOCUS";

/** §2.1 — the core branded idea, and the reveal's load-bearing line. */
export const CORE_IDEA = "ONE ANSWER IS A DETAIL. TOGETHER, THEY MAKE A PICTURE.";

/** §2.1 — the visual center of the Money Picture. Not the logo, not a score. */
export const MONEY_PICTURE_CENTER = "YOU";

/** §4.2 FRAME 1 — a single visual point/detail appears. */
export const FRAME_1 = "ONE ANSWER IS A DETAIL.";

/** §4.2 FRAME 2 — additional points appear and organize. */
export const FRAME_2 = "TOGETHER, THEY MAKE A PICTURE.";

/** §4.2 FRAME 3 — relationships become visible; resolves around YOU. */
export const FRAME_3 = "YOUR FINANCIAL PICTURE IS COMING INTO FOCUS.";

/**
 * §4.2 FRAME 5 — the completion line.
 *
 * `{First Name}` is REQUIRED here but the name is CONDITIONAL: §12 requires
 * the first name "in the final reveal when identity is known", and Addendum 02
 * §3.2/§15 forbid using a name before it has been reliably associated with the
 * participant. When it is not known, the sentence renders WITHOUT the prefix —
 * the name is dropped, not replaced with placeholder text. No new copy is
 * authored for the nameless case.
 */
export const FRAME_5_TEMPLATE = "{First Name}, your Financial Snapshot is ready.";

/** §4.2 FRAME 5 — the call to action. */
export const REVEAL_CTA = "SEE MY FINANCIAL PICTURE ->";

/** §4.4 — the honest hold state when real server work outlasts the sequence. */
export const HOLD_STATE = "Finishing your Financial Snapshot...";

/** Resolve FRAME 5 for a participant whose first name is (or is not) known. */
export function frame5(firstName: string | null): string {
  if (!firstName) return FRAME_5_TEMPLATE.replace('{First Name}, ', '');
  return FRAME_5_TEMPLATE.replace('{First Name}', firstName);
}
