"use client";

// The front door — Addendum 02 v1.1 §2.
//
// §2 corrects the sequence, and the correction is the whole point of this file:
//
//   "The currently implemented sequence - collect full name + email -> send
//    email link -> return to app -> ask first-time/returning - is NOT the
//    approved participant experience.
//
//    The first meaningful question must be: Is this your first time taking the
//    Set for Life Financial Assessment?
//
//    Do not require full name, email verification, or a magic-link round trip
//    before a first-time participant can answer this question and begin."
//
// So this screen asks ONE question and then gets out of the way. Opening A is
// performed here and its answer is carried into the session as the real OPEN_A
// response, so the instrument still receives all 31 responses and the participant
// is never asked the same thing twice — which was the specific friction the
// operator reported (L-01).
//
// WHAT DISAPPEARED FROM THIS ROUTE: the identity form, the returning-email form,
// and the "we sent you a link" state. Identity is now collected ONLY if the
// participant chooses Save My Progress after Money Moment 01 (§3), and the
// returning path is reached through the Set for Life Number, not an email.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OpeningA } from "@/components/identity/OpeningA";

export default function StartPage() {
  const router = useRouter();
  const [starting, setStarting] = useState<"first-time" | "returning" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * First-time (§3): create the provisional participant and go straight in.
   *
   * Opening A's answer travels as a query parameter so the session screen can
   * record it as the OPEN_A response without asking again. It is a UI hint about
   * which branch the participant took — not a scoring input, and not trusted for
   * anything but routing. The response itself is validated server-side like every
   * other answer (§23.5).
   */
  async function beginFirstTime() {
    setStarting("first-time");
    setError(null);
    try {
      const res = await fetch("/api/participant/provisional", { method: "POST" });
      if (!res.ok) {
        setError("We could not start your assessment just now. Please try again.");
        setStarting(null);
        return;
      }
      const data = (await res.json()) as {
        participantId: string;
        sessionId: string;
        sflNumber: string;
      };
      // The Set for Life Number is shown AFTER Opening B (§3: it is offered at
      // the Save My Progress moment), so it is carried rather than displayed
      // here. Stashing it in sessionStorage keeps it available across the first
      // few screens without putting a durable identifier in the URL, where it
      // would end up in browser history and any referrer header.
      try {
        window.sessionStorage.setItem(
          "sfl_provisional",
          JSON.stringify({
            participantId: data.participantId,
            sflNumber: data.sflNumber,
          }),
        );
      } catch {
        /* private mode: the participant can still complete; they just will not
           see the number offered again until they claim */
      }
      router.push(`/assessment/${data.sessionId}?openingA=yes`);
    } catch {
      setError("We could not start your assessment just now. Please try again.");
      setStarting(null);
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
          <OpeningA
            busy={starting !== null}
            onFirstTime={() => void beginFirstTime()}
            onReturning={() => router.push("/assessment/returning")}
          />

          {error ? (
            <p
              role="alert"
              className="mt-8 font-body text-rose"
              style={{ fontSize: "16px", lineHeight: "24px" }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
