// Result of GET /api/audit/verify. Each state has its own icon and heading text, so status
// never depends on color alone.
import { CircleDashed, ExternalLink, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import { describeReason, verifyHeadline, type VerifyTone } from "./format";
import type { VerifyResponse } from "./types";

const TONE: Record<VerifyTone, { className: string; Icon: typeof ShieldCheck; label: string }> = {
  ok: {
    className: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-100",
    Icon: ShieldCheck,
    label: "Verified",
  },
  bad: {
    className: "border-red-300 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950/30 dark:text-red-100",
    Icon: ShieldX,
    label: "Tampered",
  },
  warn: {
    className: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100",
    Icon: TriangleAlert,
    label: "Not verified",
  },
  none: {
    className: "border-border bg-muted/40 text-foreground",
    Icon: CircleDashed,
    label: "Not anchored",
  },
};

export function VerifyPanel({ result }: { result: VerifyResponse }) {
  const { tone, title } = verifyHeadline(result);
  const { className, Icon, label } = TONE[tone];
  const detail = describeReason(result.reason);

  return (
    <section
      role={tone === "bad" ? "alert" : "status"}
      aria-label="Verification result"
      data-tone={tone}
      className={cn("flex gap-3 rounded-lg border p-4 text-sm", className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">
          <span className="sr-only">{label}: </span>
          {title}
        </p>
        {detail && <p>{detail}</p>}
        {result.status === "no_anchor" && <p>Click Anchor now to record the current head on Solana.</p>}
        {result.status === "intact" && (
          <p>
            Recomputed {result.checkedRows} {result.checkedRows === 1 ? "row" : "rows"} and matched{" "}
            {result.anchorsChecked.length} {result.anchorsChecked.length === 1 ? "anchor" : "anchors"} on Solana.
          </p>
        )}
        {result.dbCopyMatches === false && (
          <p>The database copy of an anchor was edited. The on-chain record was used instead.</p>
        )}
        {result.anchor && (
          <p>
            <a href={result.anchor.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
              Anchor for seq {result.headSeq} on Solana Explorer
              <ExternalLink aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
