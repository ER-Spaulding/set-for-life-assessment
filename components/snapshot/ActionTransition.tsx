// THE EDITORIAL PAUSE — between the last interpretation module (§9) and the
// continuation campaign (§10).
//
// ⚠️ WHAT THIS IS, AND WHAT THE BRIEF THOUGHT IT WAS.
//
// The refinement brief asks to rework "the current 'Turn Information Into
// Action' treatment" into "a deliberate editorial pause between interpretation
// and continuation". There is no such block in the build. "TURN INFORMATION
// INTO ACTION" is a §9 ATTENTION-AREA label — participant-specific content the
// resolver produces from the participant's own answers — and it renders inside
// Section 9 as the primary label. It is not chrome and cannot become a
// transition. (See lib/ui/snapshot-web-copy.ts ACTION_TRANSITION_STATEMENT for
// the full note.)
//
// So this component is a NEW element, added because the underlying observation
// in the brief is right: the page jumps from diagnosis straight into an
// invitation, and that seam wants a pause. It is deliberately the lightest
// element on the page —
//
//   - no campaign copy, no offer, no product mention, no onward link;
//   - no participant data: it receives NO props at all, so it cannot vary with
//     an assessment result (the same structural guarantee §10 relies on);
//   - generous whitespace, one statement, one decorative rule.
//
// THE COPY IS OWNER-APPROVED — sample §9 of the approved narrative-rewrite
// standard (2026-10-07), verbatim in ACTION_TRANSITION_LINES. It is canonical
// constants rather than inline literals so the copy-provenance rule holds and
// the string-membership guard can attribute each line.
//
// ⚠️ IT IS NOT A `<section>` WITH A HEADING, ON PURPOSE. The render guards
// assert the page's `<h2>` elements are exactly the eight model modules plus the
// known page chrome; adding a heading here would put an unenumerated `<h2>` into
// the document and fail the heading checks. The statement is a `<p>` — which is
// also the honest markup for a pull-quote.

import { ACTION_TRANSITION_LINES } from "@/lib/ui/snapshot-web-copy";

export function ActionTransition() {
  const [lead, ...supporting] = ACTION_TRANSITION_LINES;
  return (
    // A plain <div>, NOT a <section> — see the landmark note above.
    <div className="mt-24 lg:mt-32" data-action-transition>
      {/* A centred Gold rule opens the pause. Decorative; no text. */}
      <div aria-hidden="true" role="presentation" className="section-rule mx-auto" />

      <p
        className="mx-auto mt-10 max-w-[720px] text-center font-serif text-evergreen"
        style={{
          fontSize: "var(--type-t05-size)",
          lineHeight: "var(--type-t05-line)",
          textWrap: "balance",
        }}
      >
        {lead}
      </p>
      {supporting.map((line) => (
        <p
          key={line}
          className="mx-auto mt-4 max-w-[720px] text-center font-body text-obsidian/90"
          style={{ fontSize: "17px", lineHeight: "28px" }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
