import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Owner copy rulings 2026-10-02 — the exact, approved strings for the Snapshot
 * surface, asserted FROM THEIR CANONICAL SOURCE (not a hardcoded literal).
 *
 * Each approved string has ONE canonical home:
 *   - brand token                -> lib/brand.ts            BRAND_NAME
 *   - loading / download CTA     -> lib/ui/snapshot-copy.ts LOADING_COPY / DOWNLOAD_CTA
 *   - disclosure / footer / cover-> lib/ui/snapshot-doc-copy.ts
 *   - application metadata       -> app/layout.tsx
 *
 * This file pins the exact characters (U+2026 ellipsis, U+2022 bullet, U+2014
 * em dash) so a "close-enough" rewrite — three dots for an ellipsis, a hyphen
 * for a dash — fails loudly.
 */

import { BRAND_NAME } from "@/lib/brand";
import { LOADING_COPY, DOWNLOAD_CTA } from "@/lib/ui/snapshot-copy";
import {
  SNAPSHOT_DISCLOSURE,
  SNAPSHOT_TITLE,
  SNAPSHOT_SUBTITLE,
  footerLine,
  preparedForLine,
} from "@/lib/ui/snapshot-doc-copy";

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");


/**
 * EVERY FILE IN THE WEB RENDER LAYER, concatenated.
 *
 * The render layer used to be one file (`components/snapshot/results-view.tsx`);
 * it is now a directory of focused components. These source-level guards assert
 * properties of "the render layer", so they must read the WHOLE layer — scanning
 * only results-view.tsx would silently stop checking the other twelve files, and
 * the guard would pass for the wrong reason. Concatenating is safe because every
 * assertion below is a negative (must-not-contain) or a whole-layer presence
 * check; a per-file loop would be weaker for the presence checks.
 */
function renderLayerSource(ext: string[] = [".tsx", ".ts"]): string {
  const dir = resolve(repo, "components/snapshot");
  return readdirSync(dir)
    .filter((f) => ext.some((e) => f.endsWith(e)))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .join("\n");
}


describe("the brand token has one canonical constant", () => {
  it("BRAND_NAME is the approved brand token", () => {
    expect(BRAND_NAME).toBe("Set for Life");
  });

  it("the application metadata title consumes BRAND_NAME with an em dash (U+2014)", () => {
    const layout = read("app/layout.tsx");
    // Ruling 12: "Set for Life — Financial Assessment" (em dash, spaces) is
    // application METADATA, not narrative copy.
    expect(layout).toMatch(/\$\{BRAND_NAME\} — Financial Assessment/);
    expect(layout).toContain("—"); // U+2014 em dash
  });

  it("the results-view footer renders the brand from the constant (not a literal)", () => {
    // The footer is now its own component; the brand must still come from the
    // canonical constant rather than a re-typed literal, so this scans the whole
    // render layer for the JSX interpolation.
    const code = renderLayerSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/\{BRAND_NAME\}/);
  });
});

describe("the approved loading and download copy lives in one module", () => {
  it("the loading state uses U+2026 ellipsis, not three dots (ruling 1)", () => {
    expect(LOADING_COPY).toBe("Preparing your Snapshot…");
    expect(LOADING_COPY).not.toContain("...");
  });

  it("the download CTA is the approved Module 12 label", () => {
    expect(DOWNLOAD_CTA).toBe("DOWNLOAD MY FINANCIAL SNAPSHOT");
  });

  it("the download button renders the CTA from the canonical constant", () => {
    const code = read("components/snapshot/DownloadButton.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("DOWNLOAD_CTA");
    expect(code).toMatch(/\{DOWNLOAD_CTA\}/);
  });
});

describe("the educational disclosure is fixed-by-ruling document furniture", () => {
  it("SNAPSHOT_DISCLOSURE is the approved disclosure, verbatim", () => {
    expect(SNAPSHOT_DISCLOSURE).toBe(
      "This Financial Snapshot is based on your responses to the Set for Life Financial Assessment and is provided for educational and informational purposes. It is not a recommendation to buy, sell, replace, surrender, allocate, or change any financial product, investment, insurance coverage, account, or strategy. Individualized recommendations, when appropriate, belong in an appropriately licensed and supervised conversation.",
    );
  });

  it("the web results render the disclosure from the canonical source", () => {
    // Scans the whole render layer: the footer that renders the disclosure is now
    // its own component, and the disclosure must still be interpolated from the
    // canonical module rather than re-typed.
    const code = renderLayerSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/\{SNAPSHOT_DISCLOSURE\}/);
    expect(code).toMatch(/from "@\/lib\/ui\/snapshot-doc-copy"/);
  });
});

describe("the PDF cover and footer follow the approved rulings", () => {
  it("the cover title and subtitle are preserved exactly (not a rewritten headline)", () => {
    expect(SNAPSHOT_TITLE).toBe("YOUR SET FOR LIFE FINANCIAL SNAPSHOT");
    expect(SNAPSHOT_SUBTITLE).toBe(
      "A personalized look at how you currently see, direct, prepare, and make decisions with your money.",
    );
  });

  it("the personalization is a separate supporting line, name-gated", () => {
    expect(preparedForLine("Ada")).toBe("Prepared for Ada");
    expect(preparedForLine(null)).toBeNull();
    expect(preparedForLine("   ")).toBeNull();
  });

  it("the footer is 'SET FOR LIFE • FINANCIAL SNAPSHOT • {PAGE} OF {TOTAL}' (ruling 14)", () => {
    expect(footerLine(2, 7)).toBe("SET FOR LIFE • FINANCIAL SNAPSHOT • 2 OF 7");
    expect(footerLine(1, 1)).toBe("SET FOR LIFE • FINANCIAL SNAPSHOT • 1 OF 1");
    // The bullet is U+2022 — never a hyphen or middle dot.
    expect(footerLine(1, 1)).toContain("•");
    expect(footerLine(1, 1)).not.toContain("-");
  });
});

describe("the report config owns the approved section titles and cover lead", () => {
  // FIXED assertions (not derived from the renderer): these fail the moment the
  // report config drifts from the approved wording, which the render-level
  // guards (which derive expectations FROM the config) would NOT catch.
  const report = JSON.parse(read("config/report-v1.0.json")) as {
    screens: Array<{ id: string; title: string; lead?: string }>;
  };
  const screen = (id: string) => report.screens.find((s) => s.id === id);

  it("the cover lead is the approved reveal line (ruling 2)", () => {
    expect(screen("cover")?.lead).toBe("Here is what your responses reveal.");
  });

  it("the Big Picture heading is the approved 'YOUR BIG PICTURE' (ruling 3)", () => {
    expect(screen("big-picture")?.title).toBe("YOUR BIG PICTURE");
  });

  it("the Connection heading is the FULL approved title (ruling 4)", () => {
    expect(screen("connection")?.title).toBe(
      "The Connection / Here’s the Part Worth Noticing",
    );
  });

  it("the meta description is the approved application metadata (ruling 13)", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain(
      "A guided financial self-assessment designed to help you see your financial picture more clearly and understand what deserves your attention next.",
    );
  });
});
