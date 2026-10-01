import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Addendum 02 v1.1 §4.1 — the returning participant's first-name greeting.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, found while auditing the §18 acceptance
 * criteria. The greeting shipped as:
 *
 *     const [firstName, setFirstName] = useState("");   // never populated
 *     <ResumeCard firstName={firstName || "there"} />
 *
 * `setFirstName` had no call site anywhere in the file. So the fallback ALWAYS
 * won and every returning participant — verified or not, named or not — was
 * greeted:
 *
 *     "Welcome back, there. You have an assessment in progress."
 *
 * §4.1 says flatly: "the first-name welcome is required." The code was not
 * merely missing the name; it was substituting a placeholder that occupies the
 * name's grammatical slot, so it read as a name and no test noticed.
 *
 * WHY THIS IS A SOURCE TEST RATHER THAN A UNIT TEST. The failure was a missing
 * WIRE, not broken logic: `verifiedFirstName` already existed and worked, the
 * route already existed and worked, and the card rendered correctly given a
 * name. Nothing was individually wrong — the name simply never travelled from
 * the database to the heading. A unit test of any single piece passes on the
 * broken code, which is precisely why the defect survived. So this asserts the
 * CONNECTIONS.
 */

const repo = resolve(__dirname, "../..");

/**
 * Comments stripped before matching.
 *
 * NOT COSMETIC. The first version of this file failed on its own fix: the
 * comment recording the old `firstName || "there"` line contains that line as
 * prose, so the placeholder check matched the explanation of the bug rather
 * than the bug. This is the same false-positive that made the analytics
 * `server-only` guard pass while the guard was deleted.
 *
 * Comments are not code. Match against code.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^"'\n]*$/gm, "");
}

const read = (p: string) => stripComments(readFileSync(resolve(repo, p), "utf8"));

describe("§4.1 returning-participant greeting", () => {
  it("no participant-facing string uses a name placeholder", () => {
    // The exact class of bug: a fallback that fills the name slot with
    // something that is not a name.
    const banned = [
      /firstName\s*\|\|\s*["']there["']/,
      /firstName\s*\?\?\s*["']there["']/,
      /firstName\s*\|\|\s*["']friend["']/,
      /firstName\s*\|\|\s*["']Guest["']/,
    ];
    const files = [
      "app/auth/verified/page.tsx",
      "components/identity/ResumeCard.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      for (const re of banned) {
        expect(src, `${f} substitutes a placeholder for the participant's name`).not.toMatch(re);
      }
    }
  });

  it("the greeting omits the name rather than filling the slot", () => {
    // With no verified name the heading must still be a complete, warm sentence.
    const card = read("components/identity/ResumeCard.tsx");
    // The name is interpolated via a derived fragment that is empty when absent.
    expect(card).toMatch(/const name = firstName\?\.trim\(\) \?/);
    expect(card).toMatch(/Welcome back\$\{name\}\./);
    // And it must never render an empty name slot like "Welcome back, ."
    expect(card).not.toMatch(/Welcome back, \$\{firstName\}/);
  });

  it("the name is gated on verification, never on entry", () => {
    // §15: "Do not use a name before it has been reliably associated with the
    // participant." Entry is not verification.
    const service = read("lib/session/service.ts");
    const fn = service.slice(
      service.indexOf("export async function verifiedFirstNameForParticipant"),
    );
    const body = fn.slice(0, fn.indexOf("\n}"));
    // The gate must require a contact row with a non-null verified_at.
    expect(body).toMatch(/participant_contacts/);
    expect(body).toMatch(/verified_at/);
    expect(body).toMatch(/contact_type["'],\s*["']email/);
    // And returning null when the gate fails.
    expect(body).toMatch(/if \(!contact\) return null;/);
  });

  it("exactly one definition of 'verified' serves both callers", () => {
    // The session-shaped helper must DELEGATE rather than re-implement, or the
    // two can drift and the completion path and the greeting path would disagree
    // about who counts as verified.
    const service = read("lib/session/service.ts");
    const sessionFn = service.slice(
      service.indexOf("async function verifiedFirstName("),
      service.indexOf("export async function verifiedFirstNameForParticipant"),
    );
    console.log("  session-shaped helper delegates:", /return verifiedFirstNameForParticipant\(/.test(sessionFn));
    expect(sessionFn).toMatch(/return verifiedFirstNameForParticipant\(db, participantId\)/);
    // It must NOT re-query the contacts table itself.
    expect(sessionFn).not.toMatch(/participant_contacts/);
  });

  it("the name actually reaches the card — the wire is connected", () => {
    // The specific break: a state setter with no writer. Check every link.
    const route = read("app/api/session/resumable/route.ts");
    const page = read("app/auth/verified/page.tsx");
    const card = read("components/identity/ResumeCard.tsx");

    // route: computes and returns it
    expect(route, "route does not return firstName").toMatch(/firstName/);
    expect(route, "route does not gate the name on verification").toMatch(
      /verifiedFirstNameForParticipant/,
    );
    // page: reads it off the response and into state
    expect(page, "page declares firstName state").toMatch(/useState.*firstName|firstName.*useState/);
    expect(
      page,
      "page never calls setFirstName — this is the exact defect (a state setter with no writer)",
    ).toMatch(/setFirstName\(/);
    // page: passes it through
    expect(page, "page does not pass firstName to the card").toMatch(/firstName=\{/);
    // card: renders it
    expect(card, "card does not use firstName in the heading").toMatch(/firstName/);
  });
});
