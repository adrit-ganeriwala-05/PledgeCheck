"use client";

// The "Portal" column: whether the patient has linked a portal account, and their current cycle.
import { useEffect, useState } from "react";

import { getPortalStatuses } from "@/lib/api/client";
import type { PatientPortalStatus } from "@/lib/api/contracts";
import { BADGE_TONE_CLASS, CLINIC_CYCLE_BADGE } from "@/lib/cycle/copy";
import { cn } from "@/lib/utils";

export type PortalStatuses =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; byPatient: Map<string, PatientPortalStatus> };

export function usePortalStatuses(): [PortalStatuses, (patientId: string) => void] {
  const [state, setState] = useState<PortalStatuses>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void getPortalStatuses().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", byPatient: new Map(result.data.patients.map((p) => [p.patientId, p])) }
          : { kind: "unavailable" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function markEnrolled(patientId: string) {
    setState((s) => {
      if (s.kind !== "ready") return s;
      const next = new Map(s.byPatient);
      next.set(patientId, { patientId, enrolled: true, cycleStatus: s.byPatient.get(patientId)?.cycleStatus ?? null });
      return { kind: "ready", byPatient: next };
    });
  }

  return [state, markEnrolled];
}

export function PortalStatusBadges({ state, entry }: { state: PortalStatuses; entry: PatientPortalStatus | undefined }) {
  if (state.kind === "loading") return <span className="text-haze">Loading…</span>;
  if (state.kind === "unavailable" || !entry) {
    return (
      <span className="text-haze" title="Portal status isn't available from the server yet">
        —
      </span>
    );
  }
  const cycle = entry.cycleStatus ? CLINIC_CYCLE_BADGE[entry.cycleStatus] : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        data-enrolled={entry.enrolled}
        className={cn(
          "rounded-full border px-2 py-0.5 text-xs font-medium",
          entry.enrolled ? BADGE_TONE_CLASS.ok : BADGE_TONE_CLASS.neutral,
        )}
      >
        {entry.enrolled ? "Enrolled" : "Not enrolled"}
      </span>
      {cycle ? (
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", BADGE_TONE_CLASS[cycle.tone])}>{cycle.label}</span>
      ) : null}
    </span>
  );
}
