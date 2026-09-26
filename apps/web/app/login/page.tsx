import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PledgeCheck" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-1">
        <p className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">PledgeCheck</p>
        <h1 className="text-2xl font-semibold tracking-tight">Clinic sign in</h1>
        <p className="text-sm text-muted-foreground">For prescribers and clinic staff.</p>
      </header>
      <LoginForm />
    </main>
  );
}
