// Where a signed-in user lands, by role. Reuses getClinician (lib/clinic/auth.ts).
import type { ClinicianResult } from "@/lib/clinic/auth";

export const NO_ACCESS_PATH = "/login/no-access";

export function destinationFor(result: ClinicianResult): string {
  if (!result.ok) return result.status === 401 ? "/login" : NO_ACCESS_PATH;
  return result.clinician.role === "prescriber" ? "/queue" : "/patients";
}
