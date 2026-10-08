/**
 * Copy-library consistency guard — Set for Life Financial Assessment (MVP v1.0).
 *
 * WHAT: regression guard for the APPROVED, LOCKED participant-facing language
 * libraries. Fails loudly (non-zero exit) if anyone edits a library and breaks
 * referential integrity.
 *
 * CHECKS (each reported PASS/FAIL):
 *  1a. every tension code in narratives-v1.0.json -> connection_statements has
 *      a matching entry in connection-statements-v1.0.json
 *  1b. vice-versa (standalone -> embedded) — bidirectional
 *  2.  every signal in the vocabulary has S1–S5 (checked on BOTH the
 *      standalone vocabulary AND narratives.signal_states)
 *  3.  all 3 special signal states exist in BOTH narratives-v1.0.json
 *      (special_signal_states) and signal-state-vocabulary-v1.0.json (SPECIAL)
 *  4.  every attention_area referenced as a default by a signal state or
 *      connection statement exists in narratives-v1.0.json -> attention_areas
 *      (orphan references reported by key)
 *  5a. MD vs JSON: Connection Statement Library MD key set == standalone JSON
 *  5b. MD vs JSON: Signal-State Vocabulary MD (signals x S1-S5 + SPECIAL keys)
 *      == vocabulary JSON
 *  5c. MD vs JSON: Narrative Library MD (context / perception-gap / activation /
 *      attention-area / big-picture-template keys) == narratives JSON
 *  6.  2.0.0 FAMILY COMPLETENESS + NON-EMPTY (Phase 5 hardening): section_intros,
 *      big_picture (default + headline/body on every node), evidence_openers
 *      (>=3 distinct per level), attention short_label + body, connection
 *      {headline, framing}, destination theme_clauses (all 11 Q16 codes) +
 *      lede/tail, activation {stateLabel, body} on all 12 bands — every string
 *      non-empty, and the approved MDs carry the matching 2.0.0 sections. The
 *      historical failure mode this closes: a parse that succeeds VACUOUSLY
 *      (missing heading -> empty section -> empty==empty) passing on absence.
 *  7.  Version agreement: config `version` 2.0.x and every MD Version line 2.0.0.
 *
 * RUN: node tests/unit/copy-library-consistency.mjs
 * (Plain Node — no test runner is set up in this repo yet. When a runner
 *  lands, wrap this file or invoke it from a test; the exit-code contract
 *  stays the same: 0 = all PASS, 1 = any FAIL.)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const configDir = join(repoRoot, "config");
// Env-overridable so the guard can run against a staged copy of the approved
// libraries (plan Phase 5) — the operator default is the real Downloads dir.
const downloadsDir = process.env.COPY_LIBRARY_DIR || "/Users/erspaulding/Downloads";

const NARRATIVES_JSON = join(configDir, "narratives-v1.0.json");
const CONNECTION_JSON = join(configDir, "connection-statements-v1.0.json");
const VOCAB_JSON = join(configDir, "signal-state-vocabulary-v1.0.json");

const NARRATIVE_MD = join(
  downloadsDir,
  "Set_for_Life_Approved_Narrative_Library_FINAL_v1.0.md",
);
const CONNECTION_MD = join(
  downloadsDir,
  "Set_for_Life_Connection_Statement_Library_FINAL_v1.0.md",
);
const VOCAB_MD = join(
  downloadsDir,
  "Set_for_Life_Signal_State_Vocabulary_FINAL_v1.0.md",
);

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"];
const LEVELS = ["S1", "S2", "S3", "S4", "S5"];
const SPECIAL_KEYS = [
  "DIRECT_CAPACITY_LIMITED",
  "DIRECT_LIMITED_EVIDENCE_CAPACITY",
  "AIM_CAPACITY_CONSTRAINED_ALIGNMENT",
];

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Metadata keys, excluded from COPY-equality comparisons.
 *
 * These describe the artifact rather than being copy a participant reads, so a
 * standalone library and its embedded copy are not required to agree on them.
 *
 * Added 2026-10-01 when `version` and `_version_note` were introduced for the
 * Snapshot version architecture: the standalone connection-statements library
 * declares its own version, the embedded copy inside narratives does not need
 * to duplicate it, and this check failed on the difference. The check is about
 * whether the COPY agrees, so metadata is filtered rather than the fields being
 * removed — dropping them would have meant no version on the standalone library,
 * which is the artifact that needs one.
 */
const METADATA_KEYS = new Set(["version", "_version_note"]);

function sortedKeys(obj) {
  // Cast to array: .filter works on both, but Object.keys returns string[] and
  // the callers compare these arrays directly.
  return Object.keys(obj ?? {})
    .filter((k) => !METADATA_KEYS.has(k) && !k.startsWith("_"))
    .sort();
}

function setEq(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function diff(a, b) {
  const bs = new Set(b);
  return a.filter((k) => !bs.has(k));
}

const narratives = JSON.parse(readFileSync(NARRATIVES_JSON, "utf8"));
const standalone = JSON.parse(readFileSync(CONNECTION_JSON, "utf8"));
const vocab = JSON.parse(readFileSync(VOCAB_JSON, "utf8"));

// ---- 1a / 1b: bidirectional tension-code coverage ----
const embeddedKeys = sortedKeys(narratives.connection_statements);
const standaloneKeys = sortedKeys(standalone);
check(
  "1a narratives.connection_statements -> standalone connection-statements",
  diff(embeddedKeys, standaloneKeys).length === 0,
  diff(embeddedKeys, standaloneKeys).length === 0
    ? `${embeddedKeys.length} keys all present`
    : `missing in standalone: ${diff(embeddedKeys, standaloneKeys).join(", ")}`,
);
check(
  "1b standalone connection-statements -> narratives.connection_statements",
  diff(standaloneKeys, embeddedKeys).length === 0,
  diff(standaloneKeys, embeddedKeys).length === 0
    ? `${standaloneKeys.length} keys all present`
    : `missing in narratives: ${diff(standaloneKeys, embeddedKeys).join(", ")}`,
);

// ---- 2: S1–S5 per signal, both JSON homes ----
for (const home of [
  ["narratives.signal_states", narratives.signal_states],
  ["vocabulary (top level)", vocab],
]) {
  const [label, obj] = home;
  const missingSignals = diff(SIGNALS, sortedKeys(obj));
  check(
    `2a all 6 signals present in ${label}`,
    missingSignals.length === 0,
    missingSignals.length === 0 ? SIGNALS.join(",") : `missing: ${missingSignals.join(", ")}`,
  );
  for (const s of SIGNALS) {
    const levels = sortedKeys(obj?.[s]);
    check(
      `2b ${label}.${s} has S1–S5`,
      setEq(levels, LEVELS),
      setEq(levels, LEVELS) ? "S1,S2,S3,S4,S5" : `found: ${levels.join(",") || "(missing signal)"}`,
    );
  }
}

// ---- 3: special states in both homes ----
const narrSpecial = sortedKeys(narratives.special_signal_states);
const vocabSpecial = sortedKeys(vocab.SPECIAL);
check(
  "3a narratives.special_signal_states has all 3 specials",
  setEq(narrSpecial, [...SPECIAL_KEYS].sort()),
  `found: ${narrSpecial.join(",")}`,
);
check(
  "3b vocabulary.SPECIAL has all 3 specials",
  setEq(vocabSpecial, [...SPECIAL_KEYS].sort()),
  `found: ${vocabSpecial.join(",")}`,
);

// ---- 4: attention_area orphan references ----
const definedAreas = new Set(sortedKeys(narratives.attention_areas));
const refs = new Map(); // area -> [referrers]
function ref(area, where) {
  if (!refs.has(area)) refs.set(area, []);
  refs.get(area).push(where);
}
for (const s of SIGNALS) {
  for (const l of LEVELS) {
    const e = narratives.signal_states?.[s]?.[l];
    if (e?.attention_area) ref(e.attention_area, `signal_states.${s}.${l}`);
  }
}
for (const [k, e] of Object.entries(narratives.connection_statements ?? {})) {
  if (e?.attention_area) ref(e.attention_area, `narratives.connection_statements.${k}`);
}
for (const [k, e] of Object.entries(standalone ?? {})) {
  if (e?.attention_area) ref(e.attention_area, `standalone.${k}`);
}
const orphans = [...refs.keys()].filter((k) => !definedAreas.has(k));
check(
  "4 every referenced attention_area exists in narratives.attention_areas",
  orphans.length === 0,
  orphans.length === 0
    ? `${refs.size} distinct refs resolve to ${definedAreas.size} defined areas`
    : `ORPHANS: ${orphans.map((k) => `${k} (from ${refs.get(k).join("; ")})`).join(" | ")}`,
);

// ---- 5: MD vs JSON key agreement ----
const narrativeMd = readFileSync(NARRATIVE_MD, "utf8");
const connectionMd = readFileSync(CONNECTION_MD, "utf8");
const vocabMd = readFileSync(VOCAB_MD, "utf8");

// 5a: connection MD `## \`KEY\`` headings vs standalone JSON
const connMdKeys = [
  ...connectionMd.matchAll(/^## `([A-Z0-9_]+)`/gm),
].map((m) => m[1]).sort();
check(
  "5a connection MD key set == standalone JSON key set",
  setEq(connMdKeys, standaloneKeys),
  setEq(connMdKeys, standaloneKeys)
    ? `${connMdKeys.length} keys agree`
    : `only-in-MD: ${diff(connMdKeys, standaloneKeys).join(", ") || "—"}; only-in-JSON: ${diff(standaloneKeys, connMdKeys).join(", ") || "—"}`,
);

// 5b: vocab MD — signals (## SEE …), levels (### S1 …), specials (### `KEY`)
const vocabMdSignals = [...vocabMd.matchAll(/^## ([A-Z]+) —/gm)].map((m) => m[1]).sort();
check(
  "5b-i vocab MD signals == JSON signals",
  setEq(vocabMdSignals, [...SIGNALS].sort()),
  `MD: ${vocabMdSignals.join(",")}`,
);
let levelsOk = true;
const levelProblems = [];
for (const s of SIGNALS) {
  const section = vocabMd.split(new RegExp(`^## ${s} —`, "m"))[1]?.split(/^## /m)[0] ?? "";
  const found = [...section.matchAll(/^### (S[1-5]) —/gm)].map((m) => m[1]).sort();
  if (!setEq(found, LEVELS)) {
    levelsOk = false;
    levelProblems.push(`${s}: ${found.join(",") || "none"}`);
  }
}
check("5b-ii vocab MD S1–S5 per signal", levelsOk, levelsOk ? "all 6 signals S1–S5" : levelProblems.join(" | "));
const vocabMdSpecial = [...vocabMd.matchAll(/^### `([A-Z_]+)` —/gm)].map((m) => m[1]).sort();
check(
  "5b-iii vocab MD specials == JSON SPECIAL",
  setEq(vocabMdSpecial, [...SPECIAL_KEYS].sort()),
  `MD: ${vocabMdSpecial.join(",")}`,
);

// 5c: narrative MD — context, perception-gap, activation, attention areas, templates
const mdSection = (md, heading) =>
  md.split(new RegExp(`^${heading}`, "m"))[1]?.split(/^## /m)[0] ?? "";
const ctxSection = mdSection(narrativeMd, "## Context narratives");
const ctxMd = [...ctxSection.matchAll(/^### `([A-Z_]+)`/gm)].map((m) => m[1]).sort();
const ctxJson = sortedKeys(narratives.context_narratives);
check(
  "5c-i narrative MD context keys == JSON context_narratives",
  setEq(ctxMd, ctxJson),
  setEq(ctxMd, ctxJson)
    ? `${ctxJson.length} keys agree`
    : `only-in-MD: ${diff(ctxMd, ctxJson).join(", ") || "—"}; only-in-JSON: ${diff(ctxJson, ctxMd).join(", ") || "—"}`,
);
const pgSection = mdSection(narrativeMd, "## Perception Gap");
const pgMd = [...pgSection.matchAll(/^### `([A-Z_]+)`/gm)].map((m) => m[1]).sort();
const pgJson = sortedKeys(narratives.perception_gap);
check(
  "5c-ii narrative MD perception-gap keys == JSON perception_gap",
  setEq(pgMd, pgJson),
  setEq(pgMd, pgJson)
    ? `${pgJson.length} keys agree`
    : `only-in-MD: ${diff(pgMd, pgJson).join(", ") || "—"}; only-in-JSON: ${diff(pgJson, pgMd).join(", ") || "—"}`,
);
const actSection = mdSection(narrativeMd, "## Activation narratives");
const actMd = [...actSection.matchAll(/^### (A[1-4])\b/gm)].map((m) => m[1]).sort();
const actJson = sortedKeys(narratives.activation);
check(
  "5c-iii narrative MD activation items == JSON activation",
  setEq(actMd, actJson),
  `MD: ${actMd.join(",")} JSON: ${actJson.join(",")}`,
);
const attSection = mdSection(narrativeMd, "## Educational attention areas");
const attMd = [...attSection.matchAll(/^### `([A-Z_]+)`/gm)].map((m) => m[1]).sort();
const attJson = sortedKeys(narratives.attention_areas);
check(
  "5c-iv narrative MD attention areas == JSON attention_areas",
  setEq(attMd, attJson),
  setEq(attMd, attJson)
    ? `${attJson.length} keys agree`
    : `only-in-MD: ${diff(attMd, attJson).join(", ") || "—"}; only-in-JSON: ${diff(attJson, attMd).join(", ") || "—"}`,
);
const tplMd = [...narrativeMd.matchAll(/`(PRIMARY_FRICTION|CAPACITY_FIRST|NO_MEANINGFUL_FRICTION|DEVELOPING_PICTURE)`/g)]
  .map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();
const tplJson = sortedKeys(narratives.big_picture);
check(
  "5c-v narrative MD big-picture templates == JSON big_picture",
  setEq(tplMd, tplJson),
  `MD: ${tplMd.join(",")} JSON: ${tplJson.join(",")}`,
);

// ---- 5c non-empty hardening: a missing MD section must FAIL, not vacuously pass ----
{
  const named = [
    ["context", "## Context narratives"],
    ["perception gap", "## Perception Gap"],
    ["activation", "## Activation narratives"],
    ["attention areas", "## Educational attention areas"],
  ];
  for (const [name, heading] of named) {
    const body = narrativeMd.split(new RegExp(`^${heading}`, "m"))[1]?.split(/^## /m)[0] ?? "";
    check(`5c-EMPTY narrative MD "${name}" section exists and is non-empty`, body.trim().length > 0,
      body.trim().length > 0 ? `${body.trim().length} chars` : "section missing or empty");
  }
  check("5a-EMPTY connection MD parsed", connMdKeys.length > 0, `${connMdKeys.length} keys`);
  check("5b-EMPTY vocab MD parsed", vocabMdSignals.length > 0, `${vocabMdSignals.length} signals`);
}

// ---- 6: 2.0.0 family completeness + non-empty (config side) ----
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

const si = narratives.section_intros ?? {};
const siKeys = Object.keys(si);
const siBad = siKeys.filter((k) => !Array.isArray(si[k]) || si[k].length === 0 || si[k].some((p) => !nonEmpty(p)));
check("6a section_intros present, all paragraph arrays non-empty",
  siKeys.length > 0 && siBad.length === 0,
  siBad.length === 0 ? `${siKeys.length} sections` : `bad: ${siBad.join(", ")}`);

const bp = narratives.big_picture ?? {};
const bpBad = [];
for (const [tpl, areas] of Object.entries(bp)) {
  if (!areas.default) bpBad.push(`${tpl}:missing-default`);
  for (const [area, node] of Object.entries(areas)) {
    if (!nonEmpty(node?.headline)) bpBad.push(`${tpl}.${area}:headline`);
    if (!Array.isArray(node?.body) || node.body.length === 0 || node.body.some((p) => !nonEmpty(p))) {
      bpBad.push(`${tpl}.${area}:body`);
    }
  }
}
check("6b big_picture: default + non-empty headline/body on every node",
  Object.keys(bp).length > 0 && bpBad.length === 0,
  bpBad.length === 0 ? `${Object.values(bp).reduce((n, a) => n + Object.keys(a).length, 0)} nodes` : bpBad.join(", "));

const eo = narratives.evidence_openers ?? {};
const eoBad = ["high", "moderate", "limited"].filter((lvl) => {
  const pool = eo[lvl];
  return !Array.isArray(pool) || pool.length < 3 ||
    new Set(pool).size < 3 || pool.some((p) => !nonEmpty(p));
});
check("6c evidence_openers: >=3 distinct non-empty openers per level",
  eoBad.length === 0, eoBad.length === 0 ? "high,moderate,limited" : `bad: ${eoBad.join(", ")}`);

const att = narratives.attention_areas ?? {};
const attBad = Object.keys(att).filter((k) =>
  !nonEmpty(att[k]?.short_label) || !nonEmpty(att[k]?.label) ||
  !Array.isArray(att[k]?.body) || att[k].body.length === 0);
check("6d attention_areas: label + short_label + non-empty body on every area",
  Object.keys(att).length > 0 && attBad.length === 0,
  attBad.length === 0 ? `${Object.keys(att).length} areas` : attBad.join(", "));

const connBad = [];
for (const home of [standalone, narratives.connection_statements ?? {}]) {
  for (const [k, e] of Object.entries(home)) {
    if (k.startsWith("_") || k === "version") continue;
    if (!nonEmpty(e?.headline) || !nonEmpty(e?.body)) connBad.push(`${k}:friction`);
    if (!nonEmpty(e?.connection?.headline)) connBad.push(`${k}:connection.headline`);
    if (!Array.isArray(e?.connection?.framing) || e.connection.framing.length === 0 ||
        e.connection.framing.some((p) => !nonEmpty(p))) connBad.push(`${k}:connection.framing`);
  }
}
check("6e connection entries: friction title/body + connection headline/framing (both homes)",
  connBad.length === 0, connBad.length === 0 ? "18 × 2 homes" : connBad.join(", "));

const dest = narratives.destination ?? {};
const destCodes = ["Q16_A","Q16_B","Q16_C","Q16_D","Q16_E","Q16_F","Q16_G","Q16_H","Q16_I","Q16_J","Q16_K"];
const destBad = destCodes.filter((c) =>
  !nonEmpty(dest.theme_clauses?.[c]?.framing) || !nonEmpty(dest.theme_clauses?.[c]?.outcome));
if (Object.keys(dest.theme_clauses ?? {}).sort().join(",") !== [...destCodes].sort().join(",")) {
  destBad.push("key-set");
}
if (!Array.isArray(dest.intro) || dest.intro.length === 0) destBad.push("intro");
if (!nonEmpty(dest.lede?.contrast) || !nonEmpty(dest.lede?.plain)) destBad.push("lede");
if (!nonEmpty(dest.tail)) destBad.push("tail");
if (!nonEmpty(dest._default)) destBad.push("_default");
check("6f destination: all 11 theme_clauses + intro/lede/tail/fallback non-empty",
  destBad.length === 0, destBad.length === 0 ? "11 codes" : destBad.join(", "));

const actBad = [];
for (const item of ["A1", "A2", "A3", "A4"]) {
  for (const band of ["LOW", "MID", "HIGH"]) {
    const n = narratives.activation?.[item]?.[band];
    if (!nonEmpty(n?.stateLabel)) actBad.push(`${item}.${band}:label`);
    if (!Array.isArray(n?.body) || n.body.length === 0 || n.body.some((p) => !nonEmpty(p))) {
      actBad.push(`${item}.${band}:body`);
    }
  }
}
check("6g activation: non-empty stateLabel + body on all 12 bands",
  actBad.length === 0, actBad.length === 0 ? "12 bands" : actBad.join(", "));

// ---- 6 (MD side): the approved documents carry the 2.0.0 sections ----
const mdHas = (md, needle) => md.includes(needle);
check("6h narrative MD carries the 2.0.0 appended sections",
  mdHas(narrativeMd, "## Section intros (2.0.0)") &&
    mdHas(narrativeMd, "## Destination synthesis (2.0.0, COMPOSITIONAL)") &&
    mdHas(narrativeMd, "## Signal confidence voices (2.0.0)"),
  "section intros + destination + confidence voices");
check("6i narrative MD mirrors every Q16 theme code",
  destCodes.every((c) => mdHas(narrativeMd, `\`${c}\``)),
  `${destCodes.length} codes`);
check("6j narrative MD mirrors every attention short_label",
  Object.values(att).every((e) => mdHas(narrativeMd, `**Short label (KEEP IN VIEW):** \`${e.short_label}\``)),
  `${Object.keys(att).length} short labels`);
check("6k connection MD mirrors every connection headline",
  Object.keys(standalone).filter((k) => !k.startsWith("_") && k !== "version")
    .every((k) => mdHas(connectionMd, `**Connection headline:** ${standalone[k].connection.headline}`)),
  "18 connection headlines");
check("6l narrative MD mirrors every activation state label",
  ["A1","A2","A3","A4"].flatMap((i) => ["LOW","MID","HIGH"].map((b) => narratives.activation[i][b].stateLabel))
    .every((label) => mdHas(narrativeMd, label)),
  "12 state labels");
check("6m vocabulary MD mirrors the moderate representative of every ladder state",
  SIGNALS.every((s) => LEVELS.every((l) => mdHas(vocabMd, ` — ${vocab[s][l].label}`))),
  "30 state labels");

// ---- 7: version agreement ----
for (const [name, obj] of [
  ["narratives", narratives],
  ["connection-statements", standalone],
  ["signal-state-vocabulary", vocab],
]) {
  check(`7a config ${name} version is 2.0.x`,
    /^2\.0\./.test(String(obj.version ?? "")), `version=${obj.version}`);
}
for (const [name, md] of [["narrative", narrativeMd], ["connection", connectionMd], ["vocabulary", vocabMd]]) {
  const m = md.match(/^\*\*Version ([^*]+)\*\*$/m);
  check(`7b ${name} MD Version line is 2.0.0`,
    Boolean(m) && m[1].includes("2.0.0"), m ? m[1] : "no version line");
}

// ---- summary ----
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
