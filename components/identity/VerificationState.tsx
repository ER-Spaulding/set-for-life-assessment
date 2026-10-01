// UIUX §8A — the verification screen.
//
// "Quiet, minimal, with a SINGLE message that a secure link/code was sent.
// Avoid exposing whether an unverified email exists in the database."
//
// That last clause is why this component takes NO indication of whether the
// address is known. The route returns an identical 202 for new and existing
// addresses (§7.3, anti-enumeration), and the surest way to preserve that is
// for this screen to have nothing to branch on — no `isNew` prop, no variant.
//
// The wording is conditional for the same reason: "If that email can be used"
// rather than "We've sent a link to X", which would assert the address exists.

export function VerificationState({ email }: { email?: string }) {
  return (
    <div className="max-w-[720px]">
      <p
        className="font-display text-evergreen"
        style={{ fontSize: "var(--type-t03-size)", lineHeight: "var(--type-t03-line)" }}
      >
        Check your email
      </p>
      <p
        className="prose-measure mt-6 font-body text-obsidian"
        style={{ fontSize: "18px", lineHeight: "29px" }}
      >
        If that email can be used with the assessment, a verification link is
        on its way. Open it to continue.
      </p>
      <p
        className="prose-measure mt-4 font-body text-rose"
        style={{ fontSize: "16px", lineHeight: "24px" }}
      >
        The link expires in 30 minutes. If it does not arrive, check your spam
        folder, or return here and try again.
      </p>
      {email ? (
        // Echoing the address back helps someone spot a typo. It reveals
        // nothing — they typed it — and it is the only case where showing the
        // address is safe.
        <p
          className="mt-6 font-body text-obsidian"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          Sent to <span className="text-rose">{email}</span>
        </p>
      ) : null}
    </div>
  );
}
