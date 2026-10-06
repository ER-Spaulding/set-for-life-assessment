// PRD §8, §13, §22, §23.2, §23.5 — the assessment session service.
//
// THIS MODULE IS SERVER-ONLY and carries the two rules the whole API layer
// exists to enforce.
//
// PRD §23.5, verbatim:
//   "Never trust client-side completion, identity ownership, scoring, or
//    consent state. Required-item validation and final scoring run server-side."
//
// PRD §24, verbatim:
//   "Do not expose internal classifier tags or diagnostic machinery to
//    participants."
//
// Consequences encoded below:
//   - `completion` takes NO client-supplied "complete" flag. There is no
//     parameter through which a caller could assert completeness. It is
//     computed from the stored response set, always.
//   - `resumeState` returns answers and position and NOTHING diagnostic. No
//     signals, no tags, no tensions, no evidence — a participant mid-assessment
//     receives no scoring output at all.
//   - Scoring happens exactly once, at completion, on the server.

import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serviceClient } from "../db/client";
import { validateCompleteness } from "../assessment/validation";
import { loadScoringTables, scoreAssessment } from "../assessment/scoring";
import { letterOf, numericItems, toLetterMap } from "../assessment/option-values";
import type { ScoringTables } from "../assessment/scoring";
import { loadQ18Cutoffs } from "../assessment/overrides";
import { evaluateTensions } from "../assessment/tensions";
import { selectAttentionArea } from "../assessment/interpretation";
import { classifyAll, isFearPresent } from "../assessment/classifiers";
import {
  levelsForActivation,
  resolveLevelBands,
  type ActivationLevels,
} from "../assessment/activation";
import {
  deriveEvidenceConfidence,
  deriveEvidenceStrength,
  loadConfidenceDerivation,
} from "../assessment/evidence-chain";
import {
  assembleSnapshotPayload,
  type AssembleInput,
  type SnapshotPayload,
} from "../assessment/snapshot-payload";
import { resolveSnapshotVersions, assertSupportedSchema } from "../assessment/versions";
import { assertNarrativeKeysResolvable } from "../render/narrative-key-guard";
import { mayProduceSnapshot, snapshotRefusalReason } from "./lifecycle";
import type {
  EvidenceConfidence,
  EvidenceStrength,
  SignalId,
  SignalState,
} from "../assessment/types";

/**
 * The version recorded for a session's `assessment_version` column.
 *
 * Deprecated alias kept ONLY for the two call sites that pin a session at
 * creation (`app/api/session/route.ts`, `lib/session/provisional.ts`) and for
 * the regression test that asserts the pins agree with the configs. It is no
 * longer used for the Snapshot payload, which now reads all four identifiers
 * from the artifacts themselves.
 *
 * It remains exported rather than deleted because `assessment_sessions.assessment_version`
 * is NOT NULL and references `assessment_versions.version_id`, so the column
 * still needs a value at session creation — and that value must be the config's,
 * not a literal. Deleting the constant without rewiring those two call sites
 * would break session creation.
 */
export function pinnedVersion(): string {
  const v = assessmentConfig().version;
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(
      "service: config/assessment-v1.0.json has no readable version — cannot pin a session.",
    );
  }
  return v.trim();
}

/** The assessment/question-bank config, read once. */
let cachedAssessmentConfig: unknown = null;
function assessmentConfig(): { version?: unknown } {
  if (cachedAssessmentConfig === null) {
    cachedAssessmentConfig = JSON.parse(
      readFileSync(resolve(configDir(), "assessment-v1.0.json"), "utf8"),
    );
  }
  return cachedAssessmentConfig as { version?: unknown };
}

/** The narrative library config, read once. */
let cachedNarrativeConfig: unknown = null;
function narrativeConfig(): { version?: unknown } {
  if (cachedNarrativeConfig === null) {
    cachedNarrativeConfig = JSON.parse(
      readFileSync(resolve(configDir(), "narratives-v1.0.json"), "utf8"),
    );
  }
  return cachedNarrativeConfig as { version?: unknown };
}

/** The report config's version, read from config rather than asserted. */
function reportVersion(): string {
  const cfg = JSON.parse(
    readFileSync(resolve(configDir(), "report-v1.0.json"), "utf8"),
  ) as { version?: unknown };
  return typeof cfg.version === "string" ? cfg.version : "1.0";
}

/** The interstitial (Money Moment) version — read from config, not hardcoded. */
function interstitialVersion(): string {
  const cfg = JSON.parse(
    readFileSync(resolve(configDir(), "interstitial-v1.0.json"), "utf8"),
  ) as { version?: unknown };
  return typeof cfg.version === "string" ? cfg.version : "1.0";
}

// The option-letter scale used to live here as `LETTER_VALUES`, a hardcoded
// twin of `option_value_maps` in the scoring config. It is GONE: the config is
// now the only source, read through `loadScoringTables` and applied per item in
// `numericItems` below. A second copy is how `Q12_F` came to be scored 5 when
// the config says it carries no numeric value.

function configDir(): string {
  return resolve(process.cwd(), "config");
}

let cachedScoringConfig: unknown = null;
function scoringConfig(): unknown {
  if (cachedScoringConfig === null) {
    cachedScoringConfig = JSON.parse(
      readFileSync(resolve(configDir(), "scoring-v1.0.json"), "utf8"),
    );
  }
  return cachedScoringConfig;
}

export interface StoredResponse {
  item_id: string;
  option_code: string;
}

export interface ResumeState {
  sessionId: string;
  status: string;
  currentPosition: number;
  /** item_id → option_code(s). Answers only — never diagnostics. */
  responses: Record<string, string | string[]>;
  /** True when the session has already crossed completion. */
  completed: boolean;
  /** Verified first name, ONLY when completed; null otherwise. */
  firstName: string | null;
}

/**
 * Safe participant state for resume (PRD §23.2: "never expose internal scoring
 * before completion").
 *
 * The return shape is deliberately narrow. If a field is not needed to redraw
 * the question screen, it does not belong here.
 */
export async function loadResumeState(
  sessionId: string,
): Promise<ResumeState | null> {
  const db = serviceClient();

  const { data: session, error: sErr } = await db
    .from("assessment_sessions")
    .select("session_id, status, current_position")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`session: ${sErr.message}`);
  if (!session) return null;

  const { data: rows, error: rErr } = await db
    .from("responses")
    .select("item_id, option_code")
    .eq("session_id", sessionId);
  if (rErr) throw new Error(`session: ${rErr.message}`);

  const responses: Record<string, string | string[]> = {};
  for (const row of (rows ?? []) as StoredResponse[]) {
    const existing = responses[row.item_id];
    if (existing === undefined) {
      responses[row.item_id] = row.option_code;
    } else if (Array.isArray(existing)) {
      existing.push(row.option_code);
    } else {
      responses[row.item_id] = [existing, row.option_code];
    }
  }

  // F-07 — the reveal is READ-DRIVEN. Both fields are gated on completion:
  // `completed` is trivially false before the terminal status, and `firstName`
  // is resolved through the SAME verifiedFirstName gate the identity flow uses
  // (participant_contacts.verified_at) — never a second notion of verification.
  // An in-progress participant's name therefore never leaves the server.
  const completed = session.status === "completed";
  let firstName: string | null = null;
  if (completed) {
    firstName = await verifiedFirstName(db, sessionId).catch(() => null);
  }

  return {
    sessionId: session.session_id,
    status: session.status,
    currentPosition: session.current_position,
    responses,
    completed,
    firstName,
  };
}

/** Flatten stored rows into the item→value map the engine consumes. */
export function toResponseMap(rows: StoredResponse[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    const prior = map[r.item_id];
    if (prior === undefined) map[r.item_id] = r.option_code;
    else if (Array.isArray(prior)) (prior as string[]).push(r.option_code);
    else map[r.item_id] = [prior, r.option_code];
  }
  return map;
}

/**
 * Seed the canonical Opening A response at session creation (F-06).
 *
 * Opening A is answered EXACTLY ONCE, at the front door, and that answer is the
 * canonical stored OPEN_A response for the 31. It is chosen HERE, server-side,
 * from WHICH door was used — never posted by the client:
 *   - POST /api/participant/provisional  -> "OPEN_A_A" (Yes, first-time)
 *   - POST /api/session                  -> "OPEN_A_B" (No, returning)
 *
 * The row shape matches the response route's own insert, so a reader cannot
 * tell a seeded answer from a recorded one. The seed bypasses the response
 * route's front-door lock naturally: it goes through the service at creation,
 * not through the route.
 *
 * CALLED EXACTLY ONCE PER SESSION, at creation, on a row that cannot yet hold
 * an OPEN_A answer — so a duplicate collision is impossible here and a plain
 * INSERT is the honest write. (The unique key is (session_id, item_id,
 * option_code); this is the only site that writes OPEN_A outside the response
 * route, and the route is locked for front-door items.)
 *
 * NOT FATAL, DELIBERATELY — see the callers. This throws only so the caller can
 * SEE the failure; both doors catch it and continue, because the fallback is
 * already correct: a session with no seeded OPEN_A resumes to index 0 and the
 * participant answers Opening A in-instrument, which is exactly the pre-F-06
 * behaviour. Trading "one redundant question" for "a created participant whose
 * start request 500s" is the right trade, and it keeps a transient write error
 * from stranding an anonymous participant with no way back to their record.
 */
export async function recordCanonicalOpeningA(
  sessionId: string,
  optionCode: string,
): Promise<void> {
  const db = serviceClient();
  const { error } = await db.from("responses").insert({
    session_id: sessionId,
    item_id: "OPEN_A",
    option_code: optionCode,
    open_text: null,
  });
  if (error) throw new Error(`session: canonical OPEN_A ${error.message}`);
}

export interface CompletionResult {
  sessionId: string;
  complete: boolean;
  /** Present only when complete === false. */
  missing?: string[];
  present?: number;
  required?: number;
  /**
   * The participant's first name, ONLY when their identity is verified.
   *
   * Addendum 02 v1.1 §3.2/§15: use a first name "once a first name is known and
   * verified/associated with the correct participant", and "Do not use a name
   * before it has been reliably associated with the participant."
   *
   * So this is gated on `participant_contacts.verified_at` for a verified email
   * — the same evidence the identity flow itself uses — and is `null` otherwise.
   * A participant who has not completed email verification gets no name, and the
   * reveal renders its approved sentence without the name prefix. There is no
   * separate "recognized" concept here and none is invented.
   */
  firstName?: string | null;

  /**
   * Present only when the session's LIFECYCLE forbids completion — expired, or
   * already completed. Operator decision 2026-10-01, instruction #3.
   *
   * Distinct from `missing`: that says "you have unanswered questions", this
   * says "this assessment can no longer become a current Snapshot". The two
   * need different participant-facing responses — resume versus start fresh.
   */
  refusal?: string;
}

/**
 * Complete a session. THIS IS THE SERVER-AUTHORITY GATE (PRD §23.5, §29 test 17).
 *
 * Note the signature: it takes a session id and nothing else. There is no
 * parameter for a client's claim of completeness, because such a parameter
 * would be exactly the thing the spec forbids trusting. Completion is derived
 * from persisted responses.
 *
 * Returns `{complete:false, missing:[...]}` without scoring when anything is
 * unanswered — and does NOT mark the session complete, so a subsequent call
 * after the missing items arrive still works.
 */
export async function completeSession(sessionId: string): Promise<CompletionResult> {
  const db = serviceClient();

  // THE LIFECYCLE GATE.
  //
  // Operator instruction #3: an expired incomplete assessment "becomes
  // historical and must never subsequently produce a current Financial
  // Snapshot."
  //
  // THIS CHECK DID NOT EXIST. `completeSession` read the response set and
  // proceeded without ever reading the session's status — so a session the sweep
  // had expired, whose 31 responses were still sitting in the table, would have
  // completed and written a Snapshot. The rule would have been broken silently,
  // by exactly the participant the rule exists to protect: one whose answers are
  // too old to represent their situation today.
  //
  // Checked BEFORE any scoring or writes, so an expired session costs nothing
  // and leaves no partial state.
  const { data: sessionRow, error: stateErr } = await db
    .from("assessment_sessions")
    .select("status")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (stateErr) throw new Error(`session: ${stateErr.message}`);

  // THE EARLY-OUT GATE. This read decides whether scoring is worth doing at all,
  // so a refusal costs no work and writes nothing. It is NOT the deciding check
  // any more — see the atomic boundary at the end of this function, which
  // re-reads the status under a row lock because this one can go stale while
  // scoring runs. Both exist on purpose: this one saves the work, that one
  // makes the answer binding.
  let status = "";
  if (sessionRow) {
    status = (sessionRow as { status?: string }).status ?? "";
    if (!mayProduceSnapshot(status)) {
      // A structured refusal rather than a throw: the caller surfaces the reason
      // to the participant, who needs to know whether to resume or to start a
      // current assessment. Both are actionable; neither is an error.
      return {
        sessionId,
        complete: false,
        refusal: snapshotRefusalReason(status) ?? "This assessment cannot be completed.",
        missing: [],
        present: 0,
        required: 0,
      };
    }
  }

  const { data: rows, error: rErr } = await db
    .from("responses")
    .select("item_id, option_code")
    .eq("session_id", sessionId);
  if (rErr) throw new Error(`session: ${rErr.message}`);

  const responseMap = toResponseMap((rows ?? []) as StoredResponse[]);

  // PRD §8: all 31 required items, computed from stored responses only.
  const validation = validateCompleteness(responseMap);
  if (!validation.complete) {
    return {
      sessionId,
      complete: false,
      missing: validation.missing,
      present: validation.present,
      required: validation.required,
    };
  }

  // F-08 — RESUME FIRST, THEN COMPLETE.
  //
  // The lifecycle gate above ALLOWS `abandoned` (it is inside the resumable
  // window), but the database does not: the trigger
  // `refuse_snapshot_for_terminal_session` refuses a Snapshot insert for a
  // session still marked `abandoned`, with a message that says exactly what is
  // required — "must be resumed (returned to in_progress) before it can produce
  // a Snapshot". Before that resume existed, completion read the status, passed
  // its own gate for `abandoned`, ran scoring, COMMITTED computed_signals /
  // overrides / tensions, and only then hit the trigger — which refused the
  // Snapshot and threw, returning a 500 to a participant with all 31 answers
  // while leaving scoring artifacts on a session that has no Snapshot.
  //
  // THE RESUME NOW LIVES IN THE ATOMIC BOUNDARY, NOT HERE, and that move is the
  // point of owner ruling item 3. It used to be an UPDATE issued from this
  // function — a separate round-trip, guarded by `.eq("status","abandoned")`
  // and followed by a re-read when the guard missed. That guard was correct but
  // it could only DETECT the sweep race; it could not prevent it, because the
  // scoring writes that followed were still their own transactions. Inside
  // `complete_session_atomic` the row is locked first, the status is re-read
  // under that lock, and the resume and every derived write share one
  // transaction — so the race is closed by construction rather than caught
  // afterwards, and a session that became `expired` in the window is refused
  // with nothing written.
  //
  // ORDERING IS PRESERVED EXACTLY: the resume still happens only AFTER the
  // completeness check (so an incomplete session stays `abandoned`, which is
  // correct — answering a question is what resumes it), and still BEFORE any
  // derived write.
  //
  // ---- scoring runs server-side, exactly once, at completion ----
  const cfg = scoringConfig();
  const tables = loadScoringTables(cfg);
  const cutoffs = loadQ18Cutoffs(cfg);
  const letters = toLetterMap(responseMap);
  const scored = scoreAssessment(letters, tables, cutoffs);

  // TENSION RULES READ THE S-LADDER STATE, NOT THE DISPLAY STATE.
  //
  // `displayState` is what a report RENDERS — it becomes a SpecialSignalState
  // (e.g. AIM_CAPACITY_CONSTRAINED_ALIGNMENT) when a capacity rule applies.
  // Every tension trigger matches only S1–S5, so feeding displayState here
  // means an overridden signal silently matches no rule at all. Verified: with
  // AIM carrying a special state, evaluateTensions returned [] instead of the
  // null finding — a capacity-constrained participant would have received a
  // Snapshot with no friction section.
  //
  // `state` is documented in scoring.ts as "the S-ladder position of value
  // (reference position even when overridden)", which is exactly what the
  // rules need. The special state still reaches the report via `special_state`
  // and via the attention area chosen below.
  const signalStates = Object.fromEntries(
    (Object.keys(scored.signals) as SignalId[]).map((s) => [
      s,
      scored.signals[s].state ?? "S3",
    ]),
  ) as Record<SignalId, SignalState>;

  const items = numericItems(letters, tables.values);

  /** Codes for one classifier question, always as an array. */
  const codesFor = (item: string): string[] => {
    const v = responseMap[item];
    if (Array.isArray(v)) return v as string[];
    return typeof v === "string" ? [v] : [];
  };

  const q21Codes = codesFor("Q21");
  const tags = classifyAll({
    Q1: codesFor("Q1"),
    Q9: codesFor("Q9"),
    Q16: codesFor("Q16"),
    Q21: q21Codes,
  });

  // ACTIVATION MUST COME FROM THE PARTICIPANT'S A1–A4 ANSWERS.
  //
  // Two tension rules read activation: HIGH_FEAR_HIGH_ACTIVATION
  // (`any_activation_high: [A1,A2,A3]`) and SUPPORT_OPENNESS_AGENCY_VULNERABILITY
  // (`activation_high: [A4]`). This call site previously passed a hardcoded
  // all-MID object behind an `as never` cast, which silenced the type error
  // that would have caught it. Because no participant can be simultaneously
  // all-MID and HIGH, `activation_high` never evaluated true: BOTH codes were
  // unreachable in production, and a participant who explicitly reported high
  // urgency to act alongside financial fear received a Snapshot with neither
  // the fear-aware handling note (PRD §15: "Do not increase pressure") nor the
  // support-openness finding.
  //
  // Verified by execution before the fix: identical responses returned []
  // under the hardcoded levels and
  // ["HIGH_FEAR_HIGH_ACTIVATION","SUPPORT_OPENNESS_AGENCY_VULNERABILITY"]
  // under the participant's real A1–A4 choices.
  //
  // A1–A4 are required items (validation.ts REQUIRED_ITEM_IDS), so the
  // completeness gate above guarantees all four are present here.
  // `levelsForActivation` throws on an unrecognised option rather than
  // defaulting — a malformed answer must surface, not silently re-create the
  // all-MID failure this comment documents.
  // Bands come from the config, so `activation.level_bands` is a real control
  // rather than a second copy of a hardcoded constant. Same values today —
  // A/B, C, D/E — so no participant's level moves.
  const activation: ActivationLevels = levelsForActivation(
    {
      A1: codesFor("A1")[0],
      A2: codesFor("A2")[0],
      A3: codesFor("A3")[0],
      A4: codesFor("A4")[0],
    },
    resolveLevelBands(
      (cfg as { activation?: { level_bands?: Record<string, unknown> } }).activation
        ?.level_bands,
    ),
  );

  const tensionCodes = evaluateTensions(
    {
      signalStates,
      items,
      activation,
      // classifyAll returns question → tags; the evaluator wants a flat list.
      tags: Object.values(tags).flat(),
      fearPresent: isFearPresent(q21Codes),
    },
    cfg,
  );
  const attentionArea = selectAttentionArea(tensionCodes);

  // ---- evidence confidence, DERIVED per signal (PRD §19.1) ----
  //
  // This was previously a hardcoded "high" for every signal. The tier selects
  // the strength of participant-facing language ("Your responses show…" vs
  // "suggest…" vs "One possibility worth examining is…"), so recording a
  // blanket "high" would address a thinly-evidenced participant with
  // unwarranted certainty. See evidence-chain.ts for the rule and its config.
  const derivation = loadConfidenceDerivation(cfg);

  /** Item ids feeding each signal, from the config's own formula. */
  const signalItems: Record<string, string[]> = {};
  const signalsBlock = (cfg as Record<string, unknown>)['signals'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  for (const [signal, entry] of Object.entries(signalsBlock ?? {})) {
    if (signal.startsWith('_')) continue;
    const formula = entry?.['formula'] as Record<string, unknown> | undefined;
    const questions = formula?.['questions'];
    if (Array.isArray(questions)) {
      signalItems[signal] = questions.filter(
        (q): q is string => typeof q === 'string',
      );
    }
  }

  /** Tension codes referencing each signal, parsed from the config triggers. */
  const signalTensions: Record<string, string[]> = {};
  const collectSignalRefs = (node: unknown, code: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) collectSignalRefs(child, code);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const named = obj['signal'];
      if (typeof named === 'string' && Array.isArray(obj['state_in'])) {
        (signalTensions[named] ??= []).push(code);
      }
      for (const child of Object.values(obj)) collectSignalRefs(child, code);
    }
  };
  const tensionsBlock = (cfg as Record<string, unknown>)['tensions'] as
    | Record<string, unknown>
    | undefined;
  for (const [code, entry] of Object.entries(tensionsBlock ?? {})) {
    if (code.startsWith('_')) continue;
    collectSignalRefs(entry, code);
  }

  const triggered = new Set(tensionCodes);

  // Corroboration = contributing items that actually carried a value, plus
  // triggered tensions that reference this signal. An item whose option maps
  // to null (a capacity override such as Q11_A) carries NO numeric evidence
  // and is correctly absent from `items`, so it cannot corroborate. Extracted
  // so the DB column and the payload's per-signal evidence derive from ONE
  // count — they can never disagree about the corroboration.
  const corroborationFor = (signal: SignalId): number => {
    const contributing = signalItems[signal] ?? [];
    const fromItems = contributing.filter(
      (q) => items[q] !== undefined,
    ).length;
    const fromTensions = (signalTensions[signal] ?? []).filter((c) =>
      triggered.has(c as never),
    ).length;
    return fromItems + fromTensions;
  };

  const confidenceArgsFor = (signal: SignalId) => ({
    state: scored.signals[signal].state,
    specialState: scored.signals[signal].specialState,
    corroboration: corroborationFor(signal),
  });

  const confidenceFor = (signal: SignalId): EvidenceConfidence =>
    deriveEvidenceConfidence(confidenceArgsFor(signal), derivation);

  // The payload's per-signal evidence strength (Addendum 01 v1.1 §10). Derived
  // from the SAME args as the confidence column, so the two cannot disagree.
  // Metadata only — never a score, never the signal's narrative key.
  const evidenceFor = (signal: SignalId): EvidenceStrength =>
    deriveEvidenceStrength(confidenceArgsFor(signal), derivation);

  // Persist, then freeze. The immutability trigger rejects later writes, so a
  // failure here surfaces as a database error rather than silent divergence.
  const nowIso = new Date().toISOString();

  // COLUMN NAMES ARE THE SCHEMA'S, NOT THE ENGINE'S.
  //
  // This insert previously sent `{ signal, value, special_state }` and
  // `onConflict: "session_id,signal"`. None of those exist:
  // `computed_signals` is (session_id, signal_id, raw_value, state,
  // evidence_confidence, calculation_version) with PK (session_id, signal_id)
  // — see migration 20260930000001 and PRD §22.3, which lists the same six.
  // Verified by execution against a real Postgres: the old statement failed
  // with `column "signal" of relation "computed_signals" does not exist`, so
  // EVERY completion would have failed at this line. The stubbed DB in the
  // test suite accepted any column name, which is why the suite stayed green.
  //
  // `calculation_version` is NOT NULL and carries PINNED_VERSION.
  //
  // The off-ladder states (DIRECT_CAPACITY_LIMITED, AIM_CAPACITY_CONSTRAINED_
  // ALIGNMENT) have no column here by design — §22.3 gives none. They belong to
  // the `overrides` table (override_code + payload) and to the Snapshot's
  // narrative keys, and are written in the overrides block below.
  // OWNER RULING 2026-10-03 ITEM 3 — THESE ROWS ARE BUILT, NOT WRITTEN HERE.
  //
  // They used to be a standalone upsert. That was the defect: PostgREST commits
  // each round-trip on its own, so a failure at the Snapshot insert left these
  // scoring rows committed against a session with no Snapshot — exactly the
  // "scoring artifacts on a session that cannot complete" state the ruling
  // forbids, and reachable by a sweep racing between the lifecycle read and the
  // insert. They now travel into `complete_session_atomic`, which writes all of
  // them plus the Snapshot plus the status flip in ONE transaction, so nothing
  // derived commits unless the Snapshot does.
  //
  // The COLUMN NAMES ARE UNCHANGED and still the schema's, not the engine's.
  // That distinction cost a live defect once: this code previously sent
  // `{ signal, value, special_state }` with `onConflict: "session_id,signal"`,
  // and NONE of those exist — `computed_signals` is (session_id, signal_id,
  // raw_value, state, evidence_confidence, calculation_version) per migration
  // 20260930000001 and PRD §22.3. Verified by execution against a real
  // Postgres: the old statement failed with `column "signal" of relation
  // "computed_signals" does not exist`, so EVERY completion would have failed
  // at that line. The stubbed DB accepted any column name, so the suite stayed
  // green while production could not complete at all. The SQL function now
  // re-checks every key against an allow-list and RAISES on an unknown one,
  // because `jsonb_populate_record` would silently drop it.
  //
  // `calculation_version` is NOT NULL and carries PINNED_VERSION.
  //
  // The off-ladder states (DIRECT_CAPACITY_LIMITED, AIM_CAPACITY_CONSTRAINED_
  // ALIGNMENT) have no column here by design — §22.3 gives none. They belong to
  // the `overrides` table (override_code + payload) and to the Snapshot's
  // narrative keys, and are built in the overrides block below.
  const signalRows = (Object.keys(scored.signals) as SignalId[]).map((signal) => ({
    signal_id: signal,
    raw_value: scored.signals[signal].value,
    state: scored.signals[signal].state,
    // Derived from the signal's ladder state, any capacity override, and how
    // many independent sources corroborate it. Always one of
    // 'high'|'moderate'|'limited' — the DB CHECK constraint's own values.
    evidence_confidence: confidenceFor(signal),
    calculation_version: pinnedVersion(),
  }));

  // ---- capacity overrides + modifiers (§13.4–§13.7) ----
  //
  // §22.3: `overrides` = (session_id, override_code, source_item_ids, payload).
  // The off-ladder signal states live HERE, not on computed_signals. Written
  // from the scorer's own flags so the row set reflects exactly what fired.
  const overrideRows: Array<Record<string, unknown>> = [];
  const { overrideFlags, directSpecial, q18ModifierFired } = scored;
  if (overrideFlags.Q11_CAPACITY_OVERRIDE) {
    overrideRows.push({
      override_code: "Q11_CAPACITY_OVERRIDE",
      source_item_ids: ["Q11"],
      payload: { option: codesFor("Q11")[0] ?? null },
    });
  }
  if (overrideFlags.Q12_CAPACITY_OVERRIDE) {
    overrideRows.push({
      override_code: "Q12_CAPACITY_OVERRIDE",
      source_item_ids: ["Q12"],
      payload: { option: codesFor("Q12")[0] ?? null },
    });
  }
  if (overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT) {
    overrideRows.push({
      override_code: "AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT",
      source_item_ids: ["Q11", "Q12", "Q10"],
      payload: {},
    });
  }
  if (q18ModifierFired) {
    overrideRows.push({
      override_code: "Q18_CAPACITY_MODIFIER",
      source_item_ids: ["Q18"],
      payload: { option: codesFor("Q18")[0] ?? null },
    });
  }
  // The rendered off-ladder state per signal, when one applies.
  for (const signal of Object.keys(scored.signals) as SignalId[]) {
    const special = scored.signals[signal].specialState;
    if (special) {
      overrideRows.push({
        override_code: special,
        source_item_ids: [],
        payload: { signal, display_state: special },
      });
    }
  }
  // NOT WRITTEN HERE (item 3) — these rows travel into the atomic boundary
  // with the signals and the Snapshot. `session_id` is supplied by the SQL
  // function so it cannot disagree with the row it is written against.
  const tensionRows = tensionCodes.map((code) => ({ tension_code: code }));

  // ---- assemble and PERSIST the Snapshot payload (Addendum 01 §3, §5) ----
  //
  // ORDER MATTERS: the payload is written BEFORE the session flips to
  // 'completed'. The immutability triggers fire on completion, so writing
  // afterwards would be rejected — and a completed session with no stored
  // Snapshot would be exactly the state §5 forbids, where the web page and the
  // PDF each recompute and can disagree.
  //
  // A failure here must not leave the session half-completed. That is no longer
  // a property of THIS ORDERING — it is a property of the transaction all five
  // writes now share (see the atomic boundary at the end of this function).
  // THE FOUR IDENTIFIERS, READ FROM THE ARTIFACTS THAT PRODUCED THIS SNAPSHOT.
  //
  // These replace five passes of a hardcoded `PINNED_VERSION`. That constant
  // would have kept claiming "1.0" after any config revision, which is precisely
  // the silent mislabelling PRD §22.6 exists to prevent — so `resolveSnapshotVersions`
  // THROWS rather than defaulting when an artifact declares no version.
  //
  // The two structural pins (`assessment`, `questionBank`) are the same artifact
  // version read twice, because the instrument and its question bank are
  // versioned together in `assessment-v1.0.json`. They are kept as separate keys
  // so the payload shape does not change for a reader.
  const snapshotVersions = resolveSnapshotVersions({
    assessmentConfig: assessmentConfig(),
    scoringConfig: cfg,
    narrativeConfig: narrativeConfig(),
  });

  // The assembler's signal input now requires per-signal evidence, which the
  // scorer does not produce. Build the input with evidence derived here (same
  // source as the computed_signals column), so the payload carries the strength
  // metadata without the scorer's own shape changing.
  const payloadSignals: AssembleInput["signals"] = Object.fromEntries(
    (Object.keys(scored.signals) as SignalId[]).map((signal) => [
      signal,
      {
        value: scored.signals[signal].value,
        state: scored.signals[signal].state,
        specialState: scored.signals[signal].specialState,
        displayState: scored.signals[signal].displayState,
        evidence: evidenceFor(signal),
      },
    ]),
  ) as AssembleInput["signals"];

  // ── THE NARRATIVE-KEY GUARD (hardening 2026-10-05) ────────────────────────
  //
  // `assertNarrativeKeysResolvable` wraps the assembler call, so every key this
  // payload asks the renderer to resolve is checked against the pinned
  // narrative config BEFORE the atomic boundary — and therefore before the row
  // exists. A key that does not resolve THROWS.
  //
  // WHY HERE AND NOT IN THE RESOLVER. The resolver is fail-soft by contract: it
  // OMITS an unresolvable key, which is right for a HISTORICAL Snapshot (an
  // immutable row must keep rendering after a config revision retires a key)
  // and wrong for a NEW one. A new payload with a stale key would be persisted
  // permanently — `snapshots` refuses every UPDATE (trg_snapshots_append_only) —
  // and would render as a shorter, still-plausible report with nothing anywhere
  // to say content was lost. Failing here costs a 500 in development and
  // staging; failing to fail costs a silently incomplete participant report
  // that cannot be corrected.
  //
  // ITS SCOPE IS THE KEY SPACE ONLY. It reads the finished payload and the
  // narrative config and nothing else — no scoring, tension, classifier, or
  // ordering code — so it cannot recompute, re-select, or disagree with how the
  // payload was produced. A payload that fails here is one whose content is
  // correct and whose keys are stale.
  const payload = assertNarrativeKeysResolvable(
    assembleSnapshotPayload({
      versions: {
        assessment: snapshotVersions.instrumentVersion,
        questionBank: snapshotVersions.instrumentVersion,
        scoring: snapshotVersions.scoringEngineVersion,
        narrative: snapshotVersions.narrativeLibraryVersion,
        report: reportVersion(),
        // §3.1: read from the interstitial config, so a Money Moment or reveal
        // revision moves this pin with it rather than needing a code edit.
        interstitial: interstitialVersion(),
        // The four identifiers the operator required, recorded explicitly so a
        // reader can find them without knowing which legacy key maps to which.
        instrument: snapshotVersions.instrumentVersion,
        scoringEngine: snapshotVersions.scoringEngineVersion,
        narrativeLibrary: snapshotVersions.narrativeLibraryVersion,
        snapshotSchema: snapshotVersions.snapshotSchemaVersion,
      },
      signals: payloadSignals,
      tensionCodes,
      classifierTags: Object.values(tags).flat(),
      activationSelections: {
        A1: letterOf(codesFor("A1")[0] ?? ""),
        A2: letterOf(codesFor("A2")[0] ?? ""),
        A3: letterOf(codesFor("A3")[0] ?? ""),
        A4: letterOf(codesFor("A4")[0] ?? ""),
      },
      openingB: items["OPEN_B"] ?? null,
      q16Selections: codesFor("Q16"),
      signalMeans: Object.fromEntries(
        (Object.keys(scored.signals) as SignalId[]).map((s) => [
          s,
          scored.signals[s].value ?? 0,
        ]),
      ),
      perceptionGapConfig: (cfg as Record<string, unknown>)["perception_gap"],
      // Same config, same pass-through as the perception-gap block above: the
      // assembler resolves activation levels from the config's bands rather than
      // from a hardcoded copy.
      activationLevelBands: (cfg as { activation?: { level_bands?: Record<string, unknown> } })
        .activation?.level_bands,
      moveSubsignals: scored.moveSubsignals as unknown as Record<string, number | null>,
    }),
  );

  const snapshotRow = {
    report_version: reportVersion(),
    // Both columns carry the SAME object: `payload_json` is the current name
    // (Addendum §15) and `rendered_payload_json` is retained for readers that
    // predate the migration. Writing one and not the other would make the two
    // names disagree, which is the drift this whole layer exists to prevent.
    // The SQL function enforces this equality rather than trusting the caller.
    payload_json: payload,
    rendered_payload_json: payload,
    // READ FROM THE ARTIFACTS, not from a constant — the same values the
    // payload carries above, written as columns so they are queryable without
    // JSONB. These are immutable once written (trg_snapshots_append_only refuses
    // every UPDATE), which is what makes a historical Snapshot traceable to the
    // system that produced it rather than to whatever is current.
    assessment_version: snapshotVersions.instrumentVersion,
    question_bank_version: snapshotVersions.instrumentVersion,
    scoring_config_version: snapshotVersions.scoringEngineVersion,
    narrative_version: snapshotVersions.narrativeLibraryVersion,
    // §3.1: the sixth pin. Same value the payload carries under
    // versions.interstitial, written here so it is queryable without JSONB.
    interstitial_version: interstitialVersion(),
    // THE FOUR OPERATOR-REQUIRED IDENTIFIERS, as their own columns. Mirrors the
    // payload's versions.instrument / .scoringEngine / .narrativeLibrary /
    // .snapshotSchema, so a query can find them without reaching into JSONB.
    instrument_version: snapshotVersions.instrumentVersion,
    scoring_engine_version: snapshotVersions.scoringEngineVersion,
    narrative_library_version: snapshotVersions.narrativeLibraryVersion,
    snapshot_schema_version: snapshotVersions.snapshotSchemaVersion,
  };

  // ==========================================================================
  // THE ATOMIC BOUNDARY — owner ruling 2026-10-03, item 3.
  //
  // "A session that is not eligible to complete must not leave scoring,
  //  interpretation, Snapshot, or other derived rows behind ... use an
  //  atomic/transactional boundary so a refusal or failure rolls back the
  //  derived writes."
  //
  // Everything above this line only COMPUTES. Every write that changes state —
  // the six computed_signals rows, the overrides, the tensions, the Snapshot,
  // and the status flip — happens inside this one call, in one Postgres
  // transaction. Exactly three outcomes are possible:
  //
  //   1. it commits          — all five writes, or
  //   2. it REFUSES          — {"ok":false}; nothing was written, because the
  //                            function returns before its first INSERT
  //   3. it RAISES           — a trigger, the unique index, a transient error;
  //                            the transaction aborts and everything rolls back
  //
  // There is no fourth outcome, and in particular there is no state where
  // derived rows exist on a session that has no Snapshot. That was the defect:
  // four independent PostgREST round-trips meant a failure at the Snapshot
  // insert rolled back NOTHING, leaving scoring rows committed against a
  // session that could not complete — the exact state the ruling forbids.
  // Proved by execution against a real Postgres before this was wired: with the
  // Snapshot insert forced to raise on the unique index, the old path left
  // computed_signals=1 committed, and the boundary leaves computed_signals=0.
  //
  // WHY THE SESSION IS RE-READ *INSIDE* THE FUNCTION. The eligibility checks
  // above ran against a status read before scoring. A sweep can expire the
  // session in that window, which is precisely how an expired session could
  // have produced a Snapshot. The function takes a row lock (FOR UPDATE) and
  // re-reads the status under it, so the decision is made against the committed
  // truth and no sweep can change the row until the transaction ends. That
  // closes the race by construction rather than by re-checking after the fact.
  // ==========================================================================
  const { data: outcome, error: rpcErr } = await db.rpc("complete_session_atomic", {
    p_session_id: sessionId,
    p_now: nowIso,
    p_signals: signalRows,
    p_overrides: overrideRows,
    p_tensions: tensionRows,
    p_snapshot: snapshotRow,
  });
  if (rpcErr) throw new Error(`session: complete ${rpcErr.message}`);

  // A REFUSAL IS DATA, NOT AN EXCEPTION. The function reports which lifecycle
  // state refused; the WORDING comes from lib/session/lifecycle.ts, which is
  // the single source of the may/may-not rule and of its message. Rebuilding
  // that sentence in SQL would recreate the two-hand-maintained-copies defect
  // this codebase already removed from LETTER_VALUES.
  const result = (outcome ?? {}) as { ok?: boolean; state?: string };
  if (result.ok !== true) {
    const state = result.state ?? "";
    return {
      sessionId,
      complete: false,
      refusal:
        snapshotRefusalReason(state) ?? "This assessment cannot be completed.",
      missing: [],
      present: 0,
      required: 0,
    };
  }

  // Resolved AFTER completion succeeds, and never fatal: a missing name is a
  // cosmetic loss on the reveal, while throwing here would fail a completed
  // assessment over a greeting. Addendum 02 §3.2 gates the name on verified
  // association, so an unverified participant gets null by design.
  const firstName = await verifiedFirstName(db, sessionId).catch(() => null);

  return { sessionId, complete: true, firstName };
}

/**
 * The participant's first name, but ONLY when their identity is verified.
 *
 * Addendum 02 v1.1 §3.2: use a first name "once a first name is known and
 * verified/associated with the correct participant"; §15: "Do not use a name
 * before it has been reliably associated with the participant."
 *
 * "Reliably associated" is read from the data model the identity flow already
 * maintains: a `participant_contacts` row of type email with a non-null
 * `verified_at`. That is the same evidence the verification callback itself
 * writes, so this introduces no second notion of verification.
 *
 * Deliberately narrow: the name is NOT returned for an unverified participant
 * even though `participants.first_name` is populated at entry. Entry is not
 * verification, and §15 forbids the greeting until verification exists.
 */
async function verifiedFirstName(
  db: ReturnType<typeof serviceClient>,
  sessionId: string,
): Promise<string | null> {
  const { data: session } = await db
    .from("assessment_sessions")
    .select("participant_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  const participantId = (session as { participant_id?: string } | null)?.participant_id;
  if (!participantId) return null;
  return verifiedFirstNameForParticipant(db, participantId);
}

/**
 * The same gate, keyed by participant instead of session.
 *
 * The returning flow arrives at /auth/verified holding a participant id and a
 * just-consumed verification token — it has no session yet, which is precisely
 * what it is about to look up. So the §4.1 greeting cannot go through the
 * session-shaped helper above.
 *
 * This exists because of a real defect: the greeting rendered
 * "Welcome back, there." for EVERY returning participant, because the page's
 * `firstName` state was initialized to "" and never populated, so a
 * `firstName || "there"` fallback always won. Addendum 02 §4.1 says "the
 * first-name welcome is required" — and the code was not merely missing the
 * name, it was substituting a placeholder that reads as a name.
 *
 * Extracted rather than duplicated so there is ONE definition of "verified",
 * matching the session-shaped call. If the evidence for verification changes,
 * both callers move together.
 */
export async function verifiedFirstNameForParticipant(
  db: ReturnType<typeof serviceClient>,
  participantId: string,
): Promise<string | null> {
  const { data: contact } = await db
    .from("participant_contacts")
    .select("verified_at")
    .eq("participant_id", participantId)
    .eq("contact_type", "email")
    .not("verified_at", "is", null)
    .maybeSingle();
  if (!contact) return null;

  const { data: participant } = await db
    .from("participants")
    .select("first_name")
    .eq("participant_id", participantId)
    .maybeSingle();
  const name = (participant as { first_name?: string } | null)?.first_name?.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * A completed session's frozen Snapshot, read once and typed.
 *
 * The shared read path for BOTH renderers. It reads the persisted payload —
 * never recomputes (Addendum 01 §3, §5) — and refuses to interpret a payload
 * whose schema this build does not understand. Returns null unless the session
 * is COMPLETED.
 */
async function readCompletedSnapshot(
  sessionId: string,
): Promise<{
  snapshotId: string;
  reportVersion: string | null;
  generatedAt: string | null;
  payload: SnapshotPayload;
} | null> {
  const db = serviceClient();

  const { data: session, error: sErr } = await db
    .from("assessment_sessions")
    .select("session_id, status")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`session: ${sErr.message}`);
  if (!session || session.status !== "completed") return null;

  // READ THE PERSISTED PAYLOAD — do not recompute (Addendum 01 §3, §5).
  //
  // This method used to re-derive the whole Snapshot from computed_signals,
  // overrides and tensions on every read. §5 forbids that: the web results and
  // the PDF "must use the same completed, immutable snapshot_payload", and a
  // payload rebuilt on each read can drift from the one a PDF was generated
  // against — a config recalibration between two visits would silently change
  // what a participant's own report says.
  //
  // `payload_json` is the current column; `rendered_payload_json` is read as a
  // fallback for any row written before the migration added the former.
  const { data: snapshot, error: nErr } = await db
    .from("snapshots")
    .select("snapshot_id, payload_json, rendered_payload_json, report_version, generated_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (nErr) throw new Error(`session: ${nErr.message}`);

  // A completed session with no stored Snapshot means completion was
  // interrupted between the payload write and the status flip — should be
  // unreachable given the write order, but reported rather than papered over
  // with a live recompute, which is exactly the behaviour §5 prohibits.
  if (!snapshot) {
    throw new Error(
      `session: completed session ${sessionId} has no stored Snapshot payload`,
    );
  }

  const rawPayload = snapshot.payload_json ?? snapshot.rendered_payload_json;

  // REFUSE TO INTERPRET A PAYLOAD WHOSE SHAPE THIS BUILD DOES NOT UNDERSTAND.
  //
  // This is what makes "existing immutable Snapshots must not be silently
  // reinterpreted" true rather than aspirational. Without it, versioning the
  // payload is decoration: the reader would still apply current-shape parsing to
  // an old-shape object and produce confidently wrong results. Throwing is the
  // only honest response — a Snapshot that cannot be read correctly must not be
  // read approximately.
  //
  // A payload written before the schema marker existed reads as 1.0, which is a
  // statement of historical fact rather than a convenience default: no other
  // assembler has ever existed.
  assertSupportedSchema(rawPayload, snapshot.snapshot_id as string | undefined);

  const payload = rawPayload as SnapshotPayload | null;

  if (!payload) {
    throw new Error(
      `session: Snapshot ${snapshot.snapshot_id} has a null payload`,
    );
  }

  return {
    snapshotId: snapshot.snapshot_id as string,
    reportVersion: snapshot.report_version as string | null,
    generatedAt: snapshot.generated_at as string | null,
    payload,
  };
}

/**
 * The participant-facing Snapshot.
 *
 * Returns null unless the session is COMPLETED — a mid-assessment participant
 * receives nothing (PRD §23.2, §24). The shape carries approved narrative keys
 * and the selected attention area; it never carries classifier tags,
 * evidence-chain payloads, or raw scores.
 *
 * PRD §24: this is the ONLY Snapshot shape a browser-facing route may
 * serialize. The raw payload is deliberately ABSENT here — it is served solely
 * through `loadSnapshotPayload`, which is server-only. A field added to the
 * payload therefore cannot reach a participant through this function; surfacing
 * a new field here requires an explicit decision in this return object.
 */
export async function loadSnapshot(sessionId: string) {
  const stored = await readCompletedSnapshot(sessionId);
  if (!stored) return null;

  const { snapshotId, reportVersion, generatedAt, payload } = stored;

  const signals = payload.signals;
  const connectionCodes = payload.connections.map((c) => c.code);

  return {
    snapshotId,
    reportVersion,
    generatedAt,

    // The renderable view of each signal, straight from the stored payload.
    signals: signals.map((s) => ({
      signal: s.signal,
      state: s.displayState ?? s.state,
      narrativeKey: s.narrativeKey,
    })),

    // Kept under both names for the existing web renderer; they are the same
    // list by construction (§24 keeps the codes, which are also the library
    // keys, away from the participant-facing copy).
    tensionCodes: connectionCodes,
    connectionKeys: connectionCodes,

    attentionArea: payload.attentionAreas[0] ?? "KEEP_OBSERVING",
    attentionAreas: payload.attentionAreas,
  };
}

/**
 * The FULL, immutable Snapshot payload — for SERVER-SIDE renderers only.
 *
 * The PDF renderer (module 12) and any richer server module need the whole
 * payload: signals with their internal states (state/specialState/displayState),
 * evidence-strength metadata, connection codes under their internal names, the
 * big picture, context, activation, the perception gap. This is the accessor
 * for them.
 *
 * SERVER-ONLY BY CONSTRUCTION: this module imports "server-only", so this
 * function cannot be bundled into a client. It MUST NEVER be the return value
 * of a route that serializes to a browser — that is exactly the §24 exposure
 * this split exists to prevent. Participant-facing code calls `loadSnapshot`.
 */
export async function loadSnapshotPayload(
  sessionId: string,
): Promise<SnapshotPayload | null> {
  const stored = await readCompletedSnapshot(sessionId);
  return stored ? stored.payload : null;
}

/**
 * A completed session's Snapshot payload PLUS the non-interpretive metadata the
 * PDF renderer needs (Addendum 01 §8, §14 step 6).
 *
 * The PDF is generated from the SAME read path as the web page — `readCompletedSnapshot`
 * — so the web and PDF renderers can never disagree about which payload is
 * current. `snapshotId` keys the `snapshot_documents` row (and binds the signed
 * download token's `doc` claim); `reportVersion` and `generatedAt` are the §8
 * footer metadata, delivered through the separate `SnapshotPdfMeta` channel
 * rather than the resolver's payload->copy contract.
 *
 * SERVER-ONLY BY CONSTRUCTION (this module imports "server-only").
 */
export async function loadSnapshotForDownload(
  sessionId: string,
): Promise<{
  snapshotId: string;
  reportVersion: string | null;
  generatedAt: string | null;
  payload: SnapshotPayload;
} | null> {
  return readCompletedSnapshot(sessionId);
}

// REMOVED: `attentionAreaFor(sessionId)` used to recompute the attention area from
// the live `tensions` table at read time. That is the exact re-derivation that
// Addendum 01 §5 forbids: the attention area must come from the frozen
// `snapshot_payload` (see the `attentionArea`/`attentionAreas` fields above), never
// from live tensions. Do not re-add a read-time recompute path here.
