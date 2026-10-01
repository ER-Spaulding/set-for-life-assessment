"use client";

// UIUX §8 S00, §8A — entry path selection.
//
// "One editorial screen with two equally clear choices." EQUALLY CLEAR is the
// design constraint: neither path may look like the default or the
// recommended one, so both cards share size, weight and colour. A returning
// participant is not a second-class visitor, and a first-time participant is
// not being funnelled.
//
// No iconography distinguishing them beyond the label — decorative asymmetry
// would reintroduce the hierarchy the spec just removed.

export function EntryChoice({
  onNew,
  onReturning,
}: {
  onNew: () => void;
  onReturning: () => void;
}) {
  const card =
    "flex-1 border border-blush/60 bg-white/60 px-8 py-10 text-left transition-colors hover:border-evergreen/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen";

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <button
        type="button"
        onClick={onNew}
        className={card}
        style={{ borderRadius: "2px" }}
      >
        <span
          className="block font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
        >
          NEW HERE
        </span>
        <span
          className="mt-3 block font-serif text-evergreen"
          style={{ fontSize: "var(--type-t10-size)", lineHeight: "var(--type-t10-line)" }}
        >
          Start my first assessment
        </span>
      </button>

      <button
        type="button"
        onClick={onReturning}
        className={card}
        style={{ borderRadius: "2px" }}
      >
        <span
          className="block font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
        >
          RETURNING
        </span>
        <span
          className="mt-3 block font-serif text-evergreen"
          style={{ fontSize: "var(--type-t10-size)", lineHeight: "var(--type-t10-line)" }}
        >
          Continue my Set for Life journey
        </span>
      </button>
    </div>
  );
}
