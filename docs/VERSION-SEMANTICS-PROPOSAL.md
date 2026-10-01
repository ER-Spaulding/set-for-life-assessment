# Version semantics — proposal

**Status:** AWAITING APPROVAL. No migration written, no schema changed.
**Task:** operator decision #3 — *"DO NOT encode the current single-version assumption permanently."*
**Evidence:** every value below was read from the live database or the migration
files, not from memory. Queries and their results are reproduced inline.

---

## 1. What the operator asked for

Four things must be **separately identifiable**, so a historical Snapshot stays
traceable to the system that actually produced it:

1. assessment / instrument version
2. scoring / interpretation engine version
3. narrative library version
4. Snapshot payload / schema version

And: *"Existing immutable Snapshots must not be silently reinterpreted or
relabeled when future versions change."*

---

## 2. Trace: which of the four exist today

| # | Operator's identifier | Exists? | Where it lives now |
|---|---|---|---|
| 1 | assessment / instrument | ✅ | `assessment_versions.version_id` → `assessment_sessions.assessment_version` → `snapshots.assessment_version` → payload `versions.assessment` |
| 2 | scoring / interpretation engine | ✅ | `assessment_versions.scoring_config_version` → `snapshots.scoring_config_version` → payload `versions.scoring` |
| 3 | narrative library | ✅ | `assessment_versions.narrative_version` → `snapshots.narrative_version` → payload `versions.narrative` |
| 4 | **Snapshot payload / schema** | ❌ **MISSING** | — nothing anywhere |

**Three of four exist. The fourth — the payload schema version — does not, and it
is the one the operator's stated concern depends on.**

### Why the missing one is the load-bearing one

The three that exist all describe **what produced the content**. None describes
**how the content is structured**.

`loadSnapshot()` (`lib/session/service.ts`) reads `payload_json` and interprets it
with whatever parser is in the current build. There is nothing in the row that
tells the reader which shape it is holding. So if a future release changes the
payload's shape — renames `bigPicture`, changes `nullFinding` from a boolean to
an object, nests `signals` differently — the reader applies new-shape parsing to
an old-shape payload. That is precisely "silently reinterpreted", and the three
existing fields cannot detect it, because the instrument, the engine and the
narrative library can all be *unchanged* while the payload shape moves.

The payload's own `versions` object has six keys, verified live:

```json
{ "report": "1.0", "scoring": "1.0", "narrative": "1.0",
  "assessment": "1.0", "interstitial": "1.0", "questionBank": "1.0" }
```

Six versions of *source*, no version of *shape*.

### Also present, beyond the four asked for

`question_bank_version` and `interstitial_version`. These are legitimate fifth
and sixth identifiers and need no change.

---

## 3. Current schema, exactly

**`assessment_versions`** (migration `...0001`)

| Column | Type | Null | Default |
|---|---|---|---|
| `version_id` | TEXT | NO | — (PK) |
| `label` | TEXT | NO | — |
| `status` | TEXT | NO | `'draft'`, CHECK in (draft, active, archived) |
| `question_bank_version` | TEXT | NO | — |
| `scoring_config_version` | TEXT | NO | — |
| `narrative_version` | TEXT | NO | — |
| `report_version` | TEXT | NO | — |
| `created_at` | TIMESTAMPTZ | NO | `now()` |

Live contents — **exactly one row**:

```
version_id | status | question_bank_version | scoring_config_version | narrative_version | report_version
1.0        | active | 1.0                   | 1.0                    | 1.0               | 1.0
```

Guarded by `protect_published_version()`: once any session references a version,
UPDATE is refused for all four version fields and DELETE is refused entirely.

**`snapshots`** — 11 columns, live-verified:

| Column | Type | Null | Added by |
|---|---|---|---|
| `snapshot_id` | UUID | NO | `...0001` |
| `session_id` | UUID | NO | `...0001` |
| `report_version` | TEXT | NO | `...0001` |
| `rendered_payload_json` | JSONB | NO | `...0001` |
| `generated_at` | TIMESTAMPTZ | NO | `...0001` |
| `payload_json` | JSONB | YES | `20261001000001` |
| `assessment_version` | TEXT | YES | `20261001000001` |
| `question_bank_version` | TEXT | YES | `20261001000001` |
| `scoring_config_version` | TEXT | YES | `20261001000001` |
| `narrative_version` | TEXT | YES | `20261001000001` |
| `interstitial_version` | TEXT | YES | `20261001000003` |

Append-only: `trg_snapshots_append_only` refuses every UPDATE; DELETE requires
`app.erasure_authorized = 'on'` **and** a recent participant-scoped `erasure_log`
row.

**Payload `versions` object** — 6 keys, written by `assembleSnapshotPayload()`
from `PINNED_VERSION` (5 of them) and `interstitialVersion()` (1).

---

## 4. Two defects found while tracing

### D-1 — `PINNED_VERSION` is a hardcoded literal, and the code knows it

`lib/session/service.ts:60`:

```ts
export const PINNED_VERSION = "1.0";
```

It is passed **five times** into `assembleSnapshotPayload` — assessment,
questionBank, scoring, narrative, report. Only the sixth pin
(`interstitial`) reads its config.

The comment above it, already in the code, records the problem:

> *"KNOWN LIMITATION, RECORDED RATHER THAN HIDDEN: this is a hardcoded literal,
> and `config/narratives-v1.0.json` has no `version` field to read. So a
> scenario's `narrative_version` is asserted from a constant, not from the config
> that produced the copy — and it would keep claiming "1.0" after a narrative
> revision."*

**Where it is worse than that comment says.** A config-wide check shows three of
these five configs *do* carry a `version` field already:

| Config | `version` field? | Read anywhere? |
|---|---|---|
| `assessment-v1.0.json` | ✅ `"1.0"` | ⚠️ surfaced as `version` on the returned question bank, but **not** used for the Snapshot pin |
| `scoring-v1.0.json` | ✅ `"1.0"` | ❌ not read |
| `report-v1.0.json` | ✅ `"1.0"` | ❌ not read |
| `narratives-v1.0.json` | ❌ absent | — |
| `signal-state-vocabulary-v1.0.json` | ❌ absent | — |
| `connection-statements-v1.0.json` | ❌ absent | — |
| `interstitial-v1.0.json` | ✅ `"1.0"` | ✅ `interstitialVersion()` |

So the fix is smaller than the comment implies **and** larger than a one-liner:
three of the five could read their config today, two need a `version` field
added, and none of that helps until the caller stops passing a literal.

A repo-wide search for reads of a loaded config's `.version` finds exactly two
sites — `lib/assessment/questions.ts:149` (which returns it but does not feed the
pin) and `interstitialVersion()`. Everything else goes through `PINNED_VERSION`.

**Consequence:** revise the narrative library, the scoring config, or the
question bank, and every new Snapshot still records `"1.0"`. History and present
become indistinguishable — the outcome §22.6 exists to prevent, arriving through
the front door.

### D-2 — three version environment variables are dead config

`.env.local` and `.env.example` define `ASSESSMENT_VERSION`, `SCORING_VERSION`,
`NARRATIVE_VERSION`. A repo-wide grep across `app/`, `lib/`, `components/` and
`config/` finds **zero reads**. Changing them changes nothing.

They are worse than absent, because they read as the control for the pin.

---

## 5. The finding that changes the backfill question

**The `snapshots` table is empty.** Zero rows — verified by direct query, not
inference:

```
participants | 4
sessions     | 4     (all four status='completed', all pinning version '1.0')
responses    | 140
snapshots    | 0
```

Four completed sessions, no Snapshots. Before proposing any backfill I
established which of two explanations is true, because they have opposite
consequences.

### The write path is NOT broken — proven by running it

I created a provisional participant through the real route, stored a full
31-item response set against live Supabase, and called the real completion
route. Result:

```
POST /api/session/7dba3895-…/complete
{"complete":true,"sessionId":"7dba3895-…","firstName":null}   HTTP 200

snapshots WHERE session_id = … → 1 row
```

That row carries all six versions, all `"1.0"`:

```
report_version | assessment_version | question_bank_version | scoring_config_version | narrative_version | interstitial_version
1.0            | 1.0                | 1.0                   | 1.0                    | 1.0               | 1.0
```

The test record was removed with the approved `erase_participant()` mechanism.
Baseline restored exactly: **4 participants / 4 sessions / 140 responses /
0 snapshots / 0 snapshot_documents.** The four pre-existing participant records
were not touched (their `sfl_number` and `created_at` are unchanged).

### So the four missing Snapshots are history, not a live defect

The four completions ran between **12:54 and 13:47**. The commit that added the
snapshot write is `18538af` at **12:15** — before them by clock, which means the
running deployment had not picked it up yet, or those sessions were completed
against the older build. Either way:

- only **one** production completion path exists (`completeSession`), and it
  inserts the Snapshot *before* flipping status to `completed`;
- the insert is unguarded — RLS grants `service_role`, and only DELETE and
  UPDATE carry triggers;
- therefore a completed session with no Snapshot is **unreachable in current
  code**, and I could not reproduce it.

### Consequence for backfill: there is nothing to backfill from

Any attempt to give those four sessions a Snapshot would have to **recompute**
the payload from `computed_signals`, `overrides`, `tensions` and current config.
That is exactly what `loadSnapshot()` stopped doing — its own comment:

> *"§5 forbids that: the web results and the PDF must use the same completed,
> immutable snapshot_payload … a payload rebuilt on each read can drift from the
> one a PDF was generated against."*

And it would be worse than a recompute. Those sessions completed under code we
cannot identify, so a regenerated payload would carry `"1.0"` while having been
produced by today's engine — **a silent relabel**, the specific thing the
operator forbade.

**Recommendation: do not backfill.** Leave the four as they are.

**The honest cost, stated plainly:** those four participants currently cannot see
a Snapshot. `loadSnapshot()` throws on that state — deliberately, rather than
papering over it with a live recompute — and the route turns that into a 500, so
they would see "Could not load the Snapshot." This affects pre-pilot test records
only, but it is a product-visible state and belongs in the record rather than in
an assumption that nobody will look.

---

## 6. Proposed architecture — minimum, backward compatible

**One column, one payload key, one reader guard.** Nothing existing is renamed,
retyped, or removed.

### 6.1 The payload schema version

```sql
ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS payload_schema_version TEXT;
```

Mirrored into the payload's own `versions` object as `versions.payloadSchema`,
following the exact pattern `interstitial_version` already established — the
column so it is queryable in SQL, the JSON key because that is where renderers
read from.

The existing six version fields are **untouched**. This is an addition, not a
reinterpretation.

### 6.2 Where the value comes from

A constant declared **next to the shape it describes**, in
`lib/assessment/snapshot-payload.ts`:

```ts
export const PAYLOAD_SCHEMA_VERSION = "1.0";
```

This is deliberately *not* read from config, and it differs from D-1 on purpose:
the payload schema version describes the **shape of the object**, which changes
only when a developer edits the assembler. A code constant adjacent to that
assembler is the accurate place, and it cannot drift the way a literal in a
distant file can.

### 6.3 The reader guard — the part that actually satisfies the requirement

A version number nobody checks is decoration. `loadSnapshot()` gains:

```ts
const SUPPORTED_PAYLOAD_SCHEMAS = ["1.0"];

const schema = payload.versions?.payloadSchema ?? "1.0";  // absent ⇒ the 1.0 writer
if (!SUPPORTED_PAYLOAD_SCHEMAS.includes(schema)) {
  throw new Error(
    `session: Snapshot ${snapshotId} was written by payload schema ${schema}, ` +
    `which this build does not understand. Refusing to interpret it.`,
  );
}
```

**The `?? "1.0"` default is historically accurate, not a convenience.** Any row
predating the column was written by the 1.0 assembler, so reading it as 1.0 is a
statement of fact. Going forward the writer always sets it, so the fallback
should never fire — and a test will assert that.

This is the mechanism that makes "must not be silently reinterpreted" true: a
build that does not recognise a payload's shape **refuses and says so**, rather
than applying current assumptions to old data.

### 6.4 Nullability — a deliberate choice

Nullable, **not** `NOT NULL DEFAULT`. A default would label rows by accident,
which is the failure mode D-1 already demonstrates. The reader guard provides the
safety; the constraint would only provide the appearance of it.

### 6.5 Migration safety

`ADD COLUMN IF NOT EXISTS … TEXT` with no default and no rewrite. On this
database it touches **zero rows**. On any environment that does have rows, those
rows read as schema `1.0` by the rule above, which is what they are. No backfill
statement runs at all.

---

## 7. Migration consequence for existing 1.0 Snapshots

| Question | Answer |
|---|---|
| Rows affected | **0** — the table is empty |
| Backfill needed | **No** — and none is possible without fabrication |
| Existing columns changed | **None** |
| Existing payloads relabeled | **None** — the four sessions have no payloads |
| Downtime | None — `ADD COLUMN` on an empty table |
| Rollback | `DROP COLUMN` |

The usual risk of this migration — relabeling history — is absent **only because
the history does not exist yet**. That is an accident of timing, not a property
to rely on. The reader guard is what makes the next version change safe, and it
should land in the same change as the column.

---

## 8. What this proposal does NOT decide

Deliberately out of scope, and each needs the operator:

1. **D-1, the `PINNED_VERSION` literal.** The mechanical part is now measured:
   three configs already carry a `version` field, two need one added, and the
   caller must stop passing a literal. The part that is genuinely a product
   judgment is what a version *means* once it is read — a hand-bumped label, or
   a content hash over the config's bytes (which catches an edit made without a
   bump, the silent failure mode here). That is the §D-7 decision the operator
   deferred. This proposal adds the fourth identifier without touching those
   five.

2. **D-2, the dead env vars.** Delete them, or wire them up. Leaving them is the
   one option that is actively misleading.

3. **Whether `versions` should carry a content hash** rather than a label, so a
   config edited without a version bump is detectable. Stronger than a version
   string; a larger change.

---

## 9. Recommendation

**Approve §6 as scoped**: add `payload_schema_version` (column + payload key),
source it from a constant beside the assembler, and add the reader guard that
refuses an unrecognised schema.

**Approve §5's no-backfill**: the four legacy sessions stay as they are, and the
reason is recorded rather than the gap being quietly filled.

Then take D-1 and D-2 as separate decisions — they are about what version
*identity* means for the five existing identifiers, which is a product judgment,
not a schema one.
