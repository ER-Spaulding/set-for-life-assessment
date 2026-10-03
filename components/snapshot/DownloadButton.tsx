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
      className="mt-10 inline-block bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
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
