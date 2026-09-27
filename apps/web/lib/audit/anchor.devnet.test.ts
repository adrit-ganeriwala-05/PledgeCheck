// Live devnet check: sends ONE real memo transaction and reads it back. Skipped unless
// RUN_DEVNET_TESTS=1. Loads apps/web/.env.local itself, so from apps/web (Git Bash):
//
//   RUN_DEVNET_TESTS=1 corepack pnpm exec vitest run lib/audit/anchor.devnet.test.ts
//
// The memo is a connectivity marker, not an anchor (`pledgecheck:devnet-test:<iso>`), so it
// can never be mistaken for a chain head. Only the explorer link is printed; no key material.
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const LIVE = process.env.RUN_DEVNET_TESTS === "1";

describe.skipIf(!LIVE)("Solana devnet (live)", () => {
  it("sends a memo and fetches it back from our wallet", { timeout: 120_000 }, async () => {
    const envFile = path.resolve(import.meta.dirname, "../../.env.local");
    if (existsSync(envFile)) process.loadEnvFile(envFile);

    const solana = await import("./solana");
    expect(solana.isSolanaConfigured(), "SOLANA_RPC_URL / SOLANA_SECRET_KEY missing or invalid in apps/web/.env.local").toBe(true);

    const text = `pledgecheck:devnet-test:${new Date().toISOString()}`;
    const signature = await solana.sendMemo(text);
    console.log(`[devnet] memo confirmed: ${solana.explorerUrl(signature)}`);

    let fetched = await solana.fetchMemo(signature);
    for (let i = 0; !fetched && i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2_000));
      fetched = await solana.fetchMemo(signature);
    }
    expect(fetched?.memoText).toBe(text);
    expect(fetched?.feePayer).toBe(solana.anchorPublicKey());
  });
});
