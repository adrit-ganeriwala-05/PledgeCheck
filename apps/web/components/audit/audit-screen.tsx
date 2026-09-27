"use client";

// Interactive part of /audit: Verify, Anchor now, the result panel, the chain table and the
// anchors list. Reads come from the server page; mutations go only through the API routes.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { AnchorNowButton } from "./anchor-button";
import { AnchorsList } from "./anchors-list";
import { ChainTable } from "./chain-table";
import { brokenSeqOf, NETWORK_ERROR, unanchoredText, verifyErrorMessage } from "./format";
import type { AnchorItem, ChainPage, VerifyResponse } from "./types";
import { VerifyPanel } from "./verify-panel";

type VerifyState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; result: VerifyResponse }
  | { kind: "error"; message: string };

export function AuditScreen({
  chain,
  anchors,
  unanchoredCount,
  initialHighlight = null,
}: {
  chain: ChainPage;
  anchors: AnchorItem[];
  unanchoredCount: number;
  initialHighlight?: number | null;
}) {
  const router = useRouter();
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });
  const [highlight, setHighlight] = useState<number | null>(initialHighlight);
  const anchoredSeqs = useMemo(() => new Set(anchors.map((a) => a.headSeq)), [anchors]);

  // Bring the broken row into view once it is on the page.
  useEffect(() => {
    if (highlight === null) return;
    document.getElementById(`seq-${highlight}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [highlight, chain.rows]);

  async function runVerify() {
    setVerify({ kind: "pending" });
    try {
      const res = await fetch("/api/audit/verify", { cache: "no-store" });
      if (!res.ok) {
        setVerify({ kind: "error", message: verifyErrorMessage(res.status) });
        return;
      }
      const result = (await res.json()) as VerifyResponse;
      setVerify({ kind: "done", result });
      const seq = brokenSeqOf(result);
      setHighlight(seq);
      if (seq !== null && !chain.rows.some((r) => r.seq === seq)) {
        router.push(`/audit?seq=${seq}`, { scroll: false });
      }
    } catch {
      setVerify({ kind: "error", message: NETWORK_ERROR });
    }
  }

  function anchored() {
    // The earlier result predates this anchor; refresh the list and the unanchored count.
    setVerify({ kind: "idle" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button type="button" size="lg" onClick={runVerify} disabled={verify.kind === "pending"} aria-busy={verify.kind === "pending"}>
          {verify.kind === "pending" ? "Verifying…" : "Verify"}
        </Button>
        <AnchorNowButton onAnchored={anchored} />
        {/* A7: audit PDF export button (Adrit) */}
        <p className="ml-auto self-center text-sm text-haze">{unanchoredText(unanchoredCount)}</p>
      </div>

      <div aria-live="polite">
        {verify.kind === "done" && <VerifyPanel result={verify.result} />}
        {verify.kind === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-stop/50 bg-stop/5 p-4 text-sm text-mist">
            <span>{verify.message}</span>
            <Button type="button" size="sm" variant="outline" onClick={runVerify}>
              Try again
            </Button>
          </div>
        )}
      </div>

      <section aria-labelledby="chain-heading" className="space-y-2">
        <h2 id="chain-heading" className="text-xl font-semibold">
          Audit log
        </h2>
        <ChainTable chain={chain} anchoredSeqs={anchoredSeqs} highlightSeq={highlight} />
      </section>

      <section aria-labelledby="anchors-heading" className="space-y-2">
        <h2 id="anchors-heading" className="text-xl font-semibold">
          Solana anchors
        </h2>
        <AnchorsList anchors={anchors} />
      </section>
    </div>
  );
}
