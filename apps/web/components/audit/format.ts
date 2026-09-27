// Plain-language text for the /audit screen. Pure; shared by server and client code.
import type { VerifyResponse } from "./types";

export const HONESTY_FOOTNOTE =
  "The Solana anchor proves this log hasn't been edited since it was anchored. It doesn't validate test photos — fraud checks do that. Only a hash is stored on-chain.";

export const NETWORK_ERROR = "Network error. Check your connection and try again.";

export function shortHash(hash: string | null, length = 10): string {
  return hash ? hash.slice(0, length) : "—";
}

// Fixed UTC format, so server and browser render the same text.
export function formatUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

const REASONS: Record<string, string> = {
  hash_mismatch: "This row's contents were changed after it was written.",
  broken_link: "This row no longer links to the row before it; rows were replaced or reordered.",
  missing_row: "This row is missing from the log; it was deleted.",
  duplicate_seq: "This sequence number appears more than once.",
  anchor_mismatch:
    "The stored hashes were rewritten to look consistent, but the log no longer matches the fingerprint recorded on Solana.",
  anchored_row_missing: "A row that was anchored on Solana is no longer in the log.",
  solana_unreachable: "The Solana network could not be reached.",
  solana_not_configured: "Solana is not configured on this server.",
  anchor_tx_not_found: "An anchor transaction was not found on Solana.",
  wrong_fee_payer: "An anchor transaction was not sent by PledgeCheck's wallet, so it proves nothing.",
  memo_missing_or_malformed: "An anchor transaction does not contain a PledgeCheck record.",
  memo_seq_mismatch: "An anchor's on-chain record is for a different row than the database says.",
};

export function describeReason(reason: string | null): string | null {
  if (!reason) return null;
  return REASONS[reason] ?? "Verification failed for an unrecognised reason.";
}

export type VerifyTone = "ok" | "bad" | "warn" | "none";

export function verifyHeadline(r: VerifyResponse): { tone: VerifyTone; title: string } {
  switch (r.status) {
    case "intact":
      return { tone: "ok", title: `Log unchanged since last anchor (seq ${r.headSeq})` };
    case "tampered":
      if (r.firstBrokenSeq !== null) return { tone: "bad", title: `Tampering detected at seq ${r.firstBrokenSeq}` };
      if (r.tamperedWithin) {
        const { fromSeq, toSeq } = r.tamperedWithin;
        return {
          tone: "bad",
          title: fromSeq === toSeq ? `Tampering detected at seq ${toSeq}` : `Tampering detected between seq ${fromSeq} and ${toSeq}`,
        };
      }
      return { tone: "bad", title: "Tampering detected" };
    case "unverifiable":
      return {
        tone: "warn",
        title:
          r.reason === "solana_unreachable"
            ? "Could not reach Solana — log not verified"
            : "Could not verify against Solana — log not verified",
      };
    default:
      return { tone: "none", title: "Not anchored yet" };
  }
}

// The row to highlight and scroll to after a tampered result.
export function brokenSeqOf(r: VerifyResponse): number | null {
  if (r.status !== "tampered") return null;
  return r.firstBrokenSeq ?? r.tamperedWithin?.toSeq ?? null;
}

export function unanchoredText(count: number): string {
  if (count <= 0) return "Every event is anchored.";
  return count === 1 ? "1 event not yet anchored" : `${count} events not yet anchored`;
}

const ANCHOR_ERRORS: Record<string, string> = {
  nothing_to_anchor: "There are no audit events to anchor yet.",
  solana_not_configured: "Solana is not configured on this server.",
  wallet_needs_devnet_sol: "The anchor wallet is out of devnet SOL. Fund it at faucet.solana.com, then try again.",
  solana_unavailable: "Solana could not be reached. Try again in a moment.",
  unauthenticated: "Your session has expired. Sign in again.",
  not_a_clinician: "This account can't anchor the audit log.",
};

export function anchorErrorMessage(status: number, body: { error?: string } | null): string {
  if (body?.error === "anchor_not_recorded") {
    return "The anchor was sent to Solana but not saved here. Record the transaction below by hand.";
  }
  return ANCHOR_ERRORS[body?.error ?? ""] ?? (status === 401 ? ANCHOR_ERRORS.unauthenticated : "Could not anchor. Try again.");
}

export function verifyErrorMessage(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "This account can't verify the audit log.";
  return "Could not verify the log. Try again.";
}
