"use client";

// Offline demo only (NEXT_PUBLIC_API_MOCKS=all): the table from the mock adapter instead of
// the server-side Supabase read.
import { useEffect, useState } from "react";

import type { PatientRow } from "./load";
import { PatientsTable } from "./patients-table";

export function MockPatients() {
  const [rows, setRows] = useState<PatientRow[] | null>(null);
  useEffect(() => {
    void import("@/lib/api/mocks").then((m) => setRows(m.mockPatients()));
  }, []);
  return rows ? <PatientsTable patients={rows} /> : <p className="text-sm text-haze">Loading patients…</p>;
}
