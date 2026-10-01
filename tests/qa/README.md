# 320px device-level QA

`npm run qa:320` — requires a running server (`npm run dev`) and Playwright.

```bash
npm i -g playwright && npx playwright install chromium   # once
npm run dev &
npm run qa:320
```

## Why this exists

The operator's instruction was that responsive-by-construction would not count:

> "Add actual 320px viewport/device-level QA before pilot sign-off.
>  Responsive-by-construction is not sufficient evidence of verification."

So this drives a real browser at 320×568, mobile, touch, DPR 2, and measures the
rendered result. It asserts four failure modes:

1. **horizontal overflow** — the page body scrolling sideways
2. **undersized tap targets** — below 44×44 CSS px (WCAG 2.2 SC 2.5.8)
3. **clipped text** — content wider/taller than its own box under `overflow: hidden`
4. **overlapping siblings** and **body text below 16px**

## What it found

It caught a real defect on its first run: the "Back" control on the returning
screen rendered at **38×28px**, below the 44px thumb floor, on the only exit from
a dead-end screen. Fixed in `app/(public)/assessment/returning/page.tsx`.

## Two false positives it produced, and how they were fixed

The first version reported failures that were **not** defects: `sr-only` radio
inputs (1×1px by design — the visible card is the label) and `sr-only` progress
text (clipped on purpose for screen readers). A harness that reports non-bugs
trains you to ignore it, so the probe now excludes visually-hidden elements.

That exclusion needed its own proof, so it was mutation-tested: removing
`sr-only` from a radio leaves a genuinely visible 13×13px control, which the
harness still catches. The exclusion is not blanket blindness.

## The artifact this leaves

Screenshots and `report.json` go to `tests/qa/artifacts/`. **The screenshots are
the point** — a green checkmark says four specific things are fine, not that the
screen looks right. Read them.

## Cleanup

The harness creates one provisional participant to measure the assessment and
demographics screens. It **reports** that participant id and does not delete
anything — erasure is an audited act, not a test side effect. Erase with:

```sql
SELECT erase_participant('<participant-id>'::uuid, '320px QA run', 'qa harness');
```

## Known gaps

- **The Snapshot and synthesis-reveal screens are not measured.** They need a
  completed session, which this harness deliberately does not create. This is
  the most important unmeasured surface.
- **Chrome only.** WebKit/Safari can differ on text metrics.
- **No enlarged-text pass** (Dynamic Type / 200% zoom).
