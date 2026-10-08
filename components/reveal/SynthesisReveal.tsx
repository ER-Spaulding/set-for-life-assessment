"use client";

// PRD Addendum 01 v1.1 §4 — THE SYNTHESIS REVEAL.
//
// "The reveal is not a technical loading screen. It is the first expression of
//  the Set for Life Money Picture."
//
// WHAT THIS RENDERS. Five frames (§4.2), in order, over ~6.2s:
//
//   FRAME 1  ONE ANSWER IS A DETAIL.            a single point appears
//   FRAME 2  TOGETHER, THEY MAKE A PICTURE.     points organize into composition
//   FRAME 3  YOUR FINANCIAL PICTURE IS COMING   relationships become visible;
//            INTO FOCUS.                        the composition resolves around YOU
//   FRAME 4  (no copy; §4.2 specifies none)     the six human questions resolve
//                                               around YOU
//   FRAME 5  {First Name}, your Financial       CTA -> the Financial Snapshot
//            Snapshot is ready.
//
// THE PARTICIPANT IS THE CENTER. §2.1: "Do not place the Set for Life logo, an
// overall score, or an algorithm at the center of the participant's Money
// Picture." The center of this composition is the word YOU and nothing else.
//
// §2.3 RETIRES SEE / ROOM / DIRECT / PREPARE / AIM / MOVE as the participant
// facing framework. None of those tokens appear here, and the retired wheel is
// deliberately absent — §4.2 FRAME 4 says so explicitly.
//
// THIS DOES NOT INTERPRET ANYTHING. It reads no signals, computes no states,
// and derives no conclusions. §5 permits exactly one interpretation path, and
// that path is the immutable payload persisted at completion. The reveal's only
// job is to present the transition INTO that finished Snapshot, which is why it
// gates on the completion response and then hands off to /snapshot/:id.
//
// WHY THE COMPLETION CALL LIVES HERE. §3's state machine runs server validation
// and payload persistence BEFORE the reveal, so the reveal cannot be the thing
// that creates the Snapshot — it waits for one to exist. The read-first gate
// below is the server-authority gate (§23.5): it READS the completion state and
// only POSTs for a genuinely unfinished session, so a completed participant who
// reaches or reloads this screen never re-completes, re-scores, or re-creates
// the Snapshot. The sequence plays while the gate is in flight, and if it
// outlasts the sequence we hold on §4.4's honest state rather than faking
// progress.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";
import {
  FRAME_1,
  FRAME_2,
  FRAME_3,
  HOLD_STATE,
  MONEY_PICTURE_CENTER,
  REVEAL_CTA,
  SIX_HUMAN_QUESTIONS,
  frame5,
} from "@/lib/ui/reveal-copy";
// The Snapshot failure/success-adjacent copy, including the owner's verbatim
// EXPIRED fresh-start copy. Imported rather than authored here so the strings
// exist in exactly one place and the copy guard can see them.
import {
  EXPIRED_FRESH_START_COPY,
  FRESH_START_HREF,
  UNAVAILABLE_COPY,
  expiredFreshStartGreeting,
} from "@/lib/ui/snapshot-failure";

type Outcome =
  | { kind: "pending" }
  | { kind: "ready"; firstName: string | null }
  | { kind: "incomplete"; missing: string[]; present: number; required: number }
  | { kind: "refused"; message: string }
  /**
   * An EXPIRED assessment — distinct from both `incomplete` (still resumable)
   * and `refused` (a generic lifecycle refusal). Owner ruling 2026-10-03: an
   * expired participant must not be sent back to finish questions on a session
   * that can never produce a Snapshot, and must not get a fourth
   * Snapshot-error narrative. They get the approved fresh-assessment experience.
   */
  | { kind: "expired"; firstName: string | null }
  | { kind: "failed" };

/**
 * §4.4: "Target approximately 6-10 seconds when the payload is ready quickly.
 * The narrative itself should justify the transition; do not artificially imply
 * computation is slower than it is."
 *
 * These durations sum to 6.2s, inside the window. They pace the NARRATIVE (how
 * long a line of copy needs to be read), not a fake computation.
 */
const FRAME_MS = [1400, 1600, 1800, 1400] as const;
const SEQUENCE_MS = FRAME_MS.reduce((a, b) => a + b, 0);

/** Frame 5 is index 4; the sequence covers 0-3. */
const LAST_SEQUENCE_FRAME = FRAME_MS.length - 1;

/** The CTA's arrow, split off so it can be styled as an affordance. */
const CTA_ARROW = "->";
const CTA_LABEL = REVEAL_CTA.endsWith(` ${CTA_ARROW}`)
  ? REVEAL_CTA.slice(0, -(CTA_ARROW.length + 1))
  : REVEAL_CTA;

/**
 * The six positions, as grid cells around the center.
 *
 * WHY A GRID AND NOT ABSOLUTE PERCENTAGES. The first draft placed each node at
 * (50 ± r·cos, 50 ± r·sin) and sized the labels in percentages of the canvas.
 * Measured, that overflows: a 34%-wide label anchored at left=82% spans 78%-112%,
 * i.e. 67px past the edge of a 560px canvas, and the mirrored label at 18%
 * started at -12%. Labels that wide simply do not fit on a ring at that radius,
 * and every tweak just moved which edge it broke on.
 *
 * A grid is bounded by construction: cells cannot overlap and content cannot
 * leave the container. So this is a 3-column layout — the outer columns hold the
 * side labels, the middle column holds YOU — and each label carries a short
 * leader line pointing inward at the center.
 *
 * Layout, by question index (order is §2.4's):
 *
 *            [0]
 *      [5]   YOU   [1]
 *      [4]   YOU   [2]
 *            [3]
 */
const GRID_SLOTS: Array<{
  col: number;
  row: number;
  align: "left" | "right" | "center";
  /** Leader-line direction, pointing at the center. */
  line: "up" | "down" | "left" | "right";
}> = [
  { col: 2, row: 1, align: "center", line: "down" }, // 0 SEE
  { col: 3, row: 2, align: "left", line: "left" }, //   1 ROOM
  { col: 3, row: 3, align: "left", line: "left" }, //   2 DIRECT
  { col: 2, row: 4, align: "center", line: "up" }, //   3 PREPARE
  { col: 1, row: 3, align: "right", line: "right" }, // 4 AIM
  { col: 1, row: 2, align: "right", line: "right" }, // 5 MOVE
];

export function SynthesisReveal({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const reduced = usePrefersReducedMotion();

  const [frame, setFrame] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "pending" });
  const [retrying, setRetrying] = useState(0);

  // Guards against a late response advancing the UI after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---- the server-authority gate (§23.2, §23.5) ----
  //
  // READ-DRIVEN. Completion is a one-time transition, so an already-completed
  // session is evidence the assessment has already crossed completion — not a
  // signal to run it again. Read the authoritative state first (GET
  // /api/session/:id, which returns `completed` and the verified `firstName`
  // only for a completed session). A completed participant goes straight to
  // the ready outcome with ZERO POSTs: no re-complete, no re-score, no
  // re-create of the Snapshot. Only a session that has NOT completed falls
  // through to the genuine completion POST.
  const complete = useCallback(async () => {
    setOutcome({ kind: "pending" });
    try {
      // 1. Read the authoritative completion state.
      const read = await fetch(`/api/session/${sessionId}`);
      if (!alive.current) return;
      if (read.ok) {
        const state = (await read.json()) as {
          completed?: boolean;
          firstName?: string | null;
          status?: string;
        };
        if (state.completed === true) {
          setOutcome({ kind: "ready", firstName: state.firstName ?? null });
          return;
        }
        // An EXPIRED assessment is the one lifecycle state that must be told
        // apart from "not finished yet" (owner ruling 2026-10-03). Its questions
        // may all be answered, and the session can never produce a Snapshot, so
        // the incomplete copy would be false and the CTA would send them back to
        // a session that cannot complete. Handled HERE, from the same
        // authoritative read, so no write is attempted at all.
        if (state.status === "expired") {
          setOutcome({
            kind: "expired",
            firstName: state.firstName ?? null,
          });
          return;
        }
      }

      // 2. The genuine completion path — the server-authority gate (§23.5).
      const res = await fetch(`/api/session/${sessionId}/complete`, {
        method: "POST",
      });
      if (!alive.current) return;

      // 422 is a legitimate refusal: the assessment cannot be completed as-is,
      // not broken. Split on the field actually present rather than inventing
      // a response count.
      if (res.status === 422) {
        const data = (await res.json()) as {
          refused?: boolean;
          message?: string;
          missing?: string[];
          present?: number;
          required?: number;
        };
        if (data.refused === true) {
          setOutcome({
            kind: "refused",
            message: typeof data.message === "string" ? data.message : "",
          });
          return;
        }
        if (typeof data.present === "number" && typeof data.required === "number") {
          setOutcome({
            kind: "incomplete",
            missing: Array.isArray(data.missing) ? data.missing : [],
            present: data.present,
            required: data.required,
          });
          return;
        }
        // A 422 that is neither a refusal nor an incomplete set is malformed.
        // Never render a response count for it.
        setOutcome({ kind: "failed" });
        return;
      }
      if (!res.ok) {
        setOutcome({ kind: "failed" });
        return;
      }
      const data = (await res.json()) as { firstName?: string | null };
      setOutcome({ kind: "ready", firstName: data.firstName ?? null });
    } catch {
      if (alive.current) setOutcome({ kind: "failed" });
    }
  }, [sessionId]);

  useEffect(() => {
    void complete();
  }, [complete, retrying]);

  // ---- the narrative sequence ----
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    for (let i = 1; i <= LAST_SEQUENCE_FRAME; i++) {
      elapsed += FRAME_MS[i - 1];
      timers.push(
        setTimeout(() => {
          if (!cancelled) setFrame(i);
        }, elapsed),
      );
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [retrying]);

  const sequenceDone = frame >= LAST_SEQUENCE_FRAME;

  /**
   * §4.4: "If actual server work exceeds the planned sequence, hold on an
   * honest state." So frame 5 waits for the real completion. We never claim
   * readiness we do not have.
   */
  const showHold = sequenceDone && outcome.kind === "pending";
  const showFinal = sequenceDone && outcome.kind === "ready";

  // §4.3: "final transition flows directly into the web results cover."
  const goToSnapshot = useCallback(() => {
    router.push(`/snapshot/${sessionId}`);
  }, [router, sessionId]);

  // ---- failure / refusal states keep the participant oriented ----
  if (outcome.kind === "incomplete") {
    return (
      <Shell>
        <Headline>A few answers are still needed.</Headline>
        <p className="prose-measure mt-6 font-body text-obsidian" style={BODY}>
          {outcome.present} of {outcome.required} responses are saved. Your
          Snapshot is prepared once every question has an answer.
        </p>
        <PrimaryButton onClick={() => router.push(`/assessment/${sessionId}`)}>
          Return to my assessment
        </PrimaryButton>
      </Shell>
    );
  }

  if (outcome.kind === "expired") {
    // THE EXPIRED ASSESSMENT — owner ruling 2026-10-03.
    //
    // The copy is the owner's, verbatim, from lib/ui/snapshot-failure.ts. It is
    // NOT a Snapshot-error narrative: it is the approved fresh-assessment
    // experience, which is the one thing that is actually true and actionable
    // here. The landing route resolves the verified email (start-returning),
// verifies
    // identity, and renders the same "Welcome back, {First Name}." greeting
    // where the name is legitimately known.
    return (
      <Shell>
        <Headline>{expiredFreshStartGreeting(outcome.firstName)}</Headline>
        <p className="prose-measure mt-6 font-body text-obsidian" style={BODY}>
          {EXPIRED_FRESH_START_COPY.body}
        </p>
        <PrimaryButton onClick={() => router.push(FRESH_START_HREF)}>
          {EXPIRED_FRESH_START_COPY.cta}
        </PrimaryButton>
      </Shell>
    );
  }

  if (outcome.kind === "refused") {
    // A LIFECYCLE REFUSAL that is NOT expiration — reached only if the session's
    // status moved between the authoritative read above and the completion POST
    // (a concurrent sweep), or if the read could not report a status.
    //
    // COPY PROVENANCE (owner ruling 2026-10-03): do not author a new headline to
    // make this state unique. This uses the APPROVED UNAVAILABLE headline, and
    // the supporting sentence is the SERVER's own refusal message — the one
    // place the lifecycle reason can be stated accurately. The CTA is the
    // approved fresh-assessment destination rather than "Try again", because a
    // refusal means this session will never produce a Snapshot.
    return (
      <Shell>
        <Headline>{UNAVAILABLE_COPY.headline}</Headline>
        <p className="prose-measure mt-6 font-body text-obsidian" style={BODY}>
          {outcome.message}
        </p>
        <PrimaryButton onClick={() => router.push(FRESH_START_HREF)}>
          Begin a current assessment
        </PrimaryButton>
      </Shell>
    );
  }

  if (outcome.kind === "failed") {
    return (
      <Shell>
        <Headline>Your Snapshot could not be prepared just now.</Headline>
        <p className="prose-measure mt-6 font-body text-obsidian" style={BODY}>
          Your answers are saved. Nothing has been lost.
        </p>
        <PrimaryButton
          onClick={() => {
            setFrame(0);
            setRetrying((n) => n + 1);
          }}
        >
          Try again
        </PrimaryButton>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* aria-live so the sequence is announced rather than silently visual. */}
      <div aria-live="polite" className="flex flex-col items-center">
        {/* ---- the Money Picture composition (§7.1) ----
            "place YOU at the center and organize the six human questions around
             the participant."

            TWO LAYOUTS, ONE COMPOSITION. Measured at real viewports, the
            3-column ring cannot hold these labels below ~640px: the side
            columns collapse to ~86px while a legible question needs ~180px, so
            the text overflows by 120px+. Shrinking the type far enough to fit
            would make it unreadable, which defeats the point.

            So: the ring is used where it fits, and narrow screens get a radial
            list — the same YOU, the same six questions, the same order, with
            leader rules turning it into a list. Same information, same
            hierarchy, no content removed on mobile. */}
        <div className="mx-auto w-full max-w-[620px]">
          {/* ---- the center: YOU (§2.1) ----
              Explicitly NOT a logo, NOT an overall score, NOT an algorithm. */}
          <div className="flex flex-col items-center justify-center">
            {/* FRAME 1-3: the points that organize into a composition. */}
            <div
              aria-hidden="true"
              className="mb-4 flex items-center justify-center gap-2"
              style={{
                opacity: frame >= 2 ? 1 : 0,
                transition: reduced ? "opacity 700ms ease" : "opacity 900ms ease",
              }}
            >
              {SIX_HUMAN_QUESTIONS.map((_, i) => (
                <span
                  key={i}
                  className="block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: "var(--color-evergreen)",
                    // §4.3: "fragments organize rather than spin". Opacity
                    // only — no rotation, no travel, no bounce.
                    opacity: frame >= 2 || (frame >= 1 && i === 0) ? 1 : 0,
                    transition: reduced
                      ? "opacity 700ms ease"
                      : `opacity 900ms ease ${i * 90}ms`,
                  }}
                />
              ))}
            </div>

            <span
              className="flex items-center justify-center rounded-full"
              style={{
                width: 132,
                height: 132,
                border: "1px solid var(--color-evergreen)",
                backgroundColor: "var(--color-ivory)",
                opacity: frame >= 1 ? 1 : 0,
                transition: reduced ? "opacity 700ms ease" : "opacity 1100ms ease",
              }}
            >
              <span
                className="font-display text-evergreen"
                style={{ fontSize: 22, letterSpacing: "0.14em" }}
              >
                {MONEY_PICTURE_CENTER}
              </span>
            </span>
          </div>

          {/* ---- the six human questions (§2.4) ----
              FRAME 4: §4.2 gives it no copy, just the questions resolving
              around YOU. Before frame 4 the composition is still points.

              The ring (sm and up): side labels with leader rules pointing in. */}
          <div
            className="mt-8 hidden items-center gap-x-5 sm:grid"
            style={{ gridTemplateColumns: "1fr 152px 1fr", rowGap: 20 }}
          >
            {SIX_HUMAN_QUESTIONS.map((q, i) => {
              const slot = GRID_SLOTS[i];
              const right = slot.align === "right";
              return (
                <div
                  key={q.question}
                  className="flex items-center"
                  style={{
                    gridColumn: slot.col,
                    gridRow: slot.row,
                    justifyContent: right ? "flex-end" : "flex-start",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      order: right ? 2 : 0,
                      width: 22,
                      height: 1,
                      flexShrink: 0,
                      backgroundColor: "var(--color-gold)",
                      opacity: frame >= 3 ? 0.7 : 0,
                      transition: reduced
                        ? "opacity 700ms ease"
                        : `opacity 900ms ease ${i * 80}ms`,
                    }}
                  />
                  <p
                    title={q.prompt}
                    className="font-body uppercase text-obsidian"
                    style={{
                      order: 1,
                      margin: 0,
                      maxWidth: 176,
                      textAlign: right ? "right" : "left",
                      fontSize: 10.5,
                      lineHeight: 1.5,
                      letterSpacing: "0.06em",
                      fontWeight: 600,
                      opacity: frame >= 3 ? 1 : 0,
                      transition: reduced
                        ? "opacity 700ms ease"
                        : `opacity 900ms ease ${i * 80}ms`,
                    }}
                  >
                    {q.question}
                  </p>
                </div>
              );
            })}
          </div>

          {/* The radial list (below sm): same YOU, same six questions, same
              order, each with a leader rule — a list rather than a ring. */}
          <ul className="mt-8 flex list-none flex-col gap-3 sm:hidden">
            {SIX_HUMAN_QUESTIONS.map((q, i) => (
              <li
                key={q.question}
                className="flex items-center gap-3"
                style={{
                  opacity: frame >= 3 ? 1 : 0,
                  transition: reduced
                    ? "opacity 700ms ease"
                    : `opacity 900ms ease ${i * 80}ms`,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 1,
                    flexShrink: 0,
                    backgroundColor: "var(--color-gold)",
                    opacity: 0.7,
                  }}
                />
                <span
                  title={q.prompt}
                  className="font-body uppercase text-obsidian"
                  style={{
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    letterSpacing: "0.06em",
                    fontWeight: 600,
                  }}
                >
                  {q.question}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---- the narrative line for the current frame ---- */}
        <div className="mt-10 min-h-[112px] w-full max-w-[720px] text-center sm:mt-14">
          <FrameLine frame={frame} showHold={showHold} />

          {showFinal && outcome.firstName !== undefined ? (
            <>
              <p
                className="font-display text-evergreen"
                style={{
                  fontSize: "var(--type-t04-size)",
                  lineHeight: "var(--type-t04-line)",
                  opacity: 1,
                  transition: reduced ? "opacity 700ms ease" : "opacity 1000ms ease",
                }}
              >
                {frame5(outcome.firstName)}
              </p>
              <div className="mt-10">
                <PrimaryButton onClick={goToSnapshot}>
                  {CTA_LABEL}
                  <span aria-hidden="true" style={{ marginLeft: 10 }}>
                    {CTA_ARROW}
                  </span>
                </PrimaryButton>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

/** The frame's own line, or §4.4's honest hold state. Never both. */
function FrameLine({ frame, showHold }: { frame: number; showHold: boolean }) {
  const line = showHold ? HOLD_STATE : frame === 0 ? null : frame === 1 ? FRAME_1 : frame === 2 ? FRAME_2 : FRAME_3;
  if (!line) return null;
  return (
    <p
      className={
        showHold
          ? "font-serif text-obsidian"
          : "font-display text-evergreen"
      }
      style={
        showHold
          ? { fontSize: "var(--type-t06-size)", lineHeight: "var(--type-t06-line)" }
          : { fontSize: "var(--type-t04-size)", lineHeight: "var(--type-t04-line)" }
      }
    >
      {line}
    </p>
  );
}

// ---- shared chrome ----

const BODY = { fontSize: "18px", lineHeight: "29px" } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="surface-ivory flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px]">{children}</div>
    </main>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="font-display text-evergreen"
      style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
    >
      {children}
    </p>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-10 bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
      style={{
        fontSize: "var(--type-t13-size)",
        lineHeight: "var(--type-t13-line)",
        borderRadius: "2px",
        minHeight: "56px",
      }}
    >
      {children}
    </button>
  );
}

export default SynthesisReveal;
