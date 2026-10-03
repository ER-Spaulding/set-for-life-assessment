import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";

/**
 * THE SEAM-IDENTITY GUARD — Addendum 01 v1.1 §5, the half the other four guards
 * do not own.
 *
 * THE GAP THIS FILE CLOSES. The architecture is ONE immutable snapshot_payload ->
 * ONE resolveSnapshotView -> ONE resolved view -> web renderer + PDF renderer.
 * `snapshot-resolution-single-source` binds the resolver and the two renderers;
 * `snapshot-source-of-truth` proves the page reads the stored payload;
 * `snapshot-render-differential` proves the rendered STRINGS match the pinned
 * configs; `snapshot-pdf-parity` proves the PDF emits only resolved strings. But
 * NONE of them exercises the SEAM — the two call sites where the resolver's
 * output is handed to a renderer:
 *
 *   app/(public)/snapshot/[sessionId]/page.tsx:
 *       const sections = resolveSnapshotContent(payload);
 *       return <SnapshotResults sections={sections} sessionId={sessionId} />;
 *
 *   lib/snapshot/document.ts:
 *       const sections = resolveSnapshotContent(payload);
 *       const bytes = await renderSnapshotPdf(sections, meta);
 *
 * The render differential builds ITS OWN sections and renders the COMPONENT; it
 * never mounts the page, so a page-level POST-resolution reinterpretation — e.g.
 * `sections.map(s => s.id === "connection" ? {...s, blocks: s.blocks.map(b =>
 * ({...b, body: "…constraint, not a choice."}))} : s)` before
 * `return <SnapshotResults sections={tampered} />` — leaves every other guard
 * green while web and PDF silently diverge. That is exactly the drift §5 forbids,
 * and it is why the parity verdict was "INCIDENTAL, not impossible by
 * construction".
 *
 * WHY THIS FORM. Of the three candidate shapes this file chooses (a) — render the
 * ACTUAL seam (the real page; the real `ensureSnapshotDocument`), and assert its
 * output BYTE-EQUALS the output of the renderer fed a freshly-resolved view of
 * the SAME payload. It is the strongest practical form: it is behaviour-level,
 * so it cannot be evaded by an alias (the weakness of a source-scan assertion),
 * and it is byte-exact, so it cannot be evaded by a string-level reordering that
 * happens to preserve the copy set. It is non-flaky because both renderers are
 * pure and deterministic given a fixed payload and fixed PDF metadata (the PDF
 * renderer's only clock is the caller-supplied `creationDate`; with a fixed
 * `generatedAt` the two renders are byte-identical — verified while building this
 * file).
 *
 * The page is a server component that reads the DB through `loadSnapshotPayload`
 * and writes analytics through `recordEventInBackground`; both module boundaries
 * are mocked so the REAL page body — including the seam — runs. The document seam
 * runs the real `ensureSnapshotDocument` against a faithful Supabase chain mock,
 * so the real `resolveSnapshotView` + real `renderSnapshotPdf` execute inside it.
 */

// The mock factories reference these; `vi.hoisted` initialises them before the
// (hoisted) static imports of the page and document resolve.
const mocks = vi.hoisted(() => ({
  loadSnapshotPayload: vi.fn(),
  loadSnapshotForDownload: vi.fn(),
  verifiedFirstNameForParticipant: vi.fn(),
  recordEventInBackground: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/session/service", () => ({
  loadSnapshotPayload: (...a: unknown[]) => mocks.loadSnapshotPayload(...a),
  loadSnapshotForDownload: (...a: unknown[]) => mocks.loadSnapshotForDownload(...a),
  verifiedFirstNameForParticipant: (...a: unknown[]) => mocks.verifiedFirstNameForParticipant(...a),
}));

vi.mock("@/lib/analytics/write", () => ({
  recordEventInBackground: (...a: unknown[]) => mocks.recordEventInBackground(...a),
}));

vi.mock("@/lib/db/client", () => ({
  serviceClient: (...a: unknown[]) => mocks.serviceClient(...a),
}));

import narrativesJson from "@/config/narratives-v1.0.json";
import { questionById } from "@/lib/ui/questions";
import SnapshotPage from "@/app/(public)/snapshot/[sessionId]/page";
import { ensureSnapshotDocument } from "@/lib/snapshot/document";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import { renderSnapshotPdf } from "@/lib/render/snapshot-pdf";
import { SnapshotResults } from "@/components/snapshot/results-view";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";

const SESSION_ID = "s-1";
const SNAPSHOT_ID = "snap-1";
const GENERATED_AT = "2026-10-02T00:00:00.000Z";
const REPORT_VERSION = "1.0";

/**
 * THE PAYLOAD MATRIX — the seam is only proved for payload SHAPES the guard
 * actually exercises. A transform gated on a branch a single fixture never
 * satisfies (`if (view.nullFinding) …`) escapes a one-payload guard entirely,
 * so the web seam is driven across every gross shape the payload can take.
 *
 * Each entry is a (name, payload) pair; the web-seam tests loop over all of them.
 */
function makeNullFindingPayload(): SnapshotPayload {
  return {
    ...makePayload(),
    nullFinding: true,
    frictions: [],
    connections: [],
    strengths: [],
    attentionAreas: ["KEEP_OBSERVING"],
    bigPicture: { template: "NO_MEANINGFUL_FRICTION", parts: [] },
    context: [],
  };
}

/** A finalized Perception Gap (module 8 deferred — resolved but rendered by
 *  neither renderer; included so a gap-branch transform is still exercised). */
function makeFinalizedGapPayload(): SnapshotPayload {
  return {
    ...makePayload(),
    perceptionGapStatus: "finalized",
    perceptionGap: {
      code: "PERCEPTION_ALIGNED",
      narrativeKey: "perception_gap.PERCEPTION_ALIGNED",
    },
  };
}

/** Every capacity (off-ladder) signal code the pinned narrative library defines. */
const SPECIAL_STATE_KEYS = Object.keys(
  (narrativesJson as { special_signal_states: Record<string, unknown> }).special_signal_states,
);

/** Every attention-area key the pinned narrative library defines. */
const ATTENTION_AREA_KEYS = Object.keys(
  (narrativesJson as { attention_areas: Record<string, unknown> }).attention_areas,
);

/** Every perception-gap key the pinned narrative library defines. */
const PERCEPTION_GAP_KEYS = Object.keys(
  (narrativesJson as { perception_gap: Record<string, unknown> }).perception_gap,
);

/**
 * Every destination-theme (Q16) option code, read through the SAME canonical
 * accessor the resolver uses (`questionById("Q16")`) — so the matrix can never
 * drift from the pinned question bank. A transform gated on one specific
 * destination code (`d.code === "Q16_B"`) is otherwise invisible to a matrix
 * that exercises only Q16_A / Q16_D.
 */
const Q16_CODES = (questionById("Q16")?.options ?? []).map((o) => o.code);

// Anti-no-op: an empty code space would make every `destination theme …` entry a
// duplicate of the baseline and quietly shrink real coverage.
if (Q16_CODES.length === 0) {
  throw new Error(
    "snapshot-seam-identity: questionById('Q16') yielded no options — the destination-theme matrix entries would be no-ops",
  );
}

/** The capacity signal codes the baseline payload puts in the ROOM / AIM slots. */
const OTHER_SPECIAL = SPECIAL_STATE_KEYS.filter(
  (k) => !k.startsWith("DIRECT_"),
);

/**
 * THE PAYLOAD MATRIX — the seam is only proved for payload SHAPES the guard
 * actually exercises. A transform gated on a branch a single fixture never
 * satisfies (`if (view.nullFinding) …`) escapes a one-payload guard entirely.
 *
 * So the matrix is DERIVED FROM THE PINNED CONFIG, not hand-picked: it walks
 * every capacity signal code, every attention-area key, every perception-gap
 * key, plus the gross structural branches (null finding, empty destination set,
 * no big picture, empty signals) — the whole shape space the payload can take,
 * so a branch gated on ANY reachable shape meets a payload that satisfies it.
 *
 * The guard remains detection, not proof: an unreachable or brand-new shape is
 * still outside it (and new shapes arrive with new copy, which the copy-ruling
 * guards own).
 */
const WEB_MATRIX: Array<[string, SnapshotPayload]> = [
  ["baseline: full profile + capacity signal", makePayload()],
  ["null-finding profile", makeNullFindingPayload()],
  ["finalized perception gap", makeFinalizedGapPayload()],
  ["no destination themes", { ...makePayload(), q16Selections: [] }],

  // Every Q16 destination code (from the pinned question bank, via the SAME
  // accessor the resolver uses) — including the full pair.
  ...Q16_CODES.map(
    (code): [string, SnapshotPayload] => [
      `destination theme ${code}`,
      { ...makePayload(), q16Selections: [code] },
    ],
  ),
  [
    "all destination themes at once",
    { ...makePayload(), q16Selections: [...Q16_CODES] },
  ],

  // Every big-picture template the payload type permits. (`bigPicture` is
  // NON-NULLABLE in SnapshotPayload — a `bigPicture: null` fixture is a type
  // error and an unreachable shape, so it is deliberately absent; tsc caught
  // exactly that during construction of this matrix.)
  ...(["PRIMARY_FRICTION", "NO_MEANINGFUL_FRICTION", "DEVELOPING_PICTURE", "CAPACITY_FIRST"] as const).map(
    (template): [string, SnapshotPayload] => [
      `big-picture template ${template}`,
      { ...makePayload(), bigPicture: { ...makePayload().bigPicture, template } },
    ],
  ),

  // Every capacity signal code, in the DIRECT slot AND in the non-DIRECT slot.
  ...SPECIAL_STATE_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `capacity code ${key} in the DIRECT slot`,
      expectShape(
        makeCapacityPayload(key, "DIRECT"),
        (p) => p.signals.some((s) => s.narrativeKey === `special_signal_states.${key}` && s.signal === "DIRECT"),
        `${key} @ DIRECT`,
      ),
    ],
  ),
  ...SPECIAL_STATE_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `capacity code ${key} in the AIM slot`,
      expectShape(
        makeCapacityPayload(key, "AIM"),
        (p) => p.signals.some((s) => s.narrativeKey === `special_signal_states.${key}` && s.signal === "AIM"),
        `${key} @ AIM`,
      ),
    ],
  ),
  ...SPECIAL_STATE_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `capacity code ${key} in the ROOM slot`,
      expectShape(
        makeCapacityPayload(key, "ROOM"),
        (p) => p.signals.some((s) => s.narrativeKey === `special_signal_states.${key}` && s.signal === "ROOM"),
        `${key} @ ROOM`,
      ),
    ],
  ),

  // Every attention-area key — including KEEP_OBSERVING and the secondary slot.
  ...ATTENTION_AREA_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `attention area ${key}`,
      { ...makePayload(), attentionAreas: [key], nullFinding: key === "KEEP_OBSERVING" },
    ],
  ),
  [
    "secondary attention area",
    { ...makePayload(), attentionAreas: ["SEE_IT_MORE_CLEARLY", "CREATE_MORE_ROOM"] },
  ],

  // Every perception-gap key.
  ...PERCEPTION_GAP_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `perception gap ${key}`,
      {
        ...makePayload(),
        perceptionGapStatus: "finalized",
        perceptionGap: { code: key, narrativeKey: `perception_gap.${key}` },
      },
    ],
  ),

  // An empty signal set (every row unresolved) — the degenerate render.
  ["empty signals", { ...makePayload(), signals: [] }],
];

/**
 * A payload carrying a specific capacity (off-ladder) signal code in `slot`.
 *
 * NOTE: this APPENDS the slot if the baseline does not have it. An earlier
 * version mapped over the fixed baseline and silently did nothing for slots the
 * baseline lacked (AIM, ROOM) — a no-op fixture that inflated the test count
 * without exercising the shape. `expectShape` below now fails such a no-op.
 */
function makeCapacityPayload(specialKey: string, slot: "DIRECT" | "AIM" | "ROOM"): SnapshotPayload {
  const base = makePayload();
  const narrativeKey = `special_signal_states.${specialKey}`;
  const capacitySignal = {
    signal: slot,
    state: "S3" as const,
    specialState: specialKey,
    displayState: specialKey,
    narrativeKey,
    evidence: { confidence: "high" as const, limitedReason: null },
  };
  const hasSlot = base.signals.some((s) => s.signal === slot);
  return {
    ...base,
    signals: hasSlot
      ? base.signals.map((s) => (s.signal === slot ? (capacitySignal as typeof s) : s))
      : [...base.signals, capacitySignal as SnapshotPayload["signals"][number]],
  };
}

/**
 * Anti-false-green: assert a matrix entry actually produced the shape it claims,
 * so a no-op fixture can never masquerade as coverage. Returns the payload.
 */
function expectShape(payload: SnapshotPayload, check: (p: SnapshotPayload) => boolean, label: string) {
  expect(check(payload), `matrix fixture did not produce its claimed shape: ${label}`).toBe(true);
  return payload;
}

/**
 * A representative, fully-populated payload that includes a CAPACITY
 * (off-ladder special state) signal — so the adversary's isCapacity-map
 * reinterpretation changes a real string and would move the rendered output.
 */
function makePayload(): SnapshotPayload {
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
      { signal: "SEE", state: "S2", specialState: null, displayState: "S2", narrativeKey: "signal_states.SEE.S2", evidence: { confidence: "high", limitedReason: null } },
      { signal: "DIRECT", state: "S3", specialState: "DIRECT_CAPACITY_LIMITED", displayState: "DIRECT_CAPACITY_LIMITED", narrativeKey: "special_signal_states.DIRECT_CAPACITY_LIMITED", evidence: { confidence: "high", limitedReason: null } },
      { signal: "MOVE", state: "S5", specialState: null, displayState: "S5", narrativeKey: "signal_states.MOVE.S5", evidence: { confidence: "high", limitedReason: null } },
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
    ],
    context: [],
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// The WEB PAGE seam — render the real page, byte-compare to a fresh resolve+render.
// ---------------------------------------------------------------------------

describe("the web page hands the renderer EXACTLY the resolver's output", () => {
  // Swept over the PAYLOAD MATRIX, not one fixture: a transform gated on a
  // branch (nullFinding, finalized gap, empty destination set) is only caught by
  // a payload that satisfies that branch.
  for (const [name, payload] of WEB_MATRIX) {
    it(`${name}: rendering the actual page equals rendering SnapshotResults with freshly-resolved sections`, async () => {
      mocks.loadSnapshotPayload.mockResolvedValue(payload);

      // THE SEAM, exercised for real: the page resolves + renders.
      const pageElement = await SnapshotPage({ params: Promise.resolve({ sessionId: SESSION_ID }) });
      const pageHtml = renderToStaticMarkup(pageElement);

      // THE ORACLE: the renderer fed a freshly-resolved section model of the SAME
      // payload.
      const freshSections = resolveSnapshotContent(payload);
      const freshHtml = renderToStaticMarkup(
        React.createElement(SnapshotResults, { sections: freshSections, sessionId: SESSION_ID }),
      );

      // Byte equality: any post-resolution reinterpretation of `sections` inside
      // the page — a map, a spread, a copied string — changes pageHtml and fails
      // here.
      expect(pageHtml).toBe(freshHtml);
    });
  }

  it("the page resolves the payload through the resolver once, then renders it unmodified", async () => {
    const payload = makePayload();
    mocks.loadSnapshotPayload.mockResolvedValue(payload);

    const pageHtml = renderToStaticMarkup(
      await SnapshotPage({ params: Promise.resolve({ sessionId: SESSION_ID }) }),
    );
    const view = resolveSnapshotView(payload);

    // The rendered output must actually CONTAIN the resolved copy (not just be
    // byte-identical to a render that could itself be empty): spot-check that
    // the capacity signal's resolved label + copy survived to the page verbatim.
    const capacityRow = view.signals.find((r) => r.isCapacity)!;
    expect(capacityRow).toBeDefined();
    expect(pageHtml).toContain(capacityRow.label);
    expect(pageHtml).toContain(capacityRow.copy);
  });
});

// ---------------------------------------------------------------------------
// The PDF/DOCUMENT seam — run the real ensureSnapshotDocument, byte-compare.
// ---------------------------------------------------------------------------

/**
 * A faithful-enough Supabase query chain for the document seam's happy path
 * (generate-fresh). It returns `null` for the existing-document lookup so the
 * code goes through resolve -> render -> upload, and records the uploaded bytes.
 */
function makeServiceClient() {
  const uploaded: Array<{ key: string; bytes: Buffer }> = [];

  function chain(table: string): any {
    const self: any = {
      select: (_cols?: string) => self,
      upsert: (_data: unknown, _opts?: unknown) => self,
      update: (_data: unknown) => self,
      eq: (_col: string, _val: unknown) => self,
      async maybeSingle() {
        if (table === "snapshot_documents") return { data: null, error: null }; // none exists
        if (table === "snapshots") return { data: { session_id: SESSION_ID }, error: null };
        if (table === "assessment_sessions") return { data: { participant_id: null }, error: null };
        return { data: null, error: null };
      },
      async single() {
        if (table === "snapshot_documents") return { data: { document_id: "doc-1" }, error: null };
        return { data: null, error: null };
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return self;
  }

  const db: any = {
    from: (table: string) => chain(table),
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, bytes: Buffer, _opts?: unknown) => {
          expect(bucket).toBe("snapshot-documents");
          uploaded.push({ key, bytes });
          return { error: null };
        },
      }),
    },
  };

  return { db, uploaded };
}

describe("the PDF document hands the renderer EXACTLY the resolver's output", () => {
  // Swept over the SAME payload matrix as the web seam — a transform gated on a
  // branch (nullFinding, finalized gap, empty destination set) is only caught by
  // a payload that satisfies that branch, at EITHER seam.
  for (const [name, payload] of WEB_MATRIX) {
    it(`${name}: the stored PDF bytes equal a fresh resolve+render of the same payload`, async () => {
      mocks.loadSnapshotForDownload.mockResolvedValue({
        snapshotId: SNAPSHOT_ID,
        reportVersion: REPORT_VERSION,
        generatedAt: GENERATED_AT,
        payload,
      });

      const { db, uploaded } = makeServiceClient();
      mocks.serviceClient.mockReturnValue(db);

      const result = await ensureSnapshotDocument(SESSION_ID);

      // The document was generated, not read from an existing artifact.
      expect(result).not.toBeNull();
      expect(result!.generated).toBe(true);

      // THE ORACLE: the renderer fed a freshly-resolved section model + the SAME
      // metadata.
      const freshSections = resolveSnapshotContent(payload);
      const freshBytes = await renderSnapshotPdf(freshSections, {
        firstName: null,
        generatedAt: GENERATED_AT,
        reportVersion: REPORT_VERSION,
      });

      expect(uploaded).toHaveLength(1);
      expect(uploaded[0].bytes.length).toBe(freshBytes.length);
      expect(uploaded[0].bytes.equals(freshBytes)).toBe(true);

      // The checksum is derived from the SAME bytes that were uploaded.
      expect(result!.checksum).toBe(createHash("sha256").update(freshBytes).digest("hex"));
    });
  }
});
