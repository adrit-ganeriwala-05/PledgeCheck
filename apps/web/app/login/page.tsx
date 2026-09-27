import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PledgeCheck" };

export default function LoginPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-16">
      <div className="relative w-full max-w-sm space-y-8">
        <Link href="/" className="inline-block rounded-md" aria-label="PledgeCheck home">
          <Wordmark />
        </Link>
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold">Clinic sign in</h1>
          <p className="text-sm text-haze">For prescribers and clinic staff.</p>
        </header>
        <LoginForm />
      </div>
    </main>
  );
}
