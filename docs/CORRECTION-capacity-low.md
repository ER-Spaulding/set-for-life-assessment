# Correction — the `capacity_low` "two loader" claim was wrong

**Applies to:** commit `fe55a3a` ("Harmonize capacity_low to 2.59 across both
loaders") and the §2c sections of `docs/DECISIONS-REQUIRED.md` and
`docs/DECISIONS-REQUIRED-02.md`.

**Status:** the fix is correct and stays. Its *justification* was wrong, and two
documents built an operator decision on top of it. This records both.

---

## What was claimed

The commit message, and the decision table before it, described a defect with a
specific shape:

> **THE DEFECT.** One concept, two loaders, two fields, disagreeing by 0.09:
>
> ```
> tension engine       tension_thresholds.capacity_low.value   -> 2.59
> §13.7 Q18 override   overrides...condition.capacity_low      -> 2.5
> ```
>
> A participant whose capacity mean fell in `(2.5, 2.59]` was capacity-limited
> for one rule and not the other.

The decision table escalated this to "**Needs you: YES**" on that basis, calling
it a 0.09-wide hole in §12.2's protection **spanning two code paths**.

## What is actually true

**`capacity_low` has exactly one live reader, and it is the override.**

```
$ grep -rn "capacity_low" lib app components
lib/assessment/overrides.ts:121:    capacityLowAtOrBelow: num('capacity_low'),
```

One hit. The tension engine never reads the field.

**Why not.** `loadTensionThresholds` (`tensions.ts:167`) does load
`tension_thresholds.capacity_low` into its map — it has a `value` string, so it
parses. But `thresholdForRef` (`tensions.ts:186`) can only resolve a key that
some trigger names, and the config contains 21 `threshold_ref` uses across only
**three** keys:

```
tension_thresholds.item_high      x8
tension_thresholds.item_low       x11
tension_thresholds.pair_low_avg   x2
```

`capacity_low` is named by none of them. It is **loaded and then unreachable**.

**What the capacity tensions actually gate on.** The two tensions that look like
they should read it use signal *states*:

```json
HIGH_DIRECTION_LOW_CAPACITY: { "all": [
  { "signal": "AIM",  "state_in": ["S4","S5"] },
  { "signal": "ROOM", "state_in": ["S1","S2"] } ] }
```

Their capacity boundary is the **S2 band edge** (`min 1.0 / max 2.59`), which was
**already 2.59** before this work. So `HIGH_DIRECTION_LOW_CAPACITY` could not
have had the (2.5, 2.59] gap under any configuration of `capacity_low`.

## The corrected history

| Claim | Reality |
|---|---|
| Two loaders disagreed | **One** live loader (the override) plus **one dead field** |
| The gap spanned two paths | The gap was **single-path** — §13.7 only |
| Participants were "capacity-limited for one rule and not the other" | **No participant ever was.** One rule was 0.09 too tight |
| The fix closed a cross-path inconsistency | The fix corrected **one** threshold from 2.5 to 2.59 |

The bug was real. It was just smaller and simpler than described, and the
description is what the operator was asked to decide on.

## Consequences

1. **The fix stays.** `overrides.ts:121` reads 2.59, boundary-tested at
   2.49 / 2.50 / 2.59 / 2.60 and mutation-proven. That path is the live one, so
   the change is the substantive one.

2. **The operator decision was over-scoped.** Both documents marked §2c as
   "YES — needs you" and one called it the highest-risk item. On the corrected
   reading there is nothing for the operator to decide: one threshold was too
   tight, and it is now consistent with the approved S2 band. Both documents are
   annotated accordingly.

3. **`tension_thresholds.capacity_low` is dead config** — a tidiness issue, not a
   scoring one. Two resolutions: wire it to the two capacity tensions (making the
   boundary independently tunable instead of pinned to the S2 band edge, which
   would arguably be an improvement), or delete it. Neither changes current
   behaviour.

4. **This is the second time in this build that an overstated claim survived into
   a commit.** The first was the analytics deny-list, which was reported working
   until it was run against a real database and accepted `{"q1":"Q1_A"}`. Both
   were caught by *executing* rather than re-reading. The pattern worth keeping:
   a claim about a code path is a hypothesis until something is run against it.

## How this was found

Not by re-reading the commit — by tracing every configurable value against its
actual readers and finding that one of them had none. The trace is
`docs/SPEC-TRACE-46.md` §2b.
