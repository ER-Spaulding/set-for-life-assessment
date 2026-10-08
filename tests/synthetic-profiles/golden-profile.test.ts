import { describe, it, expect, vi, beforeEach } from "vitest";

// PHASE 0 — THE GOLDEN FIXTURE, EVIDENCE-FIRST (Owner plan-approval amendment 3).
//
// Direction of travel: ASSESSMENT EVIDENCE → diagnosis → narrative. Never the
// reverse. These answers are NOT chosen to make the Owner's approved sample
// copy read nicely — they ARE the sample's evidence: the exact 31 responses of
// session 660fef00-69a1-42da-871c-200e57038bda (snapshot 263373da, generated
// 2026-10-07), the live walkthrough the Owner performed before approving the
// narrative-rewrite standard. Pulled read-only from the production `responses`
// table on 2026-10-07.
//
// This file runs that evidence through the REAL `completeSession` (real
// scoring, real classifier tags, real tension evaluation, real evidence
// derivation — the same producer production uses) and asserts the computed
// diagnosis equals what the walkthrough's stored payload recorded. It is the
// anchor for Phase 3: every sentence of the approved sample must be checkable
// against the values asserted here. If a sample sentence is NOT supported by
// this evidence, the correct response is to identify that mismatch for Owner
// review — never to change these inputs to make the sentence true.
//
// Reconciliation notes from Phase 0 (sample vs evidence), all resolved WITHOUT
// touching the inputs:
//   - Activation is MID/MID/HIGH/HIGH — the sample's four readiness labels
//     ("No Manufactured Emergency", "Open, Still Considering", "Willing to
//     Follow Through", "Open When the Fit Is Right") are the Owner's approved
//     depiction of exactly these levels on this profile.
//   - The engine yields TWO connections (primary HIGH_VISIBILITY_LOW_CAPACITY,
//     secondary PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE); the sample depicts the
//     primary connection. The secondary still renders as the optional
//     independent secondary — composition, not a copy mismatch.
//   - The Destination synthesis phrases for selection set {Q16_A, Q16_B,
//     Q16_D} are the Owner's own §10 synthesis for this exact set. Per plan
//     D8 / Owner guardrail 2 they are NOT a privileged config key: they fall
//     out of the COMPOSITIONAL theme_clauses family for this genuine
//     selection, asserted verbatim by the sample-sentence suite below.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

import { completeSession } from "@/lib/session/service";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import { GOLDEN_OVERRIDES } from "./golden-overrides";


/** Response rows for the fake db — full option codes, one row per selection. */
function goldenRows(): Array<{ item_id: string; option_code: string }> {
  const rows: Array<{ item_id: string; option_code: string }> = [];
  for (const [item, value] of Object.entries(GOLDEN_OVERRIDES)) {
    if (Array.isArray(value)) {
      for (const v of value) rows.push({ item_id: item, option_code: v });
    } else {
      rows.push({ item_id: item, option_code: `${item}_${value}` });
    }
  }
  return rows;
}

/**
 * In-memory fake db — the same minimal stand-in
 * tests/synthetic-profiles/complete-session-end-to-end.test.ts documents: it
 * cannot catch a column mismatch (that is schema-column-contract.test.ts's
 * job); it exists so the REAL completeSession can run end to end and its
 * persisted rows be asserted.
 */
function fakeDb() {
  const captured: {
    snapshot: Record<string, unknown> | null;
    tensions: Array<Record<string, unknown>>;
    computedSignals: Array<Record<string, unknown>>;
  } = { snapshot: null, tensions: [], computedSignals: [] };

  const rows = goldenRows();
  let sessionStatus = "in_progress";

  const db = {
    from(table: string) {
      if (table === "assessment_sessions") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: { session_id: "22222222-3333-4443-8222-222222222222", status: sessionStatus },
            error: null,
          }),
          in: () => chain,
          single: async () => ({ data: { status: sessionStatus }, error: null }),
          order: () => chain,
          limit: () => chain,
          update: (payload: Record<string, unknown>) => {
            if (typeof payload.status === "string") sessionStatus = payload.status;
            const b = {
              eq: () => b,
              select: () => b,
              maybeSingle: async () => ({ data: payload, error: null }),
              single: async () => ({ data: payload, error: null }),
            };
            return b;
          },
        };
        return chain;
      }
      if (table === "responses") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          single: async () => ({ data: rows[0] ?? null, error: null }),
          // The completion read: every response for this session.
          then: (
            onFulfilled: (v: { data: Array<{ item_id: string; option_code: string }>; error: null }) => unknown,
          ) => Promise.resolve(onFulfilled({ data: rows, error: null })),
        };
        return chain;
      }
      if (table === "demographics") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return chain;
      }
      if (table === "snapshots") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: (payload: Record<string, unknown>) => {
            captured.snapshot = payload as Record<string, unknown>;
            const b = {
              select: () => b,
              single: async () => ({ data: payload, error: null }),
              maybeSingle: async () => ({ data: payload, error: null }),
            };
            return b;
          },
        };
        return chain;
      }
      if (table === "computed_signals" || table === "tensions" || table === "overrides") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const list = Array.isArray(payload) ? payload : [payload];
            if (table === "tensions") captured.tensions.push(...list);
            if (table === "computed_signals") captured.computedSignals.push(...list);
            const b = {
              select: () => b,
              single: async () => ({ data: null, error: null }),
              maybeSingle: async () => ({ data: null, error: null }),
            };
            return b;
          },
        };
        return chain;
      }
      // classifier_tags / session_lifecycle / anything else the path touches.
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        insert: () => {
          const b = { select: () => b, single: async () => ({ data: null, error: null }) };
          return b;
        },
        upsert: () => {
          const b = { select: () => b, single: async () => ({ data: null, error: null }) };
          return b;
        },
        update: () => {
          const b = { eq: () => b, select: () => b, single: async () => ({ data: null, error: null }) };
          return b;
        },
        delete: () => {
          const b = { eq: () => b };
          return b;
        },
      };
      return chain;
    },
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      // complete_session_atomic — same param names the production function
      // receives (p_signals / p_tensions / p_overrides / p_snapshot); capture
      // what it would commit.
      const signals = (params.p_signals as Array<Record<string, unknown>>) ?? [];
      const tensions = (params.p_tensions as Array<Record<string, unknown>>) ?? [];
      const snapshot = params.p_snapshot as Record<string, unknown> | undefined;
      if (signals.length) captured.computedSignals.push(...signals);
      if (tensions.length) captured.tensions.push(...tensions);
      if (snapshot) captured.snapshot = snapshot;
      return { data: { ok: true }, error: null };
    },
  };
  return { db, captured };
}

async function runGolden() {
  const { db, captured } = fakeDb();
  const { serviceClient } = await import("@/lib/db/client");
  vi.mocked(serviceClient).mockReturnValue(db as never);
  const result = await completeSession("22222222-3333-4443-8222-222222222222");
  return { result, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 0 — golden fixture: the walkthrough's evidence → diagnosis", () => {
  it("reproduces the stored walkthrough payload exactly", async () => {
    const { result, captured } = await runGolden();

    expect(result, "completion must succeed").toMatchObject({ complete: true });
    // p_snapshot is the snapshot ROW — the payload itself lives in its
    // payload_json column (service.ts:830).
    const row = captured.snapshot as { payload_json?: Record<string, unknown> } | null;
    const payload = row?.payload_json;
    expect(payload, "a snapshot payload must be captured").toBeTruthy();

    if (!payload) return;

    // ---- six Money Picture states (sample: Clear / Limited Room / Limited
    // Evidence / Developing Resilience / Clear Direction / Usually Moves) ----
    const signals = payload.signals as Array<{
      signal: string;
      state: string | null;
      specialState: string | null;
      displayState: string | null;
      evidence: { confidence: string; limitedReason: string | null };
    }>;
    const by = Object.fromEntries(signals.map((s) => [s.signal, s]));
    expect(by.SEE.displayState).toBe("S4");
    expect(by.ROOM.displayState).toBe("S2");
    expect(by.DIRECT.specialState).toBe("DIRECT_LIMITED_EVIDENCE_CAPACITY");
    expect(by.DIRECT.displayState).toBe("DIRECT_LIMITED_EVIDENCE_CAPACITY");
    expect(by.PREPARE.displayState).toBe("S3");
    expect(by.AIM.displayState).toBe("S4");
    expect(by.MOVE.displayState).toBe("S4");

    // ---- evidence confidence: five moderate + DIRECT limited/CAPACITY_CONTEXT
    // (the sample voices: hedged throughout, explicit limited-evidence on DIRECT)
    expect(Object.fromEntries(signals.map((s) => [s.signal, s.evidence.confidence]))).toEqual({
      SEE: "moderate",
      ROOM: "moderate",
      DIRECT: "limited",
      PREPARE: "moderate",
      AIM: "moderate",
      MOVE: "moderate",
    });
    expect(by.DIRECT.evidence.limitedReason).toBe("CAPACITY_CONTEXT");

    // ---- three frictions, exactly the sample's three findings, in order ----
    const frictions = (payload.frictions as Array<{ code: string }>).map((f) => f.code);
    expect(frictions).toEqual([
      "HIGH_VISIBILITY_LOW_CAPACITY",
      "HIGH_DIRECTION_LOW_CAPACITY",
      "PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE",
    ]);

    // ---- zero strengths: the sample deliberately has NO Strengths section ----
    expect(payload.strengths).toEqual([]);

    // ---- connections: primary + the optional independent secondary ----
    expect((payload.connections as Array<{ code: string }>).map((c) => c.code)).toEqual([
      "HIGH_VISIBILITY_LOW_CAPACITY",
      "PREPAREDNESS_KNOWLEDGE_LOW_RESILIENCE",
    ]);

    // ---- attention: primary CREATE MORE ROOM, secondary RESILIENCE ----
    expect(payload.attentionAreas).toEqual(["CREATE_MORE_ROOM", "STRENGTHEN_RESILIENCE"]);

    // ---- readiness: four separate levels, MID/MID/HIGH/HIGH ----
    expect(payload.activation).toEqual({ A1: "MID", A2: "MID", A3: "HIGH", A4: "HIGH" });

    // ---- Big Picture template: capacity-override profile → CAPACITY_FIRST ----
    expect((payload.bigPicture as { template: string }).template).toBe("CAPACITY_FIRST");

    // ---- Q16: the genuine selections the Destination section preserves ----
    expect(payload.q16Selections).toEqual(["Q16_A", "Q16_B", "Q16_D"]);

    // ---- schema 1.1 with evidence present on every signal (amendment 4's
    // writer-side invariant) ----
    expect((payload.versions as { snapshotSchema: string }).snapshotSchema).toBe("1.1");
    for (const s of signals) expect(s.evidence, `${s.signal} evidence`).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — THE SAMPLE IS THE STANDARD: every Owner-approved sentence that
// belongs to this profile must appear, verbatim, in the resolved content.
//
// EVIDENCE-FIRST (plan amendment 3): the fixture above is the evidence; this
// block checks the NARRATIVE against it — never the reverse. A failure here
// means either copy drifted from the approved sample or a sample sentence is
// unsupported; both stop for Owner review rather than being edited away.
//
// Two documented exceptions, both at the source, never in this list:
//   - Big Picture sentence 1: the sample's opening ("You have a strong sense
//     of what is happening with your money…") is a near-verbatim echo of the
//     Money Picture SEE dimension ("You have a solid view of what is
//     happening with your money…"). §14 forbids that echo across sections,
//     so the synthesis now opens on the direction claim instead — asserted
//     below in its §14 form. The sample's capacity thesis (sentences 2–3)
//     remains verbatim.
//   - Hero / CTA / download / closing copy: web chrome, verified against the
//     brief separately (Phase 5); this block covers the section model only.
// ---------------------------------------------------------------------------
describe("Phase 3 — the approved sample, verbatim in resolved content", () => {
  /** Every string in the section model, concatenated for substring checks. */
  async function goldenContent(): Promise<string> {
    const { captured } = await runGolden();
    const row = captured.snapshot as { payload_json?: Record<string, unknown> } | null;
    const payload = row?.payload_json;
    expect(payload, "a snapshot payload must be captured").toBeTruthy();
    const sections = resolveSnapshotContent(payload as never);
    const parts: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") parts.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object")
        Object.values(node as Record<string, unknown>).forEach(walk);
    };
    walk(sections);
    return parts.join(" \n ");
  }

  const SAMPLE_SENTENCES: string[] = [
    // — §2 Big Picture —
    "You See the Picture. The Challenge Is Having Enough Room to Move.",
    "You have a strong sense of the direction you want your money to take you.", // §14 form — see header
    "The central tension in your Snapshot is not awareness. It is capacity.",
    "When most of the dollars coming in are already spoken for, even thoughtful decisions can become tradeoffs.",
    "That can slow progress toward the future, reduce flexibility in the present, and make the unexpected harder to absorb.",
    "How do I create enough financial room for what I already know to begin working harder for me?",
    // — §3 Money Picture —
    "Six questions. Six parts of one financial picture.",
    "None of these stands alone, and none is a grade. Read together, they show where your financial life feels clear, where it has room, and where something may be getting in the way.",
    "You are not operating in the dark. You have a solid view of what is happening with your money, where much of it is going, and the patterns that deserve your attention.",
    "That visibility matters.",
    "You can make a different decision much faster when you can actually see the decision in front of you.",
    "This is where the picture gets tighter.",
    "After current obligations are handled, there appears to be limited flexibility for multiple priorities at the same time.",
    "The problem is not necessarily a lack of priorities. It is that too many priorities may be standing in line for too little available room.",
    "There is not enough clean evidence to make a broad statement about your financial decision style.",
    "limited financial room should not be mistaken for limited financial agency.",
    "You have thought about what can go wrong, and you appear capable of handling some financial disruption.",
    "The question is what happens when the disruption becomes large enough to outlast a quick adjustment.",
    "a meaningful setback could still place pressure on other parts of your financial life before recovery is complete.",
    "You know what you want money to make possible.",
    "The destination is not the fuzzy part.",
    "You do not need a destination invented for you. You need more capacity to move toward the one you already see.",
    "Useful information generally does not just sit with you.",
    "it suggests that more information alone may not be the missing ingredient.",
    // — §4 Friction —
    "Clarity is not the problem here. The tighter spots appear where what you know, what you want, and what your current financial capacity allows are not fully lining up yet.",
    "Your Money Has Less Breathing Room Than Your Plans Need",
    "A large share of your available dollars appears to already have a job before you get the opportunity to make additional choices with them.",
    "Visibility tells you what is happening. It does not automatically create flexibility.",
    "Your Direction Is Clear. Your Dollars Have Less Freedom to Follow.",
    "You know where you want to go, but the present appears to be consuming enough financial capacity that the future does not always get as much of your money as it gets of your attention.",
    "the goal is not missing; the ability to consistently fund the goal is what is under pressure.",
    "Your Awareness of Risk Is Ahead of the Cushion",
    "You have already thought about what a meaningful financial disruption could do.",
    "Knowing that a risk exists and being financially positioned to absorb it are two different things.",
    "Your awareness appears to be ahead of the cushion.",
    // — §5 Connection —
    "Limited Room May Be the Common Thread.",
    "Three things that can look separate—day-to-day tradeoffs, slower movement toward the future, and less protection from disruption—may actually be connected by the same constraint: financial room.",
    "You can see the picture. You have direction. And useful information often becomes movement for you.",
    "But when too much of today's income is already committed, clarity cannot automatically become action.",
    "That is the connection worth noticing.",
    // — §6 Destination (composed from the genuine A+B+D selection) —
    "Your definition of being Set for Life is not simply about accumulating a bigger number.",
    "The future you described points toward something more practical:",
    "less financial drama, enough income to enjoy the life you are building, and enough stability to help the people you care about be prepared.",
    "Taken together, your answers sound less like a desire to simply have more money and more like a desire for money to create:",
    "steadiness, choice, breathing room, and the freedom to take care of what matters.",
    // — §7 Readiness —
    "Readiness does not always move in a straight line.",
    "You can be clear in one area, cautious in another, and fully prepared to act when the right change becomes obvious. These four signals simply show what is true for you right now.",
    "No Manufactured Emergency",
    "This does not feel especially urgent to you right now.",
    "And it does not have to.",
    "There is value in being able to look at your financial life before everything becomes a crisis.",
    "Open, Still Considering",
    "You are willing to take a closer look.",
    "Your readiness to make changes is still forming, which makes understanding what actually deserves attention more important than trying to change everything at once.",
    "Willing to Follow Through",
    "When a financial change makes sense for your life, you believe you can stay with it.",
    "The goal is not simply to work harder. It is to make sure your effort is aimed at the right problem.",
    "Open When the Fit Is Right",
    "You are open to professional guidance when it feels clear, trustworthy, useful, and worth the value.",
    "The right support should help you understand your options well enough to remain the owner of your choices.",
    // — §8 Attention —
    "CREATE MORE ROOM",
    "If you examine one thing next, examine financial room.",
    "Across your Snapshot, the recurring constraint is not that you lack awareness, direction, or a willingness to make thoughtful decisions.",
    "What would have to change for more of your income to become available for the life you are trying to build?",
    "More room creates more choices.",
    "KEEP IN VIEW — RESILIENCE",
    "As financial room improves, keep an eye on how much of that increased flexibility is available to absorb the unexpected—not only fund the expected.",
  ];

  it(`carries all ${SAMPLE_SENTENCES.length} approved sample sentences verbatim`, async () => {
    const content = await goldenContent();
    const missing = SAMPLE_SENTENCES.filter((s) => !content.includes(s));
    expect(
      missing,
      "approved sample sentences missing from resolved content",
    ).toEqual([]);
  });
});
