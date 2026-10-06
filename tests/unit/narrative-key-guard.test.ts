// BRIEF B §A + §C — THE WRITE-BOUNDARY REFUSAL AND THE TOLERANT HISTORICAL READ.
//
// Two guarantees, and they point in OPPOSITE directions on purpose:
//
//   §A  A NEW payload whose narrative keys do not resolve must FAIL LOUDLY at
//       the write boundary, before the atomic completion persists it. An
//       immutable row that renders a silently shortened report is
//       unrecoverable — `snapshots` refuses every UPDATE.
//
//   §C  A HISTORICAL payload must keep RENDERING even when a later config
//       revision retires a key it carries. The participant's report is a record
//       of what they were given; refusing to open it would convert "we retired a
//       sentence" into "your report is broken".
//
// Both are proved here by executing the real functions rather than by asserting
// that they exist. §C's proof is deliberately a HEAD-TO-HEAD with §A: the SAME
// stale key must throw at the writer and render fail-soft at the reader. A test
// that only showed one half would not distinguish the behaviour from a guard
// that had been wired into both paths.

import { describe, it, expect } from "vitest";
import {
  assertNarrativeKeysResolvable,
  classifyNarrativeKey,
  logUnresolvedNarrativeKeys,
  narrativeKeysInPayload,
  resolveParticipantCopy,
  unresolvedNarrativeKeys,
  UnresolvedNarrativeKeyError,
} from "@/lib/render/narrative-key-guard";
import { resolveSnapshotView, resolveNarrativeBody } from "@/lib/render/snapshot-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";

// ---------------------------------------------------------------------------
// A minimal REAL-SHAPED payload
// ---------------------------------------------------------------------------

/**
 * A payload shaped exactly as `assembleSnapshotPayload` builds one, small enough
 * to reason about. Every key here is a real configured key, so the baseline
 * payload is provably clean and any failure below is caused by the mutation the
 * individual test makes — not by the fixture.
 */
function makePayload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    versions: {
      assessment: "1.0",
      questionBank: "1.0",
      scoring: "1.0",
      narrative: "1.0",
      report: "1.0",
      interstitial: "1.0",
      instrument: "1.0",
      scoringEngine: "1.0",
      narrativeLibrary: "1.0",
      snapshotSchema: "1.1",
    },
    signals: [
      {
        signal: "SEE",
        state: "S3",
        specialState: null,
        displayState: "S3",
        narrativeKey: "signal_states.SEE.S3",
        evidence: { confidence: "moderate", limitedReason: null },
      },
      {
        signal: "MOVE",
        state: "S5",
        specialState: null,
        displayState: "S5",
        narrativeKey: "signal_states.MOVE.S5",
        evidence: { confidence: "moderate", limitedReason: null },
      },
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: [
        "signal_states.MOVE.S5",
        "connection_statements.HIGH_FEAR_HIGH_ACTIVATION",
        "attention_areas.BUILD_DECISION_CONFIDENCE",
      ],
    },
    strengths: [
      {
        source: "signal",
        code: "MOVE",
        narrativeKey: "signal_states.MOVE.S5",
      },
    ],
    frictions: [
      {
        source: "tension",
        code: "HIGH_FEAR_HIGH_ACTIVATION",
        narrativeKey: "connection_statements.HIGH_FEAR_HIGH_ACTIVATION",
      },
    ],
    connections: [
      {
        code: "HIGH_FEAR_HIGH_ACTIVATION",
        narrativeKey: "connection_statements.HIGH_FEAR_HIGH_ACTIVATION",
      },
    ],
    context: [
      {
        code: "INCOME_PRESSURE",
        narrativeKey: "context_narratives.INCOME_PRESSURE",
      },
    ],
    perceptionGap: null,
    perceptionGapStatus: "method_pending",
    activation: { A1: "LOW", A2: "MID", A3: "HIGH", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["BUILD_DECISION_CONFIDENCE"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A"],
    openingB: 3,
    ...overrides,
  } as SnapshotPayload;
}

// ---------------------------------------------------------------------------
// The baseline must be clean, or every assertion below is meaningless
// ---------------------------------------------------------------------------

describe("the baseline payload is clean (so later failures have a cause)", () => {
  it("enumerates the key surface and finds no unresolved key", () => {
    const payload = makePayload();
    const refs = narrativeKeysInPayload(payload);
    // Sanity: the walker must actually SEE keys. A walker that returned [] would
    // make `unresolvedNarrativeKeys` vacuously empty and this whole file a
    // no-op — the classic false green.
    expect(refs.length).toBeGreaterThanOrEqual(8);
    expect(unresolvedNarrativeKeys(payload)).toEqual([]);
  });

  it("covers every key-bearing field, not just the obvious ones", () => {
    const locations = narrativeKeysInPayload(makePayload()).map((r) => r.location);
    for (const expected of [
      "signals[0].narrativeKey",
      "strengths[0].narrativeKey",
      "frictions[0].narrativeKey",
      "connections[0].narrativeKey",
      "context[0].narrativeKey",
      "bigPicture.parts[0]",
      "attentionAreas[0]",
      // The activation key is COMPOSED from item + level, not stored literally.
      "activation.A1",
    ]) {
      expect(locations, `the key walker must cover ${expected}`).toContain(expected);
    }
  });

  it("composes the activation key from item and level, as the renderer does", () => {
    const refs = narrativeKeysInPayload(makePayload());
    const a1 = refs.find((r) => r.location === "activation.A1");
    expect(a1?.key).toBe("activation.A1.LOW");
    expect(resolveParticipantCopy("activation.A1.LOW")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §A — the writer refuses, loudly, before persistence
// ---------------------------------------------------------------------------

describe("§A — a stale key fails the write path", () => {
  it("throws UnresolvedNarrativeKeyError for a renamed friction key", () => {
    const payload = makePayload({
      frictions: [
        {
          source: "tension",
          code: "HIGH_FEAR_HIGH_ACTIVATION",
          narrativeKey: "connection_statements.RETIRED_CODE_V9",
        },
      ],
    } as Partial<SnapshotPayload>);

    expect(() => assertNarrativeKeysResolvable(payload)).toThrow(
      UnresolvedNarrativeKeyError,
    );
  });

  it("names the offending FIELD and KEY in the message, not just the key", () => {
    const payload = makePayload({
      frictions: [
        {
          source: "tension",
          code: "HIGH_FEAR_HIGH_ACTIVATION",
          narrativeKey: "connection_statements.RETIRED_CODE_V9",
        },
      ],
    } as Partial<SnapshotPayload>);

    let caught: unknown;
    try {
      assertNarrativeKeysResolvable(payload);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnresolvedNarrativeKeyError);
    const err = caught as UnresolvedNarrativeKeyError;
    expect(err.message).toContain("frictions[0].narrativeKey");
    expect(err.message).toContain("connection_statements.RETIRED_CODE_V9");
    expect(err.unresolved).toHaveLength(1);
  });

  it("catches a stale key in EVERY key-bearing field, one field at a time", () => {
    // A guard that only walked `frictions` would pass a payload whose SIGNAL key
    // had gone stale — and a stale signal key removes a whole row from the Money
    // Picture. Each case below mutates exactly one field.
    const cases: Array<[string, Partial<SnapshotPayload>]> = [
      [
        "signals",
        {
          signals: [
            {
              signal: "SEE",
              state: "S3",
              specialState: null,
              displayState: "S3",
              narrativeKey: "signal_states.SEE.S9",
              evidence: { confidence: "moderate", limitedReason: null },
            },
          ] as never,
        },
      ],
      [
        "strengths",
        {
          strengths: [
            { source: "signal", code: "MOVE", narrativeKey: "signal_states.MOVE.S9" },
          ] as never,
        },
      ],
      [
        "connections",
        {
          connections: [
            { code: "X", narrativeKey: "connection_statements.RETIRED_CODE_V9" },
          ] as never,
        },
      ],
      [
        "context",
        {
          context: [
            { code: "X", narrativeKey: "context_narratives.RETIRED_TAG_V9" },
          ] as never,
        },
      ],
      ["bigPicture.parts", { bigPicture: { template: "PRIMARY_FRICTION", parts: ["attention_areas.RETIRED_AREA"] } as never }],
      ["attentionAreas", { attentionAreas: ["SEE_IT_MORE_CLEARLY_V9"] as never }],
      ["activation", { activation: { A1: "SEVERE", A2: "MID", A3: "HIGH", A4: "HIGH" } as never }],
    ];

    for (const [field, override] of cases) {
      const payload = makePayload(override);
      expect(
        unresolvedNarrativeKeys(payload).length,
        `a stale ${field} key must be reported unresolved`,
      ).toBeGreaterThan(0);
      expect(
        () => assertNarrativeKeysResolvable(payload),
        `a stale ${field} key must fail the write path`,
      ).toThrow(UnresolvedNarrativeKeyError);
    }
  });

  it("returns the SAME payload object on success (so it composes inline)", () => {
    const payload = makePayload();
    expect(assertNarrativeKeysResolvable(payload)).toBe(payload);
  });

  it("does not repair, drop, or rewrite the payload it refuses", () => {
    // The refusal must be a refusal — not a silent sanitisation. The payload is
    // inspected AFTER the throw and must still carry the stale finding.
    const payload = makePayload({
      frictions: [
        {
          source: "tension",
          code: "HIGH_FEAR_HIGH_ACTIVATION",
          narrativeKey: "connection_statements.RETIRED_CODE_V9",
        },
      ],
    } as Partial<SnapshotPayload>);

    expect(() => assertNarrativeKeysResolvable(payload)).toThrow();
    expect(payload.frictions).toHaveLength(1);
    expect(payload.frictions[0].narrativeKey).toBe(
      "connection_statements.RETIRED_CODE_V9",
    );
  });
});

// ---------------------------------------------------------------------------
// §C — the historical read stays tolerant
// ---------------------------------------------------------------------------

describe("§C — a stored stale key still renders (fail-soft, never a throw)", () => {
  const stalePayload = makePayload({
    frictions: [
      {
        source: "tension",
        code: "HIGH_FEAR_HIGH_ACTIVATION",
        narrativeKey: "connection_statements.RETIRED_CODE_V9",
      },
    ],
  } as Partial<SnapshotPayload>);

  it("resolveSnapshotView does NOT throw on a retired key", () => {
    expect(() => resolveSnapshotView(stalePayload)).not.toThrow();
  });

  it("OMITS the unresolvable finding rather than rendering the raw key (§24)", () => {
    const view = resolveSnapshotView(stalePayload);
    expect(view.frictions).toEqual([]);
    // The raw internal key must never surface as participant-facing copy.
    const rendered = JSON.stringify(view);
    expect(rendered).not.toContain("RETIRED_CODE_V9");
  });

  it("resolveSnapshotContent does NOT throw either — the whole section model builds", () => {
    expect(() => resolveSnapshotContent(stalePayload)).not.toThrow();
  });

  it("drops the MODULE when its only key is stale (the consequence being guarded)", () => {
    // This is the harm, demonstrated rather than asserted in prose: the Friction
    // module vanishes from the participant's report with no error anywhere. The
    // read is correct to do this; the write guard exists so it never has to.
    const clean = resolveSnapshotContent(makePayload());
    const stale = resolveSnapshotContent(stalePayload);
    expect(clean.some((s) => s.id === "friction")).toBe(true);
    expect(stale.some((s) => s.id === "friction")).toBe(false);
  });

  it("keeps a module when only SOME of its findings are stale", () => {
    const partiallyStale = makePayload({
      frictions: [
        {
          source: "tension",
          code: "HIGH_FEAR_HIGH_ACTIVATION",
          narrativeKey: "connection_statements.HIGH_FEAR_HIGH_ACTIVATION",
        },
        {
          source: "tension",
          code: "RETIRED",
          narrativeKey: "connection_statements.RETIRED_CODE_V9",
        },
      ],
    } as Partial<SnapshotPayload>);

    const view = resolveSnapshotView(partiallyStale);
    expect(view.frictions).toHaveLength(1);
    const sections = resolveSnapshotContent(partiallyStale);
    const friction = sections.find((s) => s.id === "friction");
    expect(friction?.blocks).toHaveLength(1);
  });

  it("THE HEAD-TO-HEAD: the same stale key throws at write and renders at read", () => {
    // The single assertion that proves the two directions are genuinely wired to
    // different behaviour. If someone made the resolver throw, or made the
    // writer warn-and-continue, this fails.
    expect(() => assertNarrativeKeysResolvable(stalePayload)).toThrow(
      UnresolvedNarrativeKeyError,
    );
    expect(() => resolveSnapshotView(stalePayload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §C — structured logging (observable, and never participant-facing)
// ---------------------------------------------------------------------------

describe("§C — unresolved historical keys are logged server-side", () => {
  it("returns [] and logs nothing when every key resolves", () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void seen.push(String(args[0]));
    try {
      const out = logUnresolvedNarrativeKeys(makePayload(), {
        sessionId: "s-1",
        surface: "web",
      });
      expect(out).toEqual([]);
      expect(seen).toEqual([]);
    } finally {
      console.error = original;
    }
  });

  it("logs one structured line naming the location and key, and still returns normally", () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void seen.push(String(args[0]));
    try {
      const stale = makePayload({
        frictions: [
          {
            source: "tension",
            code: "HIGH_FEAR_HIGH_ACTIVATION",
            narrativeKey: "connection_statements.RETIRED_CODE_V9",
          },
        ],
      } as Partial<SnapshotPayload>);

      const out = logUnresolvedNarrativeKeys(stale, {
        sessionId: "s-1",
        surface: "pdf",
      });

      expect(seen).toHaveLength(1);
      const parsed = JSON.parse(seen[0]);
      expect(parsed.event).toBe("snapshot_unresolved_narrative_keys");
      expect(parsed.surface).toBe("pdf");
      expect(parsed.count).toBe(1);
      expect(parsed.unresolved[0].location).toBe("frictions[0].narrativeKey");
      expect(parsed.unresolved[0].key).toBe("connection_statements.RETIRED_CODE_V9");
      // It reports; it does not repair.
      expect(out).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  it("never logs a resolved copy string or the session id as participant content", () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void seen.push(String(args[0]));
    try {
      const stale = makePayload({
        frictions: [
          {
            source: "tension",
            code: "HIGH_FEAR_HIGH_ACTIVATION",
            narrativeKey: "connection_statements.RETIRED_CODE_V9",
          },
        ],
      } as Partial<SnapshotPayload>);
      logUnresolvedNarrativeKeys(stale, { sessionId: "s-1", surface: "web" });

      const line = seen[0];
      // The log names internal vocabulary (§24-safe: it is a SERVER log) but must
      // not carry resolved participant copy from the healthy parts of the report.
      const approvedCopy = resolveNarrativeBody("signal_states.MOVE.S5");
      expect(approvedCopy).not.toBeNull();
      expect(line).not.toContain(approvedCopy as string);
    } finally {
      console.error = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Classification (diagnostic surface, used by the exhaustiveness test)
// ---------------------------------------------------------------------------

describe("classifyNarrativeKey", () => {
  it("labels each family by its prefix — regardless of whether the code exists", () => {
    expect(classifyNarrativeKey("signal_states.SEE.S3")).toBe("signal_state");
    expect(classifyNarrativeKey("special_signal_states.DIRECT_CAPACITY_LIMITED")).toBe(
      "special_signal_state",
    );
    expect(classifyNarrativeKey("connection_statements.HIGH_FEAR_HIGH_ACTIVATION")).toBe(
      "connection_statement",
    );
    expect(classifyNarrativeKey("context_narratives.INCOME_PRESSURE")).toBe(
      "context_narrative",
    );
    expect(classifyNarrativeKey("attention_areas.SEE_IT_MORE_CLEARLY")).toBe(
      "attention_area",
    );
    expect(classifyNarrativeKey("activation.A1.LOW")).toBe("activation");
    expect(classifyNarrativeKey("perception_gap.PERCEPTION_ALIGNED")).toBe(
      "perception_gap",
    );
  });

  it("⚠️ classifies SHAPE, not EXISTENCE — a retired code keeps its family", () => {
    // This is the whole reason the function is prefix-based rather than
    // config-based: it must be able to name the family of a key that no longer
    // exists, because that is exactly the key an operator is diagnosing. A
    // config-backed classifier would answer "unknown" for both a retired
    // connection code AND a bare big-picture template — two very different
    // situations — which is the opposite of useful.
    expect(classifyNarrativeKey("connection_statements.RETIRED_CODE_V9")).toBe(
      "connection_statement",
    );
    expect(classifyNarrativeKey("signal_states.SEE.S9")).toBe("signal_state");
  });

  it("returns 'unknown' for a key with no recognised prefix, and for junk", () => {
    expect(classifyNarrativeKey("PRIMARY_FRICTION")).toBe("unknown");
    expect(classifyNarrativeKey("")).toBe("unknown");
    expect(classifyNarrativeKey("not_a_key_at_all")).toBe("unknown");
  });

  it("its 'unknown' answer does NOT imply unresolvable", () => {
    // PRIMARY_FRICTION has no prefix and IS resolvable — it is a big-picture
    // template. Existence is resolveParticipantCopy's question alone, and this
    // test pins that the two functions answer different questions.
    expect(classifyNarrativeKey("PRIMARY_FRICTION")).toBe("unknown");
    expect(resolveParticipantCopy("PRIMARY_FRICTION")).not.toBeNull();
  });
});
