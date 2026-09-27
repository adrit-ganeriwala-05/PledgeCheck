"use client";

// Form parts shared by the patient and clinician cards. Fields validate on blur and on submit, never
// while someone is still typing; an error appears under its field, is announced (role="alert"), and
// grows in rather than pushing the page. Errors never echo what was typed.
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { EASE, ITEM } from "./motion";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FIELD_MESSAGES = {
  emailMissing: "Enter your email address.",
  emailInvalid: "Enter an email address like name@example.com.",
  passwordMissing: "Enter your password.",
};

export function checkEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return FIELD_MESSAGES.emailMissing;
  if (!EMAIL_PATTERN.test(email)) return FIELD_MESSAGES.emailInvalid;
  return null;
}

export function checkPresent(message: string) {
  return (value: string) => (value ? null : message);
}

export type Accent = "rose" | "orchid";

const INPUT =
  "h-12 w-full rounded-xl border border-input bg-ink/80 px-3.5 text-base font-normal text-mist transition-[border-color,box-shadow] duration-200 placeholder:text-haze/70 focus-visible:outline-none focus-visible:ring-3 aria-invalid:border-stop aria-invalid:focus-visible:ring-stop/30 disabled:opacity-60";
const ACCENT_FOCUS: Record<Accent, string> = {
  rose: "focus-visible:border-rose focus-visible:ring-rose/25",
  orchid: "focus-visible:border-orchid focus-visible:ring-orchid/30",
};

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  name: string;
  accent?: Accent;
  hint?: ReactNode;
  error?: string | null;
  /** A control inside the field on the right (the password toggle). */
  trailing?: ReactNode;
  /** A control under the field, on the right (the forgot-password link); after the input in tab order. */
  aside?: ReactNode;
};

export function Field({ label, name, accent = "rose", hint, error, trailing, aside, className, ...input }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <m.div variants={ITEM} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-mist">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={cn(INPUT, ACCENT_FOCUS[accent], trailing && "pr-12", className)}
          {...input}
        />
        {trailing}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-haze">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error ?? null} />
      {aside ? <div className="flex justify-end">{aside}</div> : null}
    </m.div>
  );
}

/** An error under a field: height grows from zero, so nothing below it jumps. */
export function FieldError({ id, message }: { id?: string; message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <m.div
          key="error"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="overflow-hidden"
        >
          <p id={id} role="alert" className="pt-0.5 text-sm text-[#ff8a73]">
            {message}
          </p>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

/** A form-level message (a server answer), animated the same way. */
export function FormError({ children }: { children: ReactNode | null }) {
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <m.div
          key="form-error"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="overflow-hidden"
        >
          <div role="alert" className="rounded-xl border border-stop/40 bg-stop/10 px-3.5 py-3 text-sm text-mist">
            {children}
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

export function PasswordField(props: Omit<FieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-haze transition-colors hover:text-mist focus-visible:text-mist"
        >
          {visible ? <EyeOffIcon className="size-4.5" aria-hidden /> : <EyeIcon className="size-4.5" aria-hidden />}
        </button>
      }
    />
  );
}

/** Keeps its width while loading: both labels share one grid cell, and only one is visible. */
export function SubmitButton({
  pending,
  label,
  pendingLabel,
  accent = "rose",
  className,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  accent?: Accent;
  className?: string;
}) {
  return (
    <m.div variants={ITEM}>
      <Button
        type="submit"
        size="lg"
        variant="brand"
        disabled={pending}
        aria-busy={pending || undefined}
        className={cn(
          "h-12 w-full text-base active:scale-[0.99] disabled:opacity-80",
          accent === "orchid" && "bg-[linear-gradient(115deg,#d95bd6_0%,var(--orchid)_60%,#8f5bff_100%)] shadow-[0_8px_30px_-8px_rgba(178,102,255,0.55)]",
          className,
        )}
      >
        <span className="grid">
          <span aria-hidden={pending || undefined} className={cn("col-start-1 row-start-1", pending && "opacity-0")}>
            {label}
          </span>
          <span
            aria-hidden={!pending || undefined}
            className={cn("col-start-1 row-start-1 inline-flex items-center justify-center gap-2", !pending && "opacity-0")}
          >
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            {pendingLabel}
          </span>
        </span>
      </Button>
    </m.div>
  );
}

/** Field errors keyed by field name, with blur-time checks that only run once a field has been edited. */
export function useFieldErrors<K extends string>(checks: Record<K, (value: string) => string | null>) {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [dirty, setDirty] = useState<Partial<Record<K, boolean>>>({});

  const set = (name: K, message: string | null) =>
    setErrors((current) => {
      if ((current[name] ?? null) === message) return current;
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });

  return {
    errors,
    /** Spread onto a field: checks on blur once edited, and clears a shown error as soon as it's fixed. */
    bind(name: K) {
      return {
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          if (!dirty[name]) setDirty((d) => ({ ...d, [name]: true }));
          if (errors[name] && !checks[name](event.target.value)) set(name, null);
        },
        onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
          if (dirty[name]) set(name, checks[name](event.target.value));
        },
        error: errors[name] ?? null,
      };
    },
    /** Checks every field; returns the first invalid field's name, or null. */
    validate(form: HTMLFormElement): K | null {
      let first: K | null = null;
      const next: Partial<Record<K, string>> = {};
      for (const name of Object.keys(checks) as K[]) {
        const field = form.elements.namedItem(name);
        const value = field instanceof HTMLInputElement ? field.value : "";
        const message = checks[name](value);
        if (message) {
          next[name] = message;
          first ??= name;
        }
      }
      setErrors(next);
      return first;
    },
    set,
  };
}

export function focusField(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) field.focus({ preventScroll: false });
}
