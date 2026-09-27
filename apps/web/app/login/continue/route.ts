// GET /login/continue — after sign-in, send the user to their role's home:
// prescriber → /queue, staff → /requests (ROLE_HOME in lib/auth/permissions.ts), no clinicians row → /login/no-access,
// no session → /login.
import { NextResponse } from "next/server";

import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { destinationFor } from "../destination";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const result = await getClinician(supabase);
  return NextResponse.redirect(new URL(destinationFor(result), request.url), 303);
}
