"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { type IssuedLink, LinkDialog } from "./link-dialog";

const HOME_REFUSALS: Record<string, string> = {
  not_permitted: "Home testing isn't turned on for this patient.",
  pre_treatment: "The first, pre-treatment test must be taken in the clinic.",
  cannot_get_pregnant: "Not eligible: this patient doesn't need pregnancy tests.",
};

export const NETWORK_ERROR = "Network error. Check your connection and try again.";

export function issueErrorMessage(status: number, body: { error?: string; reason?: string } | null): string {
  if (status === 409 && body?.error === "home_testing_not_allowed") {
    return HOME_REFUSALS[body.reason ?? ""] ?? "A home link isn't allowed for this patient.";
  }
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "This account can't issue test links.";
  if (status === 404) return "This patient isn't in your practice.";
  return "Could not issue the link. Try again.";
}

export function IssueLink({ patientId, pseudonym }: { patientId: string; pseudonym: string }) {
  const [pending, setPending] = useState<"home" | "clinic" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  async function issue(setting: "home" | "clinic") {
    setPending(setting);
    setError(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId, setting }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(issueErrorMessage(res.status, body));
        return;
      }
      setIssued({ link: body.link, expiresAt: body.expiresAt, setting });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2" role="group" aria-label={`Issue link for ${pseudonym}`}>
        <Button type="button" size="sm" disabled={pending !== null} onClick={() => issue("home")}>
          {pending === "home" ? "Issuing…" : "Home link"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending !== null} onClick={() => issue("clinic")}>
          {pending === "clinic" ? "Issuing…" : "Clinic link"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="max-w-56 text-sm text-stop">
          {error}
        </p>
      )}
      <LinkDialog issued={issued} pseudonym={pseudonym} onClose={() => setIssued(null)} />
    </div>
  );
}
