import { CircleDashedIcon, CircleHelpIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { flagLabel, flagSeverity, sortFlags } from "./flags";

const SEVERITY_STYLE = {
  fraud: { icon: OctagonAlertIcon, className: "border-stop/50 bg-stop/10 text-stop", hint: "Fraud check" },
  degraded: { icon: CircleDashedIcon, className: "border-warn/45 bg-warn/10 text-warn", hint: "Check did not run" },
  review: { icon: TriangleAlertIcon, className: "border-warn/35 bg-transparent text-warn", hint: "Review" },
  unknown: { icon: CircleHelpIcon, className: "border-line bg-transparent text-haze", hint: "Unrecognized" },
} as const;

// Flags as labeled chips: color, icon and text together, so meaning never rests on color alone.
export function FlagBadges({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Flags" className="flex flex-wrap gap-1.5">
      {sortFlags(flags).map((flag) => {
        const { label, known } = flagLabel(flag);
        const severity = flagSeverity(flag);
        const style = SEVERITY_STYLE[severity];
        const Icon = style.icon;
        return (
          <li key={flag}>
            <span
              data-severity={severity}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                style.className,
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">{style.hint}: </span>
              <span title={known ? `${style.hint}: ${flag}` : "Unrecognized flag, shown as received"}>{label}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
