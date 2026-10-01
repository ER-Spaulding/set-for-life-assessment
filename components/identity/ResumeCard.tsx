"use client";

// UIUX §8A — the resume / welcome-back choice.
//
// "After verification: unfinished session → `Welcome back, {first_name}. You
// have an assessment in progress.` + `Continue where I left off`; no unfinished
// session → `Welcome back, {first_name}. Ready to see what has changed?` +
// `Begin a new assessment`."
//
// The two states are a real fork, not a nicety: a participant with an
// unfinished session who clicks "begin new" would abandon answers they already
// gave, so the in-progress path is presented first and named plainly.
//
// Progress shown factually (§8A: "17 of 31 responses saved"), never as a
// percentage-to-goal or with encouragement.

export function ResumeCard({
  firstName,
  inProgress,
  onContinue,
  onStartNew,
}: {
  firstName: string;
  inProgress: { responsesSaved: number; total: number } | null;
  onContinue: () => void;
  onStartNew: () => void;
}) {
  const heading = inProgress
    ? `Welcome back, ${firstName}. You have an assessment in progress.`
    : `Welcome back, ${firstName}. Ready to see what has changed?`;

  const primary =
    "px-8 py-4 font-serif transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen";

  return (
    <div className="max-w-[720px]">
      <p
        className="font-display text-evergreen"
        style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
      >
        {heading}
      </p>

      {inProgress ? (
        <p
          className="mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {inProgress.responsesSaved} of {inProgress.total} responses saved.
        </p>
      ) : null}

      <div className="mt-10 flex flex-wrap items-center gap-6">
        {inProgress ? (
          <button
            type="button"
            onClick={onContinue}
            className={`${primary} bg-evergreen text-ivory hover:bg-evergreen/90`}
            style={{
              fontSize: "var(--type-t13-size)",
              lineHeight: "var(--type-t13-line)",
              borderRadius: "2px",
              minHeight: "56px",
            }}
          >
            Continue where I left off
          </button>
        ) : null}

        <button
          type="button"
          onClick={onStartNew}
          className={`${primary} ${inProgress ? "text-rose underline-offset-4 hover:underline" : "bg-evergreen text-ivory hover:bg-evergreen/90"}`}
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          Begin a new assessment
        </button>
      </div>
    </div>
  );
}
