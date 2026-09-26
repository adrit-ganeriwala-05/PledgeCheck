// Windows screen at /windows. Owner: Labib (ticket L5).
//
// Clinic staff look at this to see whose 7-day pickup window is closing.
// "Mark filled" stands in for the pharmacy feed in the demo.

import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { WindowList, type WindowRow } from "./window-list";

export const dynamic = "force-dynamic";

export default async function WindowsPage() {
  // User-scoped: windows_select in db/policies.sql limits rows to this clinician's practice.
  const db = await createClient();
  const auth = await getClinician(db);
  if (!auth.ok) {
    return (
      <Shell>
        <p className="rounded-lg border border-[var(--pc-line)] p-4 text-[var(--pc-muted)]">
          {auth.error === "unauthenticated"
            ? "Sign in to see this practice's pickup windows."
            : "This account is not a clinician."}
        </p>
      </Shell>
    );
  }

  const { data, error } = await db
    .from("windows")
    .select(
      "id, patient_id, submission_id, is_first_rx, opens_at, closes_at, filled_at, status, patients(pseudonym)",
    )
    .in("status", ["open", "missed"])
    .order("closes_at", { ascending: true });

  if (error) {
    return (
      <Shell>
        <p className="rounded-lg bg-red-50 p-4 text-[var(--pc-stop)]">
          Could not load windows: {error.message}
        </p>
      </Shell>
    );
  }

  const rows: WindowRow[] = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      patient_id: string;
      is_first_rx: boolean;
      opens_at: string;
      closes_at: string;
      filled_at: string | null;
      status: "open" | "filled" | "missed";
      patients: { pseudonym: string } | { pseudonym: string }[] | null;
    };
    const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;

    return {
      id: r.id,
      patientId: r.patient_id,
      pseudonym: patient?.pseudonym ?? "Unknown patient",
      isFirstRx: r.is_first_rx,
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      filledAt: r.filled_at,
      status: r.status,
    };
  });

  return (
    <Shell>
      <WindowList rows={rows} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold tracking-widest text-[var(--pc-brand)] uppercase">
          PledgeCheck
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Pickup windows</h1>
        <p className="mt-1 text-[var(--pc-muted)]">
          Sorted by time left. A first prescription that misses its window needs a repeat
          test in a medical setting, with no waiting period.
        </p>
      </header>
      {children}
    </main>
  );
}
