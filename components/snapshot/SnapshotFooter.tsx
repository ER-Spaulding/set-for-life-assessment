// SECTION 12 — FOOTER / DISCLOSURE. The quiet, readable endpoint.
//
// THE OFFICIAL LOGO, NOT A TYPESET WORDMARK. The owner's directive for this
// section: "Use the official owner-supplied Set for Life logo." The mark is read
// from the ONE canonical constant (lib/brand.ts BRAND_LOGO) and nothing here
// re-draws, re-typesets, or substitutes it.
//
// ⚠️ A NOTE ON THE BRAND SCRIPT THAT USED TO BE HERE. The previous footer
// rendered the brand as a large script-set wordmark (`font-script` in Rose,
// ~56px) — a typeset rendering of the brand name. The owner's directive for this
// phase says not to typeset or substitute the wordmark, so that treatment is
// replaced here by the official logo image. The `BRAND_NAME` text constant is
// still rendered, but as a small line of footer text beside the mark rather than
// as the brand's visual identity. Flagged in the phase report as a deliberate
// change to previously-approved footer styling.
//
// THE DISCLOSURE IS VERBATIM AND IS NOT SHORTENED. The spec: "Disclosure is fixed,
// approved copy and is not shortened in the web Snapshot." The string comes from
// lib/ui/snapshot-doc-copy.ts — the SAME constant the PDF renders — so the two
// media cannot drift on the one string that carries legal weight.
//
// READABLE SIZE IS A REQUIREMENT, NOT A PREFERENCE. The spec sets a floor:
// "Web type minimum 14–15 px with ~21–24 px line height" and "never tiny". This
// renders at 15px/24px with a measured reading width (max ~800px, within the
// spec's 750–850px guidance). It is small enough to be quiet and large enough to
// actually be read — and it does NOT shrink on mobile.
//
// NO CTA AFTER THIS POINT. The spec: "No additional CTA after this point." This
// component ends the document: the only interactive element is the logo-less
// nothing — there is no link, no button, and no campaign here.

import Image from "next/image";
import { BRAND_LOGO, BRAND_NAME } from "@/lib/brand";
import { SNAPSHOT_DISCLOSURE } from "@/lib/ui/snapshot-doc-copy";
import { FOOTER_DISCLOSURE_LABEL } from "@/lib/ui/snapshot-web-copy";

export function SnapshotFooter() {
  return (
    <footer className="mt-24 border-t border-champagne pt-12 lg:mt-32">
      {/* The official owner-supplied brand mark. */}
      <Image
        src={BRAND_LOGO.src}
        alt={BRAND_LOGO.alt}
        width={BRAND_LOGO.width}
        height={BRAND_LOGO.height}
        className="h-auto w-[140px] sm:w-[160px]"
      />

      <p
        className="mt-6 font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
      >
        {FOOTER_DISCLOSURE_LABEL}
      </p>

      {/* The approved educational disclosure, VERBATIM from the canonical source
          shared with the PDF. 15px/24px — at the spec's stated floor, never
          below it. */}
      <p
        className="mt-4 font-body text-obsidian"
        style={{ fontSize: "15px", lineHeight: "24px", maxWidth: "800px" }}
      >
        {SNAPSHOT_DISCLOSURE}
      </p>

      <p
        className="mt-10 font-body text-obsidian/70"
        style={{ fontSize: "14px", lineHeight: "22px" }}
      >
        {BRAND_NAME}
      </p>
    </footer>
  );
}
