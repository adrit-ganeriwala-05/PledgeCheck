"use client";

// Patient sign-in. Used on /portal/login and inline on a test link when the patient isn't signed
// in, so the link never has to travel through a login URL.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { patientSignIn } from "@/lib/api/client";

import { FIELD_CLASS } from "./auth-shell";

export type SignInCopy = {
  email: string;
  password: string;
  submit: string;
  submitting: string;
  /** One message for every credential failure, so the form never reveals whether an email has an account. */
  badCredentials: string;
  unreachable: string;
};

export const SIGN_IN_COPY: SignInCopy = {
  email: "Email",
  password: "Password",
  submit: "Sign in",
  submitting: "Signing in…",
  badCredentials: "Email or password is incorrect.",
  unreachable: "Could not reach the sign-in service. Check your connection and try again.",
};

export function PatientSignInForm({
  next = "/portal",
  onSignedIn,
  showSignUpLink = true,
  copy = SIGN_IN_COPY,
}: {
  /** A path already checked with safeNextPath. Ignored when onSignedIn is given. */
  next?: string;
  onSignedIn?: () => void;
  showSignUpLink?: boolean;
  copy?: SignInCopy;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await patientSignIn(String(form.get("email") ?? "").trim(), String(form.get("password") ?? ""));
    if (!result.ok) {
      setError(result.error.code === "bad_credentials" ? copy.badCredentials : copy.unreachable);
      setPending(false);
      return;
    }
    if (onSignedIn) {
      setPending(false);
      onSignedIn();
      return;
    }
    router.replace(next);
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-mist">
          {copy.email}
          <input name="email" type="email" autoComplete="email" required className={FIELD_CLASS} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-mist">
          {copy.password}
          <input name="password" type="password" autoComplete="current-password" required className={FIELD_CLASS} />
        </label>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" size="lg" variant="brand" className="mt-1 h-12 text-base" disabled={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </form>
      {showSignUpLink ? (
        <p className="text-sm text-haze">
          New to PledgeCheck?{" "}
          <Link href="/portal/signup" className="font-medium text-orchid-text underline">
            Create your account
          </Link>{" "}
          with the code from your clinic.
        </p>
      ) : null}
    </div>
  );
}
