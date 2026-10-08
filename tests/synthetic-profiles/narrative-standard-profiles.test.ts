import { describe, it, expect } from "vitest";

// THE SIX STANDARD PROFILES, RUN THROUGH THE REAL ENGINE (Owner §17).
//
// Phase A of the narrative-rewrite validation: prove each answer set produces
// the ENGINE DIAGNOSIS its owner case names — evidence first, always. The
// narrative layer (Phase B, the same file's sibling tests) then has a
// trustworthy diagnosis to be interpreted against: if the engine's output here
// were wrong, every copy assertion downstream would be checking fiction.

import { STANDARD_PROFILES } from "./narrative-standard-profiles";
import { completeProfile } from "./profile-runner";

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;

/** The payload's full tension-code list, in engine order, with the null code. */
function tensionCodes(payload: Awaited<ReturnType<typeof completeProfile>>): string[] {
  const fromFindings = [...payload.frictions, ...payload.strengths]
    .filter((f) => f.source === "tension")
    .map((f) => f.code);
  // Engine order is config listing order; the payload splits findings into two
  // lists, so re-merge in a stable way for comparison.
  const merged = payload.nullFinding
    ? ["NO_MEANINGFUL_FRICTION_IDENTIFIED", ...fromFindings]
    : fromFindings;
  return merged.sort();
}

describe.each(STANDARD_PROFILES)("standard profile: $id ($ownerCase)", (profile) => {
  it("produces the engine diagnosis its owner case names", async () => {
    const payload = await completeProfile(profile.overrides);

    // ---- six Money Picture display states ----
    const states = Object.fromEntries(
      payload.signals.map((s) => [s.signal, s.displayState ?? s.state]),
    );

    // Log BEFORE asserting so a failing profile still shows the engine's full
    // verdict (the diagnosis table is the useful output either way).
    console.log(
      `  ${profile.id}: states=${JSON.stringify(states)} ` +
        `tensions=${JSON.stringify(tensionCodes(payload))} ` +
        `nullFinding=${payload.nullFinding} ` +
        `attention=${JSON.stringify(payload.attentionAreas)} ` +
        `template=${payload.bigPicture.template} ` +
        `strengths=${payload.strengths.length} frictions=${payload.frictions.length} ` +
        `connections=${payload.connections.length} ` +
        `activation=${JSON.stringify(payload.activation)}`,
    );

    for (const signal of SIGNALS) {
      expect(states[signal], `${signal} displayState`).toBe(profile.expect.states[signal]);
    }

    // ---- tension codes (exact set) ----
    expect(tensionCodes(payload).sort()).toEqual([...profile.expect.tensions].sort());

    // ---- attention areas ----
    expect(payload.attentionAreas).toEqual(profile.expect.attentionAreas);

    // ---- null finding ----
    expect(payload.nullFinding).toBe(profile.expect.nullFinding ?? false);
  });
});
