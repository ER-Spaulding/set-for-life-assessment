"use client";

// Save My Progress — Addendum 02 v1.1 §3.1, §3.4, §14.
//
// Offered after Money Moment 01 (§3.4). The participant has answered five
// questions and is now offered a way to not lose that.
//
// §3.1 is explicit about the FRAMING, and it is the reason this screen is
// worded the way it is:
//
//   "Do not frame identity collection as the price of admission."
//
// So the second CTA is a genuine, equal option — not a grey "skip" link. A
// participant who declines loses nothing they have already been given: their
// answers are already stored against the provisional participant, and they keep
// answering in the same session. What they give up is only the ability to
// retrieve it from another device (§14: "cross-device/long-term resume requires
// identity claim/verification").
//
// §14 ALSO FORBIDS A FALSE PROMISE, and that constrains the DECLINE path's
// wording: "choosing Keep Going Without Saving must not falsely promise
// recoverability after clearing browser/session state." So the decline path is
// not described as "saved" anywhere — because it is not recoverable if the
// browser state goes.
//
// TWO STAGES:
//   offer    — the §3.1 copy and its two CTAs
//   claimed  — first name + email collected, verification sent: a governed
//              "check your email" confirmation (config saveMyProgress.sent).
//
// NO IDENTIFIER IS SHOWN HERE ANYMORE (Owner decision, narrative-rewrite
// scope, 2026-10-07): the Set for Life Number is internal-system-only, so the
// claimed screen confirms the EMAIL verification flow instead. Recovery is
// verified identity (§4.4), never something the participant memorizes.

import { useState } from "react";
import saveMyProgress from "../../config/interstitial-v1.0.json";

const COPY = saveMyProgress.saveMyProgress;

export function SaveMyProgress({
  onKeepGoing,
  onClaim,
  claimed = false,
  sending = false,
  error = null,
}: {
  /** "KEEP GOING WITHOUT SAVING" — continue in the current session. */
  onKeepGoing: () => void;
  /** "SAVE MY PROGRESS" — collect identity and verify. */
  onClaim: (firstName: string, email: string) => void;
  claimed?: boolean;
  sending?: boolean;
  error?: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");

  if (claimed) {
    return (
      <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-[720px]">
          <p
            className="font-body uppercase text-rose"
            style={{ fontSize: "16px", lineHeight: "24px", fontWeight: 600, letterSpacing: "0.14em" }}
          >
            {COPY.sent.label}
          </p>
          {COPY.sent.body.map((line: string, i: number) => (
            <p
              key={i}
              className="prose-measure mt-5 font-body text-obsidian"
              style={{ fontSize: "18px", lineHeight: "29px" }}
            >
              {line}
            </p>
          ))}

          <button
            type="button"
            onClick={onKeepGoing}
            className="mt-10 bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{
              fontSize: "var(--type-t13-size)",
              lineHeight: "var(--type-t13-line)",
              borderRadius: "2px",
              minHeight: "56px",
            }}
          >
            {COPY.sent.cta}
          </button>
        </div>
      </main>
    );
  }

  const ready = firstName.trim().length > 0 && email.trim().includes("@");

  return (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px]">
        <h1
          className="font-display text-evergreen"
          style={{
            fontSize: "var(--type-t04-size)",
            lineHeight: "var(--type-t04-line)",
            textWrap: "balance",
          }}
        >
          {COPY.headline}
        </h1>

        {COPY.body.map((line, i) => (
          <p
            key={i}
            className="prose-measure mt-4 font-body text-obsidian"
            style={{ fontSize: "18px", lineHeight: "29px" }}
          >
            {line}
          </p>
        ))}

        <form
          className="mt-8 flex max-w-[560px] flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !sending) onClaim(firstName.trim(), email.trim());
          }}
        >
          <div>
            <label
              htmlFor="smp-first-name"
              className="block font-body text-rose"
              style={{ fontSize: "16px", lineHeight: "24px" }}
            >
              First name
            </label>
            <input
              id="smp-first-name"
              name="firstName"
              type="text"
              autoComplete="given-name"
              className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
              style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="smp-email"
              className="block font-body text-rose"
              style={{ fontSize: "16px", lineHeight: "24px" }}
            >
              Email
            </label>
            <input
              id="smp-email"
              name="email"
              type="email"
              autoComplete="email"
              className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
              style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={!ready || sending}
              className={[
                "px-8 py-4 font-serif transition-colors",
                !ready || sending
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
              {sending ? "Saving…" : COPY.primaryCta}
            </button>

            {/* The equal, always-available alternative. §3.1 forbids framing
                identity as the price of admission, so this is a real button
                rather than a buried link. */}
            <button
              type="button"
              onClick={onKeepGoing}
              className="font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
              style={{ fontSize: "20px", lineHeight: "28px", minHeight: "44px" }}
            >
              {COPY.secondaryCta}
            </button>
          </div>
        </form>

        {error ? (
          <p
            role="alert"
            className="mt-4 font-body text-rose"
            style={{ fontSize: "16px", lineHeight: "24px" }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default SaveMyProgress;
