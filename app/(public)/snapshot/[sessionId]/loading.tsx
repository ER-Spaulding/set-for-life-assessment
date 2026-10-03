// The honest loading state shown while the server resolves the stored Snapshot
// payload. Server-side render replaces the old client fetch, so this Suspense
// boundary carries the copy the client component used to show.

import { Shell } from "@/components/snapshot/results-view";
import { LOADING_COPY } from "@/lib/ui/snapshot-copy";

export default function Loading() {
  return (
    <Shell>
      <p className="font-body text-obsidian" style={{ fontSize: "18px", lineHeight: "29px" }}>
        {LOADING_COPY}
      </p>
    </Shell>
  );
}
