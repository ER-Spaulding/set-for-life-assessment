"use client";

// Returning participant — Set for Life Number lookup, then verification.
//
// Addendum 02 v1.1 §4:
//   "1. Ask for the participant's Grease the Wheel number as the returning
//       lookup identifier.
//    2. Use the number to locate the participant record/session association.
//    3. Do NOT treat the Grease the Wheel number alone as sufficient
//       authentication for access to prior sensitive assessment responses or
//       Snapshots.
//    4. If protected prior data/resume access is requested, perform the required
//       secure verification step using the verified contact method associated
//       with the participant."
//
// §4.2 states the rule flatly: "The Grease the Wheel number is a lookup/routing
// identifier, not a password. A participant must never gain access to another
// person's prior financial assessment or Snapshot solely by entering a
// known/guessed number."
//
// SO THIS SCREEN RETURNS NO PROTECTED DATA. The lookup tells the participant
// whether the number is valid and, if so, triggers a verification message to the
// contact already on file. What comes back to the browser is a message about
// what happens NEXT — never a name, never a session, never a Snapshot. The
// server refuses to resolve a number into participant data here at all, which is
// why there is no branch in this file that could render one.
//
// Participant-facing label is "Your Set for Life Number" (#4's internal "Grease
// the Wheel" term never reaches a participant).

import { useState } from "react";
import { useRouter } from "next/navigation";

type Stage = "lookup" | "sent" | "malformed" | "not_found";

export default function ReturningPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<Stage>("lookup");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sflNumber: value.trim() }),
      });

      // The route distinguishes MALFORMED from NOT_FOUND deliberately. A
      // mistyped number is actionable ("check the number") while "no record"
      // reads as "your record is gone" — conflating them is how a participant
      // concludes their data was lost.
      if (res.status === 400) {
        setStage("malformed");
        return;
      }
      if (res.status === 404) {
        setStage("not_found");
        return;
      }
      if (!res.ok) {
        setStage("not_found");
        return;
      }
      // 202 for every WELL-FORMED number, matching the anti-enumeration posture
      // of the existing verification routes: the response does not reveal
      // whether the record exists.
      setStage("sent");
    } catch {
      setStage("not_found");
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
                Enter your Set for Life Number and we will send a secure link to
                the contact we have on file.
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
                    htmlFor="sfl-number"
                    className="block font-body text-rose"
                    style={{ fontSize: "16px", lineHeight: "24px" }}
                  >
                    Your Set for Life Number
                  </label>
                  <input
                    id="sfl-number"
                    name="sflNumber"
                    // Not type=email/number: the value is a formatted identifier
                    // and the input normalises case, dashes and spaces server
                    // side, so a participant typing it however they remember it
                    // still resolves.
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX"
                    className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
                    style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={busy || value.trim().length === 0}
                    className={[
                      "px-8 py-4 font-serif transition-colors",
                      busy || value.trim().length === 0
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

          {stage === "sent" ? (
            <>
              <h1
                className="font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                Check your messages.
              </h1>
              <p
                className="prose-measure mt-4 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                If that number matches a record, we have sent a secure link to the
                contact on file. Open it to continue.
              </p>
            </>
          ) : null}

          {stage === "malformed" ? (
            <>
              <h1
                className="font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                That does not look like a Set for Life Number.
              </h1>
              <p
                className="prose-measure mt-4 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                Set for Life Numbers look like XXXX-XXXX. Check the number and try
                again — it is worth a second look at the letters and numbers.
              </p>
            </>
          ) : null}

          {stage === "not_found" ? (
            <>
              <h1
                className="font-display text-evergreen"
                style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
              >
                We could not complete that just now.
              </h1>
              <p
                className="prose-measure mt-4 font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                You can try again, or start a new assessment. Nothing you have
                already answered is affected.
              </p>
            </>
          ) : null}

          <button
            type="button"
            onClick={() =>
              stage === "lookup" ? router.push("/assessment/start") : setStage("lookup")
            }
            className="mt-10 font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{ fontSize: "20px", lineHeight: "28px" }}
          >
            {stage === "lookup" ? "Back" : "Try a different number"}
          </button>
        </div>
      </div>
    </main>
  );
}
