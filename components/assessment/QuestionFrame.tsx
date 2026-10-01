"use client";

// UIUX §5, §10, §8 S04/S05/S06 — the question-screen shell.
//
// Assembles the eight things §5 requires, in order:
//   1 wordmark  2 divider  3 progress bar  4 progress label
//   5 question  6 helper (only when needed)  7 answer controls  8 Back/Continue
//
// §10: "Question is the visual hero. Use Playfair for the question, Inter for
// the answers. Keep maximum question width about 960–1080px desktop and full
// available width on mobile."
//
// §5 forbids, during the assessment: "domain label, score, encouragement,
// coaching, diagnostic label, or teaching copy." So nothing here names a
// signal, comments on an answer, or reacts to what was chosen.
//
// §8 S06 — a capacity-sensitive question "MUST be visually IDENTICAL to other
// questions; no hint that an override exists." That is why this component has
// no awareness of overrides at all: there is no branch to leak a hint.

import type { ReactNode } from "react";
import { BrandHeader } from "./BrandHeader";
import { ProgressBar } from "./ProgressBar";
import { HelperText } from "./HelperText";

export function QuestionFrame({
  current,
  total,
  prompt,
  helper,
  children,
  onBack,
  onContinue,
  continueDisabled,
  saving,
}: {
  current: number;
  total: number;
  prompt: string;
  /** §5 (6): only when needed. Omit for most questions. */
  helper?: string;
  children: ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  continueDisabled: boolean;
  /** Shows the quiet `Progress saved` state (§8B). */
  saving?: boolean;
}) {
  return (
    <main className="surface-ivory min-h-screen w-full px-6 py-10 sm:px-10 lg:px-16">
      {/* Max 1080px per §10; the inner prose column is narrower still so the
          question never runs to an uncomfortable line length. */}
      <div className="mx-auto w-full max-w-[1080px]">
        <BrandHeader />

        <div className="mt-8">
          <ProgressBar current={current} total={total} />
        </div>

        <h1
          className="mt-10 font-display text-evergreen"
          style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
        >
          {prompt}
        </h1>

        {helper ? <HelperText>{helper}</HelperText> : null}

        <div className="mt-10 flex flex-col gap-4">{children}</div>

        {/* §8B: no manual Save button. A valid response persists when Continue
            is pressed. The saved state is quiet — no animation, no praise. */}
        <div className="mt-10 flex items-center justify-between gap-6">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
              style={{ fontSize: "20px", lineHeight: "28px" }}
            >
              Back
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-6">
            <span
              role="status"
              aria-live="polite"
              className="font-body text-rose"
              style={{ fontSize: "16px", lineHeight: "24px" }}
            >
              {saving ? "Saving…" : ""}
            </span>
            <button
              type="button"
              onClick={onContinue}
              disabled={continueDisabled}
              className={[
                "px-8 py-4 font-serif transition-colors",
                continueDisabled
                  ? "cursor-not-allowed bg-evergreen/40 text-ivory"
                  : "bg-evergreen text-ivory hover:bg-evergreen/90",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen",
              ].join(" ")}
              style={{ fontSize: "var(--type-t13-size)", lineHeight: "var(--type-t13-line)", borderRadius: "2px", minHeight: "56px" }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
