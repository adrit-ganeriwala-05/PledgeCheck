"use client";

import type { PatientRow } from "./load";
import { HomeTestingToggle } from "./home-testing-toggle";
import { IssueLink } from "./issue-link";

const PHASE: Record<PatientRow["phase"], string> = {
  pre: "Pre-treatment",
  during: "During treatment",
  after: "After treatment",
  complete: "Complete",
};

export const STATE_LABEL: Record<NonNullable<PatientRow["latest"]>["state"], string> = {
  ready: "Link sent, not started",
  active: "Session in progress",
  session_expired: "Session expired",
  link_expired: "Link expired",
  submitted: "Photo submitted",
};

export function PatientsTable({ patients }: { patients: PatientRow[] }) {
  if (patients.length === 0) {
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No patients yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2">Patient</th>
            <th className="px-3 py-2">Phase</th>
            <th className="px-3 py-2">Language</th>
            <th className="px-3 py-2">Can get pregnant</th>
            <th className="px-3 py-2">Home testing</th>
            <th className="px-3 py-2">Latest link</th>
            <th className="px-3 py-2">Issue link</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id} className="border-b last:border-0 align-top">
              <td className="px-3 py-2 font-medium">{p.pseudonym}</td>
              <td className="px-3 py-2">{PHASE[p.phase]}</td>
              <td className="px-3 py-2">{p.language === "es" ? "Spanish" : "English"}</td>
              <td className="px-3 py-2">{p.canGetPregnant ? "Yes" : "No"}</td>
              <td className="px-3 py-2">
                <HomeTestingToggle patientId={p.id} pseudonym={p.pseudonym} initial={p.homeTestingAllowed} />
              </td>
              <td className="px-3 py-2">
                {p.latest ? `${STATE_LABEL[p.latest.state]} (${p.latest.setting})` : "No link yet"}
              </td>
              <td className="px-3 py-2">
                <IssueLink patientId={p.id} pseudonym={p.pseudonym} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
