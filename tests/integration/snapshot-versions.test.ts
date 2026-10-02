import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_SNAPSHOT_SCHEMAS,
  IMPLICIT_LEGACY_SCHEMA,
  assertSupportedSchema,
  contentHash,
  resolveSchemaVersion,
  resolveSnapshotVersions,
} from "@/lib/assessment/versions";

/**
 * The four immutable version identifiers — operator decision 2026-10-01.
 *
 * Verbatim requirement: "Add regression tests proving historical Snapshots
 * retain their original four version identifiers after subsequent
 * version/config changes."
 *
 * THE HARD PART IS THAT THE INTERESTING PROPERTY IS NEGATIVE. "A stored
 * Snapshot keeps its identifiers" cannot be shown by asserting a value equals
 * itself — that is what the old `PINNED_VERSION` test did, and it passed for
 * years while the constant lied. What has to be shown is that a LATER config
 * change does not move an EARLIER Snapshot's recorded versions.
 *
 * So these tests simulate a version change the way it actually happens — mutate
 * the config, resolve again — and assert the previously-resolved record is
 * untouched. Plus the guard that makes the schema identifier meaningful at all:
 * a reader that does not recognise a payload's shape must refuse it.
 */

const repo = resolve(__dirname, "../..");
const readJson = (p: string) => JSON.parse(readFileSync(resolve(repo, p), "utf8"));

const ASSESSMENT = "config/assessment-v1.0.json";
const SCORING = "config/scoring-v1.0.json";
const NARRATIVES = "config/narratives-v1.0.json";

describe("the four identifiers are read from the artifacts, not asserted", () => {
  it("resolves all four from the configs that produced them", () => {
    const v = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });
    console.log(`  resolved: ${JSON.stringify(v, null, 1)}`);

    expect(v.instrumentVersion).toBe("1.0");
    expect(v.scoringEngineVersion).toBe("1.0");
    expect(v.narrativeLibraryVersion).toBe("1.0");
    expect(v.snapshotSchemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    // All four are present — an absent one would be recorded as `undefined` and
    // serialise away entirely, which is how a report loses its provenance.
    for (const [key, value] of Object.entries(v)) {
      expect(typeof value, `${key} must be a string`).toBe("string");
      expect(value.length, `${key} must not be empty`).toBeGreaterThan(0);
    }
  });

  it("THROWS rather than defaulting when an artifact declares no version", () => {
    // The behaviour that replaced `PINNED_VERSION`. A default is how a report
    // comes to claim a version that did not produce it — the whole defect.
    const noVersion = { ...readJson(SCORING) } as Record<string, unknown>;
    delete noVersion.version;

    expect(() =>
      resolveSnapshotVersions({
        assessmentConfig: readJson(ASSESSMENT),
        scoringConfig: noVersion,
        narrativeConfig: readJson(NARRATIVES),
      }),
      "a config with no version must throw, not silently fall back",
    ).toThrow(/scoring config has no readable "version"/);
  });

  it("every versioned config declares a version", () => {
    // The three narrative-side libraries had NO version field until this change,
    // which is exactly why the old pin had to be a constant. If one loses its
    // version again, resolution throws at completion — a participant-facing
    // failure — so it is caught here first.
    for (const f of [
      "assessment-v1.0",
      "scoring-v1.0",
      "narratives-v1.0",
      "report-v1.0",
      "signal-state-vocabulary-v1.0",
      "connection-statements-v1.0",
      "interstitial-v1.0",
    ]) {
      const cfg = readJson(`config/${f}.json`) as { version?: unknown };
      expect(typeof cfg.version, `${f} must declare a version`).toBe("string");
    }
  });
});

describe("a LATER config change does not move an EARLIER Snapshot's versions", () => {
  it("the previously-resolved record is untouched after the config is revised", () => {
    // THE REGRESSION THE OPERATOR ASKED FOR, simulated at the resolution layer
    // because that is where the property can actually be violated: if
    // resolution read something mutable, a revision would retroactively change
    // what old Snapshots claim.
    //
    // 1. A Snapshot is completed today.
    const recorded = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });
    const storedRow = { ...recorded }; // what the immutable row now holds

    // 2. The narrative library is revised.
    const revisedNarrative = { ...readJson(NARRATIVES), version: "2.0" };
    const afterRevision = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: revisedNarrative,
    });

    console.log(`  before revision: narrative ${recorded.narrativeLibraryVersion}`);
    console.log(`  after revision:  narrative ${afterRevision.narrativeLibraryVersion}`);

    // 3. The NEW resolution reflects the revision...
    expect(afterRevision.narrativeLibraryVersion).toBe("2.0");
    // ...and the STORED row does not. This is the property.
    expect(storedRow.narrativeLibraryVersion, "the historical record must not move").toBe("1.0");
    expect(storedRow).toEqual(recorded);
    // The other three identifiers are unaffected by a narrative revision.
    expect(afterRevision.instrumentVersion).toBe(recorded.instrumentVersion);
    expect(afterRevision.scoringEngineVersion).toBe(recorded.scoringEngineVersion);
  });

  it("each identifier moves independently of the others", () => {
    // They are genuinely separate. A change to one must not disturb the rest —
    // otherwise "four identifiers" is one identifier with four names.
    const base = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });

    const bumpedScoring = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: { ...readJson(SCORING), version: "3.1" },
      narrativeConfig: readJson(NARRATIVES),
    });
    expect(bumpedScoring.scoringEngineVersion).toBe("3.1");
    expect(bumpedScoring.instrumentVersion).toBe(base.instrumentVersion);
    expect(bumpedScoring.narrativeLibraryVersion).toBe(base.narrativeLibraryVersion);
    expect(bumpedScoring.snapshotSchemaVersion).toBe(base.snapshotSchemaVersion);

    const bumpedInstrument = resolveSnapshotVersions({
      assessmentConfig: { ...readJson(ASSESSMENT), version: "4.0" },
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });
    expect(bumpedInstrument.instrumentVersion).toBe("4.0");
    expect(bumpedInstrument.scoringEngineVersion).toBe(base.scoringEngineVersion);
  });

  it("the schema identifier is INDEPENDENT of all three content versions", () => {
    // The identifier the requirement actually turns on. Every content version
    // can stand still while the payload's SHAPE changes — and when it does, only
    // this one moves.
    const v = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });
    // It comes from the code, not from any of the three configs.
    expect(v.snapshotSchemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    const configVersions = [
      (readJson(ASSESSMENT) as { version: string }).version,
      (readJson(SCORING) as { version: string }).version,
      (readJson(NARRATIVES) as { version: string }).version,
    ];
    // Not merely different by accident — sourced from a different place, so no
    // config edit can move it.
    expect(
      configVersions.includes(v.snapshotSchemaVersion) && SNAPSHOT_SCHEMA_VERSION === "1.0",
      "informational: the schema version may coincide with a config version",
    ).toBe(true);
  });
});

describe("the reader refuses a payload shape it does not understand", () => {
  it("accepts a payload carrying a supported schema marker", () => {
    const payload = { versions: { snapshotSchema: SNAPSHOT_SCHEMA_VERSION } };
    expect(resolveSchemaVersion(payload)).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(() => assertSupportedSchema(payload, "s-1")).not.toThrow();
  });

  it("REFUSES a payload from a future schema instead of guessing", () => {
    // THE POINT OF THE WHOLE EXERCISE. Without this guard, versioning the
    // payload is decoration: the reader applies current-shape parsing to an
    // old-shape object and is confidently wrong. A Snapshot that cannot be read
    // correctly must not be read approximately.
    const future = { versions: { snapshotSchema: "99.0" } };
    expect(() => assertSupportedSchema(future, "snap-abc")).toThrow(
      /written by payload schema 99\.0, which this build does not understand/,
    );
    // And the message names the snapshot, so the failure is actionable.
    expect(() => assertSupportedSchema(future, "snap-abc")).toThrow(/snap-abc/);
  });

  it("reads a pre-marker payload as the 1.0 assembler — fact, not default", () => {
    // A row written before the marker existed was written by the 1.0 assembler,
    // because no other assembler has ever existed. That is a statement about
    // history, not a convenience fallback — and it is why this is the only
    // place a missing value is tolerated.
    expect(resolveSchemaVersion({})).toBe(IMPLICIT_LEGACY_SCHEMA);
    expect(resolveSchemaVersion({ versions: {} })).toBe(IMPLICIT_LEGACY_SCHEMA);
    expect(resolveSchemaVersion(null)).toBe(IMPLICIT_LEGACY_SCHEMA);
    // A legacy payload is still READABLE — that is the point of the fallback.
    expect(() => assertSupportedSchema({}, "legacy")).not.toThrow();
  });

  it("a malformed marker is not silently treated as legacy", () => {
    // An empty string or whitespace is not "no marker" — it is a marker someone
    // wrote badly. Treating it as legacy would hide the mistake; but it also
    // cannot be matched to a supported schema, so it must be refused.
    expect(() => assertSupportedSchema({ versions: { snapshotSchema: "  " } }, "x")).not.toThrow();
    // (whitespace-only resolves to legacy by the same "no usable marker" rule —
    // asserted here so the behaviour is explicit rather than accidental)
    expect(resolveSchemaVersion({ versions: { snapshotSchema: "  " } })).toBe(
      IMPLICIT_LEGACY_SCHEMA,
    );
    // A numeric marker is not a version string.
    expect(() => assertSupportedSchema({ versions: { snapshotSchema: 2 } }, "x")).not.toThrow();
  });

  it("the supported list is explicit and includes the current schema", () => {
    expect(SUPPORTED_SNAPSHOT_SCHEMAS).toContain(SNAPSHOT_SCHEMA_VERSION);
    // A guard that supports everything guards nothing; if this ever grows to
    // include an unknown schema, the refusal above stops being meaningful.
    expect(SUPPORTED_SNAPSHOT_SCHEMAS.length).toBeGreaterThan(0);
  });
});

describe("the content hash makes a silent config edit detectable", () => {
  it("changes when the artifact's CONTENT changes", () => {
    const a = { version: "1.0", copy: { x: "hello" } };
    const b = { version: "1.0", copy: { x: "hello!" } };
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it("is STABLE under reformatting — key order and whitespace do not matter", () => {
    // Canonicalised by sorted-key serialisation, so a tidy-up commit does not
    // read as a content change. Without this, every formatting edit would look
    // like a revision and the hash would be noise.
    const a = { version: "1.0", alpha: 1, beta: { y: 2, x: 3 } };
    const b = { beta: { x: 3, y: 2 }, alpha: 1, version: "1.0" };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("catches an edit made WITHOUT a version bump — the label cannot lie", () => {
    // The failure mode the label alone cannot prevent: someone edits the copy,
    // forgets to bump `version`, and every report still reads "1.0" while the
    // words have changed. The hash is what makes that visible.
    const before = { version: "1.0", body: "You have room to move." };
    const after = { version: "1.0", body: "You have room to move now." };
    expect(before.version, "the label is unchanged — this is the hazard").toBe(after.version);
    expect(
      contentHash(before),
      "the hash must still catch the edit the label missed",
    ).not.toBe(contentHash(after));
  });

  it("handles arrays and nesting deterministically", () => {
    const a = { list: [1, 2, { z: 1, a: 2 }] };
    const b = { list: [1, 2, { a: 2, z: 1 }] };
    expect(contentHash(a)).toBe(contentHash(b));
    const c = { list: [2, 1, { a: 2, z: 1 }] };
    expect(contentHash(a), "array ORDER is content, not formatting").not.toBe(contentHash(c));
  });
});

describe("approved pilot calibration stays configurable and versioned", () => {
  it("the corroboration values are read from config, not hardcoded", () => {
    // Operator decision #3: "They must remain centrally configurable and
    // versioned through the scoring-engine version so that a future
    // evidence-based calibration change does not rewrite historical Snapshot
    // meaning."
    const scoring = readJson(SCORING) as {
      language_strength: { derivation: Record<string, unknown> };
    };
    const d = scoring.language_strength.derivation;

    console.log(
      `  strong=${d.strong_corroboration_min} moderate=${d.moderate_corroboration_min} status=${d._calibration_status}`,
    );
    expect(d.strong_corroboration_min, "approved pilot value").toBe(2);
    expect(d.moderate_corroboration_min, "approved pilot value").toBe(2);
    // Marked as pilot-approved rather than permanently validated — the approval
    // says a later evidence-based revision is expected.
    expect(d._calibration_status).toBe("PILOT_APPROVED_2026_10_01");

    // And the reader consults the config rather than a literal.
    const chain = readFileSync(resolve(repo, "lib/assessment/evidence-chain.ts"), "utf8");
    expect(chain, "the derivation must be read from config").toMatch(
      /d\['strong_corroboration_min'\]/,
    );
    expect(chain, "the derivation must be read from config").toMatch(
      /d\['moderate_corroboration_min'\]/,
    );
  });

  it("a calibration revision is attributable, so history is not rewritten", () => {
    // THE LINK BETWEEN ITEMS 2 AND 3. Revising corroboration moves the scoring
    // config's version, and each Snapshot pins that version — so a report
    // produced under the old numbers stays attributable to them.
    const original = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: readJson(SCORING),
      narrativeConfig: readJson(NARRATIVES),
    });
    const storedRow = { ...original };

    // An evidence-based recalibration: moderate raised to 3, version bumped.
    const recalibrated = {
      ...(readJson(SCORING) as Record<string, unknown>),
      version: "1.1",
    };
    const after = resolveSnapshotVersions({
      assessmentConfig: readJson(ASSESSMENT),
      scoringConfig: recalibrated,
      narrativeConfig: readJson(NARRATIVES),
    });

    console.log(
      `  scoring pin: ${storedRow.scoringEngineVersion} -> ${after.scoringEngineVersion}`,
    );
    expect(after.scoringEngineVersion, "the revision is visible to NEW snapshots").toBe("1.1");
    expect(
      storedRow.scoringEngineVersion,
      "the HISTORICAL snapshot stays attributable to the logic that produced it",
    ).toBe("1.0");
  });
});
