"use client";

// The one write a patient can make. Owner: Labib.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  already_pending: "You already have a request waiting.",
  not_a_patient: "Your clinic has not linked this account yet.",
  request_failed: "Could not send your request. Try again.",
};

export function RequestRefill({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const request = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/portal/refills", { method: "POST" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(MESSAGES[body.error ?? ""] ?? "Could not send your request.");
          return;
        }
        router.refresh();
      } catch {
        setError("Could not reach your clinic. Check your connection.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={request} disabled={pending || disabled}>
        {pending ? "Sending…" : "Request a refill"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-[var(--pc-stop)]">
          {error}
        </p>
      )}
    </div>
  );
}
