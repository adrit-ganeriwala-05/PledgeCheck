"use client";

import { ClockIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { describeCapturedAgo, describeWindowCountdown } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

type Props = { window: QueueCard["window"]; capturedAt: string | null; className?: string };

const HOUR = 60 * 60 * 1000;

export type CountdownTone = "calm" | "soon" | "urgent";

/** Amber inside 72 hours, red inside 24 hours (and once closed). Always shown with text. */
export function countdownTone(closesAt: string, now: number): CountdownTone {
  const left = Date.parse(closesAt) - now;
  if (left <= 24 * HOUR) return "urgent";
  if (left <= 72 * HOUR) return "soon";
  return "calm";
}

const TONE_CLASS: Record<CountdownTone, string> = {
  calm: "border-line text-mist",
  soon: "border-warn/45 bg-warn/10 text-warn",
  urgent: "border-stop/50 bg-stop/10 text-stop",
};

// Live countdown only when the patient already has an open window. Before approval we
// show capture age and static text; projected dates come from the rules engine, never here.
export function WindowCountdown({ window, capturedAt, className }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (window) {
    const tone = countdownTone(window.closesAt, now);
    return (
      <p
        data-tone={tone}
        className={cn("inline-flex flex-wrap items-center gap-x-1.5 rounded-full border px-3 py-1 text-sm", TONE_CLASS[tone], className)}
      >
        <ClockIcon className="size-3.5" aria-hidden />
        <span className="tabular font-semibold">{describeWindowCountdown(window.closesAt, now)}</span>
        {window.isFirstRx ? <span className="text-haze"> · first prescription</span> : null}
        {/* Changes only when the tone does, so it is announced at each threshold, not every tick. */}
        <span className="sr-only" aria-live="polite">
          {tone === "urgent" ? "Fill window closes within 24 hours" : tone === "soon" ? "Fill window closes within 3 days" : ""}
        </span>
      </p>
    );
  }
  return (
    <p className={cn("inline-flex flex-wrap items-center gap-x-1.5 text-sm", className)}>
      <ClockIcon className="size-3.5 text-haze" aria-hidden />
      <span className="tabular font-medium text-mist">{describeCapturedAgo(capturedAt, now)}</span>
      <span className="text-haze"> · 7-day window opens on approval</span>
    </p>
  );
}
