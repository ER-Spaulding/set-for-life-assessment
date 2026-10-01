"use client";

// `prefers-reduced-motion`, as a hook.
//
// WHY THIS EXISTS AS A HOOK RATHER THAN TAILWIND'S `motion-reduce:` VARIANTS.
//
// Both the synthesis reveal (Addendum 01 v1.1 §4.4) and the Money Moments
// (Addendum 02 v1.1 §12) must drop SPATIAL MOVEMENT under reduced motion while
// keeping a crossfade. The obvious approach is Tailwind's `motion-reduce:`
// classes — but both components animate with inline styles, and an inline
// `style` attribute beats a class. So `motion-reduce:translate-y-0` would be
// silently overridden by `style={{ transform: ... }}` and the reduced-motion
// path would never run. The bug is invisible in review and invisible in a
// screenshot; it only shows up for the participants who asked for it.
//
// Reading the media query in JS and choosing the value once removes the
// conflict entirely: there is exactly one source of truth for the transform.
//
// SSR-SAFE. The initial state is `true` (treat as reduced) so the server-
// rendered first paint is the MOTIONLESS composition. A participant who has
// reduced motion never sees a frame of movement, and everyone else upgrades one
// tick after mount — which is also the frame where the entrance transition
// starts, so nothing is lost.

import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return reduced;
}
