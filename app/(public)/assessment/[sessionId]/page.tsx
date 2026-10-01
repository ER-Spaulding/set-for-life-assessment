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
  isMultiSelect,
  maxSelections,
  type UiQuestion,
} from "@/lib/ui/questions";
import { QuestionFrame } from "@/components/assessment/QuestionFrame";
import { SingleSelectCard } from "@/components/assessment/SingleSelectCard";
import { MultiSelectCard } from "@/components/assessment/MultiSelectCard";
import { TransitionScreen } from "@/components/assessment/TransitionScreen";

/** Where the activation transition sits (UIUX §8 S07). */
const ACTIVATION_FIRST_INDEX = QUESTION_SEQUENCE.findIndex((q) =>
  q.internal_id.startsWith("A"),
);

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransition, setShowTransition] = useState(false);
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
        const firstUnanswered = QUESTION_SEQUENCE.findIndex(
          (q) => !(restored[q.internal_id]?.length > 0),
        );
        if (firstUnanswered > 0) setIndex(firstUnanswered);
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
    router.push(`/assessment/${sessionId}/complete`);
  }, [persist, index, showTransition, router, sessionId]);

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
      onBack={index > 0 ? () => setIndex(index - 1) : undefined}
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
