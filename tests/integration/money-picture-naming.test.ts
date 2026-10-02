import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signalLabel } from "@/lib/ui/narratives";

/**
 * The Money Picture naming and signal treatment — Addendum 01 v1.1 §2.
 *
 * Operator instruction for Step 3, verbatim:
 *   "explicitly resolve the known stale architecture references:
 *    - report-v1.0.json must not continue presenting Financial Operating Profile
 *      as the controlling participant-facing methodology where Addendum 01 v1.1
 *      establishes The Set for Life Money Picture™;
 *    - participant-facing signal treatment must not regress to obsolete
 *      SEE / ROOM / DIRECT / PREPARE / AIM / MOVE labels."
 *
 * WHY THIS IS A TEST AND NOT A RENAME. Both defects were self-inflicted by a
 * reasoning error that will recur: the code comment defending the old behaviour
 * claimed §13 named the signals as participant-friendly labels. §13 is real, but
 * v1.1 §2.2 explicitly separates the branded methodology from "the six internal
 * diagnostic constructs ... the technical/scoring architecture underneath the
 * participant experience". The two vocabularies exist for different audiences.
 * A rename alone would leave the next reader to re-derive that.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Addendum 01 v1.1 §2.4, verbatim. */
const QUESTIONS: Record<string, string> = {
  SEE: "What can you see?",
  ROOM: "How much room do you have?",
  DIRECT: "How are you making decisions?",
  PREPARE: "How prepared are you for disruption?",
  AIM: "Where are you headed?",
  MOVE: "What happens after you know?",
};

describe("participant-facing signal treatment uses §2.4's human questions", () => {
  it("every signal maps to its approved question, verbatim", () => {
    for (const [signal, question] of Object.entries(QUESTIONS)) {
      console.log(`  ${signal} -> "${signalLabel(signal)}"`);
      expect(signalLabel(signal), `${signal} must map to its §2.4 question`).toBe(question);
    }
  });

  it("NO internal signal code is ever returned as a label", () => {
    // The regression this guards. `signalLabel` used to be `return signal`, so
    // the raw code reached participants.
    for (const signal of Object.keys(QUESTIONS)) {
      expect(
        signalLabel(signal),
        `${signal} leaked as a participant-facing label`,
      ).not.toBe(signal);
    }
  });

  it("an unknown signal yields NOTHING, not the raw code", () => {
    // §24: an internal identifier must never reach a participant. An empty
    // string renders as nothing, which is the safe failure — returning the input
    // would print whatever internal key a future change introduced.
    for (const unknown of ["UNKNOWN", "OPEN_A", "Q11", "", "see"]) {
      expect(signalLabel(unknown), `"${unknown}" must not echo back`).toBe("");
    }
  });

  it("the six labels are distinct — no copy-paste collapse", () => {
    const labels = Object.keys(QUESTIONS).map(signalLabel);
    expect(new Set(labels).size, "two signals share a label").toBe(6);
  });

  it("the labels are questions, matching the spec's presentation language", () => {
    for (const [signal, question] of Object.entries(QUESTIONS)) {
      expect(question.trim().endsWith("?"), `${signal}'s label must be a question`).toBe(true);
    }
  });
});

describe("the Money Picture is named as the participant-facing methodology", () => {
  it("report-v1.0.json no longer titles a screen 'Financial Operating Profile'", () => {
    const report = JSON.parse(read("config/report-v1.0.json")) as {
      screens?: Array<{ id: string; title?: string }>;
    };
    const titles = (report.screens ?? []).map((s) => s.title ?? "");
    console.log(`  screen titles: ${JSON.stringify(titles)}`);

    for (const title of titles) {
      expect(
        title,
        "a screen still presents the internal model as the participant-facing methodology",
      ).not.toMatch(/Financial Operating Profile/i);
    }
    // And the renamed screen says what Addendum 01 v1.1 says.
    const named = titles.find((t) => /Money Picture/i.test(t));
    expect(named, "the Money Picture is not named on any screen").toBeTruthy();
  });

  it("the Snapshot page renders the Money Picture title, not the old one", () => {
    const page = read("app/(public)/snapshot/[sessionId]/page.tsx");
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/Financial Operating Profile/);
    expect(code).toMatch(/Your Set for Life Money Picture/);
  });

  it("no participant-facing source RENDERS an internal signal code", () => {
    // Targets RENDERING, not every mention. `key={s.signal}` is a correct React
    // identity and is invisible to a participant — a blunt scan for `s.signal`
    // flags it, which is a false positive, not a finding. (The first version of
    // this test did exactly that.)
    //
    // What matters is the JSX text positions: an expression inside braces that
    // is not wrapped in a label lookup.
    const page = read("app/(public)/snapshot/[sessionId]/page.tsx");

    // Match JSX TEXT POSITIONS only: a line that is exactly `{expr}` and
    // nothing else, which is how a value actually renders as text.
    //
    // The first two attempts at this were both wrong in instructive ways. A bare
    // `/\{\s*s\.signal\s*\}/` matched `key={s.signal}` — a React identity, never
    // shown to anyone. Loosening it to "any braces containing `signal`" then
    // matched a TypeScript interface body (`{ signal: string; state: string }`),
    // which is a type, not output. Anchoring to a whole line of JSX text is what
    // distinguishes "this value is displayed" from "this value is mentioned".
    const offenders: string[] = [];
    for (const line of page.split("\n")) {
      const m = line.match(/^\s*\{([^{}]+)\}\s*$/);
      if (!m) continue;
      const expr = m[1].trim();
      if (!/\bsignal\b/.test(expr)) continue;
      // `signalLabel(s.signal)` is the correct form — it translates.
      if (/signalLabel\s*\(/.test(expr)) continue;
      offenders.push(expr);
    }
    console.log(`  rendered signal expressions: ${JSON.stringify(offenders)}`);
    expect(
      offenders,
      "a raw signal code is rendered to the participant — wrap it in signalLabel()",
    ).toEqual([]);

    // And the correct form is present, so this cannot pass by rendering nothing.
    expect(page).toMatch(/signalLabel\(/);

    // `key=` uses are legitimate; assert at least one exists so the exclusion
    // above is visibly justified rather than hypothetical.
    expect(page, "the exclusion for key= is not hypothetical").toMatch(/key=\{s\.signal\}/);
  });
});

describe("web results render from the stored payload — never a recompute", () => {
  it("loadSnapshot does not score, and the snapshot route does not either", () => {
    // Operator instruction: "Preserve the immutable Snapshot architecture: web
    // results must render from the stored snapshot_payload, not independently
    // recalculate interpretation." Addendum 01 §5 forbids the same thing from
    // the other direction: the web view and the PDF must read ONE payload.
    //
    // A recompute is not a hypothetical regression — this method USED to
    // re-derive the whole Snapshot on every read, and a config recalibration
    // between two visits would silently change what a participant's own report
    // said.
    const service = read("lib/session/service.ts");
    const fn = service.slice(service.indexOf("export async function loadSnapshot"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    console.log(
      `  loadSnapshot scores: ${/scoreAssessment\(/.test(body)} | reads payload_json: ${/payload_json/.test(body)}`,
    );
    expect(body, "loadSnapshot must not re-score").not.toMatch(/scoreAssessment\(/);
    expect(body, "loadSnapshot must not recompute tensions").not.toMatch(/evaluateTensions\(/);
    expect(body, "loadSnapshot must read the persisted payload").toMatch(/payload_json/);

    // And the route that serves the participant delegates to it rather than
    // scoring anything itself.
    const route = read("app/api/session/[id]/snapshot/route.ts");
    expect(route).toMatch(/loadSnapshot\(/);
    expect(route, "the snapshot route must not score").not.toMatch(/scoreAssessment\(/);
  });

  it("the payload the renderer reads is the payload the writer stored", () => {
    // Same object, two column names — asserted in the writer, so the two cannot
    // disagree. Writing one and not the other is the drift this layer exists to
    // prevent.
    const service = read("lib/session/service.ts");
    expect(service).toMatch(/payload_json: payload,/);
    expect(service).toMatch(/rendered_payload_json: payload,/);
  });
});
