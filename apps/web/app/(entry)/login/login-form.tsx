"use client";

import { m } from "motion/react";
import { useRef, useState, type FormEvent } from "react";

import { useLeaveEntry } from "@/components/entry/entry-context";
import { checkEmail, checkPresent, Field, FIELD_MESSAGES, focusField, FormError, PasswordField, SubmitButton, useFieldErrors } from "@/components/entry/fields";
import { ITEM } from "@/components/entry/motion";
import { clinicianSignIn } from "@/lib/api/client";

// One message for every credential failure, so the form never reveals whether an
// email has an account (or is unconfirmed, locked, ...).
export const BAD_CREDENTIALS = "Email or password is incorrect.";
export const UNREACHABLE = "Could not reach the sign-in service. Check your connection and try again.";

/** The clinician card's contents: heading and form. */
export function ClinicianSignIn() {
  return (
    <div className="space-y-6">
      <m.header variants={ITEM} className="space-y-1.5">
        <p className="text-sm font-semibold text-orchid-text">For prescribers and clinic staff</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Clinic sign in</h1>
      </m.header>
      <LoginForm />
    </div>
  );
}

export function LoginForm() {
  const leave = useLeaveEntry();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const fields = useFieldErrors({ email: checkEmail, password: checkPresent(FIELD_MESSAGES.passwordMissing) });

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
    busy.current = true;
    setPending(true);
    setError(null);
    const stop = () => {
      busy.current = false;
      setPending(false);
    };
    const result = await clinicianSignIn(String(form.get("email") ?? "").trim(), String(form.get("password") ?? ""));
    if (!result.ok) {
      setError(result.error.code === "bad_credentials" ? BAD_CREDENTIALS : UNREACHABLE);
      stop();
      return;
    }
    // Role routing happens on the server (prescriber → /queue, staff → /requests).
    leave("/login/continue");
  }

  return (
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
        accent="orchid"
        {...fields.bind("email")}
      />
      <PasswordField label="Password" name="password" autoComplete="current-password" required accent="orchid" {...fields.bind("password")} />
      <FormError>{error}</FormError>
      <SubmitButton pending={pending} label="Sign in" pendingLabel="Signing in…" accent="orchid" className="mt-1" />
    </form>
  );
}
