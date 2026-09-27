"use client";

// The patient card: Sign in and Create account as two tabs of one component. /portal/login and
// /portal/signup both render it; switching tabs pushes the other URL with history.pushState (Next.js
// keeps usePathname in sync), so the card animates instead of reloading and Back switches tabs back.
import { MailCheckIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { SignupForm } from "@/components/portal/signup-form";
import { Button } from "@/components/ui/button";
import { patientSignIn, requestPasswordReset } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { useCardSwap } from "./auth-card";
import { useLeaveEntry } from "./entry-context";
import { checkEmail, checkPresent, Field, FIELD_MESSAGES, focusField, FormError, PasswordField, SubmitButton, useFieldErrors } from "./fields";
import { EASE, ITEM } from "./motion";
import { AUTH_PATHS } from "./poses";

type Tab = "signin" | "signup";

export const PATIENT_COPY = {
  signInTitle: "Welcome back",
  signInLead: "Sign in to request your refill and take your monthly test from home.",
  signUpTitle: "Create your account",
  signUpLead: "You'll need the enrollment code your clinic gave you.",
  forgotTitle: "Reset your password",
  forgotLead: "Enter the email you signed up with. We'll send you a link to choose a new password.",
  /** One message for every credential failure, so the form never reveals whether an email has an account. */
  badCredentials: "Email or password is incorrect.",
  unreachable: "Could not reach PledgeCheck. Check your connection and try again.",
  resetSent: "If an account exists for that email, we've sent a reset link.",
};

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "signin", label: "Sign in", path: AUTH_PATHS.patient },
  { key: "signup", label: "Create account", path: AUTH_PATHS["patient-signup"] },
];

export function PatientAuth({ next }: { next: string }) {
  const pathname = usePathname();
  const tab: Tab = pathname === AUTH_PATHS["patient-signup"] ? "signup" : "signin";
  const [forgot, setForgot] = useState<{ open: boolean; email: string }>({ open: false, email: "" });
  const swap = useCardSwap();
  const reduced = useReducedMotion() ?? false;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(next: Tab, focus = false) {
    if (focus) tabs.current[TABS.findIndex((t) => t.key === next)]?.focus();
    if (next === tab) return;
    swap();
    setForgot({ open: false, email: "" });
    // Keep whatever query the page arrived with (a validated `next`), nothing more.
    window.history.pushState(null, "", `${TABS.find((t) => t.key === next)!.path}${window.location.search}`);
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.key === tab);
    const to =
      event.key === "ArrowRight" ? (i + 1) % TABS.length : event.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    select(TABS[to].key, true);
  }

  const view = tab === "signup" ? "signup" : forgot.open ? "forgot" : "signin";
  const title = view === "signup" ? PATIENT_COPY.signUpTitle : view === "forgot" ? PATIENT_COPY.forgotTitle : PATIENT_COPY.signInTitle;
  const lead = view === "signup" ? PATIENT_COPY.signUpLead : view === "forgot" ? PATIENT_COPY.forgotLead : PATIENT_COPY.signInLead;

  return (
    <div className="space-y-6">
      <m.div variants={ITEM} role="tablist" aria-label="Patient account" className="relative grid grid-cols-2 gap-1 rounded-xl border border-line/80 bg-ink/60 p-1">
        {TABS.map((t, i) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`patient-tab-${t.key}`}
              aria-selected={selected}
              aria-controls="patient-auth-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.key)}
              onKeyDown={onTabKey}
              className={cn(
                "relative h-10 rounded-lg text-sm font-medium transition-colors duration-200",
                selected ? "text-mist" : "text-haze hover:text-mist",
              )}
            >
              {selected ? (
                <m.span
                  layoutId="patient-tab-indicator"
                  aria-hidden
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 42 }}
                  className="absolute inset-0 rounded-lg border border-rose/35 bg-raised shadow-[0_0_24px_-10px_rgba(255,79,168,0.7)]"
                />
              ) : null}
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </m.div>

      <div id="patient-auth-panel" role="tabpanel" aria-labelledby={`patient-tab-${tab}`}>
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={view}
            initial="hidden"
            animate="shown"
            exit={{ opacity: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: EASE } }}
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.16, delayChildren: 0, staggerChildren: reduced ? 0 : 0.03 } } }}
            className="space-y-6"
          >
            <m.header variants={ITEM} className="space-y-1.5">
              <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
              <p className="text-sm leading-relaxed text-haze">{lead}</p>
            </m.header>
            {view === "signin" ? (
              <PatientSignIn
                next={next}
                onForgot={(email) => {
                  swap();
                  setForgot({ open: true, email });
                }}
              />
            ) : view === "forgot" ? (
              <ForgotPassword
                email={forgot.email}
                onBack={() => {
                  swap();
                  setForgot({ open: false, email: "" });
                }}
              />
            ) : (
              <SignupForm showSignInLink={false} onSignIn={() => select("signin")} />
            )}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function PatientSignIn({ next, onForgot }: { next: string; onForgot: (email: string) => void }) {
  const leave = useLeaveEntry();
  const form = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors({ email: checkEmail, password: checkPresent(FIELD_MESSAGES.passwordMissing) });
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const el = event.currentTarget;
    const invalid = fields.validate(el);
    if (invalid) {
      focusField(el, invalid);
      return;
    }
    busy.current = true;
    setPending(true);
    setProblem(null);
    const data = new FormData(el);
    const result = await patientSignIn(String(data.get("email") ?? "").trim(), String(data.get("password") ?? ""));
    if (!result.ok) {
      busy.current = false;
      setPending(false);
      setProblem(result.error.code === "bad_credentials" ? PATIENT_COPY.badCredentials : PATIENT_COPY.unreachable);
      return;
    }
    // Stays busy: the card fades out and the portal (or the validated `next` page) takes over.
    leave(next);
  }

  const email = fields.bind("email");
  const password = fields.bind("password");
  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required {...email} />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        {...password}
        aside={
          <button
            type="button"
            onClick={() => {
              const value = form.current?.elements.namedItem("email");
              onForgot(value instanceof HTMLInputElement ? value.value.trim() : "");
            }}
            className="rounded-sm text-sm text-rose-text underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        }
      />
      <FormError>{problem}</FormError>
      <SubmitButton pending={pending} label="Sign in" pendingLabel="Signing in…" className="mt-1" />
    </form>
  );
}

function ForgotPassword({ email, onBack }: { email: string; onBack: () => void }) {
  const fields = useFieldErrors({ email: checkEmail });
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const swap = useCardSwap();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const el = event.currentTarget;
    if (fields.validate(el)) {
      focusField(el, "email");
      return;
    }
    busy.current = true;
    setPending(true);
    setProblem(null);
    const result = await requestPasswordReset(String(new FormData(el).get("email") ?? "").trim());
    busy.current = false;
    setPending(false);
    if (!result.ok) {
      setProblem(PATIENT_COPY.unreachable);
      return;
    }
    swap();
    setSent(true);
  }

  if (sent) {
    return (
      <m.div variants={ITEM} role="status" className="space-y-4 rounded-2xl border border-rose/30 bg-rose/10 p-5">
        <MailCheckIcon className="size-6 text-rose-text" aria-hidden />
        <p className="text-sm leading-relaxed text-mist">{PATIENT_COPY.resetSent}</p>
        <Button type="button" variant="outline" onClick={onBack}>
          Back to sign in
        </Button>
      </m.div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={email}
        {...fields.bind("email")}
      />
      <FormError>{problem}</FormError>
      <SubmitButton pending={pending} label="Send reset link" pendingLabel="Sending…" className="mt-1" />
      <m.div variants={ITEM}>
        <button type="button" onClick={onBack} className="rounded-sm text-sm text-haze underline-offset-4 hover:text-mist hover:underline">
          Back to sign in
        </button>
      </m.div>
    </form>
  );
}
