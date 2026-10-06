// SECTION 11 — KEEP YOUR SNAPSHOT.
//
// The quiet utility block that gives the participant their PDF. It is
// deliberately NOT a second campaign: the spec's note is "Masterclass = continue
// the journey. Download = keep the results. Do not make the actions compete
// visually." So this section is an Ivory ground with Evergreen/Gold accents — no
// photographic art, no large promotion, no urgency — and the campaign block above
// it is the only full-colour moment on the page.
//
// HOW THE PDF IS DELIVERED, UNCHANGED. The button is the existing
// `DownloadButton`, which POSTs to the download route to mint a SIGNED,
// time-limited URL and then navigates to it. That mechanism — and the private
// storage bucket behind it — is untouched by this phase. The security property
// the owner set ("PDF storage remains private. Downloads continue through the
// approved signed/expiring access mechanism. Do not make the bucket public to
// make tests pass") is a property of the route and the bucket, and this section
// does not reach either one.
//
// THE DOWNLOAD IS NEVER GATED. The owner's directive: "Do not require Masterclass
// registration or additional form completion before the PDF is downloadable."
// Structurally: this section renders for any session with an id, the button
// performs its own POST, and it reads NO state from the campaign above it. There
// is no order dependency, no shared state, no "unlocked" concept — opening this
// page and pressing the button is the whole of it.
//
// The approved Section 11 art is applied as a soft band, well clear of the button.
//
// ── THE EDITORIAL REFINEMENT (2026-10-05): STAYING SUBORDINATE ──────────────
// The brief's requirement is a HIERARCHY one, not a styling one: "Keep Download
// quieter than the Masterclass CTA ... Do not visually elevate Download to equal
// importance with the Masterclass."
//
// The shipped build already had the right ingredients, but the download button
// was rendering as a SOLID EVERGREEN FILL — the same visual weight as the
// Masterclass button above it, and the heaviest treatment available on the page.
// Two full-weight buttons stacked is exactly the "competing actions" the spec's
// own note warns against ("Do not make the actions compete visually").
//
// So the download button becomes an OUTLINED Evergreen affordance: same
// Evergreen ink, same 56px target, same label — but no filled field, which is
// what puts it a clear step below the filled Gold Masterclass button while
// keeping it plainly available. Gold is deliberately NOT used here: Gold is the
// campaign's colour on this page, and borrowing it would tie the utility action
// to the promotion.
//
// The heading also drops to the eyebrow register so the section reads as a
// utility footnote rather than a second campaign.
//
// ⚠️ EVERYTHING STRUCTURAL IS UNCHANGED. Still a `<section id="download">`
// carrying the `<button>` the membership guard uses to identify this block, and
// still rendering iff a session id is present. The PDF remains ungated: the
// button performs its own POST and reads no state from the campaign above it.

import { KEEP_SNAPSHOT_BODY, KEEP_SNAPSHOT_HEADING } from "@/lib/ui/snapshot-web-copy";
import { DownloadButton } from "./DownloadButton";
import { SECTION_ART } from "./SnapshotSection";

export function SnapshotDownload({ sessionId }: { sessionId: string }) {
  return (
    <section className="mt-20 border-t border-blush pt-10 lg:mt-24" id="download">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
        <div className="max-w-[560px]">
          <h2
            className="font-body text-rose"
            style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
          >
            {KEEP_SNAPSHOT_HEADING}
          </h2>
          <p
            className="mt-4 font-body text-obsidian/90"
            style={{ fontSize: "17px", lineHeight: "28px" }}
          >
            {KEEP_SNAPSHOT_BODY}
          </p>
          <DownloadButton sessionId={sessionId} />
        </div>

        {/* The approved art, as a quiet supporting band well clear of the
            button. Decorative; hidden from assistive tech. */}
        <div
          aria-hidden="true"
          role="presentation"
          className="h-[110px] w-full lg:mt-2 lg:h-[130px] lg:w-[34%]"
          style={{
            backgroundImage: `url("${SECTION_ART["11-download"]}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            maskImage:
              "linear-gradient(to right, transparent, black 15%, black 85%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 15%, black 85%, transparent)",
          }}
        />
      </div>
    </section>
  );
}
