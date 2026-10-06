import "server-only";

// THE SERVER-SIDE HERO RESOLUTION — the ONE place the participant's stored
// demographic gender is read, and the ONE place it is converted into the single
// value the participant-facing renderer is allowed to receive.
//
// WHAT CROSSES THE BOUNDARY, AND WHAT DOES NOT.
//
// The renderer receives a `HeroVariant` — one of "female" | "male" | "neutral".
// It does NOT receive the gender code, the participant's name in any form it
// could branch on, a self-describe string, or the demographics row. The variant
// is the MINIMUM field sufficient to choose the hero, which is what the owner's
// directive asks for: "expose only the minimum server-side field necessary to
// choose the hero. Do not change scoring and do not expose unnecessary
// demographic/profile data to the browser."
//
// WHY THIS IS SEPARATE FROM `snapshot-view.ts`. The shared resolver is a PURE
// function of the immutable payload, and its header states that it "imports NO
// scoring, tensions, classifiers, or session/service code" and cannot do I/O —
// the guard test `snapshot-resolution-single-source.test.ts` enforces exactly
// that. Gender is not in the payload (by design: `demographics` is a separate,
// frozen table that the scoring engine must never read), so the hero choice
// CANNOT be made inside that pure resolver without breaking its contract. It is
// therefore made here, at the server seam, and handed to the renderer as a
// resolved value — the same shape the page already uses for `sections` and
// `sessionId`.
//
// FAILURE IS NEUTRAL, NEVER AN ERROR. Every lookup in this file is total: a
// missing row, a NULL column, a deleted participant, an unreachable database,
// or a malformed value all resolve to the neutral hero. A participant who has
// completed the assessment must always be able to read their Snapshot; the
// hero image is the least important thing on the page and must never be able to
// take the page down.

import { serviceClient } from "../db/client";
import {
  heroVariantForGender,
  type HeroVariant,
} from "./snapshot-hero";
import { verifiedFirstNameForParticipant } from "../session/service";

/** Everything the Section 1 hero needs, and nothing more. */
export interface SnapshotHeroData {
  /** The approved image variant, chosen from the explicit demographic response. */
  variant: HeroVariant;
  /**
   * The VERIFIED first name, or null.
   *
   * Name-gated exactly as the PDF cover is (Addendum 02 §3.2, §15): an
   * unverified or provisional participant gets null, and the personalization
   * line is OMITTED rather than filled with a placeholder. Reusing the existing
   * `verifiedFirstNameForParticipant` keeps ONE definition of "verified" — this
   * module must not grow a second one.
   */
  firstName: string | null;
}

/**
 * Resolve the hero's inputs for a session.
 *
 * Reads `assessment_sessions.participant_id` → `demographics.gender` (a single
 * SELECT of one column), and the verified first name through the existing
 * service helper. Resolves the session → participant hop in one query rather
 * than two, so the page does not pay for an extra round-trip.
 *
 * Never throws. On ANY failure the participant still gets a complete Snapshot
 * with the neutral hero and no personalization line.
 */
export async function resolveSnapshotHero(sessionId: string): Promise<SnapshotHeroData> {
  const fallback: SnapshotHeroData = { variant: "neutral", firstName: null };

  try {
    const db = serviceClient();

    // The session's participant. One query, one column.
    const { data: session } = await db
      .from("assessment_sessions")
      .select("participant_id")
      .eq("session_id", sessionId)
      .maybeSingle();

    const participantId =
      (session as { participant_id?: string | null } | null)?.participant_id ?? null;

    if (!participantId) return fallback;

    // The verified name reuses the ONE existing definition of "verified".
    const firstName = await verifiedFirstNameForParticipant(db, participantId).catch(
      () => null,
    );

    // The demographic gender, read from the session-keyed demographics row.
    // NOTE: `gender_self_describe` is deliberately NOT selected — it is never
    // read anywhere in this application, and selecting it here would be the
    // first step toward inferring from a participant's own words.
    const { data: demographics } = await db
      .from("demographics")
      .select("gender")
      .eq("session_id", sessionId)
      .maybeSingle();

    const gender = (demographics as { gender?: string | null } | null)?.gender ?? null;

    return { variant: heroVariantForGender(gender), firstName };
  } catch {
    // A demographics or session read that fails must not cost the participant
    // their Snapshot. Neutral hero, no name, page renders.
    return fallback;
  }
}
