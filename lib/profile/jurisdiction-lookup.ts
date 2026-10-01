// Set for Life Number — lookup-side normalization and validation.
//
// Mirrors the `normalize_sfl_number` / `is_valid_sfl_number` SQL functions in
// migration ...0004. The database is the authority; this exists so the route can
// distinguish MALFORMED from ABSENT before paying for a query, and so the
// behaviour is testable without a database.
//
// WHY THE TWO MUST AGREE: if the app normalised differently from the SQL, a
// number could validate here and then fail to match a row that the database
// considered identical — producing a lookup that reports "not found" for a
// number that exists. tests/unit/sfl-number-lookup.test.ts cross-checks the
// alphabet and the folding rules against the migration so the two cannot drift.

/** Crockford Base32: digits plus A–Z with I, L, O and U removed. */
export const SFL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const ALPHABET_SET = new Set(SFL_ALPHABET.split(""));

/**
 * Canonical form: separators stripped, Crockford confusions folded.
 *
 * Folds O→0 and I/L→1 AFTER uppercasing, because those are the substitutions a
 * participant makes while reading their number off a screen — and the alphabet
 * excludes I, L and O precisely so a folded value is always unambiguous.
 */
export function normalizeSflNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  // Strip every non-alphanumeric separator at once: dash, space, en/em dash, and
  // the non-breaking space a paste from a web page can carry.
  const joined = upper.replace(/[^0-9A-Z]/g, "");
  if (joined === "") return null;
  return joined.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/**
 * The check character for a 7-character body — the same positional weighted sum
 * as `sfl_number_check` in SQL.
 *
 * Weights 1..7 mean swapping characters at positions i and i+1 changes the sum
 * by exactly (b - a), so adjacent transpositions are detected unless the two
 * characters are identical. Adjacent transposition is the most common typing
 * error, which is why the weights are positional rather than a plain sum.
 */
export function sflCheckCharacter(body: string): string | null {
  if (body.length !== 7) return null;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const idx = SFL_ALPHABET.indexOf(body[i]);
    if (idx < 0) return null; // outside the alphabet
    sum += idx * (i + 1);
  }
  return SFL_ALPHABET[sum % 32];
}

export type SflLookup =
  | { kind: "ok"; normalized: string }
  | { kind: "absent" }
  | { kind: "malformed" };

/**
 * Classify a submitted number.
 *
 *   ok        — well-formed, with a matching check character
 *   absent    — nothing submitted
 *   malformed — wrong length, out-of-alphabet, or failing its checksum
 *
 * The malformed/absent split is what lets the route say "check the number"
 * rather than sending the participant down a verification path for a value that
 * cannot possibly be theirs.
 */
export function normalizeJurisdictionSafe(raw: unknown): SflLookup {
  const normalized = normalizeSflNumber(raw);
  if (normalized === null) return { kind: "absent" };
  if (normalized.length !== 8) return { kind: "malformed" };
  if (![...normalized].every((c) => ALPHABET_SET.has(c))) return { kind: "malformed" };

  const expected = sflCheckCharacter(normalized.slice(0, 7));
  if (expected === null || expected !== normalized[7]) return { kind: "malformed" };

  return { kind: "ok", normalized };
}

/** Display form: XXXX-XXXX. */
export function formatSflNumber(normalized: string): string {
  return normalized.length === 8
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}
