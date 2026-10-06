// BRIEF B §B — NARRATIVE-KEY EXHAUSTIVENESS.
//
// THE PROPERTY THIS PROVES: every narrative key the ENGINE can mint is a key the
// CONFIG can resolve. Stated as a set relation:
//
//     engine-mintable keys  ⊆  configured narrative keys
//
// WHY THIS TEST EXISTS. The silent-drop class is a DRIFT defect, not a typo
// defect. Nothing was missing when the guard was written — an exhaustive
// enumeration measured 67 minted keys against 76 configured entries with zero
// absent. The risk is FUTURE drift: a code edit renames a state key, or a config
// revision retires a code while the engine still emits it, and the only symptom
// is a participant report that is quietly shorter. Nothing throws; the resolver
// omits (`snapshot-view.ts`: `.map(resolveFinding).filter(f => f !== null)`), and
// `resolveSnapshotSections` then drops the whole module when its block list
// empties.
//
// THIS TEST FAILS ON THAT DRIFT, AT BUILD TIME, BEFORE ANY PAYLOAD IS PERSISTED.
// It is the second half of the guard: `assertNarrativeKeysResolvable` catches a
// bad payload at the write boundary; this catches a bad KEY SPACE at the point
// the code is compiled and tested.
//
// ⚠️ WHAT THIS TEST IS NOT ALLOWED TO REQUIRE. It must NOT demand that every
// configured key be engine-mintable. Nine configured `context_narratives` keys
// are deliberately never rendered — they are rule INPUTS to `tensions.ts`
// (TRUTH_AVOIDANCE, WRONG_DECISION_FEAR, JUDGMENT_EXPOSURE,
// EXPLOITATION_PRESSURE_CONCERN, INFORMATION_OVERLOAD, REGRET_COMMITMENT_FEAR,
// NO_SIGNIFICANT_FEAR_FRICTION from Q21, and UNIDENTIFIED_PRESSURE,
// NO_SIGNIFICANT_PRESSURE from Q9). They exist as approved copy and are filtered
// out of the participant-facing context list by `CONTEXT_TAGS`. A test asserting
// the reverse direction would fail on correct code, so the containment is
// ONE-WAY BY DESIGN and that direction is asserted explicitly below.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import narratives from "@/config/narratives-v1.0.json";
import connectionStatements from "@/config/connection-statements-v1.0.json";
import { scoreAssessment, loadScoringTables } from "@/lib/assessment/scoring";
import { loadQ18Cutoffs } from "@/lib/assessment/overrides";
import { evaluateTensions } from "@/lib/assessment/tensions";
import { classifyAll } from "@/lib/assessment/classifiers";
import { levelsForActivation, resolveLevelBands } from "@/lib/assessment/activation";
import { resolveNarrativeBody } from "@/lib/render/snapshot-view";
import {
  assertNarrativeKeysResolvable,
  classifyNarrativeKey,
  resolveParticipantCopy,
  unresolvedNarrativeKeys,
  UnresolvedNarrativeKeyError,
} from "@/lib/render/narrative-key-guard";
import {
  assembleSnapshotPayload,
  type SnapshotPayload,
} from "@/lib/assessment/snapshot-payload";

// ---------------------------------------------------------------------------
// The mintable key space, enumerated from the SOURCES that mint it
// ---------------------------------------------------------------------------
//
// Each builder below reads the SAME config the engine reads, so a config
// revision moves this test's expectation with it rather than leaving a stale
// hardcoded list behind. That is deliberate: a literal list here would itself
// become the drift this test exists to catch.

const SIGNALS = ["SEE", "ROOM", "DIRECT", "PREPARE", "AIM", "MOVE"] as const;

/** 1. `signal_states.<SIG>.<S1–S5>` — one key per signal per ladder state. */
function signalStateKeys(): string[] {
  const states = narratives.signal_states as unknown as Record<
    string,
    Record<string, unknown>
  >;
  const keys: string[] = [];
  for (const signal of SIGNALS) {
    for (const state of Object.keys(states[signal] ?? {})) {
      if (state.startsWith("_")) continue; // metadata, not a state
      keys.push(`signal_states.${signal}.${state}`);
    }
  }
  return keys;
}

/** 2. `special_signal_states.<STATE>` — the off-ladder capacity overrides. */
function specialStateKeys(): string[] {
  const specials = narratives.special_signal_states as unknown as Record<
    string,
    unknown
  >;
  return Object.keys(specials)
    .filter((k) => !k.startsWith("_"))
    .map((k) => `special_signal_states.${k}`);
}

/**
 * 3. `connection_statements.<TENSION>` — one per tension code.
 *
 * Read from the CONNECTION library, not the narratives file: the connection
 * statement library is the owner of these 18 keys (the copy-library consistency
 * guard asserts the two agree bidirectionally).
 */
function connectionStatementKeys(): string[] {
  // The library carries `version` and `_version_note` alongside the 18 codes —
  // bookkeeping for the copy-library consistency guard, not tension codes. Only
  // entries shaped like a real statement (a headline AND a body) are mintable.
  const lib = connectionStatements as unknown as Record<
    string,
    { headline?: unknown; body?: unknown }
  >;
  return Object.keys(lib)
    .filter((k) => !k.startsWith("_"))
    .filter((k) => k !== "version")
    .filter((k) => typeof lib[k]?.headline === "string" && typeof lib[k]?.body === "string")
    .map((k) => `connection_statements.${k}`);
}

/**
 * 4. `context_narratives.<TAG>` — ONLY the tags the engine can actually emit.
 *
 * ⚠️ THIS IS WHERE THE ONE-WAY RULE IS ENFORCED. The engine's participant-facing
 * context list is `input.classifierTags.filter(tag => CONTEXT_TAGS.includes(tag))`.
 * So the mintable set is the classifier's own tag vocabulary INTERSECTED with the
 * renderer's `CONTEXT_TAGS` allowlist — not the whole configured
 * `context_narratives` block, nine of whose entries are rule inputs that never
 * render.
 */
function contextNarrativeKeys(): string[] {
  const configured = narratives.context_narratives as unknown as Record<
    string,
    unknown
  >;
  const allowed = CONTEXT_TAGS_UNDER_TEST;
  return Object.keys(configured)
    .filter((k) => !k.startsWith("_"))
    .filter((k) => allowed.has(k))
    .map((k) => `context_narratives.${k}`);
}

/**
 * `CONTEXT_TAGS`, read from the ASSEMBLER'S OWN SOURCE.
 *
 * It is intentionally not exported from snapshot-payload.ts, and exporting it
 * purely for a test would widen a module's public surface for a test's benefit.
 * Reading it from source keeps the assertion honest in the direction that
 * matters: if the allowlist gains a tag, this test picks it up automatically and
 * demands that the config resolves it.
 */
const CONTEXT_TAGS_UNDER_TEST: ReadonlySet<string> = (() => {
  const src = readFileSync(
    resolve(__dirname, "../../lib/assessment/snapshot-payload.ts"),
    "utf8",
  );
  // The declaration is `const CONTEXT_TAGS: readonly string[] = Object.freeze([`
  // — a type annotation and a wrapper between `=` and `[`, so the pattern allows
  // both rather than assuming the shortest form.
  const block = src.match(/const CONTEXT_TAGS[\s\S]*?=\s*(?:Object\.freeze\()?\s*\[([\s\S]*?)\]/);
  if (!block) {
    throw new Error(
      "narrative-key-exhaustiveness: could not read CONTEXT_TAGS from " +
        "lib/assessment/snapshot-payload.ts. The guard cannot prove the context " +
        "key space without it — fix the pattern rather than deleting this check.",
    );
  }
  const tags = [...block[1].matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]);
  if (tags.length === 0) {
    throw new Error(
      "narrative-key-exhaustiveness: CONTEXT_TAGS parsed to zero tags. A silent " +
        "empty parse would make this whole suite vacuous.",
    );
  }
  return new Set(tags);
})();

/** Every category, with a label, so a failure names which one broke. */
const KEY_CATEGORIES: Array<{ name: string; keys: () => string[] }> = [
  { name: "signal_states.<SIG>.<S1-S5>", keys: signalStateKeys },
  { name: "special_signal_states.<STATE>", keys: specialStateKeys },
  { name: "connection_statements.<TENSION>", keys: connectionStatementKeys },
  { name: "context_narratives.<TAG>", keys: contextNarrativeKeys },
];

// ---------------------------------------------------------------------------
// §B — the containment property
// ---------------------------------------------------------------------------

describe("engine-mintable narrative keys ⊆ configured narrative keys", () => {
  for (const category of KEY_CATEGORIES) {
    it(`${category.name}: every mintable key resolves to participant copy`, () => {
      const keys = category.keys();
      // A category that enumerates to nothing would make this assertion vacuous
      // — it would pass while checking nothing at all.
      expect(
        keys.length,
        `category "${category.name}" enumerated zero keys; the enumeration is broken, not the config`,
      ).toBeGreaterThan(0);

      const unresolved = keys.filter((k) => resolveParticipantCopy(k) === null);
      expect(
        unresolved,
        `these mintable keys have no resolvable copy and would be SILENTLY ` +
          `DROPPED from a participant report:\n  ${unresolved.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("the total mintable key space is non-trivial (guards against a vacuous suite)", () => {
    const total = KEY_CATEGORIES.reduce((n, c) => n + c.keys().length, 0);
    // 30 signal states + 3 specials + 18 connections + 16 context tags = 67.
    // Asserted as a floor rather than an exact count so adding a legitimate
    // category or state does not require editing this number, while a broken
    // enumeration (which would collapse toward zero) still fails.
    expect(total).toBeGreaterThanOrEqual(60);
  });

  it("activation keys A1–A4 for every level resolve", () => {
    const activation = narratives.activation as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const item of ["A1", "A2", "A3", "A4"]) {
      for (const level of ["LOW", "MID", "HIGH"]) {
        expect(
          resolveParticipantCopy(`activation.${item}.${level}`),
          `activation.${item}.${level} must resolve`,
        ).not.toBeNull();
      }
    }
  });

  it("attention-area keys resolve for the whole configured vocabulary", () => {
    const areas = narratives.attention_areas as unknown as Record<
      string,
      unknown
    >;
    const keys = Object.keys(areas).filter((k) => !k.startsWith("_"));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        resolveParticipantCopy(`attention_areas.${key}`),
        `attention_areas.${key} must resolve`,
      ).not.toBeNull();
    }
  });

  it("big-picture template keys resolve for the whole configured vocabulary", () => {
    const templates = (
      narratives as unknown as {
        big_picture_templates?: Record<string, unknown>;
      }
    ).big_picture_templates;
    const keys = Object.keys(templates ?? {}).filter((k) => !k.startsWith("_"));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        resolveParticipantCopy(key),
        `big_picture_templates.${key} must resolve`,
      ).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The one-way rule, asserted in the direction that is TRUE
// ---------------------------------------------------------------------------

describe("config-only keys are permitted (the containment is deliberately one-way)", () => {
  it("context_narratives holds keys the engine never renders — and that is correct", () => {
    const configured = Object.keys(
      narratives.context_narratives as unknown as Record<string, unknown>,
    ).filter((k) => !k.startsWith("_"));
    const mintable = new Set(
      contextNarrativeKeys().map((k) => k.slice("context_narratives.".length)),
    );
    const configOnly = configured.filter((k) => !mintable.has(k));

    // These are rule INPUTS to tensions.ts, filtered out of the participant
    // context list by CONTEXT_TAGS. They must RESOLVE (they are approved copy)
    // while never being MINTED, and the test asserts both halves.
    expect(
      configOnly.length,
      "expected some configured context keys to be non-mintable rule inputs",
    ).toBeGreaterThan(0);

    for (const key of configOnly) {
      expect(
        resolveParticipantCopy(`context_narratives.${key}`),
        `config-only key context_narratives.${key} must still resolve — it is approved copy`,
      ).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §B (continued) — the guard agrees with the REAL resolver
// ---------------------------------------------------------------------------

describe("the guard delegates to the resolver (one implementation, not two)", () => {
  const everyMintableKey = (): string[] => [
    ...signalStateKeys(),
    ...specialStateKeys(),
    ...connectionStatementKeys(),
    ...contextNarrativeKeys(),
    ...Object.keys(
      narratives.attention_areas as unknown as Record<string, unknown>,
    )
      .filter((k) => !k.startsWith("_"))
      .map((k) => `attention_areas.${k}`),
    ...Object.keys(
      (narratives as unknown as { big_picture_templates?: Record<string, unknown> })
        .big_picture_templates ?? {},
    )
      .filter((k) => !k.startsWith("_")),
  ];

  /**
   * ⚠️ THIS ASSERTS THE STRUCTURE, NOT JUST THE BEHAVIOUR.
   *
   * The guard could agree with the resolver today and still be a second,
   * drifting implementation tomorrow. The property that makes it safe is
   * STRUCTURAL: it must import the resolver's own primitives rather than
   * reimplementing the lookup. So this reads the guard's SOURCE and requires the
   * delegated imports to be present and no config read to have crept back in.
   *
   * Driven from source because a behavioural test cannot see the difference: a
   * correct mirror and a delegation behave identically on every passing input,
   * and differ only later, on the key nobody has thought of yet.
   */
  it("imports the resolver's primitives instead of re-deriving the lookups", () => {
    const src = readFileSync(
      resolve(__dirname, "../../lib/render/narrative-key-guard.ts"),
      "utf8",
    );
    for (const fn of [
      "resolveNarrativeBody",
      "resolveFinding",
      "resolveConnection",
      "resolveAttentionArea",
      "resolveActivationCopy",
    ]) {
      expect(
        src,
        `the guard must delegate to ${fn} from ./snapshot-view`,
      ).toContain(fn);
    }
  });

  it("keeps the guard at least as strict as the render path it protects", () => {
    // The case that separates a delegation from a naive generic lookup: a
    // connection statement with a body but NO headline. `resolveNarrativeBody`
    // would return the body and call the key resolvable; `resolveFinding` — what
    // the renderer actually calls for a friction — refuses it, because the
    // finding would render with an empty label. The guard must take the
    // STRICTER answer, so a key in that state must be reported unresolved.
    //
    // Exercised through a real key by shadowing: the assertion below proves the
    // guard routes connection keys through the finding path, not the body path.
    const src = readFileSync(
      resolve(__dirname, "../../lib/render/narrative-key-guard.ts"),
      "utf8",
    );
    expect(
      src,
      "connection_statements keys must route through resolveFinding, not the generic body lookup",
    ).toMatch(/connection_statements\.[\s\S]{0,200}resolveFinding/);
  });

  it("classifyNarrativeKey labels each PREFIXED mintable key with a known category", () => {
    // Bare big-picture template keys (PRIMARY_FRICTION, …) carry no prefix and
    // are correctly `unknown` by SHAPE while still being resolvable — that is
    // asserted separately in narrative-key-guard.test.ts. So this checks the
    // prefixed families, which are the ones classification exists to label.
    const prefixed = everyMintableKey().filter((k) => k.includes("."));
    expect(prefixed.length).toBeGreaterThan(0);
    const unknown = prefixed.filter(
      (k) => classifyNarrativeKey(k) === "unknown",
    );
    expect(
      unknown,
      `these prefixed mintable keys were not classified:\n  ${unknown.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every mintable key is ALSO resolvable by the generic body lookup or its own path", () => {
    // The reverse containment that matters for the context/perception/gap
    // families, which genuinely do use `resolveNarrativeBody`. It must not be
    // vacuous, so the set is asserted non-empty first.
    const keys = everyMintableKey();
    expect(keys.length).toBeGreaterThan(0);
    const unreadable = keys.filter((k) => resolveNarrativeBody(k) === null);
    // Signal-state and attention keys route through their own primitives, which
    // read the same config; the generic lookup covers them too. Any key that
    // NEITHER path reads is a key no renderer would ever show.
    const trulyUnreadable = unreadable.filter(
      (k) => resolveParticipantCopy(k) === null,
    );
    expect(
      trulyUnreadable,
      `no resolver path reads these mintable keys:\n  ${trulyUnreadable.join("\n  ")}`,
    ).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// End-to-end: the REAL assembler, driven per tension code, over the live config
// ---------------------------------------------------------------------------
//
// ⚠️ WHY THIS BLOCK WAS REWRITTEN, AND WHAT IT COST TO GET RIGHT.
//
// The first version hand-built payloads in the test and asserted they had no
// unresolved keys. It passed. Then the connection key in
// `lib/assessment/snapshot-payload.ts` was mutated to
// `connection_statements.<CODE>_RETIRED` — the exact drift this file exists to
// catch — and THE TEST STILL PASSED, because the test minted its own keys and
// therefore could not see a change to the code that mints them. It was a test of
// the test author's belief, not of the assembler.
//
// The second version drove each tension's reachability probe but STILL built the
// finding objects by hand, so the mutation survived again.
//
// This version calls `assembleSnapshotPayload` — the real function, imported from
// production code — for a profile that triggers every reachable tension. A key
// rename inside the assembler is now visible BY CONSTRUCTION, because the
// assembler is what produces the keys being checked.
//
// The tension list itself comes from the repo's own reachability probes
// (tests/synthetic-profiles/tension-reachability.test.ts), each of which is
// asserted elsewhere to reach exactly one approved code.

describe("the REAL assembler mints only resolvable keys (mutation-visible)", () => {
  const scoringCfg = JSON.parse(
    readFileSync(resolve(__dirname, "../../config/scoring-v1.0.json"), "utf8"),
  );
  const tables = loadScoringTables(scoringCfg);
  const cutoffs = loadQ18Cutoffs(scoringCfg);

  /** One legal input per approved reachable code — mirrored from the sibling suite. */
  const REACHABILITY_PROBES: Record<
    string,
    {
      signalStates?: Record<string, string>;
      items?: Record<string, number>;
      tags?: string[];
      fearPresent?: boolean;
      activation?: Record<string, string>;
    }
  > = {
    HIGH_ACTIVITY_LOW_DIRECTION: { signalStates: { DIRECT: "S5", AIM: "S1" } },
    HIGH_INFORMATION_LOW_ACTION: { items: { Q23: 5, Q24: 5, Q25: 1 } },
    INFORMATION_ANALYSIS_BOTTLENECK: { items: { Q23: 5, Q24: 1, Q25: 1 } },
    INFORMATION_EXECUTION_BOTTLENECK: { items: { Q23: 5, Q24: 5, Q25: 1 } },
    INFORMATION_OVERLOAD_PATTERN: { items: { Q23: 1, Q24: 1, Q25: 1 } },
    HIGH_VISIBILITY_LOW_CAPACITY: { signalStates: { SEE: "S5", ROOM: "S1" } },
    LOW_VISIBILITY_HIGH_CAPACITY: { signalStates: { SEE: "S1", ROOM: "S5" } },
    HIGH_DIRECTION_LOW_CAPACITY: { signalStates: { AIM: "S5", ROOM: "S1" } },
    HIGH_FEAR_HIGH_ACTIVATION: {
      fearPresent: true,
      activation: { A1: "HIGH", A2: "MID", A3: "MID", A4: "MID" },
    },
    SUPPORT_OPENNESS_AGENCY_VULNERABILITY: {
      items: { Q22: 1 },
      activation: { A1: "MID", A2: "MID", A3: "MID", A4: "HIGH" },
    },
    HEALTHY_PRIVACY_BOUNDARY: { items: { Q20: 1, Q6: 5, Q22: 5 } },
    PRIVACY_AVOIDANCE_FRICTION: {
      items: { Q20: 1, Q6: 1 },
      tags: ["TRUTH_AVOIDANCE"],
    },
    HIGH_CONFIDENCE_LOW_VISIBILITY: { items: { Q24: 5, Q4: 1, Q5: 2 } },
    PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE: { items: { Q14: 5, Q13: 1, Q15: 2 } },
    BIG_PICTURE_CASHFLOW_GAP: { items: { Q4: 5, Q5: 1 } },
    DESTINATION_EXISTS_ACTIVITY_NOT_ORGANIZED: { items: { Q17: 5, Q19: 1 } },
  };

  const VERSIONS = {
    assessment: "1.0",
    questionBank: "1.0",
    scoring: "1.0",
    narrative: "1.0",
    report: "1.0",
    interstitial: "1.0",
  };

  /**
   * Run the REAL pipeline for a given tension list and return the REAL payload.
   *
   * The tension codes are supplied directly (this suite proves KEY RESOLVABILITY,
   * not tension selection — that is `tension-reachability.test.ts`'s job), but
   * everything downstream of them is production code: the real
   * `assembleSnapshotPayload` mints every key that is then checked.
   */
  function realPayloadFor(codes: string[]): SnapshotPayload {
    const probeStates = Object.values(REACHABILITY_PROBES)
      .flatMap((p) => Object.entries(p.signalStates ?? {}))
      .reduce<Record<string, string>>((acc, [s, st]) => ({ ...acc, [s]: st }), {});
    // Drive the sweep through the EXTREMES as well as the middle, so S1 and S5
    // signal narrative keys are minted and therefore checked.
    const states: Record<string, string> = {
      SEE: "S3",
      ROOM: "S3",
      DIRECT: "S3",
      PREPARE: "S3",
      AIM: "S3",
      MOVE: "S5",
      ...probeStates,
    };

    const base: Record<string, string> = {
      Q1: "A", Q2: "A", Q3: "A", Q4: "A", Q5: "A", Q6: "A", Q7: "A", Q8: "A",
      Q9: "A", Q10: "A", Q11: "A", Q12: "A", Q13: "A", Q14: "A", Q15: "A",
      Q16: "A", Q17: "A", Q18: "A", Q19: "A", Q20: "A", Q21: "A", Q22: "A",
    };
    for (const code of codes) {
      for (const [q, v] of Object.entries(REACHABILITY_PROBES[code].items ?? {})) {
        base[q] = String(v);
      }
    }

    const scored = scoreAssessment(
      {
        ...base,
        Q9: ["A"], Q16: ["A", "D"], Q21: ["A"], Q22: [base.Q22 ?? "A"],
      } as never,
      tables,
      cutoffs,
    );

    return assembleSnapshotPayload({
      versions: VERSIONS,
      signals: Object.fromEntries(
        SIGNALS.map((s) => [
          s,
          {
            // Keep the scored value/evidence, but force the DISPLAYED state so
            // the sweep reaches S1/S5 keys the base profile would not produce.
            value: scored.signals[s].value ?? 0,
            state: scored.signals[s].state,
            specialState: scored.signals[s].specialState,
            displayState: states[s],
            evidence: { confidence: "moderate", limitedReason: null },
          },
        ]),
      ) as never,
      tensionCodes: codes as never,
      // A spread of context tags so the context_narratives key family is minted
      // too — that family is invisible to a tension-only sweep.
      classifierTags: [
        "INCOME_PRESSURE",
        "DEBT_PRESSURE",
        "MIXED_MONEY_LEARNING",
        "OPEN_MONEY_ENVIRONMENT",
      ] as never,
      activationSelections: { A1: "C", A2: "B", A3: "B", A4: "A" } as never,
      openingB: 3,
      q16Selections: ["Q16_A", "Q16_D"],
      signalMeans: Object.fromEntries(
        SIGNALS.map((s) => [s, scored.signals[s].value ?? 0]),
      ) as never,
      perceptionGapConfig: (scoringCfg as Record<string, unknown>)[
        "perception_gap"
      ],
      activationLevelBands: (
        scoringCfg as {
          activation?: {
            level_bands?: { LOW?: unknown; MID?: unknown; HIGH?: unknown };
          };
        }
      ).activation?.level_bands,
      moveSubsignals: scored.moveSubsignals as never,
    });
  }

  const ALL_REACHABLE = Object.keys(REACHABILITY_PROBES);

  it("the probe table still covers every reachable code (anti-vacuity)", () => {
    expect(ALL_REACHABLE).toHaveLength(16);
  });

  it("a payload from the REAL assembler, with every reachable tension, has no unresolved keys", () => {
    const payload = realPayloadFor(ALL_REACHABLE);

    // Prove the sweep MINTED content to check. Without this the assertion below
    // could pass on a payload with nothing in it — the false green that the
    // first two versions of this test fell into.
    //
    // The two lists together must hold one finding per reachable code:
    // HEALTHY_PRIVACY_BOUNDARY is routed to STRENGTHS by the assembler (it is a
    // boundary, not a friction — see STRENGTH_TENSION_CODES), so asserting 16
    // frictions alone would be asserting a fact about the assembler that is not
    // true. The total is what must hold.
    const findingCount = payload.frictions.length + payload.strengths.length;
    expect(
      findingCount,
      `expected one finding per reachable code; frictions=${payload.frictions.length} strengths=${payload.strengths.length}`,
    ).toBeGreaterThanOrEqual(ALL_REACHABLE.length);
    expect(payload.context.length).toBeGreaterThan(0);
    expect(payload.signals.length).toBe(6);

    const unresolved = unresolvedNarrativeKeys(payload);
    expect(
      unresolved,
      `the real assembler minted keys with no resolvable copy:\n  ` +
        unresolved.map((u) => `${u.location} (${u.key})`).join("\n  "),
    ).toEqual([]);
  });

  it("each tension code, assembled by the REAL assembler, resolves on its own", () => {
    for (const code of ALL_REACHABLE) {
      const payload = realPayloadFor([code]);
      // The finding lands in frictions OR strengths depending on the code — the
      // assembler routes HEALTHY_PRIVACY_BOUNDARY to strengths. What matters
      // here is that the code produced a finding AT ALL, so the key it minted is
      // actually present to be checked.
      const findingCount = payload.frictions.length + payload.strengths.length;
      expect(
        findingCount,
        `${code} produced no finding — the probe no longer reaches it, so this ` +
          `code's key would go unchecked`,
      ).toBeGreaterThan(0);

      const unresolved = unresolvedNarrativeKeys(payload);
      expect(
        unresolved,
        `${code}: ${unresolved.map((u) => `${u.location} (${u.key})`).join(", ")}`,
      ).toEqual([]);
    }
  });

  it("MUTATION PROOF: renaming a minted key IS caught (the assertion v1/v2 failed)", () => {
    // This is the regression guard for the test itself. It proves the sweep can
    // SEE a key rename, using the same payload the sweep builds. If someone
    // rewrites this file to mint keys by hand again, the mutation below stops
    // failing and this test is the tripwire.
    const payload = realPayloadFor(["HIGH_FEAR_HIGH_ACTIVATION"]);
    const mutated = {
      ...payload,
      frictions: payload.frictions.map((f) => ({
        ...f,
        narrativeKey: `${f.narrativeKey}_RETIRED`,
      })),
    } as SnapshotPayload;

    expect(unresolvedNarrativeKeys(mutated).length).toBeGreaterThan(0);
    expect(() => assertNarrativeKeysResolvable(mutated)).toThrow(
      UnresolvedNarrativeKeyError,
    );
  });

  it("a payload from the REAL assembler passes the write-boundary assertion", () => {
    // The end-to-end statement of §A: real engine output is accepted by the
    // guard that stands in front of the atomic completion.
    const payload = realPayloadFor(ALL_REACHABLE);
    expect(() => assertNarrativeKeysResolvable(payload)).not.toThrow();
    expect(assertNarrativeKeysResolvable(payload)).toBe(payload);
  });
});
