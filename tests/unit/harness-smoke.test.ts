import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Harness smoke test. Not an acceptance test — it proves the runner, the `@/`
 * alias and filesystem access to the approved config all work, so that a
 * failing PRD §29 test later means the test failed, not the harness.
 */
describe("test harness", () => {
  it("resolves the repo root and reads approved config", () => {
    const cfg = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
    );
    expect(cfg.version).toBe("1.0");
    expect(cfg.questions).toHaveLength(25);
    expect(cfg.opening).toHaveLength(2);
    expect(cfg.activation).toHaveLength(4);
  });

  it("the 31 required items are present and demographics are separate", () => {
    const cfg = JSON.parse(
      readFileSync(resolve(__dirname, "../../config/assessment-v1.0.json"), "utf8"),
    );
    const required =
      cfg.opening.length + cfg.questions.length + cfg.activation.length;
    // PRD §8: 31 = Opening A + Opening B + Q1-Q25 + A1-A4
    expect(required).toBe(31);
    // PRD §8: demographics are separate from diagnostic completion
    expect(cfg.demographics).toHaveLength(3);
    expect(required + cfg.demographics.length).not.toBe(31);
  });
});
