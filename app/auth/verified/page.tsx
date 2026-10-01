"use client";

// UIUX §8A — post-verification landing.
//
// The callback redirects a browser here after redeeming a verification link.
// Two branches, exactly as §8A specifies:
//
//   unfinished session → "Welcome back, {first_name}. You have an assessment
//                        in progress." + "Continue where I left off"
//   no unfinished      → "Welcome back, {first_name}. Ready to see what has
//                        changed?" + "Begin a new assessment"
//
// The callback cannot render this: it is a route handler and returns a
// Response. So the branch lives here, where it can fetch the resumable session
// and show progress.
//
// NO PARTICIPANT ID IS DISPLAYED (§8A: "Do not show a Participant ID, database
// language, or diagnostic history on these screens"). The id arrives in the
// query string only so this page can look up the resumable session; it is
// never rendered.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResumeCard } from "@/components/identity/ResumeCard";

const TOTAL = 31;

function VerifiedInner() {
  const router = useRouter();
  const params = useSearchParams();
  const participantId = params.get("participantId") ?? "";

  const [firstName, setFirstName] = useState("");
  const [inProgress, setInProgress] = useState<{
    responsesSaved: number;
    total: number;
  } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!participantId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/session/resumable?participantId=${encodeURIComponent(participantId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          resumable: {
            sessionId: string;
            currentPosition: number;
          } | null;
          firstName?: string | null;
        };
        if (!alive) return;
        // §4.1's first-name welcome. Null for an unverified participant, and the
        // card then greets without a name rather than substituting a placeholder
        // — see ResumeCard.
        if (typeof data.firstName === "string" && data.firstName.trim()) {
          setFirstName(data.firstName.trim());
        }
        if (data.resumable) {
          setSessionId(data.resumable.sessionId);
          // §8A: "17 of 31 responses saved" — factual, no percentage-to-goal.
          setInProgress({
            responsesSaved: Math.max(0, data.resumable.currentPosition - 1),
            total: TOTAL,
          });
        }
      } catch {
        /* falls through to the "begin new" branch, which always works */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [participantId]);

  const beginNew = useCallback(async () => {
    if (!participantId || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) {
        setCreating(false);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/assessment/${data.sessionId}`);
    } catch {
      setCreating(false);
    }
  }, [participantId, creating, router]);

  if (loading) {
    return (
      <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
        <p className="font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
          Verifying your email…
        </p>
      </main>
    );
  }

  if (!participantId) {
    return (
      <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="max-w-[720px]">
          <p
            className="font-display text-evergreen"
            style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
          >
            This link could not be completed.
          </p>
          <p className="prose-measure mt-6 font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
            Please return to the beginning and request a new link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <ResumeCard
        // Passed as-is. The previous `firstName || "there"` fallback produced
        // "Welcome back, there." for EVERY returning participant, because
        // `firstName` was initialized to "" and never populated — a defective
        // greeting that read as a name and satisfied nobody. §4.1 wants a
        // first-name welcome; when there is no verified name, ResumeCard drops
        // the name rather than filling the slot.
        firstName={firstName || null}
        inProgress={inProgress}
        onContinue={() => {
          if (sessionId) router.push(`/assessment/${sessionId}`);
        }}
        onStartNew={() => void beginNew()}
      />
    </main>
  );
}

/**
 * `useSearchParams` makes this page dynamic, which the App Router cannot
 * prerender without a Suspense boundary — the build fails at the export step
 * without one. The boundary also gives a real loading state for the moment
 * before the query string is read, rather than a blank frame.
 */
export default function VerifiedPage() {
  return (
    <Suspense
      fallback={
        <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
          <p className="font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
            Verifying your email…
          </p>
        </main>
      }
    >
      <VerifiedInner />
    </Suspense>
  );
}
