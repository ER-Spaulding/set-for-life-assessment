import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Snapshot composition guards for config/report-v1.0.json
 * (PRD §11 and §20; UIUX §22/§22A).
 *
 * Screen order, conditionality, activation separation, continuation paths,
 * and approved participant-facing strings. Per the standing rule for these
 * guards, a requirement expressed only in prose `notes` — with no
 * structural field the engine can read — FAILS: that is a genuine finding,
 * not something to paper over.
 */
const cfg = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/report-v1.0.json"), "utf8"),
);
const screens = cfg.screens;
const byUiux = (ref: string) => screens.find((s: { uiux_ref: string }) => s.uiux_ref === ref);

/** Collect every string VALUE in a JSON tree (values only — not keys). */
function collectStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (node !== null && typeof node === "object")
    return Object.values(node as Record<string, unknown>).flatMap(collectStrings);
  return [];
}

describe("report config (PRD §11/§20, UIUX §22/§22A)", () => {
  it("presents every Snapshot screen S12–S22 (PRD §20)", () => {
    const refs = new Set(screens.map((s: { uiux_ref: string }) => s.uiux_ref));
    for (const ref of [
      "S12",
      "S13",
      "S14",
      "S15",
      "S16",
      "S17",
      "S18",
      "S19",
      "S20",
      "S21",
      "S22",
    ]) {
      expect(refs.has(ref)).toBe(true);
    }
  });

  it("keeps S18 Perception Gap conditional (PRD §20 Screen 8)", () => {
    const s18 = byUiux("S18");
    expect(s18).toBeDefined();
    // A conditional screen must carry a truthy condition — never `false`.
    expect(s18.conditional).toBeTruthy();
    expect(s18.conditional).not.toBe(false);
  });

  it("structurally prevents averaging A1–A4 on S19 (PRD §11)", () => {
    const s19 = byUiux("S19");
    expect(s19).toBeDefined();
    // The engine must be able to READ non-aggregation from the config.
    // Prose in `notes` ("no combined index") is not enforceable, so this
    // asserts the structural flag `aggregate: false` — and fails until it
    // exists. A failing run here is a genuine finding, not a bad test.
    expect(s19.aggregate).toBe(false);
  });

  it("offers four continuation paths, none preselected or deprioritized (UIUX §22)", () => {
    const cont = screens.find((s: { id: string }) => s.id === "continuation");
    expect(cont).toBeDefined();
    expect(cont.continuation_options.map((o: { code: string }) => o.code)).toEqual([
      "KEEP_LEARNING",
      "LOOK_CLOSER_FINANCIAL_PICTURE",
      "EXPLORE_MORE_INCOME",
      "NOT_RIGHT_NOW",
    ]);
    for (const o of cont.continuation_options) {
      // "Not Right Now" must never be hidden or preselected — checked on
      // every path including the NOT_RIGHT_NOW decline path itself.
      expect(o.preselect ?? null).toBeNull();
      expect(o.deprioritize).toBe(false);
    }
  });

  it("keeps the approved strings character for character (UIUX §22/§22A)", () => {
    expect(byUiux("S21").title).toBe("YOU DECIDE WHAT HAPPENS NEXT.");
    expect(byUiux("S20").title).toBe("ONE AREA WORTH EXAMINING NEXT");
    const s20a = screens.find(
      (s: { uiux_ref: string }) => s.uiux_ref === "S20A",
    );
    expect(s20a).toBeDefined();
    expect(s20a.title).toBe("STAY CONNECTED — ON YOUR TERMS");
    // Em dash U+2014 — a hyphen here would silently ship wrong copy.
    expect(s20a.title).toContain("—");
  });

  it("never claims the retired SEE/ROOM/DIRECT/PREPARE/AIM/MOVE labels are participant-facing (A01 v1.1 §2.3)", () => {
    // The regression this guards: the operating-profile screen's `notes` used
    // to read "Participant-friendly operating labels SEE / ROOM / DIRECT /
    // PREPARE / AIM / MOVE (PRD §20.1)". §2.3 retires that shorthand as the
    // participant-facing framework, so re-introducing the claim is a stale
    // vocabulary bug, not a neutral wording tweak. Assert across the whole
    // config so the claim cannot reappear under a different screen.
    const offenders = collectStrings(cfg).filter((s) =>
      /participant[- ]friendly/i.test(s),
    );
    expect(
      offenders,
      "a config string still describes the retired labels as participant-friendly",
    ).toEqual([]);
  });
});
