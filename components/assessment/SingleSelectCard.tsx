"use client";

// UIUX §6, §8 S04 — single-select answer control.
//
// RADIO SEMANTICS, NOT BUTTONS. A single-select question is a radio group, and
// rendering it as one means arrow-key navigation, grouping, and the correct
// announcement all work without custom code. The visible control is a styled
// card, so the native input is visually hidden but still focusable and still
// the thing that carries state.
//
// FOCUS VISIBILITY. The hidden input's focus is projected onto the card via
// `peer-focus-visible`, so a keyboard user sees which card they are on. Without
// that, hiding the input would make keyboard navigation invisible — the most
// common failure of this pattern.
//
// NO TEXT TRUNCATION. Labels extend the card vertically rather than clamping
// (§ MANDATORY RULES: no line-clamp, no ellipsis, no shrinking to fit).

import type { UiOption } from "@/lib/ui/questions";

export function SingleSelectCard({
  name,
  option,
  selected,
  onSelect,
}: {
  /** Radio group name — one per question. */
  name: string;
  option: UiOption;
  selected: boolean;
  onSelect: (code: string) => void;
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
        type="radio"
        name={name}
        value={option.code}
        checked={selected}
        onChange={() => onSelect(option.code)}
        className="peer sr-only"
      />
      <span
        className="flex items-start gap-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-evergreen"
      >
        {/* Selection indicator. Decorative to assistive tech (the radio above
            already announces state), so aria-hidden. */}
        <span
          aria-hidden="true"
          className={[
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-evergreen" : "border-rose/50",
          ].join(" ")}
        >
          {selected ? (
            <span className="h-2.5 w-2.5 rounded-full bg-evergreen" />
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
