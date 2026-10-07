"use client";

// D-1 RECOVERY SCREEN — the participant's choice after proving they own an
// address that already has a record.
//
// WHY THIS SCREEN EXISTS AT ALL, rather than the callback deciding. Two sittings
// may be involved: the one happening now, anonymously, and one already saved
// under this identity. Owner policy 2026-10-06 is explicit that those must never
// be blended silently — they are different points in time, and the Snapshot is
// scored from whichever session the participant completes, so a silent blend
// would produce a report neither sitting actually produced. So the participant
// is asked, and asked once, here.
//
// COPY IS THE OWNER'S, VERBATIM. Two cases, two sentences — no shared generic
// sentence, and no additional explanatory or marketing copy. The button labels
// are the owner's, in the owner's capitalisation.
//
// THE WRITE HAPPENS ON THE PRESS, never on load. A verification link can be
// prefetched by a mail client or a scanner; this screen is what makes the
// decision an act rather than a side effect of the link being opened.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { kind: "loading" }
  | { kind: "choose"; savedAnswers: number | null; todayAnswers: number }
  | { kind: "simple"; todayAnswers: number }
  | { kind: "deciding" }
  | { kind: "error"; message: string };

export default function RecoverPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/participant/recover", { cache: "no-store" });
        if (!res.ok) {
          if (alive) {
            setState({
              kind: "error",
              message: "We could not check your saved assessment. Please start again.",
            });
          }
          return;
        }
        const data = (await res.json()) as {
          hasSavedSession: boolean;
          savedSessionId: string | null;
          pendingAnswers: number;
        };
        if (!alive) return;

        // CASE 2 (Owner policy): a saved assessment already exists, so the two
        // sets must not be blended — ask which one to continue.
        if (data.hasSavedSession) {
          setState({
            kind: "choose",
            savedAnswers: null,
            todayAnswers: data.pendingAnswers,
          });
          return;
        }
        // CASE 1: nothing saved, so today's answers simply carry forward and
        // the participant continues without being asked a question that has
        // only one sensible answer.
        setState({ kind: "simple", todayAnswers: data.pendingAnswers });
      } catch {
        if (alive) {
          setState({
            kind: "error",
            message: "We could not check your saved assessment. Please start again.",
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const decide = useCallback(
    async (action: "resume" | "carry_forward") => {
      setState({ kind: "deciding" });
      try {
        const res = await fetch("/api/participant/recover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          setState({
            kind: "error",
            message: "We could not continue just now. Please try again.",
          });
          return;
        }
        const data = (await res.json()) as { sessionId: string };
        // The destination session is the ONE the participant continues in —
        // there is no second candidate, so no ambiguity about which is "the"
        // active assessment.
        router.replace(`/assessment/${data.sessionId}`);
      } catch {
        setState({
          kind: "error",
          message: "We could not continue just now. Please try again.",
        });
      }
    },
    [router],
  );

  const shell = (children: React.ReactNode) => (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px]">{children}</div>
    </main>
  );

  const heading = (text: string) => (
    <h1
      className="font-display text-evergreen"
      style={{
        fontSize: "var(--type-t03-size)",
        lineHeight: "var(--type-t03-line)",
        textWrap: "balance",
      }}
    >
      {text}
    </h1>
  );

  const button = (
    label: string,
    onClick: () => void,
    opts: { busy: boolean; primary?: boolean },
  ) => (
    <button
      type="button"
      disabled={opts.busy}
      onClick={onClick}
      className={[
        "w-full border px-5 py-4 text-left font-body transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen",
        opts.busy
          ? "cursor-not-allowed border-blush/40 text-obsidian/50"
          : opts.primary === false
            ? "border-blush/60 bg-white text-obsidian hover:border-evergreen hover:bg-ivory"
            : "border-evergreen bg-evergreen text-ivory hover:bg-evergreen/90",
      ].join(" ")}
      style={{
        borderRadius: "2px",
        fontSize: "18px",
        lineHeight: "29px",
        minHeight: "56px",
      }}
    >
      {label}
    </button>
  );

  if (state.kind === "loading") {
    return shell(
      <p className="font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
        Checking your saved assessment…
      </p>,
    );
  }

  if (state.kind === "error") {
    return shell(
      <>
        {heading("Something went wrong.")}
        <p
          role="alert"
          className="prose-measure mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {state.message}
        </p>
      </>,
    );
  }

  // CASE 1 — no saved assessment, so there is nothing to choose between.
  if (state.kind === "simple") {
    return shell(
      <>
        {heading(
          "You’re verified. We brought forward the answers you entered today so you can continue where you left off.",
        )}
        <div className="mt-10 flex max-w-[560px] flex-col gap-3">
          {button("CONTINUE", () => void decide("carry_forward"), { busy: false })}
        </div>
      </>,
    );
  }

  const busy = state.kind === "deciding";
  return shell(
    <>
      {heading("You already have a saved assessment. Which would you like to continue?")}
      <div className="mt-10 flex max-w-[560px] flex-col gap-3">
        {button("RESUME MY SAVED ASSESSMENT", () => void decide("resume"), { busy })}
        {button("CONTINUE WITH TODAY’S ANSWERS", () => void decide("carry_forward"), {
          busy,
          primary: false,
        })}
      </div>
    </>,
  );
}
