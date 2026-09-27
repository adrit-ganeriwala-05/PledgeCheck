"use client";

// Where a password-recovery email lands. Owner: Labib.
//
// The recovery link is not the reset. Supabase verifies the token on its own domain, redirects
// here and signs the patient in; the password itself is unchanged until something calls
// updateUser. Nothing did, and the link pointed at /portal, which has no form — so recovery
// looked like it worked and never changed a password. This screen is that missing step.
//
// Client-side on purpose, for the same reason as /portal/confirm: the session arrives in the
// URL (a `code` query for the PKCE flow, a `#access_token` fragment for the implicit one) and
// only the browser client can pick it up. Creating the client is what triggers
// detectSessionInUrl, so the session is waited for rather than assumed.

import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  FormError,
  PasswordField,
  SubmitButton,
  checkPresent,
  focusField,
  useFieldErrors,
} from "@/components/entry/fields";
import { Button } from "@/components/ui/button";
import { setNewPassword } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";

import { PASSWORD_MIN } from "./signup-form";

export const RESET_COPY = {
  checking: "Checking your link…",
  title: "Choose a new password",
  lead: "This link signed you in. Set a new password to finish.",
  deadTitle: "That reset link didn't work",
  deadLead:
    "It may have expired, or already been used. Reset links last one hour. Ask for a new one and open it on this device.",
  doneTitle: "Your password is set",
  doneLead: "You're signed in. Use your new password next time.",
  mismatch: "Both passwords must match.",
  confirmMissing: "Confirm your new password.",
  weak: `Choose a password of at least ${PASSWORD_MIN} characters.`,
  samePassword: "That's your current password. Choose a different one.",
  noSession: "Your reset link has expired. Ask for a new one.",
  unreachable: "Could not reach PledgeCheck. Check your connection and try again.",
} as const;

function checkPassword(value: string): string | null {
  return value.length < PASSWORD_MIN ? RESET_COPY.weak : null;
}

type Phase = "checking" | "ready" | "dead" | "done";

export function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const fields = useFieldErrors({
    password: checkPassword,
    confirm: checkPresent(RESET_COPY.confirmMissing),
  });

  // Wait for the recovery session the link carries. onAuthStateChange is here because
  // detectSessionInUrl can finish after the first getSession, and PASSWORD_RECOVERY is the
  // event Supabase fires for exactly this case.
  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    const accept = () => {
      if (settled) return;
      settled = true;
      setPhase("ready");
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) accept();
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) accept();
        // No session yet: the URL may still be in flight, so give it a moment before saying
        // the link is dead. The subscription above settles it if it lands.
        else setTimeout(() => !settled && ((settled = true), setPhase("dead")), 2500);
      })
      .catch(() => !settled && ((settled = true), setPhase("dead")));

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const invalid = fields.validate(form);
    if (invalid) {
      focusField(form, invalid);
      return;
    }
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirm") ?? "")) {
      fields.set("confirm", RESET_COPY.mismatch);
      focusField(form, "confirm");
      return;
    }

    busy.current = true;
    setPending(true);
    setProblem(null);
    const result = await setNewPassword(password);
    busy.current = false;
    setPending(false);

    if (result.ok) {
      setPhase("done");
      // The recovery session is a real session, so the portal is reachable straight away.
      router.replace("/portal");
      return;
    }
    const code = result.error.code;
    setProblem(
      code === "weak_password"
        ? RESET_COPY.weak
        : code === "same_password"
          ? RESET_COPY.samePassword
          : code === "no_session"
            ? RESET_COPY.noSession
            : RESET_COPY.unreachable,
    );
  }

  if (phase === "checking") {
    return (
      <Shell title={RESET_COPY.checking}>
        <p className="text-haze" role="status">
          One moment.
        </p>
      </Shell>
    );
  }

  if (phase === "dead") {
    return (
      <Shell title={RESET_COPY.deadTitle}>
        <p className="text-lg leading-relaxed text-mist/90">{RESET_COPY.deadLead}</p>
        <Button asChild variant="outline" size="lg" className="h-12 w-full rounded-2xl">
          <a href="/portal/login">Back to sign in</a>
        </Button>
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell title={RESET_COPY.doneTitle}>
        <p className="flex items-center gap-2 text-lg text-mist/90" role="status">
          <CheckCircle2Icon className="size-5 text-ok" aria-hidden />
          {RESET_COPY.doneLead}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={RESET_COPY.title}>
      <p className="text-lg leading-relaxed text-mist/90">{RESET_COPY.lead}</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          {...fields.bind("password")}
        />
        <PasswordField
          label="Confirm new password"
          name="confirm"
          autoComplete="new-password"
          required
          {...fields.bind("confirm")}
        />
        <FormError>{problem}</FormError>
        <SubmitButton pending={pending} label="Set password" pendingLabel="Saving…" className="mt-1" />
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-5 py-16">
      <h1 className="text-[2rem] leading-tight font-semibold">{title}</h1>
      {children}
    </main>
  );
}
