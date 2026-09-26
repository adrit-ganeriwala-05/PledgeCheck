"use client";

// Live countdown list. Owner: Labib (ticket L5).

import { useEffect, useState, useTransition } from "react";

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

  const markFilled = (id: string) => {
    startTransition(async () => {
      try {
        const response = await fetch("/api/windows/fill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ windowId: id }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { reason?: string };
          setFailed((f) => ({ ...f, [id]: data.reason ?? "could not mark filled" }));
          return;
        }
        setFilled((f) => ({ ...f, [id]: true }));
      } catch {
        setFailed((f) => ({ ...f, [id]: "network error" }));
      }
    });
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--pc-line)] bg-white p-8 text-center text-[var(--pc-muted)]">
        No open windows. Approved tests open one automatically.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const remaining = new Date(row.closesAt).getTime() - now;
        const missed = row.status === "missed" || remaining <= 0;
        const urgent = !missed && remaining < 24 * 60 * 60 * 1000;
        const isFilled = filled[row.id];

        return (
          <li
            key={row.id}
            className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white p-5 ${
              isFilled
                ? "border-[var(--pc-line)] opacity-60"
                : missed
                  ? "border-red-300"
                  : urgent
                    ? "border-amber-300"
                    : "border-[var(--pc-line)]"
            }`}
          >
            <div>
              <p className="font-medium">
                {row.pseudonym}
                {row.isFirstRx && (
                  <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-normal text-[var(--pc-muted)]">
                    first prescription
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-[var(--pc-muted)]">
                Closes {new Date(row.closesAt).toLocaleString()}
              </p>
              {failed[row.id] && (
                <p className="mt-1 text-sm text-[var(--pc-stop)]">{failed[row.id]}</p>
              )}
            </div>

            <div className="flex items-center gap-4">
              <p
                className={`font-mono text-lg tabular-nums ${
                  isFilled
                    ? "text-[var(--pc-muted)]"
                    : missed
                      ? "text-[var(--pc-stop)]"
                      : urgent
                        ? "text-[var(--pc-warn)]"
                        : ""
                }`}
              >
                {isFilled ? "filled" : missed ? "window missed" : countdown(remaining)}
              </p>

              {!isFilled && !missed && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => markFilled(row.id)}
                  className="rounded-lg border border-[var(--pc-line)] px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  Mark filled
                </button>
              )}

              {missed && !isFilled && (
                <span className="text-sm text-[var(--pc-stop)]">
                  repeat test in clinic
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
