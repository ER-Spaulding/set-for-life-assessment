// UIUX §8 S12–S20, §14 — the CLIENT-SAFE narrative projections.
//
// THIN RE-EXPORT SHIM. The resolution bodies that used to live here have MOVED
// to `lib/render/snapshot-view.ts` — the single shared resolution contract
// (Addendum 01 v1.1 §5: ONE SNAPSHOT PAYLOAD, ONE RESOLVER) that both the web
// results page and the future PDF renderer consume. This file keeps the old
// import path compiling for the symbols whose CONTRACT IS UNCHANGED; it
// contains NO key → copy logic of its own. Do not add lookup code back here.
//
// WHAT IS NOT HERE, DELIBERATELY. The former one-argument `resolveNarrative(key)`
// is GONE, not renamed. The shared resolver's `resolveSignalRow(signal,
// narrativeKey)` takes TWO arguments and returns a full row, so re-exporting it
// under the old one-argument name would let `resolveNarrative(key)` silently
// return null — a broken contract. Rather than advertise a compatibility name
// the file does not honour, this shim drops the alias. Callers that still need
// that lookup must import `resolveSignalRow` from `@/lib/render/snapshot-view`
// and pass both arguments.

export {
  resolveConnection,
  resolveAttentionArea,
  signalLabel,
  isSpecialState,
} from "@/lib/render/snapshot-view";

export type {
  ResolvedSignalRow,
  ResolvedConnection,
  ResolvedAttentionArea,
} from "@/lib/render/snapshot-view";
