// Addendum 01 v1.1 §2.4 — the six human questions that organize the
// participant-facing Money Picture.
//
// SINGLE SOURCE OF TRUTH. These six question labels were previously
// hand-maintained in three independent places:
//   - lib/ui/narratives.ts     SIGNAL_QUESTION_LABEL  (sentence case)
//   - lib/ui/reveal-copy.ts    SIX_HUMAN_QUESTIONS    (FULL CAPS)
//   - tests/integration/money-picture-naming.test.ts  (sentence case, hardcoded)
// They agreed only by coincidence; a §2.4 wording revision would be caught in
// one and silently missed in the others. This module is the single place the
// words live, so a wording change is made exactly once and every consumer
// follows.
//
// CASING — RESOLVED (owner's decision). The authoritative participant-facing
// wording is §2.4's FULL CAPS treatment, and those exact strings are what this
// module stores. The previous approach — store sentence case here and derive
// the caps with toUpperCase() at render — was explicitly rejected: it left the
// stored canonical strings disagreeing with the participant-facing presentation.
// Addendum 03 v1.0 §14's sentence case ("What can you see?") is NOT a competing
// canonical set; it is a PRESENTATION transform of these same words, which a
// future approved interface (e.g. a conversational Advisor Workspace) may apply
// PROGRAMMATICALLY at render time. The words are locked here, in caps, once.
//
// The prompts are verbatim from §2.4 and are checked code point for code point
// by tests/integration/reveal-copy-verbatim.test.ts.

export interface HumanQuestionSource {
  /** The internal diagnostic construct id (SEE, ROOM, …) the payload keys on. */
  signal: string;
  /** The participant-facing question label, FULL CAPS, verbatim from §2.4. */
  question: string;
  /** The one-line elaboration, verbatim from §2.4. */
  prompt: string;
}

/** §2.4's six questions, in the spec's order, FULL CAPS. */
export const HUMAN_QUESTIONS: readonly HumanQuestionSource[] = [
  {
    signal: "SEE",
    question: "WHAT CAN YOU SEE?",
    prompt: "What is visible and understandable about your financial life right now?",
  },
  {
    signal: "ROOM",
    question: "HOW MUCH ROOM DO YOU HAVE?",
    prompt: "How much financial margin or flexibility exists after life and current obligations are handled?",
  },
  {
    signal: "DIRECT",
    question: "HOW ARE YOU MAKING DECISIONS?",
    prompt: "How intentionally can you direct the money and choices that are actually available to you?",
  },
  {
    signal: "PREPARE",
    question: "HOW PREPARED ARE YOU FOR DISRUPTION?",
    prompt: "How able is your financial life to absorb disruption and recover?",
  },
  {
    signal: "AIM",
    question: "WHERE ARE YOU HEADED?",
    prompt: "How clearly do today's financial decisions connect to the future you want?",
  },
  {
    signal: "MOVE",
    question: "WHAT HAPPENS AFTER YOU KNOW?",
    prompt: "What happens when financial information reaches you - does it become evaluation, decision, and follow-through?",
  },
];
