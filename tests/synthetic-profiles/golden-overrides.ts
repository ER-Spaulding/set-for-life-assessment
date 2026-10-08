import type { ProfileOverrides } from "./build-profile";

/**
 * The walkthrough's 31 answers. Single-selects as bare letters (the builder's
 * convention), the four classifiers as full option-code arrays — exactly as
 * stored.
 */
export const GOLDEN_OVERRIDES: ProfileOverrides = {
  OPEN_A: "A",
  OPEN_B: "C",
  Q1: ["Q1_C", "Q1_D"],
  Q2: "D",
  Q3: "C",
  Q4: "D",
  Q5: "D",
  Q6: "C",
  Q7: "B",
  Q8: "B",
  Q9: ["Q9_A", "Q9_B", "Q9_F"],
  Q10: "C",
  Q11: "A", // capacity override — no numeric value
  Q12: "F", // capacity override — no numeric value
  Q13: "B",
  Q14: "D",
  Q15: "C",
  Q16: ["Q16_A", "Q16_B", "Q16_D"],
  Q17: "D",
  Q18: "D",
  Q19: "C",
  Q20: "D",
  Q21: ["Q21_G"],
  Q22: "E",
  Q23: "D",
  Q24: "D",
  Q25: "D",
  A1: "C",
  A2: "C",
  A3: "D",
  A4: "D",
};
