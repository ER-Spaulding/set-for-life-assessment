// UIUX §8 S01 — Arrival / Opening.
//
// "Editorial statement + concise purpose + Begin My Assessment."
//
// This is the participant's first impression and §25 sets the register:
// "premium editorial rather than generic SaaS quiz". So: a large Playfair
// declaration, a short reason to continue, and one action. No feature list, no
// testimonial, no urgency, no countdown.
//
// ALLURA APPEARS ONCE, on the closing brand line, per the font rule that it is
// reserved for "short handwritten brand accents" and never body copy. A single
// accent is what makes it read as a signature rather than decoration.
//
// This is a server component: it renders no state and needs no client bundle.

import Link from "next/link";

export default function Home() {
  return (
    <main className="surface-ivory flex min-h-screen w-full flex-col px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[1080px]">
        <p
          className="font-display text-evergreen"
          style={{ fontSize: "20px", lineHeight: "26px" }}
        >
          Set for Life
        </p>
        <div className="mt-3 w-full border-t border-blush" aria-hidden="true" />

        <h1
          className="mt-20 font-display text-evergreen"
          style={{ fontSize: "var(--type-t01-size)", lineHeight: "var(--type-t01-line)" }}
        >
          A clearer picture of where you stand.
        </h1>

        <p
          className="prose-measure mt-10 font-serif text-obsidian"
          style={{ fontSize: "var(--type-t07-size)", lineHeight: "var(--type-t07-line)" }}
        >
          Thirty-one questions about how you see, direct, and prepare with your
          money. At the end you receive a Financial Snapshot — a written
          account of what your answers show, in plain language.
        </p>

        <p
          className="prose-measure mt-6 font-body text-obsidian"
          style={{ fontSize: "18px", lineHeight: "29px" }}
        >
          There are no right answers, and nothing here is a test. Your responses
          are saved as you go, so you can stop and return.
        </p>

        <div className="mt-16">
          <Link
            href="/assessment/start"
            className="inline-block bg-evergreen px-10 py-5 font-serif text-ivory transition-colors hover:bg-evergreen/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen"
            style={{
              fontSize: "var(--type-t13-size)",
              lineHeight: "var(--type-t13-line)",
              borderRadius: "2px",
              minHeight: "56px",
            }}
          >
            Begin My Assessment
          </Link>
        </div>

        <p
          className="mt-24 font-script text-rose"
          style={{ fontSize: "var(--type-t15-size)", lineHeight: "var(--type-t15-line)" }}
        >
          Set for Life
        </p>
      </div>
    </main>
  );
}
