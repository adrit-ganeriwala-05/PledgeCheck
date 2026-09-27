// Solana devnet client for anchoring the audit chain head. Server-only.
//
// Config is read from the server env at call time (never at import), so builds and tests
// work without it:
//   SOLANA_RPC_URL     devnet RPC, e.g. https://api.devnet.solana.com. Any host that is not
//                      devnet (or localhost for a local validator) is refused.
//   SOLANA_SECRET_KEY  JSON array of 64 numbers from solana-keygen. Devnet wallet only.
//
// Nothing here ever puts key material in an error message or log line.
import "server-only";

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { MissingEnvError, serverEnv } from "@/lib/env";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const SOLANA_CLUSTER = "devnet";
const CONFIRM_TIMEOUT_MS = 30_000;

export type SolanaConfigReason =
  | "not_configured"
  | "invalid_rpc_url"
  | "non_devnet_rpc"
  | "invalid_secret_key";

export class SolanaConfigError extends Error {
  constructor(readonly reason: SolanaConfigReason) {
    super(`Solana is not configured: ${reason}`);
    this.name = "SolanaConfigError";
  }
}

export class SolanaFundsError extends Error {
  constructor() {
    super("Anchor wallet has too little devnet SOL; fund it at faucet.solana.com");
    this.name = "SolanaFundsError";
  }
}

export class SolanaRpcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SolanaRpcError";
  }
}

function readVar(read: () => string): string {
  try {
    return read();
  } catch (err) {
    if (err instanceof MissingEnvError) throw new SolanaConfigError("not_configured");
    throw err;
  }
}

// Throws before any network call unless the RPC is devnet or a local validator.
export function assertDevnetRpc(rpcUrl: string): void {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new SolanaConfigError("invalid_rpc_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SolanaConfigError("invalid_rpc_url");
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (!local && !host.includes("devnet")) throw new SolanaConfigError("non_devnet_rpc");
}

// Parses the solana-keygen JSON array. The original parse error is dropped on purpose:
// JSON.parse messages quote part of the input.
export function parseSecretKey(raw: string): Keypair {
  let bytes: unknown;
  try {
    bytes = JSON.parse(raw);
  } catch {
    throw new SolanaConfigError("invalid_secret_key");
  }
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  ) {
    throw new SolanaConfigError("invalid_secret_key");
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    throw new SolanaConfigError("invalid_secret_key");
  }
}

function rpcUrl(): string {
  const url = readVar(() => serverEnv.SOLANA_RPC_URL);
  assertDevnetRpc(url);
  return url;
}

function payer(): Keypair {
  return parseSecretKey(readVar(() => serverEnv.SOLANA_SECRET_KEY));
}

function connection(url: string): Connection {
  return new Connection(url, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: CONFIRM_TIMEOUT_MS,
  });
}

// True when both Solana variables are set and valid. Never throws.
export function isSolanaConfigured(): boolean {
  try {
    rpcUrl();
    payer();
    return true;
  } catch {
    return false;
  }
}

// Base58 public key of the anchor wallet. The verifier requires every anchor memo to be
// paid for by this key; a memo posted by any other wallet proves nothing.
export function anchorPublicKey(): string {
  return payer().publicKey.toBase58();
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${SOLANA_CLUSTER}`;
}

export function memoInstruction(text: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(text, "utf8"),
  });
}

const FUNDS_RE = /insufficient (funds|lamports)|no record of a prior credit|AccountNotFound/i;

function toSolanaError(err: unknown): Error {
  if (err instanceof SolanaConfigError || err instanceof SolanaFundsError || err instanceof SolanaRpcError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (FUNDS_RE.test(message)) return new SolanaFundsError();
  return new SolanaRpcError("Solana RPC request failed", { cause: message.slice(0, 500) });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SolanaRpcError(`Solana request timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Sends one memo transaction and waits for "confirmed". Returns the signature.
export async function sendMemo(text: string): Promise<string> {
  const url = rpcUrl();
  const signer = payer();
  const tx = new Transaction().add(memoInstruction(text));
  try {
    return await withTimeout(
      sendAndConfirmTransaction(connection(url), tx, [signer], { commitment: "confirmed" }),
      CONFIRM_TIMEOUT_MS,
    );
  } catch (err) {
    throw toSolanaError(err);
  }
}

export type FetchedMemo = {
  memoText: string | null; // null when the transaction has no memo or failed on-chain
  feePayer: string;
  blockTime: number | null; // unix seconds
};

const MEMO_LOG_RE = /^Program log: Memo \(len \d+\): "(.*)"$/;

// Reads a transaction back from the RPC. Returns null when the RPC does not know it.
export async function fetchMemo(
  signature: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchedMemo | null> {
  const url = rpcUrl();
  let tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>;
  try {
    tx = await withTimeout(
      connection(url).getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      }),
      opts.timeoutMs ?? CONFIRM_TIMEOUT_MS,
    );
  } catch (err) {
    throw toSolanaError(err);
  }
  if (!tx) return null;

  const feePayer = tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? "";
  const blockTime = tx.blockTime ?? null;
  if (tx.meta?.err) return { memoText: null, feePayer, blockTime };

  let memoText: string | null = null;
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId.equals(MEMO_PROGRAM_ID) && "parsed" in ix && typeof ix.parsed === "string") {
      memoText = ix.parsed;
      break;
    }
  }
  if (memoText === null) {
    for (const line of tx.meta?.logMessages ?? []) {
      const m = MEMO_LOG_RE.exec(line);
      if (m) {
        memoText = m[1];
        break;
      }
    }
  }
  return { memoText, feePayer, blockTime };
}
