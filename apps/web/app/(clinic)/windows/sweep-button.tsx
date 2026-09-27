"use client";

// Closes out windows whose deadline has passed. Owner: Labib (ticket L7).
//
// The countdown in window-list.tsx only *shows* a window as missed once it hits zero;
// nothing is written until this runs. Until then the row is still 'open' in the database,
// no audit event exists, and the warehouse cannot count it.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Result = { ok: true; swept: number } | { ok: false; reason: string };

export function SweepButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const sweep = () => {
    setMessage(null);
    startTransition(async () => {
      let result: Result;
      try {
        const response = await fetch("/api/windows/sweep", { method: "POST" });
        result = (await response.json()) as Result;
      } catch {
        setMessage("Could not reach the server.");
        return;
      }
      if (!result.ok) {
        setMessage(`Could not close out windows: ${result.reason}`);
        return;
      }
      setMessage(
        result.swept === 0
          ? "No window has passed its deadline."
          : `Closed out ${result.swept} window${result.swept === 1 ? "" : "s"}.`,
      );
      // Statuses changed server-side, so re-read rather than patching local state.
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={sweep}
        disabled={pending}
        className="rounded-md border border-[var(--pc-line)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Closing out…" : "Close out missed windows"}
      </button>
      {message && (
        <p role="status" className="text-sm text-[var(--pc-muted)]">
          {message}
        </p>
      )}
    </div>
  );
}
