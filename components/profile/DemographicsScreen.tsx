"use client";

// Demographics / Participant Profile — the optional step near the end.
//
// GOVERNING REQUIREMENTS (operator, 2026-10-01):
//   * render Age, Gender, Approximate Household Income, State/Jurisdiction;
//   * "Preserve all previously approved Prefer not to say behavior and the
//      established distinction between demographic/profile information and
//      diagnostic responses";
//   * State/Jurisdiction "must have zero effect on scoring, interpretation,
//      friction findings, Activation, Perception Gap, or the Set for Life Money
//      Picture";
//   * "must not change the requirement of 31 required assessment responses";
//   * "Follow the approved Set for Life UI/UX system rather than presenting this
//      as a generic form."
//
// WHY IT IS NOT A GENERIC FORM. The UIUX system is editorial: a single column,
// generous whitespace, Cormorant for the question and Playfair for structure,
// one decision per block, and thin rules rather than boxes. A four-column grid of
// inputs would read as an administrative form and signal that this is paperwork —
// which is exactly what the diagnostic questions are carefully NOT. So each
// question is its own editorial block with its own rule, and the options are
// stacked rows, matching SingleSelectCard's idiom.
//
// EVERY ITEM IS OPTIONAL, AND THE COPY SAYS SO. Nothing here is required for
// completion, and the screen never implies otherwise — no asterisks, no
// "required" markers, and the continue action is always available. A participant
// who skips the whole step loses nothing they have already given.
//
// "PREFER NOT TO SAY" IS PRESERVED EXACTLY. It is an option on every question
// (D1_H, D2_D, D3_H, D4_PREFER_NOT_TO_SAY), not an absence — the same behaviour
// already established for the State field and D1–D3. Declining is a recorded
// answer, so a refusal is never indistinguishable from an unanswered question.

import { useState } from "react";
import bank from "../../config/assessment-v1.0.json";
import { JURISDICTIONS, PREFER_NOT_TO_SAY } from "@/lib/profile/jurisdiction";

interface Option {
  code: string;
  label: string;
}
interface Item {
  internal_id: string;
  prompt: string;
  supporting_copy?: string;
  options: Option[];
  options_source?: string;
}

const ITEMS = bank.demographics as Item[];

/** One editorial block: rule, question, optional support line, stacked options. */
function Block({
  item,
  selected,
  onSelect,
  children,
}: {
  item: Item;
  selected: string | null;
  onSelect: (code: string) => void;
  children?: React.ReactNode;
}) {
  // D4's options come from the controlled jurisdiction list, not the config's
  // single sentinel entry — the list lives in one place so the selector, the API
  // validation and the DB constraint cannot drift.
  const options: Option[] =
    item.options_source === "jurisdictions"
      ? [
          ...JURISDICTIONS.map((j) => ({ code: j.code, label: j.name })),
          { code: PREFER_NOT_TO_SAY, label: "Prefer not to say" },
        ]
      : item.options;

  return (
    <fieldset className="mt-12 border-0 p-0">
      <legend className="w-full">
        <div className="w-full border-t border-blush/70" aria-hidden="true" />
        <p
          className="mt-5 font-display text-evergreen"
          style={{
            fontSize: "var(--type-t06-size)",
            lineHeight: "var(--type-t06-line)",
            textWrap: "balance",
          }}
        >
          {item.prompt}
        </p>
      </legend>

      {item.supporting_copy ? (
        <p
          className="prose-measure mt-3 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {item.supporting_copy}
        </p>
      ) : null}

      {/* A long list (56 jurisdictions) would be an unusable wall of rows, so D4
          uses the existing controlled <select> instead. The other three are
          short enough to show in full, which is faster than opening a control. */}
      {item.options_source === "jurisdictions" ? (
        <div className="mt-5">{children}</div>
      ) : (
        <div className="mt-5 flex max-w-[560px] flex-col gap-3">
          {options.map((o) => {
            const isSelected = selected === o.code;
            return (
              <button
                key={o.code}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(o.code)}
                className={[
                  "w-full border px-5 py-4 text-left font-body transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen",
                  isSelected
                    ? "border-evergreen bg-ivory text-evergreen"
                    : "border-blush/60 bg-white text-obsidian hover:border-evergreen",
                ].join(" ")}
                style={{
                  borderRadius: "2px",
                  fontSize: "18px",
                  lineHeight: "29px",
                  minHeight: "56px",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {/* D2_C is "Prefer to self-describe: ________" — the trailing blank in the
          approved label is a text affordance, so it gets a real field rather
          than being rendered as a dead underscore. */}
      {item.internal_id === "D2" && selected === "D2_C" ? children : null}
    </fieldset>
  );
}

export function DemographicsScreen({
  onSubmit,
  onSkip,
  saving = false,
  error = null,
}: {
  onSubmit: (values: {
    ageRange: string | null;
    gender: string | null;
    genderSelfDescribe: string | null;
    householdIncome: string | null;
    stateCode: string | null;
  }) => void;
  onSkip: () => void;
  saving?: boolean;
  error?: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selfDescribe, setSelfDescribe] = useState("");

  const set = (id: string, code: string) =>
    setAnswers((prev) => ({ ...prev, [id]: code }));

  const d4 = ITEMS.find((i) => i.internal_id === "D4");

  return (
    <main className="surface-ivory flex min-h-screen w-full flex-col px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[720px]">
        <p
          className="font-body uppercase text-rose"
          style={{ fontSize: "16px", lineHeight: "24px", fontWeight: 600, letterSpacing: "0.14em" }}
        >
          A few optional questions
        </p>

        <h1
          className="mt-5 font-display text-evergreen"
          style={{
            fontSize: "var(--type-t03-size)",
            lineHeight: "var(--type-t03-line)",
            textWrap: "balance",
          }}
        >
          Before your Snapshot, a little about you.
        </h1>

        {/* States plainly that none of this is required, and why it is asked.
            §8B restraint: no exclamation, no persuasion. */}
        <p
          className="prose-measure mt-5 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          These questions are optional and separate from your assessment. They do
          not change your results in any way. Answer whatever you are comfortable
          with — or skip and go straight to your Snapshot.
        </p>

        {ITEMS.map((item) => (
          <Block
            key={item.internal_id}
            item={item}
            selected={answers[item.internal_id] ?? null}
            onSelect={(code) => set(item.internal_id, code)}
          >
            {item.internal_id === "D2" ? (
              <div className="mt-4 max-w-[560px]">
                <label
                  htmlFor="gender-self-describe"
                  className="block font-body text-rose"
                  style={{ fontSize: "16px", lineHeight: "24px" }}
                >
                  In your words
                </label>
                <input
                  id="gender-self-describe"
                  name="genderSelfDescribe"
                  type="text"
                  className="mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
                  style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
                  value={selfDescribe}
                  onChange={(e) => setSelfDescribe(e.target.value)}
                />
              </div>
            ) : null}

            {d4 && item.internal_id === "D4" ? (
              <select
                id="participant-state"
                name="state"
                aria-label={d4.prompt}
                className="w-full max-w-[420px] border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
                style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px", minHeight: "56px" }}
                value={answers["D4"] ?? ""}
                onChange={(e) => set("D4", e.target.value)}
              >
                <option value="">Select a state or jurisdiction</option>
                {JURISDICTIONS.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.name}
                  </option>
                ))}
                <option value={PREFER_NOT_TO_SAY}>Prefer not to say</option>
              </select>
            ) : null}
          </Block>
        ))}

        <div className="mt-14 flex flex-wrap items-center gap-5">
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              onSubmit({
                ageRange: answers["D1"] ?? null,
                gender: answers["D2"] ?? null,
                genderSelfDescribe:
                  answers["D2"] === "D2_C" ? selfDescribe.trim() || null : null,
                householdIncome: answers["D3"] ?? null,
                // D4's decline is the sentinel, matching the State field's
                // established behavior — a refusal is recorded, not dropped.
                stateCode: answers["D4"] ?? null,
              })
            }
            className={[
              "px-8 py-4 font-serif transition-colors",
              saving
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
            {saving ? "Saving…" : "Continue to my Snapshot"}
          </button>

          {/* Always available, and never framed as a loss — the participant has
              already given everything the assessment needed. */}
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="font-serif text-rose underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{ fontSize: "20px", lineHeight: "28px", minHeight: "44px" }}
          >
            Skip for now
          </button>
        </div>

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

export default DemographicsScreen;
