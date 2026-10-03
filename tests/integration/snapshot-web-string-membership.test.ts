// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { SnapshotResults } from "@/components/snapshot/results-view";
import reportConfig from "@/config/report-v1.0.json";
import narrativesJson from "@/config/narratives-v1.0.json";
import { BRAND_NAME } from "@/lib/brand";
import { SNAPSHOT_DISCLOSURE } from "@/lib/ui/snapshot-doc-copy";
import { DOWNLOAD_CTA } from "@/lib/ui/snapshot-copy";
import { questionById } from "@/lib/ui/questions";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";

/**
 * THE WEB RENDER-STRING-MEMBERSHIP GUARD — Addendum 01 v1.1 §5, the web half,
 * hardened against three demonstrated escapes that left the original green.
 *
 * THE ORIGINAL guard walked text nodes over three hand-picked fixtures and
 * asserted SET-MEMBERSHIP only. An adversarial verifier showed three escapes,
 * each of which this file now closes:
 *
 *   ESCAPE 1 — branch-local minting on an uncovered branch. The original's three
 *     profiles never set a secondary attention area (attentionAreas[1]), so a
 *     conditional span minting prose on the SECONDARY-ATTENTION branch rendered
 *     in production and passed every test. FIX: the profile matrix below is
 *     DERIVED FROM THE PINNED CONFIG (the same technique the 85-test seam guard
 *     uses), so every special-state key, every attention-area key, every
 *     big-picture template, every Q16 code, and every perception-gap key —
 *     INCLUDING the secondary attention area — is a profile that must pass. A
 *     config key automatically promotes into coverage instead of silently
 *     escaping.
 *
 *   ESCAPE 2 — attribute text is invisible. Both render guards walked TEXT NODES
 *     only, so an aria-label / title / alt / placeholder carrying minted prose
 *     was participant-visible (to assistive tech or on hover) and green. FIX:
 *     the walker below also walks every element's participant-visible TEXT
 *     attributes, enumerated as an ALLOWLIST (never a denylist — the denylist is
 *     exactly the mistake this repo has made before, and it failed here).
 *
 *   ESCAPE 3 — misattribution. Set-membership means a covered model string
 *     rendered in the WRONG module (a strength body shown as readiness prose)
 *     still passes. FIX: ATTRIBUTION-EXACTNESS — every string is checked against
 *     the module (section) it belongs to, both directions: nothing appears in a
 *     module it does not belong to, and every string appears in a module it does
 *     belong to. The existing presence/membership checks are NOT weakened.
 *
 * The expected set and the attribution map are DERIVED from
 * `resolveSnapshotContent(payload)` — the same single code path the renderer
 * consumes — plus the canonical chrome sources (`report-v1.0.json`,
 * `lib/brand.ts`, `lib/ui/snapshot-doc-copy.ts`, `lib/ui/snapshot-copy.ts`).
 * No hand-maintained list of strings here.
 */

const SCREENS = reportConfig.screens as unknown as Array<{
  id: string;
  title: string;
  lead?: string;
  continuation_options?: Array<{ code: string; label: string }>;
}>;

const coverTitle = SCREENS.find((s) => s.id === "cover")?.title ?? "";
const COVER_LEAD = SCREENS.find((s) => s.id === "cover")?.lead ?? "";
const CONTINUATION_TITLE_UPPER = (SCREENS.find((s) => s.id === "continuation")?.title ?? "").toUpperCase();
const CONTINUATION_OPTIONS = SCREENS.find((s) => s.id === "continuation")?.continuation_options ?? [];

/**
 * THE ALLOWED PARTICIPANT-VISIBLE ATTRIBUTE SET — enumerated, never denied.
 * These are the HTML attributes whose value is participant-visible text (to
 * assistive tech, on hover, on focus, or as a control's value). Any other
 * attribute is either non-text (`className`, `style`, `type`, `aria-hidden`,
 * `disabled`) or references an id (`aria-labelledby`) and is therefore NOT
 * participant-visible prose. Walking exactly this allowlist means a minted
 * aria-label/title/alt/placeholder is caught, and a new non-text attribute can
 * never be misclassified the way a denylist would misclassify it.
 */
const PARTICIPANT_VISIBLE_TEXT_ATTRIBUTES = [
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "title",
  "alt",
  "placeholder",
  "value",
  "label",
] as const;

// ---------------------------------------------------------------------------
// Config-derived coverage keys (the SAME sources the seam guard derives from).
// ---------------------------------------------------------------------------

const SPECIAL_STATE_KEYS = Object.keys(
  (narrativesJson as { special_signal_states: Record<string, unknown> }).special_signal_states,
);
const ATTENTION_AREA_KEYS = Object.keys(
  (narrativesJson as { attention_areas: Record<string, unknown> }).attention_areas,
);
const PERCEPTION_GAP_KEYS = Object.keys(
  (narrativesJson as { perception_gap: Record<string, unknown> }).perception_gap,
);
const BIG_PICTURE_TEMPLATES = Object.keys(
  (narrativesJson as { big_picture_templates?: Record<string, unknown> }).big_picture_templates ?? {},
);
const Q16_CODES = (questionById("Q16")?.options ?? []).map((o) => o.code);

// Anti-no-op: an empty key space would make the corresponding matrix entries
// duplicates of the baseline and quietly shrink real coverage.
if (Q16_CODES.length === 0) {
  throw new Error("snapshot-web-string-membership: questionById('Q16') yielded no options");
}
if (BIG_PICTURE_TEMPLATES.length === 0) {
  throw new Error("snapshot-web-string-membership: narratives big_picture_templates is empty");
}

// ---------------------------------------------------------------------------
// Payload factories (same keys the consumers read).
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

/** A payload carrying a specific capacity (off-ladder) signal code in `slot`. */
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

/** Anti-false-green: assert a matrix entry produced the shape it claims. */
function expectShape(payload: SnapshotPayload, check: (p: SnapshotPayload) => boolean, label: string) {
  expect(check(payload), `matrix fixture did not produce its claimed shape: ${label}`).toBe(true);
  return payload;
}

/**
 * THE WEB PROFILE MATRIX — config-derived, not hand-picked. A branch gated on
 * any reachable shape (a secondary attention area, a specific capacity code, a
 * specific destination theme, the empty-article shape) meets a profile that
 * satisfies it. A NEW config key (a new special state, a new attention area, a
 * new big-picture template, a new Q16 option) is picked up by the `Object.keys`
 * / `questionById` derivations above and automatically becomes a profile — no
 * hand edit. Same derivation technique as the 85-test seam guard.
 */
const WEB_MATRIX: Array<[string, SnapshotPayload]> = [
  ["baseline: full profile + capacity signal", makePayload()],
  ["null-finding profile", makeNullFindingPayload()],
  ["finalized perception gap", makeFinalizedGapPayload()],
  ["no destination themes", { ...makePayload(), q16Selections: [] }],

  // Every Q16 destination code (from the pinned question bank).
  ...Q16_CODES.map(
    (code): [string, SnapshotPayload] => [
      `destination theme ${code}`,
      { ...makePayload(), q16Selections: [code] },
    ],
  ),
  ["all destination themes", { ...makePayload(), q16Selections: [...Q16_CODES] }],

  // Every big-picture template (from the pinned narrative library).
  ...BIG_PICTURE_TEMPLATES.map(
    (template): [string, SnapshotPayload] => [
      `big-picture template ${template}`,
      { ...makePayload(), bigPicture: { ...makePayload().bigPicture, template: template as SnapshotPayload["bigPicture"]["template"] } },
    ],
  ),

  // Every capacity (off-ladder) code, in each capacity slot.
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

  // Every attention-area key — including KEEP_OBSERVING — plus the SECONDARY
  // attention-area shape (attentionAreas[1] present), which the original guard
  // never exercised and which production payloads do set.
  ...ATTENTION_AREA_KEYS.map(
    (key): [string, SnapshotPayload] => [
      `attention area ${key}`,
      { ...makePayload(), attentionAreas: [key], nullFinding: key === "KEEP_OBSERVING" },
    ],
  ),
  ["secondary attention area", { ...makePayload(), attentionAreas: ["SEE_IT_MORE_CLEARLY", "CREATE_MORE_ROOM"] }],

  // Every perception-gap key (resolved but never rendered — Module 8 deferred).
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

  // The empty-article branch (no signals -> money-picture heading only)…
  ["empty signals", { ...makePayload(), signals: [] }],
  // …and the fully-degenerate shape (every module empty).
  [
    "degenerate (all modules empty)",
    {
      ...makePayload(),
      signals: [],
      strengths: [],
      frictions: [],
      connections: [],
      attentionAreas: ["KEEP_OBSERVING"],
      bigPicture: { template: "NO_MEANINGFUL_FRICTION", parts: [] },
      context: [],
      q16Selections: [],
    },
  ],
];

// ---------------------------------------------------------------------------
// The expected string set and the ATTRIBUTION map (string -> owning module).
// ---------------------------------------------------------------------------

/** Every string the model carries (heading + blocks), for the presence check. */
function modelStrings(sections: SnapshotSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.heading);
    for (const b of s.blocks) {
      if (b.kicker) out.push(b.kicker);
      if (b.label) out.push(b.label);
      out.push(b.body);
    }
  }
  return out.filter((x) => x.length > 0);
}

/**
 * The full attribution map: every participant-facing string -> the module(s) it
 * belongs to. Model strings belong to `section:<id>`; chrome strings belong to
 * their landmark (`cover`, `continuation`, `brand`, `disclosure`, `download`).
 * Derived from the model + the canonical chrome constants — no hand list.
 */
function buildAttribution(
  sections: SnapshotSection[],
  sessionId: string | undefined,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (owner: string, s: string) => {
    if (!s) return;
    if (!m.has(s)) m.set(s, new Set());
    m.get(s)!.add(owner);
  };

  for (const s of sections) {
    add(`section:${s.id}`, s.heading);
    for (const b of s.blocks) {
      if (b.kicker) add(`section:${s.id}`, b.kicker);
      if (b.label) add(`section:${s.id}`, b.label);
      add(`section:${s.id}`, b.body);
    }
  }
  add("cover", coverTitle);
  add("cover", COVER_LEAD);
  add("continuation", CONTINUATION_TITLE_UPPER);
  for (const o of CONTINUATION_OPTIONS) add("continuation", o.label);
  add("brand", BRAND_NAME);
  add("disclosure", SNAPSHOT_DISCLOSURE);
  // The download CTA renders iff a session id is present (the renderer's own
  // `{sessionId ? <DownloadButton/> : null}` branch).
  if (sessionId) add("download", DOWNLOAD_CTA);
  return m;
}

// ---------------------------------------------------------------------------
// The walker: text nodes AND participant-visible attributes, each attributed to
// its module by structural landmark.
// ---------------------------------------------------------------------------

interface AttributedText {
  owner: string;
  text: string;
}

function walkAttributed(html: string, sections: SnapshotSection[]): AttributedText[] {
  const container = document.createElement("div");
  container.innerHTML = html;

  const headingOwner = new Map<string, string>();
  for (const s of sections) headingOwner.set(s.heading.toUpperCase(), `section:${s.id}`);
  headingOwner.set(CONTINUATION_TITLE_UPPER, "continuation");

  function ownerForElement(el: Element): string | null {
    const tag = el.tagName.toLowerCase();
    if (tag === "header") return "cover";
    if (tag === "footer") return "brand";
    if (tag === "button") return "download";
    if (tag === "section") {
      const h2 = el.querySelector("h2");
      const heading = (h2?.textContent ?? "").trim().toUpperCase();
      return headingOwner.get(heading) ?? "unknown-section";
    }
    if (tag === "p") {
      // The disclosure paragraph is the only <p> directly under the content
      // wrapper <div> whose parent is <main> (cover title <p> is under <header>,
      // brand <p> under <footer>, every section body <p> under <section>/<article>).
      const parent = el.parentElement;
      const grandparent = parent?.parentElement;
      if (parent?.tagName.toLowerCase() === "div" && grandparent?.tagName.toLowerCase() === "main") {
        return "disclosure";
      }
    }
    return null;
  }

  const out: AttributedText[] = [];
  function visit(el: Element, inheritedOwner: string): void {
    const owner = ownerForElement(el) ?? inheritedOwner;

    // Participant-visible attributes (the enumerated allowlist).
    for (const attr of PARTICIPANT_VISIBLE_TEXT_ATTRIBUTES) {
      const v = el.getAttribute(attr);
      if (v !== null && v.trim().length > 0) out.push({ owner, text: v.trim() });
    }

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        const t = child.textContent?.trim() ?? "";
        if (t) out.push({ owner, text: t });
      } else if (child.nodeType === 1) {
        visit(child as Element, owner);
      }
    }
  }

  visit(container, "root");
  return out;
}

// ---------------------------------------------------------------------------
// The assertion: membership + attribution, over text and attributes, for one
// render of one profile.
// ---------------------------------------------------------------------------

function assertWebRender(payload: SnapshotPayload, sessionId: string | undefined): void {
  const sections = resolveSnapshotContent(payload);
  const html = renderToStaticMarkup(
    React.createElement(SnapshotResults, { sections, sessionId }),
  );
  const items = walkAttributed(html, sections);
  const attribution = buildAttribution(sections, sessionId);
  const allowed = new Set(attribution.keys());

  // MEMBERSHIP — a text node or participant-visible attribute the model (or
  // enumerated chrome) did not produce is minted prose.
  for (const item of items) {
    expect(
      allowed.has(item.text),
      `web minted a string not in the model (owner ${item.owner}): ${JSON.stringify(item.text)}`,
    ).toBe(true);
  }

  // ATTRIBUTION — every string appears in the module it belongs to, never a
  // foreign module (a strength body rendered as readiness prose fails here).
  for (const item of items) {
    const owners = attribution.get(item.text);
    expect(
      owners?.has(item.owner) === true,
      `web rendered a model string in the wrong module (found in ${item.owner}): ${JSON.stringify(item.text)}`,
    ).toBe(true);
  }

  // PRESENCE — every model string is rendered as a text node (unchanged from
  // the original guard; not weakened).
  const textNodeStrings = items.map((i) => i.text);
  for (const s of modelStrings(sections)) {
    expect(textNodeStrings, `web did not render a model string: ${JSON.stringify(s)}`).toContain(s);
  }

  // ATTRIBUTION (reverse) — every attributed string appears with at least one of
  // its owning modules. Catches an omission that presence-anywhere would miss.
  for (const [s, owners] of attribution) {
    const foundIn = items.filter((i) => i.text === s && owners.has(i.owner));
    expect(
      foundIn.length > 0,
      `web never rendered an attributed string in its owning module: ${JSON.stringify(s)} (expected ${[...owners].join(" or ")})`,
    ).toBe(true);
  }

  // No section should ever map to an unknown heading (a heading the walker did
  // not recognise would otherwise be silently miscounted).
  expect(items.map((i) => i.owner)).not.toContain("unknown-section");

  // The download button branch: CTA present iff a session id is present.
  const cta = items.filter((i) => i.text === DOWNLOAD_CTA);
  if (sessionId) {
    expect(cta.map((i) => i.owner)).toContain("download");
  } else {
    expect(cta).toHaveLength(0);
  }
}

describe("WEB: the real component renders only shared-model strings (text + attributes, per module)", () => {
  for (const [name, payload] of WEB_MATRIX) {
    it(`${name}: membership + attribution, with the download button (session present)`, () => {
      assertWebRender(payload, "s-1");
    });

    it(`${name}: membership + attribution, without the download button (no session)`, () => {
      assertWebRender(payload, undefined);
    });
  }
});
