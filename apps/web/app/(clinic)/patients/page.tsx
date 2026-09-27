// /patients — the practice's patients, home-testing switch and link issuing. Owner: Nihalika (N6).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor } from "@/app/login/destination";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { loadPatients, type PatientRow } from "./load";
import { PatientsTable } from "./patients-table";

export const metadata: Metadata = { title: "Patients · PledgeCheck" };
export const dynamic = "force-dynamic";

export default async function PatientsPage() {
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
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Patients</h1>
        <p className="max-w-2xl text-sm text-haze">
          Issue a one-time test link. The challenge code stays hidden until the patient taps Start.
        </p>
      </header>
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
    </main>
  );
}
