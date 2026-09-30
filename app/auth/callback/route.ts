// PRD §7.3, §22.2, §23.1 — email-verification callback (redemption).
//
// The start-new / start-returning routes mint a verification token and (in
// production) email it as a link to THIS endpoint. This route redeems it:
//   1. recompute the HMAC over the link params and compare timing-safe;
//   2. refuse expired links (410) — verification links are short-lived;
//   3. resolve the verified email to a participant WITHOUT duplicating:
//      an existing email contact reuses its participant; a new email creates
//      exactly one participant + one verified contact. A UNIQUE-race (double-
//      clicked link) collapses onto the winner's row and the orphan participant
//      is deleted, so no duplicate participant record survives.
//
// Anti-enumeration (§7.3) applies BEFORE verification, at the start routes.
// This endpoint is reachable only with an unguessable per-email token, so
// returning the resolved participant_id here reveals nothing to a prober.
//
// LINK CONTRACT (for the future email sender — must match issueVerificationToken
// in lib/auth/index.ts): ?purpose=new|returning&contactType=email&contact=<addr>
// &expiresAt=<epoch ms>&token=<hex sha256(purpose:contactType:contact:expiresAt:secret)>
// Optional &firstName= &lastName= (S00A collects real names later; empty when absent).

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  serviceClient,
  isDatabaseConfigured,
  errorBody,
} from "@/lib/db/client";
import { normaliseEmail, isVerificationFresh } from "@/lib/auth";

export const dynamic = "force-dynamic";

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      errorBody("NOT_CONFIGURED", "Database is not configured."),
      { status: 503 },
    );
  }

  const q = new URL(request.url).searchParams;
  const purpose = q.get("purpose");
  const contactType = q.get("contactType");
  const expiresAtRaw = q.get("expiresAt");
  const token = q.get("token") ?? "";

  if (
    (purpose !== "new" && purpose !== "returning") ||
    contactType !== "email" ||
    !q.get("contact") ||
    !expiresAtRaw ||
    !token
  ) {
    return NextResponse.json(
      errorBody("INVALID_LINK", "This verification link is incomplete."),
      { status: 400 },
    );
  }
  const contact = normaliseEmail(q.get("contact") as string);
  const expiresAt = Number(expiresAtRaw);
  if (!contact || !contact.includes("@") || !Number.isFinite(expiresAt)) {
    return NextResponse.json(
      errorBody("INVALID_LINK", "This verification link is incomplete."),
      { status: 400 },
    );
  }

  // Recompute the token. Formula pinned to issueVerificationToken in
  // lib/auth/index.ts: sha256(purpose:contactType:contact:expiresAt:secret).
  // `purpose` is hashed in, so a new↔returning flip invalidates the link.
  const secret = process.env.REMINDER_LINK_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      errorBody("VERIFICATION_UNAVAILABLE", "Verification is unavailable."),
      { status: 503 },
    );
  }
  const expected = createHash("sha256")
    .update(`${purpose}:${contactType}:${contact}:${expiresAt}:${secret}`)
    .digest("hex");
  if (!tokensEqual(token, expected)) {
    return NextResponse.json(
      errorBody("INVALID_TOKEN", "This verification link is not valid."),
      { status: 401 },
    );
  }
  if (
    !isVerificationFresh({ contactType: "email", contact, expiresAt })
  ) {
    return NextResponse.json(
      errorBody(
        "LINK_EXPIRED",
        "This verification link has expired. Please request a new one.",
      ),
      { status: 410 },
    );
  }

  const firstName = (q.get("firstName") ?? "").trim().slice(0, 120);
  const lastName = (q.get("lastName") ?? "").trim().slice(0, 120);
  const nowIso = new Date().toISOString();
  const db = serviceClient();

  // Existing email contact → reuse its participant (never a duplicate).
  // Refresh verified_at: the click just proved current ownership of the address.
  const { data: existing, error: lErr } = await db
    .from("participant_contacts")
    .select("contact_id, participant_id")
    .eq("contact_type", "email")
    .eq("normalized_value", contact)
    .maybeSingle();
  if (lErr) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }
  if (existing) {
    // Corroboration, not the gate: verification already succeeded above, so a
    // stamp failure must not fail the redemption.
    await db
      .from("participant_contacts")
      .update({ verified_at: nowIso })
      .eq("contact_id", (existing as { contact_id: string }).contact_id);
    return NextResponse.json({
      verified: true,
      participantId: (existing as { participant_id: string }).participant_id,
      newParticipant: false,
    });
  }

  // New email → exactly one participant + one verified contact.
  const { data: participant, error: pErr } = await db
    .from("participants")
    .insert({ first_name: firstName, last_name: lastName })
    .select("participant_id")
    .single();
  if (pErr || !participant) {
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }
  const pid = (participant as { participant_id: string }).participant_id;

  const { error: cErr } = await db.from("participant_contacts").insert({
    participant_id: pid,
    contact_type: "email",
    normalized_value: contact,
    verified_at: nowIso,
    is_primary: true,
  });
  if (cErr) {
    if ((cErr as { code?: string }).code === "23505") {
      // Lost a race with another redemption of the same link (double click):
      // drop the orphan participant and collapse onto the winner's row, so no
      // duplicate participant record survives (§23.1: no duplicates).
      await db.from("participants").delete().eq("participant_id", pid);
      const { data: winner } = await db
        .from("participant_contacts")
        .select("contact_id, participant_id")
        .eq("contact_type", "email")
        .eq("normalized_value", contact)
        .maybeSingle();
      if (winner) {
        return NextResponse.json({
          verified: true,
          participantId: (winner as { participant_id: string }).participant_id,
          newParticipant: false,
        });
      }
    }
    return NextResponse.json(
      errorBody("DB_ERROR", "Could not complete verification."),
      { status: 500 },
    );
  }

  return NextResponse.json(
    { verified: true, participantId: pid, newParticipant: true },
    { status: 201 },
  );
}
