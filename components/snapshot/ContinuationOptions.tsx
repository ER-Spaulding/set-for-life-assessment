// THE APPROVED CONTINUATION CHOICES — "YOU DECIDE WHAT HAPPENS NEXT."
//
// ⚠️ WHY THIS SECTION STILL RENDERS, AND A DECISION FOR THE OWNER TO CONFIRM.
//
// The owner's visual-implementation directive enumerates twelve sections, and
// this is not one of them. It would have been easy to let it disappear: the
// single-file renderer that this phase replaced was the only thing rendering it,
// and nothing else would have broken. Dropping it silently would have been
// wrong, for a reason that matters more than tidiness.
//
// This module is APPROVED, CONFIG-DRIVEN participant content
// (config/report-v1.0.json, screen `continuation`, PRD §20 Final / §21, UIUX
// S21) whose own config note sets a hard rule:
//
//   "Full results delivered before continuation choices. All choices comparable
//    visual dignity; NOT_RIGHT_NOW never punished or hidden. Never preselect
//    from A4."
//
// It carries the participant's NON-promotional next steps — including
// "Not Right Now". The new Section 10 is a promotional invitation to the
// Masterclass. If the continuation choices were removed while that invitation
// was added, the Masterclass would become the ONLY way to "continue", and
// "Not Right Now" would vanish. That is precisely the outcome the owner's own
// directives guard against ("Do not dynamically pressure the participant").
//
// So it renders. IT IS PLACED AFTER SECTION 11 and BEFORE Section 12, which
// keeps the owner's numbered §10 → §11 order intact and leaves no CTA after the
// footer's disclosure. If the owner intends these choices to be retired in the
// new design, this component is the whole of it — deleting the one `<ContinuationOptions />`
// line in results-view.tsx removes it cleanly, and the config entry stays
// reserved. Flagged in the phase report rather than decided unilaterally.
//
// THE CONFIG'S RULES, AS CODE:
//   - ALL FOUR render, in config order. No sorting, no emphasis, no badges.
//   - NOTHING IS PRESELECTED — there is no selected state in this component, and
//     no `autoFocus`. (`preselect` is null for every option today; if a future
//     config ever populated it, this component would still ignore it, because
//     the rule is about NOT steering the participant.)
//   - NOTHING IS HIDDEN, INCLUDING "NOT_RIGHT_NOW" — the renderer does not read
//     the `hidden` flag. Hiding is the UIUX §22 behaviour the config forbids.
//   - A4 NEVER INFLUENCES THIS. The component receives no participant state at
//     all — there is no prop an activation level could arrive through.

import reportConfig from "@/config/report-v1.0.json";

interface ContinuationScreen {
  id: string;
  title: string;
  continuation_options?: Array<{ code: string; label: string }>;
}

const SCREENS = reportConfig.screens as unknown as ContinuationScreen[];

const CONTINUATION = SCREENS.find((s) => s.id === "continuation");

/** The approved heading and options, from the report config (single source). */
const HEADING = CONTINUATION?.title ?? "";
const OPTIONS = CONTINUATION?.continuation_options ?? [];

export function ContinuationOptions() {
  if (OPTIONS.length === 0) return null;

  return (
    <section className="mt-24 border-t border-blush pt-12 lg:mt-32" id="continuation">
      <h2
        className="font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
      >
        {HEADING.toUpperCase()}
      </h2>

      <ul className="mt-8 flex list-none flex-col gap-4">
        {OPTIONS.map((option) => (
          <li
            key={option.code}
            className="border-b border-champagne py-4 font-serif text-evergreen"
            style={{
              fontSize: "var(--type-t10-size)",
              lineHeight: "var(--type-t10-line)",
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
