// UIUX §8 S00A — new-participant identity.
//
// The identity flow lives on `/assessment/start`, which holds the entry choice,
// the identity form and the verification state as one three-step experience.
// This route is kept as a redirect because it appears in the §31 route tree and
// may be linked directly; without it, a bookmark would land on a placeholder.
//
// A server-side redirect, so there is no flash of placeholder content.

import { redirect } from "next/navigation";

export default function NewPage() {
  redirect("/assessment/start");
}
