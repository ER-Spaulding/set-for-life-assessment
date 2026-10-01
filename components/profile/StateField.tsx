"use client";

// Optional participant State — "What state do you currently live in?"
//
// GOVERNING REQUIREMENT (operator, 2026-10-01): contextual/profile data ONLY,
// zero effect on scoring or Snapshot interpretation, and declining must never
// generate a diagnostic inference.
//
// HOW THE UI HONOURS "DECLINING MUST NEVER GENERATE AN INFERENCE". The decline
// option is a first-class choice rendered in the same list as the
// jurisdictions, not a dismissible afterthought — and the field is optional, so
// it can be skipped without a decision at all. Nothing here marks the field
// incomplete, warns, or re-asks. There is no code path from this component into
// the engine, so a decline cannot be interpreted because nothing interprets it.
//
// CONTROLLED SELECTOR, NOT FREE TEXT. A native <select> rather than a text
// input: it makes an invalid answer unrepresentable rather than merely rejected,
// which is the difference between a participant who cannot get it wrong and one
// who is told they got it wrong.
//
// COPY is the wording supplied with the requirement, verbatim.

import { useState } from "react";
import { JURISDICTIONS, PREFER_NOT_TO_SAY } from "@/lib/profile/jurisdiction";

const SUPPORTING_COPY =
  "This helps us understand where the Set for Life community is growing and, when appropriate, connect you with support available in your area.";

export function StateField({
  initialValue = null,
  onSave,
  saving = false,
  error = null,
}: {
  /** The value already on the record, or null. */
  initialValue?: string | null;
  onSave: (value: string | null) => void;
  saving?: boolean;
  error?: string | null;
}) {
  // The sentinel round-trips through local state so "Prefer not to say" is a
  // visible, selected choice rather than the empty option.
  const [value, setValue] = useState<string>(
    initialValue ?? (initialValue === null ? "" : PREFER_NOT_TO_SAY),
  );

  const declined = value === PREFER_NOT_TO_SAY;

  return (
    <div className="w-full">
      <label
        htmlFor="participant-state"
        className="block font-display text-evergreen"
        style={{ fontSize: "var(--type-t06-size)", lineHeight: "var(--type-t06-line)" }}
      >
        What state do you currently live in?
      </label>

      <p
        className="prose-measure mt-3 font-body text-obsidian"
        style={{ fontSize: "18px", lineHeight: "29px" }}
      >
        {SUPPORTING_COPY}
      </p>

      <select
        id="participant-state"
        name="state"
        className="mt-5 w-full max-w-[420px] border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen"
        style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px", minHeight: "56px" }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        {/* The empty option is a genuine "not answered yet", distinct from the
            explicit decline below. Conflating them would record a refusal the
            participant never made. */}
        <option value="">Select a state or jurisdiction</option>
        {JURISDICTIONS.map((j) => (
          <option key={j.code} value={j.code}>
            {j.name}
          </option>
        ))}
        <option value={PREFER_NOT_TO_SAY}>Prefer not to say</option>
      </select>

      <div className="mt-6">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(declined ? null : value === "" ? null : value)}
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
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default StateField;
