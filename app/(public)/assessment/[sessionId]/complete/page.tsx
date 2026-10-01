"use client";

// UIUX §8 S11 — completion / reveal.
//
// THE STAGED SYNTHESIS MOMENT. This screen calls POST /api/session/:id/complete
// and then routes to the Snapshot.
//
// WHY COMPLETION IS A SEPARATE SCREEN and not the tail of the last question:
// §23.5 makes completion a SERVER decision. The client asks, the server reads
// the stored responses and decides. If the server says the set is incomplete
// (422), this screen reports what is missing and offers to return — it never
// marks anything complete locally, because it has no authority to.
//
// §8B restraint applies here too: no confetti, no score reveal, no exclamation.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type State =
  | { kind: "working" }
  | { kind: "incomplete"; missing: string[]; present: number; required: number }
  | { kind: "failed" };

export default function CompletePage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "working" });

  const complete = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const res = await fetch(`/api/session/${params.sessionId}/complete`, {
        method: "POST",
      });

      // 422 is a legitimate refusal: the assessment is unfinished, not broken.
      if (res.status === 422) {
        const data = (await res.json()) as {
          missing?: string[];
          present?: number;
          required?: number;
        };
        setState({
          kind: "incomplete",
          missing: data.missing ?? [],
          present: data.present ?? 0,
          required: data.required ?? 31,
        });
        return;
      }

      if (!res.ok) {
        setState({ kind: "failed" });
        return;
      }

      router.replace(`/snapshot/${params.sessionId}`);
    } catch {
      setState({ kind: "failed" });
    }
  }, [params.sessionId, router]);

  useEffect(() => {
    void complete();
  }, [complete]);

  return (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px]">
        {state.kind === "working" ? (
          <p
            className="font-display text-evergreen"
            style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
          >
            Preparing your Financial Snapshot…
          </p>
        ) : null}

        {state.kind === "incomplete" ? (
          <>
            <p
              className="font-display text-evergreen"
              style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
            >
              A few answers are still needed.
            </p>
            {/* Progress stated factually (§8A): no "almost done!", no praise. */}
            <p
              className="prose-measure mt-6 font-body text-obsidian"
              style={{ fontSize: "18px", lineHeight: "29px" }}
            >
              {state.present} of {state.required} responses are saved. Your
              Snapshot is prepared once every question has an answer.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/assessment/${params.sessionId}`)}
              className="mt-10 bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
              style={{
                fontSize: "var(--type-t13-size)",
                lineHeight: "var(--type-t13-line)",
                borderRadius: "2px",
                minHeight: "56px",
              }}
            >
              Return to my assessment
            </button>
          </>
        ) : null}

        {state.kind === "failed" ? (
          <>
            <p
              className="font-display text-evergreen"
              style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
            >
              Your Snapshot could not be prepared just now.
            </p>
            <p
              className="prose-measure mt-6 font-body text-obsidian"
              style={{ fontSize: "18px", lineHeight: "29px" }}
            >
              Your answers are saved. Nothing has been lost.
            </p>
            <button
              type="button"
              onClick={() => void complete()}
              className="mt-10 bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
              style={{
                fontSize: "var(--type-t13-size)",
                lineHeight: "var(--type-t13-line)",
                borderRadius: "2px",
                minHeight: "56px",
              }}
            >
              Try again
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
