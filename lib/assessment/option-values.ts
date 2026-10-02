// Option-code → numeric value resolution. PURE — no I/O, no server-only.
//
// WHY THIS IS ITS OWN MODULE. These functions used to live in
// `lib/session/service.ts`, which begins with `import "server-only"`. That is
// correct for the file — it holds the service client — but it meant the only way
// to test the resolution logic was through the whole server stack. When a test
// called `numericItems` directly it failed with "This module cannot be imported
// from a Client Component module", so the function could not be exercised at all
// in a plain test.
//
// That mattered, because a mutated `numericItems` — one that ignores its
// arguments and returns a hardcoded scale — passed every test in the suite. The
// logic was untestable in isolation and therefore untested. Moving it here makes
// the one thing that decides what a participant's answer is *worth* directly
// callable.

import type { ScoringTables } from "./scoring";

/**
 * The option letter → number scale, READ FROM CONFIG.
 *
 * THE DEFECT THIS REPLACES. `lib/session/service.ts` carried a hardcoded
 * `LETTER_VALUES = { A:1, B:2, C:3, D:4, E:5, F:5 }` while `scoring.ts` read
 * `option_value_maps.profile_1_5` from the config for signal averages. Two
 * sources for one scale — and they did not agree. The config deliberately maps
 * the capacity-override options to `null` (`Q12_F: null`, `Q11_A: null`) to
 * EXCLUDE them; the hardcoded map invented `F: 5`, the HIGHEST value, for an
 * option the config says carries no numeric evidence at all.
 *
 * The visible consequence was in corroboration: `confidenceFor()` counts
 * contributing items via `items[q] !== undefined`, and its own comment says an
 * item that "maps to null … is correctly absent from `items`, so it cannot
 * corroborate". That was untrue for `Q12_F` — a participant saying "there
 * usually isn't enough flexibility in my finances" was counted as supplying
 * numeric DIRECT evidence, inflating the count that selects HIGH / MODERATE /
 * LIMITED language.
 *
 * So there is now ONE source: the config. An option that maps to `null` is
 * absent from the result, and absence is what the corroboration check reads.
 */
export function numericItems(
  letters: Record<string, string>,
  values: ScoringTables["values"],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, letter] of Object.entries(letters)) {
    // WHICH SCALE APPLIES TO WHICH ITEM, taken from the config rather than
    // assumed. Q11 and Q12 carry capacity overrides the generic profile scale
    // does not express; Q18 has its own copy of the profile scale. Everything
    // else uses `profile`.
    //
    // An item with no scale at all (the classifier-only Q1, Q9, Q16, Q21)
    // simply contributes nothing — the same outcome the old code reached by
    // accident, but now for a stated reason.
    const scale =
      item === "Q11" ? values.q11
      : item === "Q12" ? values.q12
      : item === "Q18" ? values.q18
      : values.profile;

    // `loadScoringTables` normalises every key to a bare letter — the config's
    // "Q12_F" becomes "F" — so the lookup is by letter. There is no full-code
    // fallback because it could never fire; an earlier draft carried one and it
    // was dead on arrival.
    const raw = scale?.[letter];
    // Only NUMBERS enter the map. `null` — the config's way of saying "this
    // option carries no numeric evidence" — stays out.
    if (typeof raw === "number") out[item] = raw;
  }
  return out;
}

/** Extract the trailing option letter from a code like "Q11_A". */
export function letterOf(code: string): string {
  const idx = code.lastIndexOf("_");
  return idx === -1 ? code : code.slice(idx + 1);
}

/**
 * Reduce a response map to the single option letter the scorer needs per item.
 *
 * Multi-select items contribute their FIRST selection in stored order; the
 * scoring config decides which items actually carry a numeric value, so items
 * that are classifier-only (Q1, Q9, Q16, Q21) are ignored by the formulas
 * regardless of what this returns.
 */
export function toLetterMap(responses: Record<string, unknown>): Record<string, string> {
  const letters: Record<string, string> = {};
  for (const [item, value] of Object.entries(responses)) {
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string") letters[item] = letterOf(first);
    } else if (typeof value === "string") {
      letters[item] = letterOf(value);
    }
  }
  return letters;
}
