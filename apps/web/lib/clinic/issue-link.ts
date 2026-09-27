import "server-only";

// Issue one test link. Owner: Nihalika (N1) for the token and code rules; extracted here
// by Labib so the refill decision route and POST /api/requests share one implementation.
//
// There must be exactly one place that mints a token, hashes it and writes the row.
// Two copies of that is two chances for one of them to store a plain token, skip the
// audit event, or drift on expiry.
//
// Returns the plain token exactly once, to its caller. The database keeps only the hash.

import { appendAuditEvent } from "@/lib/audit/append";
import { generateChallengeCode } from "@/lib/fraud/code";
import { linkExpiresAt } from "@/lib/fraud/session";
import { generateToken, hashToken } from "@/lib/fraud/token";
import { createAdminClient } from "@/lib/supabase/admin";

export type IssueLinkInput = {
  patientId: string;
  setting: "home" | "clinic";
  clinicianId: string;
  /** Extra context for the audit payload, e.g. that a refill request prompted this. */
  auditPayload?: Record<string, unknown>;
};

export type IssueLinkResult =
  | { ok: true; requestId: string; token: string; expiresAt: string }
  | { ok: false; error: "issue_failed" | "audit_failed"; requestId?: string };

export async function issueTestLink(input: IssueLinkInput): Promise<IssueLinkResult> {
  const token = generateToken();
  const expiresAt = linkExpiresAt(new Date()).toISOString();

  const admin = createAdminClient();
  const { data: created, error: insertError } = await admin
    .from("test_requests")
    .insert({
      patient_id: input.patientId,
      token_hash: hashToken(token),
      challenge_code: generateChallengeCode(),
      setting: input.setting,
      expires_at: expiresAt,
      created_by: input.clinicianId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error("[issue-link] insert failed", insertError?.message ?? "no row");
    return { ok: false, error: "issue_failed" };
  }

  // No link leaves the server without its audit event. On failure the row is orphaned
  // but unusable: nobody ever sees its token.
  try {
    await appendAuditEvent({
      actor: `clinician:${input.clinicianId}`,
      action: "request.issued",
      refId: created.id,
      payload: { setting: input.setting, ...(input.auditPayload ?? {}) },
    });
  } catch (err) {
    console.error("[issue-link] AUDIT EVENT NOT WRITTEN — link withheld", {
      requestId: created.id,
      cause: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: "audit_failed", requestId: created.id };
  }

  return { ok: true, requestId: created.id, token, expiresAt };
}
