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
const downloadsDir = "/Users/erspaulding/Downloads";

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

function sortedKeys(obj) {
  return Object.keys(obj ?? {}).sort();
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
const tplMd = [...narrativeMd.matchAll(/`(PRIMARY_FRICTION|CAPACITY_FIRST|NO_FRICTION)`/g)]
  .map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();
const tplJson = sortedKeys(narratives.big_picture_templates);
check(
  "5c-v narrative MD big-picture templates == JSON big_picture_templates",
  setEq(tplMd, tplJson),
  `MD: ${tplMd.join(",")} JSON: ${tplJson.join(",")}`,
);

// ---- summary ----
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
