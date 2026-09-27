"use client";

// Where a confirmation email lands. Owner: Labib.
//
// Supabase verifies the token on its own domain and then redirects here with the session
// in the URL *fragment*. Two things follow from that, and both have bitten us:
//
//   * A fragment never survives an HTTP redirect. If the address the email points at
//     forwards anywhere (pledgecheck.tech currently 302s to vercel.app), the tokens are
//     silently dropped and the link looks broken. The signup call sets emailRedirectTo to
//     this page on the current origin so there is no hop in between.
//   * The fragment is read by the browser client, not the server, so this has to be a
//     client component that instantiates one. Creating the client is what triggers
//     detectSessionInUrl.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function ConfirmPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // detectSessionInUrl resolves asynchronously, so ask rather than assume.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) router.replace("/portal");
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {failed ? "That link did not work" : "Confirming…"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {failed
          ? "The link may have expired or already been used. Sign in with your email and password instead."
          : "One moment."}
      </p>
      {failed && (
        <a href="/portal/login" className="text-sm underline">
          Go to sign in
        </a>
      )}
    </main>
  );
}
