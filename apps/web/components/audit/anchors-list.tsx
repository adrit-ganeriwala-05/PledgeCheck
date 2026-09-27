// Recent anchors, newest first, each linking to its devnet transaction.
import { ExternalLink } from "lucide-react";

import { formatUtc, shortHash } from "./format";
import type { AnchorItem } from "./types";

export function AnchorsList({ anchors }: { anchors: AnchorItem[] }) {
  if (anchors.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-haze">No anchors yet.</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
      {anchors.map((a) => (
        <li key={a.signature} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className="font-medium tabular-nums">Seq {a.headSeq}</span>
          <span className="font-mono text-xs text-haze" title={a.headHash} aria-label={`Head hash ${a.headHash}`}>
            {shortHash(a.headHash)}
          </span>
          <time dateTime={a.anchoredAt} className="text-haze">
            {formatUtc(a.anchoredAt)}
          </time>
          <a href={a.explorerUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-orchid-text underline">
            Explorer
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">for seq {a.headSeq} (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
