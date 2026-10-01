# Decisions Required — Set for Life Financial Assessment

**Prepared:** 2026-10-01 · **Author:** build orchestrator
**Status:** PARTIALLY RESOLVED — see the superseded-item notes inline. What remains open is the calibration set (§D items 1 and 4) and the version-identity question (§D-7); see `docs/VERSION-SEMANTICS-PROPOSAL.md`.

> **Later the same day.** Two of the three items here were decided and built —
> §B (the null-finding rule: operator approved Option 2 with Option 3's honest
> copy) and the Set for Life Number (§C-adjacent; the field the table below
> called "does not exist" now does). Analytics was decided as first-party and
> built. Each affected line is marked inline rather than silently rewritten,
> because the value of this document is the record of what was uncalibrated at
> the time — not a tidy summary of the present.

This document exists because three classes of unresolved decision were in danger of
becoming **implicit defaults** — values that are used at runtime, that shape what a
participant sees, but that nothing surfaces as uncalibrated.

| # | Item | Blocker? | Needs |
|---|---|---|---|
| 1 | Money Moments / entry flow | Unblocked — Addendum 02 v1.1 approved | 1 open question (§C) |
| 2 | 46 configurable scoring values | No | Calibration, before launch |
| 3 | The null-finding scoring rule | **Yes — do not encode until decided** | Product decision (§B) |

---
---

# §A. THE IMPLICIT-DEFAULT PROBLEM (read this first)

Before the tables, the finding that motivated this document.

`lib/assessment/scoring.ts:102` contains:

```js
if (k.startsWith('_')) continue;
```

The scoring config marks **46 values** with `_calibration_status:
"ASSUMED_PENDING_OPERATOR_REVIEW"`. That loader line **skips every key beginning
with `_`** — so the engine reads the VALUE and never sees the WARNING attached to it.

Verified, not inferred:

- `grep -rn "_calibration_status" lib/ app/` → **no runtime reads.** It appears in
  config and in comments only.
- Nothing in `app/` or `components/` surfaces a calibration state to a
  participant or an operator.

**Consequence:** the 46 assumed values are live. A participant completing the
assessment right now receives an interpretation shaped by numbers nobody has
approved — and no part of the system says so. The markers are excellent
documentation and zero enforcement.

**My recommendation is a build change, not a decision, and I'll make it unless you
say otherwise:** surface calibration state at runtime so an uncalibrated value
cannot be silently authoritative — e.g. record the `_calibration_status` of every
value that actually fired into the Snapshot payload's version block, so a pilot
report can be traced to the exact calibration it was produced under. That is
additive, breaks nothing, and converts documentation into evidence. It does not
decide any value.

---

# §B. ITEM #3 — THE NULL-FINDING SCORING RULE (blocked on you)

## B.1 The question, precisely

> **When the engine reports "no meaningful friction identified," must every one of
> the six operating signals be at S4 or above (Clear / Meaningful / Intentional /
> Prepared / Clear Direction / Usually Moves), or is S3 sufficient?**

S3's approved narrative label is, verbatim from the Approved Narrative Library:

| State | SEE label | AIM label | DIRECT label |
|---|---|---|---|
| S3 | **"Coming Into Focus"** | **"Some Direction"** | **"Developing Direction"** |
| S4 | "Clear" | "Clear Direction" | "Intentional" |
| S5 | "Very Clear" | "Strongly Directed" | "Highly Intentional" |

S3 is the *developing* band. That is the whole tension.

## B.2 Variables involved

| Variable | Defined at | Values | Fed by |
|---|---|---|---|
| `signalStates` | `lib/assessment/tensions.ts:486` | S1–S5 per signal | scorer, 6 signals |
| `STATE_RANK` | `lib/assessment/tensions.ts:449` | S1=1 … S5=5 | literal map |
| `allSignalsS3OrAbove` | `lib/assessment/tensions.ts:458` | boolean | the gate in question |
| `null_finding.operationalization.condition` | `config/scoring-v1.0.json` | prose | operative rule |
| `triggeredExcludingNull` | `lib/assessment/tensions.ts:485` | code list | tension engine |
| `hasMeaningfulContextualFriction` | `lib/assessment/tensions.ts:487` | boolean | classifier tags + fear flag |

## B.3 Where it is used — every read site

1. `lib/assessment/tensions.ts:480` — `isNullFinding()`, the only computation.
2. `lib/assessment/tensions.ts:513` — `evaluateTensions()` calls it; on true it
   returns `[NO_MEANINGFUL_FRICTION_IDENTIFIED]` **instead of** any friction.
3. `lib/assessment/snapshot-payload.ts:294` — sets `nullFinding` on the payload.
4. `lib/assessment/snapshot-payload.ts:247` — `selectBigPictureTemplate()` returns
   the `NO_FRICTION` template instead of `PRIMARY_FRICTION`.
5. `lib/assessment/interpretation.ts:78` — selects attention area `KEEP_OBSERVING`.

**Participant-visible consequence.** When the gate passes, the entire report
changes character: no friction module, a different big-picture narrative, and a
`KEEP_OBSERVING` attention area rather than a real one. The gate is not a label —
it is the branch that decides whether the participant is told anything is wrong.

## B.4 What the spec says (verbatim)

**PRD §18.3:**
> "The engine must be able to return `NO_MEANINGFUL_FRICTION_IDENTIFIED` and must
> not invent a weakness."

**PRD §29 acceptance test:**
> "**Null finding:** Given **strong consistent evidence across all operating
> signals** and no meaningful contextual friction, the engine may return no
> meaningful friction; it must not invent one."

**What the config says** (`null_finding.operationalization`):
> "No other tension triggered AND every operating signal **at S3 or above** AND no
> meaningful contextual friction."
> `_notes`: "The spec states the requirement but no numeric gate; this
> operationalization is ASSUMED for pilot calibration."

**The disagreement.** The spec's bar is *"strong consistent evidence."* The
implementation's bar is *"S3 or above"* — and the approved library calls S3
"Coming Into Focus" / "Some Direction", i.e. **developing**, not strong.

Corroborating evidence that S3 is not "strong" anywhere else in this codebase:
`lib/assessment/evidence-chain.ts:224` treats `middle_state: "S3"` specially —
a non-middle state (S2/S4) is directional on its own, **but "an S3 needs
corroboration to rise above LIMITED."** So the codebase already treats S3 as
*not strong evidence* in the evidence-confidence derivation. The null-finding gate
is the outlier that treats it as strong.

## B.5 Current implemented behaviour

`isNullFinding()` returns true when all three hold: no other tension fired, all six
signals rank ≥ 3, and no meaningful contextual friction. **A participant with all
six signals at exactly S3 is told there is no meaningful friction to report.**

## B.6 Three viable resolutions

### Option 1 — Raise the gate to S4+
```
allSignalsS3OrAbove  ->  allSignalsS4OrAbove   (STATE_RANK >= 4)
```
**Files:** `lib/assessment/tensions.ts:458-465` (rename + rank), `:486`;
`config/scoring-v1.0.json` `null_finding.operationalization.condition` prose.
**Behavioral consequence:** the null finding becomes genuinely rare. Every signal
must be at least "Clear" / "Intentional" / "Prepared". A profile at all-S3 now
produces a friction finding instead of a null one.
**Risk:** more participants get told about friction. If the friction copy chosen
for an all-S3 profile is thin, this manufactures the very thing §18.3 forbids
("must not invent a weakness").

### Option 2 — S3 permitted, but only with corroboration (two-tier gate)
```
null finding  =  all signals >= S3
                 AND at least N signals >= S4
                 AND no contextual friction
```
**Files:** same as Option 1, plus a new `min_signals_at_s4` value in the config.
**Behavioral consequence:** distinguishes "broadly clear with one or two
developing areas" (null) from "everything merely developing" (not null). Aligns
the gate with how `evidence-chain.ts` already reasons about S3 — a middle state
needs support.
**Risk:** introduces a second assumed number, so it must be calibrated too.

### Option 3 — Keep S3, and make the null-finding copy honest about it
```
no code change; the NO_FRICTION narrative acknowledges developing areas
```
**Files:** narrative library (**approved copy — only you or the copy owner can
change this**) + `config/narratives-v1.0.json`.
**Behavioral consequence:** the branch stays as-is but stops over-claiming. A
participant at all-S3 reads something like "nothing here needs urgent attention,
and several areas are still coming into focus" rather than an unqualified
all-clear.
**Risk:** the current library has one `NO_FRICTION` template; this needs new
approved copy, which is a content decision, not an engineering one.

## B.7 My recommendation

**Option 2**, with Option 3's copy honesty as a follow-on.

Reasoning: Option 1 is the most literal reading of "strong evidence," but it
converts every all-S3 participant into a friction report, and the friction
libraries are written for genuinely low signals — so it risks inventing weakness,
which §18.3 explicitly forbids. Option 2 matches the codebase's existing
treatment of S3 as a *middle* state needing corroboration, and it produces an
honest three-way outcome rather than a binary. Option 3 is worth doing regardless
of which gate you choose, because an unqualified "no friction" is a strong claim
to make on a developing profile.

**I have not encoded any of these.** The current S3 behaviour remains exactly as
found until you decide.

---

# §C. ITEM #1 — MONEY MOMENTS: ONE OPEN QUESTION

Addendum 02 v1.1 is approved and governs. The config is generated
(`config/interstitial-v1.0.json`, copy extracted verbatim from §9, not retyped).

**One question needs your confirmation before I lock placement.**

§9 headers read `AFTER DIAGNOSTIC Q5 / Q10 / Q15 / Q20 / Q25`. But the
presentation order is **scrambled** — Q10 is shown 9th, Q15 is shown 18th, Q20 is
shown 14th. So two readings were possible, and they give different products.

| Check | Nth-diagnostic reading | Literal-item reading |
|---|---|---|
| Monotonic (MM01→MM05 in order)? | **Yes** | **No** — Q20 shows before Q15, so MM04 would fire before MM03 |
| MM05 "BEFORE ACTIVATION" header true? | **Yes** | No — 6 diagnostics remain |
| MM05 copy "Just four more questions…" true? | **Yes — exactly 4 (A1–A4)** | No — 10 remain |

**I have implemented the Nth-diagnostic reading** (even intervals: 20/15/10/5/0
diagnostics remaining across the five moments). The third row is decisive because
it comes from the locked copy itself rather than from inference. Say the word if
you read it differently.

**Also needed — a data-model decision.** §4 requires a **"Grease the Wheel
number"** as the returning lookup identifier. No such field exists in the current
schema (identity is a random UUID plus `participant_contacts` for email/phone).
Adding it is a schema change, and §4.2 makes it security-relevant: it is a
*lookup* identifier, never standalone authentication. I need to know what this
number is — is it an existing Set for Life program identifier, or new?

---

# §D. ITEM #2 — DECISION TABLE

Grouped so ordinary engineering defaults are separated from decisions that are
genuinely yours.

**How to read the "Needs you?" column:**
`NO` = a technical default; state an objection and I'll change it.
`YES` = a product / scoring / UX / legal judgement that is yours to make.

---

## Group 1 — TECHNICAL DEFAULTS (no product meaning)

These are ordinary engineering choices. I will proceed with the proposed values
unless you object.

| Setting | Controls | Proposed | Consequence | Needs you? |
|---|---|---|---|---|
| Snapshot payload store | where the interpretation lives | `snapshots.payload_json` (JSONB) | Both renderers read one row; no re-scoring | NO |
| `payload_json` vs `rendered_payload_json` | column naming | write both, same object | readers under either name agree | NO |
| Version pin source | which config version a report cites | `PINNED_VERSION = "1.0"` literal | **See §D-7 below — this is a latent bug** | NO |
| PDF page size | artifact geometry | US Letter portrait | §8 requirement | NO |
| Signed-URL lifetime | download window | propose 15 min | §30D: must not be permanent access | NO (short is safe) |
| Retry count (PDF) | generation retries | propose 3, then surface failure | §7.3 keeps web results available | NO |
| Checksum algorithm | integrity metadata | SHA-256 | §11 "where practical" | NO |
| Storage prefix | object key layout | `snapshots/{snapshot_id}/{report_version}.pdf` | no participant id in the path (§22.2) | NO |

---

## Group 2 — SCORING CONFIGURATION

> **CORRECTED 2026-10-01.** This heading said "**all 46 are yours**", and the
> count does not reconcile. The config carries **48 `_calibration_status` keys**,
> **47 of them on value-bearing entries** (the 48th marks a block, not a value).
> Groups 2a–2g alone sum past 46. And several values below are **not decisions at
> all** once traced against the code:
>
> - **Five have hardcoded twins in TypeScript, so editing the config does
>   nothing** — `activation.level_bands`, `option_value_maps.profile_1_5`,
>   `option_value_maps.Q18_profile_1_5`, plus two defaults. `LETTER_VALUES`
>   (`lib/session/service.ts:71`) is the consequential one: it desynchronises
>   item-level tension gates from signal averages on a single config edit.
> - **Four are unreachable** — `item_mid` and `tension_thresholds.capacity_low`
>   are loaded but named by no `threshold_ref`; `signal_high` and `signal_low` are
>   never loaded at all.
> - **Three are derivable** rather than judgement calls (`item_mid`,
>   `extreme_states`, `middle_state`), and the 30 state bands are five boundaries
>   × six identical copies — one decision, not thirty.
> - **Group 1's six rows have no code behind them** (no PDF module, no storage
>   call, no `pdf` dependency anywhere). They are build-order questions for
>   unbuilt work, not configurable values.
>
> The traced inventory is `docs/SPEC-TRACE-46.md`. **Read that, not this section,
> for what is actually yours to decide.** This section is kept as the record of
> what was believed when it was written.

Every value below carries `_calibration_status: ASSUMED_PENDING_OPERATOR_REVIEW`

Every value below carries `_calibration_status: ASSUMED_PENDING_OPERATOR_REVIEW`
and is **live at runtime** (§A). Grouped by what they control.

### 2a. State bands — 30 values (6 signals × 5 bands)

Each signal maps a 1–5 mean onto S1–S5.

| Band | Range | SEE / ROOM / DIRECT / PREPARE / AIM / MOVE labels |
|---|---|---|
| S1 | 1.00–1.79 | Hard to See / Very Limited Room / Mostly Reactive / Highly Exposed / Destination Unclear / Information Stalls |
| S2 | 1.80–2.59 | Some Important Gaps / Limited Room / Often Reactive / Limited Cushion / Direction Is Forming / Action Often Slows |
| S3 | 2.60–3.39 | Coming Into Focus / Some Room / Developing Direction / Developing Resilience / Some Direction / Sometimes Moves |
| S4 | 3.40–4.19 | Clear / Meaningful Room / Intentional / Prepared / Clear Direction / Usually Moves |
| S5 | 4.20–5.00 | Very Clear / Strong Room / Highly Intentional / Strongly Prepared / Strongly Directed / Moves Into Action |

**Uniform across all six signals** — a single banding curve, not per-signal.
**Practical consequence:** these are the *only* thing converting a continuous mean
into a human-facing label. Moving a boundary by 0.1 moves real participants
between "Developing" and "Clear" — and because S3/S4 also drives the null-finding
gate (§B) and evidence confidence, a banding change ripples into three systems.
**Needs you?** **YES** — this is calibration, the single highest-leverage set here.
**My note:** the bands are uniform and evenly spaced, which is defensible but
unexamined. Whether "Clear" should begin at 3.4 or 3.6 is a product judgement
about how generous the language is.

### 2b. Tension thresholds — 7 values

| Setting | Value | Controls | Consequence of the value | Needs you? |
|---|---|---|---|---|
| `item_high` | `>= 4` | "strong at item level" | a 4 counts as strong; 3 does not | **YES** |
| `item_low` | `<= 2` | "weak at item level" | gates most friction triggers | **YES** |
| `item_mid` | `= 3` | "mixed" | the neutral band | YES |
| `signal_high` | S4/S5, `mean >= 3.4` | *descriptor only* | no `.value`, so the engine **skips** it (documented, intentional — `tensions.ts:150`) | NO |
| `signal_low` | S1/S2, `mean <= 2.59` | *descriptor only* | ditto — skipped by design, not a bug | NO |
| `capacity_low` | `<= 2.59` | capacity protection | **too low = capacity criticism leaks through as discipline criticism** | **YES — safety-relevant** |
| `pair_low_avg` | `<= 2.5` | two-item average (Q4/Q5, Q13/Q15) | affects the paired-item tensions | YES |

**My note on `capacity_low`:** this is the value protecting the core product rule
(low ROOM must never become low DIRECT without agency evidence, §29 test 10). Set
too low and a genuinely constrained participant is shown agency criticism. I would
treat this as the most safety-critical number in the file.

### 2c. Capacity override — `overrides.Q18_capacity_modifier`

| Sub-value | Proposed | Controls |
|---|---|---|
| `direction_clarity_high` | `mean(Q17, Q19) >= 4.0` | "they know where they're going" |
| `alignment_low` | `Q18 <= 2` | "but choices aren't aligned" |
| `capacity_low` | `Capacity mean <= 2.5` | "because of limited room" |

**Consequence:** when all three hold, the engine generates
`CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT` instead of low-direction
language, and prefers `AIM_CAPACITY_CONSTRAINED_ALIGNMENT` for the AIM state. This
is §12.2's "capacity before discipline" protection, implemented as numbers.
**Needs you?** **YES** — and there is a concrete problem with it, below.

#### 2c-i. `capacity_low` is 2.5 on one path and 2.59 on another — verified

The same concept is read from two places, by two different loaders, and they
disagree by 0.09:

| Path | Reads from | Loader | Effective value |
|---|---|---|---|
| tension engine | `tension_thresholds.capacity_low.value` | `loadTensionThresholds` (`tensions.ts:169`) | **2.59** |
| §13.7 Q18 override | `overrides.Q18_capacity_modifier.condition.capacity_low` | `loadQ18Cutoffs` (`overrides.ts:89`) | **2.5** |

Both were executed to confirm: `tension engine = 2.59`, `Q18 override = 2.5`.

**Why it exists.** The config's own `_note` records that `capacity_low` *was*
harmonised to match `signal_low` at `<= 2.59`. That edit was applied to `.value` —
the field `loadTensionThresholds` reads — but the Q18 override's `condition`
string, which the *other* loader parses, was left at `2.5`.

**Consequence.** For a participant whose capacity mean falls in `(2.5, 2.59]`,
the tension engine counts them as capacity-limited, but the §13.7 capacity
override does **not** fire. That participant is in exactly the gap the `_note`
says was being closed. This is §12.2's protection — capacity must be interpreted
before discipline criticism — and it has a 0.09-wide hole.

**Also dead:** `tension_thresholds.capacity_low.numeric` still reads
`"Capacity mean <= 2.5"`. The loader ignores `.numeric` entirely (it reads
`.value`), so that field is unread prose that contradicts the live value. Anything
a future reader consults is likely to be the wrong one.

**I have not changed either number.** Harmonising them is a scoring decision, and
which value is correct (2.5 or 2.59) is yours — though the config's own note
argues for 2.59.

### 2d. Evidence-strength derivation — `language_strength.derivation` (4 values)

| Setting | Proposed | Controls |
|---|---|---|
| `extreme_states` | `["S1","S5"]` | which states are "extreme" |
| `middle_state` | `"S3"` | which state is neutral |
| `strong_corroboration_min` | `2` | items needed for HIGH |
| `moderate_corroboration_min` | `2` | items needed for MODERATE |

**Consequence: this selects the verb of every participant-facing sentence.** HIGH
→ *"Your responses show…"*; MODERATE → *"Your responses suggest…"*; LIMITED →
*"One possibility worth examining is…"* (PRD §19.1). So these four numbers decide
how assertively the product speaks about a person's finances.
**Needs you?** **YES** — this is a tone/claims decision with arguably legal weight.
**My note:** `moderate_corroboration_min: 2` combined with the rule makes MODERATE
reachable by corroboration alone, which can lift a middle S3 out of LIMITED. Worth
deciding deliberately rather than inheriting.

### 2e. Null finding — see §B

| Setting | Proposed | Needs you? |
|---|---|---|
| `allSignalsS3OrAbove` | move to S4, or S3+corroboration | **YES — §B, the blocked item** |

### 2f. Activation bands — 3 values

| Setting | Proposed | Controls | Needs you? |
|---|---|---|---|
| `LOW` | `["A","B"]` | which answer letters are Low urgency/readiness/etc. | **YES** |
| `MID` | `["C"]` | | YES |
| `HIGH` | `["D","E"]` | | YES |

**Consequence:** pattern detection (e.g. `HIGH_FEAR_HIGH_ACTIVATION`) and the
Readiness Four module. A and E are the endpoints and uncontroversial; **whether
the band boundary sits at B/C or C/D is a real judgement** about what "moderate"
means.
**Note:** a prior defect made all four activation dimensions hardcoded to MID,
which made two patterns unreachable. That is fixed, but it means these bands have
never been exercised across their full range in the live app.

### 2g. Tension precedence — 2 values

The spec defines two tensions with **effectively identical conditions**:
`HIGH_INFORMATION_LOW_ACTION` ("Q23/Q24 relatively strong with Q25 weak") and
`INFORMATION_EXECUTION_BOTTLENECK` ("Q23 and Q24 relatively strong, Q25 weak").
Both fire on the same answers, and the spec states no distinction.

| Setting | Proposed | Needs you? |
|---|---|---|
| `preferred_for_display` | `INFORMATION_EXECUTION_BOTTLENECK` | **YES** |
| `store_both` / `render_one` | true / true | NO (technical) |

**Consequence:** only the tie-break decides which sentence a participant reads.
**My note:** this is a **spec gap, not a calibration choice** — the two codes are
duplicates in the source document. You may prefer to collapse them into one code
rather than pick a winner. Your call.

---

## Group 3 — UX / PACING (Addendum 02 territory)

| Setting | Controls | Proposed | Needs you? |
|---|---|---|---|
| Money Moment count | pacing rhythm | 5 (locked by §9) | NO — spec |
| Continue timing | gating | immediate, no auto-advance | NO — §12 |
| Entrance motion | feel | 250–450ms, no spatial under reduced-motion | NO — §12 |
| Milestone labels | progress language | §13's five phrases | NO — suggested by §13 |
| Save My Progress placement | friction | after MM01 only | NO — §3 |
| Analytics event set | pilot learning | §16's list | **RESOLVED 2026-10-01** — first-party in Supabase, built (`docs/ANALYTICS.md`). Retention alone is still open. |
| Set for Life Number | returning lookup | **BUILT 2026-10-01** — Crockford Base32 `XXXX-XXXX` with a check character, DB-generated, stable per participant, lookup-only (never authentication) | NO — decided and implemented. Participant-facing label is "Your Set for Life Number"; the internal "Grease the Wheel" term never reaches a participant. |

---

## §D-7. A latent bug I found while building this table

`PINNED_VERSION = "1.0"` (`lib/session/service.ts:49`) is a **hardcoded literal**,
and `config/narratives-v1.0.json` **has no `version` field at all**.

So every report cites "narrative_version 1.0" from a constant, not from the
config that produced it. **The moment the narrative library is revised, every new
Snapshot will still claim version 1.0** — and the pin that exists precisely so a
historical report can be attributed to its source will be wrong.

This is the same class as the interstitial-version gap (§3.1): the payload pins
five versions, but only three of them (`assessment`, `scoring`, `report`) actually
read a version from their config. I have **not** fixed it, because the fix changes
what a version *means* — either add real version fields to every config, or derive
the pin from a content hash. Both are defensible; the second can't drift.

---

## Summary — what actually needs you

**Blocked (do not encode without you):**
1. **§B** — the null-finding gate (S3 vs S4 vs S3+corroboration).

**Genuinely yours, non-blocking:**
2. **2a** state bands (30 values) — highest leverage; they ripple into three systems.
3. **2b** tension thresholds — `item_high` / `item_low` / `pair_low_avg` only.
   `capacity_low` is **DEAD on this side**: no trigger names it, so it is loaded
   and never read. Resolved 2026-10-01 (harmonised to 2.59).
4. ~~**2c/2c-i** capacity override (3) — contains a verified 2.5-vs-2.59 split
   between two loaders.~~ **RETRACTED 2026-10-01.** There was no second loader.
   `capacity_low` has exactly one reader — the override itself
   (`lib/assessment/overrides.ts:121`) — and the two capacity tensions gate on
   signal *states* (`ROOM ∈ [S1,S2]`), whose S2 band edge was already 2.59. The
   gap was real but **single-path**, and it is fixed. **This item needs nothing
   from the operator.** The "most emphatic finding" in this document was also its
   most wrong.
5. **2d** evidence-strength derivation (4) — decides how assertively the product
   speaks; likely legal weight.
6. **2f** activation bands (3) — never exercised across full range.
7. **2g** tension precedence (2) — a spec gap; consider collapsing the duplicates.
8. **§C** Grease the Wheel number — schema + product, and the one Money-Moment
   placement confirmation.
9. **§D-7** version pin — needs a decision on what "version" means.

**Mine, unless you object:** §A's runtime calibration surfacing, all of Group 1,
the technical half of 2g, the non-annotated UX defaults in Group 3.

---

# §E. WHAT I AM BUILDING WHILE THESE ARE OPEN

Per your instruction not to let the unresolved items become implicit defaults and
to continue independent work:

**Proceeding now (not dependent on #2 or #3):**
- Addendum 02 v1.1 entry/pacing build — Opening A first, provisional identity,
  Save My Progress, the five Money Moments. The copy is extracted verbatim and
  guarded by a verbatim test.
- The interstitial version pin (§3.1 conformance gap in Step 1's payload).
- Step 3 (the Money Picture web architecture) — §6/§7 are presentation, not scoring.

**Deliberately NOT proceeding:**
- Any change to the 46 values.
- The null-finding gate.
- Anything that would bake in an answer to §B.

Every assumed value that reaches a participant will remain marked and traceable,
and I will add the §A runtime surfacing so this stops being implicit.
