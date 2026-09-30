// PRD §6, §9, §14, §23.2 — upsert one response.
//
// PRD §23.2: "upserts one response, validates item rules, updates
// last_activity_at and current_position."
//
// "Validates item rules" is the load-bearing clause: selection limits and the
// Q9_L / Q21_G exclusivity rules (§14) are enforced HERE, server-side. A client
// cannot persist a selection set the instrument does not permit, however it
// posts it.
//
// The route also refuses to write to a completed session. The database trigger
// would reject it anyway (§22.5), but failing early gives the participant a
// clear error instead of a constraint violation.

import { NextResponse } from "next/server";
import { serviceClient, isDatabaseConfigured, errorBody } from "@/lib/db/client";
import { loadQuestionBank, applySelection, checkSelection } from "@/lib/assessment/questions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

let cachedBank: ReturnType<typeof loadQuestionBank> | null = null;
function bank() {
  if (cachedBank === null) {
    const cfg = JSON.parse(
      readFileSync(resolve(process.cwd(), "config/assessment-v1.0.json"), "utf8"),
    );
    cachedBank = loadQuestionBank(cfg);
  }
  return cachedBank;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params; // Next 15+: params is a Promise

  if (!isDatabaseConfigured()) {
    return NextResponse.json(errorBody("NOT_CONFIGURED", "Database is not configured."), {
      status: 503,
    });
  }

  let itemId: string | undefined;
  let optionCode: string | undefined;
  let openText: string | null = null;
  let selected: string[] = [];
  try {
    const body = (await request.json()) as {
      itemId?: unknown;
      optionCode?: unknown;
      optionCodes?: unknown;
      openText?: unknown;
    };
    if (typeof body.itemId === "string") itemId = body.itemId;
    if (typeof body.optionCode === "string") optionCode = body.optionCode;
    if (typeof body.openText === "string") openText = body.openText;
    // Multi-select items post the full resulting selection set. Single-select
    // items may post just optionCode; both normalise to `selected`.
    if (Array.isArray(body.optionCodes)) {
      selected = body.optionCodes.filter((v): v is string => typeof v === "string");
    } else if (optionCode) {
      selected = [optionCode];
    }
  } catch {
    return NextResponse.json(errorBody("INVALID_BODY", "Malformed request body."), {
      status: 400,
    });
  }

  if (!itemId || selected.length === 0) {
    return NextResponse.json(
      errorBody("INVALID_RESPONSE", "itemId and at least one option code are required."),
      { status: 400 },
    );
  }

  const db = serviceClient();

  const { data: session, error: sErr } = await db
    .from("assessment_sessions")
    .select("session_id, status")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not record the response."), {
      status: 500,
    });
  }
  if (!session) {
    return NextResponse.json(errorBody("UNKNOWN_SESSION", "No such session."), {
      status: 404,
    });
  }
  if (session.status === "completed") {
    return NextResponse.json(
      errorBody("SESSION_COMPLETE", "This assessment is complete and can no longer be edited."),
      { status: 409 },
    );
  }

  // --- validate against the instrument (PRD §9 types, §14 exclusivity) ---
  let question;
  try {
    question = bank().opening
      .concat(bank().questions, bank().activation)
      .find((q) => q.internal_id === itemId);
  } catch {
    question = undefined;
  }
  if (!question) {
    return NextResponse.json(
      errorBody("UNKNOWN_ITEM", `"${itemId}" is not an item on this instrument.`),
      { status: 400 },
    );
  }

  const verdict = checkSelection(question, selected);
  if (!verdict.ok) {
    return NextResponse.json(
      errorBody("INVALID_SELECTION", verdict.reason ?? "Selection is not permitted."),
      { status: 422 },
    );
  }

  // Persist the normalised set. Multi-select items replace their whole set;
  // single-select items replace their one row.
  const { error: dErr } = await db
    .from("responses")
    .delete()
    .eq("session_id", sessionId)
    .eq("item_id", itemId);
  if (dErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not record the response."), {
      status: 500,
    });
  }

  const rows = selected.map((code) => ({
    session_id: sessionId,
    item_id: itemId,
    option_code: code,
    open_text: openText,
  }));
  const { error: iErr } = await db.from("responses").insert(rows);
  if (iErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not record the response."), {
      status: 500,
    });
  }

  // PRD §23.2: autosave updates last_activity_at and current_position.
  const { error: uErr } = await db
    .from("assessment_sessions")
    .update({
      last_activity_at: new Date().toISOString(),
      current_position: (question.external_order ?? 0) + 1,
    })
    .eq("session_id", sessionId);
  if (uErr) {
    return NextResponse.json(errorBody("DB_ERROR", "Could not update the session."), {
      status: 500,
    });
  }

  return NextResponse.json({ saved: true, itemId, optionCodes: selected });
}

// Exported for the availability of the same validation on resume-driven flows.
export { applySelection };
