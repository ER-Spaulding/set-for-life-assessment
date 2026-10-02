// The four immutable version identifiers. Addendum 01 §3, PRD §22.6.
//
// Operator decision 2026-10-01: implement separately identifiable versions for
//
//   instrument_version         assessment / question / response structure
//   scoring_engine_version     scoring, override, tension and synthesis logic
//   narrative_library_version  the approved participant-facing narrative library
//   snapshot_schema_version    structure of the persisted snapshot_payload
//
// Each is persisted at Snapshot creation and is IMMUTABLE thereafter. A later
// release must never silently relabel an existing Snapshot as though the newer
// version had produced it — which is why these are read from the artifacts
// themselves rather than from a constant that drifts.
//
// WHY THEY REPLACE `PINNED_VERSION`. That was a single hardcoded "1.0" passed
// five times, and it would keep claiming "1.0" forever. Revise the narrative
// library, the scoring config or the question bank, and every new Snapshot
// still recorded "1.0" — history and present indistinguishable, which is exactly
// the outcome §22.6 exists to prevent. The interstitial pin already did this
// correctly, by reading its own config; this generalises that to all four.
//
// PURE — no I/O beyond reading the config files it is given, no clock, no
// randomness. The caller supplies the loaded configs.

import { createHash } from 'node:crypto';

/** The four identifiers, as persisted alongside a Snapshot. */
export interface SnapshotVersions {
  /** Assessment / question / response structure. */
  instrumentVersion: string;
  /** Scoring, override, tension and synthesis logic. */
  scoringEngineVersion: string;
  /** The approved participant-facing narrative library. */
  narrativeLibraryVersion: string;
  /** The structure of the persisted snapshot_payload itself. */
  snapshotSchemaVersion: string;
}

/**
 * The payload SCHEMA version — the shape of what `assembleSnapshotPayload`
 * writes.
 *
 * Declared HERE, beside the version logic, rather than read from a config,
 * because it describes the structure of a TypeScript object rather than the
 * contents of a JSON file. It changes only when a developer edits the
 * assembler's output shape, and bumping it is a deliberate act with a reader
 * consequence: `assertSupportedSchema` below refuses a payload whose schema it
 * does not recognise.
 *
 * BUMP THIS whenever `SnapshotPayload`'s shape changes incompatibly — a renamed
 * key, a changed type, a moved field. Adding an optional field does not require
 * a bump.
 */
export const SNAPSHOT_SCHEMA_VERSION = '1.0';

/**
 * The schema versions this build can interpret.
 *
 * The reader guard is what makes "must not be silently reinterpreted" true: a
 * build that does not recognise a payload's shape REFUSES and says so, rather
 * than applying current assumptions to historical data.
 */
export const SUPPORTED_SNAPSHOT_SCHEMAS: readonly string[] = ['1.0'];

/** The schema a pre-column Snapshot was written by — see `resolveSchemaVersion`. */
export const IMPLICIT_LEGACY_SCHEMA = '1.0';

/**
 * A content hash over an artifact's bytes.
 *
 * WHY THIS EXISTS ALONGSIDE THE LABEL. A hand-maintained `version` field only
 * moves when someone remembers to move it. Edit `narratives-v1.0.json` without
 * bumping its version and the label lies — and it lies silently, in the
 * direction that is hardest to notice, because every report still reads "1.0"
 * and nothing looks wrong.
 *
 * The hash cannot lie: it is derived from the bytes, so any edit changes it. It
 * is recorded next to the label, not instead of it — the label is what a human
 * reads, the hash is what proves the label still refers to the same artifact.
 *
 * Canonicalisation: the parsed object is re-serialised with sorted keys, so
 * reformatting a config (whitespace, key order) does NOT change its hash. Only
 * a change to the CONTENT does.
 */
export function contentHash(artifact: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) out[key] = canonical(obj[key]);
      return out;
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(artifact)))
    .digest('hex');
}

/** Read a `version` string off a loaded config, or throw. */
function versionOf(label: string, config: unknown): string {
  const v = (config as { version?: unknown } | null)?.version;
  if (typeof v === 'string' && v.trim()) return v.trim();
  throw new Error(
    `versions: ${label} has no readable "version" field. Every versioned artifact ` +
      `must declare one — a missing version would otherwise be recorded as another ` +
      `artifact's version, which is the silent mislabelling this module exists to prevent.`,
  );
}

/**
 * Resolve all four identifiers from the artifacts that produced the Snapshot.
 *
 * Throws on a missing version rather than defaulting. A default is how a report
 * comes to claim a version that did not produce it.
 */
export function resolveSnapshotVersions(input: {
  assessmentConfig: unknown;
  scoringConfig: unknown;
  narrativeConfig: unknown;
}): SnapshotVersions {
  return {
    instrumentVersion: versionOf('assessment config', input.assessmentConfig),
    scoringEngineVersion: versionOf('scoring config', input.scoringConfig),
    narrativeLibraryVersion: versionOf('narrative config', input.narrativeConfig),
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

/**
 * The schema version of a STORED payload.
 *
 * A payload written before the schema version was recorded carries no marker.
 * Reading it as `IMPLICIT_LEGACY_SCHEMA` is a statement of historical fact
 * rather than a convenience default: every row predating the column was written
 * by the 1.0 assembler, because no other assembler existed.
 *
 * Going forward the writer always sets it, so the fallback should never fire —
 * and `snapshot-versions.test.ts` asserts that new writes always carry an
 * explicit marker.
 */
export function resolveSchemaVersion(payload: unknown): string {
  const marker = (payload as { versions?: { snapshotSchema?: unknown } } | null)?.versions
    ?.snapshotSchema;
  return typeof marker === 'string' && marker.trim() ? marker.trim() : IMPLICIT_LEGACY_SCHEMA;
}

/**
 * Refuse to interpret a payload whose schema this build does not understand.
 *
 * THE POINT OF THE WHOLE EXERCISE. Without this, "we versioned the payload" is
 * decoration: the reader would still apply current-shape parsing to an
 * old-shape object and produce confidently wrong results. Throwing is the only
 * honest response — a Snapshot that cannot be read correctly must not be read
 * approximately.
 */
export function assertSupportedSchema(payload: unknown, snapshotId?: string): string {
  const schema = resolveSchemaVersion(payload);
  if (!SUPPORTED_SNAPSHOT_SCHEMAS.includes(schema)) {
    throw new Error(
      `versions: Snapshot ${snapshotId ?? '(unknown)'} was written by payload schema ` +
        `${schema}, which this build does not understand (supported: ` +
        `${SUPPORTED_SNAPSHOT_SCHEMAS.join(', ')}). Refusing to interpret it.`,
    );
  }
  return schema;
}
