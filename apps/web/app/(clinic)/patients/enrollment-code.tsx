"use client";

// Generate a portal enrollment code (PRD R1). Shown once, like a test link: the patient enters it
// at sign-up to link their account to this pseudonymous record.
import { KeyRoundIcon } from "lucide-react";
import { m } from "motion/react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateEnrollmentCode } from "@/lib/api/client";
import type { EnrollmentCodeResponse } from "@/lib/api/contracts";

import { formatExpiry } from "./link-dialog";

export const CODE_ONCE_WARNING =
  "This code is shown once. Give it to the patient in person or by phone. Anyone with it can link a portal account to this patient.";

const ERRORS: Record<string, string> = {
  already_enrolled: "This patient already has a portal account.",
  not_found: "This patient isn't in your practice.",
  unauthenticated: "Your session has expired. Sign in again.",
  not_a_clinician: "This account can't create enrollment codes.",
  not_available: "Enrollment codes aren't available on this server yet.",
  network_error: "Network error. Check your connection and try again.",
};

export function EnrollmentCode({
  patientId,
  pseudonym,
  onAlreadyEnrolled,
}: {
  patientId: string;
  pseudonym: string;
  onAlreadyEnrolled?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<EnrollmentCodeResponse | null>(null);

  async function generate() {
    setPending(true);
    setError(null);
    const result = await generateEnrollmentCode(patientId);
    setPending(false);
    if (result.ok) {
      setIssued(result.data);
      return;
    }
    if (result.error.code === "already_enrolled") onAlreadyEnrolled?.();
    setError(ERRORS[result.error.code] ?? "Could not create a code. Try again.");
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={generate} aria-label={`Enrollment code for ${pseudonym}`}>
        <KeyRoundIcon aria-hidden />
        {pending ? "Creating…" : "Enrollment code"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-56 text-sm text-stop">
          {error}
        </p>
      ) : null}
      <EnrollmentCodeDialog issued={issued} pseudonym={pseudonym} onClose={() => setIssued(null)} />
    </div>
  );
}

export function EnrollmentCodeDialog({
  issued,
  pseudonym,
  onClose,
}: {
  issued: EnrollmentCodeResponse | null;
  pseudonym: string;
  onClose: () => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  async function copyCode() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <Dialog
      open={issued !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopy("idle");
          onClose();
        }
      }}
    >
      <DialogContent className="border-line bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Portal enrollment code for {pseudonym}</DialogTitle>
          <DialogDescription>The patient enters this code when they create their PledgeCheck account.</DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="flex flex-col gap-4">
            <Alert role="note" className="border-warn/40 bg-warn/10 text-mist">
              <AlertDescription className="text-mist">{CODE_ONCE_WARNING}</AlertDescription>
            </Alert>
            <div className="rounded-2xl bg-brand-gradient p-[2px]">
              <m.p
                data-testid="enrollment-code"
                aria-label={`Enrollment code ${issued.code.split("").join(" ")}`}
                className="tabular rounded-[14px] bg-ink px-4 py-6 text-center text-4xl font-bold tracking-[0.18em] text-mist"
                initial={{ opacity: 0, filter: "blur(8px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                {issued.code}
              </m.p>
            </div>
            <Button type="button" onClick={copyCode}>
              {copy === "copied" ? "Copied" : "Copy code"}
            </Button>
            {copy === "failed" ? <p className="text-sm text-stop">Could not copy. Read the code out instead.</p> : null}
            <p className="text-sm text-haze">
              Expires <time dateTime={issued.expiresAt}>{formatExpiry(issued.expiresAt)}</time>.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
