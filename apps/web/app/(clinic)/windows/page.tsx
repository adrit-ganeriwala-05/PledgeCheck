// Windows screen at /windows. Owner: Labib (ticket L5).
//
// Clinic staff look at this to see whose 7-day pickup window is closing.
// "Mark picked up" stands in for the pharmacy feed in the demo. Missed windows are read from
// the database (status = missed) and, until the backend's daily sweep writes that status,
// also derived here when closes_at has passed.

import { isMocked } from "@/lib/api/mode";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

import { MockWindows } from "./mock-windows";
import { WindowList, type WindowRow } from "./window-list";

export const dynamic = "force-dynamic";

export default async function WindowsPage() {
  if (isMocked("windowsPage")) {
    return (
      <Shell>
        <MockWindows />
      </Shell>
    );
  }

  // User-scoped: windows_select in db/policies.sql limits rows to this clinician's practice.
  const db = await createClient();
  const auth = await getClinician(db);
  if (!auth.ok) {
    return (
      <Shell>
        <p className="rounded-2xl border border-line bg-surface p-5 text-haze">
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
        <p role="alert" className="rounded-2xl border border-stop/40 bg-stop/5 p-5 text-mist">
          Could not load windows: {error.message}. Reload the page to try again.
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
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-6 space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Pickup windows</h1>
        <p className="max-w-2xl text-sm text-haze">
          Sorted by time left. Mark a prescription picked up to close the patient&apos;s cycle. A first
          prescription that misses its window needs a repeat test in a medical setting, with no waiting period.
        </p>
      </header>
      {children}
    </main>
  );
}
