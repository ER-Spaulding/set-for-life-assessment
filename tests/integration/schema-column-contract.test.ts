import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The app's SQL column names must exist in the schema.
 *
 * WHY THIS FILE EXISTS.
 *
 * `completeSession` wrote `{ signal, value, special_state }` to
 * `computed_signals`. The table is `(session_id, signal_id, raw_value, state,
 * evidence_confidence, calculation_version)`. A real completion failed with
 * `column "signal" of relation "computed_signals" does not exist` — every
 * completion, at the first insert.
 *
 * The suite was fully green throughout, and could not have been otherwise:
 * every DB test stubs the Supabase client with an in-memory fake that accepts
 * ANY column name. A fake cannot enforce a schema it does not have. That is the
 * general hazard this file addresses — the fake's permissiveness is a
 * standing blind spot, not a one-off.
 *
 * So this test reads the REAL migration and checks the column names the
 * application actually sends against it, statically. It cannot prove Postgres
 * will accept a statement (types, constraints and triggers are still out of
 * reach), but it closes the specific gap that let a total-failure bug ship: a
 * column that does not exist at all.
 *
 * Companion to the live check performed against a real Postgres, which caught
 * this and is recorded in the ledger.
 */

const repo = resolve(__dirname, "../..");

/** All migration SQL, concatenated — later migrations may ADD columns. */
const migrationSql = readdirSync(resolve(repo, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(repo, "supabase/migrations", f), "utf8"))
  .join("\n");

/** Parse `CREATE TABLE x (...)` into table -> Set<columnName>. */
function parseTables(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const [, name, body] = m;
    const cols = new Set<string>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("--")) continue;
      // Skip table-level constraints.
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(line)) continue;
      const col = line.match(/^(\w+)\s+/);
      if (col) cols.add(col[1]);
    }
    tables.set(name, cols);
  }
  // ALTER TABLE ... ADD COLUMN — including the multi-column form used for the
  // snapshot version pins:
  //
  //   ALTER TABLE snapshots
  //     ADD COLUMN IF NOT EXISTS instrument_version        TEXT,
  //     ADD COLUMN IF NOT EXISTS scoring_engine_version    TEXT,
  //     ...
  //
  // The previous single-column matcher (`ALTER TABLE x ADD COLUMN y`) captured
  // ONLY the first column of such a block, because every subsequent line lacks
  // its own `ALTER TABLE`. That silently dropped `assessment_version`,
  // `question_bank_version`, `scoring_config_version`, `narrative_version`,
  // `scoring_engine_version`, `narrative_library_version` and
  // `snapshot_schema_version` from `TABLES` — which is precisely how the
  // `snapshots` INSERT escaped this file. Capture the whole statement body and
  // read every `ADD COLUMN` it contains.
  const alterRe = /ALTER TABLE\s+(\w+)\s*([\s\S]*?);/g;
  while ((m = alterRe.exec(sql)) !== null) {
    const set = tables.get(m[1]);
    if (!set) continue;
    for (const cm of m[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/g)) {
      set.add(cm[1]);
    }
  }
  return tables;
}

const TABLES = parseTables(migrationSql);

/** The app source, concatenated. */
const appSrc = ["lib", "app"]
  .flatMap((dir) => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = resolve(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) out.push(readFileSync(full, "utf8"));
      }
    };
    walk(resolve(repo, dir));
    return out;
  })
  .join("\n");

/**
 * Column keys from the object literal(s) an insert/upsert actually writes.
 *
 * The call shapes in this codebase are:
 *   db.from("t").insert({ a: 1, b: 2 })
 *   db.from("t").upsert(rows.map((x) => ({ a: 1, b: 2 })), { onConflict: "..." })
 *   db.from("t").upsert([{ a: 1 }], { onConflict: "..." })
 *
 * So: find the call, take the FIRST `{` after the open paren, brace-match to
 * its close, and read the top-level keys. Everything after that close (the
 * `{ onConflict: ... }` options object, or the next statement) is deliberately
 * excluded — reading past it is what made an earlier version of this matcher
 * report unrelated keys.
 *
 * A top-level key is one of three shapes, and ALL three must be read — a key
 * this matcher silently drops is a column whose typo would pass unchecked:
 *   key: value   — explicit property. EVERY key on a line is read: a one-line
 *                  literal `{ session_id: x, tension_code: y }` must contribute
 *                  BOTH keys or the second one passes vacuously.
 *   identifier   — shorthand property (`{ channel, purpose }`).
 *   ...spread    — spread of another object literal, resolved via
 *                  `constObjectKeys` and unioned in.
 *
 * Options-key objects are skipped by name (`onConflict`), which is not a
 * column and would otherwise appear as a false positive.
 */
const NON_COLUMN_KEYS = new Set(["onConflict", "count", "defaultToNull"]);

/** Bare tokens that are statement keywords, never shorthand column names. */
const NON_SHORTHAND_TOKENS = new Set([
  "return", "if", "else", "for", "while", "do", "switch", "case", "default",
  "break", "continue", "throw", "try", "catch", "finally", "const", "let", "var",
  "new", "delete", "typeof", "in", "of", "instanceof", "this", "true", "false",
  "null", "undefined", "void", "yield", "await", "async", "function", "class",
  "export", "import",
]);

function keysFromObjectLiteral(text: string, seen: Set<string> = new Set<string>()): string[] {
  // `text` starts at the `{`.
  let depth = 0;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const body = text.slice(1, end);
  const keys: string[] = [];
  // Top-level keys only: track brace depth so nested objects are ignored.
  let d = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    if (d === 0) {
      for (const k of topLevelKeysOnLine(trimmed, seen)) keys.push(k);
    }
    d += (line.match(/\{/g) ?? []).length;
    d -= (line.match(/\}/g) ?? []).length;
  }
  return keys;
}

/**
 * Top-level keys on a single depth-0 line. Splits the line on commas that are
 * NOT nested inside `{}` / `[]` / `()`, so a value like
 * `payload: { signal, display_state: special }` contributes only `payload`
 * (never its nested keys), while a genuinely flat one-line literal
 * `{ session_id: x, tension_code: y }` contributes both keys.
 */
function topLevelKeysOnLine(line: string, seen: Set<string>): string[] {
  const keys: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      addSegmentKey(line.slice(start, i), keys, seen);
      start = i + 1;
    }
  }
  addSegmentKey(line.slice(start), keys, seen);
  return keys;
}

function addSegmentKey(seg: string, keys: string[], seen: Set<string>): void {
  const t = seg.trim();
  if (!t) return;
  // `key: value`
  const km = t.match(/^([A-Za-z_]\w*)\s*:/);
  if (km) {
    if (!NON_COLUMN_KEYS.has(km[1])) keys.push(km[1]);
    return;
  }
  // `...spread`
  const sp = t.match(/^\.\.\.([A-Za-z_]\w*)$/);
  if (sp) {
    keys.push(...constObjectKeys(sp[1], seen));
    return;
  }
  // shorthand property `identifier`
  const sh = t.match(/^([A-Za-z_]\w*)$/);
  if (sh && !NON_COLUMN_KEYS.has(sh[1]) && !NON_SHORTHAND_TOKENS.has(sh[1])) {
    keys.push(sh[1]);
  }
}

/** Keys of a `const <name> = { ... }` / `<name>: { ... }` object literal. */
function constObjectKeys(name: string, seen: Set<string>): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const out: string[] = [];
  const re = new RegExp(`(?:const\\s+${name}\\s*(?::[^=]+)?=\\s*|${name}\\s*:\\s*)\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    out.push(...keysFromObjectLiteral(appSrc.slice(m.index + m[0].length - 1), seen));
  }
  return out;
}

function insertKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const callRe = new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(appSrc)) !== null) {
    // Bounded window: the object literal begins within the first argument. The
    // bound must cover the longest insert object in the codebase — the
    // `snapshots` insert spans ~1800 characters once its comment block is
    // counted. A bound too small silently returns NO keys for that table, which
    // is how the snapshots INSERT eluded this file entirely: the "every key is
    // a real column" check passed vacuously on an empty set. Brace-matching
    // below stops at the first balanced close, so an over-large bound is
    // harmless — it never reads past the object it is given.
    const window = appSrc.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const brace = window.indexOf("{");
    if (brace === -1) continue; // `.insert(rows)` — variable, handled below
    for (const k of keysFromObjectLiteral(window.slice(brace))) keys.add(k);
  }
  return keys;
}

/**
 * Column keys from object literals built ELSEWHERE and passed to insert/upsert
 * as a variable (e.g. `const row = {...}; db.from("t").insert(row)`).
 *
 * Resolves EVERY identifier handed to insert/upsert — including `rows` and
 * `payload`, whose keys are built elsewhere and which the old code dropped —
 * through the construction shapes that appear in this codebase:
 *   const <id> = { ... }               — a direct object literal;
 *   <id>.push({ ... })                 — successive pushes later upserted;
 *   const <id> = X.map(... => ({...})) — a literal inside a map arrow.
 * Dynamic `row[key] = payload[key]` assignment is recovered separately by
 * `dynamicallyAssignedKeysFor` from the allow-list array that guards it.
 *
 * An identifier whose shape cannot be resolved to a static key set is exactly
 * the blind spot this file exists to close, so it is never silently dropped —
 * the non-vacuity assertion in the test body fails if a write site yields no
 * keys.
 */
function pushedKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const callRe = new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(\\s*([\\w.]+)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(appSrc)) !== null) {
    const id = m[1].split(".").pop()!;
    for (const k of constObjectKeys(id, new Set())) keys.add(k);
    for (const k of mappedKeysFor(id)) keys.add(k);
    for (const k of pushedLiteralKeysFor(id)) keys.add(k);
  }
  return keys;
}

/**
 * Keys from `const <id> = X.map((...) => ({ ... }))`. The `[^;]*?` bounds the
 * expression to a single statement: without it, `const overrideRows = [];`
 * (which has no `.map`) would lazily swallow the rest of the concatenated
 * source and match a `.map` belonging to an UNRELATED table.
 */
function mappedKeysFor(id: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `const\\s+${id}\\s*(?::[^=]+)?=\\s*[^;]*?\\.map\\([^;]*?=>\\s*\\(?\\s*\\{`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    out.push(...keysFromObjectLiteral(appSrc.slice(m.index + m[0].length - 1)));
  }
  return out;
}

/** Keys from `<id>.push({ ... })`. */
function pushedLiteralKeysFor(id: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`${id}\\.push\\(\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    out.push(...keysFromObjectLiteral(appSrc.slice(m.index + m[0].length - 1)));
  }
  return out;
}

/**
 * Keys assigned dynamically: `for (const k of [ "a", "b" ]) { row[k] = ... }`.
 * The allow-list array IS the static source of truth for the column names —
 * the dynamic `row[key] = payload[key]` is invisible to object-literal
 * matchers, but the array that gates it enumerates the columns verbatim.
 */
/** Keys from the dynamic allow-list loop that gates `row[key] = payload[key]`. */
function dynamicKeysFor(id: string): string[] {
  const keys = new Set<string>();
  const re = new RegExp(
    "for \\(const (\\w+) of (\\[[\\s\\S]*?\\])\\)\\s*\\{[\\s\\S]*?" +
      id +
      "\\[\\1\\]\\s*=",
    "g",
  );
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(appSrc)) !== null) {
    for (const s of mm[2].matchAll(/["']([A-Za-z_][\w]*)/g)) keys.add(s[1]);
  }
  return [...keys];
}

function dynamicallyAssignedKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const callRe = new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(\\s*([\\w.]+)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(appSrc)) !== null) {
    const id = m[1].split(".").pop()!;
    for (const k of dynamicKeysFor(id)) keys.add(k);
  }
  return keys;
}

/** Number of insert/upsert sites on a table (0 => the table is never written). */
function writeSitesFor(table: string): number {
  const re = new RegExp(`\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(`, "g");
  return [...appSrc.matchAll(re)].length;
}

function selectKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const re = new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,80}?\\.select\\("([^"]*)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    for (const col of m[1].split(",")) {
      const c = col.trim().split(/\s/)[0];
      if (c && c !== "*") keys.add(c);
    }
  }
  return keys;
}

/**
 * The FIRST argument to a write call, matched by balancing `()`, `[]` and `{}`.
 * `window` begins immediately after the call's opening `(` (which the caller has
 * consumed), so the call's own paren is depth 1 and the match ends at the
 * closing `)` or the top-level comma that separates the options object. This is
 * what lets a `.insert(rows)` be told apart from a `.insert({...})` without the
 * sloppy "first `{` in a 4000-char window" that a following `if (x) {` would
 * fool.
 */
function firstArgumentAfter(window: string): string {
  let depth = 1;
  let i = 0;
  for (; i < window.length; i++) {
    const ch = window[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) break;
    } else if (ch === "," && depth === 1) {
      break;
    }
  }
  return window.slice(0, i).trim();
}

/** Keys from `id.key = value` assignments — the shape `.update(updated)` uses. */
function memberAssignedKeysFor(id: string): string[] {
  const keys = new Set<string>();
  const re = new RegExp(`\\b${id}\\.([A-Za-z_]\\w*)\\s*=`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) keys.add(m[1]);
  return [...keys];
}

/**
 * Every static key a named variable can contribute, unioned across the shapes
 * this codebase builds rows with: a const object literal, a `.map(... => ({...}))`,
 * successive `.push({...})` calls, a dynamic allow-list loop, and `id.key =`
 * assignment. A non-empty result means the variable IS statically checkable.
 */
function resolveIdentifierKeys(id: string): string[] {
  const keys = new Set<string>();
  for (const k of constObjectKeys(id, new Set())) keys.add(k);
  for (const k of mappedKeysFor(id)) keys.add(k);
  for (const k of pushedLiteralKeysFor(id)) keys.add(k);
  for (const k of dynamicKeysFor(id)) keys.add(k);
  for (const k of memberAssignedKeysFor(id)) keys.add(k);
  return [...keys];
}

/**
 * Insert/upsert sites whose written columns CANNOT be extracted statically.
 *
 * The anti-vacuity guarantee below is PER-TABLE, which is not enough: a table
 * with one resolvable site plus one unresolvable site would pass on the
 * resolvable keys while the second site slips through silently. This returns
 * every write site that is neither an inline object/array/map literal NOR a
 * variable the resolvers can name — a site whose keys are an UNKNOWN, and an
 * unknown must fail, not pass. The description names the site so a future
 * author knows exactly what to make checkable.
 */
function unresolvableWriteSites(table: string): string[] {
  const re = new RegExp(`\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(`, "g");
  const sites: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    const window = appSrc.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const arg = firstArgumentAfter(window);
    if (arg.includes("{")) continue; // inline object / array / map literal
    const id = arg.match(/^[A-Za-z_]\w*/)?.[0];
    if (id && resolveIdentifierKeys(id).length > 0) continue; // resolvable variable
    const ctx = appSrc.slice(m.index, m.index + 80).replace(/\s+/g, " ").trim();
    sites.push(`${table} write site ${ctx} — argument ${JSON.stringify(arg.slice(0, 40))} is not statically checkable`);
  }
  return sites;
}

/**
 * Column keys from `.update({ ... })` and `.update(variable)` clauses on a
 * table. An UPDATE writing a nonexistent column fails at runtime exactly like
 * an INSERT, so these keys get the same schema check.
 */
function updateKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const re = new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,300}?\\.update\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    const start = m.index + m[0].length;
    const window = appSrc.slice(start, start + 2000);
    const arg = firstArgumentAfter(window);
    if (arg.includes("{")) {
      for (const k of keysFromObjectLiteral(arg)) keys.add(k);
    } else {
      const id = arg.match(/^[A-Za-z_]\w*/)?.[0];
      if (id) for (const k of resolveIdentifierKeys(id)) keys.add(k);
    }
  }
  return keys;
}

/** Update clauses whose keys cannot be extracted — the same unknown-fails rule. */
function unresolvableUpdateSites(table: string): string[] {
  const re = new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,300}?\\.update\\(`, "g");
  const sites: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(appSrc)) !== null) {
    const start = m.index + m[0].length;
    const window = appSrc.slice(start, start + 2000);
    const arg = firstArgumentAfter(window);
    if (arg.includes("{")) continue;
    const id = arg.match(/^[A-Za-z_]\w*/)?.[0];
    if (id && resolveIdentifierKeys(id).length > 0) continue;
    const ctx = appSrc.slice(m.index, m.index + 80).replace(/\s+/g, " ").trim();
    sites.push(`${table} update site ${ctx} — argument ${JSON.stringify(arg.slice(0, 40))} is not statically checkable`);
  }
  return sites;
}

describe("the migration parses and yields the tables the app uses", () => {
  it("finds every table the application writes to", () => {
    console.log("  parsed tables:", TABLES.size);
    const appTables = new Set(
      [...appSrc.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]),
    );
    const missing = [...appTables].filter((t) => !TABLES.has(t));
    console.log("  tables the app references:", appTables.size);
    expect(missing, "app references a table with no CREATE TABLE").toEqual([]);
  });
});

describe("inserted column names exist in the schema", () => {
  // classifier_tags is deliberately NOT in this list: the app never writes it
  // (see the dedicated assertions at the end of this describe). An insert check
  // for it would pass on an empty set — a vacuous "success" this file refuses
  // to print.
  for (const table of [
    "computed_signals",
    "tensions",
    "overrides",
    "assessment_sessions",
    "responses",
    "communication_consents",
    "participant_contacts",
    "integration_events",
    "pilot_feedback",
    "participants",
    "snapshots",
    "demographics",
    "analytics_events",
  ]) {
    it(`${table}: every inserted key is a real column`, () => {
      const cols = TABLES.get(table);
      expect(cols, `${table} not found in migrations`).toBeDefined();
      const inserted = new Set([
        ...insertKeysFor(table),
        ...pushedKeysFor(table),
        ...dynamicallyAssignedKeysFor(table),
      ]);
      // Anti-vacuity: an insert/upsert site whose keys could NOT be extracted
      // is a test failure, not a green "inserts []". A variable whose shape
      // this file cannot resolve is exactly the blind spot it exists to close.
      const writes = writeSitesFor(table);
      if (writes > 0) {
        expect(
          [...inserted],
          `${table} has ${writes} insert/upsert site(s) but the key extraction returned no keys — that is a vacuous check, not a passing test`,
        ).not.toHaveLength(0);
      }
      // Anti-vacuity, PER SITE. The table-level check above is blind to a table
      // that is "covered" by one resolvable site while a second, unresolvable
      // site slips through. Every write site must either yield keys or be an
      // inline literal — an unresolvable site is an UNKNOWN and must fail.
      expect(
        unresolvableWriteSites(table),
        `${table} has a write site whose columns cannot be checked statically`,
      ).toEqual([]);
      const bad = [...inserted].filter((k) => !cols!.has(k));
      console.log(`  ${table}: inserts ${JSON.stringify([...inserted].sort())}`);
      if (bad.length) console.log(`    UNKNOWN COLUMNS: ${JSON.stringify(bad)}`);
      expect(bad, `${table} inserts columns that do not exist`).toEqual([]);
    });

    it(`${table}: every selected column is a real column`, () => {
      const cols = TABLES.get(table)!;
      const selected = selectKeysFor(table);
      const bad = [...selected].filter((k) => !cols.has(k));
      console.log(`  ${table}: selects ${JSON.stringify([...selected].sort())}`);
      if (bad.length) console.log(`    UNKNOWN COLUMNS: ${JSON.stringify(bad)}`);
      expect(bad, `${table} selects columns that do not exist`).toEqual([]);
    });

    it(`${table}: every updated key is a real column`, () => {
      const cols = TABLES.get(table)!;
      const updated = updateKeysFor(table);
      expect(
        unresolvableUpdateSites(table),
        `${table} has an update clause whose columns cannot be checked statically`,
      ).toEqual([]);
      const bad = [...updated].filter((k) => !cols.has(k));
      console.log(`  ${table}: updates ${JSON.stringify([...updated].sort())}`);
      if (bad.length) console.log(`    UNKNOWN COLUMNS: ${JSON.stringify(bad)}`);
      expect(bad, `${table} updates columns that do not exist`).toEqual([]);
    });
  }

  it("classifier_tags: no write site exists — inserted columns cannot be checked statically", () => {
    // classifier_tags is populated nowhere in lib/ or app/ (classifier results
    // are folded into snapshots.payload_json, not this table), so there is no
    // static column set to extract and "inserted keys" is empty by
    // construction. This is a deliberate, ENFORCED absence: if a writer ever
    // appears, this test MUST fail, forcing its columns to be extracted and
    // verified against the migration — rather than reporting a vacuous "inserts []".
    const writes = [
      ...appSrc.matchAll(/\.from\("classifier_tags"\)\s*\.(?:insert|upsert)\(/g),
    ];
    expect(
      writes,
      "classifier_tags has no insert/upsert site; if one is added, its columns must be column-checked here",
    ).toHaveLength(0);
  });

  it("classifier_tags: every selected column is a real column", () => {
    const cols = TABLES.get("classifier_tags")!;
    const selected = selectKeysFor("classifier_tags");
    const bad = [...selected].filter((k) => !cols.has(k));
    console.log(`  classifier_tags: selects ${JSON.stringify([...selected].sort())}`);
    expect(bad, "classifier_tags selects columns that do not exist").toEqual([]);
  });

  it("audit_events: no write site exists — rows are written by SQL/trigger, not TypeScript", () => {
    // audit_events is INSERT-ed only from migration triggers/functions (e.g.
    // 20260930000004_close_freeze_bypass.sql's audit_session_status_change(),
    // and the erasure trigger in 20261001000002), never from lib/ or app/. There
    // is therefore no static column set to extract from a TS write. This is a
    // deliberate, ENFORCED absence: if a TS writer ever appears, this test MUST
    // fail, forcing its columns to be extracted and verified against the
    // migration — rather than reporting a vacuous "inserts []".
    const writes = [
      ...appSrc.matchAll(/\.from\("audit_events"\)\s*\.(?:insert|upsert)\(/g),
    ];
    expect(
      writes,
      "audit_events has no insert/upsert site; if one is added, its columns must be column-checked here",
    ).toHaveLength(0);
  });

  it("audit_events: every selected column is a real column", () => {
    const cols = TABLES.get("audit_events")!;
    const selected = selectKeysFor("audit_events");
    const bad = [...selected].filter((k) => !cols.has(k));
    console.log(`  audit_events: selects ${JSON.stringify([...selected].sort())}`);
    expect(bad, "audit_events selects columns that do not exist").toEqual([]);
  });
});

describe("required keys — the snapshots INSERT writes all four version identifiers", () => {
  // The one-directional check above proves every key the code sends EXISTS in
  // the schema. It does NOT prove the four operator-required version columns are
  // still SENT. A writer that silently dropped them would pass the check above
  // (nothing unknown is written) and pass every behavioural test (the stub DB
  // accepts any shape, and the payload carries its own copy of the versions) —
  // yet the queryable COLUMNS would be NULL forever, on a one-per-session,
  // append-only row that can never be backfilled. This is the half that was
  // missing, and the reason the deletion of all four columns once passed every
  // test and `tsc`.
  it("snapshots insert contains instrument_version, scoring_engine_version, narrative_library_version and snapshot_schema_version", () => {
    const inserted = new Set([...insertKeysFor("snapshots"), ...pushedKeysFor("snapshots")]);
    console.log(`  snapshots inserts ${JSON.stringify([...inserted].sort())}`);
    for (const col of [
      "instrument_version",
      "scoring_engine_version",
      "narrative_library_version",
      "snapshot_schema_version",
    ]) {
      expect([...inserted], `snapshots INSERT must write ${col}`).toContain(col);
    }
  });
});

describe("regression — the specific defect this file was written for", () => {
  it("computed_signals uses signal_id / raw_value / calculation_version, NOT signal / value / special_state", () => {
    const cols = TABLES.get("computed_signals")!;
    // The schema's names (PRD §22.3 lists the same six).
    for (const c of [
      "session_id",
      "signal_id",
      "raw_value",
      "state",
      "evidence_confidence",
      "calculation_version",
    ]) {
      expect(cols, `computed_signals should have ${c}`).toContain(c);
    }
    // The names that do not exist and caused every completion to fail.
    for (const c of ["signal", "value", "special_state"]) {
      expect(cols, `computed_signals must NOT have ${c}`).not.toContain(c);
    }
  });

  it("the off-ladder states live in overrides, not computed_signals", () => {
    // §22.3 gives computed_signals no column for them; the design puts
    // override_code + payload in `overrides`.
    expect(TABLES.get("overrides")).toContain("override_code");
    expect(TABLES.get("overrides")).toContain("payload");
    expect(TABLES.get("computed_signals")).not.toContain("special_state");
  });
});
