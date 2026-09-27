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
    return <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-haze">No patients yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-xs font-medium text-haze">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Patient</th>
            <th scope="col" className="px-4 py-3 font-medium">Phase</th>
            <th scope="col" className="px-4 py-3 font-medium">Language</th>
            <th scope="col" className="px-4 py-3 font-medium">Can get pregnant</th>
            <th scope="col" className="px-4 py-3 font-medium">Home testing</th>
            <th scope="col" className="px-4 py-3 font-medium">Latest link</th>
            <th scope="col" className="px-4 py-3 font-medium">Issue link</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id} className="border-b border-line align-middle transition-colors last:border-0 hover:bg-raised/50">
              <th scope="row" className="px-4 py-3 font-semibold text-mist">{p.pseudonym}</th>
              <td className="px-4 py-3 text-mist">{PHASE[p.phase]}</td>
              <td className="px-4 py-3 text-mist">{p.language === "es" ? "Spanish" : "English"}</td>
              <td className="px-4 py-3 text-mist">{p.canGetPregnant ? "Yes" : "No"}</td>
              <td className="px-4 py-3">
                <HomeTestingToggle patientId={p.id} pseudonym={p.pseudonym} initial={p.homeTestingAllowed} />
              </td>
              <td className="px-4 py-3 text-haze">
                {p.latest ? `${STATE_LABEL[p.latest.state]} (${p.latest.setting})` : "No link yet"}
              </td>
              <td className="px-4 py-3">
                <IssueLink patientId={p.id} pseudonym={p.pseudonym} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
