import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PledgeCheck" };

export default function LoginPage() {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm space-y-8">
          <Link href="/" className="inline-block rounded-md" aria-label="PledgeCheck home">
            <Wordmark />
          </Link>
          <header className="space-y-2">
            <h1 className="text-4xl font-semibold">Clinic sign in</h1>
            <p className="text-sm text-haze">For prescribers and clinic staff.</p>
          </header>
          <LoginForm />
        </div>
      </div>
      {/* The same test as the landing page, as a still: brand continuity without a live canvas. */}
      <div className="relative hidden items-center overflow-hidden border-l border-line lg:flex">
        <Image
          src="/brand/test-hero.webp"
          alt=""
          width={2400}
          height={1800}
          priority
          sizes="55vw"
          className="w-full scale-110 object-contain"
        />
      </div>
    </main>
  );
}
