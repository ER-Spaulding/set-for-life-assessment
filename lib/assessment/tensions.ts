// PRD §15 — tensions: evaluates the 18 tension codes, producing the
// triggered subset. Only a triggered key may render its statement.
//
// CONFIG-DRIVEN (§15: "thresholds as configuration, not hard-coded
// literals"): every entry of config/scoring-v1.0.json `.tensions` carries its
// own `trigger` predicate tree, and every numeric cutoff resolves through
// `.tension_thresholds` (parsed here — never literals in code). Recalibrating
// the config changes engine behaviour with no code change. An unresolvable
// or unparsable `threshold_ref` THROWS loudly rather than guessing a
// default, so calibration drift can never fail silent.
//
// PRD §18.3 (hard product rule): NO_MEANINGFUL_FRICTION_IDENTIFIED must be
// reachable and must NEVER be replaced by an invented weakness — if nothing
// triggers and the null condition holds, the null finding is returned; if
// the null condition does not hold either, an empty list is returned (no
// friction section renders) rather than a low signal dressed up as friction.
//
// Pure functions. No I/O, no network, no Date.now(), no randomness.

import scoringDefaults from '../../config/scoring-v1.0.json';
import connectionStatements from '../../config/connection-statements-v1.0.json';
import {
  evaluateQ18CapacityModifier,
  loadQ18Cutoffs,
} from './overrides';
import type {
  ActivationLevel,
  SignalId,
  SignalState,
  TensionCode,
} from './types';

/** Inputs the tension engine needs. Owned by sibling modules' outputs. */
export interface TensionInputs {
  /** Operating signal states (from the scoring engine). */
  signalStates: Record<SignalId, SignalState>;
  /** Raw item values, 1–5 Likert (e.g. { Q4: 4, Q5: 2, ... }). */
  items: Record<string, number>;
  /** Four separate activation levels (from activation.ts — never averaged). */
  activation: Record<string, ActivationLevel>;
  /** Classifier tags across Q1/Q9/Q16/Q21 (default: none). */
  tags?: string[];
  /** Any Q21 selection other than exclusive Q21_G (default: false). */
  fearPresent?: boolean;
  /**
   * Capacity mean (ROOM items). Falls back to mean(Q7, Q8) when both are
   * present; undefined otherwise (capacity-gated rules cannot trigger).
   */
  capacityMean?: number;
}

// ---------------------------------------------------------------------------
// Threshold resolution (PRD §15)
// ---------------------------------------------------------------------------

/** A parsed comparison from a `tension_thresholds` prose value (e.g. ">= 4"). */
export interface ParsedThreshold {
  op: '>=' | '<=' | '>' | '<' | '=';
  n: number;
}

/**
 * Resolved numeric thresholds, keyed by short name (`item_high`, `item_low`,
 * `pair_low_avg`, …). Produced by loadTensionThresholds() from the raw
 * scoring config — never constructed by hand in engine code.
 */
export type TensionThresholds = Record<string, ParsedThreshold>;

const NUMBER_RE = /-?\d+(\.\d+)?/g;

/**
 * Parse a prose threshold value such as ">= 4" or "<= 2.5" into operator +
 * number. Throws a descriptive error when the value has no number or no
 * recognisable operator — the caller must fix the config, not guess.
 */
export function parseThresholdValue(
  raw: string,
  label: string,
): ParsedThreshold {
  const all = typeof raw === 'string' ? raw.match(NUMBER_RE) : null;
  // Take the LAST number: threshold prose can embed question ids too
  // (e.g. "mean(Q17, Q19) >= 4.0" — the threshold 4.0 is the final number).
  // Same approach as overrides.loadQ18Cutoffs.
  const m = all?.[all.length - 1];
  if (!m) {
    throw new Error(
      `tensions.parseThresholdValue: cannot parse a number from ${label} (${JSON.stringify(raw)})`,
    );
  }
  // `m` is the whole matched string (match() with /g returns strings, not
  // match arrays). Number(m[0]) would take the FIRST CHARACTER and silently
  // truncate "2.5" to 2 — parse the whole match.
  const n = Number(m);
  if (!Number.isFinite(n)) {
    throw new Error(
      `tensions.parseThresholdValue: parsed number is not finite for ${label} (${JSON.stringify(raw)})`,
    );
  }
  // Check two-character operators before their one-character prefixes.
  const op: ParsedThreshold['op'] | null = raw.includes('>=')
    ? '>='
    : raw.includes('<=')
      ? '<='
      : raw.includes('>')
        ? '>'
        : raw.includes('<')
          ? '<'
          : raw.includes('=')
            ? '='
            : null;
  if (!op) {
    throw new Error(
      `tensions.parseThresholdValue: cannot parse an operator from ${label} (${JSON.stringify(raw)})`,
    );
  }
  return { op, n };
}

/** Apply a parsed threshold comparison to one observed value. */
export function applyThresholdOp(actual: number, t: ParsedThreshold): boolean {
  switch (t.op) {
    case '>=':
      return actual >= t.n;
    case '<=':
      return actual <= t.n;
    case '>':
      return actual > t.n;
    case '<':
      return actual < t.n;
    case '=':
      return actual === t.n;
  }
}

/**
 * Resolve `.tension_thresholds` from the raw scoring config object
 * (config/scoring-v1.0.json) into numeric thresholds. Entries without a
 * string `value` (e.g. the signal_high states/numeric descriptors) carry no
 * item-level cutoff and are skipped. Throws when the block is missing or
 * when the required item_high / item_low cutoffs are absent.
 */
export function loadTensionThresholds(
  scoringConfig: unknown,
): TensionThresholds {
  const cfg = scoringConfig as Record<string, unknown> | null | undefined;
  const block = cfg?.['tension_thresholds'] as
    | Record<string, unknown>
    | undefined;
  if (!block || typeof block !== 'object') {
    throw new Error(
      'tensions.loadTensionThresholds: missing tension_thresholds in scoring config',
    );
  }
  const out: TensionThresholds = {};
  for (const [key, entry] of Object.entries(block)) {
    if (key.startsWith('_')) continue; // documentation metadata, not a threshold
    const value = (entry as Record<string, unknown> | undefined)?.['value'];
    if (typeof value !== 'string') continue;
    out[key] = parseThresholdValue(value, `tension_thresholds.${key}`);
  }
  if (!out['item_high'] || !out['item_low']) {
    throw new Error(
      'tensions.loadTensionThresholds: tension_thresholds must define item_high and item_low',
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic trigger evaluator (PRD §15)
// ---------------------------------------------------------------------------

/** Resolve a `threshold_ref` (e.g. "tension_thresholds.item_high") — throws. */
function thresholdForRef(
  ref: unknown,
  thresholds: TensionThresholds,
): ParsedThreshold {
  const key =
    typeof ref === 'string' && ref.includes('.')
      ? String(ref.split('.').pop())
      : String(ref);
  const t = thresholds[key];
  if (!t) {
    throw new Error(
      `tensions: unknown threshold_ref ${JSON.stringify(ref)} — no matching tension_thresholds entry (available: ${Object.keys(thresholds).join(', ')})`,
    );
  }
  return t;
}

function asStringArray(value: unknown, what: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === 'string')
  ) {
    throw new Error(
      `tensions: malformed trigger — ${what} must be a string array (${JSON.stringify(value)})`,
    );
  }
  return value as string[];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function capacityMeanOf(inputs: TensionInputs): number | undefined {
  if (inputs.capacityMean !== undefined) return inputs.capacityMean;
  const { items } = inputs;
  const q7 = numberOrUndefined(items['Q7']);
  const q8 = numberOrUndefined(items['Q8']);
  if (q7 !== undefined && q8 !== undefined) {
    return (q7 + q8) / 2;
  }
  return undefined;
}

/**
 * Evaluate one leaf condition. Dispatches on the single known key present:
 * signal, item_gte, item_lte, avg_lte, tag_present, tag_absent,
 * any_tag_present, fear_present, activation_high, any_activation_high.
 *
 * Evidence rules (no trigger without evidence): missing items, missing
 * signal states, or missing activation levels never satisfy a clause.
 * Within one clause, a list means ALL (item_gte, item_lte, tag_present,
 * activation_high); the `any_*` variants mean AT LEAST ONE; tag_absent
 * means NONE present. Throws on malformed or unknown conditions so config
 * typos fail loud instead of silently never firing.
 */
function evaluateLeaf(
  node: Record<string, unknown>,
  inputs: TensionInputs,
  thresholds: TensionThresholds,
): boolean {
  const tags = inputs.tags ?? [];
  const fear = inputs.fearPresent === true;
  const items = inputs.items ?? {};
  const states = inputs.signalStates as
    | Partial<Record<string, SignalState>>
    | undefined;
  const activation = inputs.activation as
    | Partial<Record<string, ActivationLevel>>
    | undefined;

  if ('signal' in node) {
    if (typeof node['signal'] !== 'string' || !Array.isArray(node['state_in'])) {
      throw new Error(
        `tensions: malformed signal condition (${JSON.stringify(node)})`,
      );
    }
    const cur: unknown = states?.[node['signal'] as string];
    return (node['state_in'] as unknown[]).includes(cur);
  }
  if ('item_gte' in node || 'item_lte' in node) {
    // The comparison operator comes from the referenced threshold itself,
    // so a recalibration (e.g. item_high "> 4") takes effect with no code
    // change. Missing items never satisfy the clause.
    const ids = asStringArray(
      node['item_gte'] ?? node['item_lte'],
      'item_gte/item_lte',
    );
    const t = thresholdForRef(node['threshold_ref'], thresholds);
    return ids.every((id) => {
      const v = numberOrUndefined(items[id]);
      return v !== undefined && applyThresholdOp(v, t);
    });
  }
  if ('avg_lte' in node) {
    const spec = node['avg_lte'] as
      | { items?: unknown; value?: unknown }
      | undefined;
    const ids = asStringArray(spec?.items, 'avg_lte.items');
    if (ids.length === 0) return false;
    let sum = 0;
    for (const id of ids) {
      const v = numberOrUndefined(items[id]);
      if (v === undefined) return false;
      sum += v;
    }
    const mean = sum / ids.length;
    if (node['threshold_ref'] !== undefined) {
      return applyThresholdOp(
        mean,
        thresholdForRef(node['threshold_ref'], thresholds),
      );
    }
    if (typeof spec?.value !== 'number') {
      throw new Error(
        `tensions: malformed avg_lte condition — needs a numeric value or a threshold_ref (${JSON.stringify(node)})`,
      );
    }
    return mean <= spec.value;
  }
  if ('tag_present' in node) {
    return asStringArray(node['tag_present'], 'tag_present').every((t) =>
      tags.includes(t),
    );
  }
  if ('tag_absent' in node) {
    return asStringArray(node['tag_absent'], 'tag_absent').every(
      (t) => !tags.includes(t),
    );
  }
  if ('any_tag_present' in node) {
    return asStringArray(node['any_tag_present'], 'any_tag_present').some(
      (t) => tags.includes(t),
    );
  }
  if ('fear_present' in node) {
    return fear === (node['fear_present'] === true);
  }
  if ('activation_high' in node) {
    return asStringArray(node['activation_high'], 'activation_high').every(
      (k) => activation?.[k] === 'HIGH',
    );
  }
  if ('any_activation_high' in node) {
    return asStringArray(
      node['any_activation_high'],
      'any_activation_high',
    ).some((k) => activation?.[k] === 'HIGH');
  }
  throw new Error(
    `tensions: unknown trigger condition (${JSON.stringify(node)}) — expected one of signal/item_gte/item_lte/avg_lte/tag_present/tag_absent/any_tag_present/fear_present/activation_high/any_activation_high`,
  );
}

/**
 * Recursively evaluate a config `trigger` predicate tree against inputs.
 * `{"all": [...]}` requires every child; `{"any": [...]}` requires at
 * least one; both nest arbitrarily. An empty object `{}` — and an empty
 * `all`/`any` list (no vacuous truth) — never fires as a tension; the two
 * system codes without inline triggers are selected by other logic (see
 * evaluateTensions). Malformed triggers and unresolvable `threshold_ref`s
 * throw; partial inputs (missing items/states) simply evaluate to false.
 */
export function evaluateTensionTrigger(
  trigger: unknown,
  inputs: TensionInputs,
  thresholds: TensionThresholds,
): boolean {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    throw new Error(
      `tensions: malformed trigger — expected a condition object (${JSON.stringify(trigger)})`,
    );
  }
  const node = trigger as Record<string, unknown>;
  if (Object.keys(node).length === 0) {
    // {} is the system-code placeholder shape: it must never fire as a
    // tension. CLEAR_DESTINATION_… is selected via the §13.7 override path
    // and NO_MEANINGFUL_FRICTION_IDENTIFIED via the null path below.
    return false;
  }
  if ('all' in node) {
    const kids = node['all'];
    if (!Array.isArray(kids) || kids.length === 0) return false;
    return kids.every((k) => evaluateTensionTrigger(k, inputs, thresholds));
  }
  if ('any' in node) {
    const kids = node['any'];
    if (!Array.isArray(kids) || kids.length === 0) return false;
    return kids.some((k) => evaluateTensionTrigger(k, inputs, thresholds));
  }
  return evaluateLeaf(node, inputs, thresholds);
}

/**
 * §13.7 system code via its config `trigger_ref`
 * (overrides.Q18_capacity_modifier.condition). Cutoffs resolve through
 * overrides.loadQ18Cutoffs — the same parser, never literals — and missing
 * evidence yields false, matching the modifier's contract.
 */
function evaluateClearDestination(
  inputs: TensionInputs,
  scoringConfig: unknown,
): boolean {
  const { items } = inputs;
  const q17 = numberOrUndefined(items['Q17']);
  const q19 = numberOrUndefined(items['Q19']);
  const q18 = numberOrUndefined(items['Q18']);
  const cutoffs = loadQ18Cutoffs(scoringConfig);
  return evaluateQ18CapacityModifier(
    {
      directionClarity:
        q17 !== undefined && q19 !== undefined ? (q17 + q19) / 2 : null,
      q18Value: q18 ?? null,
      capacityMean: capacityMeanOf(inputs) ?? null,
    },
    cutoffs,
  );
}

// ---------------------------------------------------------------------------
// Null finding (PRD §18.3) — unchanged semantics
// ---------------------------------------------------------------------------

/**
 * Contextual friction tags (operationalization of the null-finding
 * "no meaningful contextual friction" clause; ASSUMED pending operator
 * review). Any pressure/fear/avoidance/overload tag counts; the explicit
 * no-friction tags (NO_SIGNIFICANT_PRESSURE, NO_SIGNIFICANT_FEAR_FRICTION)
 * and the neutral Q1-environment / Q16-destination tags do not.
 */
const CONTEXT_FRICTION_TAGS: readonly string[] = [
  'INCOME_PRESSURE',
  'LOW_AVAILABLE_MONEY',
  'DEBT_PRESSURE',
  'MAJOR_FIXED_COST_PRESSURE',
  'COST_OF_LIVING_PRESSURE',
  'INCOME_VOLATILITY',
  'UNEXPECTED_EXPENSE_PRESSURE',
  'SPENDING_PRESSURE',
  'FAMILY_SUPPORT_PRESSURE',
  'LEGACY_COMMITMENT_PRESSURE',
  'UNIDENTIFIED_PRESSURE',
  'OTHER_PRESSURE',
  'INFORMATION_OVERLOAD',
  'TRUTH_AVOIDANCE',
  'JUDGMENT_EXPOSURE',
  'WRONG_DECISION_FEAR',
  'REGRET_COMMITMENT_FEAR',
  'EXPLOITATION_PRESSURE_CONCERN',
  'OTHER_FEAR_FRICTION',
];

/** True when tags or fear presence show meaningful contextual friction. */
export function hasMeaningfulContextualFriction(
  tags: string[],
  fearPresent: boolean,
): boolean {
  if (fearPresent) return true;
  return tags.some((t) => CONTEXT_FRICTION_TAGS.includes(t));
}

const STATE_RANK: Record<SignalState, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
};

/** Every operating signal at S3 or above. */
export function allSignalsS3OrAbove(
  states: Record<SignalId, SignalState>,
): boolean {
  const signals: SignalId[] = ['SEE', 'ROOM', 'DIRECT', 'PREPARE', 'AIM', 'MOVE'];
  return signals.every(
    (s) => states[s] !== undefined && STATE_RANK[states[s]] >= 3,
  );
}

function tagsOf(inputs: TensionInputs): string[] {
  return inputs.tags ?? [];
}

function fearOf(inputs: TensionInputs): boolean {
  return inputs.fearPresent === true;
}

/**
 * Null-finding condition (config `null_finding.operationalization`):
 * no other tension triggered AND every operating signal at S3 or above
 * AND no meaningful contextual friction.
 */
export function isNullFinding(
  triggeredExcludingNull: TensionCode[],
  inputs: TensionInputs,
): boolean {
  return (
    triggeredExcludingNull.length === 0 &&
    allSignalsS3OrAbove(inputs.signalStates) &&
    !hasMeaningfulContextualFriction(tagsOf(inputs), fearOf(inputs))
  );
}

// ---------------------------------------------------------------------------
// Top-level evaluation
// ---------------------------------------------------------------------------

const NULL_CODE = 'NO_MEANINGFUL_FRICTION_IDENTIFIED';
const CLEAR_DESTINATION_CODE = 'CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT';
const Q18_CONDITION_REF = 'overrides.Q18_capacity_modifier.condition';

/**
 * Evaluate all tensions in canonical config order. Reads `.tensions` from
 * the scoring config (defaults to the bundled config/scoring-v1.0.json so
 * existing single-argument callers keep working); each entry's inline
 * `trigger` is evaluated generically, the §13.7 code resolves its
 * `trigger_ref` through the override cutoffs, and the §18.3 null code is
 * selected by the null path — entries without an inline trigger never fire
 * as tensions. Returns the triggered codes; returns
 * [NO_MEANINGFUL_FRICTION_IDENTIFIED] when the null condition holds;
 * returns [] when neither regular tensions nor the null condition hold —
 * never an invented weakness. Only codes in the TensionCode union are ever
 * emitted (anything else throws). Config errors throw; partial inputs
 * evaluate to false.
 */
export function evaluateTensions(
  inputs: TensionInputs,
  scoringConfig: unknown = scoringDefaults,
): TensionCode[] {
  const cfg = scoringConfig as Record<string, unknown> | null | undefined;
  const tensions = cfg?.['tensions'] as
    | Record<string, Record<string, unknown> | undefined>
    | undefined;
  if (!tensions || typeof tensions !== 'object') {
    throw new Error(
      'tensions.evaluateTensions: scoring config is missing the .tensions block',
    );
  }
  const thresholds = loadTensionThresholds(scoringConfig);
  const triggered: TensionCode[] = [];
  for (const code of Object.keys(tensions)) {
    if (code.startsWith('_')) continue; // documentation metadata, not a code
    if (code === NULL_CODE) continue; // selected by the null path below
    if (!(code in connectionStatements)) {
      throw new Error(
        `tensions.evaluateTensions: config tensions key ${JSON.stringify(code)} is not a TensionCode in the connection-statement library`,
      );
    }
    const entry = tensions[code];
    const trigger = entry?.['trigger'];
    if (trigger === undefined) {
      // No inline trigger: a system code selected by other logic.
      if (
        code === CLEAR_DESTINATION_CODE &&
        entry?.['trigger_ref'] === Q18_CONDITION_REF
      ) {
        if (evaluateClearDestination(inputs, scoringConfig)) {
          triggered.push(code as TensionCode);
        }
        continue;
      }
      throw new Error(
        `tensions.evaluateTensions: ${code} has no inline trigger and no supported trigger_ref (${JSON.stringify(entry?.['trigger_ref'])})`,
      );
    }
    if (evaluateTensionTrigger(trigger, inputs, thresholds)) {
      triggered.push(code as TensionCode);
    }
  }
  if (triggered.length > 0) return triggered;
  if (isNullFinding(triggered, inputs)) {
    return [NULL_CODE as TensionCode];
  }
  return [];
}
