// Owner rulings 2026-10-02 (binding, applied verbatim) — the PDF document's
// fixed, APPROVED participant-facing copy: the cover, the standardized footer,
// and the educational disclosure.
//
// These strings are NOT payload-derived. They are NOT part of the resolver's
// payload->copy contract, and they do NOT belong in a narrative library — they
// are DOCUMENT FURNITURE, fixed by ruling, exactly like lib/ui/reveal-copy.ts
// holds the reveal's locked instrument copy. Keeping them in ONE module means
// the web renderer and the PDF renderer cannot drift apart on the strings they
// share (the cover title and the educational disclosure).
//
// The resolver still owns every narrative string; this module owns nothing the
// resolver produces. No key->copy lookup happens here, and nothing here reads
// config, scoring, or the resolver's internals.

import { BRAND_NAME } from "../brand";

/** §cover — the approved title, unchanged. */
export const SNAPSHOT_TITLE = "YOUR SET FOR LIFE FINANCIAL SNAPSHOT";

/** §cover — the approved subtitle, unchanged. */
export const SNAPSHOT_SUBTITLE =
  "A personalized look at how you currently see, direct, prepare, and make decisions with your money.";

/**
 * §cover — the personalization line, name-gated by Addendum 02 §3.2.
 *
 * Returns the approved line for a VERIFIED first name, and `null` otherwise.
 * An unverified or provisional participant has no verified name, so the line is
 * OMITTED entirely — never rendered empty, never filled with a placeholder
 * ("Friend", "Participant", "there", …). This mirrors the reveal's `frame5`
 * convention: drop the name, author no substitute copy.
 */
export function preparedForLine(firstName: string | null): string | null {
  const name = firstName?.trim();
  if (!name) return null;
  return `Prepared for ${name}`;
}

/** §disclosure — the approved educational disclosure, verbatim (web + PDF). */
export const SNAPSHOT_DISCLOSURE =
  "This Financial Snapshot is based on your responses to the Set for Life Financial Assessment and is provided for educational and informational purposes. It is not a recommendation to buy, sell, replace, surrender, allocate, or change any financial product, investment, insurance coverage, account, or strategy. Individualized recommendations, when appropriate, belong in an appropriately licensed and supervised conversation.";

/**
 * §footer — the standardized page footer.
 *
 * `SET FOR LIFE • FINANCIAL SNAPSHOT • {PAGE} OF {TOTAL}`
 *
 * The separator is U+2022 BULLET with a single space either side. The leading
 * brand token is the canonical `BRAND_NAME` ("Set for Life") uppercased — the
 * footer consumes the ONE brand constant rather than hardcoding the string.
 */
export const FOOTER_SEPARATOR = "•"; // U+2022 BULLET

/** Build the standardized footer line for a given page and total page count. */
export function footerLine(pageNumber: number, totalPages: number): string {
  return `${BRAND_NAME.toUpperCase()} ${FOOTER_SEPARATOR} FINANCIAL SNAPSHOT ${FOOTER_SEPARATOR} ${pageNumber} OF ${totalPages}`;
}
