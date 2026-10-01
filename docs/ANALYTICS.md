# Analytics — first-party event system

**Implementing:** Addendum 02 v1.1 §16
**Decision:** operator, 2026-10-01 — first-party in Supabase, no third-party vendor
**Purpose:** product/operational measurement, not collection of participant financial content

---

## 1. What this is, and what it deliberately is not

A single table, `analytics_events`, in the same Supabase project. No vendor, no
pixel, no external endpoint. The §16 events answer questions about **this
product's funnel** — does removing the identity wall improve assessment starts?
At what point do participants volunteer to save progress? — which is first-party
product measurement rather than the behavioural analytics a vendor earns its keep
on.

Keeping it in-project is also what makes §16's constraint true **by
construction** rather than by configuration review:

> "Do not send raw financial answers to third-party analytics."

There is no third party to send anything to.

---

## 2. Event names, and where each one's truth lives

The vocabulary is closed. `event_name` carries a CHECK constraint, so adding an
event is a migration — a review point, not a silent write.

Every event also carries an **origin** (`EVENT_KIND` in `lib/analytics/events.ts`),
and the origin decides who is allowed to record it. This is not bookkeeping. A
browser cannot be trusted to report that an assessment started or that a
Snapshot was served — those claims are only true because the *server* did
something — so they are recorded at the moment the server does it. Only the four
genuinely browser-only events travel over the client route.

| Event | When | Origin | Payload keys used |
|---|---|---|---|
| `assessment_started` | Provisional participant + session created | server | `channel` |
| `assessment_resumed` | A participant returns to an in-progress session | server | `position` |
| `assessment_completed` | Server-side completion succeeds | server | — |
| `assessment_abandoned` | Session left incomplete (see §5) | server | `position` |
| `question_position_reached` | Progress marker for funnel analysis | server | `position` |
| `money_moment_displayed` | A Money Moment renders | **client** | `moment`, `position` |
| `money_moment_continued` | Participant leaves a Money Moment | **client** | `moment` |
| `save_progress_offered` | The §3.4 prompt is shown | **client** | — |
| `save_progress_used` | Verification link actually sent by the claim route | server | — |
| `save_progress_skipped` | "Keep Going Without Saving" chosen | **client** | — |
| `returning_flow_started` | A Set for Life Number was submitted | server | `outcome` |
| `returning_flow_completed` | Lookup answered (202) | server | — |
| `snapshot_generated` | Payload persisted at completion | server | — |
| `snapshot_viewed` | A completed Snapshot was served | server | — |
| `snapshot_pdf_generated` | PDF rendered | server | `surface` |
| `snapshot_pdf_downloaded` | Signed download served | server | `surface` |
| `system_error` | Operational failure | server | `code`, `ok` |

### The anti-enumeration rule reaches into the event table

`returning_flow_started` is recorded **for every well-formed number**, whether or
not it resolved, and carries no `outcome` on that path. §4.2's posture is that
the lookup must not reveal whether a record exists; writing that distinction into
a table an operator can read would be the same disclosure arriving by another
door. The only `outcome` value used is `"invalid_number"`, for a submission that
failed its own checksum — a number that by construction belongs to nobody.

`returning_flow_completed` is likewise recorded for every well-formed number. Its
count is therefore **not** a count of real participants, and must not be read as
one.

### The client/server split, and the bug that forced it

The first implementation had four client components importing `recordEventInBackground`
from `lib/analytics/write.ts`. That module imports the service client, which
imports `server-only` — correctly, because the service-role key bypasses Row
Level Security and must never reach a bundle. **The build failed**, which is the
only reason nothing leaked:

```
'server-only' cannot be imported from a Client Component module
```

The fix is a boundary, not a workaround:

| Concern | Module | May be imported by |
|---|---|---|
| Vocabulary, payload guard, origin map | `lib/analytics/events.ts` | anyone (pure) |
| Server writer | `lib/analytics/write.ts` | server only |
| Browser reporter | `lib/analytics/client.ts` | client components |
| Browser-reportable endpoint | `app/api/analytics/event/route.ts` | the browser |

**Client components import from `./client`, never from `./write`.** Four tests in
`tests/unit/analytics.test.ts` enforce it: no client component may import the
server writer; the writer's `server-only` guard must still exist; the client route
must accept only client-origin events; and every declared event must have an
origin.

That third test was **a false green when first written** — the guard test matched
its own explanatory comment, which quotes `import "server-only"` in prose, so
deleting the real guard left it passing. The tests now strip comments before
matching, and a fifth test pins the stripper's behaviour so it cannot silently
become a no-op. All five were mutation-tested by reintroducing the defect.

---

## 3. Payload schema

A flat object of scalars. **Enforced by the database**, not by convention.

```jsonc
{
  "position": 12,          // number
  "moment": "MM03",        // string, ≤ 64 chars
  "decision": "skipped",   // string
  "ok": true               // boolean
}
```

**Allowed keys** (an allow-list, and that choice is load-bearing):

`position`, `step`, `moment`, `decision`, `outcome`, `channel`, `ok`, `retry`,
`count`, `duration_ms`, `code`, `surface`, `stage`

Plus limits: at most 12 keys, string values at most 64 characters, no nested
objects or arrays.

### Why an allow-list rather than a deny-list

The first implementation was a deny-list of forbidden names — `answers`,
`income`, `narrative`, and so on. **It failed.** Against a real database,
`{"q1":"Q1_A"}` was **accepted**: `q1` is not a forbidden word, and the leak was
in the *value*, not the key. A deny-list can only ever reject the leaks someone
thought of.

The allow-list inverts that. Every key must be one of the structural names above,
so an answer cannot arrive under an unanticipated name. It permits *where*, *which*
and *how many* — never *what did they answer*.

### Forbidden content — verified refused

Raw answers · option codes · Snapshot narrative · household income · financial
amounts · free-text financial content · email · phone · state code · nested
objects · arrays · strings long enough to hold prose.

Each is covered by a test, and each was additionally run against live Postgres to
confirm the SQL function and the TypeScript guard agree. **17 payload shapes, 0
divergences.**

---

## 4. Access control

**Database-enforced.** RLS is enabled on `analytics_events` and the only policy
grants `service_role`. There is no `anon` or `authenticated` policy, so:

- a browser holding the anon key can read **nothing**;
- a browser cannot write a single event;
- only server-side code with the service-role key touches the table.

Aggregate views (`eventCounts()`) return plain counts and no participant data, so
an operator view built on them exposes no individual record.

**Erasure.** Both foreign keys are `ON DELETE CASCADE`, so erasing a participant
(§24) removes their analytics rows with them. Measurement data must not outlive
the participant it describes.

---

## 5. Known gaps — stated, not implied

**VERIFIED, not recalled.** The table below was produced by scanning the source
for each event name, and the scan has now been run three times — each run
disagreeing with what the previous prose claimed. The first draft of this section
listed two gaps from memory; the scan found six. The second draft's prose said
"ten of seventeen" beside a table showing eleven. The check is written down here
precisely because it keeps catching something.

| Event | Emitted? | Recording site | Why not, where not |
|---|---|---|---|
| `assessment_started` | ✅ | `api/participant/provisional/route.ts` | |
| `assessment_resumed` | ❌ | — | The resume path exists (`loadResumeState`) but nothing calls the event yet. Cheap to add; omitted so far. |
| `assessment_completed` | ✅ | `api/session/[id]/complete/route.ts` | |
| `assessment_abandoned` | ❌ | — | Needs a timeout sweep (no scheduled job exists) or an unload beacon (unreliable, fires on non-abandoning navigation). **No abandonment data is collected today**, so §16's abandonment pilot question cannot yet be answered — and unlike the other gaps, this one cannot be closed by adding a call. |
| `question_position_reached` | ❌ | — | Would add a write per screen with no current consumer. `money_moment_displayed` already carries `position`, which covers the funnel resolution the pilot questions need. |
| `money_moment_displayed` | ✅ | `assessment/[sessionId]/page.tsx` | |
| `money_moment_continued` | ✅ | `assessment/[sessionId]/page.tsx` | |
| `save_progress_offered` | ✅ | `assessment/[sessionId]/page.tsx` | |
| `save_progress_used` | ✅ | `api/participant/claim/route.ts` | |
| `save_progress_skipped` | ✅ | `assessment/[sessionId]/page.tsx` | |
| `returning_flow_started` | ✅ | `api/auth/lookup/route.ts` | |
| `returning_flow_completed` | ✅ | `api/auth/lookup/route.ts` | |
| `snapshot_generated` | ✅ | `api/session/[id]/complete/route.ts` | |
| `snapshot_viewed` | ✅ | `api/session/[id]/snapshot/route.ts` | |
| `snapshot_pdf_generated` | ❌ | — | **The PDF renderer does not exist yet** (implementation order step 6). The event is defined so the schema need not change when it lands. |
| `snapshot_pdf_downloaded` | ❌ | — | Same — no signed-download path exists yet (step 7). |
| `system_error` | ❌ | — | No error boundary currently records it. Routes return structured error bodies; nothing writes an event. |

**Eleven of seventeen events are live.** The six that are not are deliberate
omissions with stated costs, except the three blocked on work not yet built (PDF
generation, PDF download). None is silently absent.

### What this means for the §16 pilot questions

| §16 question | Answerable today? |
|---|---|
| Does removing the identity wall improve assessment starts? | **Yes** — `assessment_started` vs `assessment_completed`. |
| At what point do participants volunteer to save progress? | **Yes** — `save_progress_offered` vs `save_progress_used`. |
| Where do participants abandon? | **No.** `assessment_abandoned` is not emitted. `money_moment_displayed` gives funnel position for participants who continued; it cannot see someone who closed the tab. |

That third row is the honest cost of the gap and the strongest argument for
closing it (the last row of §5).

---

## 6. Retention — UNDECIDED, and deliberately so

**The governing specification provides no retention period.** The operator's
instruction was explicit:

> "Do not silently invent a permanent retention period if the governing
> specification does not provide one; surface that as a privacy/product decision."

So:

- `retain_until` exists and is **NULL** for every row. There is no DEFAULT,
  because a default would be a decision made by accident.
- Nothing expires. No TTL, no scheduled deletion.
- The undecided state is **queryable**, so it cannot hide:

```sql
SELECT * FROM analytics_retention_status;
--  events_with_no_retention_decided | events_total | oldest_event | newest_event
```

That view exists so a privacy review sees the answer to "how much are we holding
with no policy?" as a number, rather than discovering it later.

### The decision that is needed

| Option | Consequence |
|---|---|
| **Rolling 24 months** | Long enough to compare pilot cohorts year over year; bounded. |
| **Rolling 12 months** | Tighter; enough for pilot and first-year comparison. |
| **Aggregate-then-delete** (e.g. 90 days raw → counts retained) | Strongest minimisation; loses per-session funnel reconstruction. |
| **Event-specific windows** | Errors kept longer than funnel events, or vice versa. |

**Recommendation: a rolling 12-month window on raw events**, with the funnel
counts the pilot actually needs retained in aggregate beyond it. The §16
questions are about *this pilot*; 12 months covers the pilot and its immediate
comparison, and minimisation is easier to defend than retention "just in case".

**This is a privacy/product decision and is NOT made here.**

---

## 7. Who can access aggregate analytics

**Today: anyone with the service-role key** — i.e. server-side code and whoever
holds the project credential. There is no operator dashboard, no role-scoped
read, and no audit of who queried what.

That is adequate for a pilot with a single operator and **not adequate beyond
it**. A production deployment needs a named operator role with read-only access
to the aggregate views, so that "who can see participant measurement data" has an
answer better than "whoever has the root key".

Recorded as a gap rather than implied to be solved.

---

## 8. Implementation map

| Concern | Location |
|---|---|
| Event vocabulary, payload guard | `lib/analytics/events.ts` |
| Write path (never throws) | `lib/analytics/write.ts` |
| Table, CHECK, RLS, retention view | `supabase/migrations/20261001000008_analytics_events.sql` |
| Tests | `tests/unit/analytics.test.ts` |

**Fire-and-forget by design.** Every call site is a participant action — saving
progress, completing an assessment. Measurement must never be able to break one
of those, so the writer never throws and never rejects. A failed analytics write
is a gap in a chart; a thrown error there would be a broken Save My Progress.
