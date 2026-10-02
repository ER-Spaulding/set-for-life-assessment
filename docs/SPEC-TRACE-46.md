# Specification trace — the ~46 configurable values

**Task:** operator item #4. *"Do not present all 46 as decisions for the product
owner merely because they are configurable."*

**Method.** Every value below was read from `config/scoring-v1.0.json` at the
time of writing, not transcribed from the earlier decision table. Where a value
carries a `_prd_section` or `_notes` field in the config, that citation is the
basis for a SPECIFIED/DERIVABLE classification — I did not infer a citation that
the config does not make.

**Result: most of them are NOT decisions.** The ones that are, are in §3.

### The "46" does not reconcile — corrected count

The earlier decision table never printed a list of 46; it asserted *"All 46 carry
`_calibration_status`."* That claim is checkable, and it does not hold:

```
$ grep -o "_calibration_status" config/scoring-v1.0.json | wc -l
49        # the string, including one mention inside a _notes prose field
$ # actual marker KEYS, counted by walking the parsed JSON:
48
```

**48 marker keys, of which 47 sit on value-bearing entries** — the 48th,
`tension_thresholds._calibration_status`, marks the block rather than a value.
Breakdown by value: **45 `ASSUMED_PENDING_OPERATOR_REVIEW`, 1
`OPERATOR_APPROVED_2026_10_01`, 1 `INTERPRETATION_PENDING_OPERATOR_REVIEW`, 1
`INTERPRETATION_ALIGNED_WITH_ASSESSMENT_CONFIG_PENDING_OPERATOR_REVIEW`.**

The doc's *"45 remain assumed"* (after the null-finding approval) **is exactly
right** — that is the one arithmetic claim in it that reconciles.

But the groups do not sum to 46: 2a–2g alone total 50–51, and adding the PDF
group (6) and the UX group (5) gives 61–62 rows against a stated 46. The "46" is
not a row count of anything in the document. Six of its rows (the PDF group) have
**no code at all** — see §5.

**Corrections to my own earlier accounting**, all from reading the config rather
than transcribing the table: `signal_high`/`signal_low` are never loaded;
`item_mid` and `tension_thresholds.capacity_low` are loaded but unreferenced;
`item_mid`, `extreme_states` and `middle_state` are derivable rather than
decisions; and the 30 state bands are five boundaries × six identical copies (one
decision, not thirty).

---

## 1. The classification key

| Class | Meaning | Goes to the operator? |
|---|---|---|
| **SPECIFIED** | A specification document fixes this value. Changing it would contradict a locked source. | No |
| **DERIVABLE** | Determinable from the spec plus arithmetic, or fixed by another value already decided. No judgement remains. | No |
| **CALIBRATION** | The spec states the *shape* of the rule but provides no number (or the number is a placeholder). Only pilot data or product judgement can settle it. | **Yes** |
| **PRODUCT DECISION** | Not a threshold at all — a choice about what the product should say or do. | **Yes** |

---

## 2. The trace

### 2a. State bands — 30 values → SPECIFIED (shape) / CALIBRATION (boundaries)

Live values, uniform across all six signals (verified programmatically —
`uniform across signals: true`):

| Band | min | max | SEE label |
|---|---|---|---|
| S1 | 1 | 1.79 | Hard to See Clearly |
| S2 | 1.8 | 2.59 | Some Important Gaps |
| S3 | 2.6 | 3.39 | Coming Into Focus |
| S4 | 3.4 | 4.19 | Clear |
| S5 | 4.2 | 5 | Very Clear |

### A note on why `_`-prefixed keys are invisible at runtime

The marker convention only works because the loaders skip those keys — and there
are **five** such rules, not one (the earlier note in `DECISIONS-REQUIRED.md`
cited only `scoring.ts:102`):

```
lib/assessment/scoring.ts:102   if (k.startsWith('_')) continue;
lib/assessment/tensions.ts:168  if (key.startsWith('_')) continue;  // thresholds
lib/assessment/tensions.ts:608  if (code.startsWith('_')) continue; // codes
lib/session/service.ts:354      if (signal.startsWith('_')) continue;
lib/session/service.ts:384      if (code.startsWith('_')) continue;
```

They share an outcome but not a rationale. `scoring.ts:102` skips a sibling
marker *beside* a value. `tensions.ts:168` and `:608` skip keys that have no
`value` field at all — preventing a non-value from being parsed *as* a value,
which is a different reason. And two loaders (`loadQ18Cutoffs` at
`overrides.ts:89`, `loadConfidenceDerivation` at `evidence-chain.ts:141`) have
**no `_` rule at all** — they navigate by explicit named path, so a `_`-prefixed
key is unreachable by construction rather than by filter.

The outcome — markers never reach the engine — is the same. The mechanism is not
one rule, and a future key that relies on the wrong one would not be skipped.

**Class: CALIBRATION.** Each carries `_calibration_status:
ASSUMED_PENDING_OPERATOR_REVIEW`, and the config makes no `_prd_section` claim
for the numeric boundaries. The spec fixes that there are five bands and what
each is called; it does not fix where the lines fall.

**Why they collapse to one decision, not thirty.** All six signals share one
banding curve, so the 30 values are five boundaries × six identical copies — and
the loader proves it. There is exactly **one** thing to decide here: the four
interior boundaries (1.80, 2.60, 3.40, 4.20). They are evenly spaced at 0.80,
which is defensible and, as the decision table already noted, unexamined.

Boundary sensitivity: because S3/S4 membership feeds the null-finding gate and
evidence confidence, moving 3.40 moves participants between "Coming Into Focus"
and "Clear" **and** changes how assertively the product speaks about them.

### 2b. Tension thresholds — 7 values → 2 CALIBRATION, 3 DERIVABLE, 2 NOT READ

| Setting | Value in code | Class | Basis |
|---|---|---|---|
| `item_high` | `">= 4"` | CALIBRATION | Spec fixes the 1–5 scale, not the cut. Resolved by name — 8 `threshold_ref` uses. |
| `item_low` | `"<= 2"` | CALIBRATION | Same; gates most friction triggers. 11 uses. |
| `item_mid` | `"= 3"` | **DERIVABLE — and UNREACHABLE** | On a 1–5 integer scale with floors at 2 and ceilings at 4, 3 is the only remaining value. Nothing to decide — and no trigger names it either. |
| `signal_high` | *(no `.value`)* | **NOT LOADED** | `loadTensionThresholds` skips it at `tensions.ts:170` (`typeof value !== 'string'`). Never parsed at all. |
| `signal_low` | *(no `.value`)* | **NOT LOADED** | Same. |
| `capacity_low` | `"<= 2.59"` | **RESOLVED — and DEAD on this side** | See the correction below. |
| `pair_low_avg` | `"<= 2.5"` | CALIBRATION | Affects paired-item tensions; no spec number. 2 uses. |

#### Correction — `capacity_low` has only ONE live reader, and this is not it

**My earlier text in this document, and the commit that harmonised the value,
both said the fix closed a gap between "the tension engine" and "the §13.7
override". That was wrong.** Verified by direct search:

```
$ grep -rn "capacity_low" lib app components
lib/assessment/overrides.ts:121:    capacityLowAtOrBelow: num('capacity_low'),
```

**One hit, and it is the override path.** The tension engine never reads the
field. Of the 21 `threshold_ref` uses in the config, only three distinct keys
appear — `item_high` (8), `item_low` (11), `pair_low_avg` (2) — and
`thresholdForRef` (`tensions.ts:186`) can only resolve a key that some trigger
names. `capacity_low` and `item_mid` are **loaded into the threshold map and
then unreachable**.

The two tensions that look like they should read it gate on signal **states**:

```json
HIGH_DIRECTION_LOW_CAPACITY: { "all": [
  { "signal": "AIM",  "state_in": ["S4","S5"] },
  { "signal": "ROOM", "state_in": ["S1","S2"] } ] }
```

The capacity boundary there comes from the **S2 band edge** (max 2.59), not from
`capacity_low`. So the (2.5, 2.59] gap was real but **single-path** — the §13.7
override alone, which read 2.5 — not a two-loader divergence. The S2 band's max
was already 2.59, so `HIGH_DIRECTION_LOW_CAPACITY` could not have had the gap.

**Consequence for the decision: this item is LESS urgent than I argued, not
more.** There was never a participant who was capacity-limited for one rule and
not the other. One rule was 0.09 too tight, and it is fixed. The dead
`tension_thresholds.capacity_low` is a **tidiness** issue with two resolutions —
wire it to the two capacity tensions (which would make the boundary
independently tunable rather than pinned to the S2 band edge, arguably an
improvement), or delete it. Neither is a live scoring decision.

Four `tension_thresholds` entries are dead, in two distinct ways:
**loaded-but-unreferenced** (`item_mid`, `capacity_low`) and
**never-loaded** (`signal_high`, `signal_low`).

### 2c. Capacity override (§13.7) — 3 values → 2 CALIBRATION, 1 RESOLVED

| Sub-value | Value in code | Class |
|---|---|---|
| `direction_clarity_high` | `"mean(Q17, Q19) >= 4.0"` | CALIBRATION |
| `alignment_low` | `"Q18 <= 2"` | CALIBRATION |
| `capacity_low` | `"Capacity mean <= 2.59"` | **RESOLVED 2026-10-01** — and it is this path that is the LIVE one |

**`capacity_low` is done, and this is the only place it is read.** The operator
directed the harmonisation to 2.59 ("There must not be separate 2.50 and 2.59
interpretations in different loaders/code paths"), implemented with regression
tests at 2.49 / 2.50 / 2.59 / 2.60, mutation-proven. Note the framing correction
above: the value was harmonised against a field that turned out to be dead, so
what actually shipped is a **single-path** correction from 2.5 to 2.59 on the
§13.7 override — which is the live reader.

The other two remain calibration. `alignment_low` is the more consequential:
it is the "but their choices aren't aligned" trigger inside §12.2's
capacity-before-discipline protection.

### 2d. Evidence-strength derivation — 4 values → 2 DERIVABLE, 2 CALIBRATION

| Setting | Value | Class | Basis |
|---|---|---|---|
| `extreme_states` | `["S1","S5"]` | **DERIVABLE** | With five ordered bands, the extremes are the endpoints. No judgement. |
| `middle_state` | `"S3"` | **DERIVABLE** | The middle of five. Nor is it arbitrary: "Coming Into Focus" *is* the developing band, which is the basis of the operator's own null-finding decision. |
| `strong_corroboration_min` | `2` | CALIBRATION | How much corroboration is "strong". |
| `moderate_corroboration_min` | `2` | **CALIBRATION — with a live interaction** | See §3; equal to `strong_corroboration_min`, which the config's own `_rule` string makes consequential. |

### 2e. Null finding — 1 value → **RESOLVED**

| Setting | Value | Class |
|---|---|---|
| `min_signals_s4_or_above` | `3` | RESOLVED 2026-10-01 — operator approved Option 2; gate implemented, 19 regression tests |

Listed for completeness. The earlier table marked this "the blocked item"; it is
no longer blocked.

### 2f. Activation bands — 3 values → CALIBRATION (one decision)

| Setting | Value |
|---|---|
| `LOW` | `["A","B"]` |
| `MID` | `["C"]` |
| `HIGH` | `["D","E"]` |

**Class: CALIBRATION**, carrying `ASSUMED_PENDING_OPERATOR_REVIEW`. The decision
is a single boundary: does "moderate" stop at B/C or start at C/D?

**Heightened risk, and it is recorded rather than assumed.** A prior defect
hardcoded all four activation dimensions to MID, which made two patterns
unreachable. That is fixed — but it means these bands have **never been exercised
across their range in the live app**. There is no evidence from operation to
inform the choice; only judgement.

### 2g. Tension precedence — 2 values → 1 PRODUCT DECISION, 1 DERIVABLE

| Setting | Value | Class |
|---|---|---|
| `preferred_for_display` | `INFORMATION_EXECUTION_BOTTLENECK` | **PRODUCT DECISION — and arguably a spec defect** |
| `store_both` / `render_one` | `true` / `true` | **DERIVABLE** — given that one statement renders, storing both is required by the evidence chain and rendering one is required by the design |

**`preferred_for_display` is the sharpest item in this document**, because the
problem is upstream of the number. The spec defines two tensions with the same
condition:

> `HIGH_INFORMATION_LOW_ACTION`: "Q23/Q24 relatively strong with Q25 weak."
> `INFORMATION_EXECUTION_BOTTLENECK`: "Q23 and Q24 relatively strong, Q25 weak."

These are the same sentence. Both fire; the spec distinguishes nothing. The
config says so itself: *"this precedence is an ASSUMED tie-break, not spec
text — operator must confirm."*

So this is not "pick a threshold". It is: **two codes in the source document are
duplicates**, and the right resolution may be to collapse them rather than
crown one.

---

## 3. What actually needs the operator — 8 items

| # | Item | Current | Alternatives | Participant-facing consequence | Technical consequence |
|---|---|---|---|---|---|
| 1 | **State-band boundaries** (4 numbers: 1.80 / 2.60 / 3.40 / 4.20) | even 0.80 spacing | tighten S4 to start at 3.60; widen S3 | moves participants between "Coming Into Focus" and "Clear"; changes perceived generosity | ripples into the null-finding gate (S3/S4 is its floor) and into evidence confidence, so a boundary move changes three systems |
| 2 | **`item_high` / `item_low`** (4 / 2) | ≥4 strong, ≤2 weak | 4.5 / 1.5 | how readily a friction finding appears at all | gates most tension triggers |
| 3 | **`capacity_low` (tension engine)** | 2.59 | — | **safety-relevant**: too low and capacity criticism surfaces as discipline criticism | already harmonised; listed as resolved |
| 4 | **`pair_low_avg`** | 2.5 | 2.59, to match `capacity_low` | paired-item tensions fire slightly more or less often | note the near-miss: two "low" concepts currently sit at 2.5 and 2.59 |
| 5 | **`direction_clarity_high`** (§13.7) | ≥ 4.0 | 3.5 | whether the capacity-constrained reading is available at all | gates `CLEAR_DESTINATION_CAPACITY_CONSTRAINED_ALIGNMENT` |
| 6 | **`alignment_low`** (§13.7) | Q18 ≤ 2 | ≤ 1 | the "choices aren't aligned" trigger inside §12.2's protection | same gate |
| 7 | **`strong_corroboration_min` / `moderate_corroboration_min`** | 2 / 2 | raise moderate to 3 | **selects the verb of every participant sentence** — "show" vs "suggest" vs "one possibility" | the two being equal means MODERATE is reachable by corroboration alone, which can lift an S3 out of LIMITED |
| 8 | **`preferred_for_display`** + the duplicate-code question | `INFORMATION_EXECUTION_BOTTLENECK` | collapse the two codes into one | which single sentence the participant reads about the same pattern | two codes currently stored for one condition; only the tie-break hides it |

**Grouped differently, there are four real decisions:**

1. **How generous is the language?** (#1) — the highest-leverage item.
2. **How readily does the product name a friction?** (#2, #4, #5, #6).
3. **How assertively does it speak?** (#7) — the one with claims/legal weight.
4. **What to do about the duplicate tension codes** (#8) — a spec defect, not a
   threshold.

---

## 4. A defect class the decision table missed entirely

> **STATUS 2026-10-01: FIXED, except where noted.** The operator approved the
> correction — *"configuration must either genuinely control behavior or cease
> pretending to be configurable."* Three of the five twins below are now wired or
> removed; the remaining two are marked. See §4a for what changed.

The table's central promise was: *"Changing any of them changes
participant-facing output with no code change."* **For five values that is
false** — the code carries its own literal copy, and the config copy is inert.
Editing the config does nothing.

| Config key | Config value | Hardcoded twin | Effect of editing config |
|---|---|---|---|
| `activation.level_bands` | `["A","B"] / ["C"] / ["D","E"]` | `lib/assessment/activation.ts:34–36` | ~~**none**~~ **FIXED** — config is now passed in; the literals are a fallback |
| `option_value_maps.profile_1_5` | `{A:1…E:5}` | `lib/session/service.ts:71` `LETTER_VALUES` | ~~**none** for item-level gates~~ **FIXED** — twin deleted, config authoritative |
| `option_value_maps.Q18_profile_1_5` | `{A:1…E:5}` | same `LETTER_VALUES` | ~~**none** for item-level gates~~ **FIXED** — same change |
| `min_signals_s4_or_above` | `3` | `lib/assessment/tensions.ts:519` `DEFAULT_MIN_SIGNALS_S4` | none in production — a *default parameter*, `evaluateTensions` passes config explicitly. **Left as-is**: it is a fallback, not a shadow. |
| `capacity_low` (tension side) | `<= 2.59` | — | none; unreferenced (§2b correction). **Left as dead, now labelled.** |

### 4a. What was fixed, and the live defect found underneath

**`LETTER_VALUES` was worse than a twin — it was scoring a capacity answer as
high agency.** The config maps the override options to `null` to *exclude* them
(`q11: {"Q11_A": null}`, `q12: {"Q12_F": null}`). The hardcoded map invented
`F: 5`, the **highest** value. So a participant answering Q12_F — *"There usually
isn't enough flexibility in my finances to free up money"* — had that recorded as
strong agency evidence. `Q11_A` was wrong too, scoring 1 for the same kind of
answer.

The damage landed in corroboration: `confidenceFor()` counts a signal's
contributing items with `items[q] !== undefined`, and its comment claimed an item
that "maps to null … is correctly absent from `items`, so it cannot corroborate".
That was false. The inflated count feeds evidence confidence, which selects the
HIGH / MODERATE / LIMITED verb of participant-facing sentences.

**No live session was affected** — the four stored participants answered only
Q11_B/C and Q12_C/D — but every future participant answering Q12_F was.

The resolution logic moved to `lib/assessment/option-values.ts`, a **pure**
module. It had to: `service.ts` opens with `import "server-only"`, so
`numericItems` could not be imported by a plain test at all. The function deciding
what an answer is *worth* was untestable in isolation — and a mutated version that
ignored its arguments passed the entire suite.

**`activation.level_bands`** is now passed through `resolveLevelBands`, with the
old constants kept as `DEFAULT_LEVEL_BANDS` for callers that have no config. Both
are `A/B, C, D/E`, so **no participant's level moves** — what changes is that a
calibration edit now moves them.

**`min_signals_s4_or_above`'s `DEFAULT_MIN_SIGNALS_S4`** is deliberately left.
It is a default *parameter*, and `evaluateTensions` passes the config value
explicitly at the call site. Removing it would make the function unusable without
config for no gain. It is a fallback, not a shadow — the distinction matters, and
it is the reason this one is not a defect.

**`LETTER_VALUES` is the one to watch — but it is a latent trap, not a live
divergence, and the difference matters.** Verified against the current config:

```
config  option_value_maps.profile_1_5 : {A:1, B:2, C:3, D:4, E:5}
code    LETTER_VALUES                 : {A:1, B:2, C:3, D:4, E:5, F:5}
```

**The two agree on every shared letter today.** So no participant is currently
scored wrongly, and this should not be reported as a live defect. What is true:

- **`F` exists only in code.** No config edit can change how an `F` answer
  scores, because `profile_1_5` does not define it.
- **The seam is real.** `scoring.ts:141` reads `profile_1_5` from config for the
  **signal averages**, while `service.ts:187` uses `LETTER_VALUES` for the
  **`items` map** that feeds every item-level tension comparison. Two sources for
  one scale. Edit the config and the averages move while the item gates do not —
  silently, and in opposite directions for the same answer.
- **Nothing says so.** The config's comment (`activation.ts:33`) claims the
  letters come from `activation.level_bands`; that field is unread.

That is a **latent divergence**: correct today, wrong the first time anyone
calibrates the scale, which is exactly what the operator is being asked to do in
§3. Worth fixing regardless of any calibration choice.

**Verified after the first draft of this section, because "latent" is a claim
that needed testing rather than asserting.** `F` options DO exist in the
instrument — seven items offer one (Q1, Q9, Q12, Q16, Q21, D1, D3) — so the
question was whether any of them reaches an item-level gate. It does not:
resolving every `item_gte` / `item_lte` / `avg_lte.items` reference in the config
gives 13 gated items — Q4, Q5, Q6, Q13, Q14, Q15, Q17, Q19, Q20, Q22, Q23, Q24,
Q25 — and **every one of them offers only A–E**. Zero overlap with the
F-bearing set.

The one F-bearing item with a scoring meaning, Q12, is handled deliberately:
`Q12_F` ("There usually isn't enough flexibility in my finances to free up money")
is the capacity answer, and it is routed to the **override** path
(`overrides.Q12_F` → `DIRECT_CAPACITY_LIMITED`) rather than to a numeric value.
The config's `q12: {Q12_F: null}` excludes it from the average on purpose, and
the reader looks it up **by letter**, so the letter path is consistent there too.

So this is confirmed latent, not live. Reported as such.

Note this is a *different* finding from `activation.level_bands`, where the
config is unread and the code is authoritative — there the config is simply
inert. Here both copies are live and they disagree about which letters exist.

---

## 5. Six of the table's rows describe code that does not exist

The decision table's Group 1 ("TECHNICAL DEFAULTS") lists PDF and storage
choices — page size, signed-URL lifetime, retry count, checksum algorithm,
storage prefix, payload store. **Five of the six have no implementation
anywhere**, verified:

- `find lib app scripts components -iname "*pdf*"` → **empty**
- PDF packages in `package.json` → **none**
- `createSignedUrl` / `expiresIn` / `.storage` in `lib/` or `app/` → **none**

What does exist: `SHA-256` appears in `lib/auth/*` for HMAC and token signing —
**not** snapshot integrity. And `snapshots.payload_json` is real, but it is a
**database column** (`migration ...0001:47`), not a configurable value.

So these are **forward-looking design decisions for unbuilt work**, not part of
the live calibration surface. They carry no `_calibration_status`, which is why
they are not among the 48. Listing them inside a document titled "46
configuration values" implies they are settable today; they are not.

This matters for the operator's ask. The request was to trace *configurable
values* and bring back only genuine decisions. Six rows that would need a PDF
subsystem built before any value means anything are not decisions — they are a
**build-order question**, and the implementation order already places PDF
generation at step 6 and signed download at step 7.

**Recommendation:** move Group 1 out of the calibration register into a "not yet
implemented" list, so the register contains only values that exist.

---

## 6. What the corrected register actually contains

| Bucket | Count | Needs the operator? |
|---|---|---|
| Marker-bearing value entries | **47** | Some — see §3 |
| Loaded-but-unreferenced thresholds (`item_mid`, `capacity_low`) | 2 | No — tidiness |
| Never-loaded descriptors (`signal_high`, `signal_low`) | 2 | No — dead |
| Hardcoded twins of config values | 5 | No — correctness finding (§4) |
| Unbuilt Group-1 decisions | up to 6 | No — build order (§5) |
| **Genuine calibration / product decisions** | **8, collapsing to 4** | **Yes** (§3) |

---

## 4. Recommendation

**Decide #7 first, and separately.** `strong_corroboration_min` and
`moderate_corroboration_min` both being 2 is not obviously wrong, but it makes
MODERATE reachable through corroboration alone, which can lift a middle S3 out of
LIMITED language. That is the mechanism by which the product might sound more
certain than the evidence supports, and it is the item with the clearest
downstream consequence.

**Decide #8 as a spec-gap fix, not a calibration.** Ask for the two codes to be
distinguished or merged in the source document; picking a winner in config
encodes a resolution the spec never made.

**Leave #1 until pilot data exists.** The boundaries are defensible and evenly
spaced, and there is currently **no evidence** on which to move them. The
`asymmetric` risk is real but so is the risk of tuning on intuition. The right
move is to make sure the pilot records enough to see the distribution across
bands — which the first-party analytics work now can.

**Nothing here is changed.** No value in this document has been edited.
