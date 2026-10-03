# Perception Gap — Deferred (Module 8). Rejected design history.

**Status:** MODULE 8 DEFERRED PENDING PILOT EVIDENCE — owner decision, 2026-10-02.
**Nature of the deferral:** a deliberate product deferral. It is NOT authorization
to delete the underlying data or concept, and NOT a request to build anything.
**Scope of this document:** DOCUMENTATION ONLY. No implementation, no behaviour
change. This file exists so a future team does not unknowingly rebuild an approach
that was already designed, adversarially reviewed, and rejected.

---

## Read this first — why this file exists

A future reader will arrive here with a reasonable thought:

> "We should compare the participant's starting rating against their six areas."

That thought is the trap. It has now been pursued through **three full design
rounds**, each of which failed adversarial review **in a new way**. Every one of
the eight approaches below was rejected on structural grounds, not on
calibration or taste. Rebuilding any of them is re-buying a known failure.

The governing rule, above all others:

> **ONE SNAPSHOT PAYLOAD → TWO RENDERERS.** Web and PDF must not independently
> rescore or reinterpret participant responses. Renderers FORMAT stored findings;
> they never return to raw responses. (Addendum 01 v1.1 §5.)

That rule is a constraint on the *shape* of any eventual Perception Gap: the
decision must be made once, by the deterministic engine, and frozen into the
immutable snapshot. It is not a licence to invent a decision now.

---

## What ships in the pilot

The pilot ships the Money Picture **without Module 8**. The remaining modules
must close naturally around the supported set — the participant experiences a
**complete** Money Picture, not one with an obvious hole where Module 8 would be.

**Module 8 must not render.** The following participant-facing states are all
forbidden, verbatim and as concepts:

- "coming soon"
- "not enough information"
- an empty Module 8 container
- an error state
- a Perception Gap placeholder
- **any** indication that a planned module was withheld

The perceived absence is the product. A participant should finish believing they
saw a whole picture, not that a page was pulled.

**What remains in the snapshot payload (unchanged, reserved):**

| Field | Type | Meaning |
|---|---|---|
| `openingB` | `number \| null` | Opening B self-rating (1–5). RESERVED INPUT, never a result. |
| `q16Selections` | `string[]` | Raw Q16 destination codes, order/multiplicity preserved. |
| `perceptionGap` | `{ code, narrativeKey } \| null` | The gap result. Stays `null` until a method is approved. |
| `perceptionGapStatus` | `'finalized' \| 'not_ready' \| 'method_pending'` | Why `perceptionGap` is null. |

These are documented in `lib/assessment/snapshot-payload.ts` and pinned in
`lib/assessment/versions.ts`. A reserved nullable field may remain (removing it
is migration risk); no fabricated result is ever written into it. The config
still records `perception_gap.comparison_method: "TBD_PENDING_OPERATOR_REVIEW"`
in `config/scoring-v1.0.json` — deliberately unresolved, so the engine
**throws** (`PerceptionGapMethodUnspecifiedError`, `lib/assessment/perception-gap.ts`)
rather than guessing a rule.

---

## The deferred module at a glance

- **Opening B** — one question: *"Before we get started, how “Set for Life” do
  you feel financially right now?"* Options, in order: **Not at all / A little /
  Somewhat / Mostly / Completely** (stored `OPEN_B_A` … `OPEN_B_E`;
  `config/assessment-v1.0.json`). It is one holistic answer on a single
  confidence continuum.
- **Six signals** — `SEE, ROOM, DIRECT, PREPARE, AIM, MOVE`
  (`lib/assessment/types.ts`). Each is a *pattern revealed by responses*, not a
  self-rating.
- **Four approved outcomes** — `PERCEPTION_ALIGNED`,
  `PERCEPTION_MORE_OPTIMISTIC_THAN_PROFILE`,
  `PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE`, `PERCEPTION_MIXED_COMPLEX`.
- **Storage map** — `option_value_maps.profile_1_5 = { A:1, B:2, C:3, D:4, E:5 }`
  (`config/scoring-v1.0.json`). This is the whole source of the category error
  below.

---

## Rejected approach 1 — numeric six-to-one comparison (category error)

The instinct: map Opening B to a number, map each signal to a number, subtract,
call the difference "the gap."

**This is a category error.**

- Opening B is **one** holistic answer on a confidence continuum.
- The six signals are **patterns** revealed by responses across many items.
- The `A→1 … E→5` storage map is **bookkeeping**, not evidence that the scales
  are commensurable. The fact that both happen to be stored as an integer in
  `1..5` does not mean "1 unit of Starting Confidence" equals "1 unit of
  Financial Visibility" or "1 unit of Preparedness."

The per-dimension delta fabricated **six self-ratings the participant never
gave** — six numbers "how they feel about ROOM," "how they feel about AIM," etc.
— where the participant gave one number about the whole. That fabrication is the
failure, not a scaling detail.

**Both horns closed:**

1. **Keep six comparisons** → re-asserts the fabrication. You are still telling a
   participant they "rated" six areas they never rated.
2. **Collapse to one scalar** → you have manufactured the rejected composite
   (approach 2). An overall "offset" is exactly what the Money Picture forbids.

There is no stable midpoint between these horns; the construction itself is
wrong.

---

## Rejected approach 2 — no composite six-dimension score may be manufactured

The "holistic-offset model" was **"Opening B minus a reduction of six" wearing a
count-based disguise** — i.e. `openingB − f(count of signals below/above a band)`.
It was a composite six-dimension score with a subtraction sign in front of it.

This is forbidden by the methodology, which is explicit and binding (Addendum 01
v1.1 §2.1, §7):

> ONE ANSWER IS A DETAIL. TOGETHER, THEY MAKE A PICTURE.
> The participant is not being graded; **no overall score exists.**

Any model whose output is a single number *about the whole picture* is an overall
score, regardless of whether the arithmetic is dressed as an offset, a gap, a
"holistic position," or a count. The participant stays at the center; a composite
sits where the participant is.

---

## Rejected approach 3 — count-based pattern interpretation

Counting dimensions (how many signals are "below," "aligned," "above" the
participant's starting view) was **conceptually interesting** — it respected that
Opening B is holistic and the signals are many. It produced **no sound
deterministic method.**

Specifically: for every rule the team wrote over such counts, adversarial review
found either (a) a count pattern whose verdict flipped under a move that should
have been immaterial, or (b) a threshold that did not match the enumeration it
claimed to describe (see approaches 5 and 6). The interest did not survive
contact with determinism.

---

## Rejected approach 4 — capacity exclusion failed the neutrality property

To make any of the above work, the design needed a rule for *which* dimensions to
compare. The candidate was **capacity exclusion**: drop capacity-qualified
dimensions (those carrying a special state) before comparing, so that a
capacity-constrained participant's numbers aren't misread as self-delusion.

**Measured result (do not re-derive from scratch — trust this):** over all **63
single-exclusion pairs at N=6**, **18 move the verdict**, and they move it **in
BOTH directions**.

Concrete counterexample (the notation is the design's: `(below, aligned, above)`
counts):

- **`(0, 3, 3)` → NUANCE, but dropping a SAME dimension turns it into
  REINFORCED.** Excluding a dimension that was *agreed with* the verdict changed
  the verdict.
- **Reverse case:** excluding a capacity-qualified **ABOVE** dimension turned
  **NUANCE into REINFORCED** — dropping a dimension on the *other* side of the
  gap produced the same flip.

**Why this is not fixable by a smarter rule.** Removing a dimension changes the
**denominator and the majority structure** of the count. That is arithmetic, not
an oversight. Any exclusion changes both the total N and the relative share of
the remaining buckets, so a verdict that depends on a majority or a proportion
must sometimes flip when any dimension is removed. The team searched for a rule
over the *usable set* (the non-excluded dimensions) that makes exclusion neutral,
and **none exists**:

> No rule over the usable set was found that makes exclusion neutral.

Exclusion is therefore structurally incompatible with a count/threshold
verdict. This is the deepest of the eight failures.

---

## Rejected approach 5 — stated thresholds contradicted the published enumeration

A decision table was produced that stated thresholds and published the
enumerated outcomes those thresholds would produce.

- **N=6 reproduced exactly** — the enumeration was correct at the full six
  dimensions.
- **N=4 did not** — once a pair of dimensions was excluded (per approach 4), the
  stated thresholds no longer produced the published enumeration.

This is the same denominator problem as approach 4, surfacing as a documentation
contract failure: the table asserted a mapping that its own arithmetic could not
deliver. A threshold set and its enumeration must agree at **every** N the design
can reach, not just the full N.

---

## Rejected approach 6 — reinforcement guard produced unacceptable state-space behaviour

A "reinforcement guard" was added to make the REINFORCED verdict harder to reach
(the concern: too-easy reinforcement). With the extreme guard on, **REINFORCED
collapsed toward ~1% at some bands.**

This violates an **owner binding requirement**: reinforcement must be **genuinely
reachable for a clear-eyed participant**. A guard that makes "your starting view
and your responses agree" a 1% event tells clear-eyed participants they're
outliers. The guard could not be tuned to be strict *and* reachable; the two
requirements are in tension across the band structure, and no setting satisfied
both.

---

## Rejected approach 7 — CONTEXT MATTERS HERE was unreachable

"CONTEXT MATTERS HERE" is a preserved piece of the approved narrative/design
vocabulary (see below). One design tried to surface it as the Perception Gap
outcome when context prevented a confident comparison.

**It was unreachable** under the tested eligible-dimension structure: only
**DIRECT** and **AIM** can be set aside (those are the only signals that carry a
set-aside special state), so the minimum usable N is always **4**, and the floor
that would have triggered "CONTEXT MATTERS HERE" **never binds**. The condition
was dead code in the design — no input path reached it.

---

## Rejected approach 8 — three design rounds, each failed adversarial review in a new way

This is the meta-finding. It was not one flawed design. It was **three separate
rounds**, and repeated adversarial review exposed a **distinct structural
failure** in each:

1. Round 1 → the category error (approach 1) / composite score (approach 2).
2. Round 2 → the count-threshold determinism failure (approach 3), surfacing as
   the threshold/enumeration contradiction (approach 5).
3. Round 3 → the capacity-exclusion neutrality failure (approach 4) and the
   guard state-space collapse (approach 6).

The signal to read here is **not** "we need a fourth round." It is that the
module sits at a place where the natural toolset (compare, count, exclude,
threshold) has been exhausted. The owner's deferral — pending pilot evidence — is
the correct resting state. Do not run a fourth design round; do not manufacture a
deterministic method merely to complete the module.

---

## Binding rulings that remain if Perception Gap is ever revisited

These were decided before the deferral and are **not** invalidated by it. A
future implementation must inherit them:

1. **ROOM is compared normally at every rung.** ROOM is a capacity *case*, not a
   capacity *exclusion*. Financial margin is interpreted before discipline/agency
   criticism (Addendum 01 v1.1 §10) — but it is a real signal and enters the
   comparison like any other. Do not silently drop ROOM to make numbers line up.
2. **The exclusion set is exactly the three special states:**
   - `DIRECT_CAPACITY_LIMITED`
   - `DIRECT_LIMITED_EVIDENCE_CAPACITY`
   - `AIM_CAPACITY_CONSTRAINED_ALIGNMENT`
   (`config/narratives-v1.0.json` → `special_signal_states`.) No other dimension
   may be excluded, and no fourth special state may be invented to widen the
   set.
3. **Internal vs participant naming.** The internal class/state name is
   `INDETERMINATE_CONTEXT_FOR_INTERPRETATION`; the participant-facing phrase is
   **CONTEXT MATTERS HERE**. Keep the two namespaces separate — the internal name
   must never reach a participant, and the participant phrase must never be
   coerced into another module's copy merely to retain it (see below).

---

## Prohibited participant-facing vocabulary (verbatim)

Two prohibition lists exist and both stand.

**(a) Deferral-specific — Module 8 must not render.** None of these may appear
anywhere in the pilot Money Picture:

- "coming soon"
- "not enough information"
- an empty Module 8 container
- an error state
- a Perception Gap placeholder
- any indication that a planned module was withheld

**(b) Standing Perception-Gap framing — corrective/judgemental language is
forbidden** (UIUX §19, restated in `lib/assessment/perception-gap.ts`):

- "wrong"
- "misperception"
- "reality check"
- corrective arrows

The participant is never told their self-view was incorrect. The approved
outcome copy (e.g. `PERCEPTION_MORE_CAUTIOUS_THAN_PROFILE` → "You may be giving
yourself less credit than the patterns support") is already written in this
non-corrective register; do not regress it.

---

## Preserved vocabulary — CONTEXT MATTERS HERE

**"CONTEXT MATTERS HERE" stays in the approved narrative/design vocabulary.** Its
usefulness is broader than Perception Gap. Do **not** force it into another
module merely to retain it — that is how approach 7 got built, and it was dead on
arrival. It remains available for the moment a legitimate context gate appears
somewhere in the product.

---

## The future question (empirical, unanswered)

The deferral is pending **pilot evidence**, so the right next step is a question,
not a build:

> **Does participants' holistic starting perception show a useful, defensible
> relationship to any pattern across the six Money Picture dimensions?**

It is empirical and currently unanswered. If and when it is answered, the result
may land as **any one of** — or **none of**:

- a participant-facing insight,
- an Advisor Workspace insight,
- an aggregate research finding,
- a longitudinal comparison (same participant over time),
- **no feature at all.**

The correct disposition is to *collect the data and look*, not to force the
module. Opening B is already being collected for exactly this purpose.

---

## Opening B is preserved and is valuable pilot baseline data

The question is kept **exactly** as approved:

> *"Before we get started, how “Set for Life” do you feel financially right now?"*

Options, in order: **Not at all / A little / Somewhat / Mostly / Completely**.

Its response is preserved in the authoritative response/session data (item
`OPEN_B`, numeric `openingB` in the snapshot). Do **not**:

- delete it,
- repurpose it,
- reinterpret it,
- silently change its meaning, or
- score it into another construct merely because Perception Gap is deferred.

It remains valuable pilot baseline data — the raw material for the future
question above. Deferring the module is a reason to *keep the data pristine*, not
a reason to fold it into something else.

---

## For the next implementer — what NOT to do

- Do not implement the Perception Gap decision table.
- Do not run a fourth design round.
- Do not manufacture a deterministic method to complete the module.
- Do not add speculative Perception Gap outputs to the immutable
  `snapshot_payload` (a reserved nullable field may remain, with documented
  semantics and **no fabricated results ever written into it**).
- Do not begin Addendum 03.
- Do not touch: `lib/session/service.ts`,
  `app/api/session/[id]/snapshot/route.ts`,
  `tests/integration/schema-column-contract.test.ts`,
  `lib/assessment/versions.ts`, `lib/ui/human-questions.ts`,
  `tests/integration/snapshot-render-differential.test.ts`,
  `tests/integration/snapshot-resolution-single-source.test.ts` — other work owns
  these.

The engine's current behaviour — throw `PerceptionGapMethodUnspecifiedError` when
the Q16 gate is met but the method is unspecified, and surface
`perceptionGapStatus: 'method_pending'` rather than a fabricated result — is the
**intended** resting state. Leave it.
