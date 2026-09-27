// The audit chain, newest first, 50 rows per page. Hashes show their first 10 characters;
// the full value is in the tooltip and the accessible name.
import { Anchor } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { formatUtc, shortHash } from "./format";
import type { ChainPage } from "./types";

export function ChainTable({
  chain,
  anchoredSeqs,
  highlightSeq,
}: {
  chain: ChainPage;
  anchoredSeqs: Set<number>;
  highlightSeq: number | null;
}) {
  if (chain.total === 0) {
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No audit events yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Audit log, newest first</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">Seq</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Prev hash</th>
              <th className="px-3 py-2">Hash</th>
              <th className="px-3 py-2">Anchored</th>
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((row) => {
              const broken = row.seq === highlightSeq;
              return (
                <tr
                  key={row.seq}
                  id={`seq-${row.seq}`}
                  aria-current={broken ? "true" : undefined}
                  className={cn(
                    "border-b last:border-0 align-top",
                    broken && "bg-red-50 outline-2 -outline-offset-2 outline-red-500 dark:bg-red-950/30",
                  )}
                >
                  <td className="px-3 py-2 font-medium tabular-nums">
                    {row.seq}
                    {broken && <span className="ml-2 font-semibold text-red-700 dark:text-red-300">Tampered</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <time dateTime={row.createdAt}>{formatUtc(row.createdAt)}</time>
                  </td>
                  <td className="px-3 py-2 break-all">{row.actor}</td>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={row.refId ?? undefined}>
                    {row.refId ? row.refId.slice(0, 8) : "—"}
                  </td>
                  <HashCell label="Prev hash" value={row.prevHash} />
                  <HashCell label="Hash" value={row.hash} />
                  <td className="px-3 py-2">
                    {anchoredSeqs.has(row.seq) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium">
                        <Anchor aria-hidden className="size-3.5" />
                        Anchored
                      </span>
                    ) : (
                      <span className="sr-only">No</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={chain.page} pageCount={chain.pageCount} total={chain.total} />
    </div>
  );
}

function HashCell({ label, value }: { label: string; value: string | null }) {
  return (
    <td className="px-3 py-2 font-mono text-xs">
      <span title={value ?? undefined} aria-label={value ? `${label} ${value}` : `${label} none`}>
        {shortHash(value)}
      </span>
    </td>
  );
}

function Pagination({ page, pageCount, total }: { page: number; pageCount: number; total: number }) {
  if (pageCount <= 1) return <p className="text-xs text-muted-foreground">{total} events</p>;
  return (
    <nav aria-label="Audit log pages" className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={`/audit?page=${page - 1}`} className="underline">
          Newer
        </Link>
      ) : (
        <span className="text-muted-foreground">Newer</span>
      )}
      <span>
        Page {page} of {pageCount} · {total} events
      </span>
      {page < pageCount ? (
        <Link href={`/audit?page=${page + 1}`} className="underline">
          Older
        </Link>
      ) : (
        <span className="text-muted-foreground">Older</span>
      )}
    </nav>
  );
}
