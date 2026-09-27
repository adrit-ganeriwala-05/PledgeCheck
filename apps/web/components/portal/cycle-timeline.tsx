import { CheckIcon, XIcon } from "lucide-react";

import type { Cycle } from "@/lib/api/contracts";
import { timeline } from "@/lib/cycle/copy";
import { cn } from "@/lib/utils";

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// This month's steps, top to bottom. State is carried by icon and text, never color alone.
export function CycleTimeline({ cycle }: { cycle: Cycle }) {
  const steps = timeline(cycle);
  return (
    <ol aria-label="This month's steps" className="relative space-y-0">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.label} data-state={step.state} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className={cn("absolute top-7 left-[13px] h-[calc(100%-1.75rem)] w-0.5", step.state === "done" ? "bg-orchid" : "bg-line")}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2",
                step.state === "done" && "border-orchid bg-orchid text-black",
                step.state === "current" && "border-rose bg-rose/15",
                step.state === "exit" && "border-stop bg-stop/15 text-stop",
                step.state === "upcoming" && "border-line bg-ink",
              )}
            >
              {step.state === "done" ? <CheckIcon className="size-4" strokeWidth={3} /> : null}
              {step.state === "exit" ? <XIcon className="size-4" strokeWidth={3} /> : null}
              {step.state === "current" ? (
                <span className="size-2.5 rounded-full bg-rose motion-safe:animate-pulse" />
              ) : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("font-medium", step.state === "upcoming" ? "text-haze" : "text-mist")}>
                {step.label}
                <span className="sr-only">
                  {step.state === "done" ? " (done)" : step.state === "current" ? " (now)" : step.state === "exit" ? " (stopped here)" : " (not yet)"}
                </span>
              </p>
              {step.at ? (
                <p className="text-xs text-haze">
                  <time dateTime={step.at}>{formatWhen(step.at)}</time>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
