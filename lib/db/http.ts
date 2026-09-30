// Shared HTTP helpers for API routes: precise JSON errors, correct statuses,
// never leak stack traces to the client (PRD §23.5).

import { NextResponse } from "next/server";
import { DbNotConfiguredError } from "./client";

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status });
}

/** Thrown by shared loaders to signal an exact client-facing status. */
export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(code: string, status: number, extra?: Record<string, unknown>) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

/** Map any thrown value to a safe JSON error response (no stacks). */
export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return fail(e.message, e.status, e.extra);
  if (e instanceof DbNotConfiguredError) return fail(e.message, e.status);
  return fail("internal_error", 500);
}

/** Parse a JSON body leniently — returns {} when absent/unparseable. */
export async function parseJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
