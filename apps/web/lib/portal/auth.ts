import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

export type PortalPatient = {
  id: string;
  practiceId: string;
  pseudonym: string;
  language: "en" | "es";
  homeTestingAllowed: boolean;
  phase: "pre" | "during" | "after" | "complete";
};

export type PortalPatientResult =
  | { ok: true; patient: PortalPatient }
  | { ok: false; status: 401 | 403; error: "unauthenticated" | "not_a_patient" };

// Resolves the signed-in user to their patients row, the mirror of getClinician().
//
// A patient row is claimed by a clinician setting auth_user_id, never by the patient
// signing up: enrolment in an iPLEDGE practice is not something you can self-serve. A
// signed-in user with no patients row is a real state, not an error - it is what a
// brand-new signup looks like before staff link it - so the portal shows them a
// "waiting to be linked" screen rather than a failure.
export async function getPatient(supabase: SupabaseClient<Database>): Promise<PortalPatientResult> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false, status: 401, error: "unauthenticated" };

  const { data: row, error } = await supabase
    .from("patients")
    .select("id, practice_id, pseudonym, language, home_testing_allowed, phase")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (error || !row) return { ok: false, status: 403, error: "not_a_patient" };

  return {
    ok: true,
    patient: {
      id: row.id,
      practiceId: row.practice_id,
      pseudonym: row.pseudonym,
      language: row.language as PortalPatient["language"],
      homeTestingAllowed: row.home_testing_allowed,
      phase: row.phase as PortalPatient["phase"],
    },
  };
}
