// Hash-chained audit log: append one event, linked to the one before it.
//
// Owner: Nihalika (ticket N4). Interim version by Labib so every clinic action
// in the submission pipeline writes its audit event from the start. Nihalika's
// version adds the append-only Supabase policy, the anchor and the verify pass.
//
// hash = sha256(prev_hash + canonical JSON of the event, keys sorted)

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEventInput {
  actor: string;
  action: string;
  refId: string | null;
  payload: Record<string, unknown>;
}

/** JSON with every object's keys sorted, so one event always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${entries.join(",")}}`;
}

export function chainHash(prevHash: string, event: Record<string, unknown>): string {
  return createHash("sha256").update(prevHash + canonicalJson(event)).digest("hex");
}

/** The first row's prev_hash: 32 zero bytes. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Append one event to the chain. Best effort by design: an audit write must
 * never be the reason a patient's submission fails, so a failure is logged and
 * swallowed rather than thrown.
 */
export async function appendAuditEvent(
  db: SupabaseClient,
  input: AuditEventInput,
  now: Date,
): Promise<{ seq: number; hash: string } | null> {
  try {
    const { data: head } = await db
      .from("audit_events")
      .select("seq, hash")
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevHash = (head as { hash: string } | null)?.hash ?? GENESIS_HASH;

    const event = {
      actor: input.actor,
      action: input.action,
      ref_id: input.refId,
      payload: input.payload,
      created_at: now.toISOString(),
    };

    const hash = chainHash(prevHash, event);

    const { data, error } = await db
      .from("audit_events")
      .insert({ ...event, prev_hash: prevHash, hash })
      .select("seq, hash")
      .single();

    if (error || !data) {
      console.error("audit append failed", error);
      return null;
    }

    return data as { seq: number; hash: string };
  } catch (error) {
    console.error("audit append threw", error);
    return null;
  }
}
