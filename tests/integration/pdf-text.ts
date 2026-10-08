import { inflateSync } from "node:zlib";
import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import { snapshotPdfSections } from "@/lib/render/snapshot-pdf";
import {
  SNAPSHOT_TITLE,
  SNAPSHOT_SUBTITLE,
  SNAPSHOT_DISCLOSURE,
  preparedForLine,
  footerLine,
} from "@/lib/ui/snapshot-doc-copy";

/**
 * PDF TEXT OVER THE REAL RENDERED BYTES — the byte-level substrate for the
 * render-membership guards.
 *
 * `extractPdfText` does NOT read `snapshotPdfSections`, `snapshotPdfStrings`, or
 * any mirror of the renderer's JSX — it decodes the text the
 * `@react-pdf/renderer` engine actually wrote into `renderSnapshotPdf`'s output
 * buffer, so a string the renderer mints is structurally visible to the guard.
 * `expectedPdfText` (below) is the guard's OTHER side: the sequence the renderer
 * SHOULD emit, DERIVED from the shared model via `snapshotPdfSections` (the real
 * layout function the renderer itself calls) plus the canonical furniture — a
 * derivation from the same sources, never a hand-maintained list of strings.
 *
 * How @react-pdf/renderer writes text (verified against the real output):
 *   - every text run is a `Tj` / `TJ` operator whose operands are `<hex>` glyph
 *     strings; the interleaved TJ numbers are kerning/word-spacing offsets, and
 *     the literal U+0020 space is always a real glyph in the run, so discarding
 *     the offsets and concatenating the operands reconstructs the text with
 *     correct word boundaries (including across line wraps — the wrapped line's
 *     trailing/leading space is a real glyph).
 *   - fonts are `/BaseFont /Helvetica` (and Helvetica-Bold) with
 *     `/Encoding /WinAnsiEncoding`, so non-ASCII characters (bullet U+2022,
 *     en-dash U+2013, em-dash U+2014, curly quotes, ellipsis) are encoded as
 *     single WinAnsi (cp1252) bytes, NOT UTF-8 and NOT latin1. The 0x80–0x9F
 *     range must be remapped from cp1252 — a latin1 decode would mangle them
 *     into invisible control characters.
 */

/** The cp1252 (WinAnsi) characters that differ from latin1 in 0x80–0x9F. */
const CP1252: Record<number, string> = {
  0x80: "€", // €
  0x82: "‚", // ‚
  0x83: "ƒ", // ƒ
  0x84: "„", // „
  0x85: "…", // …
  0x86: "†", // †
  0x87: "‡", // ‡
  0x88: "ˆ", // ˆ
  0x89: "‰", // ‰
  0x8a: "Š", // Š
  0x8b: "‹", // ‹
  0x8c: "Œ", // Œ
  0x8e: "Ž", // Ž
  0x91: "‘", // ‘
  0x92: "’", // ’
  0x93: "“", // “
  0x94: "”", // ”
  0x95: "•", // •
  0x96: "–", // –
  0x97: "—", // —
  0x98: "˜", // ˜
  0x99: "™", // ™
  0x9a: "š", // š
  0x9b: "›", // ›
  0x9c: "œ", // œ
  0x9e: "ž", // ž
  0x9f: "Ÿ", // Ÿ
};

/** Decode a run of raw bytes as WinAnsi (cp1252) — NOT latin1, NOT UTF-8. */
function winAnsi(bytes: Buffer): string {
  let out = "";
  for (const b of bytes) {
    out += CP1252[b] ?? String.fromCharCode(b);
  }
  return out;
}

/** Decode one `<hex>` text operand to its WinAnsi string. */
function decodeHexOperand(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  // An odd-length operand is a malformed run; drop the dangling nibble rather
  // than throw — the string itself still decodes.
  const even = clean.length % 2 === 1 ? clean.slice(0, -1) : clean;
  return winAnsi(Buffer.from(even, "hex"));
}

/** Decode one `(literal)` text operand, handling the common PDF escapes. */
function decodeLiteralOperand(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) break;
    if (/[0-7]/.test(next)) {
      const oct = (s.slice(i + 1).match(/^[0-7]{1,3}/) ?? [""])[0];
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length;
      continue;
    }
    if (next === "n") {
      out += "\n";
      i++;
      continue;
    }
    if (next === "r") {
      out += "\r";
      i++;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i++;
      continue;
    }
    if (next === "b") {
      out += "\b";
      i++;
      continue;
    }
    if (next === "f") {
      out += "\f";
      i++;
      continue;
    }
    // A line-continuation backslash-newline, or a bare escaped char.
    out += next;
    i++;
  }
  return out;
}

/**
 * Extract the participant-facing text of a rendered PDF buffer by decoding the
 * text-showing operands of every content stream. Concatenates operands in
 * stream order with no separators — the real U+0020 space glyphs are part of the
 * operands, so word boundaries (including wrap boundaries) come out correct.
 */
export function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  let out = "";
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
        // Not deflate after all — leave the body as-is.
      }
    }

    // Text operands only: `<hex>` (pdfkit's form) and `(literal)`.
    const re = /<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^()\\])*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      if (m[1] !== undefined) out += decodeHexOperand(m[1]);
      else if (m[2] !== undefined) out += decodeLiteralOperand(m[2]);
    }

    cursor = e + "endstream".length;
  }

  return out;
}

/** Whitespace-insensitive squash: removes every whitespace run, so a content
 *  comparison is robust to the renderer's line-wrapping and word-spacing (which
 *  never change the non-space characters of a string). */
export function squash(s: string): string {
  return s.replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// The PDF document's Info dictionary — the metadata channel the text-showing
// decode above does NOT cover.
// ---------------------------------------------------------------------------

/** The Info dictionary keys @react-pdf/renderer may write (participant-visible
 *  metadata, NOT content-stream text). */
export interface PdfInfoDict {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModificationDate?: string;
}

/** The `<< ... >>` body text of an indirect object, or null when not a dict. */
function indirectDictBody(raw: string, objectNumber: string): string | null {
  const idx = raw.indexOf(`${objectNumber} 0 obj`);
  if (idx === -1) return null;
  const start = raw.indexOf("<<", idx);
  if (start === -1) return null;
  const end = raw.indexOf(">>", start);
  if (end === -1) return null;
  return raw.slice(start + 2, end);
}

/** Decode an indirect object that is a single string (`(literal)` or `<hex>`). */
function decodeIndirectStringObject(raw: string, objectNumber: string): string | null {
  const idx = raw.indexOf(`${objectNumber} 0 obj`);
  if (idx === -1) return null;
  const end = raw.indexOf("endobj", idx);
  const body = end === -1 ? raw.slice(idx) : raw.slice(idx, end);
  const lit = /\(((?:\\.|[^()\\])*)\)/.exec(body);
  if (lit) return decodeLiteralOperand(lit[1]);
  const hex = /<([0-9A-Fa-f\s]*)>/.exec(body);
  if (hex) return decodeHexOperand(hex[1]);
  return null;
}

/**
 * Decode the PDF document's Info dictionary — the metadata the content-stream
 * text decode (`extractPdfText`) is structurally blind to. A renderer that mints
 * participant-facing prose into the Document `author`/`subject`/`title` would be
 * invisible to the membership/parity guards; this function surfaces that channel
 * so a guard can assert it is the DB/config-derived values (Subject = report
 * version, CreationDate = completion timestamp) and the fixed library stamp, and
 * NOT minted prose.
 */
export function extractPdfInfoDict(buf: Buffer): PdfInfoDict {
  const raw = buf.toString("latin1");
  const infoRef = /\/Info\s+(\d+)\s+0\s+R/.exec(raw);
  if (!infoRef) return {};
  const body = indirectDictBody(raw, infoRef[1]);
  if (body === null) return {};

  const out: PdfInfoDict = {};
  const entryRe =
    /\/([A-Za-z]+)\s+(?:(\d+)\s+0\s+R|\(((?:\\.|[^()\\])*)\)|<([0-9A-Fa-f\s]*)>)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body))) {
    const key = m[1] as keyof PdfInfoDict;
    let value: string | null;
    if (m[2] !== undefined) value = decodeIndirectStringObject(raw, m[2]);
    else if (m[3] !== undefined) value = decodeLiteralOperand(m[3]);
    else value = decodeHexOperand(m[4]);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** The PDF date string pdfkit writes for an ISO timestamp (`D:YYYYMMDDHHmmssZ`,
 *  always UTC). */
export function expectedPdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * The exact character sequence the PDF renderer must emit, DERIVED from the
 * shared model (`snapshotPdfSections`, the real layout function the renderer
 * calls) and the canonical furniture — never hand-written, so it cannot drift
 * against the renderer the way a hand-maintained "expected strings" mirror
 * would. §9: one page per section (cover = page 1), each page ends with the
 * standardized footer; the cover carries the title, subtitle, the name-gated
 * personalization line, and the disclosure.
 */
export function expectedPdfText(sections: SnapshotSection[], firstName: string | null): string {
  const pdfSections = snapshotPdfSections(sections);
  const totalPages = 1 + pdfSections.length;

  const personalization = preparedForLine(firstName);
  const parts: string[] = [
    SNAPSHOT_TITLE,
    SNAPSHOT_SUBTITLE,
    ...(personalization ? [personalization] : []),
    SNAPSHOT_DISCLOSURE,
    footerLine(1, totalPages),
  ];

    // Section intro/outro (governed `section_intros` + destination framing) are
    // WEB-ONLY by renderer decision — the PDF is fixed-layout with §9 page
    // furniture, and snapshot-pdf.tsx records the same skip. Only block content
    // (kicker/label/body/paragraphs) enters the byte-level universe here.
  let page = 2;
  for (const section of pdfSections) {
    for (const block of section.blocks) {
      if (block.kicker) parts.push(block.kicker);
      if (block.label) parts.push(block.label);
      parts.push(block.body);
      for (const p of block.paragraphs ?? []) parts.push(p);
    }
    parts.push(footerLine(page, totalPages));
    page += 1;
  }

  return parts.join("");
}
