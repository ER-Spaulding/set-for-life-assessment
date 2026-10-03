// Addendum 01 v1.1 §6, §9, §14, §20 — the participant-facing results view.
//
// SERVER-SIDE PRESENTATION ONLY. This component receives the SHARED
// content/section model (`SnapshotSection[]`, produced by
// `resolveSnapshotContent(payload)` in lib/render/snapshot-sections.ts from the
// stored immutable Snapshot payload) and renders it. It does NO resolution of
// its own: every NARRATIVE string and every module's existence and heading
// arrive already decided in the shared model, and this file contains no scoring,
// no interpretation, no key→copy lookup of narrative copy. Its only job is to
// lay out the shared model's blocks in the approved module order, applying the
// web medium's typography.
//
// THE SHARED MODEL IS THE CLIENT BOUNDARY. This component and everything below
// it are server-rendered: the only thing that reaches the browser is the
// participant-facing HTML. Internal fields — `state`, `specialState`,
// `displayState`, `evidence`, `openingB`, `moveSubsignals`, `classifierTags`,
// tension codes, signal codes — never appear here and never serialize. The
// shared model carries the resolved copy and the renderer only ever prints
// `kicker`/`label`/`body` strings.
//
// COPY PROVENANCE — each participant-facing string has ONE canonical source:
//   - the eight content SECTION HEADINGS resolve in the SHARED model
//     (lib/render/snapshot-sections.ts) from config/report-v1.0.json screens[] —
//     this file renders `section.heading` verbatim, never re-authoring a title.
//   - the cover kicker/lead and the continuation options still resolve here from
//     config/report-v1.0.json (web-only chrome with no PDF counterpart to drift
//     against).
//   - NARRATIVE copy (signal states, connection statements, attention areas,
//     activation) arrives already resolved inside the shared model's blocks.
//   - the four ACTIVATION DIMENSION LABELS (Urgency / Readiness / Commitment /
//     Support Readiness) arrive inside the shared model's `activation` blocks —
//     this file holds NO label map of its own.
//   - the educational DISCLOSURE and the PDF cover/footer copy live in
//     lib/ui/snapshot-doc-copy.ts (fixed-by-ruling document furniture).
//   - the download CTA label lives in lib/ui/snapshot-copy.ts.
//   - the standalone brand mark consumes lib/brand.ts BRAND_NAME.

import type { SnapshotSection } from "@/lib/render/snapshot-sections";
import reportConfig from "@/config/report-v1.0.json";
import { BRAND_NAME } from "@/lib/brand";
import { SNAPSHOT_DISCLOSURE } from "@/lib/ui/snapshot-doc-copy";
import { DownloadButton } from "./DownloadButton";

interface ReportScreen {
  id: string;
  title: string;
  lead?: string;
  continuation_options?: Array<{ code: string; label: string }>;
}

const SCREENS = reportConfig.screens as unknown as ReportScreen[];

/** The exact approved title for a screen, from the report config (single source). */
function screenTitle(id: string): string {
  return SCREENS.find((screen) => screen.id === id)?.title ?? "";
}

/** The cover lead (owner ruling 2), from the report config cover screen. */
const COVER_LEAD = SCREENS.find((screen) => screen.id === "cover")?.lead ?? "";

/** Module 13 — the approved continuation paths, from the report config. */
const CONTINUATION_OPTIONS =
  SCREENS.find((screen) => screen.id === "continuation")?.continuation_options ?? [];

export function SnapshotResults({
  sections,
  sessionId,
}: {
  sections: SnapshotSection[];
  sessionId?: string;
}) {
  return (
    <Shell>
      {/* S12 — cover / big picture. §14: oversized editorial declaration. */}
      <header className="mb-20">
        <p
          className="font-body text-rose"
          style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
        >
          {screenTitle("cover")}
        </p>
        <h1
          className="mt-6 font-display text-evergreen"
          style={{ fontSize: "var(--type-t01-size)", lineHeight: "var(--type-t01-line)" }}
        >
          {COVER_LEAD}
        </h1>
      </header>

      {sections.map((section) => {
        if (section.id === "big-picture") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-6">
                {section.blocks.map((block, i) => (
                  <p
                    key={i}
                    className="prose-measure font-body text-obsidian"
                    style={{ fontSize: "18px", lineHeight: "29px" }}
                  >
                    {block.body}
                  </p>
                ))}
              </div>
            </Section>
          );
        }

        if (section.id === "money-picture") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-16">
                {section.blocks.map((block, i) => (
                  <article key={i}>
                    <p
                      className="font-body text-rose"
                      style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
                    >
                      {block.kicker}
                    </p>
                    <h3
                      className="mt-3 font-serif text-evergreen"
                      style={{
                        fontSize: "var(--type-t10-size)",
                        lineHeight: "var(--type-t10-line)",
                      }}
                    >
                      {block.label}
                    </h3>
                    <p
                      className="prose-measure mt-4 font-body text-obsidian"
                      style={{ fontSize: "18px", lineHeight: "29px" }}
                    >
                      {block.body}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          );
        }

        if (section.id === "strengths") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-14">
                {section.blocks.map((block, i) => (
                  <article key={i}>
                    <h3
                      className="font-display text-evergreen"
                      style={{
                        fontSize: "var(--type-t04-size)",
                        lineHeight: "var(--type-t04-line)",
                      }}
                    >
                      {block.label}
                    </h3>
                    <p
                      className="prose-measure mt-5 font-body text-obsidian"
                      style={{ fontSize: "18px", lineHeight: "29px" }}
                    >
                      {block.body}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          );
        }

        if (section.id === "friction") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-14">
                {section.blocks.map((block, i) => (
                  <article key={i}>
                    <h3
                      className="font-display text-terracotta"
                      style={{
                        fontSize: "var(--type-t04-size)",
                        lineHeight: "var(--type-t04-line)",
                      }}
                    >
                      {block.label}
                    </h3>
                    <p
                      className="prose-measure mt-5 font-body text-obsidian"
                      style={{ fontSize: "18px", lineHeight: "29px" }}
                    >
                      {block.body}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          );
        }

        if (section.id === "connection") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-14">
                {section.blocks.map((block, i) => (
                  <article key={i}>
                    <h3
                      className="font-display text-terracotta"
                      style={{
                        fontSize: "var(--type-t04-size)",
                        lineHeight: "var(--type-t04-line)",
                      }}
                    >
                      {block.label}
                    </h3>
                    <p
                      className="prose-measure mt-5 font-body text-obsidian"
                      style={{ fontSize: "18px", lineHeight: "29px" }}
                    >
                      {block.body}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          );
        }

        if (section.id === "destination") {
          return (
            <Section key={section.id} title={section.heading}>
              <ul className="flex flex-col gap-4">
                {section.blocks.map((block, i) => (
                  <li
                    key={i}
                    className="font-body text-obsidian"
                    style={{ fontSize: "18px", lineHeight: "29px" }}
                  >
                    {block.body}
                  </li>
                ))}
              </ul>
            </Section>
          );
        }

        if (section.id === "readiness") {
          return (
            <Section key={section.id} title={section.heading}>
              <div className="flex flex-col gap-14">
                {section.blocks.map((block, i) => (
                  <article key={i}>
                    <h3
                      className="font-serif text-evergreen"
                      style={{
                        fontSize: "var(--type-t10-size)",
                        lineHeight: "var(--type-t10-line)",
                      }}
                    >
                      {block.label}
                    </h3>
                    <p
                      className="prose-measure mt-4 font-body text-obsidian"
                      style={{ fontSize: "18px", lineHeight: "29px" }}
                    >
                      {block.body}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          );
        }

        // attention — primary area with visual priority, optional subordinate
        // secondary (variant marks the resolver's selection; the heading level is
        // the only layout difference).
        const primary = section.blocks.find((block) => block.variant === "primary");
        const secondary = section.blocks.find((block) => block.variant === "secondary");
        return (
          <Section key={section.id} title={section.heading}>
            {primary ? (
              <>
                <h3
                  className="font-display text-evergreen"
                  style={{
                    fontSize: "var(--type-t02-size)",
                    lineHeight: "var(--type-t02-line)",
                  }}
                >
                  {primary.label}
                </h3>
                <p
                  className="prose-measure mt-6 font-body text-obsidian"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {primary.body}
                </p>
              </>
            ) : null}
            {secondary ? (
              <div className="mt-12">
                <h4
                  className="font-serif text-evergreen"
                  style={{
                    fontSize: "var(--type-t10-size)",
                    lineHeight: "var(--type-t10-line)",
                  }}
                >
                  {secondary.label}
                </h4>
                <p
                  className="prose-measure mt-3 font-body text-obsidian"
                  style={{ fontSize: "18px", lineHeight: "29px" }}
                >
                  {secondary.body}
                </p>
              </div>
            ) : null}
          </Section>
        );
      })}

      {/* Module 12 — the signed PDF download affordance (approved CTA label). */}
      {sessionId ? <DownloadButton sessionId={sessionId} /> : null}

      {/* Module 13 — You Decide What Happens Next. Wired from the approved
          report config (id "continuation"); no invented language. */}
      {CONTINUATION_OPTIONS.length > 0 ? (
        <Section title={screenTitle("continuation")}>
          <ul className="flex flex-col gap-4">
            {CONTINUATION_OPTIONS.map((option) => (
              <li
                key={option.code}
                className="font-body text-obsidian"
                style={{ fontSize: "18px", lineHeight: "29px" }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="mt-24">
        <p
          className="font-script text-rose"
          style={{ fontSize: "var(--type-t15-size)", lineHeight: "var(--type-t15-line)" }}
        >
          {BRAND_NAME}
        </p>
      </footer>

      {/* Module 14 — the approved educational disclosure, rendered on the web
          results and in the PDF from the same single source in
          lib/ui/snapshot-doc-copy.ts. */}
      <p
        className="prose-measure mt-10 font-body text-obsidian"
        style={{ fontSize: "13px", lineHeight: "20px" }}
      >
        {SNAPSHOT_DISCLOSURE}
      </p>
    </Shell>
  );
}

/** Shared page frame: ivory surface, 1080px max, generous vertical rhythm. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="surface-ivory min-h-screen w-full px-6 py-16 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[1080px]">{children}</div>
    </main>
  );
}

/** A titled section. Thin warm rule above the heading, per §14. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <div className="border-t border-blush pt-8" aria-hidden="true" />
      <h2
        className="mb-10 font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px", letterSpacing: "0.08em" }}
      >
        {title.toUpperCase()}
      </h2>
      {children}
    </section>
  );
}
