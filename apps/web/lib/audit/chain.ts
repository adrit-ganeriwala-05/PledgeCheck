// Compatibility shim for the interim audit writer the submission pipeline and the
// windows route were built against. There is one audit writer: lib/audit/append.ts.
// This keeps the old call shape and its best-effort behavior, so an audit failure is
// logged and never fails a patient's submission.
//
// `db` and `now` are accepted but unused: the writer uses the service-role client and
// stamps its own server time, so every row follows the hash spec in hash.ts.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appendAuditEvent as appendToChain } from "./append";
import type { AuditAction } from "./events";

export interface AuditEventInput {
  actor: string;
  action: string;
  refId: string | null;
  payload: Record<string, unknown>;
}

export async function appendAuditEvent(
  db: SupabaseClient,
  input: AuditEventInput,
  now: Date,
): Promise<{ seq: number; hash: string } | null> {
  void db;
  void now;
  try {
    return await appendToChain({
      actor: input.actor,
      // Validated at runtime against the catalog; an unknown action is logged below.
      action: input.action as AuditAction,
      refId: input.refId,
      payload: input.payload,
    });
  } catch (error) {
    console.error("[audit] append failed", {
      action: input.action,
      cause: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
