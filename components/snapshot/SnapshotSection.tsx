// THE SHARED SECTION FRAME, the decorative-asset helper, and the small
// typographic primitives every Snapshot section composes from.
//
// Extracted so the twelve sections share ONE definition of: the page frame, the
// rule-and-heading treatment, the section eyebrow, the section intro paragraph,
// the decorative background asset, and the two tinted surfaces. A second copy
// of any of these is how twelve sections drift apart visually.

import type { ReactNode } from "react";

/** The page frame: ivory surface, centred measure, generous vertical rhythm. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="surface-ivory min-h-screen w-full px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[1080px]">{children}</div>
    </main>
  );
}

/**
 * A titled section. A short Gold rule and a display-serif heading, per the
 * editorial refinement.
 *
 * ⚠️ THE HEADING LEVEL AND THE `data-snapshot-module` HOOK ARE LOAD-BEARING.
 * Five render guards locate a module by `section[data-snapshot-module]` and read
 * its heading through `querySelector("h2")`; two of them assert the headings are
 * exactly the eight approved modules in report-config order. Changing the
 * element, the attribute, or the heading level from `h2` breaks them. The
 * heading TEXT is rendered verbatim from the shared section model — it is never
 * re-authored here.
 *
 * ⚠️ THE HEADING MUST CONTAIN THE TITLE AND NOTHING ELSE. The membership guard
 * reads `h2.textContent` and matches it against the model's heading. A kicker or
 * eyebrow placed INSIDE the `<h2>` would be concatenated into that string and
 * would stop matching. So the eyebrow is a sibling above it, never a child.
 *
 * WHAT THE REFINEMENT CHANGED AND WHY. In the shipped build this heading
 * rendered at T12 — 16px Inter, Rose, letter-spaced — while the body copy
 * beneath it rendered at 18px. The section heading was literally SMALLER than
 * its own prose, so the eye had no title to land on and the page read as one
 * undifferentiated run of text. The heading now takes the display serif at a
 * size clearly above body copy, which is what restores the hierarchy. No token
 * was redefined: the treatment is a new class (.section-title), so no other
 * surface moves.
 */
export function SnapshotSection({
  title,
  intro,
  children,
  id,
  plate = false,
  toneBleed = false,
}: {
  title: string;
  /** The governed section-intro paragraphs (the shared model's `section.intro`). */
  intro?: string[];
  children: ReactNode;
  id?: string;
  /**
   * Renders the section on the DEEP EVERGREEN plate (full-bleed, Ivory type).
   * Used by the Money Picture, the brief's "signature visual moment". The
   * section keeps its Ivory-section structure and guard hooks; only the surface
   * and the type roles change.
   */
  plate?: boolean;
  /** Renders the section on the warm BLUSH wash (full-bleed). The Connection.
   *  Mutually exclusive with `plate` in practice; `plate` wins if both are set. */
  toneBleed?: boolean;
}) {
  const surface = plate ? "surface-deep" : toneBleed ? "surface-wash" : "";
  const bleed = plate || toneBleed ? "plate-bleed" : "";

  return (
    <section
      className={`mt-20 lg:mt-28 ${surface} ${bleed}`}
      id={id}
      // Marks this element as one of the SHARED MODEL's content modules. The
      // guard tests use it to distinguish a model module's heading from the
      // page's other <h2> chrome (the §10 campaign headline, the §11 utility
      // heading, the approved continuation heading), so "the module headings are
      // exactly the approved modules, in order" stays an EXACT assertion now
      // that the page legitimately contains non-module headings too.
      data-snapshot-module={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <div className="pt-16 lg:pt-24" />
      {/* The editorial section marker: a short deep-Gold rule. Decorative —
          it carries no text and no accessible name. */}
      <div
        aria-hidden="true"
        role="presentation"
        className={`section-rule ${plate ? "opacity-90" : ""}`}
      />
      <h2
        id={id ? `${id}-heading` : undefined}
        className={`section-title mt-6 ${plate ? "text-ivory" : toneBleed ? "text-evergreen" : ""}`}
      >
        {title.toUpperCase()}
      </h2>
      {intro && intro.length > 0 ? (
        <SectionIntro tone={plate ? "deep" : "ivory"} paragraphs={intro} />
      ) : null}
      {children}
      <div className="pb-16 lg:pb-24" />
    </section>
  );
}

/**
 * The framing paragraphs under a section heading — one `<p>` per approved
 * paragraph, from the governed `section_intros` family via the shared model.
 *
 * Rendered as `<p>`s so each paragraph reads as its own prose unit to
 * assistive tech, and they sit OUTSIDE the section's content region: sections
 * whose guards count paragraphs within the content (e.g. the attention area,
 * which asserts exactly one body paragraph) are unaffected by the intro's
 * presence. `aria-hidden` is NOT used — the lines are real, approved framing
 * and must be readable.
 */
export function SectionIntro({
  paragraphs,
  tone = "ivory",
}: {
  paragraphs: string[];
  /** `deep` inverts the type for the Money Picture plate. */
  tone?: "ivory" | "deep";
}) {
  return (
    <>
      {paragraphs.map((text, i) => (
        <p
          key={i}
          className={`prose-measure mt-6 font-serif ${
            tone === "deep" ? "text-ivory/85" : "text-obsidian/80"
          }`}
          style={{ fontSize: "22px", lineHeight: "32px" }}
        >
          {text}
        </p>
      ))}
    </>
  );
}

/** A small uppercase label — the kicker above a label, and the eyebrow. */
export function Eyebrow({ children, tone = "ivory" }: { children: ReactNode; tone?: "ivory" | "deep" }) {
  return (
    <p
      className={`font-body ${tone === "deep" ? "text-champagne" : "text-rose"}`}
      style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
    >
      {children}
    </p>
  );
}

/**
 * A DECORATIVE background asset.
 *
 * Every Section background in the approved package is pure atmosphere: the
 * participant never has to see it to understand the section. So it is rendered
 * as a CSS background on an element that is `aria-hidden` and `role="presentation"`
 * — it contributes NO text node, NO accessible name, and NO focus target. That
 * is the "images that are purely decorative should not create unnecessary
 * screen-reader noise" rule from the brief, made structural rather than
 * remembered per section.
 *
 * ⚠️ NO ACCESSIBLE-VISIBLE ATTRIBUTE MAY BE ADDED HERE. The membership guard
 * enumerates an attribute allowlist (`alt`, `title`, `aria-label`, `value`,
 * `label`, `placeholder`, …); a decorative element that carried one would be
 * flagged as unattributable prose. `aria-hidden`, `role`, `className` and
 * `style` are deliberately NOT in that allowlist, which is why they are safe.
 *
 * `height` is deliberately modest by default. The spec's guidance for these
 * assets is an editorial ACCENT — "not a full text-obscuring hero" — so the
 * caller sets a small band height and the art never sits behind body copy.
 */
export function DecorativeBand({
  src,
  height = 160,
  className = "",
}: {
  src: string;
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={`mt-10 w-full ${className}`}
      style={{
        height: `${height}px`,
        backgroundImage: `url("${src}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        // The approved art is light and airy; a soft fade into the ivory page
        // keeps it reading as an accent rather than a dropped-in image.
        maskImage: "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
      }}
    />
  );
}

/**
 * The approved decorative backgrounds, by section. Used by the sections below.
 *
 * The Attention spotlight (`09-attention`, the hazy radial-gradient SVG) is
 * deliberately ABSENT — the Owner rejected it in the narrative-rewrite pass
 * (plan D11): one dominant Attention area, no spotlight artwork. The asset file
 * stays on disk for provenance; `SECTION_ART` simply no longer points at it.
 */
export const SECTION_ART = {
  "02-big-picture": "/images/snapshot/section-02-big-picture-background-v1.svg",
  "04-strengths": "/images/snapshot/section-04-strengths-background-v1.svg",
  "05-friction": "/images/snapshot/section-05-friction-background-v1.svg",
  "06-connection": "/images/snapshot/section-06-connection-background-v1.svg",
  "07-destination": "/images/snapshot/section-07-destination-background-v1.svg",
  "10-masterclass-cta": "/images/snapshot/section-10-masterclass-cta-background-v1.svg",
  "11-download": "/images/snapshot/section-11-download-background-v1.svg",
} as const;
