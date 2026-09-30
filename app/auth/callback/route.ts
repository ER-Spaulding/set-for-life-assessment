// PRD §23.1 — auth callback stub.
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
