// Signed in, but no clinicians row (e.g. a future drug-maker account). Such users see
// nothing under RLS; this page says so instead of showing empty screens.
import type { Metadata } from "next";

import { SignOutButton } from "@/components/clinic/sign-out-button";

export const metadata: Metadata = { title: "No clinic access · PledgeCheck" };

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">No clinic access for this account</h1>
      <p className="text-sm text-muted-foreground">
        This account is not linked to a clinic. Ask your practice administrator to add you, or sign in with a
        different account.
      </p>
      <SignOutButton />
    </main>
  );
}
