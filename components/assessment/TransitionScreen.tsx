"use client";

// UIUX §8 S07 / S09 — transition screens.
//
// A quiet beat between sections, not a celebration. §25 asks for editorial
// restraint, and §8B forbids gamification, so this is a single statement with
// a single action and no progress indicator.
//
// The statement is passed in rather than hardcoded: S07 uses "You're almost
// there…" before the activation questions, and S09 uses the demographics
// transition. Keeping one component means the two cannot drift apart visually.

export function TransitionScreen({
  statement,
  onContinue,
}: {
  statement: string;
  onContinue: () => void;
}) {
  return (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px] text-center">
        <p
          className="font-display text-evergreen"
          style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
        >
          {statement}
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-10 bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          Continue
        </button>
      </div>
    </main>
  );
}
