// SECTION 1 — THE HERO.
//
// Editorial split composition: copy left, portrait right, generous ivory
// negative space. Desktop is a true split (text ~52–58%, portrait ~42–48%,
// 4:5 crop); mobile stacks copy FIRST and the image BENEATH, which is the
// spec's explicit requirement ("Words first, then portrait, then transition
// cue") and not merely a responsive collapse — so the copy is a sibling that
// reorders, never a floated overlay.
//
// THE IMAGE IS CHOSEN SERVER-SIDE. This component receives a resolved
// `HeroVariant` and nothing else about the participant's demographics. It cannot
// infer a variant, cannot see the gender code, and holds no mapping — the rule
// lives in lib/ui/snapshot-hero.ts and runs on the server. See that module for
// why the mapping is written down once.
//
// THE IMAGE IS CONTENT, NOT DECORATION — but it is not a portrait of the
// reader, so its alt text is deliberately the same for all three variants and
// describes the scene rather than the person. That keeps a demographic answer
// from being audible to a screen-reader user. The transition cue is rendered as
// a real anchor rather than a decorative chevron, so keyboard users reach it.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05) ──────────────────────────────────
// The brief's verdict was that the hero read "under-designed" and needed to
// become "a true editorial opening spread", and it named the specific problem:
// the page's own title — YOUR SET FOR LIFE FINANCIAL SNAPSHOT — was rendering
// as a 16px letter-spaced label while the reveal statement beneath it rendered
// at T02 (60px). The title of the document was the smallest type on it.
//
// So the hierarchy is now, in order of visual weight:
//   1. YOUR SET FOR LIFE FINANCIAL SNAPSHOT  (display serif, T02 scale)
//   2. Here is what your responses reveal.   (Cormorant italic, T06 scale)
//   3. the conceptual line, the personalization, the cue
// The reveal statement keeps its words exactly; it moves to the serif italic
// register, which is how an editorial spread sets a subordinate line under a
// title without shrinking it into illegibility.
//
// The portrait now bleeds to the right edge of the content measure and takes a
// slightly larger share of the row (44% -> 47%), so it reads as part of the
// composition rather than as an inset photo. The split is still inside the
// 52–58 / 42–48 band the spec sets.
//
// ⚠️ THE GUARD HOOKS. The hero is the page's `<header>` landmark — the
// membership guard resolves every string inside it to the `cover` owner by tag
// name, so the element must stay a `<header>`. The logo `<img>` must stay the
// official asset (the guard asserts no other logo path appears anywhere), and
// the alt text must stay identical across variants so it cannot disclose the
// chosen demographic.

import Image from "next/image";
import {
  HERO_ALT,
  HERO_IMAGE,
  HERO_INTRINSIC,
  type HeroVariant,
} from "@/lib/ui/snapshot-hero";
import { BRAND_LOGO } from "@/lib/brand";
import {
  HERO_CONCEPTUAL_LINE,
  HERO_TRANSITION_CUE,
  heroGreetingLine,
} from "@/lib/ui/snapshot-web-copy";

export function SnapshotHero({
  eyebrow,
  lead,
  variant,
  firstName,
  transitionHref,
}: {
  /** The approved cover title, from the shared section model / report config. */
  eyebrow: string;
  /** The approved cover lead ("Here is what your responses reveal."). */
  lead: string;
  /** The server-resolved image variant. */
  variant: HeroVariant;
  /** The VERIFIED first name, or null — the line is omitted, never faked. */
  firstName: string | null;
  /** Where the transition cue leads (the first content section). */
  transitionHref: string;
}) {
  const greetingLine = heroGreetingLine(firstName);

  return (
    <header className="relative">
      {/* The official owner-supplied logo. This is the ONLY brand mark in the
          Snapshot: the wordmark is never re-drawn, re-typeset, or substituted. */}
      <Image
        src={BRAND_LOGO.src}
        alt={BRAND_LOGO.alt}
        width={BRAND_LOGO.width}
        height={BRAND_LOGO.height}
        priority
        className="h-auto w-[176px] sm:w-[208px] lg:w-[232px]"
      />

      {/* A short Gold rule under the mark, tying the opening to the section
          markers that follow. Purely decorative. */}
      <div aria-hidden="true" role="presentation" className="section-rule mt-8" />

      {/* ⚠️ `lg:items-start`, NOT `lg:items-center` (polish 2026-10-05).
          Centering the two columns against each other looked composed in
          isolation and disconnected in the page: the portrait column is 575px
          tall and the copy column 410px, so centering pushed the copy 82px down
          from the top of the row. Measured on desktop 1440, the `<h1>` sat 172px
          below the logo — nearly two inches of blank ivory between the mark and
          the first line the reader sees, which is exactly the "vertically
          disconnected" opening the brief names.
          Top-aligning makes both columns start on the same line the Gold rule
          sets, so the gap from rule to title is the single intended 56px and
          the leftover space falls below the CTA, where generous whitespace reads
          as margin rather than as a hole in the composition. */}
      <div className="mt-10 flex flex-col gap-12 lg:mt-14 lg:flex-row lg:items-start lg:gap-12">
        {/* COPY COLUMN — ~53% on desktop. On mobile this is first, and the
            image below follows it in DOM order. */}
        <div className="lg:w-[53%] lg:shrink-0">
          {/* THE DOCUMENT'S TITLE — now the largest type in the hero. */}
          <h1
            className="font-display text-evergreen"
            style={{
              fontSize: "var(--type-t02-size)",
              lineHeight: "var(--type-t02-line)",
              textWrap: "balance",
            }}
          >
            {eyebrow}
          </h1>

          {/* THE REVEAL STATEMENT — the approved lead, verbatim, in the
              editorial italic register beneath the title.
              COLOUR: Obsidian (13.95:1), deliberately not the palette's
              Terracotta emphasis role. Terracotta on Ivory is 4.24:1, which
              passes AA for LARGE text only (>=24px regular) — and T06 is 24px
              on desktop but 22px on mobile, so the emphasis colour would fail
              the contrast floor at 375px and 320px. Obsidian clears AA and AAA
              at every breakpoint, and the size and italic style already
              separate this line from the Evergreen title above it. */}
          <p
            className="mt-5 font-serif-italic text-obsidian"
            style={{
              fontSize: "var(--type-t06-size)",
              lineHeight: "var(--type-t06-line)",
              textWrap: "balance",
            }}
          >
            {lead}
          </p>

          {greetingLine ? (
            <p
              className="mt-7 font-body text-obsidian/75"
              style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.04em" }}
            >
              {greetingLine}
            </p>
          ) : null}

          <p
            className="prose-measure mt-7 font-serif text-obsidian/85"
            style={{ fontSize: "var(--type-t08-size)", lineHeight: "var(--type-t08-line)" }}
          >
            {HERO_CONCEPTUAL_LINE}
          </p>

          <a
            href={transitionHref}
            className="mt-10 inline-flex min-h-[56px] items-center bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{
              fontSize: "var(--type-t13-size)",
              lineHeight: "var(--type-t13-line)",
              borderRadius: "2px",
            }}
          >
            {HERO_TRANSITION_CUE}
          </a>
        </div>

        {/* PORTRAIT COLUMN — ~47% on desktop, full width beneath the copy on
            mobile. The 4:5 crop is enforced by the frame, not by the source
            file, so the approved 1122×1402 master is never re-cropped on disk.
            The Gold offset rule behind it is the one expressive flourish: it
            makes the portrait part of the composition rather than a picture
            dropped into a column. Decorative, no text, no accessible name. */}
        <div className="relative w-full lg:w-[47%]">
          <div
            aria-hidden="true"
            role="presentation"
            className="pointer-events-none absolute -right-3 -top-3 hidden h-full w-full border border-gold/50 lg:block"
            style={{ borderRadius: "2px" }}
          />
          <div
            className="relative w-full overflow-hidden bg-blush/25"
            style={{ aspectRatio: "4 / 5", borderRadius: "2px" }}
          >
            <Image
              src={HERO_IMAGE[variant]}
              alt={HERO_ALT}
              width={HERO_INTRINSIC.width}
              height={HERO_INTRINSIC.height}
              priority
              sizes="(min-width: 1024px) 47vw, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
