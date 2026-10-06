// THE HERO IMAGE SELECTION RULE — Addendum: the participant's EXPLICIT
// demographic gender response, and nothing else.
//
// WHY THIS MODULE EXISTS. The Section 1 hero is a real photograph of a person,
// and the Snapshot shows one of three approved images beside the participant's
// own words. Choosing between them is the ONLY place in this application where a
// participant-visible difference is driven by a demographic answer, so the rule
// is written down once, in one place, and made impossible to get subtly wrong in
// a renderer.
//
// THE RULE, VERBATIM FROM THE SPEC (§1 "Dynamic rules"):
//
//   "Gender response only: Female → approved Black woman hero; Male → approved
//    Black man hero; Prefer not to say / missing / unsupported → approved
//    neutral image ... Never infer gender from name, email, photo, age, or
//    other data."
//
// WHAT "NEVER INFER" MEANS HERE, AS CODE. This module has exactly one input: the
// stored `D2` option CODE (`participants`-side `demographics.gender`). It does
// not see — and cannot see — a first name, an email, an age, an assessment
// answer, or a self-describe string. There is no code path from those to a
// hero, because there is no parameter that could carry one. That is the same
// discipline `lib/render/snapshot-view.ts` applies to narrative keys: make the
// forbidden thing UNREPRESENTABLE rather than merely unused.
//
// `D2_C` ("Prefer to self-describe") deliberately resolves to NEUTRAL and its
// free-text `gender_self_describe` is NEVER read. Parsing a participant's own
// words to guess which photograph represents them would be precisely the
// inference the spec forbids, and a self-description is not a mapping onto the
// two approved images.
//
// UNKNOWN INPUT IS NEUTRAL, NOT AN ERROR. A missing row, a NULL column, a code
// from a future instrument revision — all resolve to the neutral hero. The
// Snapshot must render for every participant who completed the assessment; a
// demographic answer is not a precondition for seeing your own results.

/** The three approved Section 1 hero images, keyed by variant. */
export type HeroVariant = "female" | "male" | "neutral";

/**
 * The `D2` option code for "Woman", as pinned in config/assessment-v1.0.json.
 * Read through the question bank at test time; the constant here is the single
 * spelling the mapping uses.
 */
export const D2_WOMAN = "D2_A";

/** The `D2` option code for "Man", as pinned in config/assessment-v1.0.json. */
export const D2_MAN = "D2_B";

/**
 * Resolve the hero variant from the participant's EXPLICIT gender response.
 *
 * ONLY `D2_A` → female and `D2_B` → male. Everything else — including
 * `D2_C` (self-describe), `D2_D` (prefer not to say), NULL, empty, and any
 * unrecognised value — resolves to `neutral`. Total function: never throws,
 * never returns undefined, so a renderer can never be handed nothing to show.
 */
export function heroVariantForGender(gender: string | null | undefined): HeroVariant {
  if (gender === D2_WOMAN) return "female";
  if (gender === D2_MAN) return "male";
  return "neutral";
}

/**
 * The public path of the approved hero image for a variant.
 *
 * The filenames are the owner-supplied production assets, used EXACTLY as
 * delivered (public/images/snapshot/, committed in b382a0e). This module is the
 * one place the paths live, so a renderer cannot invent a fourth image or point
 * at a path that was never shipped.
 */
export const HERO_IMAGE: Readonly<Record<HeroVariant, string>> = {
  female: "/images/snapshot/section-01-hero-female-v1.png",
  male: "/images/snapshot/section-01-hero-male-v1.png",
  neutral: "/images/snapshot/section-01-hero-neutral-v1.png",
};

/**
 * Intrinsic dimensions of the approved hero assets (1122×1402), used to reserve
 * the correct space before the image loads so the editorial layout does not
 * shift. Declared here beside the paths so a future asset swap updates one file.
 */
export const HERO_INTRINSIC = { width: 1122, height: 1402 } as const;

/**
 * The hero image's alternative text.
 *
 * DELIBERATELY DESCRIPTIVE OF THE IMAGE, NOT OF THE PARTICIPANT. The hero's job
 * is to say "a person is here with you"; it is not a portrait OF the reader, and
 * a screen reader must not be told that it is. Every variant says the same
 * thing, so the text cannot become a disclosure about which image was chosen —
 * which would leak a demographic answer to anyone listening to the page.
 */
export const HERO_ALT = "A person considering their financial picture";
