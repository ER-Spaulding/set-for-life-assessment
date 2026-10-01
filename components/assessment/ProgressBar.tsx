// UIUX §5 (3)–(4) — neutral progress bar + progress label.
//
// "Neutral progress bar" and "small progress label such as `12 OF 31`".
//
// NEUTRAL is the operative word. The bar shows only how far along someone is;
// it must not colour-code progress, change hue as the participant advances,
// or imply that reaching the end is good news. The copy is factual (UIUX §8A:
// "show progress factually ... without gamification") and there is no
// animation or praise anywhere in this component.

export function ProgressBar({
  current,
  total,
}: {
  /** 1-based position of the question being answered. */
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

  return (
    <div className="w-full">
      <p
        className="font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px" }}
      >
        {current} OF {total}
      </p>
      {/* A native progress element, not a styled div: it carries the value
          semantics for assistive technology for free, and a screen reader
          announces progress rather than reading a decorative bar as nothing.
          `aria-valuetext` states the label in words, matching what is shown. */}
      <progress
        className="mt-2 h-1 w-full appearance-none [&::-webkit-progress-bar]:bg-blush [&::-webkit-progress-value]:bg-evergreen [&::-moz-progress-bar]:bg-evergreen"
        value={current}
        max={total}
        aria-valuetext={`${current} of ${total} answered`}
      />
      <span className="sr-only">
        {pct.toFixed(0)} percent complete
      </span>
    </div>
  );
}
