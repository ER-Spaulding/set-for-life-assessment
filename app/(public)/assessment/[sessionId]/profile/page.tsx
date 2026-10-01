"use client";

// Demographics / Participant Profile — the route.
//
// Placed BEFORE the Snapshot and AFTER the 31 required responses, which is the
// only ordering that works: `demographics` is frozen on completion
// (trg_demographics_immutable), so a write after the Snapshot would be refused.
//
// The screen is entirely optional and its skip path goes straight on. Nothing
// here gates the Snapshot — the participant has already answered everything the
// assessment needs.

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DemographicsScreen } from "@/components/profile/DemographicsScreen";

export default function ProfilePage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toSnapshot = useCallback(() => {
    router.push(`/assessment/${params.sessionId}/complete`);
  }, [router, params.sessionId]);

  const submit = useCallback(
    async (values: {
      ageRange: string | null;
      gender: string | null;
      genderSelfDescribe: string | null;
      householdIncome: string | null;
      stateCode: string | null;
    }) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/participant/demographics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: params.sessionId, ...values }),
        });
        if (!res.ok) {
          // Saving profile data is optional, so a failure must not trap the
          // participant here. The message says so and the snapshot path stays
          // open — losing an optional answer is not worth blocking results.
          setError(
            "We could not save those just now. You can continue — they are optional.",
          );
          setSaving(false);
          return;
        }
        toSnapshot();
      } catch {
        setError(
          "We could not save those just now. You can continue — they are optional.",
        );
        setSaving(false);
      }
    },
    [params.sessionId, toSnapshot],
  );

  return (
    <DemographicsScreen
      saving={saving}
      error={error}
      onSubmit={(values) => void submit(values)}
      onSkip={toSnapshot}
    />
  );
}
