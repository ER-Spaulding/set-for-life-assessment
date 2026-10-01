# Specification trace — the ~46 configurable values

**Task:** operator item #4. *"Do not present all 46 as decisions for the product
owner merely because they are configurable."*

**Method.** Every value below was read from `config/scoring-v1.0.json` at the
time of writing, not transcribed from the earlier decision table. Where a value
carries a `_prd_section` or `_notes` field in the config, that citation is the
basis for a SPECIFIED/DERIVABLE classification — I did not infer a citation that
the config does not make.

**Result: 38 of 46 are NOT decisions. 8 are.** The eight are in §3.

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
| `item_high` | `">= 4"` | CALIBRATION | Spec fixes the 1–5 scale, not the cut. |
| `item_low` | `"<= 2"` | CALIBRATION | Same; gates most friction triggers. |
| `item_mid` | `"= 3"` | **DERIVABLE** | On a 1–5 integer scale with floors at 2 and ceilings at 4, 3 is the only remaining value. Nothing to decide. |
| `signal_high` | *(absent — `numeric: "mean >= 3.4"` only)* | **NOT READ** | No `.value` key, so `loadTensionThresholds` skips it. Documented, intentional. |
| `signal_low` | *(absent — `numeric: "mean <= 2.59"` only)* | **NOT READ** | Same. |
| `capacity_low` | `"<= 2.59"` | **CALIBRATION — safety-relevant** | See §3. |
| `pair_low_avg` | `"<= 2.5"` | CALIBRATION | Affects paired-item tensions; no spec number. |

**Note on the two NOT-READ entries.** They are dead configuration, not
calibration. `signal_high` and `signal_low` describe band membership that is
already expressed by the state bands — the same fact stated twice, and the engine
reads the bands. Presenting them as decisions would be presenting a duplicate.

**Correction to the earlier decision table:** it listed `signal_high`/`signal_low`
as "NO (descriptor only)" while grouping them among values "all 46 are yours".
They are not calibratable at all; they are unread. With them excluded the count
is **44**.

### 2c. Capacity override (§13.7) — 3 values → 2 CALIBRATION, 1 RESOLVED

| Sub-value | Value in code | Class |
|---|---|---|
| `direction_clarity_high` | `"mean(Q17, Q19) >= 4.0"` | CALIBRATION |
| `alignment_low` | `"Q18 <= 2"` | CALIBRATION → but see below |
| `capacity_low` | `"Capacity mean <= 2.59"` | **RESOLVED 2026-10-01** — harmonised to 2.59, boundary-tested |

**`capacity_low` is done.** The operator directed the harmonisation to 2.59
("There must not be separate 2.50 and 2.59 interpretations in different
loaders/code paths"), and it is implemented with regression tests at 2.49 / 2.50
/ 2.59 / 2.60, mutation-proven. It is listed here only as a resolved item.

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
