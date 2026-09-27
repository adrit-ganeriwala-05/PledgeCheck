"use client";

import { ClockIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeTimeLeft(deadline: string, now: number): string {
  const left = Date.parse(deadline) - now;
  if (left <= 0) return "The deadline has passed";
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days > 0) return `${plural(days, "day")}, ${plural(hours, "hour")} left`;
  if (hours > 0) return `${plural(hours, "hour")}, ${plural(minutes, "minute")} left`;
  return minutes > 0 ? `${plural(minutes, "minute")} left` : "Less than a minute left";
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Pickup deadline with a live countdown. Amber under 2 days, red under 1. */
export function PickupCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = Date.parse(deadline) - now;
  const tone = left <= DAY ? "urgent" : left <= 2 * DAY ? "soon" : "calm";
  return (
    <div
      data-tone={tone}
      className={cn(
        "rounded-2xl border p-4",
        tone === "urgent" ? "border-stop/50 bg-stop/10" : tone === "soon" ? "border-warn/45 bg-warn/10" : "border-orchid/40 bg-orchid/10",
      )}
    >
      <p className="text-sm text-haze">Pick up by</p>
      <p className="mt-0.5 text-lg font-semibold text-mist">
        <time dateTime={deadline}>{formatDeadline(deadline)}</time>
      </p>
      <p
        role="timer"
        aria-live="off"
        className={cn(
          "tabular mt-2 inline-flex items-center gap-1.5 text-base font-semibold",
          tone === "urgent" ? "text-stop" : tone === "soon" ? "text-warn" : "text-orchid-text",
        )}
      >
        <ClockIcon className="size-4" aria-hidden />
        {describeTimeLeft(deadline, now)}
      </p>
    </div>
  );
}
