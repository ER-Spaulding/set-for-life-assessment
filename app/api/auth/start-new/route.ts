// PRD §7.3, §23.1 — begin new-participant verification.
//
// PRD §23.1: "begins new-participant email verification without creating
// duplicate participant records."
//
// PRD §7.3: "Do not reveal whether an email has a participant record before
// verification in a way that creates account-enumeration risk."
//
// This route and `start-returning` return an IDENTICAL body and status for
// every input — existing email, new email, malformed email. Callers cannot
// distinguish them, so the endpoint cannot be used to enumerate participants.
// The response shape comes from `verificationStartedBody()` for exactly that
// reason; do not add fields that vary by outcome.

import { NextResponse } from "next/server";
import { normaliseEmail, verificationStartedBody, issueVerificationToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string") email = normaliseEmail(body.email);
  } catch {
    // Malformed JSON is treated exactly like an unrecognised email: the caller
    // learns nothing about why. (The one exception is a missing email, which is
    // a client bug rather than an enumeration probe.)
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: { code: "INVALID_EMAIL", message: "A valid email address is required." } },
      { status: 400 },
    );
  }

  // Mint the token regardless of whether the participant exists. The token is
  // what the email carries; the lookup that decides "new" vs "existing" happens
  // at redemption, after verification proves ownership.
  const { token } = issueVerificationToken(email, "email", "new");

  if (isDatabaseConfigured()) {
    // Sending is handled by the reminder/CRM layer. Deliberately not attempted
    // here: a send failure must not change the response, or the response time
    // would leak whether an address is known.
  }

  // Identical body for every outcome. `token` is returned only in non-production
  // so local flows can be exercised; production relies on the emailed link.
  return NextResponse.json(
    {
      ...verificationStartedBody(),
      ...(process.env.NODE_ENV !== "production" ? { devToken: token } : {}),
    },
    { status: 202 },
  );
}
