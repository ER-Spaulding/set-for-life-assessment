"use client";

// UIUX §8 S00A — new participant identity.
//
// "Collect First Name, Last Name, Email. Explain the benefit: progress is
// securely saved and the participant can return to the Financial Snapshot.
// DO NOT PRESENT THIS AS NEWSLETTER CAPTURE."
//
// That last clause drives the copy: the explanation names save/resume and the
// Snapshot, and says nothing about updates, insights, or staying in touch.
// There is no marketing opt-in on this screen at all — consent is separate and
// explicit (§24: "Assessment completion, email verification, A4 support
// openness, mobile-number entry, operational messaging permission, and
// promotional marketing consent are separate concepts").
//
// Real <label> elements, not placeholders-as-labels: a placeholder disappears
// on focus, which strands anyone who looks away mid-form.

import { useState } from "react";

export function IdentityForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (values: { firstName: string; lastName: string; email: string }) => void;
  submitting?: boolean;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const ready =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().includes("@");

  const field =
    "mt-2 w-full border border-blush/60 bg-white px-4 py-3 font-body text-obsidian focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evergreen";
  const label = "block font-body text-rose";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !submitting) {
          onSubmit({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
          });
        }
      }}
    >
      <div>
        <label className={label} htmlFor="first-name" style={{ fontSize: "16px", lineHeight: "24px" }}>
          First name
        </label>
        <input
          id="first-name"
          name="firstName"
          autoComplete="given-name"
          className={field}
          style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </div>

      <div>
        <label className={label} htmlFor="last-name" style={{ fontSize: "16px", lineHeight: "24px" }}>
          Last name
        </label>
        <input
          id="last-name"
          name="lastName"
          autoComplete="family-name"
          className={field}
          style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </div>

      <div>
        <label className={label} htmlFor="email" style={{ fontSize: "16px", lineHeight: "24px" }}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className={field}
          style={{ borderRadius: "2px", fontSize: "18px", lineHeight: "29px" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {/* The benefit, stated as save/resume — never as newsletter capture. */}
        <p
          className="prose-measure mt-3 font-body text-obsidian"
          style={{ fontSize: "16px", lineHeight: "24px" }}
        >
          We use your email to save your progress securely and to let you
          return to your Financial Snapshot. We will send you a link to verify
          it before anything is stored.
        </p>
      </div>

      <div>
        <button
          type="submit"
          disabled={!ready || submitting}
          className={[
            "px-8 py-4 font-serif transition-colors",
            !ready || submitting
              ? "cursor-not-allowed bg-evergreen/40 text-ivory"
              : "bg-evergreen text-ivory hover:bg-evergreen/90",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-evergreen",
          ].join(" ")}
          style={{
            fontSize: "var(--type-t13-size)",
            lineHeight: "var(--type-t13-line)",
            borderRadius: "2px",
            minHeight: "56px",
          }}
        >
          {submitting ? "Sending…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
