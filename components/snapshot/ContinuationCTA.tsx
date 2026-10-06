// SECTION 10 — THE CONFIGURABLE NEXT-STEP CTA.
//
// THE SECTION IS PERMANENT; THE CAMPAIGN IS REPLACEABLE. Every string and the
// destination URL come from `activeCampaign()` in lib/ui/snapshot-campaign.ts —
// this component holds no campaign copy of its own, so a future campaign is a
// data change there and nothing here moves.
//
// THE COMPONENT CANNOT READ THE PARTICIPANT. It receives no participant value:
// not a readiness state, not an activation level, not a finding. The owner's
// directive is explicit — "Do not dynamically pressure the participant based on
// Activation results" — and the way to guarantee that is to give the component
// nothing to branch on. There is no code path from an assessment result into
// this section, so it is impossible for the invitation to change shape for a
// participant the engine judged less ready.
//
// LOCKED VISUAL TREATMENT (spec §10 "LOCKED OPTION A"): full-width Evergreen
// background, Ivory typography, Champagne/Gold accents, no person photography.
// The approved masterclass art sits behind it as decorative architecture.
//
// A NOTE ON THE BACKGROUND ASSET. The approved Section 10 art is a LIGHT
// (Ivory-ground) composition. On an Evergreen block it would fight the ivory
// type, so it is applied at low opacity as texture beneath the colour rather
// than as a straight background image. The Evergreen ground is what the spec
// locked; the art is decoration on top of it. The section is fully legible with
// the art removed entirely.
//
// THE CTA NEVER GATES THE PDF. This is an anchor to an external registration
// page and nothing more — it is not a form, it sets no state, and it sits AFTER
// the download section in DOM order. See SnapshotDownload for the other half of
// that guarantee.

import { activeCampaign } from "@/lib/ui/snapshot-campaign";
import { SECTION_ART } from "./SnapshotSection";

export function ContinuationCTA() {
  const campaign = activeCampaign();
  if (!campaign) return null;

  return (
    <section className="relative mt-24 w-full overflow-hidden surface-evergreen lg:mt-32">
      {/* Decorative architecture. Never carries text. */}
      <div
        aria-hidden="true"
        role="presentation"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `url("${SECTION_ART["10-masterclass-cta"]}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.12,
        }}
      />

      <div className="relative mx-auto w-full max-w-[1080px] px-6 py-20 sm:px-10 lg:px-16 lg:py-28">
        {/* A Gold rule states "this is the page's primary call" in the same
            editorial language every section marker uses — the brief asks to
            preserve the campaign's primacy, and this reinforces it without
            adding decoration or competing with the button. Decorative. */}
        <div aria-hidden="true" role="presentation" className="section-rule mb-8" />
        <p
          className="font-body text-champagne"
          style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
        >
          {campaign.eyebrow}
        </p>

        <h2
          className="mt-6 max-w-[22ch] font-display text-ivory"
          style={{
            fontSize: "var(--type-t04-size)",
            lineHeight: "var(--type-t04-line)",
            textWrap: "balance",
          }}
        >
          {campaign.headline}
        </h2>

        {campaign.body ? (
          <p
            className="prose-measure mt-6 font-body text-ivory/90"
            style={{ fontSize: "18px", lineHeight: "29px" }}
          >
            {campaign.body}
          </p>
        ) : null}

        <ul className="mt-10 flex list-none flex-col gap-4">
          {campaign.bullets.map((bullet, i) => (
            <li key={i} className="flex gap-4">
              {/* A gold rule rather than a checkmark or a tick — the bullets are
                  benefits, not completed steps, and gamified success
                  iconography is out of register for this document. */}
              <span
                aria-hidden="true"
                className="mt-[14px] block h-[1px] w-[24px] shrink-0 bg-gold"
              />
              <span
                className="font-body text-ivory"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                {bullet}
              </span>
            </li>
          ))}
        </ul>

        <a
          href={campaign.url}
          // The campaign link leaves the application. `noopener noreferrer` is
          // standard hygiene for a cross-origin target.
          target="_blank"
          rel="noopener noreferrer"
          className="mt-12 inline-flex min-h-[56px] items-center bg-gold px-8 py-4 font-serif text-obsidian transition-colors hover:bg-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-champagne"
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
          }}
        >
          {campaign.buttonLabel}
        </a>
      </div>
    </section>
  );
}
