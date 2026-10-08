"use client";

// Returning participant — VERIFIED IDENTITY RECOVERY (email), not a
// memorized-identifier lookup (Owner decision, narrative-rewrite scope,
// 2026-10-07; plan D12).
//
// WHAT CHANGED AND WHY. This screen used to ask for the Set for Life Number.
// The Owner removed the number from the participant journey entirely: it is
// an INTERNAL system identifier (generation, storage, support lookup, QA —
// all preserved), but a participant completes, saves, leaves, returns,
// recovers and resumes without ever knowing it. Recovery is the verified
// contact on file, exactly as Addendum 02 §4.4 requires:
//
//   "If protected prior data/resume access is requested, perform the required
//    secure verification step using the verified contact method associated
//    with the participant."
//
// THE FLOW, END TO END (none of it new — only the entry point changed):
//   email → POST /api/auth/start-returning (byte-identical 202
//           anti-enumeration response, same as start-new) →
//   VerificationState "check your email" → the EXISTING verification callback
//   → /auth/verified → ResumeCard (resume / begin new).
//
// SO THIS SCREEN RETURNS NO PROTECTED DATA — same posture the number lookup
// had. The route answers 202 for every well-formed address, so nothing here
// can branch on whether the record exists: no name, no session, no Snapshot
// ever reaches the browser from this flow's entry step.
//
// D-1 IS UNTOUCHED. Token HMAC/purpose/TTL, signed cookies, callback routing
// and /auth/recover (claim-conflict only) are the identity layer this screen
// merely sits in front of; this file speaks to one endpoint and holds no
// credential logic.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VerificationState } from "@/components/identity/VerificationState";

// Two stages only. `malformed`/`not_found` are gone with the number input:
// start-returning answers 202 for EVERY well-formed email (anti-enumeration),
// so the only client-visible failure is a bad-shape address (400 → inline)
// or the request itself failing.
type Stage = "lookup" | "sent";

export default function ReturningPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("lookup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start-returning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.status === 400) {
        // Bad-shape address: actionable, inline, and it never leaves the form.
        setError("Enter a valid email address — the one you used for the assessment.");
        return;
      }
      if (!res.ok) {
        setError("We could not complete that just now. Try again in a moment.");
        return;
      }
      // 202 for every WELL-FORMED address — the response cannot and must not
      // say whether a record exists.
      setStage("sent");
    } catch {
      setError("We could not complete that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="surface-ivory flex min-h-screen w-full flex-col px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[1080px]">
        <p
          className="font-display text-evergreen"
          style={{ fontSize: "20px", lineHeight: "26px" }}
        >
          Set for Life
        </p>
        <div className="mt-3 w-full border-t border-blush" aria-hidden="true" />

        <div className="mt-16">
          {stage === "lookup" ? (
            <>
              <h1
                className="font-display text-evergreen"
                style={{
                  fontSize: "var(--type-t03-size)",
                  lineHeight: "var(--type-t03-line)",
                  textWrap: "balance",
                }}
              >
                Welcome back.
              </h1>
              <p
                className="prose-measure mt-4 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                Enter the email you used for your assessment and we will send a
                secure link to continue where you left off.
              </p>

              <form
                className="mt-10 flex max-w-[560px] flex-col gap-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div>
                  <label
                    htmlFor="returning-email"
                    className="block font-body text-rose"
                    style={{ fontSize: "16px", lineHeight: "24px" }}
                  >
                    Email
                  </label>
                  <input
                    id="returning-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
                    style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                  />
                  {error ? (
                    <p
                      role="alert"
                      className="mt-3 font-body text-rose"
                      style={{ fontSize: "16px", lineHeight: "24px" }}
                    >
                      {error}
                    </p>
                  ) : null}
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={busy || !email.trim().includes("@")}
                    className={[
                      "px-8 py-4 font-serif transition-colors",
                      busy || !email.trim().includes("@")
                        ? "cursor-not-allowed bg-evergreen/40 text-ivory"
                        : "bg-evergreen text-ivory hover:bg-evergreen/90",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen",
                    ].join(" ")}
                    style={{
                      fontSize: "var(--type-t13-size)",
                      lineHeight: "var(--type-t13-line)",
                      borderRadius: "2px",
                      minHeight: "56px",
                    }}
                  >
                    {busy ? "Sending…" : "Send my secure link"}
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {/* The ready-made "check your email" state — this component was
              built for exactly this moment (anti-enumeration wording, no
              branch on whether the address is known) and was dead code until
              this rebuild revived it. Its own copy, verbatim. */}
          {stage === "sent" ? <VerificationState email={email.trim()} /> : null}

          {/*
            TAP TARGET. This rendered at 38x28px — measured, not guessed, by the
            320px device harness (tests/qa/viewport-320.mjs), which failed this
            route on its first run. A 28px-tall control is a control a thumb
            misses, and this one is the ONLY way off a dead-end screen.

            The fix is padding plus the same 56px minimum the primary buttons
            use, rather than a larger font: the visual weight of a secondary
            action should stay secondary while its HIT AREA does not. `inline-flex`
            + `max-w-full` keeps it from overflowing at 320px, and the text is
            free to wrap onto two lines rather than being clipped.
          */}
          <button
            type="button"
            onClick={() =>
              stage === "lookup" ? router.push("/assessment/start") : setStage("lookup")
            }
            className="mt-10 inline-flex max-w-full items-center rounded-sm px-3 py-4 font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{ fontSize: "20px", lineHeight: "28px", minHeight: "56px" }}
          >
            {stage === "lookup" ? "Back" : "Try a different email"}
          </button>
        </div>
      </div>
    </main>
  );
}
