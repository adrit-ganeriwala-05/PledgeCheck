// Result of GET /api/audit/verify. Each state has its own icon and heading text, so status
// never depends on color alone.
import { CircleDashed, ExternalLink, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import { describeReason, verifyHeadline, type VerifyTone } from "./format";
import type { VerifyResponse } from "./types";

// The big badge text. "Chain verified" appears only when the server's verify says intact.
const BADGE: Record<VerifyTone, string> = {
  ok: "Chain verified",
  bad: "Tampering detected",
  warn: "Not verified",
  none: "Not anchored",
};

const TONE: Record<VerifyTone, { className: string; Icon: typeof ShieldCheck; label: string }> = {
  ok: {
    className: "border-ok/40 bg-ok/5 text-mist [--tone:var(--ok)]",
    Icon: ShieldCheck,
    label: "Verified",
  },
  bad: {
    className: "border-stop/50 bg-stop/5 text-mist [--tone:var(--stop)]",
    Icon: ShieldX,
    label: "Tampered",
  },
  warn: {
    className: "border-warn/45 bg-warn/5 text-mist [--tone:var(--warn)]",
    Icon: TriangleAlert,
    label: "Not verified",
  },
  none: {
    className: "border-line bg-surface text-mist [--tone:var(--haze)]",
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
      className={cn("flex flex-col gap-4 rounded-2xl border p-5 text-sm sm:flex-row sm:items-start", className)}
    >
      <p
        aria-hidden
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-(--tone)/50 px-4 py-2 font-display text-lg font-semibold text-(--tone)"
      >
        <Icon className="size-5" />
        {BADGE[tone]}
      </p>
      <div className="space-y-1 text-mist">
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
            <a href={result.anchor.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-orchid-text underline">
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
