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
import { loadQ18Cutoffs } from "../assessment/overrides";
import { evaluateTensions } from "../assessment/tensions";
import { selectAttentionArea } from "../assessment/interpretation";
import { classifyAll, isFearPresent } from "../assessment/classifiers";
import {
  levelsForActivation,
  type ActivationLevels,
} from "../assessment/activation";
import {
  deriveEvidenceConfidence,
  loadConfidenceDerivation,
} from "../assessment/evidence-chain";
import { assembleSnapshotPayload } from "../assessment/snapshot-payload";
import type {
  EvidenceConfidence,
  SignalId,
  SignalState,
} from "../assessment/types";

/**
 * The pinned asset versions a session records at creation (PRD §22.6).
 *
 * KNOWN LIMITATION, RECORDED RATHER THAN HIDDEN: this is a hardcoded literal,
 * and `config/narratives-v1.0.json` has no `version` field to read. So a
 * scenario's `narrative_version` is asserted from a constant, not from the
 * config that produced the copy — and it would keep claiming "1.0" after a
 * narrative revision. See docs/DECISIONS-REQUIRED.md §D-7. Changing what a
 * version MEANS (real config fields vs a content hash) is an operator decision;
 * until then the interstitial pin below reads its own config, which does carry
 * a version, so that one cannot drift.
 */
export const PINNED_VERSION = "1.0";

/** The interstitial (Money Moment) version — read from config, not hardcoded. */
function interstitialVersion(): string {
  const cfg = JSON.parse(
    readFileSync(resolve(configDir(), "interstitial-v1.0.json"), "utf8"),
  ) as { version?: unknown };
  return typeof cfg.version === "string" ? cfg.version : PINNED_VERSION;
}

/** Option letters map low→high for the 1–5 profile items (PRD §9). */
const LETTER_VALUES: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };

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

  return {
    sessionId: session.session_id,
    status: session.status,
    currentPosition: session.current_position,
    responses,
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
 * Reduce a response map to the single option letter the scorer needs per item.
 * Multi-select items contribute their FIRST selection in stored order; the
 * scoring config decides which items actually carry a numeric value, so items
 * that are classifier-only (Q1, Q9, Q16, Q21) are ignored by the formulas
 * regardless of what this returns.
 */
function toLetterMap(responses: Record<string, unknown>): Record<string, string> {
  const letters: Record<string, string> = {};
  for (const [item, value] of Object.entries(responses)) {
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string") letters[item] = letterOf(first);
    } else if (typeof value === "string") {
      letters[item] = letterOf(value);
    }
  }
  return letters;
}

/** Extract the trailing option letter from a code like "Q11_A". */
function letterOf(code: string): string {
  const idx = code.lastIndexOf("_");
  return idx === -1 ? code : code.slice(idx + 1);
}

function numericItems(letters: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, letter] of Object.entries(letters)) {
    const n = LETTER_VALUES[letter];
    if (n !== undefined) out[item] = n;
  }
  return out;
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

  const items = numericItems(letters);

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
  const activation: ActivationLevels = levelsForActivation({
    A1: codesFor("A1")[0],
    A2: codesFor("A2")[0],
    A3: codesFor("A3")[0],
    A4: codesFor("A4")[0],
  });

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
  const confidenceFor = (signal: SignalId): EvidenceConfidence => {
    const contributing = signalItems[signal] ?? [];
    // Corroboration = contributing items that actually carried a value, plus
    // triggered tensions that reference this signal. An item whose option maps
    // to null (a capacity override such as Q11_A) carries NO numeric evidence
    // and is correctly absent from `items`, so it cannot corroborate.
    const fromItems = contributing.filter(
      (q) => items[q] !== undefined,
    ).length;
    const fromTensions = (signalTensions[signal] ?? []).filter((c) =>
      triggered.has(c as never),
    ).length;
    return deriveEvidenceConfidence(
      {
        state: scored.signals[signal].state,
        specialState: scored.signals[signal].specialState,
        corroboration: fromItems + fromTensions,
      },
      derivation,
    );
  };

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
  const { error: sigErr } = await db.from("computed_signals").upsert(
    (Object.keys(scored.signals) as SignalId[]).map((signal) => ({
      session_id: sessionId,
      signal_id: signal,
      raw_value: scored.signals[signal].value,
      state: scored.signals[signal].state,
      // Derived from the signal's ladder state, any capacity override, and how
      // many independent sources corroborate it. Always one of
      // 'high'|'moderate'|'limited' — the DB CHECK constraint's own values.
      evidence_confidence: confidenceFor(signal),
      calculation_version: PINNED_VERSION,
    })),
    { onConflict: "session_id,signal_id" },
  );
  if (sigErr) throw new Error(`session: signals ${sigErr.message}`);

  // ---- capacity overrides + modifiers (§13.4–§13.7) ----
  //
  // §22.3: `overrides` = (session_id, override_code, source_item_ids, payload).
  // The off-ladder signal states live HERE, not on computed_signals. Written
  // from the scorer's own flags so the row set reflects exactly what fired.
  const overrideRows: Array<Record<string, unknown>> = [];
  const { overrideFlags, directSpecial, q18ModifierFired } = scored;
  if (overrideFlags.Q11_CAPACITY_OVERRIDE) {
    overrideRows.push({
      session_id: sessionId,
      override_code: "Q11_CAPACITY_OVERRIDE",
      source_item_ids: ["Q11"],
      payload: { option: codesFor("Q11")[0] ?? null },
    });
  }
  if (overrideFlags.Q12_CAPACITY_OVERRIDE) {
    overrideRows.push({
      session_id: sessionId,
      override_code: "Q12_CAPACITY_OVERRIDE",
      source_item_ids: ["Q12"],
      payload: { option: codesFor("Q12")[0] ?? null },
    });
  }
  if (overrideFlags.AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT) {
    overrideRows.push({
      session_id: sessionId,
      override_code: "AGENCY_EVIDENCE_LIMITED_DUE_TO_CAPACITY_CONTEXT",
      source_item_ids: ["Q11", "Q12", "Q10"],
      payload: {},
    });
  }
  if (q18ModifierFired) {
    overrideRows.push({
      session_id: sessionId,
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
        session_id: sessionId,
        override_code: special,
        source_item_ids: [],
        payload: { signal, display_state: special },
      });
    }
  }
  if (overrideRows.length > 0) {
    const { error: oErr } = await db
      .from("overrides")
      .upsert(overrideRows, { onConflict: "session_id,override_code" });
    if (oErr) throw new Error(`session: overrides ${oErr.message}`);
  }

  if (tensionCodes.length > 0) {
    const { error: tErr } = await db
      .from("tensions")
      .upsert(
        tensionCodes.map((code) => ({ session_id: sessionId, tension_code: code })),
        { onConflict: "session_id,tension_code" },
      );
    if (tErr) throw new Error(`session: tensions ${tErr.message}`);
  }

  // ---- assemble and PERSIST the Snapshot payload (Addendum 01 §3, §5) ----
  //
  // ORDER MATTERS: the payload is written BEFORE the session flips to
  // 'completed'. The immutability triggers fire on completion, so writing
  // afterwards would be rejected — and a completed session with no stored
  // Snapshot would be exactly the state §5 forbids, where the web page and the
  // PDF each recompute and can disagree.
  //
  // A failure here must not leave the session half-completed, so the payload
  // write happens first and the status update only follows on success.
  const payload = assembleSnapshotPayload({
    versions: {
      assessment: PINNED_VERSION,
      questionBank: PINNED_VERSION,
      scoring: PINNED_VERSION,
      narrative: PINNED_VERSION,
      report: PINNED_VERSION,
      // §3.1: read from the interstitial config, so a Money Moment or reveal
      // revision moves this pin with it rather than needing a code edit.
      interstitial: interstitialVersion(),
    },
    signals: scored.signals,
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
    moveSubsignals: scored.moveSubsignals as unknown as Record<string, number | null>,
  });

  const { error: snapErr } = await db.from("snapshots").insert({
    session_id: sessionId,
    report_version: PINNED_VERSION,
    // Both columns carry the SAME object: `payload_json` is the current name
    // (Addendum §15) and `rendered_payload_json` is retained for readers that
    // predate the migration. Writing one and not the other would make the two
    // names disagree, which is the drift this whole layer exists to prevent.
    payload_json: payload,
    rendered_payload_json: payload,
    assessment_version: PINNED_VERSION,
    question_bank_version: PINNED_VERSION,
    scoring_config_version: PINNED_VERSION,
    narrative_version: PINNED_VERSION,
    // §3.1: the sixth pin. Same value the payload carries under
    // versions.interstitial, written here so it is queryable without JSONB.
    interstitial_version: interstitialVersion(),
  });
  if (snapErr) throw new Error(`session: snapshot ${snapErr.message}`);

  const { error: upErr } = await db
    .from("assessment_sessions")
    .update({ status: "completed", completed_at: nowIso })
    .eq("session_id", sessionId);
  if (upErr) throw new Error(`session: complete ${upErr.message}`);

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
 * The participant-facing Snapshot.
 *
 * Returns null unless the session is COMPLETED — a mid-assessment participant
 * receives nothing (PRD §23.2, §24). The shape carries approved narrative keys
 * and the selected attention area; it never carries classifier tags,
 * evidence-chain payloads, or raw scores.
 */
export async function loadSnapshot(sessionId: string) {
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

  const payload = (snapshot.payload_json ?? snapshot.rendered_payload_json) as {
    signals?: Array<{
      signal: string;
      state: string | null;
      specialState: string | null;
      displayState: string | null;
      narrativeKey: string | null;
    }>;
    connections?: Array<{ code: string; narrativeKey: string }>;
    attentionAreas?: string[];
    nullFinding?: boolean;
  } | null;

  if (!payload) {
    throw new Error(
      `session: Snapshot ${snapshot.snapshot_id} has a null payload`,
    );
  }

  const signals = payload.signals ?? [];
  const connectionCodes = (payload.connections ?? []).map((c) => c.code);

  return {
    snapshotId: snapshot.snapshot_id,
    reportVersion: snapshot.report_version,
    generatedAt: snapshot.generated_at,

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

    attentionArea: payload.attentionAreas?.[0] ?? "KEEP_OBSERVING",
    attentionAreas: payload.attentionAreas ?? [],

    // The full payload is available for the PDF renderer and the richer web
    // modules; the flat fields above remain for the current consumer.
    payload,
  };
}

/** The attention area selected at completion, recomputed from stored tensions. */
export async function attentionAreaFor(sessionId: string): Promise<string> {
  const db = serviceClient();
  const { data } = await db
    .from("tensions")
    .select("tension_code")
    .eq("session_id", sessionId);
  const codes = (data ?? []).map((t: { tension_code: string }) => t.tension_code);
  return selectAttentionArea(codes as never);
}
