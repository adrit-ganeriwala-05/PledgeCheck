import type { Metadata } from "next";

import { PortalAuthForm } from "../portal-auth-form";

export const metadata: Metadata = { title: "Sign in · PledgeCheck" };

export default function PortalLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-1">
        <p className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">PledgeCheck</p>
        <h1 className="text-2xl font-semibold tracking-tight">Patient sign in</h1>
        <p className="text-sm text-muted-foreground">
          To see your refills and test results. Your clinic must add you before you can see your record.
        </p>
      </header>
      <PortalAuthForm />
    </main>
  );
}
