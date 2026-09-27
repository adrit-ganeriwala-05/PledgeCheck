"use client";

// Patient sign-in and sign-up. Owner: Labib.
//
// Deliberately the same shape as the clinic form (app/login/login-form.tsx): email and
// password through Supabase Auth, which stores the password bcrypt-hashed in auth.users.
// No password ever reaches our own tables, and this component never sees a patient's
// clinical record - signing in only establishes who you are. What you may then read is
// decided by RLS (app.current_patient_id in db/policies.sql).

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// One message for every credential failure, so the form never reveals whether an email
// has an account. Same reasoning as the clinic form.
export const BAD_CREDENTIALS = "Email or password is incorrect.";
export const UNREACHABLE = "Could not reach the sign-in service. Check your connection and try again.";
export const CHECK_EMAIL = "Check your email to confirm your address, then sign in.";
export const SHORT_PASSWORD = "Use at least 8 characters.";

export const CHOOSE_CLINIC = "Choose your clinic.";
export const ENROLL_FAILED = "Your account was created, but joining that clinic failed. Sign in and try again.";

export const MIN_PASSWORD = 8;

type Clinic = { id: string; name: string; prescribers: string[] };

type Mode = "signin" | "signup";

export function PortalAuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [clinicId, setClinicId] = useState("");

  // Only needed to sign up, so it is not fetched until the form is in that mode.
  useEffect(() => {
    if (mode !== "signup" || clinics.length > 0) return;
    let cancelled = false;
    fetch("/api/portal/clinics")
      .then((r) => r.json())
      .then((d: { clinics?: Clinic[] }) => {
        if (!cancelled && d.clinics) setClinics(d.clinics);
      })
      .catch(() => {
        /* The select stays empty and the form says so on submit. */
      });
    return () => {
      cancelled = true;
    };
  }, [mode, clinics.length]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setError(null);
    setNotice(null);

    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(SHORT_PASSWORD);
      return;
    }
    if (mode === "signup" && !clinicId) {
      setError(CHOOSE_CLINIC);
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        // emailRedirectTo pins the confirmation link to this origin. Without it Supabase
        // uses the project's Site URL, and if that forwards anywhere the session fragment
        // is dropped on the hop and the link appears broken.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/portal/confirm` },
        });
        if (signUpError) {
          setError(BAD_CREDENTIALS);
          setPending(false);
          return;
        }
        // With email confirmation enabled Supabase returns a user but no session.
        if (!data.session) {
          setNotice(CHECK_EMAIL);
          setPending(false);
          return;
        }
        // Join the chosen practice. Without this the patient lands on "Almost there"
        // with no way forward, which is exactly the dead end this replaces.
        const enrolled = await fetch("/api/portal/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practiceId: clinicId }),
        });
        if (!enrolled.ok && enrolled.status !== 409) {
          setError(ENROLL_FAILED);
          setPending(false);
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(BAD_CREDENTIALS);
          setPending(false);
          return;
        }
      }
      router.replace("/portal");
    } catch {
      setError(UNREACHABLE);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border px-3 py-2 text-base font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? MIN_PASSWORD : undefined}
          className="rounded-md border px-3 py-2 text-base font-normal"
        />
      </label>

      {mode === "signup" && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Your clinic
          <select
            name="clinic"
            required
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className="rounded-md border px-3 py-2 text-base font-normal"
          >
            <option value="">Select a clinic…</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.prescribers.length > 0 ? ` — ${c.prescribers.join(", ")}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </Button>

      <button
        type="button"
        className="text-sm underline"
        onClick={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
          setNotice(null);
        }}
      >
        {mode === "signup" ? "I already have an account" : "Create an account"}
      </button>
    </form>
  );
}
