"use client";

// UIUX §6, §8 S05 — multi-select answer control.
//
// CHECKBOX SEMANTICS for the same reason SingleSelectCard uses radios: the
// native control carries the state and the keyboard behaviour for free.
//
// EXCLUSIVE OPTIONS (§14). Q9_L ("no pressure") and Q21_G ("no significant fear
// friction") exclude every other selection on their item. The server enforces
// this — `checkSelection` rejects a mixed set with a 422 — so the UI clears the
// others when an exclusive option is chosen. WITHOUT THIS the participant could
// build a selection that is refused on Continue, which reads as the app being
// broken rather than the rule being real.
//
// The exclusivity rule is NOT explained to the participant. §14 is an internal
// consistency rule, and UIUX §5 forbids teaching copy during the assessment —
// clearing the others is simply how the control behaves.

import type { UiOption } from "@/lib/ui/questions";

export function MultiSelectCard({
  option,
  selected,
  onToggle,
}: {
  option: UiOption;
  selected: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <label
      className={[
        "block w-full cursor-pointer border px-6 py-5 transition-colors",
        selected ? "border-evergreen bg-white" : "border-blush/60 bg-white/60",
        "hover:border-evergreen/60",
      ].join(" ")}
      style={{ borderRadius: "2px" }}
    >
      <input
        type="checkbox"
        value={option.code}
        checked={selected}
        onChange={() => onToggle(option.code)}
        className="peer sr-only"
      />
      <span className="flex items-start gap-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-evergreen">
        <span
          aria-hidden="true"
          className={[
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center border",
            selected ? "border-evergreen bg-evergreen" : "border-rose/50",
          ].join(" ")}
          style={{ borderRadius: "2px" }}
        >
          {selected ? (
            // A check mark drawn in type rather than an icon font or SVG, so it
            // inherits colour and needs no asset.
            <span
              className="text-ivory"
              style={{ fontSize: "13px", lineHeight: "13px" }}
            >
              ✓
            </span>
          ) : null}
        </span>
        <span
          className="font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {option.label}
        </span>
      </span>
    </label>
  );
}
