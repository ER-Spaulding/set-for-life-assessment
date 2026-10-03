"use client";

// UIUX §5, §8 S02–S08 — the assessment itself.
//
// THIS IS THE PARTICIPANT'S MAIN SCREEN. It renders one question at a time from
// the client-safe projection in lib/ui/questions.ts, persists each answer on
// Continue, and shows a quiet saved state (§8B).
//
// PRD §23.5 governs the write path: "Never trust client-side completion ...
// Required-item validation and final scoring run server-side." So this screen
// never decides that an answer is acceptable — it sends the selection and
// surfaces whatever the server says. A 422 is rendered as a plain message, not
// as a crash, because the route rejects selections the instrument forbids and
// that is a real (if rare) outcome.
//
// NOTHING HERE KNOWS ABOUT SCORING. No signal names, no capacity overrides, no
// classifier output. §8 S06 requires a capacity-sensitive question to be
// visually IDENTICAL to any other, and the surest way to guarantee that is for
// this component to have no access to the information at all.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  QUESTION_SEQUENCE,
  REQUIRED_QUESTION_COUNT,
  FIRST_IN_INSTRUMENT_INDEX,
  resumeIndex,
  isMultiSelect,
  maxSelections,
  moneyMomentPlacements,
  moneyMomentLabel,
  type UiQuestion,
} from "@/lib/ui/questions";
import { MoneyMoment } from "@/components/assessment/MoneyMoment";
// CLIENT COMPONENT: the analytics import MUST be ./client, never ./write.
// ./write pulls in the service client (`server-only`) and the build fails on
// exactly this line if that is ever got wrong — which is how this was caught.
import { reportEvent } from "@/lib/analytics/client";
import { SaveMyProgress } from "@/components/identity/SaveMyProgress";
import { QuestionFrame } from "@/components/assessment/QuestionFrame";
import { SingleSelectCard } from "@/components/assessment/SingleSelectCard";
import { MultiSelectCard } from "@/components/assessment/MultiSelectCard";
import { TransitionScreen } from "@/components/assessment/TransitionScreen";

/** Where the activation transition sits (UIUX §8 S07). */
const ACTIVATION_FIRST_INDEX = QUESTION_SEQUENCE.findIndex((q) =>
  q.internal_id.startsWith("A"),
);

/**
 * Money Moment placements, resolved from config (Addendum 02 v1.1 §9).
 * Keyed by the sequence index the moment FOLLOWS.
 */
const MONEY_MOMENTS = moneyMomentPlacements();

/** §3.4: Save My Progress is offered after Money Moment 01. */
const SAVE_PROGRESS_AFTER = "MM01";

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransition, setShowTransition] = useState(false);
  /**
   * The Money Moment currently being shown, if any (Addendum 02 v1.1 §9).
   *
   * `shownMoments` tracks which have already been seen, because §12 requires
   * that back/forward correction must NOT repeatedly force an already-viewed
   * Money Moment. A moment is an interstitial, not a gate — re-showing it on
   * every pass through the same question would turn a pacing beat into an
   * obstacle.
   */
  const [moment, setMoment] = useState<string | null>(null);
  const [shownMoments, setShownMoments] = useState<Record<string, true>>({});
  /** §3.4: the optional Save My Progress offer, after MM01. */
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [sflNumber, setSflNumber] = useState<string | null>(null);
  const [claimSending, setClaimSending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** The provisional participant id, read from sessionStorage. */
  const [participantId, setParticipantId] = useState<string | null>(null);
  // Answers already persisted, so going Back does not lose them visually.
  const [saved, setSaved] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const question: UiQuestion | undefined = QUESTION_SEQUENCE[index];

  // ---- restore any answers already stored for this session ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`, { cache: "no-store" });
        if (!res.ok) return; // an unknown session surfaces on first save
        const data = (await res.json()) as {
          responses?: Record<string, string | string[]>;
          currentPosition?: number;
        };
        if (!alive) return;

        const restored: Record<string, string[]> = {};
        for (const [itemId, value] of Object.entries(data.responses ?? {})) {
          restored[itemId] = Array.isArray(value) ? value : [value];
        }
        setSaved(restored);

        // Resume at the first unanswered question rather than at the stored
        // position — a participant who used Back would otherwise be dropped
        // forward past questions they can still see.
        //
        // `resumeIndex` (lib/ui/questions.ts) guarantees the result is never a
        // front-door index and never -1: Opening A is answered at the front door,
        // and a fully-answered session lands on the last in-instrument item so
        // Continue performs the normal handoff to /profile.
        setIndex(resumeIndex(restored));
      } catch {
        /* first save will surface any real problem */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Read the provisional identity written by /assessment/start. Absent for a
  // returning participant, who arrives with an identity already.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("sfl_provisional");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { participantId?: string; sflNumber?: string };
      if (parsed.participantId) setParticipantId(parsed.participantId);
      if (parsed.sflNumber) setSflNumber(parsed.sflNumber);
    } catch {
      /* private mode or first load: the Save prompt simply will not offer */
    }
  }, []);

  // Load the current question's stored selection whenever the index changes.
  useEffect(() => {
    if (!question) return;
    setSelected(saved[question.internal_id] ?? []);
  }, [index, question, saved]);

  const toggle = useCallback(
    (code: string) => {
      if (!question) return;
      const option = question.options.find((o) => o.code === code);

      if (!isMultiSelect(question.type)) {
        setSelected([code]);
        return;
      }

      setSelected((prev) => {
        // Choosing an exclusive option clears the rest (§14). The server
        // enforces this anyway; doing it here keeps the participant from
        // building a set that would be refused on Continue.
        if (option?.exclusive) return [code];
        if (prev.includes(code)) return prev.filter((c) => c !== code);
        const limit = maxSelections(question.type);
        // At the limit, replace the oldest rather than refusing the tap —
        // there is no explanation for a silent no-op.
        const next = [...prev, code];
        return next.length > limit ? next.slice(next.length - limit) : next;
      });
    },
    [question],
  );

  const persist = useCallback(async (): Promise<boolean> => {
    if (!question || selected.length === 0) return false;
    setSaving(true);
    setError(null);
    try {
      const body = isMultiSelect(question.type)
        ? { itemId: question.internal_id, optionCodes: selected }
        : { itemId: question.internal_id, optionCode: selected[0] };

      const res = await fetch(`/api/session/${sessionId}/response`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(
          data?.error?.message ??
            "That answer could not be saved. Please try again.",
        );
        return false;
      }

      setSaved((prev) => ({ ...prev, [question.internal_id]: selected }));
      return true;
    } catch {
      setError("That answer could not be saved. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [question, selected, sessionId]);

  const onContinue = useCallback(async () => {
    const ok = await persist();
    if (!ok) return;

    // ---- §9: a Money Moment follows this question ----
    // Checked BEFORE advancing, because the moment belongs between this question
    // and the next. §12: "do not repeatedly force an already-viewed Money Moment
    // during ordinary back/forward correction", so a moment already seen is
    // skipped on a second pass rather than shown again.
    const due = MONEY_MOMENTS[index];
    if (due && !shownMoments[due]) {
      setMoment(due);
      // §16: a Money Moment rendering is a browser-only fact — nothing happens
      // server-side — so it is reported through the client route, which derives
      // the participant from the session row rather than from this page.
      reportEvent({
        eventName: "money_moment_displayed",
        sessionId,
        payload: { moment: due, position: index + 1 },
      });
      return;
    }

    // §8 S07: the activation transition, shown once, immediately before A1–A4.
    if (index === ACTIVATION_FIRST_INDEX && !showTransition) {
      setShowTransition(true);
      return;
    }

    if (index + 1 < REQUIRED_QUESTION_COUNT) {
      setIndex(index + 1);
      return;
    }

    // Last question answered — hand off to completion.
    router.push(`/assessment/${sessionId}/profile`);
  }, [persist, index, showTransition, router, sessionId, shownMoments]);

  /** Leaving a Money Moment: record it as seen, then decide what comes next. */
  const leaveMoment = useCallback(
    (advance = true) => {
      const id = moment;
      setMoment(null);
      if (id) {
        setShownMoments((prev) => ({ ...prev, [id]: true }));
        reportEvent({
          eventName: "money_moment_continued",
          sessionId,
          payload: { moment: id },
        });
      }

      // §3.4: Save My Progress is offered immediately after Money Moment 01 —
      // after the participant has momentum, not before they have seen anything.
      if (advance && id === SAVE_PROGRESS_AFTER && participantId && !claimed) {
        setShowSavePrompt(true);
        reportEvent({ eventName: "save_progress_offered", sessionId });
        return;
      }
      if (!advance) return;
      if (index + 1 < REQUIRED_QUESTION_COUNT) setIndex(index + 1);
      else router.push(`/assessment/${sessionId}/profile`);
    },
    [moment, participantId, claimed, index, router, sessionId],
  );

  /** §3.1: collect identity and send the verification link. */
  const claim = useCallback(
    async (firstName: string, email: string) => {
      if (!participantId) return;
      setClaimSending(true);
      setClaimError(null);
      try {
        const res = await fetch("/api/participant/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantId, firstName, email }),
        });
        if (res.status === 409) {
          const data = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setClaimError(
            data?.error?.message ??
              "That email is already connected to a different record.",
          );
          return;
        }
        if (!res.ok) {
          setClaimError("We could not send the link just now. Please try again.");
          return;
        }
        setClaimed(true);
        // §16: `save_progress_used` is recorded by the claim route, which is
        // what actually sent the verification link.
      } catch {
        setClaimError("We could not send the link just now. Please try again.");
      } finally {
        setClaimSending(false);
      }
    },
    [participantId],
  );

  if (loading) {
    return (
      <main className="surface-ivory min-h-screen px-6 py-10 sm:px-10 lg:px-16">
        <p
          className="mx-auto max-w-[1080px] font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          Loading your assessment…
        </p>
      </main>
    );
  }

  if (!question) {
    return (
      <main className="surface-ivory min-h-screen px-6 py-10 sm:px-10 lg:px-16">
        <p
          className="mx-auto max-w-[1080px] font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          This assessment could not be loaded.
        </p>
      </main>
    );
  }

  // ---- §9: a Money Moment is showing ----
  if (moment) {
    return (
      <MoneyMoment
        momentId={moment}
        milestoneLabel={moneyMomentLabel(moment)}
        progress={`${index + 1} of ${REQUIRED_QUESTION_COUNT} answered`}
        onContinue={() => leaveMoment(true)}
      />
    );
  }

  // ---- §3.4: Save My Progress, offered after MM01 ----
  if (showSavePrompt) {
    return (
      <SaveMyProgress
        sflNumber={sflNumber}
        claimed={claimed}
        sending={claimSending}
        error={claimError}
        onKeepGoing={() => {
          setShowSavePrompt(false);
          // §16: a participant declining to save happens only in the browser —
          // no server is involved — so this is one of the four client events.
          reportEvent({ eventName: "save_progress_skipped", sessionId });
          leaveMoment(true);
        }}
        onClaim={(firstName, email) => void claim(firstName, email)}
      />
    );
  }

  if (showTransition) {
    return (
      <TransitionScreen
        statement="You're almost there…"
        onContinue={() => {
          setShowTransition(false);
          setIndex(index + 1);
        }}
      />
    );
  }

  const multi = isMultiSelect(question.type);
  const current = index + 1;

  return (
    <QuestionFrame
      current={current}
      total={REQUIRED_QUESTION_COUNT}
      prompt={question.prompt}
      helper={multi ? multiHelper(question.type) : undefined}
      onBack={
        index > FIRST_IN_INSTRUMENT_INDEX ? () => setIndex(index - 1) : undefined
      }
      onContinue={onContinue}
      continueDisabled={selected.length === 0 || saving}
      saving={saving}
    >
      {question.options.map((option) =>
        multi ? (
          <MultiSelectCard
            key={option.code}
            option={option}
            selected={selected.includes(option.code)}
            onToggle={toggle}
          />
        ) : (
          <SingleSelectCard
            key={option.code}
            name={question.internal_id}
            option={option}
            selected={selected.includes(option.code)}
            onSelect={toggle}
          />
        ),
      )}

      {error ? (
        <p
          role="alert"
          className="mt-2 font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          {error}
        </p>
      ) : null}
    </QuestionFrame>
  );
}

/**
 * The only helper copy in the flow.
 *
 * §5 permits a helper "only when needed", and a multi-select genuinely needs
 * one: the participant must know how many they may choose BEFORE choosing, or
 * the limit feels arbitrary. Single-select needs no helper — the control
 * explains itself.
 *
 * The wording states the limit and nothing else. No advice about which options
 * to pick, which would be the coaching §5 forbids.
 */
function multiHelper(type: string): string {
  const limit = maxSelections(type);
  return limit === 1
    ? "Choose one."
    : `Choose up to ${limit}.`;
}
