// /patients — the practice's patients, home-testing switch, portal enrollment and link issuing.
// Owner: Nihalika (N6).
//
// Refill requests used to have a small queue on this page. They now have their own screen
// at /requests, which is the one the nav links to; this page stays about the patient list.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor } from "@/app/login/destination";
import { isMocked } from "@/lib/api/mode";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { loadPatients, type PatientRow } from "./load";
import { MockPatients } from "./mock-patients";
import { PatientsTable } from "./patients-table";

export const metadata: Metadata = { title: "Patients · PledgeCheck" };
export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  if (isMocked("patientsPage")) {
    return (
      <PatientsShell>
        <MockPatients />
      </PatientsShell>
    );
  }

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) redirect(destinationFor(auth));

  let patients: PatientRow[] | null = null;
  try {
    patients = await loadPatients(supabase);
  } catch (err) {
    console.error("[patients] load failed", err instanceof Error ? err.message : "unknown");
  }

  return (
    <PatientsShell>
      {patients ? (
        <PatientsTable patients={patients} />
      ) : (
        <div role="alert" className="rounded-2xl border border-stop/40 bg-stop/5 p-6 text-sm text-mist">
          Could not load patients.{" "}
          <Link href="/patients" className="text-orchid-text underline">
            Try again
          </Link>
        </div>
      )}
    </PatientsShell>
  );
}

function PatientsShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Patients</h1>
        <p className="max-w-2xl text-sm text-haze">
          Patients sign up in the portal and pick this practice themselves. You can issue a one-time test link here; the
          challenge code stays hidden until the patient taps Start.
        </p>
      </header>
      {children}
    </main>
  );
}
