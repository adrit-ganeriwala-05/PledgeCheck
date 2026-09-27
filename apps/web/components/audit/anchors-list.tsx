// Recent anchors, newest first, each linking to its devnet transaction.
import { ExternalLink } from "lucide-react";

import { formatUtc, shortHash } from "./format";
import type { AnchorItem } from "./types";

export function AnchorsList({ anchors }: { anchors: AnchorItem[] }) {
  if (anchors.length === 0) {
    return <p className="rounded-md border p-4 text-sm text-muted-foreground">No anchors yet.</p>;
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {anchors.map((a) => (
        <li key={a.signature} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
          <span className="font-medium tabular-nums">Seq {a.headSeq}</span>
          <span className="font-mono text-xs" title={a.headHash} aria-label={`Head hash ${a.headHash}`}>
            {shortHash(a.headHash)}
          </span>
          <time dateTime={a.anchoredAt} className="text-muted-foreground">
            {formatUtc(a.anchoredAt)}
          </time>
          <a href={a.explorerUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 underline">
            Explorer
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">for seq {a.headSeq} (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
