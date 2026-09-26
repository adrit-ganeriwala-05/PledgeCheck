// The three guards on issuing a home link. Not a rules engine: eligibility beyond this
// belongs to lib/rules (Labib), which has no issuing-time check yet.

export type HomeRefusal = "not_permitted" | "pre_treatment" | "cannot_get_pregnant";

export function homeRefusal(patient: {
  home_testing_allowed: boolean;
  phase: string;
  can_get_pregnant: boolean;
}): HomeRefusal | null {
  if (!patient.can_get_pregnant) return "cannot_get_pregnant"; // no pregnancy-test loop
  if (patient.phase === "pre") return "pre_treatment"; // first test must be in a clinic
  if (!patient.home_testing_allowed) return "not_permitted"; // prescriber hasn't allowed it
  return null;
}
