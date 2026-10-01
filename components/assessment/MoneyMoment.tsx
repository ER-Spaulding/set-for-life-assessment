"use client";

// PRD Addendum 02 v1.1 §7–§13 — a Money Moment.
//
// A brief, UNSCORED pacing interstitial. §6 is explicit about what it is not:
// "not questions; not scored; do not increase the 31 required responses; do not
// create diagnostic data; can be continued immediately."
//
// So this component writes nothing. It has no answer to persist, no response
// row, no session mutation — the only state it owns is whether it has been
// seen, which §14 calls "lightweight viewed-state ... for UX continuity".
//
// COPY IS APPROVED AND LOCKED. Everything rendered here comes from
// `config/interstitial-v1.0.json`, which was extracted verbatim from §9. No
// sentence on this screen is composed by the app (§19), and
// tests/integration/interstitial-copy-verbatim.test.ts re-derives every string
// from the source document to prove it.
//
// §11 requires these to "look visibly different from question screens while
// remaining in the same Set for Life world", and allows a five-way visual
// rotation. The rotation is chosen by moment index, deterministically — not
// randomly, so a participant who navigates back sees the same screen.
//
// §12: not a timed gate. Continue is immediately available, there is no
// auto-advance, and reduced-motion uses no spatial movement.

import { useEffect, useState } from "react";
import interstitial from "../../config/interstitial-v1.0.json";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

export interface MoneyMomentCopy {
  id: string;
  eyebrow: string;
  headline: string;
  body: string[];
  cta: string;
}

/**
 * §11's five visual treatments, by rotation.
 *
 * `ivory` and `highspace` are light-ground; `blush`, `evergreen` and `finish`
 * are dark-ground. Each supplies its own surface classes so the type roles flip
 * with the ground — §11 says "same Set for Life world", and the palette's own
 * rules already define how type behaves on Evergreen versus Ivory.
 */
const TREATMENTS = ["ivory", "blush", "evergreen", "highspace", "finish"] as const;
type Treatment = (typeof TREATMENTS)[number];

interface Surface {
  section: string;
  eyebrow: string;
  headline: string;
  body: string;
  /** Emphasis runs, rendered from the approved `**…**` markers. */
  emphasis: string;
}

const SURFACES: Record<Treatment, Surface> = {
  ivory: {
    section: "surface-ivory",
    eyebrow: "text-rose",
    headline: "text-evergreen",
    body: "text-obsidian",
    emphasis: "text-evergreen",
  },
  blush: {
    // §11 "Blush/Champagne editorial field" — Champagne emphasis on a Blush
    // ground. Type roles follow the palette's Ivory-surface rules, since Blush
    // is a light ground.
    section: "",
    eyebrow: "text-rose",
    headline: "text-evergreen",
    body: "text-obsidian",
    emphasis: "text-rose",
  },
  evergreen: {
    // §11 "full Evergreen statement screen" — the palette's own dark-surface
    // roles: Ivory headline/prose, Champagne emphasis.
    section: "surface-evergreen",
    eyebrow: "text-champagne",
    headline: "text-ivory",
    body: "text-ivory",
    emphasis: "text-champagne",
  },
  highspace: {
    section: "surface-ivory",
    eyebrow: "text-rose",
    headline: "text-evergreen",
    body: "text-obsidian",
    emphasis: "text-evergreen",
  },
  finish: {
    section: "surface-evergreen",
    eyebrow: "text-champagne",
    headline: "text-ivory",
    body: "text-ivory",
    emphasis: "text-champagne",
  },
};

/**
 * Render an approved body line, honouring its `**emphasis**` markers.
 *
 * The config stores the copy EXACTLY as approved, markers included, so the file
 * stays a faithful copy of §9 and copy fidelity stays mechanically checkable. The
 * splitting happens here at render time rather than in the config, which would
 * have meant storing pre-parsed fragments that no longer match the source.
 */
function BodyLine({ text, emphasisClass }: { text: string; emphasisClass: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) =>
        // Odd indices sat between a pair of ** markers.
        i % 2 === 1 ? (
          <strong key={i} className={emphasisClass} style={{ fontWeight: 700 }}>
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function MoneyMoment({
  momentId,
  milestoneLabel,
  progress,
  onContinue,
}: {
  /** e.g. "MM01" */
  momentId: string;
  /** §13 milestone language, optional. Never a score or a level. */
  milestoneLabel?: string;
  /** Optional subordinate progress, e.g. "18 of 31 answered". */
  progress?: string;
  onContinue: () => void;
}) {
  const moment = (interstitial.moneyMoments as MoneyMomentCopy[]).find(
    (m) => m.id === momentId,
  );

  // §11's rotation, keyed off the moment's own index so it is stable across
  // back-navigation rather than re-rolled on every mount.
  const index = (interstitial.moneyMoments as MoneyMomentCopy[]).findIndex(
    (m) => m.id === momentId,
  );
  const treatment: Treatment = TREATMENTS[Math.max(0, index) % TREATMENTS.length];
  const s = SURFACES[treatment];

  const reduced = usePrefersReducedMotion();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // §12: "subtle 250-450ms entrance motion only". One frame after mount so
    // the transition actually runs rather than being collapsed into first paint.
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [momentId]);

  // An unknown id must not render a blank screen to a participant mid-flow.
  if (!moment) return null;

  // §11: "progress visible but subordinate" — so it sits small, below the copy.
  const isDark = treatment === "evergreen" || treatment === "finish";

  return (
    <main
      className={`flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-10 lg:px-16 ${s.section}`}
      style={
        treatment === "blush"
          ? { backgroundColor: "var(--color-blush)" } // §11's Blush field
          : undefined
      }
    >
      <div
        className="mx-auto w-full max-w-[720px]"
        style={
          treatment === "highspace"
            ? // §11 treatment 4: "high-negative-space reflective composition".
              { paddingTop: "clamp(24px, 10vh, 96px)", paddingBottom: "clamp(24px, 10vh, 96px)" }
            : undefined
        }
      >
        <div
          style={{
            opacity: entered ? 1 : 0,
            // §12: "250-450ms entrance motion only" — and under
            // prefers-reduced-motion, NO spatial movement, crossfade only.
            //
            // The reduced-motion value is chosen here in JS rather than via
            // Tailwind's `motion-reduce:` classes, because an inline `style`
            // beats a class: a `motion-reduce:translate-y-0` utility would be
            // silently overridden by this very `transform` and the reduced path
            // would never run. See lib/ui/use-reduced-motion.ts.
            transform: reduced ? "none" : entered ? "none" : "translateY(6px)",
            transition: reduced
              ? "opacity 400ms ease"
              : "opacity 400ms ease, transform 400ms ease",
          }}
        >
          {/* §11 shared anatomy: small eyebrow. */}
          <p
            className={`font-body uppercase ${s.eyebrow}`}
            style={{
              fontSize: "16px",
              lineHeight: "24px",
              fontWeight: 600,
              letterSpacing: "0.14em",
            }}
          >
            {moment.eyebrow}
          </p>

          {/* §11: "one strong editorial headline". */}
          <h1
            className={`mt-5 font-display ${s.headline}`}
            style={{
              fontSize: "var(--type-t04-size)",
              lineHeight: "var(--type-t04-line)",
              textWrap: "balance",
            }}
          >
            {moment.headline}
          </h1>

          {/* §11: "concise body copy". */}
          <div className={`mt-6 flex flex-col gap-4 ${s.body}`}>
            {moment.body.map((line, i) => (
              <p
                key={i}
                className="prose-measure font-body"
                style={{ fontSize: "18px", lineHeight: "29px", margin: 0 }}
              >
                <BodyLine text={line} emphasisClass={s.emphasis} />
              </p>
            ))}
          </div>

          {/* §12: Continue immediately available; no auto-advance. */}
          <button
            type="button"
            onClick={onContinue}
            className={[
              "mt-10 px-8 py-4 font-serif focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4",
              isDark
                ? "bg-ivory text-evergreen hover:bg-ivory/90 focus-visible:outline-ivory"
                : "bg-evergreen text-ivory hover:bg-evergreen/90 focus-visible:outline-evergreen",
            ].join(" ")}
            style={{
              fontSize: "var(--type-t13-size)",
              lineHeight: "var(--type-t13-line)",
              borderRadius: "2px",
              minHeight: "56px",
            }}
          >
            {moment.cta}
          </button>

          {/* §13: progress visible but subordinate. A milestone line where the
              spec offers one, otherwise plain factual progress. Never a score,
              a level, or a diagnostic domain name. */}
          {milestoneLabel || progress ? (
            <p
              className={`mt-6 font-body ${s.eyebrow}`}
              style={{ fontSize: "16px", lineHeight: "24px" }}
            >
              {milestoneLabel ? (
                <span style={{ fontWeight: 600, letterSpacing: "0.08em" }}>
                  {milestoneLabel}
                </span>
              ) : null}
              {milestoneLabel && progress ? " · " : null}
              {progress}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default MoneyMoment;
