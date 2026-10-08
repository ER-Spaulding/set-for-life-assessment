import { describe, it, expect } from "vitest";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { renderSnapshotPdf } from "@/lib/render/snapshot-pdf";
import { extractPdfText, squash, expectedPdfText, extractPdfInfoDict, expectedPdfDate } from "./pdf-text";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";

/**
 * THE PDF RENDER-STRING-MEMBERSHIP GUARD — Addendum 01 v1.1 §5, the PDF half.
 *
 * The shared section model (`resolveSnapshotContent`) decides WHICH modules,
 * findings, activation labels, attention areas, and interpretations exist, and
 * the PDF renderer builds from it. But nothing below that seam constrains the
 * STRINGS the renderer actually emits: a `<Text>LOCALLY MINTED PROSE</Text>`
 * inserted into `snapshot-pdf.tsx` left every guard green, because the parity
 * guard measured `snapshotPdfStrings()`, a HAND-MAINTAINED MIRROR of the JSX,
 * rather than the text the engine actually rendered into the buffer.
 *
 * THIS FILE closes that over the REAL render:
 *   - render the actual PDF buffer with `renderSnapshotPdf`;
 *   - decode the text the @react-pdf/renderer engine really wrote
 *     (`extractPdfText`, FlateDecode + WinAnsi);
 *   - assert (a) every participant-facing string the shared model requires is
 *     present, and (b) the rendered character sequence EQUALS the sequence
 *     derived from the shared model + the canonical furniture.
 *
 * The expected sequence is DERIVED from `resolveSnapshotContent(payload)` and
 * `snapshotPdfSections` — the same code path the renderer consumes — plus the
 * canonical furniture module (the renderer's only other string source). There is
 * no hand-maintained list here to drift against the renderer; a minted string
 * adds characters the derived sequence does not have and fails.
 */

/**
 * The model strings the PDF must render (the PDF omits headings by §9, and
 * section intro/outro are web-only by renderer decision — see snapshot-pdf.tsx).
 */
function pdfRequiredStrings(sections: SnapshotSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.kicker) out.push(b.kicker);
      if (b.label) out.push(b.label);
      out.push(b.body);
      for (const p of b.paragraphs ?? []) out.push(p);
    }
  }
  return out.filter((x) => x.length > 0);
}

// ---------------------------------------------------------------------------
// Fixtures — the shape space the guard sweeps (same keys the consumers read).
// ---------------------------------------------------------------------------

function signal(
  signal: string,
  state: PayloadSignal["state"],
  narrativeKey: string | null,
  specialState: string | null = null,
): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState,
    displayState: specialState ?? state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function basePayload(): SnapshotPayload {
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
      signal("SEE", "S2", "signal_states.SEE.S2"),
      signal("ROOM", "S1", "signal_states.ROOM.S1"),
      signal("DIRECT", "S3", "special_signal_states.DIRECT_CAPACITY_LIMITED", "DIRECT_CAPACITY_LIMITED"),
      signal("PREPARE", "S4", "signal_states.PREPARE.S4"),
      signal("AIM", "S3", "signal_states.AIM.S3"),
      signal("MOVE", "S5", "signal_states.MOVE.S5"),
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: [
        "signal_states.MOVE.S5",
        "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
        "attention_areas.SEE_IT_MORE_CLEARLY",
      ],
    },
    strengths: [{ source: "signal", code: "MOVE", narrativeKey: "signal_states.MOVE.S5" }],
    frictions: [
      {
        source: "tension",
        code: "HIGH_ACTIVITY_LOW_DIRECTION",
        narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION",
      },
    ],
    connections: [
      { code: "HIGH_ACTIVITY_LOW_DIRECTION", narrativeKey: "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION" },
      { code: "HIGH_INFORMATION_LOW_ACTION", narrativeKey: "connection_statements.HIGH_INFORMATION_LOW_ACTION" },
    ],
    context: [{ code: "OPEN_MONEY_ENVIRONMENT", narrativeKey: "context_narratives.OPEN_MONEY_ENVIRONMENT" }],
    perceptionGap: null,
    perceptionGapStatus: "not_ready",
    activation: { A1: "HIGH", A2: "MID", A3: "LOW", A4: "HIGH" },
    activationPatterns: [],
    attentionAreas: ["SEE_IT_MORE_CLEARLY"],
    nullFinding: false,
    moveSubsignals: {},
    q16Selections: ["Q16_A", "Q16_D"],
    openingB: null,
  };
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

const PROFILES: Array<[string, SnapshotPayload]> = [
  ["full profile", basePayload()],
  ["null-finding profile", nullFindingProfile()],
  ["empty-signals (degenerate) profile", emptySignalsProfile()],
];

const META = { firstName: "Avery", generatedAt: "2026-10-02T00:00:00.000Z", reportVersion: "1.0" };

describe("PDF: the real render emits only shared-model strings (decoded from the bytes)", () => {
  for (const [name, payload] of PROFILES) {
    it(`${name}: model strings present, and the emitted text equals the model-derived sequence`, async () => {
      const sections = resolveSnapshotContent(payload);
      const bytes = await renderSnapshotPdf(sections, META);
      const text = extractPdfText(bytes);

      // PRESENCE — every non-heading model string survives to the bytes. Any
      // drop or substitution changes the non-space characters, so a
      // whitespace-insensitive substring check catches it robustly.
      const squashed = squash(text);
      for (const s of pdfRequiredStrings(sections)) {
        expect(
          squashed,
          `PDF omitted/substituted a model string: ${JSON.stringify(s)}`,
        ).toContain(squash(s));
      }

      // MEMBERSHIP — the character sequence the renderer emitted EQUALS the
      // sequence derived from the shared model + furniture. Any string the
      // renderer mints in its JSX ("LOCALLY MINTED PROSE") adds characters the
      // derived sequence does not have, and fails here — over the real bytes,
      // not a mirror of the JSX.
      expect(squashed, "PDF emitted text diverges from the shared model's string set").toBe(
        squash(expectedPdfText(sections, META.firstName)),
      );
    });
  }
});

describe("PDF: the Document Info dictionary carries only DB/config-derived metadata, never prose", () => {
  // The byte decode above reads text-showing content-stream operands ONLY, so
  // Document Subject/Author prose is structurally outside that assertion. This
  // block closes that gap over the Info dictionary:
  //   - /Subject is the report version (config-derived, `payload.versions.report`
  //     -> `snapshots.report_version`), and is ABSENT when there is no version;
  //   - /Author and /Title are NEVER set — no minted author/subject prose;
  //   - /Creator and /Producer are the fixed library stamp, not participant copy;
  //   - /CreationDate is the completion timestamp (DB-derived,
  //     `snapshots.generated_at`), and is present-but-unspecified otherwise.

  it("Subject equals the report version and no Author/Title prose is minted", async () => {
    const sections = resolveSnapshotContent(basePayload());
    const bytes = await renderSnapshotPdf(sections, META);
    const info = extractPdfInfoDict(bytes);

    expect(info.Subject).toBe("1.0"); // META.reportVersion, config-derived
    expect(info.Author).toBeUndefined();
    expect(info.Title).toBeUndefined();
    expect(info.Keywords).toBeUndefined();
    expect(info.ModificationDate).toBeUndefined();
  });

  it("Creator/Producer are the fixed library stamp, not participant copy", async () => {
    const sections = resolveSnapshotContent(basePayload());
    const bytes = await renderSnapshotPdf(sections, META);
    const info = extractPdfInfoDict(bytes);

    expect(info.Creator).toBe("react-pdf");
    expect(info.Producer).toBe("react-pdf");
  });

  it("CreationDate is the DB-derived completion timestamp", async () => {
    const sections = resolveSnapshotContent(basePayload());
    const bytes = await renderSnapshotPdf(sections, META);
    const info = extractPdfInfoDict(bytes);

    expect(info.CreationDate).toBe(expectedPdfDate(META.generatedAt));
  });

  it("an absent report version omits Subject (no minted default)", async () => {
    const sections = resolveSnapshotContent(basePayload());
    const bytes = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: null,
      reportVersion: null,
    });
    const info = extractPdfInfoDict(bytes);

    expect(info.Subject).toBeUndefined();
    expect(info.Author).toBeUndefined();
    expect(info.Title).toBeUndefined();
    // CreationDate still resolves to "now" (the renderer's clock default) — a
    // date, never prose.
    expect(info.CreationDate).toMatch(/^D:/);
  });
});
