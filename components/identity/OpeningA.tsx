"use client";

// Opening A — the first meaningful participant interaction.
//
// Addendum 02 v1.1 §2:
//   "The first meaningful question must be:
//      Is this your first time taking the Set for Life Financial Assessment?
//        - Yes
//        - No
//    This is Opening A and remains required/unscored."
//
// §5: "Opening A is self-reported first-time/returning status and remains
// separate from system-known assessment count."
//
// That last sentence is why this asks rather than infers. The system usually
// KNOWS whether a participant has a prior session, and inferring would avoid the
// question — but the spec keeps it as a deliberate, separate fact, so a returning
// participant can take a fresh assessment and still be routed as returning. The
// answer changes ROUTING, never scoring: Opening A is unscored and no signal
// reads it.
//
// NOTHING IS COLLECTED BEFORE THIS. No name, no email, no verification. §2 is
// explicit that those must not precede it, and the previous flow did exactly
// that — which is the friction the operator reported.

export function OpeningA({
  onFirstTime,
  onReturning,
  busy = false,
}: {
  onFirstTime: () => void;
  onReturning: () => void;
  busy?: boolean;
}) {
  const options = [
    { label: "Yes", onSelect: onFirstTime },
    { label: "No", onSelect: onReturning },
  ];

  return (
    <div>
      <h1
        className="font-display text-evergreen"
        style={{
          fontSize: "var(--type-t03-size)",
          lineHeight: "var(--type-t03-line)",
          textWrap: "balance",
        }}
      >
        Is this your first time taking the Set for Life Financial Assessment?
      </h1>

      <div className="mt-10 flex max-w-[560px] flex-col gap-3">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={busy}
            onClick={o.onSelect}
            className={[
              "w-full border px-5 py-4 text-left font-body transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen",
              busy
                ? "cursor-not-allowed border-blush/40 text-obsidian/50"
                : "border-blush/60 bg-white text-obsidian hover:border-evergreen hover:bg-ivory",
            ].join(" ")}
            style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px", minHeight: "56px" }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {busy ? (
        <p
          className="mt-6 font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          Starting your assessment…
        </p>
      ) : null}
    </div>
  );
}

export default OpeningA;
