// POST /api/requests — a clinician issues a one-time test link. Owner: Nihalika (N1).
// Body: { patientId, setting: "home" | "clinic" } → 200 { requestId, link, expiresAt }
//
// The issuing itself lives in lib/requests/issue.ts, shared with the refill approval that
// emails the link. The challenge code is never returned; see that module.
//
// 400 invalid body · 401 no session · 403 not a clinician · 404 patient not visible
// (other practice) · 409 home_testing_not_allowed · 500 issue_failed / audit_failed
import { NextResponse } from "next/server";
import { z } from "zod";

import { getClinician } from "@/lib/clinic/auth";
import { issueTestLink, linkOrigin } from "@/lib/requests/issue";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  // z.guid(): any 8-4-4-4-12 hex id (seeded ids are not RFC-4122 versioned).
  patientId: z.guid(),
  setting: z.enum(["home", "clinic"]),
});

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid_request");
  const { patientId, setting } = parsed.data;

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const issued = await issueTestLink({
    supabase,
    clinician: auth.clinician,
    patientId,
    setting,
    origin: linkOrigin(request),
  });
  if (!issued.ok) return fail(issued.status, issued.error, issued.extra);

  return NextResponse.json(
    { requestId: issued.requestId, link: issued.link, expiresAt: issued.expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
