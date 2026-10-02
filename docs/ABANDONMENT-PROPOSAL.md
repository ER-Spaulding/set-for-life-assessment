# Assessment abandonment — proposed definition

**Status:** PROPOSAL. Nothing implemented. The operator asked to see the window,
the logic, and the retention consequence **before** the definition is locked.

**Operator instruction, verbatim:**

> "Do not add an unload beacon or arbitrary abandonment event yet. Propose a
> first-party, privacy-conscious definition of assessment abandonment that
> distinguishes: active/in-progress; saved for later; resumed; completed;
> inactive beyond a defined window. The solution should allow us to answer where
> participants tend to stop without transmitting raw answers or sensitive
> financial content into analytics. Show the proposed inactivity window/logic and
> data-retention consequence before locking that definition."

---

## 1. What already exists, so this invents as little as possible

Nothing in this proposal needs a new table. The schema already distinguishes most
of the states, and one enum value is already reserved:

| Concept | Where it lives now | Used? |
|---|---|---|
| `in_progress` | `assessment_sessions.status` CHECK | ✅ |
| `completed` | same CHECK, plus `completed_at` | ✅ |
| **`abandoned`** | **same CHECK** | ❌ **reserved, never written** |
| **`expired`** | **same CHECK** | ❌ **reserved, never written** |
| `last_activity_at` | column, `TIMESTAMPTZ NOT NULL` | ✅ maintained |
| `current_position` | column, `INTEGER NOT NULL` | ✅ maintained |
| Saved for later / claimed | `participants.claimed_at` + verified contact | ✅ |
| Resumed | `assessment_resumed` event | ❌ defined, never emitted |

**The status enum already anticipated `abandoned` and `expired`.** That is a
strong signal about the intended shape: two distinct states, not one, which is
exactly the distinction the operator asked for.

**The infrastructure for a server-side window already exists, and was verified
rather than assumed:**

- `last_activity_at` is written on **every** response — both in
  `app/api/session/[id]/response/route.ts:158` and again by a trigger
  (`20260930000002_immutability.sql:167`, `NEW.last_activity_at = now()`). It is
  not stale, so a window computed from it is trustworthy.
- `current_position` is maintained on the same write path.
- **An index already exists for exactly this query:**
  `idx_sessions_status_activity ON assessment_sessions(status, last_activity_at)`.

That last one is the strongest signal of intent in the schema: an index on
`(status, last_activity_at)` has no other purpose than sweeping sessions by
status and inactivity. The index was built for this feature and the feature was
never written.

---

## 2. The five states, defined

| State | Definition | Source of truth |
|---|---|---|
| **active / in-progress** | `status = 'in_progress'` AND `now() - last_activity_at < ACTIVE_WINDOW` | session row |
| **saved for later** | `in_progress`, past `ACTIVE_WINDOW`, AND the participant has a **verified** contact (`participant_contacts.verified_at IS NOT NULL`) | session + contact rows |
| **resumed** | an `in_progress` session that received a response **after** a gap exceeding `ACTIVE_WINDOW` | responses' `answered_at` |
| **completed** | `status = 'completed'` | session row |
| **inactive beyond the window** | `in_progress` AND past `INACTIVE_WINDOW` | session row |

### The key distinction: saved-for-later is NOT abandonment

This is the part worth getting right, and it is why a single timeout would be
wrong. A participant who chose **Save My Progress** and was sent a verification
link has **not abandoned** — they did the thing the product asked them to do. The
product will email them a link back. Counting them as abandoned would make the
funnel report a failure that is actually a success, and would be worst precisely
among the most engaged participants.

So **saved-for-later is its own state**, and it is detectable without any new
data: the verified contact IS the "saved" flag, because the identity flow is the
only way to get one.

---

## 3. The windows — PROPOSED, for approval

| Window | Proposed | Why |
|---|---|---|
| `ACTIVE_WINDOW` | **30 minutes** | A participant mid-assessment who pauses to answer the door is still active. Well above any plausible reading pause, well below a session that has ended. |
| `INACTIVE_WINDOW` | **7 days** | Long enough that a "saved for later" participant who intends to return has had a fair chance; short enough to answer the pilot question within the pilot. |
| `RESUME_GAP` | **30 minutes** | Same as ACTIVE — a resumption after a real break, not a page reload or a pause between questions. |

### Where each window is used, and why they are different

- **`ACTIVE_WINDOW` is for CLASSIFICATION while the pilot runs.** It answers "is
  this person still with us right now", which is what makes "where do they stop"
  answerable.
- **`INACTIVE_WINDOW` is for RETENTION and the `expired` transition.** It is
  deliberately much longer, because marking a session expired is a statement to
  the participant, and being wrong in that direction loses someone who was coming
  back.

**Both are proposals.** The 30-minute figures are judgement; 7 days is judgement.
The operator should set them, and they should live in config next to the other
calibrated values so a revision is versioned.

### Why NOT an unload beacon

The operator already ruled this out, and it is worth recording why that was
right: `beforeunload`/`visibilitychange` fire on **every** navigation — tab
switches, phone calls, app backgrounding, back-button use. A beacon would emit an
"abandonment" event for a participant who was merely interrupted, and the funnel
would fill with false abandonments. Worse, it fires **more** for mobile users,
who background apps constantly, so the bias would fall on exactly the population
a 320px-first product is built for.

A window is computed server-side from data already stored. It cannot fire
spuriously, it costs nothing at the moment of abandonment, and it works when the
browser never gets a chance to send anything — which is what actually happens
when someone closes a tab.

---

## 4. What gets recorded, and what never does

### The event

**No new event.** Abandonment is derived, not emitted. The §16 event list already
contains `assessment_abandoned`, and it stays as defined; the *definition* of when
it fires is what this document supplies.

When the sweep runs and transitions a session, it records:

```
assessment_abandoned
  participant_id   (correlator only)
  session_id       (correlator only)
  payload: { position: <integer>, stage: "<derived label>" }
```

### The payload carries a NUMBER and a LABEL — never content

| Field | Example | Why it is safe |
|---|---|---|
| `position` | `14` | How many items were reached. A count, not an answer. |
| `stage` | `"diagnostic"` | A coarse phase label from a **closed set**: `opening`, `diagnostic`, `activation`, `profile`. It says which PART of the assessment, not what was said in it. |

**`stage` is derived by position, not by reading answers.** The label comes from
mapping `current_position` onto the instrument's own section boundaries. The
sweep never reads a response value — it does not need to, and the analytics
payload allow-list already refuses any key that could hold one.

**This is what answers "where do participants tend to stop":** a histogram of
`position` at abandonment. That is a count per question, which is exactly the
resolution the pilot question needs, and it is reachable with one integer.

### What is explicitly NOT recorded

Raw answers · option codes · signal values · tension codes · the Snapshot ·
narrative text · household income · any free text. The existing
`analytics_payload_is_safe()` allow-list already refuses these by construction —
`position` and `stage` are on it; nothing that could hold an answer is.

---

## 5. Retention consequence

**The event inherits the retention decision that is still open** — this proposal
does not and cannot settle it (see `docs/ANALYTICS.md` §6).

What changes is the **volume and the sensitivity profile**:

| | Before | After |
|---|---|---|
| Abandonment rows | 0 | up to one per incomplete session |
| Carries | — | two correlators, one integer, one closed-set label |
| Participant link | — | yes, via `participant_id` |
| Erasure | — | cascades with the participant (§24) |

**The consequence worth flagging:** abandonment events carry a
`participant_id`, so they are **participant-linked**, not aggregate-only. That is
what makes per-participant funnel reconstruction possible — and it is also what
makes them personal data rather than statistics. They inherit the undecided
retention period, and they cascade-delete on erasure.

If the operator prefers abandonment data to be **non-linkable**, the alternative
is to store only `(position, stage, occurred_at)` with NO correlator. That answers
"where do participants stop" equally well and is meaningfully more private — the
cost is that it can no longer answer "did THIS participant come back", which is
the resumed-vs-abandoned distinction. **This is the one genuine privacy trade in
the proposal, and it is the operator's call.**

---

## 6. How the sweep would run

**A scheduled job, not a request-time computation.** Two options:

1. **Supabase `pg_cron`** — runs inside the database, no new infrastructure, no
   participant data leaving. Recommended for a pilot.
2. **A Vercel cron hitting an internal route** — same logic, needs a deployed
   scheduler and the existing `INTERNAL_HARNESS_TOKEN`-style protection.

Either way the sweep is **idempotent** and **forward-only**:

- it transitions `in_progress` sessions past `INACTIVE_WINDOW` to `expired`,
  recording `assessment_abandoned` once per session (guarded by the existing
  status, so a second run is a no-op);
- it never mutates a `completed` session;
- it never deletes anything — `expired` is a state, not a cleanup.

**Frequency:** hourly is sufficient. The finest window proposed is 30 minutes,
and a classification that lags by up to an hour is immaterial for a pilot
question measured over weeks.

---

## 7. What this does NOT answer, stated plainly

- **It cannot distinguish "gave up" from "got interrupted and will return."** No
  server-side signal can. `expired` means "no activity for 7 days", which is a
  fact; the interpretation is the pilot's to make.
- **The `assessment_resumed` event is still not emitted.** The resumed state is
  detectable from `answered_at` gaps, but nothing records it as an event today.
  Emitting it is a small addition to the resume path and is not included here.
- **Nothing is implemented.** The windows are proposals, the retention trade is
  open, and the sweep does not exist.

---

## 8. What the operator is being asked to decide

1. **The three windows** — 30 min / 7 days / 30 min, or other values.
2. **The privacy trade in §5** — participant-linked abandonment events, or
   non-linkable `(position, stage, time)` only.
3. **Whether the sweep should ship at all for the pilot**, or whether the
   question "where do participants stop" can wait for a second cohort.

Nothing else in this document needs a decision.
