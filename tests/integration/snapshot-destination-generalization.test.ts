import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";

// OWNER GUARDRAIL 2 / PLAN D8 — DESTINATION SYNTHESIS GENERALIZES.
//
// "The golden profile's exact Q16 combination must not become the only
// combination receiving meaningful synthesis while ordinary combinations fall
// through to generic copy. … Prove that every individual Q16 code and
// representative multi-selection combinations produce coherent participant-
// facing output."
//
// The composition runs in `resolveSnapshotView` over the payload's stored
// `q16Selections`, so this drives the REAL resolver with one engine-produced
// payload and varies only the selection set — the engine's fidelity to the
// instrument's Q16 answers is golden-profile.test.ts's job; this proves the
// NARRATIVE machinery: every code alone, representative pairs/triples, the
// participant's stored order (unranked), the lede rule, the never-invent
// property, and the schema-1.0 fallback.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  getServiceClient: vi.fn(),
  serviceClient: vi.fn(),
  isDbConfigured: () => true,
  DbNotConfiguredError: class extends Error {},
  errorBody: (code: string, message: string) => ({ error: { code, message } }),
}));

import { sectionsFor } from "../synthetic-profiles/profile-runner";
import { resolveSnapshotView } from "@/lib/render/snapshot-view";
import type { SnapshotPayload } from "@/lib/assessment/snapshot-payload";

const ALL_CODES = [
  "Q16_A", "Q16_B", "Q16_C", "Q16_D", "Q16_E", "Q16_F",
  "Q16_G", "Q16_H", "Q16_I", "Q16_J", "Q16_K",
] as const;

const destination = (
  JSON.parse(readFileSync("config/narratives-v1.0.json", "utf8")) as {
    destination: {
      lede: { contrast: string; plain: string };
      tail: string;
      theme_clauses: Record<string, { framing: string; outcome: string }>;
    };
  }
).destination;

let basePayload: SnapshotPayload;

beforeAll(async () => {
  const { payload } = await sectionsFor({});
  basePayload = payload;
});

/** Resolve the destination frame for a selection set (or none — schema 1.0). */
function frame(codes: string[] | undefined): { intro: string[]; outro: string[] } {
  const payload = {
    ...basePayload,
    ...(codes === undefined ? {} : { q16Selections: codes }),
  } as SnapshotPayload;
  if (codes === undefined) delete (payload as { q16Selections?: unknown }).q16Selections;
  return resolveSnapshotView(payload).destinationFrame;
}

describe("every individual Q16 code composes coherent participant-facing output", () => {
  for (const code of ALL_CODES) {
    it(`${code} alone — framing list, lede, outcome close`, () => {
      const f = frame([code]);
      // base intro (2 fixed lines) + composed framing list
      expect(f.intro).toHaveLength(3);
      expect(f.intro[2]).toContain(destination.theme_clauses[code].framing);
      expect(f.intro[2].endsWith(".")).toBe(true);
      // lede + outcome list (single fragment + fixed tail)
      expect(f.outro).toHaveLength(2);
      const lede = code === "Q16_E" ? destination.lede.plain : destination.lede.contrast;
      expect(f.outro[0]).toBe(lede);
      expect(f.outro[1]).toContain(destination.theme_clauses[code].outcome);
      expect(f.outro[1]).toContain(destination.tail);
      expect(f.outro[1].endsWith(".")).toBe(true);
      // single fragment is bare — no stray join punctuation before the tail
      expect(f.outro[1].startsWith(`${destination.theme_clauses[code].outcome} and `)).toBe(true);
    });
  }
});

describe("representative multi-selection combinations compose", () => {
  const pairs: Array<[string, string]> = [
    ["Q16_A", "Q16_D"],
    ["Q16_C", "Q16_G"],
    ["Q16_E", "Q16_I"], // wealth selected → plain lede
    ["Q16_F", "Q16_I"],
  ];
  for (const [x, y] of pairs) {
    it(`${x}+${y} — two fragments joined with "and"`, () => {
      const f = frame([x, y]);
      expect(f.intro[2]).toBe(
        `${destination.theme_clauses[x].framing} and ${destination.theme_clauses[y].framing}.`,
      );
      expect(f.outro[0]).toBe(
        x === "Q16_E" || y === "Q16_E"
          ? destination.lede.plain
          : destination.lede.contrast,
      );
      expect(f.outro[1]).toBe(
        `${destination.theme_clauses[x].outcome}, ${destination.theme_clauses[y].outcome}, and ${destination.tail}`,
      );
    });
  }

  it("the golden triple falls out of general composition (no privileged key)", () => {
    const f = frame(["Q16_A", "Q16_B", "Q16_D"]);
    expect(f.intro[2]).toBe(
      "less financial drama, enough income to enjoy the life you are building, " +
        "and enough stability to help the people you care about be prepared.",
    );
    expect(f.outro[1]).toBe(
      "steadiness, choice, breathing room, and the freedom to take care of what matters.",
    );
    expect(f.outro[0]).toBe(destination.lede.contrast);
  });

  it("stored order is the participant's order — never re-ranked", () => {
    const f = frame(["Q16_D", "Q16_A"]);
    expect(f.intro[2]).toBe(
      `${destination.theme_clauses.Q16_D.framing} and ${destination.theme_clauses.Q16_A.framing}.`,
    );
  });
});

describe("never invents — only selected codes contribute", () => {
  it("the golden composition names no unselected theme", () => {
    const selected = ["Q16_A", "Q16_B", "Q16_D"];
    const f = frame(selected);
    const composed = [f.intro[2], ...f.outro].join(" ");
    for (const code of ALL_CODES) {
      if (selected.includes(code)) continue;
      const { framing, outcome } = destination.theme_clauses[code];
      expect(composed, `must not mention ${code}`).not.toContain(framing);
      expect(composed, `must not mention ${code}`).not.toContain(outcome);
    }
  });

  it("a two-code composition names no unselected theme", () => {
    const selected = ["Q16_C", "Q16_G"];
    const f = frame(selected);
    const composed = [f.intro[2], ...f.outro].join(" ");
    for (const code of ALL_CODES) {
      if (selected.includes(code)) continue;
      const { framing, outcome } = destination.theme_clauses[code];
      expect(composed, `must not mention ${code}`).not.toContain(framing);
      expect(composed, `must not mention ${code}`).not.toContain(outcome);
    }
  });
});

describe("fallbacks are true fallbacks, never the normal path", () => {
  it("no q16Selections (schema 1.0) — intro only, no composition, no crash", () => {
    const f = frame(undefined);
    expect(f.intro).toHaveLength(2); // the two fixed framing lines
    expect(f.outro).toEqual([]);
  });

  it("an uncovered code composes nothing rather than inventing", () => {
    const f = frame(["Q16_Z"]);
    expect(f.intro).toHaveLength(2);
    expect(f.outro).toEqual([]);
  });
});
