"use client";

// Patient sign-up (PRD R1): email and password create a Supabase account, then choosing a
// clinic links it to a pseudonymous patient record. If the clinic step fails, the account
// already exists, so a retry only repeats that step. Lives in the patient card
// (components/entry/patient-auth.tsx) as its "Create account" tab.
//
// The clinic is chosen from the list, not typed as an enrollment code: POST /api/portal/enroll
// takes a practiceId, and GET /api/portal/clinics is public precisely so this form can be
// filled in before there is a session.
import { MailCheckIcon } from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { useCardSwap } from "@/components/entry/auth-card";
import { useLeaveEntry } from "@/components/entry/entry-context";
import { checkEmail, Field, focusField, FormError, PasswordField, SelectField, SubmitButton, useFieldErrors } from "@/components/entry/fields";
import { ITEM } from "@/components/entry/motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { enrollPatient, listClinics, patientSignUp } from "@/lib/api/client";
import type { Clinic } from "@/lib/api/contracts";

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
  unknown_practice: "That clinic isn't available. Choose another, or reload the page.",
  invalid_request: "Choose the clinic that treats you.",
  already_enrolled: "This account is already linked to a clinic.",
  unauthenticated: "Sign in to finish linking your account.",
  not_available: "Enrollment isn't available yet. Try again later.",
  network_error: "Could not reach PledgeCheck. Check your connection and try again.",
};

export const CLINIC_MESSAGES = {
  missing: "Choose the clinic that treats you.",
};

function enrollMessage(code: string): string {
  return ENROLL_ERRORS[code] ?? "Could not link your account. Try again.";
}

export function checkClinic(value: string): string | null {
  return value.trim() ? null : CLINIC_MESSAGES.missing;
}

/** Loads the public clinic list once. An empty list is a real state, not an error. */
export function useClinics(): { clinics: Clinic[]; failed: boolean } {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void listClinics().then((result) => {
      if (cancelled) return;
      if (result.ok) setClinics(result.data.clinics);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { clinics, failed };
}

/** "Peachtree Dermatology — Dr. Rivera, Dr. Okafor": the door you would walk through. */
export function clinicLabel(clinic: Clinic): string {
  return clinic.prescribers.length > 0 ? `${clinic.name} — ${clinic.prescribers.join(", ")}` : clinic.name;
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
  const { clinics, failed: clinicsFailed } = useClinics();
  const fields = useFieldErrors({
    email: (v) => (accountCreated ? null : checkEmail(v)),
    password: (v) => (accountCreated ? null : checkNewPassword(v)),
    practiceId: checkClinic,
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
    const practiceId = String(form.get("practiceId") ?? "").trim();

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

    const enrolled = await enrollPatient(practiceId);
    if (!enrolled.ok) {
      const reason = enrolled.error.code;
      if (reason === "unknown_practice" || reason === "invalid_request") fields.set("practiceId", enrollMessage(reason));
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
          We sent you a confirmation link. Open it, then sign in. You&apos;ll choose your clinic once
          you&apos;re signed in.
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
  const practice = fields.bind("practiceId");
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
        <SelectField
          label="Your clinic"
          name="practiceId"
          required
          defaultValue=""
          disabled={clinics.length === 0}
          hint={
            clinicsFailed
              ? "Could not load the clinic list. Check your connection and reload."
              : "Choose the practice that treats you. This links your account to your care team."
          }
          {...practice}
        >
          <option value="" disabled>
            {clinicsFailed ? "Unavailable" : clinics.length === 0 ? "Loading clinics…" : "Choose your clinic"}
          </option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinicLabel(clinic)}
            </option>
          ))}
        </SelectField>
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
            Your account is created. Choose your clinic and try again.
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
  const { clinics, failed } = useClinics();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const practiceId = String(new FormData(event.currentTarget).get("practiceId") ?? "").trim();
    if (!practiceId) {
      setError(CLINIC_MESSAGES.missing);
      return;
    }
    setPending(true);
    setError(null);
    const result = await enrollPatient(practiceId);
    setPending(false);
    // Already linked is the outcome this form wanted, so it is not an error to show.
    if (result.ok || result.error.code === "already_enrolled") {
      onEnrolled();
      return;
    }
    setError(enrollMessage(result.error.code));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-mist">
        Your clinic
        <select
          name="practiceId"
          required
          defaultValue=""
          disabled={clinics.length === 0}
          aria-invalid={error ? true : undefined}
          className={`${FIELD_CLASS} cursor-pointer appearance-none pr-10`}
        >
          <option value="" disabled>
            {failed ? "Unavailable" : clinics.length === 0 ? "Loading clinics…" : "Choose your clinic"}
          </option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinicLabel(clinic)}
            </option>
          ))}
        </select>
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
