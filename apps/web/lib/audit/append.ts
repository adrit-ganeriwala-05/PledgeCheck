// Append one event to the hash-chained audit log. Server-only: uses the service role.
//
// The head is read, the next hash computed here (see hash.ts for the spec), and the row
// inserted through the audit_append RPC, which rejects a stale head with
// 'audit_chain_conflict' (PT409). On conflict we re-read the head and retry.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

import { scheduleAutoAnchor } from "./auto-anchor";
import { canonicalJson } from "./canonical";
import { type AuditAction, isAuditAction } from "./events";
import { computeHash, GENESIS_PREV_HASH, normalizeTimestamp } from "./hash";

export type AppendAuditEventInput = {
  actor: string; // "clinician:<uuid>" | "patient:<uuid>" | "patient" | "system"
  action: AuditAction;
  refId?: string | null;
  payload?: Record<string, unknown>;
};

export type AppendAuditEventResult = { seq: number; hash: string };

export class AuditAppendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuditAppendError";
  }
}

export class AuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditValidationError";
  }
}

// Bare "patient" is for events before the patient is known (e.g. an invalid link).
const ACTOR_RE = /^(clinician:[0-9a-f-]{36}|patient:[0-9a-f-]{36}|patient|system)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;
export const AUTO_ANCHOR_EVERY = 10;

// Payloads carry decisions, reasons, statuses and IDs only. Any key containing one of
// these fragments (case-insensitive, at any depth) is rejected: photo_path, image_data,
// token_hash, challenge_code, phash, ...
const DENYLISTED_KEY_FRAGMENTS = ["photo", "image", "token", "challenge", "phash"];

function findDenylistedKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findDenylistedKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (DENYLISTED_KEY_FRAGMENTS.some((f) => lower.includes(f))) return key;
      const hit = findDenylistedKey(child);
      if (hit) return hit;
    }
  }
  return null;
}

export function validateAuditInput(input: AppendAuditEventInput): {
  actor: string;
  action: AuditAction;
  refId: string | null;
  payload: Record<string, unknown>;
} {
  if (typeof input.actor !== "string" || !ACTOR_RE.test(input.actor)) {
    throw new AuditValidationError("invalid actor");
  }
  if (!isAuditAction(input.action)) {
    throw new AuditValidationError("unknown audit action");
  }
  const refId = input.refId ?? null;
  if (refId !== null && !UUID_RE.test(refId)) {
    throw new AuditValidationError("refId must be a uuid");
  }
  const payload = input.payload ?? {};
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AuditValidationError("payload must be an object");
  }
  try {
    canonicalJson(payload);
  } catch (err) {
    throw new AuditValidationError(`payload is not canonicalizable: ${(err as Error).message}`);
  }
  const denied = findDenylistedKey(payload);
  if (denied) {
    throw new AuditValidationError(`payload key not allowed in audit log: ${denied}`);
  }
  return { actor: input.actor, action: input.action, refId: refId?.toLowerCase() ?? null, payload };
}

type RpcError = { code?: string; message?: string } | null;

// PT409 is what audit_append raises for a stale head or a lost insert race; PostgREST
// turns it into HTTP 409. 23505 covers a function old enough to let the primary key
// violation surface raw. 40001 is only reachable over a direct Postgres connection: via
// PostgREST that code is retried internally and never reaches us, which is why
// audit_append no longer uses it (see db/audit.sql). All three mean the same thing here.
function isChainConflict(error: RpcError): boolean {
  return (
    !!error &&
    (error.code === "PT409" ||
      error.code === "23505" ||
      error.code === "40001" ||
      /audit_chain_conflict/.test(error.message ?? ""))
  );
}

function backoff(attempt: number): Promise<void> {
  const ms = 10 * attempt + Math.floor(Math.random() * 20);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function appendAuditEvent(input: AppendAuditEventInput): Promise<AppendAuditEventResult> {
  const { actor, action, refId, payload } = validateAuditInput(input);
  const admin = createAdminClient();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: head, error: headError } = await admin
      .from("audit_events")
      .select("seq, hash")
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (headError) {
      throw new AuditAppendError("could not read audit head", { cause: headError });
    }

    const seq = head ? Number(head.seq) + 1 : 1;
    const prevHash = head ? head.hash : GENESIS_PREV_HASH;
    const createdAt = normalizeTimestamp(new Date());
    const hash = computeHash(prevHash, { seq, actor, action, ref_id: refId, payload, created_at: createdAt });

    const { error } = await admin.rpc("audit_append", {
      p_seq: seq,
      p_prev_hash: prevHash,
      p_hash: hash,
      p_actor: actor,
      p_action: action,
      // Generated RPC argument types are never nullable, but p_ref_id uuid accepts null.
      p_ref_id: refId as string,
      // validateAuditInput already proved the payload is canonical JSON.
      p_payload: payload as Json,
      p_created_at: createdAt,
    });

    if (!error) {
      if (seq % AUTO_ANCHOR_EVERY === 0) {
        try {
          await scheduleAutoAnchor();
        } catch {
          // Auto-anchor is best effort and must never fail an append.
        }
      }
      return { seq, hash };
    }

    if (!isChainConflict(error)) {
      throw new AuditAppendError("audit_append failed", { cause: error });
    }
    if (attempt < MAX_ATTEMPTS) await backoff(attempt);
  }

  throw new AuditAppendError(`audit chain conflict persisted after ${MAX_ATTEMPTS} attempts`);
}

// Shape for the integrations adapter (apps/web/lib/integrations/audit.ts) to delegate to.
export const append = appendAuditEvent;
