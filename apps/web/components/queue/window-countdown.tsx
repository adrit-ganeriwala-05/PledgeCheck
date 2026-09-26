"use client";

import { useEffect, useState } from "react";

import { describeCapturedAgo, describeWindowCountdown } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";

type Props = { window: QueueCard["window"]; capturedAt: string | null };

// Live countdown only when the patient already has an open window. Before approval we
// show capture age and static text; projected dates come from the rules engine, never here.
export function WindowCountdown({ window, capturedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (window) {
    return (
      <p className="text-sm">
        <span className="font-medium">{describeWindowCountdown(window.closesAt, now)}</span>
        {window.isFirstRx ? <span className="text-muted-foreground"> · first prescription</span> : null}
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="font-medium">{describeCapturedAgo(capturedAt, now)}</span>
      <span className="text-muted-foreground"> · 7-day window opens on approval</span>
    </p>
  );
}
