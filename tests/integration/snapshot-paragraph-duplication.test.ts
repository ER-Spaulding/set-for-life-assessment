import { describe, it, expect } from "vitest";
import {
  assembleSnapshotPayload,
  type AssembleInput,
  type SnapshotPayload,
  type PayloadSignal,
} from "@/lib/assessment/snapshot-payload";
import {
  resolveSnapshotContent,
  type SnapshotSection,
} from "@/lib/render/snapshot-sections";
import { resolveConnection } from "@/lib/render/snapshot-view";
import { renderSnapshotPdf } from "@/lib/render/snapshot-pdf";
import { extractPdfText, squash } from "./pdf-text";
import cfg from "@/config/scoring-v1.0.json";

/**
 * THE PARAGRAPH-DUPLICATION GUARDS — owner-ordered correction (2026-10-02).
 *
 * The defect: `assembleBigPicture` pushed the primary friction's
 * `connection_statements.*` key and then, in a later step, pushed the primary
 * connection's `connection_statements.*` key UNCONDITIONALLY. Frictions and
 * connections are BOTH built from `connection_statements.*` codes, so for a
 * profile whose first friction IS its first connection, the IDENTICAL key
 * landed in `bigPicture.parts` twice. The Big Picture then rendered that
 * paragraph twice, and the same statement appeared again in the Friction module
 * and again in The Connection — four visible occurrences of one paragraph in the
 * PDF, which is what the owner saw.
 *
 * The fix is a SELECTION fix, not a wording fix: no approved sentence is edited
 * or removed, and the 19 statements shared between `narratives-v1.0.json` and
 * `connection-statements-v1.0.json` are deliberately allowed to coexist. The
 * connection statement still renders in full in its own module, and the friction
 * still renders in its own module — those are DISTINCT roles, so the statement
 * appears once per module. What is not allowed is the SAME statement being named
 * twice inside ONE narration (the Big Picture).
 *
 * This file adds two guards the owner asked for, both asserted on the REAL
 * rendered output — the shared resolved section model AND the decoded PDF bytes
 * — never merely on `bigPicture.parts`:
 *
 *   (a) a REGRESSION test: for the exact "first friction == first connection"
 *       profile, the known paragraph appears in the rendered PDF exactly three
 *       times (once in the Big Picture, once in the Friction module, once in The
 *       Connection) — the pre-fix count was FOUR, and the fix removes exactly the
 *       duplicate Big-Picture sentence;
 *
 *   (b) a BROADER check: across a sweep of profile shapes, no paragraph-level
 *       BODY copy is duplicated WITHIN a single section. Structural labels are
 *       excluded by construction (see `paragraphBodiesWithinSection`): section
 *       headings, block kickers (the §2.4 human questions), and block labels
 *       (state titles, finding headlines, connection headlines, activation and
 *       attention labels) are not `body`, and the document furniture (footer,
 *       brand, footer separator, disclosure, cover title/subtitle,
 *       personalization) lives in the cover, not in the section model at all.
 *
 * WHY "WITHIN A SECTION" AND NOT "ANYWHERE IN THE DOCUMENT". The owner's
 * exclusion list (headings, footer, brand, separator, disclosure) are all
 * structural strings, but the connection-statement BODY also legitimately
 * appears once per module it names — Big Picture, Friction, Connection. A
 * document-wide "no body twice anywhere" check would false-alarm on that
 * intentional cross-module selection (the exact thing the fix must PRESERVE).
 * Scoping to "no body twice WITHIN one section" catches the defect — the same
 * paragraph twice in one narration — while permitting each module to name the
 * finding once. A naive "no string appears twice anywhere" check would be
 * disabled as a false alarm; this one will not.
 */

// ---------------------------------------------------------------------------
// The exact profile the owner saw: first friction == first connection.
// Built through the REAL assembler from the live session's data (session
// 30cbb52f-a549-49d4-873a-5734c8edd549): SEE S4 strongest, one tension
// HIGH_FEAR_HIGH_ACTIVATION.
// ---------------------------------------------------------------------------

const TENSION = "HIGH_FEAR_HIGH_ACTIVATION";
const CONNECTION_KEY = `connection_statements.${TENSION}`;

function signal(signal: string, state: PayloadSignal["state"], value: number) {
  return {
    signal,
    value,
    state,
    specialState: null,
    displayState: state,
    evidence: { confidence: "moderate" as const, limitedReason: null },
  };
}

const VERSIONS: AssembleInput["versions"] = {
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
};

/**
 * Reconstruct the live session's `AssembleInput` and run the REAL assembler.
 * The result is a genuine payload (not a hand-written `parts` array), so the
 * fix is exercised end-to-end — the same code path the completion handler uses.
 */
function assembleFrictionIsConnection(): SnapshotPayload {
  const signals: AssembleInput["signals"] = {
    SEE: signal("SEE", "S4", 3.6666666666666665),
    ROOM: signal("ROOM", "S4", 3.5),
    DIRECT: signal("DIRECT", "S4", 4),
    PREPARE: signal("PREPARE", "S4", 3.6666666666666665),
    AIM: signal("AIM", "S4", 3.6666666666666665),
    MOVE: signal("MOVE", "S3", 3),
  } as AssembleInput["signals"];

  return assembleSnapshotPayload({
    versions: VERSIONS,
    signals,
    tensionCodes: [TENSION],
    classifierTags: [],
    activationSelections: { A1: "D", A2: "C", A3: "D", A4: "A" },
    openingB: 3,
    q16Selections: ["Q16_B", "Q16_E"],
    signalMeans: {
      SEE: 3.6666666666666665,
      ROOM: 3.5,
      DIRECT: 4,
      PREPARE: 3.6666666666666665,
      AIM: 3.6666666666666665,
      MOVE: 3,
    },
    perceptionGapConfig: (cfg as { perception_gap?: unknown }).perception_gap,
    moveSubsignals: { action: 3, analysis: 3, consumption: 3 },
  });
}

/** The paragraph that was duplicated — resolved from the library, never typed. */
function duplicatedParagraph(): string {
  const conn = resolveConnection(TENSION);
  if (!conn) throw new Error(`missing connection statement for ${TENSION}`);
  return conn.body;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

/** Every `body` string, grouped by section, for the within-section check. */
function paragraphBodiesWithinSection(sections: SnapshotSection[]): Array<{
  id: SnapshotSection["id"];
  body: string;
  count: number;
}> {
  const out: Array<{ id: SnapshotSection["id"]; body: string; count: number }> = [];
  for (const section of sections) {
    const counts = new Map<string, number>();
    for (const block of section.blocks) {
      // BODY ONLY. The kicker (human question) and label (state title / finding
      // headline / connection headline / activation label / attention label) are
      // STRUCTURAL labels, not paragraph body, and the section `heading` is the
      // uppercased module title. None of these is paragraph-level copy, so none
      // is subject to the duplication rule.
      if (!block.body) continue;
      counts.set(block.body, (counts.get(block.body) ?? 0) + 1);
    }
    for (const [body, count] of counts) {
      if (count > 1) out.push({ id: section.id, body, count });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (a) the regression test — the known paragraph cannot appear MULTIPLE times.
// ---------------------------------------------------------------------------

describe("guard (a) — the known duplicated paragraph cannot repeat in the rendered document", () => {
  it("the assembler names the friction/connection statement once in the Big Picture", () => {
    const payload = assembleFrictionIsConnection();

    // The fix's surface: the connection key that equals the friction key is not
    // pushed a second time, so the parts are unique.
    expect(payload.bigPicture.parts.filter((p) => p === CONNECTION_KEY)).toHaveLength(1);
    expect(new Set(payload.bigPicture.parts).size).toBe(payload.bigPicture.parts.length);
  });

  it("the resolved Big Picture narration has no duplicate sentence", () => {
    const sections = resolveSnapshotContent(assembleFrictionIsConnection());
    const bigPicture = sections.find((s) => s.id === "big-picture");
    expect(bigPicture, "big-picture section exists").toBeDefined();

    const sentences = bigPicture!.blocks.map((b) => b.body);
    expect(new Set(sentences).size).toBe(sentences.length);
    // And the duplicated paragraph specifically appears exactly once there.
    const para = duplicatedParagraph();
    expect(sentences.filter((s) => s === para)).toHaveLength(1);
  });

  it("the decoded PDF bytes carry the paragraph exactly 3 times, never 4", async () => {
    const sections = resolveSnapshotContent(assembleFrictionIsConnection());
    const bytes = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: "2026-10-02T00:00:00.000Z",
      reportVersion: "1.0",
    });
    const text = squash(extractPdfText(bytes));
    const para = squash(duplicatedParagraph());

    // The paragraph legitimately appears once per module that names this finding:
    //   Big Picture sentence (1) + Friction module (1) + The Connection (1) = 3.
    // The pre-fix count was 4 (the Big Picture said it twice). The fix removes
    // exactly that duplicate sentence. Asserting the exact count, not merely
    // "no 4", pins BOTH directions: the paragraph must not vanish, and must not
    // be doubled.
    expect(countOccurrences(text, para)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (b) the broader check — no accidental paragraph duplication, structural
// labels excluded.
// ---------------------------------------------------------------------------

describe("guard (b) — paragraph-level body copy is unique within each section", () => {
  // A sweep across profile shapes: the defect profile (via the real assembler),
  // a multi-finding profile, the null-finding profile, and the degenerate
  // empty-signals profile. The within-section body-uniqueness invariant must hold
  // for all of them; the fix guarantees it for the friction==connection case, and
  // this guard locks it for the rest.
  const profiles: Array<[string, SnapshotPayload]> = [
    ["friction == connection (the defect profile)", assembleFrictionIsConnection()],
    ["multi-finding (two frictions, two connections, a strength)", multiFindingProfile()],
    ["null finding", nullFindingProfile()],
    ["empty signals (degenerate)", emptySignalsProfile()],
  ];

  for (const [name, payload] of profiles) {
    it(`${name}: no body string repeats within a single section`, () => {
      const sections = resolveSnapshotContent(payload);
      const dups = paragraphBodiesWithinSection(sections);
      expect(
        dups,
        `duplicate paragraph bodies within a section: ${JSON.stringify(dups, null, 2)}`,
      ).toEqual([]);
    });
  }

  it("structural labels are excluded from the check by construction", () => {
    // The check reads `block.body` only. Headings, kickers and labels are not
    // `body`, and the footer/brand/disclosure/title live in the cover — so a
    // section heading repeated across modules, or the footer repeated on every
    // page, can never trip the check. Prove the exclusion is real: a section
    // whose heading and kicker/label REPEAT, but whose bodies are distinct, must
    // read as duplication-free — the repeated structural labels are ignored.
    const sections = resolveSnapshotContent(multiFindingProfile());
    for (const section of sections) {
      expect(typeof section.heading).toBe("string");
      expect(section.heading.length).toBeGreaterThan(0);
    }

    // A synthetic section that repeats its heading and label on every block but
    // keeps bodies distinct — exactly the footer/heading pattern the owner said
    // must NOT false-alarm. `paragraphBodiesWithinSection` ignores heading,
    // kicker and label, so it reports nothing.
    const synthetic: SnapshotSection[] = [
      {
        id: "big-picture",
        heading: "SET FOR LIFE", // repeated structural brand/label
        blocks: [
          { kicker: "REPEATED KICKER", label: "REPEATED LABEL", body: "first distinct paragraph." },
          { kicker: "REPEATED KICKER", label: "REPEATED LABEL", body: "second distinct paragraph." },
        ],
      },
    ];
    expect(paragraphBodiesWithinSection(synthetic)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixture helpers (same keys the consumers read).
// ---------------------------------------------------------------------------

function payloadSignal(
  signal: string,
  state: PayloadSignal["state"],
  narrativeKey: string,
): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState: null,
    displayState: state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function basePayload(): SnapshotPayload {
  return {
    versions: VERSIONS as SnapshotPayload["versions"],
    signals: [
      payloadSignal("SEE", "S2", "signal_states.SEE.S2"),
      payloadSignal("ROOM", "S1", "signal_states.ROOM.S1"),
      payloadSignal("DIRECT", "S3", "signal_states.DIRECT.S3"),
      payloadSignal("PREPARE", "S4", "signal_states.PREPARE.S4"),
      payloadSignal("AIM", "S3", "signal_states.AIM.S3"),
      payloadSignal("MOVE", "S5", "signal_states.MOVE.S5"),
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: [
        "signal_states.MOVE.S5",
        "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
        "attention_areas.DEFINE_THE_DESTINATION",
      ],
    },
    strengths: [{ source: "signal", code: "MOVE", narrativeKey: "signal_states.MOVE.S5" }],
    frictions: [
      { source: "tension", code: "HIGH_ACTIVITY_LOW_DIRECTION", narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION" },
      { source: "tension", code: "INFORMATION_ANALYSIS_BOTTLENECK", narrativeKey: "connection_statements.INFORMATION_ANALYSIS_BOTTLENECK" },
    ],
    connections: [
      { code: "HIGH_ACTIVITY_LOW_DIRECTION", narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION" },
      { code: "INFORMATION_ANALYSIS_BOTTLENECK", narrativeKey: "connection_statements.INFORMATION_ANALYSIS_BOTTLENECK" },
    ],
    context: [{ code: "OPEN_MONEY_ENVIRONMENT", narrativeKey: "context_narratives.OPEN_MONEY_ENVIRONMENT" }],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["DEFINE_THE_DESTINATION"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
  };
}

function multiFindingProfile(): SnapshotPayload {
  return basePayload();
}

function nullFindingProfile(): SnapshotPayload {
  return {
    ...basePayload(),
    nullFinding: true,
    frictions: [],
    connections: [],
    strengths: [],
    attentionAreas: ["KEEP_OBSERVING"],
    bigPicture: { template: "NO_MEANINGFUL_FRICTION", parts: [] },
    context: [],
  };
}

function emptySignalsProfile(): SnapshotPayload {
  return {
    ...basePayload(),
    signals: [],
    strengths: [],
    frictions: [],
    connections: [],
    attentionAreas: ["KEEP_OBSERVING"],
    bigPicture: { template: "NO_MEANINGFUL_FRICTION", parts: [] },
    context: [],
    q16Selections: [],
  };
}
