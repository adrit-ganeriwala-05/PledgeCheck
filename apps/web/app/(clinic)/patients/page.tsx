// /patients — the practice's patients, home-testing switch and link issuing. Owner: Nihalika (N6).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor } from "@/app/login/destination";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { loadPatients, loadPendingRefills, type PatientRow } from "./load";
import { RefillQueue, type PendingRefill } from "./refill-queue";
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

  // A refill queue that fails to load must not take the patient list down with it.
  let refills: PendingRefill[] = [];
  try {
    refills = await loadPendingRefills(supabase);
  } catch (err) {
    console.error("[patients] refill queue load failed", err instanceof Error ? err.message : "unknown");
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
        <p className="text-sm text-muted-foreground">
          Issue a one-time test link. The challenge code stays hidden until the patient taps Start.
        </p>
      </header>
      <RefillQueue refills={refills} />
      {patients ? (
        <PatientsTable patients={patients} />
      ) : (
        <div role="alert" className="rounded-md border p-6 text-sm">
          Could not load patients.{" "}
          <Link href="/patients" className="underline">
            Try again
          </Link>
        </div>
      )}
    </main>
  );
}
