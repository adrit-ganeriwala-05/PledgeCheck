"use client";

// "Anchor now": POST /api/anchors and report the outcome inline, with the explorer link.
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { anchorAuditHead } from "@/lib/api/client";

import { anchorErrorMessage, NETWORK_ERROR } from "./format";
import type { AnchorResponse } from "./types";

type Outcome =
  | { kind: "done"; anchor: AnchorResponse }
  | { kind: "error"; message: string; explorerUrl?: string };

export function AnchorNowButton({ onAnchored }: { onAnchored?: (anchor: AnchorResponse) => void }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function anchor() {
    setPending(true);
    setOutcome(null);
    const result = await anchorAuditHead();
    setPending(false);
    if (!result.ok) {
      setOutcome({
        kind: "error",
        message: result.error.code === "network_error" ? NETWORK_ERROR : anchorErrorMessage(result.error.status, { error: result.error.code }),
        explorerUrl: result.explorerUrl,
      });
      return;
    }
    setOutcome({ kind: "done", anchor: result.data });
    onAnchored?.(result.data);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="lg" onClick={anchor} disabled={pending} aria-busy={pending}>
        {pending ? "Anchoring…" : outcome?.kind === "error" ? "Try anchoring again" : "Anchor now"}
      </Button>
      <div aria-live="polite" className="text-sm">
        {outcome?.kind === "done" && (
          <p role="status">
            {outcome.anchor.reused
              ? `Already anchored at seq ${outcome.anchor.headSeq}. `
              : `Anchored seq ${outcome.anchor.headSeq} on Solana. `}
            <ExplorerLink href={outcome.anchor.explorerUrl} />
          </p>
        )}
        {outcome?.kind === "error" && (
          <p role="alert" className="text-stop">
            {outcome.message} {outcome.explorerUrl && <ExplorerLink href={outcome.explorerUrl} />}
          </p>
        )}
      </div>
    </div>
  );
}

function ExplorerLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-orchid-text underline">
      View on Solana Explorer
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
