import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  send: vi.fn(),
  getParsedTransaction: vi.fn(),
  connectionUrls: [] as string[],
}));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@solana/web3.js")>();
  class FakeConnection {
    constructor(url: string) {
      net.connectionUrls.push(url);
    }
    getParsedTransaction = net.getParsedTransaction;
  }
  return { ...real, Connection: FakeConnection, sendAndConfirmTransaction: net.send };
});

const solana = await import("./solana");
const { MEMO_PROGRAM_ID, SolanaConfigError, SolanaFundsError, SolanaRpcError } = solana;

// Test-only keypair from a fixed seed; never a real wallet.
const TEST_KEYPAIR = Keypair.fromSeed(new Uint8Array(32).fill(7));
const TEST_SECRET = JSON.stringify(Array.from(TEST_KEYPAIR.secretKey));
const DEVNET = "https://api.devnet.solana.com";
const SIG = "5".repeat(88); // test vector, not a real signature
const MEMO = `pledgecheck:v1:10:${"a".repeat(64)}`; // test vector

beforeEach(() => {
  vi.stubEnv("SOLANA_RPC_URL", DEVNET);
  vi.stubEnv("SOLANA_SECRET_KEY", TEST_SECRET);
  net.send.mockReset();
  net.getParsedTransaction.mockReset();
  net.connectionUrls = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("config", () => {
  it.each([
    "https://api.mainnet-beta.solana.com",
    "https://api.testnet.solana.com",
    "https://rpc.example.com",
  ])("refuses non-devnet RPC %s before any network call", async (url) => {
    vi.stubEnv("SOLANA_RPC_URL", url);
    await expect(solana.sendMemo(MEMO)).rejects.toMatchObject({ name: "SolanaConfigError", reason: "non_devnet_rpc" });
    await expect(solana.fetchMemo(SIG)).rejects.toBeInstanceOf(SolanaConfigError);
    expect(net.connectionUrls).toEqual([]);
    expect(net.send).not.toHaveBeenCalled();
  });

  it("accepts devnet hosts and local validators", () => {
    expect(() => solana.assertDevnetRpc(DEVNET)).not.toThrow();
    expect(() => solana.assertDevnetRpc("https://devnet.helius-rpc.com/?api-key=x")).not.toThrow();
    expect(() => solana.assertDevnetRpc("http://localhost:8899")).not.toThrow();
    expect(() => solana.assertDevnetRpc("http://127.0.0.1:8899")).not.toThrow();
    expect(() => solana.assertDevnetRpc("ftp://devnet.example")).toThrow(SolanaConfigError);
    expect(() => solana.assertDevnetRpc("not a url")).toThrow(SolanaConfigError);
  });

  it.each([
    ["not json", "{nope"],
    ["wrong length", JSON.stringify(Array.from(TEST_KEYPAIR.secretKey.slice(0, 32)))],
    ["out of range byte", JSON.stringify([...Array.from(TEST_KEYPAIR.secretKey.slice(0, 63)), 256])],
    ["public half does not match", JSON.stringify([...Array.from(TEST_KEYPAIR.secretKey.slice(0, 32)), ...new Array(32).fill(1)])],
  ])("malformed secret key (%s) throws a config error without key contents", (_label, raw) => {
    let caught: unknown;
    try {
      solana.parseSecretKey(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SolanaConfigError);
    const e = caught as InstanceType<typeof SolanaConfigError>;
    expect(e.reason).toBe("invalid_secret_key");
    expect(e.message).not.toMatch(/\d{2,}/);
    expect(e.message).not.toContain(raw.slice(0, 8));
    expect((e as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("missing env is not_configured, and isSolanaConfigured reports it without throwing", () => {
    expect(solana.isSolanaConfigured()).toBe(true);
    vi.stubEnv("SOLANA_SECRET_KEY", "");
    expect(solana.isSolanaConfigured()).toBe(false);
    expect(() => solana.anchorPublicKey()).toThrow(expect.objectContaining({ reason: "not_configured" }));
  });

  it("derives the anchor public key from the secret key", () => {
    expect(solana.anchorPublicKey()).toBe(TEST_KEYPAIR.publicKey.toBase58());
  });

  it("builds devnet explorer URLs", () => {
    expect(solana.explorerUrl(SIG)).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  });
});

describe("sendMemo", () => {
  it("sends one Memo-program instruction with the exact text and no accounts", async () => {
    net.send.mockResolvedValue(SIG);
    await expect(solana.sendMemo(MEMO)).resolves.toBe(SIG);

    expect(net.connectionUrls).toEqual([DEVNET]);
    const [, tx, signers, opts] = net.send.mock.calls[0] as [unknown, Transaction, Keypair[], { commitment: string }];
    expect(tx.instructions).toHaveLength(1);
    const ix = tx.instructions[0];
    expect(ix.programId.equals(new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"))).toBe(true);
    expect(ix.keys).toEqual([]);
    expect(Buffer.from(ix.data).toString("utf8")).toBe(MEMO);
    expect(signers.map((s) => s.publicKey.toBase58())).toEqual([TEST_KEYPAIR.publicKey.toBase58()]);
    expect(opts.commitment).toBe("confirmed");
  });

  it.each([
    "Attempt to debit an account but found no record of a prior credit.",
    "Transaction simulation failed: insufficient funds for fee",
    "custom program error: insufficient lamports 10, need 5000",
  ])("maps %j to SolanaFundsError", async (message) => {
    net.send.mockRejectedValue(new Error(message));
    await expect(solana.sendMemo(MEMO)).rejects.toBeInstanceOf(SolanaFundsError);
  });

  it("maps other failures to SolanaRpcError without key material", async () => {
    net.send.mockRejectedValue(new Error("fetch failed"));
    const err = await solana.sendMemo(MEMO).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SolanaRpcError);
    expect(String((err as Error).message)).not.toContain(TEST_SECRET.slice(1, 12));
  });

  it("times out after 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      net.send.mockReturnValue(new Promise(() => {}));
      const pending = solana.sendMemo(MEMO).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toBeInstanceOf(SolanaRpcError);
    } finally {
      vi.useRealTimers();
    }
  });
});

function parsedTx(opts: {
  instructions?: unknown[];
  logs?: string[];
  err?: unknown;
  payer?: PublicKey;
}) {
  return {
    blockTime: 1_790_000_000,
    meta: { err: opts.err ?? null, logMessages: opts.logs ?? [] },
    transaction: {
      message: {
        accountKeys: [{ pubkey: opts.payer ?? TEST_KEYPAIR.publicKey, signer: true, writable: true }],
        instructions: opts.instructions ?? [],
      },
    },
  };
}

describe("fetchMemo", () => {
  it("reads the memo from the parsed Memo instruction", async () => {
    net.getParsedTransaction.mockResolvedValue(
      parsedTx({ instructions: [{ programId: MEMO_PROGRAM_ID, program: "spl-memo", parsed: MEMO }] }),
    );
    await expect(solana.fetchMemo(SIG)).resolves.toEqual({
      memoText: MEMO,
      feePayer: TEST_KEYPAIR.publicKey.toBase58(),
      blockTime: 1_790_000_000,
    });
    expect(net.getParsedTransaction).toHaveBeenCalledWith(SIG, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  });

  it("falls back to the program log line", async () => {
    net.getParsedTransaction.mockResolvedValue(
      parsedTx({
        instructions: [{ programId: MEMO_PROGRAM_ID, accounts: [], data: "xyz" }],
        logs: [
          `Program ${MEMO_PROGRAM_ID.toBase58()} invoke [1]`,
          `Program log: Memo (len ${MEMO.length}): "${MEMO}"`,
        ],
      }),
    );
    expect((await solana.fetchMemo(SIG))?.memoText).toBe(MEMO);
  });

  it("ignores memo-shaped instructions from other programs", async () => {
    const other = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
    net.getParsedTransaction.mockResolvedValue(parsedTx({ instructions: [{ programId: other, parsed: MEMO }] }));
    expect((await solana.fetchMemo(SIG))?.memoText).toBeNull();
  });

  it("reports the fee payer so the verifier can reject other wallets", async () => {
    const other = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
    net.getParsedTransaction.mockResolvedValue(
      parsedTx({ payer: other, instructions: [{ programId: MEMO_PROGRAM_ID, parsed: MEMO }] }),
    );
    expect((await solana.fetchMemo(SIG))?.feePayer).toBe(other.toBase58());
  });

  it("treats a failed transaction as having no memo", async () => {
    net.getParsedTransaction.mockResolvedValue(
      parsedTx({ err: { InstructionError: [0, "Custom"] }, instructions: [{ programId: MEMO_PROGRAM_ID, parsed: MEMO }] }),
    );
    expect((await solana.fetchMemo(SIG))?.memoText).toBeNull();
  });

  it("returns null for an unknown signature and throws SolanaRpcError when the RPC fails", async () => {
    net.getParsedTransaction.mockResolvedValueOnce(null);
    await expect(solana.fetchMemo(SIG)).resolves.toBeNull();
    net.getParsedTransaction.mockRejectedValueOnce(new Error("503 Service Unavailable"));
    await expect(solana.fetchMemo(SIG)).rejects.toBeInstanceOf(SolanaRpcError);
  });
});
