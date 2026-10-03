import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SNAPSHOT_TITLE,
  SNAPSHOT_SUBTITLE,
  SNAPSHOT_DISCLOSURE,
  FOOTER_SEPARATOR,
  footerLine,
  preparedForLine,
} from "@/lib/ui/snapshot-doc-copy";
import { BRAND_NAME } from "@/lib/brand";
import { resolveSnapshotContent } from "@/lib/render/snapshot-sections";
import { renderSnapshotPdf } from "@/lib/render/snapshot-pdf";
import type { SnapshotPayload, PayloadSignal } from "@/lib/assessment/snapshot-payload";

/**
 * THE PDF COPY GUARD — owner rulings 2026-10-02, applied verbatim.
 *
 * The footer, cover, personalization and disclosure are fixed-by-ruling copy.
 * Unlike the narrative copy (guarded by §5's resolver/source scans against the
 * pinned config libraries), these strings have NO config home — they live in
 * `lib/ui/snapshot-doc-copy.ts` and are protected here, RAW (no normalization,
 * no case folding): a single drifted code point is a content defect.
 *
 *   - the footer is `SET FOR LIFE • FINANCIAL SNAPSHOT • {PAGE} OF {TOTAL}` with
 *     U+2022 BULLET separators (a hyphen, en-dash, or pipe must FAIL);
 *   - the cover title and subtitle are the approved strings, unchanged;
 *   - the personalization line is `Prepared for {Name}` ONLY for a verified name,
 *     and is OMITTED (null, never empty, never a placeholder) otherwise;
 *   - the educational disclosure is the approved string, verbatim;
 *   - the footer consumes the ONE canonical brand constant (BRAND_NAME).
 */

const repo = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

// ---------------------------------------------------------------------------
// A minimal payload that resolves to a populated view (enough for a real render).
// ---------------------------------------------------------------------------

function signal(signal: string, state: PayloadSignal["state"], narrativeKey: string): PayloadSignal {
  return {
    signal: signal as PayloadSignal["signal"],
    state,
    specialState: null,
    displayState: state,
    narrativeKey,
    evidence: { confidence: "high", limitedReason: null },
  };
}

function payload(): SnapshotPayload {
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
      signal("DIRECT", "S3", "signal_states.DIRECT.S3"),
      signal("PREPARE", "S4", "signal_states.PREPARE.S4"),
      signal("AIM", "S3", "signal_states.AIM.S3"),
      signal("MOVE", "S5", "signal_states.MOVE.S5"),
    ],
    bigPicture: {
      template: "PRIMARY_FRICTION",
      parts: ["signal_states.MOVE.S5", "connection_statements.HIGH_ACTIVITY_LOW_DIRECTION"],
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
    q16Selections: ["Q16_A"],
    openingB: null,
  };
}

// ---------------------------------------------------------------------------
// PDF byte inspection — decompress FlateDecode content streams so we can assert
// the rendered strings actually reach the document.
// ---------------------------------------------------------------------------

/** Decode one PDF literal string `(...)` operand, handling escapes. */
function decodePdfLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      const next = s[i + 1];
      if (next === undefined) break;
      if (/[nrtbf]/.test(next)) {
        i++; // line-continuation / whitespace escape
        continue;
      }
      if (/[0-7]/.test(next)) {
        const oct = (s.slice(i + 1).match(/^[0-7]{1,3}/) ?? [""])[0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Decode every `(literal)` and `<hex>` text operand in a content stream. */
function decodeContentStrings(streamText: string): string {
  const out: string[] = [];
  const re = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^()\\])*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(streamText))) {
    if (m[1] !== undefined) {
      out.push(Buffer.from(m[1].replace(/\s+/g, ""), "hex").toString("latin1"));
    } else if (m[2] !== undefined) {
      out.push(decodePdfLiteral(m[2]));
    }
  }
  return out.join("");
}

/** Concatenate the decoded text of every content stream in the PDF. */
function decodedPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const out: string[] = [];
  let cursor = 0;
  for (;;) {
    const s = raw.indexOf("stream", cursor);
    if (s === -1) break;
    let dataStart = s + "stream".length;
    if (raw.startsWith("\r\n", dataStart)) dataStart += 2;
    else if (raw.startsWith("\n", dataStart)) dataStart += 1;
    else if (raw.startsWith("\r", dataStart)) dataStart += 1;
    const e = raw.indexOf("endstream", dataStart);
    if (e === -1) break;
    const dictStart = raw.lastIndexOf("<<", s);
    const dict = dictStart !== -1 ? raw.slice(dictStart, s) : "";
    let body = raw.slice(dataStart, e);
    if (/FlateDecode/.test(dict)) {
      try {
        body = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
      } catch {
        // leave as-is
      }
    }
    out.push(decodeContentStrings(body));
    cursor = e + "endstream".length;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// 1. The footer — exact format, U+2022 bullet, and the canonical brand constant.
// ---------------------------------------------------------------------------

describe("the standardized footer is exact and consumes the canonical brand constant", () => {
  it("uses U+2022 BULLET as the separator — not a hyphen, en-dash, or pipe", () => {
    expect(FOOTER_SEPARATOR).toBe("•");
    expect(FOOTER_SEPARATOR.charCodeAt(0)).toBe(0x2022);
    expect(FOOTER_SEPARATOR).not.toBe("-");
    expect(FOOTER_SEPARATOR).not.toBe("–");
    expect(FOOTER_SEPARATOR).not.toBe("|");
  });

  it("renders the approved `SET FOR LIFE • FINANCIAL SNAPSHOT • {PAGE} OF {TOTAL}`", () => {
    expect(footerLine(1, 9)).toBe("SET FOR LIFE • FINANCIAL SNAPSHOT • 1 OF 9");
    expect(footerLine(3, 12)).toBe("SET FOR LIFE • FINANCIAL SNAPSHOT • 3 OF 12");
  });

  it("the leading token is the canonical BRAND_NAME, uppercased — not a hardcoded twin", () => {
    expect(BRAND_NAME).toBe("Set for Life");
    expect(footerLine(1, 9).startsWith(`${BRAND_NAME.toUpperCase()} `)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The cover — approved title + subtitle + the personalization line.
// ---------------------------------------------------------------------------

describe("the cover copy is the approved title and subtitle, unchanged", () => {
  it("title is verbatim", () => {
    expect(SNAPSHOT_TITLE).toBe("YOUR SET FOR LIFE FINANCIAL SNAPSHOT");
  });

  it("subtitle is verbatim", () => {
    expect(SNAPSHOT_SUBTITLE).toBe(
      "A personalized look at how you currently see, direct, prepare, and make decisions with your money.",
    );
  });
});

describe("the personalization line is name-gated (Addendum 02 §3.2)", () => {
  it("renders `Prepared for {Name}` only for a verified name", () => {
    expect(preparedForLine("Avery")).toBe("Prepared for Avery");
    expect(preparedForLine("  Avery  ")).toBe("Prepared for Avery");
  });

  it("is OMITTED (null, not empty, not a placeholder) for an unverified/provisional name", () => {
    expect(preparedForLine(null)).toBeNull();
    expect(preparedForLine("")).toBeNull();
    expect(preparedForLine("   ")).toBeNull();
  });

  it("never substitutes a placeholder name", () => {
    const line = preparedForLine("Avery");
    expect(line).not.toMatch(/friend|there|guest|participant|valued/i);
  });
});

// ---------------------------------------------------------------------------
// 3. The educational disclosure — verbatim.
// ---------------------------------------------------------------------------

describe("the educational disclosure is the approved string, verbatim", () => {
  it("matches the ruling word for word", () => {
    expect(SNAPSHOT_DISCLOSURE).toBe(
      "This Financial Snapshot is based on your responses to the Set for Life Financial Assessment and is provided for educational and informational purposes. It is not a recommendation to buy, sell, replace, surrender, allocate, or change any financial product, investment, insurance coverage, account, or strategy. Individualized recommendations, when appropriate, belong in an appropriately licensed and supervised conversation.",
    );
  });

  it("is not expanded into additional legal claims", () => {
    expect(SNAPSHOT_DISCLOSURE).not.toMatch(/not (an? )?(offer|solicitation|investment advice)/i);
  });
});

// ---------------------------------------------------------------------------
// 4. The web and PDF renderers consume the SAME single source (no second copy).
// ---------------------------------------------------------------------------

describe("the disclosure has one source, consumed by both renderers", () => {
  it("the web results view imports the disclosure from the shared module", () => {
    const web = read("components/snapshot/results-view.tsx");
    expect(web).toMatch(/SNAPSHOT_DISCLOSURE/);
    expect(web).toMatch(/from\s+"@\/lib\/ui\/snapshot-doc-copy"/);
    // No hardcoded duplicate of the disclosure sentence in the web source.
    expect(web).not.toContain("educational and informational purposes");
  });

  it("the PDF renderer imports the cover/footer/disclosure copy from the shared module", () => {
    const pdf = read("lib/render/snapshot-pdf.tsx");
    expect(pdf).toMatch(/SNAPSHOT_TITLE/);
    expect(pdf).toMatch(/SNAPSHOT_DISCLOSURE/);
    expect(pdf).toMatch(/from\s+"\.\.\/ui\/snapshot-doc-copy"/);
  });
});

// ---------------------------------------------------------------------------
// 5. Render smoke — the real PDF bytes carry the footer and cover.
// ---------------------------------------------------------------------------

describe("the rendered PDF bytes carry the approved footer and cover", () => {
  it("the footer furniture, cover title, personalization and disclosure reach the bytes", async () => {
    const sections = resolveSnapshotContent(payload());
    const buf = await renderSnapshotPdf(sections, {
      firstName: "Avery",
      generatedAt: "2026-10-02T00:00:00.000Z",
      reportVersion: "1.0",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const text = decodedPdfText(buf);
    // Footer brand + furniture (the U+2022 bullet is font-encoded as a
    // non-ASCII byte, so assert the ASCII tokens around it; the exact bullet
    // code point is guarded at source level above).
    expect(text).toContain("SET FOR LIFE");
    expect(text).toContain("FINANCIAL SNAPSHOT");
    expect(text).toContain(" OF "); // the "{PAGE} OF {TOTAL}" run
    // Cover title, personalization, and a disclosure token.
    expect(text).toContain("YOUR SET FOR LIFE");
    expect(text).toContain("Prepared for Avery");
    expect(text).toContain("educational and informational");
  });

  it("the personalization line is absent when the name is unverified", async () => {
    const sections = resolveSnapshotContent(payload());
    const buf = await renderSnapshotPdf(sections, {
      firstName: null,
      generatedAt: null,
      reportVersion: null,
    });
    const text = decodedPdfText(buf);
    expect(text).not.toContain("Prepared for");
  });
});
