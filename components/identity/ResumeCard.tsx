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
  /**
   * The participant's first name, or null when it is not verified.
   *
   * NOT `firstName || "there"`. That fallback shipped, and because the caller's
   * state was never populated it fired for every participant — every returning
   * participant was greeted "Welcome back, there." A placeholder that occupies
   * the name slot reads as a name and satisfies nobody: §4.1 asks for a
   * first-name welcome, and a wrong greeting is worse than no name at all.
   *
   * When the name is null the heading simply omits it, which is still warm and
   * still true.
   */
  firstName: string | null;
  inProgress: { responsesSaved: number; total: number } | null;
  onContinue: () => void;
  onStartNew: () => void;
}) {
  const name = firstName?.trim() ? `, ${firstName.trim()}` : "";
  const heading = inProgress
    ? `Welcome back${name}. You have an assessment in progress.`
    : `Welcome back${name}. Ready to see what has changed?`;

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
