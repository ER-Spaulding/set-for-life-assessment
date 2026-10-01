// UIUX §5 (1)–(2) — the assessment shell's wordmark and divider.
//
// "Small Set for Life wordmark/brand lockup" over "a thin warm-neutral
// divider". Deliberately quiet: the question is the visual hero, so this sits
// at the top and takes almost no attention.
//
// No logo image — the spec asks for a wordmark, and type is sharper and
// scales without a raster asset. `font-display` (Playfair 800) at a small size
// reads as a masthead rather than a heading.

export function BrandHeader() {
  return (
    // Vertical rhythm here is intentional and small: the shell repeats on all
    // 31 screens, so anything generous becomes tiring by the tenth question.
    <header className="w-full">
      <p
        className="font-display text-evergreen"
        style={{ fontSize: "20px", lineHeight: "26px" }}
      >
        Set for Life
      </p>
      {/* Thin warm-neutral rule. Blush is the palette's warm neutral and is
          decorative here — a border, never text. */}
      <div
        className="mt-3 w-full border-t border-blush"
        style={{ borderTopWidth: "1px" }}
        aria-hidden="true"
      />
    </header>
  );
}
