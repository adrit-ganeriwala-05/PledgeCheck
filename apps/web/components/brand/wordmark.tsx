import { cn } from "@/lib/utils";

/** The PledgeCheck mark: a test's result window with the control line, set beside the name. */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-7" : size === "sm" ? "size-4.5" : "size-5.5";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("inline-flex items-center gap-2 font-display font-semibold tracking-tight text-mist", text, className)}>
      <svg viewBox="0 0 24 24" className={box} aria-hidden>
        <defs>
          <linearGradient id="pc-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF4FA8" />
            <stop offset="1" stopColor="#B266FF" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="18" height="18" rx="6" fill="none" stroke="url(#pc-mark)" strokeWidth="2.25" />
        <rect x="10.75" y="7" width="2.5" height="10" rx="1.25" fill="url(#pc-mark)" />
      </svg>
      <span>PledgeCheck</span>
    </span>
  );
}
