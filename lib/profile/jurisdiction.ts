// Optional participant State — the controlled jurisdiction list and its
// normalisation. Contextual/profile data ONLY.
//
// ZERO-COUPLING CONTRACT (operator requirement, 2026-10-01):
//
//   "It must have zero effect on diagnostic scoring, the six Money Picture
//    signals, friction determination, Perception Gap, Activation, or Snapshot
//    interpretation."
//
// This module is deliberately NOT imported by anything under lib/assessment/,
// and `state_code` is never read by the Snapshot assembler. The zero-effect
// property is therefore structural rather than a promise someone has to
// remember: there is no code path from here into the engine. If a future change
// ever imports this into scoring, that is the moment the requirement breaks, and
// tests/unit/participant-state.test.ts fails loudly when it does.
//
// WHY NORMALISATION LIVES HERE AND NOT IN THE DATABASE.
//
// The DB enforces the controlled list via a foreign key, which is correct — but
// it means "  ca  " is REJECTED, not cleaned. A participant typing a lowercase
// code from a printed list, or a client sending a padded value, would get a
// write error for a perfectly valid answer. Normalising in one place before the
// write keeps the constraint strict AND the participant unblocked.
//
// Pure functions. No I/O.

/**
 * USPS two-letter codes for the 50 states, DC, and the inhabited territories.
 *
 * Mirrors the `jurisdictions` table exactly. Kept as a literal here because the
 * client needs the list to render the selector without a round trip, and because
 * a mismatch between the two would be caught by
 * tests/unit/participant-state.test.ts rather than discovered in production.
 *
 * Territories are included deliberately: the requirement said "jurisdiction",
 * which is broader than "state". Omitting them would silently make a Puerto Rico
 * participant unable to answer truthfully.
 */
export const JURISDICTIONS: ReadonlyArray<{ code: string; name: string; kind: "state" | "district" | "territory" }> = Object.freeze([
  { code: "AL", name: "Alabama", kind: "state" },
  { code: "AK", name: "Alaska", kind: "state" },
  { code: "AZ", name: "Arizona", kind: "state" },
  { code: "AR", name: "Arkansas", kind: "state" },
  { code: "CA", name: "California", kind: "state" },
  { code: "CO", name: "Colorado", kind: "state" },
  { code: "CT", name: "Connecticut", kind: "state" },
  { code: "DE", name: "Delaware", kind: "state" },
  { code: "DC", name: "District of Columbia", kind: "district" },
  { code: "FL", name: "Florida", kind: "state" },
  { code: "GA", name: "Georgia", kind: "state" },
  { code: "HI", name: "Hawaii", kind: "state" },
  { code: "ID", name: "Idaho", kind: "state" },
  { code: "IL", name: "Illinois", kind: "state" },
  { code: "IN", name: "Indiana", kind: "state" },
  { code: "IA", name: "Iowa", kind: "state" },
  { code: "KS", name: "Kansas", kind: "state" },
  { code: "KY", name: "Kentucky", kind: "state" },
  { code: "LA", name: "Louisiana", kind: "state" },
  { code: "ME", name: "Maine", kind: "state" },
  { code: "MD", name: "Maryland", kind: "state" },
  { code: "MA", name: "Massachusetts", kind: "state" },
  { code: "MI", name: "Michigan", kind: "state" },
  { code: "MN", name: "Minnesota", kind: "state" },
  { code: "MS", name: "Mississippi", kind: "state" },
  { code: "MO", name: "Missouri", kind: "state" },
  { code: "MT", name: "Montana", kind: "state" },
  { code: "NE", name: "Nebraska", kind: "state" },
  { code: "NV", name: "Nevada", kind: "state" },
  { code: "NH", name: "New Hampshire", kind: "state" },
  { code: "NJ", name: "New Jersey", kind: "state" },
  { code: "NM", name: "New Mexico", kind: "state" },
  { code: "NY", name: "New York", kind: "state" },
  { code: "NC", name: "North Carolina", kind: "state" },
  { code: "ND", name: "North Dakota", kind: "state" },
  { code: "OH", name: "Ohio", kind: "state" },
  { code: "OK", name: "Oklahoma", kind: "state" },
  { code: "OR", name: "Oregon", kind: "state" },
  { code: "PA", name: "Pennsylvania", kind: "state" },
  { code: "RI", name: "Rhode Island", kind: "state" },
  { code: "SC", name: "South Carolina", kind: "state" },
  { code: "SD", name: "South Dakota", kind: "state" },
  { code: "TN", name: "Tennessee", kind: "state" },
  { code: "TX", name: "Texas", kind: "state" },
  { code: "UT", name: "Utah", kind: "state" },
  { code: "VT", name: "Vermont", kind: "state" },
  { code: "VA", name: "Virginia", kind: "state" },
  { code: "WA", name: "Washington", kind: "state" },
  { code: "WV", name: "West Virginia", kind: "state" },
  { code: "WI", name: "Wisconsin", kind: "state" },
  { code: "WY", name: "Wyoming", kind: "state" },
  { code: "AS", name: "American Samoa", kind: "territory" },
  { code: "GU", name: "Guam", kind: "territory" },
  { code: "MP", name: "Northern Mariana Islands", kind: "territory" },
  { code: "PR", name: "Puerto Rico", kind: "territory" },
  { code: "VI", name: "U.S. Virgin Islands", kind: "territory" },
]);

const CODES = new Set(JURISDICTIONS.map((j) => j.code));

/**
 * The stored value when a participant declines.
 *
 * OPERATOR DECISION 2026-10-01: "'Prefer not to say' remains an explicit valid
 * response, not null."
 *
 * So the decline is a VALUE, not an absence. That distinction is the whole point:
 * a NULL column cannot distinguish "the participant was asked and declined" from
 * "the participant was never asked", and those are different facts. Collapsing
 * them would make a refusal indistinguishable from missing data — and would let
 * a later backfill quietly convert one into the other.
 *
 * It also matches D1–D3 in the instrument config, where every demographic item
 * carries its own explicit "Prefer not to say" option rather than relying on an
 * empty answer.
 *
 * This string is NOT a jurisdiction code and cannot be mistaken for one: the
 * `jurisdictions` table has no such row, and the foreign key would reject it if
 * someone tried to store it as a code. Persisting it therefore requires the
 * explicit carve-out below rather than happening by accident.
 */
export const PREFER_NOT_TO_SAY = "PREFER_NOT_TO_SAY";

/**
 * Normalise a submitted value.
 *
 *   a jurisdiction code -> that code ("CA")
 *   a decline           -> PREFER_NOT_TO_SAY  (an explicit value, NOT null)
 *   an empty submission -> null                (not asked; not a refusal)
 *   anything else       -> undefined           (invalid; caller must reject)
 *
 * The empty case is deliberately distinct from the decline. A blank field means
 * the participant has not answered yet, which must not be recorded as a refusal
 * they never made; the UI sends the explicit sentinel only when they choose it.
 *
 * Returning `null` for invalid input would silently record a typo as missing
 * data, and returning PREFER_NOT_TO_SAY for it would record a refusal that never
 * happened. Both corrupt the field this exists to collect, so invalid input
 * returns `undefined` and the caller 400s.
 */
export function normalizeJurisdiction(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed === PREFER_NOT_TO_SAY) return PREFER_NOT_TO_SAY;

  const upper = trimmed.toUpperCase();
  return CODES.has(upper) ? upper : undefined;
}

/** True when the stored value is an explicit decline rather than a jurisdiction. */
export function isDeclined(value: string | null | undefined): boolean {
  return value === PREFER_NOT_TO_SAY;
}

/** Display name for a code, or null when unknown. */
export function jurisdictionName(code: string | null): string | null {
  if (!code) return null;
  return JURISDICTIONS.find((j) => j.code === code)?.name ?? null;
}
