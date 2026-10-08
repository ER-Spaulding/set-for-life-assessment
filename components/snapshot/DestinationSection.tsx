// SECTION 7 — WHAT "SET FOR LIFE" MEANS TO YOU.
//
// Reflects the participant's OWN Q16 selections back to them, unranked.
//
// UNRANKED IS THE RULE, AND IT IS STRUCTURAL HERE. The resolver maps
// `q16Selections` in payload order, and the shared section model turns them into
// blocks in that same order. This component renders them in the order it
// receives and applies NO ordering, sorting, weighting, or emphasis of its own.
// There is no "primary theme" concept in this file, so a participant can never
// see their own aspirations ranked by a renderer.
//
// The spec: "All selected themes display with equal dignity. No primary/secondary
// ranking unless the source question itself creates one." Q16 is a
// multiple-selection question and creates no ranking, so all themes are equal —
// and the layout reflects that by giving every theme the same treatment.
//
// "DESTINATION STILL FORMING" IS NEUTRAL. It is one of Q16's options and arrives
// as an ordinary resolved label like any other. This component does NOT special-
// case it: it gets no caveat, no explanatory note, no different styling, and no
// softer colour. Special-casing it would mark it as a lesser answer, which is
// exactly the judgment the spec forbids ("remains neutral").
//
// VARIABLE COUNT. The spec asks the layout to flex: 1 large feature, 2 equal,
// 3–4 two-column, 5+ a clean responsive grid without shrinking type. The grid
// below is driven by the ACTUAL count, and type size never drops with count —
// the themes wrap onto more rows instead.
//
// NOTHING IS INTERPRETED OR RE-WORDED. The labels are the participant's own
// selections, resolved from the pinned question bank. This section adds a
// framing line and nothing else: no advisor language, no scoring, no
// reinterpretation of what the participant said they want.

// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// Part of the middle-page RHYTHM pass. The themes are the participant's OWN
// words played back, so the refinement gives them the page's quietest
// stage: a Champagne hairline runs down the whole list as one continuous
// editorial column rather than each theme carrying an identical top rule, and
// the closing decorative band is removed (see FrictionSection for why the
// uniform bands had to go). Nothing about the themes, their order, or their
// equal treatment changes.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { SnapshotSection as Section } from "./SnapshotSection";

export function DestinationSection({ section }: { section: SnapshotSection }) {
  const themes = section.blocks;
  if (themes.length === 0) return null;

  // Column count follows the ACTUAL item count. `md:grid-cols-2` for 3–4 keeps
  // the reading measure comfortable; 5+ stays at two columns and simply wraps,
  // rather than squeezing into three or four narrow columns.
  const twoCol = themes.length >= 3;

  return (
    <Section title={section.heading} intro={section.intro} id="destination">
      {/* ⚠️ ONE `<ul>` OF ONE `<li>` PER THEME, AND NOTHING ELSE THAT IS AN
          `<li>` ANYWHERE IN THIS SECTION. The render guard reads
          `section.querySelectorAll("li")` (descendant, not scoped to this list)
          and asserts the array equals the Q16 labels in payload order — so a
          decorative `<li>`, or a second list, would corrupt that comparison. */}
      <ul
        className={`mt-12 grid list-none grid-cols-1 gap-x-16 gap-y-10 ${
          twoCol ? "md:grid-cols-2" : ""
        }`}
      >
        {themes.map((theme, i) => (
          <li
            key={i}
            // Every theme gets the same treatment — no index-based emphasis.
            // The Champagne rule is a LEFT border rather than a top one, so the
            // column reads as a single continuous editorial list instead of a
            // stack of identical capped boxes.
            className="border-l border-champagne pl-6 font-serif text-evergreen"
            style={{
              fontSize:
                themes.length === 1 ? "var(--type-t05-size)" : "var(--type-t10-size)",
              lineHeight:
                themes.length === 1 ? "var(--type-t05-line)" : "var(--type-t10-line)",
            }}
          >
            {theme.body}
          </li>
        ))}
      </ul>

      {/* The governed closing synthesis (the section model's `outro`): present
          only when this participant's exact Q16 selection set has an authored
          synthesis — never manufactured (Owner §9/§10). Rendered OUTSIDE the
          single `<ul>`, so the li-count guard is unaffected. */}
      {(section.outro ?? []).map((p, i) => (
        <p
          key={i}
          className="prose-measure mt-10 font-serif text-obsidian"
          style={{ fontSize: "20px", lineHeight: "32px" }}
        >
          {p}
        </p>
      ))}
    </Section>
  );
}
