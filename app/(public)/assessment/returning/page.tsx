// UIUX §8 S00B — returning-participant verification.
//
// Same reasoning as `/assessment/new`: the returning path is a step inside
// `/assessment/start`, and this route survives as a redirect for direct links.

import { redirect } from "next/navigation";

export default function ReturningPage() {
  redirect("/assessment/start");
}
