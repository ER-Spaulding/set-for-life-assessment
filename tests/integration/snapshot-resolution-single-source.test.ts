import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import {
  resolveSnapshotView,
  resolveSignalRow,
  signalLabel,
  signalQuestionLabel,
  isSpecialState,
} from "@/lib/render/snapshot-view";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";
import { HUMAN_QUESTIONS } from "@/lib/ui/human-questions";
import { contentHash } from "@/lib/assessment/versions";

/**
 * THE SHARED-RESOLUTION GUARD — Addendum 01 v1.1 §5.
 *
 * §5 (verbatim): "ONE SNAPSHOT PAYLOAD - TWO RENDERERS. The web results and PDF
 * must use the same completed immutable snapshot_payload. The application must
 * not: rescore for PDF; use a separate generative prompt to rewrite conclusions;
 * generate different conclusions for web and PDF; omit capacity protections in
 * one renderer; silently update a historical Snapshot after scoring/narrative
 * changes."
 *
 * The PDF renderer does not exist yet (Addendum §14 step 6 — out of scope), so a
 * byte-for-byte web==PDF differential test would be VACUOUS: it cannot fail on
 * the defect it claims to catch because the second renderer isn't there. This
 * file therefore asserts the properties that ARE meaningful today — the ones
 * that fail the moment either renderer grows a second resolution path, and that
 * bind the future PDF by construction rather than by a (currently impossible)
 * differential:
 *
 *   1. SINGLE ENTRY POINT: the web results page and every components/snapshot/*
 *      file resolve copy through lib/render/snapshot-view.ts and NOTHING else.
 *   2. ONE IMPLEMENTATION: the two legacy resolvers (lib/ui/narratives.ts,
 *      lib/assessment/narratives.ts) no longer hold independent key→copy logic.
 *   3. THE RESOLVER CANNOT RECOMPUTE: its source imports no scoring/tensions/
 *      classifiers/db/session code — same payload, same view, no live reads.
 *   4. CAPACITY PROTECTIONS: a special_signal_states.* key resolves to its
 *      off-ladder copy (never the S-ladder copy), isCapacity === true, and no
 *      raw state/code appears in any resolved string.
 *   5. NULL FINDING: nullFinding → no fabricated friction sentence; primary
 *      attention area is KEEP_OBSERVING.
 *   6. TENSION PRECEDENCE: connections resolve primary-then-secondary; the
 *      primary attention area is attentionAreas[0], never re-derived.
 *   7. NO INTERNAL VOCABULARY (§24) in any resolved prose string.
 *   8. MODULE COMPLETENESS: the resolved view's non-null modules are a function
 *      of the payload alone.
 *   9. IDENTITY (evidence toward "render identically", NOT a proof OF it):
 *      resolveSnapshotView's signals/connections/primaryAttentionArea deep-equal
 *      the pinned config libraries (config/narratives-v1.0.json,
 *      config/connection-statements-v1.0.json), so the resolver is measured
 *      against an authority it does not itself supply. This is one payload's
 *      worth of identity, not a demonstration that two renderers produce
 *      identical output — the PDF renderer does not exist yet, and no test here
 *      can prove a property of a program that has not been written.
 *  10. CONTENT-HASH PIN (F1): the narrative and connection libraries are pinned
 *      by the same contentHash convention lib/assessment/versions.ts uses, so an
 *      in-place copy edit to either config fails until the hash AND the approved
 *      library document are updated together — a deliberate act, not a silent one.
 *  11. NO HARDCODED SECOND COPY (F3): no participant-facing narrative body,
 *      connection headline/body, or attention label/body may appear in
 *      app/components/lib — in SOURCE (comments stripped) or in a DATA file such
 *      as a .json copy map (adversarial finding NB1: copy stored as data escaped a
 *      source-extension-only scan). The resolver, the shim, and the allowlisted
 *      config importers are excluded. This catches a second renderer with an
 *      inline copy map whether or not it currently agrees with the config, and a
 *      byte-identical copy of a whole config library under a new filename (which
 *      the ownership check catches as a second importer).
 *      LIMITS (documented, not chased): (a) a second renderer that REBUILDS copy
 *      at runtime from pieces — split/joined literals, encoded strings — with no
 *      single literal equal to a config string is outside this scan (adversarial
 *      finding N2, demonstrated); (b) a copy library that stores the two fields
 *      SPLIT ACROSS TWO DATA FILES, neither holding the concatenated string, is
 *      likewise outside; (c) this file does not own the failure/loading screen
 *      copy in lib/ui/snapshot-failure.ts, which is guarded only by
 *      snapshot-failure.test.ts, not by §5.
 *
 * HONEST COVERAGE STATEMENT. Like its render-level sibling, this file is a strong
 * DETECTION mechanism, NOT a proof that no divergence can exist, and NOT a
 * certificate of §5 compliance. Specifically: the PDF renderer does not exist, so
 * no test here demonstrates that web and PDF agree — they bind the surface the
 * PDF must use when it is written. The content-hash pin proves the copy libraries
 * are UNCHANGED, not that they are CORRECT (a hash is updated whenever approved
 * copy legitimately changes). The source scan sees literals, not behaviour: a
 * second resolution path built from runtime string assembly is outside it, as
 * stated in the limits above. A green run means "the properties enumerated at the
 * top of this file hold for this tree", not "the application cannot diverge".
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Resolver-ownership helpers (bypasses 4 & 5).
//
// These find every app source file that imports the pinned narrative or
// connection config. Detection is RESOLUTION-based (aliases and relative paths
// resolve to the real file) and CONTENT-based (a copied library under a new
// filename is still recognised by its shape), so a contiguous-literal regex —
// the weakness these replace — is not involved.
// ---------------------------------------------------------------------------

const APP_SOURCE_DIRS = ["app", "components", "lib", "scripts"];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|mjs)$/;

function appSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of APP_SOURCE_DIRS) {
    for (const f of walk(resolve(repo, dir))) {
      if (SOURCE_EXT.test(f)) out.push(f);
    }
  }
  return out;
}

/**
 * Extract every module specifier a source file imports or requires, resolving
 * adjacent string-literal concatenation so a constructed path such as
 * `require("@/config/" + "narratives-v1.0" + ".json")` is seen as one path.
 */
function importedSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  const siteRe = /\b(?:from|import|require)\b\s*(?:\(\s*)?/g;
  const concatRe =
    /^(?:`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(?:\s*\+\s*(?:`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))*/;
  let m: RegExpExecArray | null;
  while ((m = siteRe.exec(code))) {
    const rest = code.slice(siteRe.lastIndex);
    const cm = concatRe.exec(rest);
    if (!cm) continue;
    const expr = cm[0];
    const litRe = /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
    let result = "";
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(expr))) {
      const raw = lm[0];
      const inner = raw.slice(1, -1);
      result +=
        raw[0] === "`" ? inner.replace(/\\(.)/g, "$1") : inner.replace(/\\(['"\\])/g, "$1");
    }
    out.push(result);
  }
  return out;
}

/** Resolve a module specifier against the file that imports it. */
function resolveSpecifier(specifier: string, fromFile: string): string {
  if (specifier.startsWith("@/")) return resolve(repo, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(fromFile), specifier);
  return resolve(repo, "node_modules", specifier); // bare package specifier
}

/**
 * Classify a file under config/ as the narrative or connection library, by
 * CONTENT rather than by filename. Returns null for everything else.
 */
function configKind(absPath: string): "narrative" | "connection" | null {
  const rel = relative(repo, absPath);
  if (rel.startsWith("..")) return null; // outside the repo
  if (!rel.replaceAll("\\", "/").startsWith("config/")) return null;
  if (!rel.endsWith(".json")) return null;

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const isNarrative =
    typeof obj.signal_states === "object" &&
    obj.signal_states !== null &&
    typeof obj.special_signal_states === "object" &&
    obj.special_signal_states !== null;
  if (isNarrative) return "narrative";

  const isConnection =
    !("signal_states" in obj) &&
    Object.values(obj).some((v) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
      const e = v as Record<string, unknown>;
      return typeof e.headline === "string" && typeof e.body === "string";
    });
  if (isConnection) return "connection";

  return null;
}

/** Sorted repo-relative paths of every app file importing the given config. */
function findConfigImporters(kind: "narrative" | "connection"): string[] {
  const importers = new Set<string>();
  for (const file of appSourceFiles()) {
    const src = readFileSync(file, "utf8");
    for (const spec of importedSpecifiers(src)) {
      if (configKind(resolveSpecifier(spec, file)) === kind) {
        importers.add(relative(repo, file).replaceAll("\\", "/"));
      }
    }
  }
  return [...importers].sort();
}

// ---------------------------------------------------------------------------
// A representative, fully-populated payload (the same keys the web consumes,
// plus the richer modules the PDF will).
// ---------------------------------------------------------------------------

function signal(
  signal: string,
  state: PayloadSignal["state"],
  narrativeKey: string | null,
  specialState: string | null = null,
): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState,
    displayState: specialState ?? state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function makePayload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    versions: {
      assessment: "1.0",
      questionBank: "1.0",
      scoring: "1.0",
      narrative: "1.0",
      report: "1.0",
      interstitial: "1.0",
      instrument: "1.0",
      scoringEngine: "1.0",
      narrativeLibrary: "1.0",
      snapshotSchema: "1.1",
    },
    signals: [
      signal("SEE", "S2", "signal_states.SEE.S2"),
      signal("ROOM", "S1", "signal_states.ROOM.S1"),
      signal("DIRECT", "S3", "special_signal_states.DIRECT_CAPACITY_LIMITED", "DIRECT_CAPACITY_LIMITED"),
      signal("PREPARE", "S4", "signal_states.PREPARE.S4"),
      signal("AIM", "S3", "signal_states.AIM.S3"),
      signal("MOVE", "S5", "signal_states.MOVE.S5"),
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: [
        "signal_states.MOVE.S5",
        "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
        "attention_areas.SEE_IT_MORE_CLEARLY",
      ],
    },
    strengths: [
      { source: "signal", code: "MOVE", narrativeKey: "signal_states.MOVE.S5" },
    ],
    frictions: [
      {
        source: "tension",
        code: "HIGH_ACTIVITY_LOW_DIRECTION",
        narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
      },
    ],
    connections: [
      { code: "HIGH_ACTIVITY_LOW_DIRECTION", narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION" },
      { code: "HIGH_INFORMATION_LOW_ACTION", narrativeKey: "connection_statements.HIGH_INFORMATION_LOW_ACTION" },
    ],
    context: [
      { code: "OPEN_MONEY_ENVIRONMENT", narrativeKey: "context_narratives.OPEN_MONEY_ENVIRONMENT" },
    ],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 1 & 2: source-level single-entry-point + one-implementation guards
// ---------------------------------------------------------------------------

describe("the web results page and snapshot components resolve copy through one module", () => {
  it("the page imports the shared section model from lib/render/snapshot-sections, nowhere else", () => {
    const page = read("app/(public)/snapshot/[sessionId]/page.tsx");
    expect(page).toMatch(/from\s+"@\/lib\/render\/snapshot-sections"/);
    // The page resolves the WHOLE payload through the single entry point
    // `resolveSnapshotContent` — which internally runs resolveSnapshotView ->
    // resolveSnapshotSections (the only copy-resolution path). A page that
    // called the resolver primitives directly, or grew its own lookup, would be
    // a second resolution path.
    expect(
      page,
      "the page must import resolveSnapshotContent from the shared section model",
    ).toMatch(
      /import\s*\{[^}]*\bresolveSnapshotContent\b[^}]*\}\s*from\s*"@\/lib\/render\/snapshot-sections"/,
    );
    // No import of either legacy resolver remains.
    expect(page).not.toMatch(/@\/lib\/ui\/narratives/);
    expect(page).not.toMatch(/@\/lib\/assessment\/narratives/);
  });

  it("no components/snapshot/* file imports a copy resolver from a legacy module", () => {
    for (const file of walk(resolve(repo, "components/snapshot"))) {
      const src = readFileSync(file, "utf8");
      const rel = relative(repo, file);
      expect(src, `${rel} must not import lib/ui/narratives`).not.toMatch(/@\/lib\/ui\/narratives/);
      expect(src, `${rel} must not import lib/assessment/narratives`).not.toMatch(
        /@\/lib\/assessment\/narratives/,
      );
    }
  });

  it("lib/ui/narratives.ts is a pure re-export shim — no independent lookup", () => {
    const ui = read("lib/ui/narratives.ts");
    expect(ui).toContain('from "@/lib/render/snapshot-view"');
    // No independent key→copy logic: no config import, no function/const/arrow
    // definition, no require, no signal vocabulary. The file must define
    // NOTHING of its own — a later "convenience" one-arg resolver would be a
    // second resolution path and must fail here.
    const code = stripComments(ui);
    expect(code).not.toMatch(/import\s+.*config\/narratives-v1\.0\.json/);
    expect(code).not.toMatch(/import\s+.*config\/connection-statements-v1\.0\.json/);
    expect(code).not.toMatch(/\bfunction\b/);
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/\b(?:const|let|var)\s+\w+\s*=/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/signal_states/);
  });

  it("the shim's export surface is exactly the four delegating re-exports", () => {
    // Pin the actual BEHAVIOUR, not just "the string resolveNarrative must not
    // appear". The shim may re-export exactly four unchanged one-arg names from
    // the shared resolver, and nothing else — no one-arg alias of
    // resolveSignalRow, no newly-added convenience resolver, no default export.
    const code = stripComments(read("lib/ui/narratives.ts"));
    const valueBlock = code.match(
      /export\s*\{([^}]*)\}\s*from\s*"@\/lib\/render\/snapshot-view"\s*;/,
    );
    expect(valueBlock, "the shim must re-export from the shared resolver").not.toBeNull();
    const names = valueBlock![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(names.sort()).toEqual(
      ["isSpecialState", "resolveAttentionArea", "resolveConnection", "signalLabel"].sort(),
    );
    // No other value export form of any kind (function/const/let/var/class/default).
    expect(code).not.toMatch(/\bexport\s+(?:default|function|const|let|var|class)\b/);
    // The broken one-arg alias must not exist under any name.
    expect(code).not.toMatch(/\bresolveNarrative\b/);
  });

  it("the narrative and connection configs have exactly one owner (resolver-ownership)", () => {
    // §5 resolver-OWNERSHIP (bypasses 4 & 5). The pinned narrative and
    // connection libraries may be imported — by ESM import, re-export, dynamic
    // import, or require, with a literal, aliased, or constructed path — ONLY by
    // the allowlisted modules below. Detection RESOLVES the import path (so a
    // `@/config/…` alias or a split-string require still resolves to the real
    // file) and matches the config by CONTENT (so a copied library under a new
    // filename, e.g. config/narratives-latest.json, is still recognised). A new
    // importer is a second key→copy path and fails even while it currently
    // agrees with the shared resolver.
    //
    // The allowlist's non-resolver entries are type/validation uses, not copy
    // resolvers: lib/assessment/types.ts derives `keyof` unions from the
    // library, and lib/assessment/tensions.ts checks that a tension code is a
    // member of the connection library. Neither emits participant-facing copy.
    expect(findConfigImporters("narrative")).toEqual([
      "lib/assessment/types.ts",
      "lib/render/snapshot-view.ts",
    ]);
    expect(findConfigImporters("connection")).toEqual([
      "lib/assessment/tensions.ts",
      "lib/assessment/types.ts",
      "lib/render/snapshot-view.ts",
    ]);
  });

  it("lib/assessment/narratives.ts no longer defines the dormant copy-resolvers", () => {
    const assessment = read("lib/assessment/narratives.ts");
    for (const name of [
      "resolveNarrative",
      "resolveSignalState",
      "resolveSpecialSignalState",
      "resolveConnectionStatement",
      "resolveAttentionArea",
      "resolveContextNarrative",
      "resolvePerceptionGap",
      "resolveActivationCopy",
      "assembleBigPicture",
    ]) {
      expect(
        assessment,
        `lib/assessment/narratives.ts must not define ${name}`,
      ).not.toMatch(new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`));
    }
  });
});

// ---------------------------------------------------------------------------
// Property 10: content-hash pin (F1) — a config edit must be a deliberate act
// ---------------------------------------------------------------------------

// The golden hashes for the two participant-facing copy libraries. There is no
// golden artifact file for these; the hash IS the golden artifact. Changing
// approved copy therefore requires updating the hash AND the approved library
// document together — an explicit, reviewable act, not a silent in-place edit.
// Follows the contentHash convention in lib/assessment/versions.ts (sha256 over
// the canonical, sorted-key serialisation), so reformatting does not move the
// hash — only a CONTENT change does.
//
// MOVED 2026-10-05 (operator-approved re-issue, narrative library 1.0 -> 1.0.1):
// four activation bands (A1.LOW, A2.LOW, A4.LOW, A4.HIGH) had internal /
// methodology language removed from their second sentence. The approved library
// MD was updated in the same act, and both were verified byte-identical across
// all 12 activation bands. This is the deliberate, reviewable act this pin
// exists to force — not a bypass of it. The connection library hash is unmoved.
//
// MOVED 2026-10-07 (Owner narrative-rewrite standard; narrative + connection
// libraries 1.0.1/1.0 -> 2.0.0): STRUCTURAL, not just copy — signal_states
// copy became a three-voice confidence variant, activation bands became
// {stateLabel, body[]}, attention_areas gained short_label with paragraph
// bodies, dead big_picture_templates became the keyed big_picture synthesis
// family, and section_intros / destination / evidence_openers were added
// (the retired DRAFT web-copy constants moved into the governed source). The
// connection library gained the connection {headline, framing} sub-object.
// _version_note in each config records the full rationale; both hashes were
// recomputed with contentHash's canonical algorithm (verified reproducible
// against both pre-move pins). Golden fixture: an Owner walkthrough session
// (session id redacted), 2026-10-07. The approved-library MDs follow in the same revision
// (Phase 5 close-out).
//
// MOVED 2026-10-07 (Phase 3 copy authoring): the 2.0.0 families moved from
// scaffolded old copy to the Owner's authored standard — 90 confidence-voice
// signal copies + signal_strengths framings, all 18 connection entries
// (friction title/body + connection headline/framing), the big_picture
// synthesis family, section_intros, activation bodies, attention bodies, and
// the compositional destination family (theme_clauses). Same reviewable act:
// hash + approved-library MD move together in Phase 5.
//
// MOVED 2026-10-08 (security redaction): the narratives _version_note's
// provenance line no longer names the live walkthrough session id; the
// redaction removed that identifier from the config's metadata only. No
// participant-facing copy, key, or behaviour changed — the connection library
// hash is unmoved. Hash recomputed with contentHash's canonical algorithm
// (verified reproducible against the pre-redaction pin). Provenance is intact
// as a DESCRIPTION (an Owner walkthrough session on 2026-10-07); only the id
// was withdrawn. The approved-library MDs are historical, unedited archives
// unaffected by this change.
const PINNED_NARRATIVES_HASH = "d094398a7381b2f4584979f4800cafb7c07c3a1e825a87030f877c16f06d8c94";
const PINNED_CONNECTION_HASH = "a66978227eaca0820de270772cbb0d1ff5c99ad4d53aff62bb05eec42e00c7ff";

describe("the narrative and connection libraries are PINNED by content hash", () => {
  it("config/narratives-v1.0.json matches its pinned hash", () => {
    // F1: the differential's independent oracle derives expectations from this
    // file, so an in-place copy edit propagates through the resolver and leaves
    // every render test green — the mutation F1 closes. The hash cannot lie:
    // it is derived from the bytes, so any content edit changes it.
    const narratives = JSON.parse(read("config/narratives-v1.0.json"));
    expect(
      contentHash(narratives),
      "narratives-v1.0.json content changed without updating its pinned hash",
    ).toBe(PINNED_NARRATIVES_HASH);
  });

  it("config/connection-statements-v1.0.json matches its pinned hash", () => {
    const connection = JSON.parse(read("config/connection-statements-v1.0.json"));
    expect(
      contentHash(connection),
      "connection-statements-v1.0.json content changed without updating its pinned hash",
    ).toBe(PINNED_CONNECTION_HASH);
  });
});

// ---------------------------------------------------------------------------
// Property 11: no hardcoded second copy (F3)
// ---------------------------------------------------------------------------

/**
 * The participant-facing narrative/connection/attention strings that must live
 * ONLY in the pinned config libraries. Read from the configs, so a hardcoded
 * second copy that currently AGREES with the config is still recognised as a
 * literal and flagged. Strengthened 2026-10-07 for the 2.0.0 restructure: walks
 * every NEW family too (three-voice signal variants, activation state labels,
 * big_picture synthesis, section_intros, destination framing/syntheses,
 * evidence_openers, connection sub-object, attention short labels) so the new
 * strings cannot be inlined into source either (plan F3 note).
 */
function approvedCopyStrings(): string[] {
  const narratives = JSON.parse(read("config/narratives-v1.0.json")) as Record<string, unknown>;
  const connection = JSON.parse(read("config/connection-statements-v1.0.json")) as Record<
    string,
    Record<string, unknown>
  >;

  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim().length > 0) out.push(v);
  };
  /**
   * Walk only the COPY-BEARING fields of an entry. A blind recursive walk
   * would also collect internal metadata (`attention_area` keys, `source`
   * question lists) and the `evidence_openers` vocabulary fragments — strings
   * that legitimately appear as code identifiers or in ordinary UI prose, and
   * whose presence in source is not a second copy path. The 2026-10-07 first
   * run of the broad version flagged exactly those false positives.
   */
  // `short_label` is DELIBERATELY not here: it is a short structural label
  // ("VISIBILITY", "RESILIENCE") whose substring appears inside internal
  // tension codes (HIGH_VISIBILITY_LOW_CAPACITY, …_LOW_RESILIENCE) in engine
  // source — flagging those would be a false positive, not a second copy path.
  // The rendered composed string ("KEEP IN VIEW — …") is covered by the
  // membership guards instead.
  const COPY_FIELDS = [
    "label",
    "copy",
    "body",
    "headline",
    "stateLabel",
    "framing",
    "intro",
    "outro",
  ];
  const walkEntry = (entry: unknown): void => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const e = entry as Record<string, unknown>;
    for (const field of COPY_FIELDS) {
      const v = e[field];
      if (typeof v === "string") push(v);
      else if (Array.isArray(v)) v.forEach((p) => typeof p === "string" && push(p));
      else if (v && typeof v === "object") {
        Object.values(v).forEach((p) => typeof p === "string" && push(p));
      }
    }
  };
  /**
   * A family is either `{key: leaf}` or `{key: {subkey: leaf}}` (and, for
   * section_intros, `{key: string[]}`). Handle all three shapes without ever
   * descending into metadata fields.
   */
  const walkFamily = (family: unknown): void => {
    if (!family || typeof family !== "object" || Array.isArray(family)) return;
    for (const v of Object.values(family as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        v.forEach((p) => typeof p === "string" && push(p));
      } else if (v && typeof v === "object") {
        const e = v as Record<string, unknown>;
        const isLeaf = COPY_FIELDS.some((f) => f in e);
        if (isLeaf) walkEntry(v);
        else
          for (const leaf of Object.values(e)) {
            if (Array.isArray(leaf)) leaf.forEach((p) => typeof p === "string" && push(p));
            else walkEntry(leaf);
          }
      }
    }
  };

  walkFamily(narratives.signal_states);
  walkFamily(narratives.special_signal_states);
  walkFamily(narratives.attention_areas);
  walkFamily(narratives.activation);
  walkFamily(narratives.big_picture);
  walkFamily(narratives.section_intros);
  walkFamily(narratives.destination);
  for (const key of Object.keys(connection)) {
    if (["version", "_version_note"].includes(key)) continue;
    walkEntry(connection[key]);
    const sub = (connection[key] as Record<string, unknown>).connection;
    if (sub && typeof sub === "object") walkEntry(sub);
  }
  // Longest first, so a longer body that embeds a shorter one reports clearly;
  // ignore trivially-short strings that would collide with everyday source.
  return [...new Set(out)].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length);
}

/**
 * Every app/components/lib source file (comments stripped) that contains an
 * approved copy string as a LITERAL, excluding the resolver, the re-export shim,
 * and the allowlisted config importers. A non-empty result is a hardcoded second
 * copy — a second resolution path that bypasses lib/render/snapshot-view.ts.
 */
function hardcodedCopyOffenders(): string[] {
  const strings = approvedCopyStrings();

  const excluded = new Set([
    ...findConfigImporters("narrative"),
    ...findConfigImporters("connection"),
    "lib/ui/narratives.ts", // re-export shim, part of the resolution surface
    // Fixed-by-ruling DOCUMENT FURNITURE (owner rulings 2026-10-02), not a
    // second narrative/connection copy. Its cover/footer/disclosure strings are
    // not narrative library strings, but its personalization prefix "Prepared
    // for" happens to embed the signal-state LABEL "Prepared" (PREPARE.S4), so
    // the blunt substring scan would false-positive on it. Excluding this module
    // is scoping the guard to what it protects — narrative/connection/attention
    // copy — not exempting a real second copy. The strings this module holds are
    // guarded for exactness in tests/integration/snapshot-pdf-copy.test.ts.
    "lib/ui/snapshot-doc-copy.ts",
  ]);

  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(resolve(repo, dir))) {
      const rel = relative(repo, file).replaceAll("\\", "/");
      if (excluded.has(rel)) continue;
      // Skip files that are not UTF-8 text (images, fonts, compiled caches) and
      // the lockfile-like artifacts a build might leave behind; everything else —
      // including .json and .css — is scanned. Scanning ONLY source extensions
      // was a hole: a second copy map stored as lib/copy.json, read by a second
      // route, is a hardcoded second copy that imports no config and contains no
      // .ts literal, so it escaped both this scan and the ownership check
      // (adversarial finding NB1). Data files carry copy just as code does.
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (raw.includes("\u0000")) continue; // binary
      const code = SOURCE_EXT.test(file) ? stripComments(raw) : raw;
      for (const s of strings) {
        if (code.includes(s)) {
          offenders.push(`${rel}: ${JSON.stringify(s.slice(0, 80))}`);
          break; // report once per file
        }
      }
    }
  }
  return offenders.sort();
}

describe("no participant-facing narrative copy is hardcoded in application source", () => {
  it("no approved copy string appears as a literal in app/components/lib (resolver + loaders excluded)", () => {
    // F3: the single-source ownership check only detects IMPORTS of the config
    // files; a second renderer with an inline copy map imports nothing. That
    // hardcoded second copy is caught here, whether or not it currently agrees
    // with the config. Comments are stripped so a prose mention in a comment is
    // not a hit — only an actual code literal is.
    expect(hardcodedCopyOffenders(), "hardcoded second copy found").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property 3: the resolver cannot recompute
// ---------------------------------------------------------------------------

describe("the shared resolver is pure and cannot recompute", () => {
  it("its source imports none of the scoring/tension/classifier/db/session machinery", () => {
    // Scan the CODE, not the prose comments (which legitimately name the things
    // the resolver must NOT import). A real import is not a comment, so a
    // mutation that adds one still fails here.
    const src = stripComments(read("lib/render/snapshot-view.ts"));
    for (const forbidden of [
      "session/service",
      "assessment/scoring",
      "assessment/tensions",
      "assessment/classifiers",
      "db/client",
      "db/index",
      "db/http",
    ]) {
      expect(src, `snapshot-view.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
    // No read-time scoring, no time/randomness: same payload => same view.
    expect(src).not.toMatch(/\bscoreAssessment\b/);
    expect(src).not.toMatch(/\bevaluateTensions\b/);
    expect(src).not.toMatch(/Date\.now/);
    expect(src).not.toMatch(/Math\.random/);
  });
});

/** Remove `//` and `/* *​/` comments so source guards read code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Properties 4–8: behavioural properties of the resolved view
// ---------------------------------------------------------------------------

describe("the resolved view preserves capacity protections", () => {
  it("a special_signal_states.* key resolves to its off-ladder copy, isCapacity true", () => {
    const row = resolveSignalRow("DIRECT", "special_signal_states.DIRECT_CAPACITY_LIMITED");
    expect(row).not.toBeNull();
    expect(row!.isCapacity).toBe(true);
    expect(row!.label).toBe("Intentional — Capacity Constrained");
    expect(row!.copy).toContain("intentional decisions rather than a lack of intentionality");
    // Never the S-ladder copy, never a raw code.
    expect(row!.copy).not.toMatch(/DIRECT_CAPACITY_LIMITED/);
    expect(row!.copy).not.toMatch(/S3|S[1-5]\b/);
  });

  it("a plain ladder state is NOT marked as capacity", () => {
    const row = resolveSignalRow("SEE", "signal_states.SEE.S2");
    expect(row).not.toBeNull();
    expect(row!.isCapacity).toBe(false);
    expect(row!.label).toBe("Some Important Gaps");
  });
});

describe("null finding is preserved without fabricating a friction", () => {
  it("nullFinding:true resolves no friction copy and points at KEEP_OBSERVING", () => {
    const payload = makePayload({
      nullFinding: true,
      frictions: [],
      attentionAreas: ["KEEP_OBSERVING"],
      connections: [],
    });
    const view = resolveSnapshotView(payload);
    expect(view.frictions).toEqual([]);
    expect(view.primaryAttentionArea?.label).toBe("KEEP OBSERVING WHAT IS WORKING");
  });
});

describe("tension precedence comes from the payload, never re-derived", () => {
  it("connections resolve primary-then-secondary and the primary attention area is attentionAreas[0]", () => {
    const payload = makePayload({});
    const view = resolveSnapshotView(payload);
    expect(view.connections.map((c) => c.headline)).toEqual([
      "A Lot Is Happening. The Destination Needs More Say.",
      "You Have the Information. The Bridge to Action Is Missing.",
    ]);
    expect(view.primaryAttentionArea?.label).toBe("SEE IT MORE CLEARLY");
    expect(view.secondaryAttentionArea).toBeNull();
  });
});

describe("no internal vocabulary reaches a resolved prose string (§24)", () => {
  function proseStrings(view: ReturnType<typeof resolveSnapshotView>): string[] {
    const out: string[] = [];
    for (const s of view.signals) out.push(s.question, s.label, s.copy);
    for (const c of view.connections) {
      out.push(c.headline, c.body, c.connectionHeadline, ...c.connectionFraming);
    }
    for (const a of [view.primaryAttentionArea, view.secondaryAttentionArea]) {
      if (a) out.push(a.label, a.shortLabel, ...a.paragraphs);
    }
    if (view.bigPicture) out.push(view.bigPicture.headline, ...view.bigPicture.body);
    for (const f of [...view.strengths, ...view.frictions]) out.push(f.label, f.copy);
    out.push(...view.context);
    if (view.perceptionGap) out.push(view.perceptionGap.label, view.perceptionGap.body);
    out.push(...view.activation.flatMap((a) => [a.label, a.dimension, ...a.paragraphs]));
    out.push(...view.destinationThemes.map((d) => d.label));
    for (const paras of Object.values(view.sectionIntros)) out.push(...paras);
    out.push(...view.destinationFrame.intro, ...view.destinationFrame.outro);
    return out;
  }

  it("no dotted key prefix, special-state code, or tension code appears in prose", () => {
    const specials = Object.keys(
      JSON.parse(read("config/narratives-v1.0.json")).special_signal_states,
    );
    const tensions = Object.keys(
      JSON.parse(read("config/connection-statements-v1.0.json")),
    ).filter((k) => !["version", "_version_note", "_prd_section", "_notes"].includes(k));

    const forbidden = [
      "signal_states.",
      "special_signal_states.",
      "connection_statements.",
      "context_narratives.",
      "perception_gap.",
      "attention_areas.",
      "activation.",
      ...specials,
      ...tensions,
    ];

    const view = resolveSnapshotView(makePayload({}));
    const offenders = proseStrings(view).filter((s) =>
      forbidden.some((token) => s.includes(token)),
    );
    expect(offenders, "internal vocabulary leaked into a resolved string").toEqual([]);
  });
});

describe("module completeness is a pure function of the payload", () => {
  it("every populated module resolves, and perceptionGap is null unless finalized", () => {
    const view = resolveSnapshotView(makePayload({}));
    expect(view.signals).toHaveLength(6);
    expect(view.connections).toHaveLength(2);
    expect(view.bigPicture?.template).toBe("PRIMARY_FRICTION");
    // The synthesis entry (template × primary attention area, defaulting to
    // the template's `default`) — never the borrowed `parts`.
    expect(view.bigPicture?.headline.length).toBeGreaterThan(0);
    expect(view.bigPicture?.body.length).toBeGreaterThan(0);
    expect(view.strengths).toHaveLength(1);
    expect(view.frictions).toHaveLength(1);
    expect(view.context).toHaveLength(1);
    expect(view.activation).toHaveLength(4);
    expect(view.perceptionGap).toBeNull();
    expect(view.perceptionGapStatus).toBe("not_ready");
    expect(view.destinationThemes).toEqual([
      { code: "Q16_A", label: "Not constantly worrying about money" },
      { code: "Q16_D", label: "Having savings and being prepared for the unexpected" },
    ]);
  });

  it("a finalized perception gap resolves, and each activation dimension is separate", () => {
    const view = resolveSnapshotView(
      makePayload({
        perceptionGapStatus: "finalized",
        perceptionGap: {
          code: "PERCEPTION_ALIGNED",
          narrativeKey: "perception_gap.PERCEPTION_ALIGNED",
        },
      }),
    );
    expect(view.perceptionGap).toEqual({
      label: "Your Starting View Was Largely Aligned",
      body: "How financially Set for Life you felt at the beginning appears broadly consistent with the patterns that showed up across the assessment.",
    });
    expect(view.activation.map((a) => `${a.item}=${a.level}`)).toEqual([
      "A1=HIGH",
      "A2=MID",
      "A3=LOW",
      "A4=HIGH",
    ]);
    // Four separate dimensions, each with its own state label + paragraphs.
    expect(view.activation).toHaveLength(4);
    for (const a of view.activation) {
      expect(a.label.length, `${a.item} state label`).toBeGreaterThan(0);
      expect(a.paragraphs.length, `${a.item} paragraphs`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 9: identity — evidence toward "render identically"; for one payload,
// the resolver's output equals the pinned libraries. Not a proof that the web
// and a future PDF render identically.
// ---------------------------------------------------------------------------

describe("the migration changed no copy (identity against the pinned libraries)", () => {
  it("signals/connections/primaryAttentionArea deep-equal the config libraries", () => {
    // The expected values are derived from the PINNED config libraries — the
    // independent source of truth — NOT copied out of the implementation. A
    // "golden object" captured from the pre-refactor helpers was claimed in the
    // implementation report but no such artifact exists in the repo, and the
    // previous version of this test hardcoded strings that had been transcribed
    // from the NEW implementation, so a copy edit that changed both old and new
    // would not fail it. Deriving from config means the resolver is measured
    // against an authority it does not itself supply.
    const payload = makePayload({});
    const view = resolveSnapshotView(payload);

    const narratives = JSON.parse(read("config/narratives-v1.0.json")) as {
      signal_states: Record<
        string,
        Record<string, { label: string; copy: string | { high: string; moderate: string; limited: string } }>
      >;
      special_signal_states: Record<string, { label: string; copy: string }>;
      attention_areas: Record<string, { label: string; short_label?: string; body: string[] }>;
    };
    const connectionStatements = JSON.parse(
      read("config/connection-statements-v1.0.json"),
    ) as Record<
      string,
      { headline: string; body: string; connection?: { headline?: string; framing?: string[] } }
    >;

    const questionFor = Object.fromEntries(
      HUMAN_QUESTIONS.map((q) => [q.signal, q.question]),
    );

    const expectedSignal = (signal: string, narrativeKey: string) => {
      const parts = narrativeKey.split(".");
      const stateCopy =
        parts[0] === "signal_states"
          ? narratives.signal_states[parts[1]][parts[2]]
          : parts[0] === "special_signal_states"
            ? narratives.special_signal_states[parts[1]]
            : null;
      if (!stateCopy) throw new Error(`unexpected narrative key: ${narrativeKey}`);
      // Ladder copy is a three-voice variant; select the voice the PAYLOAD
      // carries (absent evidence → limited, the legacy rule) — exactly what
      // the resolver does.
      const payloadSignal = payload.signals.find((s) => s.signal === signal);
      const voice =
        payloadSignal && payloadSignal.evidence.confidence !== "high" &&
        payloadSignal.evidence.confidence !== "moderate" &&
        payloadSignal.evidence.confidence !== "limited"
          ? "limited"
          : payloadSignal
            ? payloadSignal.evidence.confidence
            : "limited";
      const copy =
        typeof stateCopy.copy === "object"
          ? stateCopy.copy[voice]
          : stateCopy.copy;
      return {
        signal,
        question: questionFor[signal],
        label: stateCopy.label,
        copy,
        isCapacity: narrativeKey.startsWith("special_signal_states."),
      };
    };

    expect(view.signals).toEqual(
      payload.signals.map((s) => expectedSignal(s.signal, s.narrativeKey!)),
    );

    const findingCodes = new Set(
      [...payload.frictions, ...payload.strengths].map((f) => f.code),
    );
    expect(view.connections).toEqual(
      payload.connections.map((c) => {
        const entry = connectionStatements[c.code];
        if (!entry) throw new Error(`unexpected connection code: ${c.code}`);
        return {
          headline: entry.headline,
          body: entry.body,
          connectionHeadline: entry.connection?.headline ?? entry.headline,
          connectionFraming: entry.connection?.framing ?? [],
          bodyRenderedElsewhere: findingCodes.has(c.code),
        };
      }),
    );

    const attention = narratives.attention_areas[payload.attentionAreas[0]];
    expect(view.primaryAttentionArea).toEqual({
      label: attention.label,
      shortLabel: attention.short_label ?? attention.label,
      paragraphs: attention.body,
    });
  });

  it("the low-level primitives agree with resolveSnapshotView (one implementation)", () => {
    const view = resolveSnapshotView(makePayload({}));
    // The page resolves through the primitives; they must be the same code path.
    // The confidence voice is passed explicitly: the fixture's signals carry
    // evidence "high", and the primitive's default (key-existence representative)
    // is deliberately different from any render-time selection.
    expect(resolveSignalRow("SEE", "signal_states.SEE.S2", "high")).toEqual(view.signals[0]);
    expect(signalLabel("SEE")).toBe(signalQuestionLabel("SEE"));
    expect(signalQuestionLabel("SEE")).toBe("WHAT CAN YOU SEE?");
    expect(isSpecialState("special_signal_states.DIRECT_CAPACITY_LIMITED")).toBe(true);
    expect(isSpecialState("signal_states.SEE.S2")).toBe(false);
  });
});
