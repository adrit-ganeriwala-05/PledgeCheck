// POST /portal/sign-out — end the patient's session and return to the portal sign-in.
//
// Separate from /login/sign-out only so each lands the person back where they came from:
// a patient sent to the clinic sign-in would look like a permissions error.
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/portal/login", request.url), 303);
}
