// Shapes shared by the /audit page (server) and its client components. No runtime code.

export type ChainRow = {
  seq: number;
  createdAt: string;
  actor: string;
  action: string;
  refId: string | null;
  prevHash: string | null;
  hash: string;
};

export type AnchorItem = {
  headSeq: number;
  headHash: string;
  signature: string;
  explorerUrl: string;
  anchoredAt: string;
};

export type ChainPage = {
  rows: ChainRow[];
  page: number;
  pageCount: number;
  total: number;
};

// GET /api/audit/verify (lib/audit/verify.ts VerifyResult), as the browser receives it.
export type VerifyResponse = {
  ok: boolean;
  headSeq: number | null;
  headHash: string | null;
  anchoredHash: string | null;
  match: boolean;
  status: "intact" | "tampered" | "unverifiable" | "no_anchor";
  reason: string | null;
  firstBrokenSeq: number | null;
  tamperedWithin: { fromSeq: number; toSeq: number } | null;
  checkedRows: number;
  unanchoredCount: number;
  dbCopyMatches: boolean | null;
  anchor: { signature: string; explorerUrl: string; anchoredAt: string } | null;
  anchorsChecked: Array<{ headSeq: number; match: boolean; status: string; reason: string | null; explorerUrl: string }>;
};

// POST /api/anchors 200 body.
export type AnchorResponse = {
  signature: string;
  explorerUrl: string;
  headSeq: number;
  headHash: string;
  reused: boolean;
};
