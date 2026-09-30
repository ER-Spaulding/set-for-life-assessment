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
  // ALTER TABLE ... ADD COLUMN
  const addRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/g;
  while ((m = addRe.exec(sql)) !== null) {
    const set = tables.get(m[1]);
    if (set) set.add(m[2]);
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
 * Extract `{ col: ..., col2: ... }` object-literal keys from a `.insert(...)`
 * or `.upsert(...)` call on the given table, plus `.select("a, b")` strings.
 */
/**
 * Column keys from the object literal(s) an insert/upsert actually writes.
 *
 * The call shapes in this codebase are:
 *   db.from("t").insert({ a: 1, b: 2 })
 *   db.from("t").upsert(rows.map((x) => ({ a: 1, b: 2 })), { onConflict: "..." })
 *   db.from("t").upsert([{ a: 1 }], { onConflict: "..." })
 *
 * So: find the call, take the FIRST `{` after the open paren, brace-match to
 * its close, and read the top-level `key:` entries. Everything after that
 * close (the `{ onConflict: ... }` options object, or the next statement) is
 * deliberately excluded — reading past it is what made an earlier version of
 * this matcher report unrelated keys.
 *
 * Options-key objects are skipped by name (`onConflict`), which is not a
 * column and would otherwise appear as a false positive.
 */
const NON_COLUMN_KEYS = new Set(["onConflict", "count", "defaultToNull"]);

function keysFromObjectLiteral(text: string): string[] {
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
      const km = trimmed.match(/^(\w+)\s*:/);
      if (km && !NON_COLUMN_KEYS.has(km[1])) keys.push(km[1]);
    }
    d += (line.match(/\{/g) ?? []).length;
    d -= (line.match(/\}/g) ?? []).length;
  }
  return keys;
}

function insertKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  const callRe = new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(appSrc)) !== null) {
    // Bounded window: the object literal begins within the first argument.
    const window = appSrc.slice(m.index + m[0].length, m.index + m[0].length + 1200);
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
 * Found by name: any `const <name> ... = {` / `.push({` whose identifier is
 * later handed to insert/upsert on this table.
 */
function pushedKeysFor(table: string): Set<string> {
  const keys = new Set<string>();
  // Which identifiers are passed to insert/upsert for this table?
  const callRe = new RegExp(
    `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\(\\s*([\\w.]+)`,
    "g",
  );
  const idents = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(appSrc)) !== null) {
    const id = m[1].split(".").pop()!;
    if (id !== "rows" && id !== "payload") idents.add(id);
  }
  for (const id of idents) {
    // `const <id> = { ... }` and `<id>: { ... }` object literals.
    const re = new RegExp(
      `(?:const\\s+${id}\\s*(?::[^=]+)?=\\s*|${id}\\s*:\\s*)\\{([\\s\\S]*?)\\n\\s*\\}`,
      "g",
    );
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(appSrc)) !== null) {
      for (const km of mm[1].matchAll(/^\s*(\w+):/gm)) keys.add(km[1]);
    }
  }
  return keys;
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
  for (const table of [
    "computed_signals",
    "tensions",
    "overrides",
    "assessment_sessions",
    "responses",
    "classifier_tags",
    "communication_consents",
    "participant_contacts",
    "integration_events",
    "pilot_feedback",
    "participants",
  ]) {
    it(`${table}: every inserted key is a real column`, () => {
      const cols = TABLES.get(table);
      expect(cols, `${table} not found in migrations`).toBeDefined();
      const inserted = new Set([...insertKeysFor(table), ...pushedKeysFor(table)]);
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
  }
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
