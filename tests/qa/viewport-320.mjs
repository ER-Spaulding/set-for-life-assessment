// 320px device-level QA — operator decision #5.
//
// The operator's instruction was specific about what would NOT satisfy this:
//
//   "Add actual 320px viewport/device-level QA before pilot sign-off.
//    Responsive-by-construction is not sufficient evidence of verification."
//
// So this is not a stylesheet review and not a claim that the layout "should"
// work. It drives a real browser at a real 320px viewport, against a real
// running server, and measures the rendered result.
//
// WHY 320. It is the narrowest viewport in common use (iPhone SE 1st gen,
// and the width a browser gives you at 400% zoom on a 1280px display). A
// layout that survives 320 survives the small end of everything.
//
// WHAT IT ASSERTS. Four failure modes that a responsive-by-construction claim
// cannot rule out:
//
//   1. HORIZONTAL OVERFLOW — the page body scrolls sideways. This is the
//      classic 320px failure: one fixed-width child, one long unbroken string,
//      one min-width, and the whole page slides.
//   2. UNDERSIZED TAP TARGETS — §accessibility: a control below 44x44 CSS px
//      is a control a thumb misses. Measured on the rendered box, not on the
//      stylesheet's intent (padding does not enlarge a hit area if the element
//      is display:inline).
//   3. TEXT CLIPPED OR COLLIDING — content overflowing its own container, or
//      elements overlapping. Detected by comparing scrollWidth to clientWidth
//      on text-bearing elements, and by bounding-box intersection.
//   4. UNREADABLE TEXT — computed font-size below the legibility floor, or
//      body text below 16px (which also triggers iOS input zoom).
//
// It also captures a screenshot per page, so a human can look at what was
// measured rather than trusting a green checkmark.
//
// USAGE
//   node tests/qa/viewport-320.mjs [baseUrl]
//
// Requires a running server. Exits non-zero on any failure so it can gate a
// release. Not part of `npm test` — it needs a live server and a browser,
// which unit tests must not.

// Playwright is deliberately NOT a project dependency. It is heavy, it needs a
// downloaded browser, and this harness is run before pilot sign-off rather than
// on every commit — so it resolves the global install if one exists rather than
// adding 160MB to every install of the app.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    // Fall back to the global root — ESM ignores NODE_PATH, so this has to be
    // resolved explicitly.
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(`${globalRoot}/`)("playwright");
  }
}

let chromium, devices;
try {
  ({ chromium, devices } = loadPlaywright());
} catch {
  console.error(
    "\nPlaywright is required for 320px QA but is not installed.\n" +
      "  npm i -g playwright && npx playwright install chromium\n",
  );
  process.exit(2);
}

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = resolve(process.cwd(), "tests/qa/artifacts");

/** The floor for a touch target, in CSS px. WCAG 2.2 SC 2.5.8. */
const MIN_TAP = 44;
/** Body text below this is hard to read and triggers iOS input zoom. */
const MIN_BODY_FONT = 16;

/**
 * Routes a pilot participant actually walks.
 *
 * The session-dependent routes are appended at runtime once a session exists.
 * They are NOT silently omitted when one cannot be created — see the
 * `skipped` list in the report.
 */
const STATIC_ROUTES = [
  { path: "/assessment/start", name: "opening-a", expect: "h1" },
  { path: "/assessment/returning", name: "returning-lookup", expect: "h1" },
];

/** An instrumented probe, evaluated in the page. Kept as a string because it
 *  runs in the browser, not here. */
const PROBE = `(() => {
  const MIN_TAP = ${MIN_TAP};
  const MIN_BODY_FONT = ${MIN_BODY_FONT};
  const out = { overflow: null, smallTargets: [], clipped: [], overlaps: [], tinyText: [] };

  const de = document.documentElement;

  // Screen-reader-only elements are EXCLUDED from every visual check below.
  //
  // The first version of this probe did not exclude them and produced two
  // failures on the question screen that were not defects: the custom radio
  // inputs are 1x1px by design (the visible card is the label), and
  // "(n) percent complete" is sr-only text that is clipped on purpose.
  // A harness that reports those as bugs trains you to ignore it.
  //
  // Detection: the element is clipped to ~1px in both axes, or carries the
  // class Tailwind's sr-only uses. Both are checked because a project may use
  // either, and an element that is BOTH tiny and clipped is not something a
  // sighted participant can interact with or read.
  function isVisuallyHidden(el) {
    if (el.classList && el.classList.contains("sr-only")) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 && r.height <= 2) return true;
    const cs = getComputedStyle(el);
    if (cs.clipPath && cs.clipPath !== "none") return true;
    const clips = (cs.clip && cs.clip !== "auto") || "";
    if (/rect\\(0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\\)/.test(clips)) return true;
    return false;
  }
  out.hiddenExcluded = 0;

  // 1. Horizontal overflow of the page body.
  if (de.scrollWidth > de.clientWidth + 1) {
    // Find WHO overflows, not just that something does — a bare number is not
    // actionable. Walk for elements whose right edge exceeds the viewport.
    const culprits = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        // Report the outermost offender only; children inherit the problem.
        const parentOverflows = el.parentElement &&
          el.parentElement.getBoundingClientRect().right > de.clientWidth + 1;
        if (!parentOverflows) {
          culprits.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 80),
            left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
            text: (el.textContent || "").trim().slice(0, 40),
          });
        }
      }
    }
    out.overflow = {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overBy: de.scrollWidth - de.clientWidth,
      culprits: culprits.slice(0, 8),
    };
  }

  // 2. Tap targets. Only genuinely interactive elements, and only those that
  //    are actually visible and enabled — a disabled button is not a miss.
  const interactive = document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])'
  );
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;           // not rendered
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.disabled) continue;
    if (isVisuallyHidden(el)) { out.hiddenExcluded++; continue; }
    // Inline links inside a paragraph are exempt: WCAG's target-size rule
    // excludes targets in a sentence or block of text. Detecting that
    // reliably is hard, so this flags them separately rather than silently
    // passing or loudly failing.
    const inlineInProse = el.tagName === "A" && cs.display.startsWith("inline") &&
      el.parentElement && /^(P|LI|SPAN)$/.test(el.parentElement.tagName);
    if (r.width < MIN_TAP || r.height < MIN_TAP) {
      out.smallTargets.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
        exemptInlineLink: inlineInProse,
      });
    }
  }

  // 3. Clipped text: an element whose content is wider or taller than its box
  //    while overflow is hidden. This is where copy silently disappears.
  for (const el of document.querySelectorAll("p, h1, h2, h3, h4, li, label, button, span, a")) {
    if (isVisuallyHidden(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" && cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const clipsX = el.scrollWidth > el.clientWidth + 1;
    const clipsY = el.scrollHeight > el.clientHeight + 1;
    if ((clipsX || clipsY) && (el.textContent || "").trim()) {
      out.clipped.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 50),
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        scrollH: el.scrollHeight, clientH: el.clientHeight,
      });
    }
  }

  // 4. Tiny text — measured on the computed style, which is what renders.
  for (const el of document.querySelectorAll("p, li, label, span, a, button, h1, h2, h3")) {
    const t = (el.textContent || "").trim();
    if (!t) continue;
    // Only direct text, so a container does not inherit its child's size.
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0
    );
    if (!hasOwnText) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (isVisuallyHidden(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const isBodyish = /^(P|LI|LABEL|INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (fs < MIN_BODY_FONT && isBodyish) {
      out.tinyText.push({ tag: el.tagName.toLowerCase(), fontPx: fs, text: t.slice(0, 40) });
    }
  }

  // 5. Overlaps between sibling text blocks — a real collision, not a
  //    parent/child containment. Compared only within the same parent.
  const blocks = document.querySelectorAll("p, h1, h2, h3, button, a, label");
  const seen = new Set();
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (isVisuallyHidden(el)) continue;
    const sibs = el.parentElement ? el.parentElement.children : [];
    for (const sib of sibs) {
      if (sib === el) continue;
      if (!/^(P|H1|H2|H3|BUTTON|A|LABEL)$/.test(sib.tagName)) continue;
      const sr = sib.getBoundingClientRect();
      if (sr.width === 0 || sr.height === 0) continue;
      const overlapX = Math.min(r.right, sr.right) - Math.max(r.left, sr.left);
      const overlapY = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
      if (overlapX > 2 && overlapY > 2) {
        const key = [el.tagName, sib.tagName, Math.round(r.top), Math.round(sr.top)].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.overlaps.push({
          a: el.tagName.toLowerCase() + ": " + (el.textContent || "").trim().slice(0, 30),
          b: sib.tagName.toLowerCase() + ": " + (sib.textContent || "").trim().slice(0, 30),
          overlapW: Math.round(overlapX), overlapH: Math.round(overlapY),
        });
      }
    }
  }

  return out;
})()`;

const results = [];
const skipped = [];
let failures = 0;

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// A real session, so the session-dependent routes are measured rather than
// assumed to be fine. Created through the same route the entry flow uses.
//
// The participant id is recorded so the run can be erased with the approved
// mechanism afterwards. This harness does NOT erase anything itself — deleting
// participant data is a deliberate, audited act, not a side effect of a test.
// ---------------------------------------------------------------------------
let sessionId = null;
let participantId = null;

async function createSession() {
  try {
    const r = await fetch(`${BASE}/api/participant/provisional`, { method: "POST" });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    sessionId = j.sessionId ?? null;
    participantId = j.participantId ?? null;
    return sessionId ? null : "no sessionId in response";
  } catch (e) {
    return e.message.split("\n")[0];
  }
}

const createErr = await createSession();
if (createErr) {
  skipped.push({
    what: "assessment + demographics screens",
    why: `could not create a session (${createErr})`,
  });
}

const ROUTES = [
  ...STATIC_ROUTES,
  ...(sessionId
    ? [
        {
          path: `/assessment/${sessionId}`,
          name: "assessment-question",
          expect: "h1, [role=radiogroup], form",
        },
        {
          path: `/assessment/${sessionId}/profile`,
          name: "demographics",
          expect: "h1, form",
        },
      ]
    : []),
];

// WHICH BROWSER. This launches the system Google Chrome (`channel: "chrome"`)
// rather than a Playwright-downloaded Chromium. Two reasons:
//
//   1. It is the browser a 320px participant is actually likely to use, so the
//      text metrics and layout engine under test are the real ones.
//   2. The downloaded Chromium artifacts were incomplete on this machine, and a
//      harness that silently falls back to whatever happens to be present is
//      not reproducible.
//
// The cost, stated rather than hidden: this requires Chrome installed at the
// standard macOS location. The screenshot and the measurements are from Chrome,
// NOT WebKit — Safari can differ on text metrics, and iOS Safari is the browser
// a narrow-viewport participant most likely holds. That gap is named in the
// scope note at the end of this run.
const browser = await chromium.launch({ channel: "chrome" });

// A real device profile at the narrow end. `devices['iPhone SE']` is 320x568;
// we set the viewport explicitly so the width is unambiguous in the report.
const context = await browser.newContext({
  ...devices["iPhone SE"],
  viewport: { width: 320, height: 568 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

console.log(`\n320px device QA — ${BASE}`);
console.log(`viewport 320x568, mobile, touch, DPR 2\n`);
console.log("=".repeat(72));

for (const route of ROUTES) {
  const url = BASE + route.path;
  let probe = null;
  let error = null;

  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!resp || !resp.ok()) {
      error = `HTTP ${resp ? resp.status() : "no response"}`;
    } else {
      // Wait for the expect'd landmark so we measure a rendered screen, not a
      // loading state.
      await page.waitForSelector(route.expect, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      probe = await page.evaluate(PROBE);
    }
  } catch (e) {
    error = e.message.split("\n")[0];
  }

  const shot = resolve(OUT, `320-${route.name}.png`);
  if (!error) {
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  }

  const problems = [];
  if (error) problems.push(`LOAD FAILED: ${error}`);
  if (probe) {
    if (probe.overflow) {
      problems.push(
        `HORIZONTAL OVERFLOW: page is ${probe.overflow.overBy}px wider than the viewport ` +
          `(${probe.overflow.scrollWidth} > ${probe.overflow.clientWidth})`,
      );
    }
    const realSmall = probe.smallTargets.filter((t) => !t.exemptInlineLink);
    if (realSmall.length) {
      problems.push(
        `TAP TARGETS under ${MIN_TAP}px: ` +
          realSmall.map((t) => `${t.tag}=${t.w}x${t.h}px "${t.text}"`).join("; "),
      );
    }
    if (probe.clipped.length) {
      problems.push(
        `CLIPPED TEXT: ` +
          probe.clipped.map((c) => `${c.tag} "${c.text}" (${c.scrollW}>${c.clientW})`).join("; "),
      );
    }
    if (probe.overlaps.length) {
      problems.push(
        `OVERLAPPING SIBLINGS: ` +
          probe.overlaps.map((o) => `${o.a} ∩ ${o.b} (${o.overlapW}x${o.overlapH}px)`).join("; "),
      );
    }
    if (probe.tinyText.length) {
      problems.push(
        `BODY TEXT under ${MIN_BODY_FONT}px: ` +
          probe.tinyText.map((t) => `${t.fontPx}px "${t.text}"`).join("; "),
      );
    }
  }

  const status = problems.length ? "FAIL" : "PASS";
  if (problems.length) failures++;

  console.log(`\n[${status}] ${route.path}`);
  console.log(`       screenshot: tests/qa/artifacts/320-${route.name}.png`);
  if (probe) {
    const inlineExempt = probe.smallTargets.filter((t) => t.exemptInlineLink).length;
    console.log(
      `       overflow=${probe.overflow ? "YES" : "no"}  ` +
        `small-targets=${probe.smallTargets.length - inlineExempt}` +
        (inlineExempt ? ` (+${inlineExempt} inline links exempt)` : "") +
        `  clipped=${probe.clipped.length}  overlaps=${probe.overlaps.length}  ` +
        `tiny-text=${probe.tinyText.length}`,
    );
  }
  for (const p of problems) console.log(`       ✗ ${p}`);

  results.push({ route: route.path, status, problems, probe, error });
}

// The harness must not leave participant data behind for someone else to find,
// and must not delete it itself. It reports what it made so the erasure is a
// deliberate act performed with the approved mechanism.
if (participantId) {
  console.log("\n" + "-".repeat(72));
  console.log("CLEANUP REQUIRED — this run created one participant:");
  console.log(`  participant: ${participantId}`);
  console.log(`  session:     ${sessionId}`);
  console.log("  Erase it with the approved mechanism (NOT a raw DELETE):");
  console.log(
    `    SELECT erase_participant('${participantId}'::uuid, '320px QA run', 'qa harness');`,
  );
}

await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  viewport: { width: 320, height: 568, device: "iPhone SE", isMobile: true, hasTouch: true, dpr: 2 },
  thresholds: { minTapPx: MIN_TAP, minBodyFontPx: MIN_BODY_FONT },
  created: { participantId, sessionId },
  summary: {
    routes: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: failures,
    skipped: skipped.length,
  },
  skipped,
  results,
};
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log("\n" + "=".repeat(72));
console.log(`RESULT: ${report.summary.passed}/${report.summary.routes} routes pass at 320px`);
if (skipped.length) {
  // A skipped route is a HOLE IN THE EVIDENCE, not a pass. Printed loudly for
  // the same reason the analytics gap table exists: silence would read as
  // coverage.
  console.log(`NOT MEASURED (${skipped.length}) — this is a gap, not a pass:`);
  for (const s of skipped) console.log(`  ✗ ${s.what}: ${s.why}`);
}
console.log(`Report: tests/qa/artifacts/report.json`);
console.log(`\nSCOPE — what this does NOT cover, stated rather than implied:`);
console.log(`  • NOT the Snapshot or synthesis-reveal screens. Both need a COMPLETED`);
console.log(`    session, which this harness does not create — it would have to answer`);
console.log(`    all 31 items and then erase the result. That is the most important`);
console.log(`    unmeasured surface and should be added before pilot sign-off.`);
console.log(`  • Chrome only. WebKit/Safari can differ on text metrics, and iOS Safari`);
console.log(`    is the browser a 320px participant is most likely holding.`);
console.log(`  • does not test enlarged system text (Dynamic Type / 200% zoom), which`);
console.log(`    is the accessibility case most likely to break a fixed-width layout.`);
console.log(`  • measures four failure modes at one width — it is not a general claim`);
console.log(`    that the layout is correct, and a PASS is not a substitute for`);
console.log(`    reading the screenshots in tests/qa/artifacts/.\n`);

process.exit(failures > 0 ? 1 : 0);
