// UIUX §8 S12–S20, §14, §20 — the Financial Snapshot, rendered SERVER-SIDE.
//
// THE PAYOFF SCREEN, and where it gets its data. The page reads the stored
// immutable Snapshot payload through `loadSnapshotPayload` (server-only) and
// resolves it through the SHARED content/section model `resolveSnapshotContent`
// — never through a fetch to the snapshot route, and never by re-deriving
// interpretation from live tensions or computed_signals. Addendum 01 v1.1 §5:
// ONE SNAPSHOT PAYLOAD, TWO RENDERERS. The web renderer and the PDF renderer
// must consume the SAME stored payload and the SAME shared section model; this
// page is the web half of that contract.
//
// INTERPRETATION STAYS SERVER-SIDE. This component never rescoring, never
// re-selects an attention area, never reads a classifier tag as anything but a
// resolved narrative key (already resolved by `resolveSnapshotView`, inside
// `resolveSnapshotContent`). Scoring, evidence, `openingB`, `moveSubsignals`,
// tension codes and signal codes never leave this module's boundary: the browser
// receives only the resolved, participant-facing section model.

import Link from "next/link";
import { loadSnapshotPayload } from "@/lib/session/service";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import { recordEventInBackground } from "@/lib/analytics/write";
import { UNAVAILABLE_COPY, SERVER_ERROR_COPY } from "@/lib/ui/snapshot-failure";
import { SnapshotResults, Shell } from "@/components/snapshot/results-view";

export const dynamic = "force-dynamic";

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  let payload;
  try {
    payload = await loadSnapshotPayload(sessionId);
  } catch {
    // A completed session whose payload is missing/malformed, or a DB that is
    // not configured, surfaces here as a server problem — never as "questions
    // unanswered" (that falsehood would send a finished participant back to a
    // form they already completed).
    return (
      <Shell>
        <h1
          className="font-display text-evergreen"
          style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
        >
          {SERVER_ERROR_COPY.headline}
        </h1>
        <p
          className="prose-measure mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {SERVER_ERROR_COPY.body}
        </p>
        <Link
          href={`/snapshot/${sessionId}`}
          className="mt-10 inline-block bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          Try again
        </Link>
      </Shell>
    );
  }

  if (!payload) {
    // The session does not exist or is not complete. Same response for both —
    // telling the caller which would leak session existence (§7.3).
    return (
      <Shell>
        <h1
          className="font-display text-evergreen"
          style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
        >
          {UNAVAILABLE_COPY.headline}
        </h1>
        <p
          className="prose-measure mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          {UNAVAILABLE_COPY.body}
        </p>
        <Link
          href={`/assessment/${sessionId}`}
          className="mt-10 inline-block bg-evergreen px-8 py-4 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          Return to my assessment
        </Link>
      </Shell>
    );
  }

  // §16: a completed Snapshot is being served. Recorded HERE, server-side, at
  // the moment the stored payload is actually read and rendered — the same
  // "reports actually delivered" semantics the snapshot route used to carry.
  recordEventInBackground({ eventName: "snapshot_viewed", sessionId });

  // ONE SNAPSHOT PAYLOAD -> ONE RESOLVER -> ONE SHARED SECTION MODEL -> TWO
  // RENDERERS. Everything below is participant-facing resolved copy arranged into
  // the shared content/section model; no scoring internals, evidence, openingB,
  // moveSubsignals, or signal codes cross into the render.
  const sections = resolveSnapshotContent(payload);

  return <SnapshotResults sections={sections} sessionId={sessionId} />;
}
