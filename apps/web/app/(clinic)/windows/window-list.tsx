"use client";

// Live countdown list. Owner: Labib (ticket L5).

import { CheckCircle2Icon, ClockIcon, OctagonAlertIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { markPickedUp } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export interface WindowRow {
  id: string;
  patientId: string;
  pseudonym: string;
  isFirstRx: boolean;
  opensAt: string;
  closesAt: string;
  filledAt: string | null;
  status: "open" | "filled" | "missed";
}

const HOUR = 60 * 60 * 1000;

export const PICKUP_ERRORS: Record<string, string> = {
  not_open: "This window is no longer open, so pickup can't be recorded. The patient needs a repeat test.",
  not_found: "This window no longer exists. Reload the page.",
  unauthenticated: "Your session has expired. Sign in again.",
  not_a_clinician: "This account can't record pickups.",
  network_error: "Network error. Check your connection and try again.",
};

export function WindowList({ rows }: { rows: WindowRow[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // The countdown is the point of this screen, so tick it every second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const markPickedUpNow = (id: string) => {
    startTransition(async () => {
      const result = await markPickedUp(id);
      if (result.ok) {
        setFilled((f) => ({ ...f, [id]: true }));
        setFailed((f) => {
          const next = { ...f };
          delete next[id];
          return next;
        });
        return;
      }
      setFailed((f) => ({ ...f, [id]: PICKUP_ERRORS[result.error.code] ?? "Couldn't mark it picked up. Try again." }));
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
        <p className="font-display text-xl font-semibold text-mist">No open windows</p>
        <p className="mt-2 text-sm text-haze">Approving a test opens a 7-day pickup window automatically.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Pickup windows">
      {rows.map((row) => {
        const remaining = new Date(row.closesAt).getTime() - now;
        // Recorded by the backend (status = missed), or derived here until the daily sweep exists.
        const missed = row.status === "missed" || remaining <= 0;
        const urgent = !missed && remaining < 24 * HOUR;
        const soon = !missed && !urgent && remaining < 72 * HOUR;
        const isFilled = filled[row.id];

        return (
          <li
            key={row.id}
            data-status={isFilled ? "picked_up" : missed ? "missed" : "open"}
            className={cn(
              "flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-surface p-4 transition-opacity sm:p-5",
              isFilled ? "border-ok/30 opacity-70" : missed ? "border-stop/50" : urgent ? "border-stop/40" : soon ? "border-warn/45" : "border-line",
            )}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-mist">
                {row.pseudonym}
                {row.isFirstRx && (
                  <span className="rounded-full border border-orchid/40 px-2 py-0.5 text-xs font-medium text-orchid-text">
                    first prescription
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-haze">Closes {new Date(row.closesAt).toLocaleString()}</p>
              {failed[row.id] && (
                <p role="alert" className="mt-1 text-sm text-stop">
                  {failed[row.id]}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <p
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-base font-semibold tabular",
                  isFilled
                    ? "border-ok/30 text-ok"
                    : missed || urgent
                      ? "border-stop/50 bg-stop/10 text-stop"
                      : soon
                        ? "border-warn/45 bg-warn/10 text-warn"
                        : "border-line text-mist",
                )}
              >
                {isFilled ? (
                  <CheckCircle2Icon className="size-4" aria-hidden />
                ) : missed ? (
                  <OctagonAlertIcon className="size-4" aria-hidden />
                ) : (
                  <ClockIcon className="size-4" aria-hidden />
                )}
                {isFilled ? "Picked up" : missed ? "Missed" : countdown(remaining)}
              </p>

              {!isFilled && !missed && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={pending}
                  onClick={() => markPickedUpNow(row.id)}
                  aria-label={`Mark picked up for ${row.pseudonym}`}
                >
                  Mark picked up
                </Button>
              )}

              {missed && !isFilled && (
                <span className="text-sm text-stop">
                  {row.isFirstRx ? "Repeat test in clinic" : "Closed without pickup: contact the patient"}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function countdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
