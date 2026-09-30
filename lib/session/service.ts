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
import type { SignalId, SignalState } from "../assessment/types";

/** The pinned asset versions a session records at creation (PRD §22.6). */
export const PINNED_VERSION = "1.0";

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

  const signalStates = Object.fromEntries(
    (Object.keys(scored.signals) as SignalId[]).map((s) => [
      s,
      (scored.signals[s].displayState ?? "S3") as SignalState,
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
  const tensionCodes = evaluateTensions(
    {
      signalStates,
      items,
      activation: {
        A1: "MID",
        A2: "MID",
        A3: "MID",
        A4: "MID",
      } as never,
      // classifyAll returns question → tags; the evaluator wants a flat list.
      tags: Object.values(tags).flat(),
      fearPresent: isFearPresent(q21Codes),
    } as never,
    cfg,
  );
  const attentionArea = selectAttentionArea(tensionCodes);

  // Persist, then freeze. The immutability trigger rejects later writes, so a
  // failure here surfaces as a database error rather than silent divergence.
  const nowIso = new Date().toISOString();

  const { error: sigErr } = await db.from("computed_signals").upsert(
    (Object.keys(scored.signals) as SignalId[]).map((signal) => ({
      session_id: sessionId,
      signal,
      value: scored.signals[signal].value,
      state: scored.signals[signal].state,
      special_state: scored.signals[signal].specialState,
      evidence_confidence: "high",
    })),
    { onConflict: "session_id,signal" },
  );
  if (sigErr) throw new Error(`session: signals ${sigErr.message}`);

  if (tensionCodes.length > 0) {
    const { error: tErr } = await db
      .from("tensions")
      .upsert(
        tensionCodes.map((code) => ({ session_id: sessionId, tension_code: code })),
        { onConflict: "session_id,tension_code" },
      );
    if (tErr) throw new Error(`session: tensions ${tErr.message}`);
  }

  const { error: upErr } = await db
    .from("assessment_sessions")
    .update({ status: "completed", completed_at: nowIso })
    .eq("session_id", sessionId);
  if (upErr) throw new Error(`session: complete ${upErr.message}`);

  return { sessionId, complete: true };
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

  const { data: signals, error: gErr } = await db
    .from("computed_signals")
    .select("signal, value, state, special_state")
    .eq("session_id", sessionId);
  if (gErr) throw new Error(`session: ${gErr.message}`);

  const { data: tensions, error: tErr } = await db
    .from("tensions")
    .select("tension_code")
    .eq("session_id", sessionId);
  if (tErr) throw new Error(`session: ${tErr.message}`);

  const codes = (tensions ?? []).map((t: { tension_code: string }) => t.tension_code);

  return {
    sessionId,
    signals: (signals ?? []).map(
      (s: { signal: string; state: string | null; special_state: string | null }) => ({
        signal: s.signal,
        // The renderable state: the special state when one applies.
        state: s.special_state ?? s.state,
        narrativeKey: s.special_state
          ? `special_signal_states.${s.special_state}`
          : `signal_states.${s.signal}.${s.state}`,
      }),
    ),
    tensionCodes: codes,
    connectionKeys: codes,
    attentionArea: selectAttentionArea(codes as never),
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
