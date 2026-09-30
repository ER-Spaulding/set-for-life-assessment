import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest configuration for the Set for Life assessment.
 *
 * Test layout mirrors PRD §31:
 *   tests/unit              — pure-function tests (scoring, classifiers, tensions)
 *   tests/integration       — config ↔ engine consistency, API surface
 *   tests/synthetic-profiles — full 31-item profiles run end-to-end through the engine
 *   tests/e2e               — browser-level flows (not yet wired)
 *
 * The `@/` alias matches tsconfig so tests import modules the same way the
 * app does. PRD §29's 19 acceptance tests are the primary unit suite.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", ".next"],
    // Scoring is deterministic; a fixed seed keeps any future property-based
    // tests reproducible.
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
});
