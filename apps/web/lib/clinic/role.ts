// The signed-in clinician's role for server components (nav, page gating). Null when there is
// no clinician session or the lookup fails; each page still does its own access check.
import "server-only";

import { cookies } from "next/headers";

import { isMocked } from "@/lib/api/mode";
import type { ClinicRole } from "@/lib/auth/permissions";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

/** Set by the Mock data badge to preview the staff or prescriber view offline. */
export const MOCK_ROLE_COOKIE = "pc-mock-role";

export async function clinicRole(): Promise<ClinicRole | null> {
  if (isMocked("clinicRole")) {
    const value = (await cookies()).get(MOCK_ROLE_COOKIE)?.value;
    return value === "staff" ? "staff" : "prescriber";
  }
  try {
    const result = await getClinician(await createClient());
    return result.ok ? result.clinician.role : null;
  } catch {
    return null;
  }
}
