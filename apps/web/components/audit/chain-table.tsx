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
    return <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-haze">No audit events yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[860px] text-left text-sm">
          <caption className="sr-only">Audit log, newest first</caption>
          <thead className="border-b border-line text-xs text-haze [&_th]:font-medium">
            <tr>
              <th className="px-3 py-2.5">Seq</th>
              <th className="px-3 py-2.5">Time</th>
              <th className="px-3 py-2.5">Actor</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Ref</th>
              <th className="px-3 py-2.5">Prev hash</th>
              <th className="px-3 py-2.5">Hash</th>
              <th className="px-3 py-2.5">Anchored</th>
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
                    "border-b border-line last:border-0 align-top",
                    broken && "bg-stop/10 outline-2 -outline-offset-2 outline-stop",
                  )}
                >
                  <td className="px-3 py-2.5 font-medium tabular-nums">
                    {row.seq}
                    {broken && <span className="ml-2 font-semibold text-stop">Tampered</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <time dateTime={row.createdAt}>{formatUtc(row.createdAt)}</time>
                  </td>
                  <td className="px-3 py-2.5 break-all">{row.actor}</td>
                  <td className="px-3 py-2.5">{row.action}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-haze" title={row.refId ?? undefined}>
                    {row.refId ? row.refId.slice(0, 8) : "—"}
                  </td>
                  <HashCell label="Prev hash" value={row.prevHash} />
                  <HashCell label="Hash" value={row.hash} />
                  <td className="px-3 py-2.5">
                    {anchoredSeqs.has(row.seq) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-orchid-text">
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
    <td className="px-3 py-2.5 font-mono text-xs text-haze">
      <span title={value ?? undefined} aria-label={value ? `${label} ${value}` : `${label} none`}>
        {shortHash(value)}
      </span>
    </td>
  );
}

function Pagination({ page, pageCount, total }: { page: number; pageCount: number; total: number }) {
  if (pageCount <= 1) return <p className="text-xs text-haze">{total} events</p>;
  return (
    <nav aria-label="Audit log pages" className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={`/audit?page=${page - 1}`} className="text-orchid-text underline">
          Newer
        </Link>
      ) : (
        <span className="text-haze">Newer</span>
      )}
      <span>
        Page {page} of {pageCount} · {total} events
      </span>
      {page < pageCount ? (
        <Link href={`/audit?page=${page + 1}`} className="text-orchid-text underline">
          Older
        </Link>
      ) : (
        <span className="text-haze">Older</span>
      )}
    </nav>
  );
}
