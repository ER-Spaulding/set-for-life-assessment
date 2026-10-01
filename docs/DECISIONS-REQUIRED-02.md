# Decisions Required — Addendum 02 v1.1 Close-Out

**Prepared:** 2026-10-01 · **Status:** AWAITING OPERATOR DECISION. Nothing here is encoded.

Two items were to be surfaced only after the Demographics screen and the live
end-to-end claim verification passed. Both passed. This is the register.

**Companion:** `docs/DECISIONS-REQUIRED.md` covers the §B null-finding decision
(now implemented) plus the original framing. This file covers the two items that
remain open.

---

# PART A — Addendum 02 v1.1 completion status

## Verified by execution against live Supabase (not fixtures)

The full journey was driven through the real HTTP API against the live project:

provisional participant → 31 responses → Money Moment 01 → Save My Progress →
claim link → verification → claimed → same participant, session and responses.

| Required check | Result |
|---|---|
| No duplicate participant created | **PASS** — 5 before claim, 5 after |
| No response duplicated or lost | **PASS** — 31 before, 31 after |
| Set for Life Number stays with the participant | **PASS** — `203P-22X4` unchanged |
| Session ownership transfers correctly | **PASS** — same `participant_id` |
| Existing answers remain intact | **PASS** |
| Verification exposes no other record | **PASS** — 6/6 leak checks clean |
| Identity conflict refused, not merged | **PASS** — HTTP 409 + clear message |
| Returning lookup resolves correctly | **PASS** — 202, byte-identical to unknown |
| First-name welcome from resolved identity | **PASS** — "Marisol" |
| Behaves correctly on the live DB | **PASS** — all of the above ran live |

Two security properties verified live that are worth naming:

- **Anti-enumeration holds.** A malformed number returns **400** ("check the
  number"), a well-formed but unknown number returns **202** — identical to a
  known one. The endpoint is not an oracle for which numbers exist.
- **Lookup returns no participant data.** The response was checked for the
  number, the name, the participant UUID, the email, and both `sessionId` and
  `participantId` — none present. §4.2 ("never ... solely by entering a
  known/guessed number") is satisfied structurally, not by policy.

## Cleanup

Only the two records this run created were erased, via the sanctioned
`erase_participant` mechanism. Final state is **identical to the pre-run
baseline**: participants 4, sessions 4, responses 140, contacts 4. The four
pre-existing participants are untouched (same creation timestamps).

## What is NOT complete

> **STATUS UPDATE 2026-10-01.** This section is retained for the record but its
> central claim is now **out of date**. Analytics **is** implemented:
> first-party in Supabase, per your decision of this date. See `docs/ANALYTICS.md`
> for the event vocabulary, the payload allow-list, the access model, the
> retained-but-undecided retention state, and a **verified** gap table showing
> which events actually fire. The text below is what was true when written and is
> left in place rather than quietly rewritten.

Per your instruction, I am not calling the entry/pacing work complete. At the
time of writing, one acceptance criterion from §18 was unimplemented:

**§16 ANALYTICS — was not implemented.** No events were emitted anywhere. §18
lists "Analytics can compare start/completion/abandonment behavior" as done; it
was not. The events named in §16 are: `opening_first_time_selected`,
`opening_returning_selected`, `save_progress_offered`, `save_progress_selected`,
`continue_without_saving_selected`, `identity_verification_started/completed/failed`,
`returning_lookup_started/resolved/failed`, `money_moment_viewed/continued`,
`abandonment point`, `resume point`, `assessment completion time`,
`completion rate`.

Note the naming divergence, which is resolved rather than ignored: the shipped
vocabulary does not use `opening_first_time_selected` / `opening_returning_selected`.
Opening A's answer is carried into the session as the real `OPEN_A` response, so
the branch is already recorded as instrument data, and `assessment_started`
carries `channel: "first_time"`. Emitting two more events for the same fact would
have been duplication dressed as coverage. `docs/ANALYTICS.md` §2 maps each §16
event name to what shipped.

§16 also sets a constraint that shapes the implementation — *"Do not send raw
financial answers to third-party analytics"* — and **does not specify a
destination, retention period, or vendor**. That is a privacy decision, not an
engineering one. See **Part B, item 3**.

## Everything else, confirmed

| Criterion | Status |
|---|---|
| Opening A is the first meaningful interaction | done |
| First-time participants begin without an identity wall | done |
| Provisional identity/session created behind the scenes | done |
| Optional Save My Progress after MM01 | done |
| Keep Going Without Saving | done |
| Returning participants enter the number after selecting No | done |
| Protected data requires verification beyond the number | done |
| Returning participants greeted by first name | done |
| Five Money Moments at locked placements | done, placement derived from config |
| Historical Money Moments removed | none existed |
| Money Moments do not telegraph later answers | none of §8's prohibited subjects appear |
| Money Moments add nothing to the 31 | asserted: 31 unchanged |
| Save/resume and back navigation | done — a seen moment is not re-forced |
| Mobile/accessibility QA | responsive by construction; **not tested at 320px on a device** |
| Demographics screen with State | done |
| Reveal begins only after all required responses | done — profile step sits before completion |

---

# PART B — The two decision sets

## Item 1 — The 46 configurable values

All 46 carry `_calibration_status`. **They are live at runtime** and nothing
surfaces that fact (`lib/assessment/scoring.ts:102` skips `_`-prefixed keys, so
the engine reads the value and never the warning). Changing any of them changes
participant-facing output with no code change.

**Provenance change worth noting:** `null_finding.operationalization` is now
`OPERATOR_APPROVED_2026_10_01` (Option 2), so 45 remain assumed.

### Group 1 — TECHNICAL DEFAULTS (no product meaning; I will proceed unless you object)

| Setting | Value | Controls | Needs you |
|---|---|---|---|
| PDF page size | US Letter portrait | §8 requirement | no |
| Signed-URL lifetime | 15 min proposed | download window | no |
| PDF retries | 3, then surface failure | §7.3 keeps web results up | no |
| Checksum | SHA-256 | integrity metadata | no |
| Storage prefix | `snapshots/{id}/{version}.pdf` | no participant id in path | no |
| Payload store | `snapshots.payload_json` | both renderers read one row | no |

### Group 2 — SCORING (all materially affect a participant)

**2a. State bands — 30 values** (6 signals × 5). `S1 1.00–1.79 · S2 1.80–2.59 ·
S3 2.60–3.39 · S4 3.40–4.19 · S5 4.20–5.00`, uniform across signals.

- **Controls:** the only thing turning a mean into a human-facing label.
- **Consequence of changing:** moving a boundary 0.1 moves real participants
  between "Developing" and "Clear" — and because S3/S4 also drives the
  null-finding gate **and** evidence confidence, one change ripples into three
  systems.
- **Recommendation:** treat as the highest-leverage set. The bands are uniform and
  evenly spaced, which is defensible but unexamined — whether "Clear" begins at
  3.4 or 3.6 is a product judgement about generosity.
- **Needs you: YES**

**2b. Tension thresholds — 7 values.** `item_high >= 4`, `item_low <= 2`,
`item_mid = 3`, `pair_low_avg <= 2.5`, `capacity_low <= 2.59` (descriptor-only
`signal_high`/`signal_low` are documented as skipped by design).

- **`capacity_low` is the one to look at first.** It guards §12.2 — that limited
  margin is never read as poor discipline. Set too low and a genuinely
  constrained participant receives agency criticism.
- **Needs you: YES, `capacity_low` especially.**

**2c. Capacity override — 3 values.** `direction_clarity_high mean(Q17,Q19) >= 4.0`,
`alignment_low Q18 <= 2`, `capacity_low <= 2.5`. When all three hold, the engine
generates `CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT`.

- ⚠️ **Verified defect, still open:** `capacity_low` is **2.59** on the tension
  path and **2.5** on this override path — two loaders, disagreeing by 0.09. A
  participant whose capacity mean lands in `(2.5, 2.59]` is capacity-limited for
  one rule and not the other. That is exactly the gap the config's own note says
  it was closing. A dead `numeric` field still reads "2.5" while the live `value`
  reads "2.59", and the dead one is what a future reader is likeliest to consult.
- **I changed neither number** — harmonising them is a scoring decision.
- **Needs you: YES**

**2d. Evidence-strength derivation — 4 values.** `extreme_states ["S1","S5"]`,
`middle_state "S3"`, `strong_corroboration_min 2`, `moderate_corroboration_min 2`.

- **Controls:** the verb of every participant-facing sentence. HIGH → "Your
  responses **show**…"; MODERATE → "…**suggest**…"; LIMITED → "One possibility
  worth examining is…". These four numbers decide how assertively the product
  speaks about a person's finances.
- **Recommendation:** decide deliberately — this has arguably legal weight.
  Note `moderate_corroboration_min: 2` combined with the rule makes MODERATE
  reachable by corroboration alone, lifting a middle S3 out of LIMITED.
- **Needs you: YES**

**2e. Null finding — RESOLVED.** `min_signals_s4_or_above: 3`, approved by you
2026-10-01. No longer assumed.

**2f. Activation bands — 3 values.** `LOW ["A","B"]`, `MID ["C"]`, `HIGH ["D","E"]`.

- **Controls:** pattern detection (`HIGH_FEAR_HIGH_ACTIVATION`) and Readiness Four.
- **Consequence:** A and E are endpoints and uncontroversial; **B/C vs C/D is a
  real judgement** about what "moderate" means.
- **Note:** these bands have never been exercised across their full range in the
  live app — a prior defect hardcoded all activation to MID, which made two
  patterns unreachable. Fixed, but untested in production.
- **Needs you: YES**

**2g. Tension precedence — 2 values** (`preferred_for_display`, plus the
technical `store_both`/`render_one`).

- **This is a spec gap, not a calibration choice.** The spec defines
  `HIGH_INFORMATION_LOW_ACTION` ("Q23/Q24 relatively strong with Q25 weak") and
  `INFORMATION_EXECUTION_BOTTLENECK` ("Q23 and Q24 relatively strong, Q25 weak")
  — effectively identical conditions, so both fire on the same answers and the
  spec states no distinction.
- **Recommendation:** consider collapsing the duplicates into one code rather
  than picking a winner.
- **Needs you: YES on the tie-break; no on the technical pair.**

### Group 3 — UX / PRIVACY

| Setting | Value | Consequence | Needs you |
|---|---|---|---|
| Money Moment count | 5 (locked §9) | pacing rhythm | no — spec |
| Continue timing | immediate, no auto-advance | §12 | no — spec |
| Entrance motion | 400ms; none under reduced-motion | §12 | no — spec |
| Milestone labels | §13's five phrases | progress language | no — §13 |
| Save My Progress placement | after MM01 only | §3 | no |

---

## Item 2 — §D-7: version semantics

### The exact unresolved question

> **What does a "pinned version" mean, and where does its value come from?**

`lib/session/service.ts:49` declares `PINNED_VERSION = "1.0"` — a **hardcoded
literal**. The payload pins six versions (assessment, questionBank, scoring,
narrative, report, interstitial) and writes them to both the payload's `versions`
object and to `snapshots` columns.

**The problem:** only three of the six actually read a version from their config.
`config/narratives-v1.0.json` has **no `version` field at all**, so every report
cites "narrative_version 1.0" from a constant rather than from the copy that
produced it. **The moment the narrative library is revised, every new Snapshot
will still claim 1.0** — and the pin that exists precisely so a historical report
can be attributed to its source will be wrong.

This is not hypothetical. The Option 2 decision **already revised the narrative
library** (the `NO_MEANINGFUL_FRICTION` copy). That change is live and the pin
did not move.

### Where the value is stored and used

| Location | What it holds |
|---|---|
| `lib/session/service.ts:49` | the literal `"1.0"` |
| `lib/session/service.ts` `interstitialVersion()` | reads the fixture's own `version` — the one that cannot drift |
| `snapshots.*_version` columns | persisted per Snapshot, queryable |
| `payload_json.versions` | the same values, read by renderers |
| `assessment_sessions.assessment_version` | pinned at session creation |

### The choices

**Option 1 — Add a real `version` field to every config.**
Every config declares its own version; the pin reads it.
*Consequence:* the pin is honest and moves with the content. Requires discipline:
someone must bump it, and nothing forces them to. A stale field is only
marginally better than a literal.

**Option 2 — Derive the pin from a content hash.**
Hash each config's contents and pin the digest.
*Consequence:* **cannot drift** — changing one character changes the pin, with no
human step to forget. Costs: the value stops being human-readable, and historical
reports would carry digests rather than "1.0", which is less legible in a support
conversation. A hybrid (semantic version *plus* hash) gets both.

**Option 3 — Leave it, and treat versions as informational.**
Accept that pins are labels, not guarantees.
*Consequence:* simplest, and honest if documented — but it abandons the
attribution §3.1 asks for, and means a cohort that completed under revised copy
is indistinguishable from one that did not.

### My recommendation

**Option 2, with the existing semantic version kept alongside for legibility.**
The failure mode here is *silent* — a report is attributed to copy that did not
produce it — which is exactly the class a hash eliminates and a human bump does
not. Both values can be stored: the hash for correctness, the label for humans.

**Not encoded.** `PINNED_VERSION` is untouched, and no config gained a
`version` field.

---

## Item 3 — NEW, surfaced by the completion check

**§16 analytics has no specified destination, retention, or vendor**, and the
spec forbids sending raw financial answers to third-party analytics.

The events themselves are specified; what is *not* is: where they go, who can
read them, how long they are kept, and whether a third-party processor is
involved at all. That is a privacy decision with §24 implications, not an
implementation detail, so I have not chosen one.

Options, roughly:

- **First-party table** (a new `analytics_events` table in the same project).
  No third party, no new processor, full control of retention. Costs: no
  off-the-shelf dashboards; I would build simple queries on top.
- **A privacy-respecting product analytics vendor**, configured to receive only
  the §16 event names and no answer content. Faster to insight; adds a processor
  to the privacy surface and needs a DPA.
- **Defer past pilot** — instrument nothing, accept that §16's pilot questions
  ("does removing the identity wall improve assessment starts?") go unanswered.

**Recommendation: first-party table.** The §16 events are a small, fixed,
privacy-conscious set, and the questions they answer are about *this* product's
funnel — not the kind of behavioural analytics a vendor earns its keep on. It
also keeps the "no raw answers to third parties" constraint true by construction
rather than by configuration.

**RESOLVED 2026-10-01 — operator chose first-party in Supabase.** Built. See
`docs/ANALYTICS.md`.

**Still needs you: the RETENTION PERIOD only.** Your instruction was explicit —
*"Do not silently invent a permanent retention period if the governing
specification does not provide one"* — so `retain_until` is NULL on every row, no
DEFAULT exists (a default would be a decision made by accident), nothing expires,
and the undecided state is queryable through the `analytics_retention_status`
view so a privacy review sees the number rather than discovering it later.
Options and a recommendation are in `docs/ANALYTICS.md` §6.

---

# What I am NOT doing until you decide

- No calibration value is changed.
- `PINNED_VERSION` and the config-version question are untouched.

~~- No analytics destination is chosen and no event is emitted.~~ **Superseded
2026-10-01** — the operator chose first-party and it is built (`docs/ANALYTICS.md`).
Events now fire; retention is still undecided and still deliberate.
- The `capacity_low` 2.5/2.59 split is left exactly as found.

**Stopping here for your decisions, per instruction.**
