"use client";

// UIUX §8 S12–S20, §14, §20 — the Financial Snapshot.
//
// THE PAYOFF SCREEN. §14 asks for "oversized editorial declarations, thin
// rules, high whitespace — a personalized editorial report, not a dashboard".
// So: large Playfair headings, generous spacing, and no charts, gauges, dials
// or numeric scores anywhere. §20 is explicit that raw 1–5 values never reach
// the participant.
//
// WHAT IT RENDERS, AND WHAT IT MUST NOT. The API returns narrative KEYS and
// tension CODES; this screen resolves them through lib/ui/narratives.ts into
// approved copy. It never renders a key, a code, a state identifier, or a
// signal value — an unresolved key renders nothing rather than showing
// internal vocabulary (§24).
//
// EVERYTHING HERE IS APPROVED COPY. No sentence on this screen is composed by
// the app: §19 forbids generative authorship of participant-facing diagnosis,
// and the safest implementation is a lookup that cannot invent.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  resolveNarrative,
  resolveConnection,
  resolveAttentionArea,
  signalLabel,
  isSpecialState,
} from "@/lib/ui/narratives";

interface Snapshot {
  sessionId: string;
  signals: Array<{ signal: string; state: string; narrativeKey: string }>;
  tensionCodes: string[];
  connectionKeys: string[];
  attentionArea: string;
}

export default function SnapshotPage() {
  const params = useParams<{ sessionId: string }>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/session/${params.sessionId}/snapshot`, {
          cache: "no-store",
        });
        // 403 means "not complete yet" — the route returns the same response
        // for an unknown session, so the screen cannot distinguish them and
        // must not try (§7.3 applies to sessions too).
        if (!res.ok) {
          if (alive) setStatus("unavailable");
          return;
        }
        const data = (await res.json()) as Snapshot;
        if (alive) {
          setSnapshot(data);
          setStatus("ready");
          // §16: `snapshot_viewed` is recorded by the snapshot route, at the
          // moment it actually served a completed Snapshot. Recording it here
          // would count a render, not a served report.
        }
      } catch {
        if (alive) setStatus("unavailable");
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.sessionId]);

  if (status === "loading") {
    return (
      <Shell>
        <p className="font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
          Preparing your Snapshot…
        </p>
      </Shell>
    );
  }

  if (status === "unavailable" || !snapshot) {
    return (
      <Shell>
        <h1
          className="font-display text-evergreen"
          style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
        >
          Your Snapshot is not available yet.
        </h1>
        <p
          className="prose-measure mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          It is prepared once every question has an answer.
        </p>
        <Link
          href={`/assessment/${params.sessionId}`}
          className="mt-10 inline-block bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          Return to my assessment
        </Link>
      </Shell>
    );
  }

  const connections = snapshot.connectionKeys
    .map(resolveConnection)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const attention = resolveAttentionArea(snapshot.attentionArea);

  return (
    <Shell>
      {/* S12 — cover / big picture. §14: oversized editorial declaration. */}
      <header className="mb-20">
        <p
          className="font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
        >
          YOUR SET FOR LIFE FINANCIAL SNAPSHOT
        </p>
        <h1
          className="mt-6 font-display text-evergreen"
          style={{ fontSize: "var(--type-t01-size)", lineHeight: "var(--type-t01-line)" }}
        >
          Here is what your responses show.
        </h1>
      </header>

      {/* S13 — operating profile. One block per signal, each from approved copy. */}
      <Section title="Your Financial Operating Profile">
        <div className="flex flex-col gap-16">
          {snapshot.signals.map((s) => {
            const copy = resolveNarrative(s.narrativeKey);
            if (!copy) return null;
            return (
              <article key={s.signal}>
                <p
                  className="font-body text-rose"
                  style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
                >
                  {signalLabel(s.signal).toUpperCase()}
                </p>
                <h3
                  className="mt-3 font-serif text-evergreen"
                  style={{
                    fontSize: "var(--type-t10-size)",
                    lineHeight: "var(--type-t10-line)",
                  }}
                >
                  {copy.label}
                </h3>
                <p
                  className="prose-measure mt-4 font-body text-obsidian"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {copy.copy}
                </p>
                {/* No numeric value, no state identifier, no score. §20:
                    "no raw 1–5 values". isSpecialState is used only to avoid
                    rendering anything that would hint at the override. */}
                {isSpecialState(s.narrativeKey) ? null : null}
              </article>
            );
          })}
        </div>
      </Section>

      {/* S16 — the connection statements, one per triggered tension. Each is
          approved copy keyed by its tension code. */}
      {connections.length > 0 ? (
        <Section title="The Connection">
          <div className="flex flex-col gap-14">
            {connections.map((c, i) => (
              <article key={i}>
                <h3
                  className="font-display text-terracotta"
                  style={{
                    fontSize: "var(--type-t04-size)",
                    lineHeight: "var(--type-t04-line)",
                  }}
                >
                  {c.headline}
                </h3>
                <p
                  className="prose-measure mt-5 font-body text-obsidian"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {/* S20 — primary attention area. The ONE area, stated plainly. */}
      {attention ? (
        <Section title="One Area Worth Examining Next">
          <h3
            className="font-display text-evergreen"
            style={{
              fontSize: "var(--type-t02-size)",
              lineHeight: "var(--type-t02-line)",
            }}
          >
            {attention.label}
          </h3>
          <p
            className="prose-measure mt-6 font-body text-obsidian"
            style={{ fontSize: "18px", lineHeight: "29px" }}
          >
            {attention.body}
          </p>
        </Section>
      ) : null}

      <footer className="mt-24">
        <p
          className="font-script text-rose"
          style={{ fontSize: "var(--type-t15-size)", lineHeight: "var(--type-t15-line)" }}
        >
          Set for Life
        </p>
      </footer>
    </Shell>
  );
}

/** Shared page frame: ivory surface, 1080px max, generous vertical rhythm. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="surface-ivory min-h-screen w-full px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[1080px]">{children}</div>
    </main>
  );
}

/** A titled section. Thin warm rule above the heading, per §14. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <div className="border-t border-blush pt-8" aria-hidden="true" />
      <h2
        className="mb-10 font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
      >
        {title.toUpperCase()}
      </h2>
      {children}
    </section>
  );
}
