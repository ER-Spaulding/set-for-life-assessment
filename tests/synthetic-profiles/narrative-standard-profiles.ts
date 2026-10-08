import type { ProfileOverrides } from "./build-profile";

/**
 * THE SIX MATERIALLY DIFFERENT SYNTHETIC PROFILES (Owner narrative-rewrite
 * standard §17), plus the golden walkthrough fixture (tests/
 * synthetic-profiles/golden-profile.test.ts) which makes seven.
 *
 * Each definition is a legitimate instrument answer set — letters and full
 * classifier codes the real question bank accepts — chosen to produce the
 * ENGINE DIAGNOSIS the Owner's validation list names:
 *
 *   1. clear visibility + limited capacity
 *   2. weak visibility + meaningful capacity
 *   3. clear direction + capacity-constrained alignment
 *   4. high information + low follow-through
 *   5. no meaningful friction
 *   6. limited agency evidence because of a capacity override
 *
 * Direction of travel: evidence → diagnosis → narrative. The expected
 * diagnoses below are asserted against the REAL engine in
 * narrative-standard-profiles.test.ts; the copy that follows in Phase 3 must
 * tell a genuinely different story for each (Owner §17: "not the same tone
 * with different nouns").
 */

export interface StandardProfile {
  id: string;
  ownerCase: string;
  overrides: ProfileOverrides;
  /** The diagnosis the REAL engine must produce — asserted in the test. */
  expect: {
    states: Record<string, string>; // signal -> displayState
    tensions: string[]; // exact, in engine order
    attentionAreas: string[]; // exact, [primary, secondary?]
    nullFinding?: boolean;
  };
}

export const STANDARD_PROFILES: StandardProfile[] = [
  {
    id: "clear-visibility-limited-capacity",
    ownerCase: "1. clear visibility + limited capacity",
    // Same family as the golden walkthrough (SEE strong, ROOM tight, capacity
    // overrides on Q11/Q12) but WITHOUT the preparedness friction pattern and
    // with its own destination/activation answers, so its story differs from
    // the golden profile's.
    overrides: {
      OPEN_A: "A",
      OPEN_B: "D",
      Q1: ["Q1_C", "Q1_F"],
      Q2: "D",
      Q3: "D",
      Q4: "E",
      Q5: "D",
      Q6: "D",
      Q7: "B",
      Q8: "A",
      Q9: ["Q9_A", "Q9_M"],
      Q10: "D",
      Q11: "A", // capacity override
      Q12: "F", // capacity override
      Q13: "C",
      Q14: "C",
      Q15: "C",
      Q16: ["Q16_B", "Q16_G"],
      Q17: "E",
      Q18: "D",
      Q19: "D",
      Q20: "C",
      Q21: ["Q21_G"],
      Q22: "C",
      Q23: "D",
      Q24: "D",
      Q25: "C",
      A1: "D",
      A2: "C",
      A3: "C",
      A4: "B",
    },
    expect: {
      states: {
        SEE: "S5",
        ROOM: "S1",
        DIRECT: "DIRECT_LIMITED_EVIDENCE_CAPACITY",
        PREPARE: "S3",
        AIM: "S5",
        MOVE: "S4",
      },
      tensions: ["HIGH_VISIBILITY_LOW_CAPACITY", "HIGH_DIRECTION_LOW_CAPACITY"],
      attentionAreas: ["CREATE_MORE_ROOM"],
    },
  },
  {
    id: "weak-visibility-meaningful-capacity",
    ownerCase: "2. weak visibility + meaningful capacity",
    // SEE pinned low (Q4–Q6 at the bottom of the ladder), ROOM pinned high —
    // the mirror image of profile 1. Hits ROOM's S5, so a signal-sourced
    // STRENGTH exists and the Money Picture / Strengths duplication question
    // (Owner §14) is genuinely exercised.
    overrides: {
      OPEN_A: "A",
      OPEN_B: "C",
      Q1: ["Q1_B"],
      Q2: "C",
      Q3: "B",
      Q4: "A",
      Q5: "A",
      Q6: "B",
      Q7: "E",
      Q8: "E",
      Q9: ["Q9_L"],
      Q10: "C",
      Q11: "C",
      Q12: "C",
      Q13: "D",
      Q14: "C",
      Q15: "D",
      Q16: ["Q16_D", "Q16_E"],
      Q17: "C",
      Q18: "C",
      Q19: "C",
      Q20: "C",
      Q21: ["Q21_G"],
      Q22: "C",
      Q23: "C",
      Q24: "C",
      Q25: "D",
      A1: "D",
      A2: "D",
      A3: "D",
      A4: "C",
    },
    expect: {
      states: {
        SEE: "S1",
        ROOM: "S5",
        DIRECT: "S3",
        PREPARE: "S4",
        AIM: "S3",
        MOVE: "S3",
      },
      tensions: ["LOW_VISIBILITY_HIGH_CAPACITY"],
      attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    },
  },
  {
    id: "clear-direction-capacity-constrained-alignment",
    ownerCase: "3. clear direction + capacity-constrained alignment",
    // The §13.7 override path, built from the acceptance-2 TEST 11 probe:
    // directionClarity 5 (Q17=E), q18Value 1 (Q18=A), AIM items mean(5,1,5)
    // (Q19=E), capacity mean 1 (Q7=Q8=A). AIM must display
    // AIM_CAPACITY_CONSTRAINED_ALIGNMENT — NOT low Direction — and the single
    // tension is CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT.
    overrides: {
      OPEN_A: "B",
      OPEN_B: "C",
      Q1: ["Q1_D"],
      Q2: "C",
      Q3: "C",
      Q4: "C",
      Q5: "C",
      Q6: "C",
      Q7: "A",
      Q8: "A",
      Q9: ["Q9_L"],
      Q10: "C",
      Q11: "C",
      Q12: "C",
      Q13: "C",
      Q14: "C",
      Q15: "C",
      Q16: ["Q16_F", "Q16_I"],
      Q17: "E",
      Q18: "A",
      Q19: "E",
      Q20: "C",
      Q21: ["Q21_G"],
      Q22: "C",
      Q23: "C",
      Q24: "C",
      Q25: "C",
      A1: "C",
      A2: "D",
      A3: "D",
      A4: "C",
    },
    expect: {
      states: {
        SEE: "S3",
        ROOM: "S1",
        DIRECT: "S3",
        PREPARE: "S3",
        AIM: "AIM_CAPACITY_CONSTRAINED_ALIGNMENT",
        MOVE: "S3",
      },
      tensions: [
        "CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT",
        "HIGH_DIRECTION_LOW_CAPACITY",
      ],
      attentionAreas: ["CREATE_MORE_ROOM"],
    },
  },
  {
    id: "high-information-low-follow-through",
    ownerCase: "4. high information + low follow-through",
    // The reachability probe for INFORMATION_EXECUTION_BOTTLENECK:
    // Q23=5, Q24=5, Q25=1 — high consumption and evaluation, low follow-through.
    // HIGH_INFORMATION_LOW_ACTION fires on the same input, giving this profile
    // two frictions in the knowing-vs-doing family.
    overrides: {
      OPEN_A: "A",
      OPEN_B: "D",
      Q1: ["Q1_A", "Q1_D"],
      Q2: "D",
      Q3: "C",
      Q4: "D",
      Q5: "C",
      Q6: "D",
      Q7: "C",
      Q8: "C",
      Q9: ["Q9_B", "Q9_F"],
      Q10: "D",
      Q11: "D",
      Q12: "D",
      Q13: "C",
      Q14: "C",
      Q15: "C",
      Q16: ["Q16_A", "Q16_I"],
      Q17: "D",
      Q18: "C",
      Q19: "D",
      Q20: "C",
      Q21: ["Q21_G"],
      Q22: "D",
      Q23: "E",
      Q24: "E",
      Q25: "A",
      A1: "D",
      A2: "D",
      A3: "B",
      A4: "D",
    },
    expect: {
      states: {
        SEE: "S4",
        ROOM: "S3",
        DIRECT: "S4",
        PREPARE: "S3",
        AIM: "S4",
        MOVE: "S4",
      },
      tensions: [
        "HIGH_INFORMATION_LOW_ACTION",
        "INFORMATION_EXECUTION_BOTTLENECK",
      ],
      attentionAreas: ["TURN_INFORMATION_INTO_ACTION"],
    },
  },
  {
    id: "no-meaningful-friction",
    ownerCase: "5. no meaningful friction",
    // Every signal-feeding item at the strong-but-not-extreme band so the six
    // signals land S3+ with several at S4 — the corroborated-all-clear gate —
    // while the exclusive no-pressure / no-fear classifier choices (defaults
    // Q9_L, Q21_G) keep contextual friction at zero. The engine must return the
    // NULL finding: no Friction and no Connection section may render, and the
    // attention area is KEEP_OBSERVING.
    overrides: {
      OPEN_A: "A",
      OPEN_B: "D",
      Q1: ["Q1_B"],
      Q2: "D",
      Q3: "D",
      Q4: "D",
      Q5: "D",
      Q6: "D",
      Q7: "D",
      Q8: "D",
      Q9: ["Q9_L"],
      Q10: "D",
      Q11: "D",
      Q12: "D",
      Q13: "D",
      Q14: "D",
      Q15: "D",
      Q16: ["Q16_B", "Q16_D", "Q16_I"],
      Q17: "D",
      Q18: "D",
      Q19: "D",
      Q20: "D",
      Q21: ["Q21_G"],
      Q22: "D",
      Q23: "D",
      Q24: "D",
      Q25: "D",
      A1: "C",
      A2: "D",
      A3: "D",
      A4: "D",
    },
    expect: {
      states: {
        SEE: "S4",
        ROOM: "S4",
        DIRECT: "S4",
        PREPARE: "S4",
        AIM: "S4",
        MOVE: "S4",
      },
      tensions: ["NO_MEANINGFUL_FRICTION_IDENTIFIED"],
      attentionAreas: ["KEEP_OBSERVING"],
      nullFinding: true,
    },
  },
  {
    id: "limited-agency-capacity-override",
    ownerCase: "6. limited agency evidence because of capacity override",
    // Q11/Q12 capacity overrides with everything else neutral: DIRECT displays
    // the limited-evidence special state, capacityConstrained selects
    // CAPACITY_FIRST, and there is no tension and no corroborated all-clear —
    // so the profile renders with the MINIMAL section set (no Friction, no
    // Connection, no Strengths, no Attention) rather than manufactured content.
    overrides: {
      OPEN_A: "A",
      OPEN_B: "B",
      Q1: ["Q1_B"],
      Q2: "C",
      Q3: "C",
      Q4: "C",
      Q5: "C",
      Q6: "C",
      Q7: "B",
      Q8: "B",
      Q9: ["Q9_L"],
      Q10: "C",
      Q11: "A", // capacity override
      Q12: "F", // capacity override
      Q13: "C",
      Q14: "C",
      Q15: "C",
      Q16: ["Q16_A"],
      Q17: "C",
      Q18: "C",
      Q19: "C",
      Q20: "C",
      Q21: ["Q21_G"],
      Q22: "C",
      Q23: "C",
      Q24: "C",
      Q25: "C",
      A1: "B",
      A2: "B",
      A3: "C",
      A4: "B",
    },
    expect: {
      states: {
        SEE: "S3",
        ROOM: "S2",
        DIRECT: "DIRECT_LIMITED_EVIDENCE_CAPACITY",
        PREPARE: "S3",
        AIM: "S3",
        MOVE: "S3",
      },
      tensions: [],
      attentionAreas: ["KEEP_OBSERVING"],
    },
  },
];
