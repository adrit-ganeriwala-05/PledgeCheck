import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

export type Clinician = {
  id: string;
  practiceId: string;
  role: "prescriber" | "staff";
};

export type ClinicianResult =
  | { ok: true; clinician: Clinician }
  | { ok: false; status: 401 | 403; error: "unauthenticated" | "not_a_clinician" };

// Resolves the signed-in user to their clinicians row. RLS lets a user read their own
// row; a user without one (e.g. a future drug-maker login) is not a clinician.
export async function getClinician(supabase: SupabaseClient<Database>): Promise<ClinicianResult> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false, status: 401, error: "unauthenticated" };

  const { data: row, error } = await supabase
    .from("clinicians")
    .select("id, practice_id, role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !row) return { ok: false, status: 403, error: "not_a_clinician" };

  return {
    ok: true,
    clinician: { id: row.id, practiceId: row.practice_id, role: row.role as Clinician["role"] },
  };
}
