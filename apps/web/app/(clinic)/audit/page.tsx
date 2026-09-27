// /audit — the hash-chained audit log, its Solana anchors, Verify and Anchor now.
// Owner: Nihalika (N8). ?page=N pages the log; ?seq=N opens the page holding that row and
// highlights it (used after a tampered result).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor } from "@/app/login/destination";
import { AuditScreen } from "@/components/audit/audit-screen";
import { HONESTY_FOOTNOTE } from "@/components/audit/format";
import type { AnchorItem, ChainPage } from "@/components/audit/types";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { loadAnchors, loadChainPage, loadLatestSeq, pageForSeq } from "./load";

export const metadata: Metadata = { title: "Audit · PledgeCheck" };
export const dynamic = "force-dynamic";

function positiveInt(value: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const params = await searchParams;
  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) redirect(destinationFor(auth));

  const seq = positiveInt(params.seq);
  let data: { chain: ChainPage; anchors: AnchorItem[]; unanchoredCount: number } | null = null;
  try {
    const page = seq !== null ? await pageForSeq(supabase, seq) : (positiveInt(params.page) ?? 1);
    const [chain, anchors, latestSeq] = await Promise.all([
      loadChainPage(supabase, page),
      loadAnchors(supabase),
      loadLatestSeq(supabase),
    ]);
    const highestAnchored = anchors.reduce((max, a) => Math.max(max, a.headSeq), 0);
    data = { chain, anchors, unanchoredCount: Math.max(0, latestSeq - highestAnchored) };
  } catch (err) {
    console.error("[audit] load failed", err instanceof Error ? err.message : "unknown");
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Audit log</h1>
        <p className="max-w-2xl text-sm text-haze">
          Every clinic action, hash-chained. Verify recomputes the chain and checks it against the fingerprints
          anchored on Solana devnet.
        </p>
      </header>
      {data ? (
        <AuditScreen {...data} initialHighlight={seq} />
      ) : (
        <div role="alert" className="rounded-2xl border border-stop/40 bg-stop/5 p-6 text-sm text-mist">
          Could not load the audit log.{" "}
          <Link href="/audit" className="text-orchid-text underline">
            Try again
          </Link>
        </div>
      )}
      <footer className="border-t border-line pt-4 text-xs text-haze">{HONESTY_FOOTNOTE}</footer>
    </main>
  );
}
