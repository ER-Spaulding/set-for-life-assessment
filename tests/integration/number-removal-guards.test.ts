import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { SaveMyProgress } from "@/components/identity/SaveMyProgress";

// SET FOR LIFE NUMBER — PARTICIPANT-JOURNEY REMOVAL GUARDS (Owner decision /
// plan D12, 2026-10-07).
//
// "Remove from the participant journey: dedicated 'Your Set for Life Number'
// screen; 'Keep this number' language; any instruction to save or memorize it;
// returning-user input asking for the Set for Life Number. … Do not remove or
// rename the underlying database identifier. Do not alter D-1
// identity/recovery security."
//
// These are SOURCE guards in the repo's readFileSync + regex idiom. Comments
// are stripped first — a source guard reads CODE, not prose — so the
// engineering notes that record *why* the number left the journey are allowed
// to name it; what cannot appear is the identifier in participant-visible
// code, markup or copy.
//
// Scope of the sweep: everything a participant can load — app/(public) and
// components/. app/api/auth/lookup, lib/auth/returning and the generation/
// migration code are INTERNAL by Owner decision and are deliberately out of
// scope (their own headers record the retention).

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Strip line and block comments — the guard reads code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const JOURNEY_EXT = new Set([".ts", ".tsx"]);
function journeyFiles(): string[] {
  return ["app/(public)", "components"]
    .flatMap((d) => walk(resolve(repo, d)))
    .filter((f) => JOURNEY_EXT.has(extname(f)));
}

const BANNED = [/sflNumber/, /XXXX-XXXX/, /Set for Life Number/, /Keep this number/i];

describe("the number is gone from every participant-visible surface", () => {
  it("no journey file (code, not comments) references the identifier or its language", () => {
    const offenders: string[] = [];
    for (const f of journeyFiles()) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const pattern of BANNED) {
        if (pattern.test(code)) {
          offenders.push(`${f.replace(repo + "/", "")}: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the provisional route's response never carries the number", () => {
    const code = stripComments(read("app/api/participant/provisional/route.ts"));
    expect(code).not.toMatch(/sflNumber/);
    // Generation/storage are untouched — the trigger-side field still exists.
    expect(read("lib/session/provisional.ts")).toMatch(/sfl_number/);
  });
});

describe("the rebuilt returning entry — verified identity, in place", () => {
  const page = read("app/(public)/assessment/returning/page.tsx");

  it("posts start-returning with an email field", () => {
    expect(page).toMatch(/\/api\/auth\/start-returning/);
    expect(page).toMatch(/name="email"/);
    expect(page).toMatch(/JSON\.stringify\(\{\s*email:/);
    // The old number endpoint is not called from the journey anymore.
    const code = stripComments(page);
    expect(code).not.toMatch(/\/api\/auth\/lookup/);
  });

  it("renders the ready-made VerificationState 'check your email' copy", () => {
    expect(page).toMatch(/import \{ VerificationState \}/);
    expect(page).toMatch(/<VerificationState email=\{email\.trim\(\)\} \/>/);
  });

  it("keeps an h1 (the 320px harness requires one on this route)", () => {
    const code = stripComments(page);
    expect(code).toMatch(/<h1/);
  });
});

describe("Save My Progress — claimed confirms the EMAIL flow, never a number", () => {
  it("takes no sflNumber prop and renders the governed sent confirmation", () => {
    const src = read("components/identity/SaveMyProgress.tsx");
    expect(stripComments(src)).not.toMatch(/sflNumber/);
    expect(src).toMatch(/COPY\.sent\.label/);
    expect(src).toMatch(/COPY\.sent\.body/);
    expect(src).toMatch(/COPY\.sent\.cta/);
  });

  it("the claimed screen's markup contains the sent copy and no identifier", () => {
    const html = renderToStaticMarkup(
      React.createElement(SaveMyProgress, {
        onKeepGoing: () => {},
        onClaim: () => {},
        claimed: true,
      } as never),
    );
    expect(html).toContain("Check your email");
    expect(html).toContain("CONTINUE MY ASSESSMENT");
    expect(html).not.toMatch(/XXXX-XXXX/);
    expect(html).not.toMatch(/Keep this number/i);
  });
});

describe("the governed interstitial config — keepNumber retired, sent added", () => {
  const cfg = JSON.parse(read("config/interstitial-v1.0.json")) as {
    saveMyProgress: Record<string, unknown>;
  };
  const smp = cfg.saveMyProgress;

  it("keepNumber is gone as live copy and recorded as retired provenance", () => {
    expect(smp).not.toHaveProperty("keepNumber");
    const retired = smp._retired as { keepNumber?: { _reason?: string } } | undefined;
    expect(retired?.keepNumber?._reason, "retirement must be documented").toBeTruthy();
    expect(JSON.stringify(smp._retired)).toMatch(/internal-system-only/);
  });

  it("sent carries the anti-enumeration confirmation with a continue CTA", () => {
    const sent = smp.sent as { label?: string; body?: string[]; cta?: string } | undefined;
    expect(sent?.label).toBe("Check your email");
    expect(Array.isArray(sent?.body) && sent.body.length >= 1).toBe(true);
    expect(sent?.cta).toBeTruthy();
    // Never a save/memorize instruction.
    expect(JSON.stringify(sent)).not.toMatch(/Keep this number|Set for Life Number|XXXX/i);
  });
});
