"use client";

// UIUX §8 S00/S00A/S00B, §8A — the identity fork.
//
// A three-step client flow on one route: choose entry path → collect identity
// → wait for verification. Keeping it on one route means Back is a local state
// change rather than a navigation, so a participant who mistypes an email does
// not lose what they already entered.
//
// ANTI-ENUMERATION (§7.3). The verification step renders the SAME screen for a
// brand-new address and one that already has a participant record — that is why
// `VerificationState` takes no "is this new?" input. See that component.
//
// SESSION STORAGE: after verification the callback sets an `sfl_pid` cookie.
// This screen does not write it — `app/auth/callback/route.ts` does — so the
// participant id is only ever stored as a result of a server-verified link.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntryChoice } from "@/components/identity/EntryChoice";
import { IdentityForm } from "@/components/identity/IdentityForm";
import { VerificationState } from "@/components/identity/VerificationState";

type Step = "entry" | "identity" | "returning" | "sent";

export default function StartPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("entry");
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | undefined>(undefined);

  async function startVerification(email: string, returning: boolean) {
    setSubmitting(true);
    try {
      // Both routes return an identical 202 for every address, so there is
      // nothing here to branch on — by design.
      await fetch(
        returning ? "/api/auth/start-returning" : "/api/auth/start-new",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      setSentTo(email);
      setStep("sent");
    } catch {
      // A transport failure must not reveal anything either, so the same
      // screen is shown. The participant can retry by going back.
      setSentTo(email);
      setStep("sent");
    } finally {
      setSubmitting(false);
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
          {step === "entry" ? (
            <>
              <h1
                className="mb-10 font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                Where would you like to begin?
              </h1>
              <EntryChoice
                onNew={() => setStep("identity")}
                onReturning={() => setStep("returning")}
              />
            </>
          ) : null}

          {step === "identity" ? (
            <>
              <h1
                className="mb-4 font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                Let&rsquo;s start with you.
              </h1>
              <p
                className="prose-measure mb-10 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                Your assessment and your Financial Snapshot are kept under your
                own record, so you can return to them later.
              </p>
              <IdentityForm
                submitting={submitting}
                onSubmit={({ email }) => void startVerification(email, false)}
              />
              <button
                type="button"
                onClick={() => setStep("entry")}
                className="mt-8 font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
                style={{ fontSize: "20px", lineHeight: "28px" }}
              >
                Back
              </button>
            </>
          ) : null}

          {step === "returning" ? (
            <>
              <h1
                className="mb-4 font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                Welcome back.
              </h1>
              <p
                className="prose-measure mb-10 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                Enter the email you used before. We will send a secure link so
                you can pick up where you left off.
              </p>
              <ReturningForm
                submitting={submitting}
                onSubmit={(email) => void startVerification(email, true)}
              />
              <button
                type="button"
                onClick={() => setStep("entry")}
                className="mt-8 font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
                style={{ fontSize: "20px", lineHeight: "28px" }}
              >
                Back
              </button>
            </>
          ) : null}

          {step === "sent" ? <VerificationState email={sentTo} /> : null}
        </div>

        {step !== "sent" ? (
          <p
            className="mt-24 font-body text-rose"
            style={{ fontSize: "16px", lineHeight: "24px" }}
          >
            Already verified on this device?{" "}
            <button
              type="button"
              className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
              onClick={() => router.push("/assessment/new")}
            >
              Continue
            </button>
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** The returning-participant email capture. One field, one action. */
function ReturningForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (email: string) => void;
  submitting?: boolean;
}) {
  const [email, setEmail] = useState("");
  const ready = email.trim().includes("@");

  return (
    <form
      className="flex max-w-[560px] flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !submitting) onSubmit(email.trim());
      }}
    >
      <div>
        <label
          className="block font-body text-rose"
          htmlFor="returning-email"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          Email
        </label>
        <input
          id="returning-email"
          name="email"
          type="email"
          autoComplete="email"
          className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
          style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={!ready || submitting}
          className={[
            "px-8 py-4 font-serif transition-colors",
            !ready || submitting
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
          {submitting ? "Sending…" : "Send my link"}
        </button>
      </div>
    </form>
  );
}
