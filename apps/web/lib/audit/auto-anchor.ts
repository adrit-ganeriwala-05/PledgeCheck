// Auto-anchor: append.ts calls this after every 10th audit event.
//
// Inside a request it hands anchorNow() to after() from next/server, so it runs once the
// response is sent and never delays the clinic flow. Outside a request scope (scripts,
// tests) after() throws, and the anchor is awaited instead, capped at 30 seconds.
//
// Solana is optional for the clinic flow: when it is not configured this skips with one
// warning per process, and every failure is logged with "[auto-anchor]" and swallowed.
// The Solana modules are imported lazily so audited routes don't load @solana/web3.js
// until an anchor is actually due.
import "server-only";

import { after } from "next/server";

const FALLBACK_TIMEOUT_MS = 30_000;

let warnedUnconfigured = false;

// Test hook: lets the one-warning-per-process rule be exercised more than once.
export function resetAutoAnchorWarning(): void {
  warnedUnconfigured = false;
}

function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: "unknown" };
  const info: Record<string, unknown> = { error: err.name, message: err.message };
  if ("signature" in err) info.signature = (err as { signature: unknown }).signature;
  return info;
}

async function runAnchor(): Promise<void> {
  try {
    const { anchorNow } = await import("./anchor");
    const result = await anchorNow();
    if (!result.reused) {
      console.info("[auto-anchor] anchored", { headSeq: result.headSeq, explorerUrl: result.explorerUrl });
    }
  } catch (err) {
    console.error("[auto-anchor] anchor failed; the next 10th event will try again", describeError(err));
  }
}

function withCap(task: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[auto-anchor] gave up waiting after ${ms} ms`);
      resolve();
    }, ms);
  });
  return Promise.race([task, cap]).finally(() => clearTimeout(timer));
}

// Never throws.
export async function scheduleAutoAnchor(): Promise<void> {
  try {
    const { isSolanaConfigured } = await import("./solana");
    if (!isSolanaConfigured()) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        console.warn("[auto-anchor] Solana is not configured; skipping automatic anchors");
      }
      return;
    }

    try {
      after(runAnchor);
      return;
    } catch {
      // Not inside a request scope; run it here instead.
    }
    await withCap(runAnchor(), FALLBACK_TIMEOUT_MS);
  } catch (err) {
    console.error("[auto-anchor] could not schedule", describeError(err));
  }
}
