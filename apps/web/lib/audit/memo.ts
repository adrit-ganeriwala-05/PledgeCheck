// On-chain memo format. Only the head seq and head hash are published, never event data.
//   pledgecheck:v1:<headSeq>:<headHash>

const MEMO_RE = /^pledgecheck:v1:([1-9][0-9]*):([0-9a-f]{64})$/;

export type ParsedMemo = { headSeq: number; headHash: string };

export function buildMemo(headSeq: number, headHash: string): string {
  const memo = `pledgecheck:v1:${headSeq}:${headHash}`;
  if (!parseMemo(memo)) throw new Error("buildMemo: invalid head seq or hash");
  return memo;
}

export function parseMemo(text: string): ParsedMemo | null {
  const m = MEMO_RE.exec(text);
  if (!m) return null;
  const headSeq = Number(m[1]);
  if (!Number.isSafeInteger(headSeq)) return null;
  return { headSeq, headHash: m[2] };
}
