// Patient capture page at /t/[token]. Owner: Labib (ticket L1).
//
// Server component: it validates the one-time link and hands the client
// component only what the patient needs. The link is never marked used here;
// POST /api/submissions claims it, so opening the page twice is harmless.

import { checkToken } from "@/lib/fraud/token";
import { serviceClient } from "@/lib/supabase/server";
import type { Language } from "@/lib/voice";
import { CaptureFlow } from "./capture-flow";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = serviceClient();
  const check = await checkToken(db, token, new Date());

  if (!check.ok) return <LinkProblem failure={check.failure} />;

  const { data } = await db
    .from("patients")
    .select("language")
    .eq("id", check.request.patient_id)
    .maybeSingle();

  const language = ((data as { language?: Language } | null)?.language ?? "en") as Language;

  return (
    <CaptureFlow
      token={token}
      challengeCode={check.request.challenge_code}
      language={language}
    />
  );
}

function LinkProblem({ failure }: { failure: "not_found" | "expired" | "already_used" }) {
  const message = {
    not_found: "This link is not valid. Ask your clinic for a new one.",
    expired: "This link has expired. Ask your clinic for a new one.",
    already_used: "This link was already used. Ask your clinic for a new one.",
  }[failure];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-widest text-[var(--color-brand)] uppercase">
        PledgeCheck
      </p>
      <h1 className="text-2xl font-semibold">This link cannot be used</h1>
      <p className="text-[var(--color-muted)]">{message}</p>
    </main>
  );
}
