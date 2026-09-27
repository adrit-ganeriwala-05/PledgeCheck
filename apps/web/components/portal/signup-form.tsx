"use client";

// Patient sign-up (PRD R1): email and password create a Supabase account, then the clinic's
// enrollment code links it to the patient's pseudonymous record. If the code step fails, the
// account already exists, so a retry only repeats the code step. Lives in the patient card
// (components/entry/patient-auth.tsx) as its "Create account" tab.
import { MailCheckIcon } from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { useRef, useState, type FormEvent, type MouseEvent } from "react";

import { useCardSwap } from "@/components/entry/auth-card";
import { useLeaveEntry } from "@/components/entry/entry-context";
import { checkEmail, Field, focusField, FormError, PasswordField, SubmitButton, useFieldErrors } from "@/components/entry/fields";
import { ITEM } from "@/components/entry/motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { enrollPatient, patientSignUp } from "@/lib/api/client";

import { FIELD_CLASS } from "./auth-shell";

export const PASSWORD_MIN = 8;

export const SIGNUP_ERRORS: Record<string, string> = {
  email_taken: "An account with this email already exists. Sign in instead.",
  weak_password: `Choose a stronger password: at least ${PASSWORD_MIN} characters.`,
  invalid_email: "Enter a valid email address.",
  too_many_attempts: "Too many attempts. Wait a minute and try again.",
  network_error: "Could not reach the sign-in service. Check your connection and try again.",
};

export const ENROLL_ERRORS: Record<string, string> = {
  invalid_code: "That code isn't valid. Check it with your clinic.",
  expired_code: "That code has expired. Ask your clinic for a new one.",
  already_enrolled: "This account is already linked to your clinic.",
  unauthenticated: "Sign in to finish linking your account.",
  not_available: "Enrollment isn't available yet. Try again later.",
  network_error: "Could not reach PledgeCheck. Check your connection and try again.",
};

export const CODE_MESSAGES = {
  missing: "Enter the enrollment code from your clinic.",
  format: "Enrollment codes are 8 letters and numbers, like K4M9-TQ2P.",
};

function enrollMessage(code: string): string {
  return ENROLL_ERRORS[code] ?? "Could not link your account. Try again.";
}

export function checkEnrollmentCode(value: string): string | null {
  const code = value.trim();
  if (!code) return CODE_MESSAGES.missing;
  if (code.replace(/[\s-]/g, "").length !== 8) return CODE_MESSAGES.format;
  return null;
}

function checkNewPassword(value: string): string | null {
  return value.length < PASSWORD_MIN ? SIGNUP_ERRORS.weak_password : null;
}

type FormProblem = { message: string; signIn?: boolean; portal?: boolean };

export function SignupForm({ onSignIn, showSignInLink = true }: { onSignIn?: () => void; showSignInLink?: boolean }) {
  const leave = useLeaveEntry();
  const swap = useCardSwap();
  const [pending, setPending] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const busy = useRef(false);
  const fields = useFieldErrors({
    email: (v) => (accountCreated ? null : checkEmail(v)),
    password: (v) => (accountCreated ? null : checkNewPassword(v)),
    code: checkEnrollmentCode,
  });

  // The tab's own "Sign in" when inside the patient card, a plain link anywhere else.
  function toSignIn(event: MouseEvent<HTMLAnchorElement>) {
    if (!onSignIn) return;
    event.preventDefault();
    onSignIn();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const el = event.currentTarget;
    const invalid = fields.validate(el);
    if (invalid) {
      focusField(el, invalid);
      return;
    }
    const form = new FormData(el);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const code = String(form.get("code") ?? "").trim();

    busy.current = true;
    setPending(true);
    setProblem(null);
    const stop = () => {
      busy.current = false;
      setPending(false);
    };

    if (!accountCreated) {
      const signUp = await patientSignUp(email, password);
      if (!signUp.ok) {
        const reason = signUp.error.code;
        const message = SIGNUP_ERRORS[reason] ?? "Could not create your account. Try again.";
        if (reason === "weak_password") fields.set("password", message);
        else if (reason === "invalid_email") fields.set("email", message);
        else setProblem({ message, signIn: reason === "email_taken" });
        stop();
        return;
      }
      if (signUp.data.needsEmailConfirmation) {
        swap();
        setConfirmEmail(true);
        stop();
        return;
      }
      setAccountCreated(true);
    }

    const enrolled = await enrollPatient(code);
    if (!enrolled.ok) {
      const reason = enrolled.error.code;
      if (reason === "invalid_code" || reason === "expired_code") fields.set("code", enrollMessage(reason));
      else setProblem({ message: enrollMessage(reason), portal: reason === "already_enrolled", signIn: reason === "unauthenticated" });
      stop();
      return;
    }
    // Stays busy: the card fades out and the portal takes over.
    leave("/portal");
  }

  if (confirmEmail) {
    return (
      <m.div variants={ITEM} role="status" className="space-y-4 rounded-2xl border border-rose/30 bg-rose/10 p-5">
        <MailCheckIcon className="size-6 text-rose-text" aria-hidden />
        <h2 className="text-xl font-semibold">Check your email to confirm your account</h2>
        <p className="text-sm leading-relaxed text-mist/90">
          We sent you a confirmation link. Open it, then sign in. You&apos;ll enter your clinic&apos;s enrollment code
          once you&apos;re signed in.
        </p>
        <Button asChild variant="outline">
          <Link href="/portal/login" onClick={toSignIn}>
            Go to sign in
          </Link>
        </Button>
      </m.div>
    );
  }

  const email = fields.bind("email");
  const password = fields.bind("password");
  const code = fields.bind("code");
  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={accountCreated}
          {...email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          disabled={accountCreated}
          hint={`At least ${PASSWORD_MIN} characters.`}
          {...password}
        />
        <Field
          label="Enrollment code"
          name="code"
          type="text"
          inputMode="text"
          required
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. K4M9-TQ2P"
          hint="Your clinic gives you this code. It links your account to your care team."
          className="tabular tracking-[0.12em] uppercase placeholder:tracking-normal placeholder:normal-case"
          {...code}
        />
        <FormError>
          {problem ? (
            <>
              {problem.message}{" "}
              {problem.signIn ? (
                <Link href="/portal/login" onClick={toSignIn} className="font-medium underline">
                  Sign in
                </Link>
              ) : null}
              {problem.portal ? (
                <Link href="/portal" className="font-medium underline">
                  Go to your portal
                </Link>
              ) : null}
            </>
          ) : null}
        </FormError>
        {accountCreated ? (
          <m.p variants={ITEM} className="text-sm text-haze">
            Your account is created. Check the code and try again.
          </m.p>
        ) : null}
        <SubmitButton
          pending={pending}
          label={accountCreated ? "Link my account" : "Create account"}
          pendingLabel={accountCreated ? "Linking…" : "Creating your account…"}
          className="mt-1"
        />
      </form>
      {showSignInLink ? (
        <p className="text-sm text-haze">
          Already have an account?{" "}
          <Link href="/portal/login" onClick={toSignIn} className="font-medium text-orchid-text underline">
            Sign in
          </Link>
        </p>
      ) : null}
      <m.p variants={ITEM} className="text-xs leading-relaxed text-haze">
        We keep your email to reach you. We never store your name, date of birth or ID number.
      </m.p>
    </div>
  );
}

/** For an account that is signed in but not linked yet (e.g. after confirming its email). */
export function EnrollForm({ onEnrolled }: { onEnrolled: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!code) {
      setError("Enter the enrollment code from your clinic.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await enrollPatient(code);
    setPending(false);
    if (result.ok || result.error.code === "already_enrolled") {
      onEnrolled();
      return;
    }
    setError(enrollMessage(result.error.code));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-mist">
        Enrollment code
        <input
          name="code"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          placeholder="e.g. K4M9-TQ2P"
          className={`${FIELD_CLASS} tabular tracking-[0.12em] uppercase`}
        />
      </label>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="lg" variant="brand" className="h-12 text-base" disabled={pending}>
        {pending ? "Linking…" : "Link my account"}
      </Button>
    </form>
  );
}
