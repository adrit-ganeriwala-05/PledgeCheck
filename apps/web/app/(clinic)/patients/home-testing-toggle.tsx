"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

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
      <button
        type="button"
        aria-pressed={allowed}
        aria-label={`Home testing for ${pseudonym}: ${allowed ? "on" : "off"}`}
        disabled={pending}
        onClick={toggle}
        className="group inline-flex h-9 items-center gap-2 rounded-full pr-1 text-sm font-medium text-mist disabled:opacity-60"
      >
        <span
          aria-hidden
          className={cn(
            "relative h-6 w-10 rounded-full border transition-colors duration-200",
            allowed ? "border-orchid bg-orchid/35" : "border-input bg-raised",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-4.5 rounded-full transition-transform duration-200 ease-weighted",
              allowed ? "translate-x-4 bg-mist" : "bg-haze",
            )}
          />
        </span>
        <span className={cn("w-12 text-left", !allowed && "text-haze")}>{pending ? "Saving…" : allowed ? "On" : "Off"}</span>
      </button>
      {error && (
        <p role="alert" className="max-w-48 text-sm text-stop">
          {error}
        </p>
      )}
    </div>
  );
}
