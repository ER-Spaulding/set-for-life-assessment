// PRD §23.5, §27 — run synthetic profiles. PROTECTED INTERNAL ROUTE.
//
// PRD §23.5: "runs synthetic profiles; protected internal route."
//
// PROTECTION MODEL. This route is gated by a bearer token read from the
// server environment (`INTERNAL_HARNESS_TOKEN`). It is:
//   - NOT reachable without the token — 404 when unset, 401 when mismatched;
//   - never linked from participant-facing UI;
//   - excluded from any client bundle (no NEXT_PUBLIC_ prefix on the token).
//
// A 404 rather than a 403 when the token is unconfigured: an unconfigured
// environment should not advertise that an internal harness exists at all.
//
// The harness is deterministic and side-effect-free — it scores profiles
// in-memory and returns the outcome. It does NOT create sessions, does not
// write responses, and does not touch participant data.

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { errorBody } from "@/lib/db/client";
import { loadScoringTables, scoreAssessment } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { selectAttentionArea } from "@/lib/assessment/interpretation";
import { validateCompleteness } from "@/lib/assessment/validation";
import { levelsForActivation } from "@/lib/assessment/activation";
import { classifyAll, isFearPresent } from "@/lib/assessment/classifiers";
import type { SignalId, SignalState } from "@/lib/assessment/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_HARNESS_TOKEN;

  // Unconfigured: behave as though the route does not exist.
  if (!expected) {
    return NextResponse.json(errorBody("NOT_FOUND", "Not found."), { status: 404 });
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied || supplied !== expected) {
    return NextResponse.json(errorBody("UNAUTHORIZED", "Unauthorized."), { status: 401 });
  }

  let profile: Record<string, string> = {};
  try {
    const body = (await request.json()) as { responses?: unknown };
    if (body.responses && typeof body.responses === "object") {
      profile = body.responses as Record<string, string>;
    }
  } catch {
    return NextResponse.json(errorBody("INVALID_BODY", "Malformed request body."), {
      status: 400,
    });
  }

  const configPath = (f: string) => resolve(process.cwd(), "config", f);
  const scoringCfg = JSON.parse(readFileSync(configPath("scoring-v1.0.json"), "utf8"));

  const validation = validateCompleteness(profile);
  const tables = loadScoringTables(scoringCfg);
  const scored = scoreAssessment(profile, tables, loadQ18Cutoffs(scoringCfg));

  // THE LADDER STATE, NOT THE DISPLAY STATE — same rule as the completion
  // path (lib/session/service.ts). `displayState` becomes a SpecialSignalState
  // when a capacity override applies, and every tension trigger matches S1–S5
  // only, so feeding displayState here makes an overridden signal match no
  // rule at all. This harness exists to show what production computes; if it
  // diverged, calibration would be done against numbers no participant ever
  // produces.
  const signalStates = Object.fromEntries(
    Object.entries(scored.signals).map(([k, v]) => [k, v.state ?? "S3"]),
  ) as Record<SignalId, SignalState>;

  const LETTERS: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 5 };
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(profile)) {
    const letter = v.includes("_") ? v.slice(v.lastIndexOf("_") + 1) : v;
    const n = LETTERS[letter];
    if (n !== undefined) items[k] = n;
  }

  const codesFor = (item: string): string[] => {
    const v = profile[item];
    if (Array.isArray(v)) return v;
    return typeof v === "string" ? [v] : [];
  };

  // Classifier tags feed tag_present / tag_absent / any_tag_present clauses.
  // The harness previously passed [] here, so every tag-driven tension read
  // as "tag absent" regardless of the profile supplied.
  const q21Codes = codesFor("Q21");
  const tags = classifyAll({
    Q1: codesFor("Q1"),
    Q9: codesFor("Q9"),
    Q16: codesFor("Q16"),
    Q21: q21Codes,
  });

  // Activation from the profile's own A1–A4 answers, never a hardcoded
  // all-MID object — see lib/session/service.ts for the full note on why an
  // all-MID literal makes HIGH_FEAR_HIGH_ACTIVATION and
  // SUPPORT_OPENNESS_AGENCY_VULNERABILITY unreachable.
  const activation = levelsForActivation({
    A1: codesFor("A1")[0],
    A2: codesFor("A2")[0],
    A3: codesFor("A3")[0],
    A4: codesFor("A4")[0],
  });

  const tensions = evaluateTensions(
    {
      signalStates,
      items,
      activation,
      tags: Object.values(tags).flat(),
      fearPresent: isFearPresent(q21Codes),
    },
    scoringCfg,
  );

  return NextResponse.json({
    validation,
    signals: Object.fromEntries(
      Object.entries(scored.signals).map(([k, v]) => [
        k,
        { value: v.value, state: v.state, displayState: v.displayState },
      ]),
    ),
    moveSubsignals: scored.moveSubsignals,
    overrideFlags: scored.overrideFlags,
    directSpecial: scored.directSpecial,
    q18ModifierFired: scored.q18ModifierFired,
    tensions,
    attentionArea: selectAttentionArea(tensions),
  });
}
