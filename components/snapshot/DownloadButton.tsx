"use client";

// Module 12 — the signed PDF download affordance (Addendum 01 §8, §14 step 7).
//
// Renders the APPROVED download call-to-action label (canonical source:
// lib/ui/snapshot-copy.ts DOWNLOAD_CTA) and drives the two-step download the
// route requires: POST to mint a signed, time-limited URL, then navigate to it.
// The PDF itself is generated SERVER-SIDE from the stored Snapshot payload —
// nothing about the report is (re)built here, and a failed download must never
// hide the web results (§8: "PDF failure must never invalidate the completed
// assessment or hide web results").

import { useState } from "react";
import { DOWNLOAD_CTA } from "@/lib/ui/snapshot-copy";

export function DownloadButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshot/${sessionId}/download`, { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.assign(data.url);
    } catch {
      // Silent no-op: a download failure never surfaces as a broken result page.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      // OUTLINED, NOT FILLED — the visual-refinement hierarchy rule. The
      // Masterclass button above this one is a filled Gold field; a second
      // filled field here would put the utility action at the campaign's visual
      // weight, which the spec forbids ("Do not make the actions compete
      // visually"). An Evergreen outline keeps the full 56px target, the
      // approved label, and clear affordance while sitting a step below.
      //
      // Gold is deliberately not used: Gold is the campaign's colour on this
      // page, and borrowing it would tie the PDF to the promotion.
      //
      // The hover state fills the field, so the affordance is unmistakable on
      // interaction; the resting state is what stays quiet. The focus ring is
      // unchanged and still 2px, so keyboard visibility is not reduced.
      className="mt-8 inline-block border border-evergreen bg-transparent px-8 py-4 font-serif text-evergreen transition-colors hover:bg-evergreen hover:text-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen disabled:opacity-60"
      style={{
        fontSize: "var(--type-t13-size)",
        lineHeight: "var(--type-t13-line)",
        borderRadius: "2px",
        minHeight: "56px",
      }}
    >
      {DOWNLOAD_CTA}
    </button>
  );
}
