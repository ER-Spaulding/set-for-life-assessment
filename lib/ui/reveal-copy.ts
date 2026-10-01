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
// §2.3 retires SEE / ROOM / DIRECT / PREPARE / AIM / MOVE as the
// participant-facing presentation system. Nothing in this file may surface
// those tokens, and the reveal must not render the retired wheel.

export interface HumanQuestion {
  /** The participant-facing question label, e.g. "WHAT CAN YOU SEE?" */
  question: string;
  /** The one-line elaboration shown beneath it. */
  prompt: string;
}

/** §2.4 — the six human questions that organize the participant's Money Picture. */
export const SIX_HUMAN_QUESTIONS: readonly HumanQuestion[] = [
  {
    question: "WHAT CAN YOU SEE?",
    prompt: "What is visible and understandable about your financial life right now?",
  },
  {
    question: "HOW MUCH ROOM DO YOU HAVE?",
    prompt: "How much financial margin or flexibility exists after life and current obligations are handled?",
  },
  {
    question: "HOW ARE YOU MAKING DECISIONS?",
    prompt: "How intentionally can you direct the money and choices that are actually available to you?",
  },
  {
    question: "HOW PREPARED ARE YOU FOR DISRUPTION?",
    prompt: "How able is your financial life to absorb disruption and recover?",
  },
  {
    question: "WHERE ARE YOU HEADED?",
    prompt: "How clearly do today's financial decisions connect to the future you want?",
  },
  {
    question: "WHAT HAPPENS AFTER YOU KNOW?",
    prompt: "What happens when financial information reaches you - does it become evaluation, decision, and follow-through?",
  },
];

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
