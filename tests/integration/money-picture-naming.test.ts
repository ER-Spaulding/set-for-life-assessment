import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { signalLabel } from "@/lib/ui/narratives";
import { HUMAN_QUESTIONS } from "@/lib/ui/human-questions";
import { SIX_HUMAN_QUESTIONS } from "@/lib/ui/reveal-copy";

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

/**
 * Addendum 01 v1.1 §2.4's six questions, derived from the single source of
 * truth (lib/ui/human-questions.ts) rather than a third hand-maintained copy.
 * The spec-verbatim guard for the words themselves lives in
 * reveal-copy-verbatim.test.ts, which re-extracts them from the .md; here the
 * map is only the signal→question wiring `signalLabel` must reproduce.
 */
const QUESTIONS: Record<string, string> = Object.fromEntries(
  HUMAN_QUESTIONS.map((q) => [q.signal, q.question]),
);


/**
 * EVERY FILE IN THE WEB RENDER LAYER, concatenated.
 *
 * The render layer used to be one file (`components/snapshot/results-view.tsx`);
 * it is now a directory of focused components. These source-level guards assert
 * properties of "the render layer", so they must read the WHOLE layer — scanning
 * only results-view.tsx would silently stop checking the other twelve files, and
 * the guard would pass for the wrong reason. Concatenating is safe because every
 * assertion below is a negative (must-not-contain) or a whole-layer presence
 * check; a per-file loop would be weaker for the presence checks.
 */
function renderLayerSource(ext: string[] = [".tsx", ".ts"]): string {
  const dir = resolve(repo, "components/snapshot");
  return readdirSync(dir)
    .filter((f) => ext.some((e) => f.endsWith(e)))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .join("\n");
}


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

describe("the six questions have ONE source of truth, not three", () => {
  it("reveal-copy's SIX_HUMAN_QUESTIONS derive from the shared source", () => {
    // The words live in lib/ui/human-questions.ts. If someone hand-edits a
    // question in reveal-copy.ts back to a literal (re-forking the copy), this
    // diverges from the source and fails.
    expect(SIX_HUMAN_QUESTIONS).toHaveLength(HUMAN_QUESTIONS.length);
    HUMAN_QUESTIONS.forEach((src, i) => {
      const reveal = SIX_HUMAN_QUESTIONS[i];
      expect(
        reveal.question,
        `${src.signal}: reveal question must be the shared source's question, verbatim`,
      ).toBe(src.question);
      expect(
        reveal.prompt,
        `${src.signal}: reveal prompt must be the shared source's prompt, verbatim`,
      ).toBe(src.prompt);
    });
  });

  it("narratives' signalLabel agrees with the shared source", () => {
    // signalLabel derives SIGNAL_QUESTION_LABEL from the same source. A
    // hand-edited label in narratives.ts would diverge and fail here.
    HUMAN_QUESTIONS.forEach((src) => {
      expect(signalLabel(src.signal), `${src.signal} label drift`).toBe(
        src.question,
      );
    });
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

  it("the Snapshot page renders the Money Picture title from the shared model, not the old one", () => {
    // The page is now a server component that delegates presentation to the
    // shared-section-model renderer (components/snapshot/results-view.tsx). The
    // participant-facing title is SOURCED from the report config's
    // operating-profile screen by the SHARED section model
    // (lib/render/snapshot-sections.ts) and rendered verbatim as the model's
    // `section.heading` — never re-authored as a literal in the render layer.
    // This asserts the sourcing, while the first test in this file asserts the
    // report config names it "Your Set for Life Money Picture" and never
    // "Financial Operating Profile".
    const code = renderLayerSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/Financial Operating Profile/);
    // The render layer prints the model's heading; it does not look the title up
    // itself.
    expect(code).toMatch(/section\.heading/);
    // The single source maps the money-picture module to the report config's
    // operating-profile screen id.
    const model = read("lib/render/snapshot-sections.ts");
    expect(model).toMatch(/"money-picture"\s*:\s*"operating-profile"/);
  });

  it("no participant-facing source RENDERS an internal signal code", () => {
    // Targets RENDERING, not every mention. `key={row.signal}` is a correct
    // React identity and is invisible to a participant. The render layer
    // consumes the RESOLVED view and may only print its resolved fields
    // (question / label / copy) — never a raw internal identifier.
    //
    // The layer is now the WHOLE components/snapshot/ directory, so this scans
    // every component in it: the decomposition must not become a place where an
    // internal identifier can hide in a file the guard stopped reading.
    const view = renderLayerSource();

    // Match JSX expressions that resolve a raw internal identifier — the
    // `.signal` code, a `.state`, a `.narrativeKey`, a `.specialState`, or a
    // `.displayState` — wherever they sit. Reject only the one legitimate
    // non-rendering form: `key={row.signal}` (an invisible React identity).
    const offenders: string[] = [];
    for (const m of view.matchAll(
      /\{[^{}]*\.(signal|state|narrativeKey|specialState|displayState)\b[^{}]*\}/g,
    )) {
      const expr = m[0];
      const before = view.slice(Math.max(0, m.index - 16), m.index);
      if (/key\s*=\s*$/.test(before)) continue;
      offenders.push(expr);
    }
    console.log(`  rendered internal-identifier expressions: ${JSON.stringify(offenders)}`);
    expect(
      offenders,
      "a raw internal signal/state identifier is rendered to the participant",
    ).toEqual([]);

    // The resolved fields ARE rendered (as block.kicker / block.label /
    // block.body — the shared section model's fields), so this cannot pass by
    // rendering nothing.
    expect(view).toMatch(/block\.kicker/);
    expect(view).toMatch(/block\.label/);
    expect(view).toMatch(/block\.body/);

    // The shared block model carries NO internal id, so the renderer has no
    // `.signal` to reference at all — even as a React key. That is the strongest
    // form of the guard: the internal identifier cannot leak because it never
    // reaches the render layer.
    expect(view, "the render layer must hold no .signal reference").not.toMatch(/\.signal\b/);
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
    // Match the IDENTIFIER, not just a call with parens: `const recompute =
    // scoreAssessment` (a bare reference) and a renamed import both recompute
    // without ever writing `scoreAssessment(`. The body must never even
    // reference the scoring identifiers — the payload is the only permitted
    // input to a render.
    expect(body, "loadSnapshot must not re-score").not.toMatch(/\bscoreAssessment\b/);
    expect(body, "loadSnapshot must not recompute tensions").not.toMatch(/\bevaluateTensions\b/);
    // loadSnapshot reads the persisted payload through the shared reader —
    // `readCompletedSnapshot` is the ONE place payload_json is selected, and
    // loadSnapshot delegates to it rather than re-deriving anything. Assert the
    // reader reads the persisted column (never recomputes) and that loadSnapshot
    // calls it.
    const reader = service.slice(
      service.indexOf("async function readCompletedSnapshot"),
      service.indexOf("export async function loadSnapshot"),
    );
    expect(reader, "the snapshot reader must read the persisted payload").toMatch(/payload_json/);
    expect(reader, "the snapshot reader must not re-score").not.toMatch(/\bscoreAssessment\b/);
    expect(body, "loadSnapshot must delegate to the stored-payload reader").toMatch(/readCompletedSnapshot\(/);

    // And the route that serves the participant delegates to it rather than
    // scoring anything itself.
    const route = read("app/api/session/[id]/snapshot/route.ts");
    expect(route).toMatch(/loadSnapshot\(/);
    expect(route, "the snapshot route must not score").not.toMatch(/\bscoreAssessment\b/);
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
