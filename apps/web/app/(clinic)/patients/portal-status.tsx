// The "Portal" column: whether the patient has linked a portal account, and their current cycle.
//
// Both values come from the server loader (./load.ts), not a fetch. Patients enrol by
// picking their clinic in the portal, so there is no code for a clinician to generate and
// nothing here to poll: the page is force-dynamic and re-reads on navigation.

import type { CycleStatus } from "@/lib/api/contracts";
import { BADGE_TONE_CLASS, CLINIC_CYCLE_BADGE } from "@/lib/cycle/copy";
import { cn } from "@/lib/utils";

export function PortalStatusBadges({ enrolled, cycleStatus }: { enrolled: boolean; cycleStatus: CycleStatus | null }) {
  const cycle = cycleStatus ? CLINIC_CYCLE_BADGE[cycleStatus] : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        data-enrolled={enrolled}
        className={cn(
          "rounded-full border px-2 py-0.5 text-xs font-medium",
          enrolled ? BADGE_TONE_CLASS.ok : BADGE_TONE_CLASS.neutral,
        )}
      >
        {enrolled ? "Enrolled" : "Not enrolled"}
      </span>
      {cycle ? (
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", BADGE_TONE_CLASS[cycle.tone])}>
          {cycle.label}
        </span>
      ) : null}
    </span>
  );
}
