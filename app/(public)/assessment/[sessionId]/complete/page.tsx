"use client";

// PRD Addendum 01 v1.1 §3, §4 — the post-completion synthesis reveal.
//
// This route is where the state machine's Synthesis Reveal sits (§3):
//
//   Completed Responses -> Server Validation -> Frozen Response Set ->
//   Deterministic Engine -> Persisted Immutable Snapshot Payload ->
//   SYNTHESIS REVEAL -> Complete Web Snapshot -> PDF -> ...
//
// So this screen runs AFTER the payload exists. It is not part of producing it.
// The heavy lifting is one POST to the existing completion route, which owns
// server validation and persistence; the reveal sequences while that is in
// flight and hands off to the web results cover when it lands.
//
// The reveal itself lives in components/reveal/SynthesisReveal.tsx, which
// carries the frame-by-frame rationale and the §2.3 retirement note.

import { useParams } from "next/navigation";
import { SynthesisReveal } from "@/components/reveal/SynthesisReveal";

export default function CompletePage() {
  const params = useParams<{ sessionId: string }>();
  return <SynthesisReveal sessionId={params.sessionId} />;
}
