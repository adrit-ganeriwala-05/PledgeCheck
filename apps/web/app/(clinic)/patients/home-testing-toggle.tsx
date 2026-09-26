"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function HomeTestingToggle({
  patientId,
  pseudonym,
  initial,
}: {
  patientId: string;
  pseudonym: string;
  initial: boolean;
}) {
  const [allowed, setAllowed] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !allowed;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/home-testing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed: next }),
      });
      const body = await res.json().catch(() => null);
      // audit_failed still saved the change; show it, and say the log entry is missing.
      if (res.ok || body?.changed) setAllowed(next);
      if (!res.ok) {
        setError(
          body?.error === "audit_failed"
            ? "Saved, but the audit log entry failed. Tell the team."
            : "Could not update home testing. Try again.",
        );
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={allowed ? "secondary" : "outline"}
        aria-pressed={allowed}
        aria-label={`Home testing for ${pseudonym}: ${allowed ? "on" : "off"}`}
        disabled={pending}
        onClick={toggle}
      >
        {pending ? "Saving…" : allowed ? "On" : "Off"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
