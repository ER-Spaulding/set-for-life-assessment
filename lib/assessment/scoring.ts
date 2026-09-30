// PRD §13.2, §13.4, §13.5, §13.6, §13.7, §15 — scoring.
//
// Deterministic six-signal scoring (SEE, ROOM, DIRECT, PREPARE, AIM, MOVE).
// Question membership is exact per §13.2: Q9 never enters ROOM, Q16 never
// enters AIM. Thresholds (S1–S5 bands) are loaded from config/scoring-v1.0.json
// at runtime via loadScoringTables() — no numeric cutoffs are hard-coded here,
// so a future calibration is a config edit, not a code change.
//
// THE MOST IMPORTANT PRODUCT RULE (PRD §29 acceptance test 10):
// a low ROOM score must NEVER be converted into a low DIRECT score without
// Agency evidence — capacity constraint is not low agency. This is enforced
// structurally, not by convention:
//   1. scoreDirect() accepts ONLY the Q10/Q11/Q12 answers. There is no
//      parameter through which a ROOM value, a capacity mean, or any other
//      signal could leak into the Agency average — the type signature makes
//      the contamination unrepresentable.
//   2. Overridden items (Q11_A, Q12_F) contribute NO numeric value and are
//      excluded from the mean denominator — never imputed, never scored as 1.
//   3. The Q18 capacity modifier (§13.7) may select narrative state, but it is
//      computed in overrides.ts and NEVER alters any numeric average here.
// A regression case lives in the scratch check: strong SEE + weak ROOM must
// leave DIRECT high when Q10–Q12 are strong.
//
// Pure functions only: no I/O, no Date, no randomness. Same input → same output.

import {
  evaluateCapacityOverrides,
  evaluateQ18CapacityModifier,
  directSpecialState,
  type CapacityOverrideFlags,
  type DirectSpecialState,
  type Q18Cutoffs,
} from './overrides';
import type { SignalId, SignalState, SpecialSignalState } from './types';

// ---------------------------------------------------------------------------
// Config tables (loaded from scoring-v1.0.json — never literals)
// ---------------------------------------------------------------------------

/** One S-band boundary row, as stored under signals.<ID>.states in config. */
export interface BandRow {
  state: SignalState;
  min: number;
  max: number;
}

/**
 * Everything scoring needs from config, extracted at runtime.
 * Build with loadScoringTables(scoringConfigJson).
 */
export interface ScoringTables {
  /** Option-letter → numeric value per map. null = capacity override (no value). */
  values: {
    profile: Record<string, number | null>;
    q11: Record<string, number | null>;
    q12: Record<string, number | null>;
    q18: Record<string, number | null>;
  };
  /** S1–S5 bands per signal, in ladder order. */
  bands: Record<SignalId, BandRow[]>;
}

/** Question membership per signal (§13.2, exact). */
export const SIGNAL_QUESTIONS: Record<SignalId, string[]> = {
  SEE: ['Q4', 'Q5', 'Q6'],
  ROOM: ['Q7', 'Q8'],
  DIRECT: ['Q10', 'Q11', 'Q12'],
  PREPARE: ['Q13', 'Q14', 'Q15'],
  AIM: ['Q17', 'Q18', 'Q19'],
  MOVE: ['Q23', 'Q24', 'Q25'],
};

const SIGNAL_ORDER: SignalId[] = [
  'SEE',
  'ROOM',
  'DIRECT',
  'PREPARE',
  'AIM',
  'MOVE',
];

const STATE_ORDER: SignalState[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

/**
 * Extract value maps and S-bands from the raw scoring config object
 * (the parsed JSON of config/scoring-v1.0.json). Reads option_value_maps
 * (profile_1_5, Q11_*, Q12_*, Q18_*) and signals.<ID>.states.<S>.{min,max}.
 * Throws a descriptive error if the expected shape is absent.
 */
export function loadScoringTables(scoringConfig: unknown): ScoringTables {
  const cfg = scoringConfig as Record<string, unknown>;
  const ovm = cfg['option_value_maps'] as Record<string, unknown> | undefined;
  if (!ovm) {
    throw new Error('scoring.loadScoringTables: missing option_value_maps');
  }
  const pickMap = (...candidates: string[]): Record<string, number | null> => {
    for (const key of candidates) {
      const raw = ovm[key] as Record<string, unknown> | undefined;
      if (raw) {
        const out: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (k.startsWith('_')) continue;
          // Keys may be bare letters ("A") or prefixed codes ("Q11_A").
          const letter = k.includes('_') ? k.split('_').pop()! : k;
          out[letter] = typeof v === 'number' ? v : null;
        }
        return out;
      }
    }
    throw new Error(
      `scoring.loadScoringTables: none of [${candidates.join(', ')}] found in option_value_maps`,
    );
  };
  const signals = cfg['signals'] as Record<string, unknown> | undefined;
  if (!signals) {
    throw new Error('scoring.loadScoringTables: missing signals block');
  }
  const bands = {} as Record<SignalId, BandRow[]>;
  for (const id of SIGNAL_ORDER) {
    const sig = signals[id] as Record<string, unknown> | undefined;
    const states = sig?.['states'] as
      | Record<string, { min: number; max: number }>
      | undefined;
    if (!states) {
      throw new Error(
        `scoring.loadScoringTables: missing signals.${id}.states`,
      );
    }
    bands[id] = STATE_ORDER.map((s) => {
      const row = states[s];
      if (typeof row?.min !== 'number' || typeof row?.max !== 'number') {
        throw new Error(
          `scoring.loadScoringTables: bad band signals.${id}.states.${s}`,
        );
      }
      return { state: s, min: row.min, max: row.max };
    });
  }
  return {
    values: {
      profile: pickMap('profile_1_5'),
      q11: pickMap('Q11_capacity_override_first_else_2_5', 'Q11'),
      q12: pickMap('Q12_capacity_override_last_else_1_5', 'Q12'),
      q18: pickMap('Q18_profile_1_5', 'Q18'),
    },
    bands,
  };
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** MOVE subsignals (§13.2): Consumption=Q23, Analysis=Q24, Action=Q25. */
export interface MoveSubsignals {
  consumption: number | null;
  analysis: number | null;
  action: number | null;
}

export interface SignalScore {
  signal: SignalId;
  /** Mean of the contributing items, or null when there is no evidence. */
  value: number | null;
  /** S-ladder position of value (reference position even when overridden). */
  state: SignalState | null;
  /** Off-ladder state when a capacity rule applies, else null. */
  specialState: SpecialSignalState | null;
  /**
   * The state consumers should render: the special state when one applies,
   * otherwise the ladder state. Null only when value is null.
   */
  displayState: SignalState | SpecialSignalState | null;
}

export interface ScoringResult {
  signals: Record<SignalId, SignalScore>;
  moveSubsignals: MoveSubsignals;
  overrideFlags: CapacityOverrideFlags;
  directSpecial: DirectSpecialState;
  /** §13.7 modifier fired (AIM renders capacity-constrained language). */
  q18ModifierFired: boolean;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function bandFor(value: number | null, bands: BandRow[]): SignalState | null {
  if (value === null) return null;
  for (const b of bands) {
    if (value >= b.min && value <= b.max) return b.state;
  }
  // Clamp float-edge cases to the nearest end of the ladder.
  if (value < bands[0].min) return bands[0].state;
  return bands[bands.length - 1].state;
}

function lookup(
  map: Record<string, number | null>,
  option: string | null | undefined,
): number | null {
  if (option == null) return null;
  const v = map[option];
  return typeof v === 'number' ? v : null;
}

// ---------------------------------------------------------------------------
// DIRECT — agency only. See the product-rule comment at the top of this file:
// this function takes the three DIRECT answers and nothing else, so ROOM
// cannot influence the result by construction.
// ---------------------------------------------------------------------------

export interface DirectInput {
  q10: string | null | undefined;
  q11: string | null | undefined;
  q12: string | null | undefined;
}

export function scoreDirect(
  input: DirectInput,
  tables: ScoringTables,
): {
  value: number | null;
  state: SignalState | null;
  specialState: SpecialSignalState | null;
  displayState: SignalState | SpecialSignalState | null;
  flags: CapacityOverrideFlags;
  special: DirectSpecialState;
} {
  const flags = evaluateCapacityOverrides(input.q11, input.q12);
  const special = directSpecialState(flags);
  // Overridden items are dropped from the average entirely (§13.4–§13.6):
  // they are substantive capacity answers, not low-agency evidence, so they
  // must not pull the mean down — not even as a 1.
  const contributors: Array<number | null> = [lookup(tables.values.profile, input.q10)];
  if (!flags.Q11_CAPACITY_OVERRIDE) {
    contributors.push(lookup(tables.values.q11, input.q11));
  }
  if (!flags.Q12_CAPACITY_OVERRIDE) {
    contributors.push(lookup(tables.values.q12, input.q12));
  }
  const value = mean(contributors);
  const state = bandFor(value, tables.bands.DIRECT);
  const specialState: SpecialSignalState | null =
    special === 'NONE' ? null : special;
  return {
    value,
    state,
    specialState,
    displayState: specialState ?? state,
    flags,
    special,
  };
}

// ---------------------------------------------------------------------------
// Full assessment
// ---------------------------------------------------------------------------

/**
 * Score all six signals.
 * @param responses map of question id → option letter answered
 *   (e.g. { Q4: 'D', Q11: 'A', ... }). Unanswered items are absent or null.
 * @param tables from loadScoringTables(scoringConfig).
 * @param q18cutoffs from loadQ18Cutoffs(scoringConfig); when omitted the
 *   §13.7 modifier is not evaluated (q18ModifierFired = false).
 */
export function scoreAssessment(
  responses: Record<string, string | null | undefined>,
  tables: ScoringTables,
  q18cutoffs?: Q18Cutoffs,
): ScoringResult {
  const at = (id: string): string | null | undefined => responses[id];
  const profileVal = (id: string): number | null =>
    lookup(tables.values.profile, at(id));

  const see = mean(SIGNAL_QUESTIONS.SEE.map(profileVal));
  // ROOM = avg(Q7, Q8) only. Q9 is explanatory context and MUST never enter
  // the average — scoreRoom intentionally does not read responses['Q9'].
  const room = mean(SIGNAL_QUESTIONS.ROOM.map(profileVal));
  const prepare = mean(SIGNAL_QUESTIONS.PREPARE.map(profileVal));
  // AIM = avg(Q17, Q18, Q19). Q16 is destination context only and MUST never
  // enter the average.
  const q18Value = lookup(tables.values.q18, at('Q18'));
  const aim = mean([profileVal('Q17'), q18Value, profileVal('Q19')]);
  const moveVals = SIGNAL_QUESTIONS.MOVE.map(profileVal);
  const move = mean(moveVals);

  const direct = scoreDirect(
    { q10: at('Q10'), q11: at('Q11'), q12: at('Q12') },
    tables,
  );

  // §13.7: direction clarity is mean(Q17, Q19) — deliberately WITHOUT Q18 —
  // compared with the Q18 alignment value and the capacity (ROOM) mean.
  // The modifier changes narrative selection only; no numeric average above
  // is touched by it.
  const directionClarity = mean([profileVal('Q17'), profileVal('Q19')]);
  const q18ModifierFired =
    q18cutoffs !== undefined
      ? evaluateQ18CapacityModifier(
          { directionClarity, q18Value, capacityMean: room },
          q18cutoffs,
        )
      : false;
  const aimSpecial: SpecialSignalState | null = q18ModifierFired
    ? 'AIM_CAPACITY_CONSTRAINED_ALIGNMENT'
    : null;

  const build = (
    signal: SignalId,
    value: number | null,
    specialState: SpecialSignalState | null = null,
  ): SignalScore => {
    const state = bandFor(value, tables.bands[signal]);
    return {
      signal,
      value,
      state,
      specialState,
      displayState: specialState ?? state,
    };
  };

  return {
    signals: {
      SEE: build('SEE', see),
      ROOM: build('ROOM', room),
      DIRECT: {
        signal: 'DIRECT',
        value: direct.value,
        state: direct.state,
        specialState: direct.specialState,
        displayState: direct.displayState,
      },
      PREPARE: build('PREPARE', prepare),
      AIM: build('AIM', aim, aimSpecial),
      MOVE: build('MOVE', move),
    },
    moveSubsignals: {
      consumption: moveVals[0] ?? null,
      analysis: moveVals[1] ?? null,
      action: moveVals[2] ?? null,
    },
    overrideFlags: direct.flags,
    directSpecial: direct.special,
    q18ModifierFired,
  };
}
