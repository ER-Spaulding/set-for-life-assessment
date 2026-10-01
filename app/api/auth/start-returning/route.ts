// PRD §7.3, §23.1 — begin returning-participant verification.
//
// PRD §7.3: "Do not reveal whether an email has a participant record before
// verification in a way that creates account-enumeration risk."
//
// WHY THIS FILE LOOKS LIKE `start-new`:
// It must. PRD §23.1 defines these as separate endpoints, so they stay separate
// — but they return byte-identical bodies and the same 202 status for every
// input. Any divergence a caller could observe (a different message, a
// different status, a different field) would turn the pair into an
// account-enumeration oracle: POST to both with an address and the one that
// behaves differently tells you whether that person is a participant.
//
// If you change the response shape here, change `start-new` identically.

import { NextResponse } from "next/server";
import { normaliseEmail, verificationStartedBody, issueVerificationToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email/verification";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string") email = normaliseEmail(body.email);
  } catch {
    // Treated identically to an unrecognised address — see start-new.
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: { code: "INVALID_EMAIL", message: "A valid email address is required." } },
      { status: 400 },
    );
  }

  const { token, payload } = issueVerificationToken(email, "email", "returning");
  const expiresAt = payload.expiresAt;

  // Send, identically to start-new — see that route for the full reasoning.
  // The result is discarded: a send failure must not change the response, or
  // the pair would stop being indistinguishable (§7.3). Awaited so the message
  // is not dropped when the serverless invocation ends.
  await sendVerificationEmail({
    to: email,
    purpose: "returning",
    contact: email,
    contactType: "email",
    expiresAt,
    token,
  }).catch(() => {
    /* failure must never surface to the caller */
  });

  return NextResponse.json(
    {
      ...verificationStartedBody(),
      ...(process.env.NODE_ENV !== "production" ? { devToken: token } : {}),
    },
    { status: 202 },
  );
}
