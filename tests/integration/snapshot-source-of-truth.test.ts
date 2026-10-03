import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE SOURCE-OF-TRUTH GUARD — Addendum 01 v1.1 §5, and the invariant the
 * verifier proved was UNENFORCED.
 *
 * THE ATTACK. Swapping the results page's data source to a NEW route that
 * `SELECT`s live `tensions` + `computed_signals` and re-derives the attention
 * areas left every test green. Nothing asserted that the page reads
 * `snapshots.payload_json`. A green suite had silently accepted a second,
 * live-recomputed interpretation of the same session — exactly the drift §5
 * exists to forbid ("Do not rescore completed results on every read").
 *
 * THIS FILE closes that hole with SOURCE-LEVEL assertions against the one
 * read path a renderer is permitted to take:
 *
 *   1. the results page reads the stored payload through the server-only
 *      accessor `loadSnapshotPayload` — never a client `fetch`, never a route,
 *      never a live SELECT.
 *   2. `loadSnapshotPayload` -> `readCompletedSnapshot` reads the PERSISTED
 *      payload column (`payload_json` / `rendered_payload_json`) from the
 *      `snapshots` table — and never from `computed_signals` or `tensions`.
 *   3. the page resolves the payload through the SHARED resolver
 *      `resolveSnapshotView`, and no render-layer file rescoring or
 *      re-interpreting (no `scoreAssessment` / `evaluateTensions` /
 *      `selectAttentionArea` / `classifyAll` imports or calls).
 *   4. internal fields (`openingB`, `moveSubsignals`, `specialState`,
 *      `evidence`, `classifierTags`, raw `state`) never appear in the render
 *      layer — they stay server-side.
 *
 * These are SOURCE guards (like the single-source test): they read the tree,
 * not a DOM. The render-level sibling (snapshot-render-differential.test.ts)
 * proves the rendered strings match the pinned libraries; this file proves the
 * renderer COULD NOT have got them from anywhere but the stored payload.
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** Remove `//` and `/* *​/` comments so source guards read code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PAGE = "app/(public)/snapshot/[sessionId]/page.tsx";
const SERVICE = "lib/session/service.ts";
const RESULTS_VIEW = "components/snapshot/results-view.tsx";

describe("the results page reads the STORED payload — never a live recompute", () => {
  it("the page obtains its data via loadSnapshotPayload, not a client fetch or a route", () => {
    const code = stripComments(read(PAGE));

    // The page must call the server-only stored-payload accessor.
    expect(code, "the page must call loadSnapshotPayload").toMatch(/loadSnapshotPayload\(/);
    expect(code, "the page must import from the session service").toMatch(
      /from\s+"@\/lib\/session\/service"/,
    );

    // The verifier's attack swapped in a NEW route that SELECTs live tensions +
    // computed_signals. The page must not fetch any route.
    expect(code, "the page must not fetch the snapshot route (or any route)").not.toMatch(
      /\bfetch\s*\(/,
    );
    expect(code, "the page must not import a route module").not.toMatch(/@\/app\/api\//);

    // And it must resolve through the SHARED section model, not re-resolve itself.
    expect(code, "the page must resolve via resolveSnapshotContent").toMatch(/resolveSnapshotContent\(/);
  });

  it("readCompletedSnapshot reads payload_json from the snapshots table — never live tables", () => {
    const service = read(SERVICE);
    const start = service.indexOf("async function readCompletedSnapshot");
    const end = service.indexOf("export async function loadSnapshot");
    // Comments legitimately name the tables this reader must NOT read (the
    // re-derivation it replaced); scan code, not prose.
    const reader = stripComments(service.slice(start, end));

    // The persisted payload column(s), read from the snapshots table.
    expect(reader, "the reader must select payload_json").toMatch(/payload_json/);
    expect(reader, "the reader must fall back to rendered_payload_json").toMatch(
      /rendered_payload_json/,
    );
    expect(reader, "the reader must read the snapshots table").toMatch(/from\("snapshots"\)/);

    // The verifier's attack SELECTed live tensions + computed_signals. The
    // reader must never touch those tables — the payload is the only input.
    expect(reader, "the reader must not read live computed_signals").not.toMatch(
      /computed_signals/,
    );
    expect(reader, "the reader must not read live tensions").not.toMatch(/from\("tensions"\)/);
    expect(reader, "the reader must not re-select the tensions table").not.toMatch(
      /\btensions\b/,
    );
  });

  it("loadSnapshotPayload returns the stored payload unchanged (no re-derivation)", () => {
    const service = read(SERVICE);
    const start = service.indexOf("export async function loadSnapshotPayload");
    const end = service.indexOf("// REMOVED:");
    const fn = stripComments(service.slice(start, end < 0 ? undefined : end));

    expect(fn, "loadSnapshotPayload must delegate to readCompletedSnapshot").toMatch(
      /readCompletedSnapshot\(/,
    );
    expect(fn, "loadSnapshotPayload must not re-score").not.toMatch(/\bscoreAssessment\b/);
    expect(fn, "loadSnapshotPayload must not re-evaluate tensions").not.toMatch(
      /\bevaluateTensions\b/,
    );
    expect(fn, "loadSnapshotPayload must not re-select an attention area").not.toMatch(
      /\bselectAttentionArea\b/,
    );
  });
});

describe("no render-layer rescoring or raw-response interpretation", () => {
  it("the page and results view import none of the scoring/interpretation machinery", () => {
    for (const file of [PAGE, RESULTS_VIEW]) {
      const code = stripComments(read(file));
      for (const forbidden of [
        "assessment/scoring",
        "assessment/tensions",
        "assessment/classifiers",
        "assessment/interpretation",
        "assessment/evidence-chain",
        "assessment/activation",
        "db/client",
      ]) {
        expect(code, `${file} must not import ${forbidden}`).not.toContain(forbidden);
      }
      // No re-derivation call, even via a renamed import.
      expect(code, `${file} must not score`).not.toMatch(/\bscoreAssessment\b/);
      expect(code, `${file} must not evaluate tensions`).not.toMatch(/\bevaluateTensions\b/);
      expect(code, `${file} must not re-select an attention area`).not.toMatch(
        /\bselectAttentionArea\b/,
      );
      expect(code, `${file} must not classify`).not.toMatch(/\bclassifyAll\b/);
    }
  });
});

describe("internal fields stay server-side", () => {
  it("the render layer never references openingB, moveSubsignals, specialState, evidence, or classifierTags", () => {
    for (const file of [PAGE, RESULTS_VIEW]) {
      const code = stripComments(read(file));
      for (const internal of [
        "openingB",
        "moveSubsignals",
        "specialState",
        "classifierTags",
        "evidence",
      ]) {
        expect(code, `${file} must never reference ${internal}`).not.toContain(internal);
      }
    }
  });

  it("the results view is server-rendered and passes only the resolved view to the browser", () => {
    const code = stripComments(read(RESULTS_VIEW));
    // No client boundary: this is a server component.
    expect(code, "the results view must not be a client component").not.toMatch(/["']use client["']/);
    // It consumes the resolved view only; it does not import the payload type
    // or the service (which would let internals cross the boundary).
    expect(code, "the results view must not import the session service").not.toMatch(
      /session\/service/,
    );
  });
});
