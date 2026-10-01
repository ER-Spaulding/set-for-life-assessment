// UIUX §5 (6) — helper instruction, used only when needed.
//
// MOST QUESTIONS HAVE NO HELPER. §5 lists it as "(6) helper instruction only
// when needed", so a helper on every screen would be noise, and worse, would
// drift toward the coaching §5 forbids elsewhere on the screen.
//
// Set at the body floor (18px) and in Obsidian rather than a lighter tint: a
// helper that is harder to read than the answers defeats its purpose.

import type { ReactNode } from "react";

export function HelperText({ children }: { children: ReactNode }) {
  return (
    <p
      className="prose-measure mt-4 font-body text-obsidian"
      style={{ fontSize: "18px", lineHeight: "29px" }}
    >
      {children}
    </p>
  );
}
